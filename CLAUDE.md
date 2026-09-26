# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

경성고 교무 도구 ("Gyeongseong High School teacher tools") — a multi-page static
HTML/JS site with no build step, no bundler, and no package.json. Every page is a
single self-contained `.html` file with its `<style>` and `<script>` inline. There
is no shared JS module system: common logic (Supabase client setup, escapeHtml
helpers, collapse/expand persistence, etc.) is deliberately copy-pasted into each
page rather than imported. Follow that convention for new pages/features instead of
introducing a bundler or shared modules.

Two small shared scripts *are* loaded via `<script defer>` on most pages:
`nav.js` (floating hamburger nav + teacher chatbot fab) and `site-login-badge.js`
(login badge in the corner).

## Commands

There is no build, lint, or automated test tooling checked into this repo (no
`package.json`). Development is: edit an `.html` file directly, then serve the repo
root with a static file server and open the page in a browser, e.g.:

```
python3 -m http.server 8801
```

There is no CI test suite. When verifying changes, do it by hand in a browser (or,
in a sandboxed agent session, with an ad-hoc Playwright script against the local
static server, mocking Supabase REST/RPC calls — there is no committed test
scaffold to run).

## Deployment / infrastructure

- **Hosting**: Netlify, deployed from the `main` branch. `netlify.toml` only
  disables deploy previews for PRs (`context.deploy-preview.ignore`); there is no
  build command configured (it's a static publish of the repo root).
- **Backend**: Supabase (Postgres + Auth + Edge Functions), project id
  `tmssupuskkajahpuswcj`. The publishable/anon key is intentionally hardcoded in
  many pages (`sb_publishable_...`) — this is safe by design, security is enforced
  via RLS policies, not by hiding the key. Do not treat it as a secret.
- **`.github/workflows/keep-supabase-alive.yml`**: a cron (every 3 days) that pings
  the Supabase REST API so the free-tier project doesn't auto-pause after 7 days of
  inactivity (relevant during school breaks).
- **File/Drive-backed features use Google Apps Script instead of Supabase.**
  Several pages (`collect.html`, `room-request.html`, `link-hub.html`, the weekplan
  integration) call a Google Apps Script Web App URL (`const SCRIPT_URL =
  'https://script.google.com/macros/s/.../exec'`) rather than Supabase, because they
  need to write into Google Drive folders or existing Google Sheets. Supabase is
  used for structured/relational data (accounts, tasks, chat, settings); Apps
  Script is used specifically where the source of truth is a Sheet or Drive files.
  See `collect-setup.md` and `room-request-setup.md` for how to (re)deploy those
  Apps Script web apps — the deployment URL changes if you deploy fresh instead of
  pushing a new version to the existing deployment.
- One-time external API setup is documented in `AUTH-SETUP.md` (Google OAuth client
  for login) and `GCAL-SETUP.md` (Google Calendar API key for `date.html`) — read
  these before touching login or calendar-embed code.

## Authentication — two separate, easily-confused systems

- **`auth.js`** is a simple Google Identity Services domain-gate (restricts login to
  `ALLOWED_DOMAIN`, e.g. `senedu.kr`) that wraps a page's content in
  `<div id="protected-content">`. It is currently **disabled**
  (`AUTH_ENABLED = false` at the top of the file) — don't assume pages are gated by
  it just because the script tag is present in `<head>`.
- **The actual live auth/approval system is Supabase Auth + the `profiles` table**,
  checked inline in each page's own `<script>`. The standard pattern, repeated
  per-page:
  ```js
  const { data: { session } } = await sb.auth.getSession();
  if(!session){ /* show gateView / login prompt */ return; }
  const { data: profile } = await sb.from('profiles').select('approved, is_admin')
    .eq('id', session.user.id).maybeSingle();
  if(!profile || !profile.approved){ /* show pendingView */ return; }
  // show mainView; profile.is_admin gates admin-only UI
  ```
  New teacher accounts are approved either by an admin (`member-admin.html`) or,
  if they match a name in the `staff` table, auto-approved at signup by the
  `self-register` Edge Function (see below).

## Key Supabase tables

- **`profiles`**: id, name, role, phone, email, is_admin, approved, department,
  subject, extension, is_homeroom, homeroom_class, `ui_prefs` (jsonb — a grab-bag
  for per-user UI state like `dash_collapse`, `dash_block_order`).
- **`staff`**: the teacher roster (~58 rows, primary key `name`) — department/
  subject/extension/mobile/homeroom/homeroom_room/hours/schedule. RLS: only
  `profiles.is_admin = true` can read or write it via the client; the
  `self-register` Edge Function reads it with the service-role key regardless.
  Kept up to date from `member-admin.html`'s "교직원 명렬 관리" card (paste a
  tab-separated range copied from Excel — 이름/부서/교과/내선번호/휴대폰/담임반/
  담임교실/수업시수 — and it's upserted by `name`).
- **Syncing `staff` into `profiles`**: `self-register` copies matching `staff`
  fields into a new profile *at signup time only* — existing accounts don't stay
  in sync automatically (department/extension/homeroom change every school year).
  `member-admin.html` has two "↻ 다시 불러오기" actions for this: a per-member one
  in the detail panel (fills the edit form from `staff`, admin still clicks
  저장) and a bulk one in the toolbar (overwrites department/subject/extension/
  is_homeroom/homeroom_class for every profile whose name matches a `staff` row).
  Note `staff.phone` is unused/always empty in practice — real numbers live in
  `staff.mobile` — so the refresh logic intentionally leaves `profiles.phone`
  alone rather than blanking it.
- **`memos`** (`memo.html`, and the `memo` widget on `my-custom-page.html`): personal
  notes per teacher — title, content, `labels` (text array), timestamped. RLS is
  plain per-owner (`auth.uid() = owner_id`) for all four commands, like `tasks`.
- **`app_settings`** (single row, `id = 'site'`): site-wide config. RLS: anyone can
  `select`, only `profiles.is_admin = true` can `update`. This is the pattern to
  follow for any new site-wide (as opposed to per-user) setting — add a column here
  and reuse the existing policies. Current columns: `require_approval` (signup
  approval policy, toggled in `member-admin.html`), `collapse_defaults` (jsonb —
  see below), `default_dash_block_order` (jsonb, my-page.html layout default),
  `link_hub_category_order` (jsonb, ordered array of category names).

### The "admin default, user override wins" pattern

Several pages have collapse/expand toggles and (on `my-page.html`) draggable block
order. Rather than a central settings screen, each such page gets an admin-only
"🔧 기본으로 설정" button *on that page* that captures whatever the admin has the
UI currently showing and writes it into `app_settings` (read-modify-write, so it
doesn't clobber other pages' keys in the same jsonb column). Every page then
resolves its own toggle state with this priority, in order:
1. The signed-in user's own saved preference (`profiles.ui_prefs` if it's a
   cloud-synced setting, otherwise `localStorage`).
2. The admin default from `app_settings.collapse_defaults` /
   `default_dash_block_order`.
3. Whatever state is hardcoded in that page's HTML.

Known `collapse_defaults` keys: `blockInfoBody`, `blockMsgInboxBody`,
`blockTimetableBody`, `blockWeekPlanCurrentBody`, `blockWeekPlanArchiveBody`,
`blockAssignedBody`, `cardTasks` (all `my-page.html`); `cardLocal`, `cardMs`,
`cardGt` (`my-todo.html`); `mpControls` (`my-custom-page.html`); `chatSuggest`
(`chatbot-teacher.html`); `linkHubCategories` (`link-hub.html` — a single default
applied uniformly, since category names there are user-created and dynamic).
Follow this same 3-tier pattern for any new persisted UI state — don't build a
remote checklist UI for it.

## `nav.js`

Loaded on nearly every page. Two responsibilities that are coupled by design:
- Renders the floating hamburger nav menu from a `DEFAULT_NAV_ITEMS` array.
- Groups `index.html`'s `.tool-card` tiles into the same named groups
  (`groupToolCardTiles()`, matched by `href`). Group *order* on `index.html`
  follows the tool cards' **DOM order in `index.html`**, not the order of
  `DEFAULT_NAV_ITEMS` — to reorder the main-page grouping, reorder the actual
  `<a class="tool-card">` blocks in `index.html`.
- Also builds the floating "교사용 챗봇" chat button (`buildTeacherChatFab`),
  which embeds `chatbot-teacher.html?widget=1` in an iframe that stays mounted
  (just hidden) while the panel is closed. Because of that, anything that should
  happen "on open" (e.g. scroll-to-bottom) can't just run once at load — it needs
  a `postMessage` from `nav.js` to the iframe each time the panel is opened.

## Drag-and-drop reordering

Implemented with raw Pointer Events (`pointerdown`/`pointermove`/`pointerup`/
`pointercancel` + `setPointerCapture`) — never native `draggable="true"`, since
iOS Safari doesn't support it and Android support is inconsistent. While dragging,
an actual indicator element (e.g. `.dash-drop-indicator`, `.cat-drop-indicator`) is
inserted into the live DOM flow at the drop position, rather than just outlining
the target, so it's visually unambiguous which two items the dragged one will land
between. See `my-page.html` (dashboard block order) and `link-hub.html` (category
order) for the two existing implementations to copy from.

## `my-custom-page.html` widgets

Most widgets aren't native re-implementations — they embed the real page in an
`<iframe>` via `renderIframeWidget()`, using a `?widget=1` (or `?widget=blockId`
for a specific block of `my-page.html`) query param that the embedded page
checks itself (`new URLSearchParams(location.search).get('widget') === '1'`) to
add a `body.widget-mode` class and hide its own header/nav via CSS. This is why
a standalone page and its widget stay in sync for free — they're the same page
and the same Supabase rows, just rendered narrower. Prefer this over a native
widget renderer unless the page doesn't exist standalone (e.g. `messages`, whose
widget is a genuinely separate compact renderer).

The `WIDGETS` map that lists valid widget keys is duplicated in two places that
must be kept in sync by hand: the client-side `WIDGETS` object in
`my-custom-page.html`, and an identical `WIDGETS` object inside the
`custom-page-chat` Edge Function (which the "나만의 페이지 도우미" chatbot uses to
validate/describe widgets it can place). Adding a widget means updating both.

When redeploying `custom-page-chat` (or any Edge Function originally deployed
with `verify_jwt: false`), pass `verify_jwt: false` explicitly — the deploy
tool defaults it to `true`, which would make the platform reject the function's
own CORS `OPTIONS` preflight before the function's manual
`admin.auth.getUser(token)` check ever runs.

## The teacher chatbot (`chat-teacher` Edge Function + `chatbot-teacher.html`)

- Chat model is `gemini-3.6-flash`; embeddings are `gemini-embedding-001`
  (`text-embedding-004` is deprecated — don't revert to it).
- RAG matches come from the `match_chat_chunks` RPC, which returns a `similarity`
  column; matches below `RAG_SIMILARITY_THRESHOLD` (0.5) are dropped before being
  used as context or listed as a source (top-K vector search otherwise always
  returns something, even when nothing is actually relevant).
- The calendar context injected into every message covers a fixed window (today
  -10 days to +21 days). Questions outside that window are handled by a Gemini
  function-calling tool, `search_calendar_events`, that fetches an arbitrary range
  (capped at 400 days) on demand — the fixed window is intentionally not widened
  further, to avoid injecting huge amounts of calendar data into every request.
- Sources shown to the user are not "whatever context was fetched" — the model is
  instructed to end its reply with a `[[참고자료: ...]]` line naming only what it
  actually used; that line is parsed out of the displayed text and intersected
  against the list of things actually provided (to drop any hallucinated names).
- Suggested-question chips come from `top_asked_questions(p_limit, p_min_count)`;
  only questions asked `p_min_count` times or more are shown, and the UI reveals
  them progressively (2 by default, "더보기" for the rest) rather than all at once.
- Speech-to-text input dedupes on the *text*, not on `SpeechRecognition`'s
  `resultIndex`/`isFinal` fields — in practice the browser sometimes re-emits an
  already-finalized segment as a longer/duplicate "final" result, so naively
  trusting `isFinal` produces repeated words. The fix compares each new segment
  against the previously accumulated text and only appends genuinely new content.
- **Reference material isn't only uploaded from `chatbot-teacher.html` itself.**
  `messages.html` has an admin-only "🤖 챗봇 참고자료로 보내기" action (per-message and
  as a bulk checkbox action). It never uploads a message's raw text directly — the
  click opens a review queue (`openChatRefQueue`, one modal, reused for both the
  single-message and bulk cases) showing an editable title/content prefilled from
  the message. The admin can hand-edit it, or click "✨ AI로 다듬기" to have the
  `refine-chat-doc-text` Edge Function (Gemini, admin-only, strips greetings/
  signatures and condenses multi-person chat into plain statements without
  inventing facts) rewrite it first — nothing is sent until "이 내용으로 보내기" is
  clicked for that item, and only the current (possibly edited) text is what
  actually gets uploaded. Bulk selection just queues multiple messages through the
  same modal one at a time ("건너뛰기" skips an item without sending). The upload
  itself (`sendChatDocText`) is the same sequence `chatbot-teacher.html`'s "텍스트
  직접 입력" tab uses: upload a text `Blob` to the `chat-teacher-docs` storage
  bucket, insert the `chat_documents` row (tagged `category: '메신저'`), then call
  `chat-teacher-ingest` with the new `documentId` to chunk+embed it. Reuse
  `sendChatDocText` for any future "send this as chatbot reference material"
  feature elsewhere — but keep the review-before-send step, since the whole point
  is that nothing goes into the chatbot's knowledge unedited and unconfirmed.
