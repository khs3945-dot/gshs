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

Every "🔧 기본으로 설정" button has a companion "↺ 기본값 초기화" button right next
to it (same admin-only visibility gate), so a mistaken default can be undone. It
deletes just that page's own key(s) from `collapse_defaults` (read-modify-write,
same as saving) — `my-page.html`'s also resets `default_dash_block_order` to
`null`, and `link-hub.html`'s also resets `link_hub_category_order` to `[]` since
that page's category order auto-saves on drag with no separate save step. This is
always safe to add: users who already saved their own preference are unaffected
(tier 1 always wins), and it just falls back to that page's hardcoded default.

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
- `add_todo` is a Gemini function-calling tool (same pattern as `find_document`/
  `remember_fact`) that lets a teacher add a to-do by chat or voice (e.g. "내일까지
  성적 입력 할 일에 추가해줘"). Unlike `summarize_messages` (which needs browser-only
  `.udb` data and has to hand off via `pageAction`), this one the Edge Function can
  finish entirely server-side: it inserts straight into `tasks`
  (`{owner_id, title, due_at}`) and returns a canned confirmation reply — no second
  Gemini call needed.
- When no school-specific source (RAG matches, weekplan, calendar, approved facts)
  answers the question, the system prompt tells the model to say so honestly
  (reusing the existing `NO_ANSWER_PATTERNS` regex bank used for the suggested-
  question stats). If `looksLikeNoAnswer(replyText)` matches, a **second** Gemini
  call is made with the `google_search` grounding tool instead of the custom
  `functionDeclarations` tools (Gemini doesn't allow mixing the two kinds of tools
  in one request), instructed to lead with "우리 학교 자료에서는 찾지 못했지만" and
  end with `출처: 제목 (URL)` lines. Citations come from
  `groundingMetadata.groundingChunks[].web.{uri,title}` and replace `sourcesUsed`
  as `"제목 (URL)"` strings (`chatbot-teacher.html`'s `renderSources` auto-linkifies
  any source string matching that trailing `(https://...)` shape). Web-sourced
  answers are deliberately excluded from `chat_faq_cache` since external
  information can go stale.
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

## Personal per-teacher assistant bot (`my-bot.html` + `personal-bot-chat`/`personal-bot-doc-ingest`)

This is a genuinely separate subsystem from both the shared teacher chatbot
(`chat-teacher`) and the student-facing custom chatbots (`custom_bots` /
`chatbot-builder.html` / `bot.html` / `student-bot-chat`, which are entangled with
PIN/slug/session logic for sharing with students) — deliberately kept apart so
adding to one never risks the other. Tables: `personal_bots` (`owner_id` is the
primary key, one row per teacher, holds `system_prompt`), `personal_bot_documents`,
`personal_bot_chunks` (`embedding vector(3072)`, matches via the
`match_personal_bot_chunks(query_embedding, p_owner_id, match_count)` RPC — scoped
by `p_owner_id` so one teacher's uploads never leak into another's answers),
`personal_bot_messages` (a single persistent thread per teacher, no
multi-conversation concept like `chat-teacher` has). Storage bucket
`personal-bot-docs`, objects always under `<owner_id>/...` with RLS checking
`(storage.foldername(name))[1] = auth.uid()::text` (same convention as
`custom-bot-docs`, but keyed directly by the uploader's own id since there's no
intermediate bot-ownership table to join through).

`personal-bot-doc-ingest` reuses `chat-teacher-ingest`'s multi-format extraction
(pdf/txt/xlsx/pptx/hwpx) and chunking code verbatim — keep both in sync if you
improve the chunking heuristics. `personal-bot-chat` is much simpler than
`chat-teacher`: no function-calling tools, no FAQ cache (per-user system prompts
mean cached answers can't be safely shared), and it does NOT restrict itself to
only the teacher's own materials — RAG context is preferred when relevant, but
the model is told to fall back to general knowledge and act like a personal
secretary for anything else (drafting, planning, general questions), since this
bot is explicitly personal-use rather than the "only answer from school materials"
teacher-wide bot.

`my-bot.html` (standalone + `?widget=1`, same iframe-widget pattern as everything
else) has three parts: a persistent chat, a system-prompt editor, and a document
upload/list panel. The widget mode only shows the chat (matching
`chatbot-teacher.html`'s widget layout) — settings/uploads are standalone-page-only,
reached via the widget's "전체 보기" link. `my-custom-page.html`'s `custom_chatbot`
widget cell now just does `renderIframeWidget(body, '나만의 챗봇 비서', './my-bot.html',
'./my-bot.html?widget=1')` — it used to be an ephemeral single-instruction mini-bot
with no persistence (`mini-chatbot-chat` Edge Function, now unused/orphaned) that
reset every time the cell reopened; this replaced it entirely, so update both
`WIDGETS` maps' label (`my-custom-page.html` and `custom-page-chat`) together if it
changes again.

## Message-inbox AI summaries (`summarize-messages` + `saved_message_summaries`)

`messages.html`, its `messages_summary` widget on `my-custom-page.html`
(`renderWidgetMessagesSummary`), and the `mi-sum-block` on `my-page.html` all call
the same `summarize-messages` Edge Function against whatever messages are synced
server-side (`message_sync` — only messages the user has classified as 할 일/보관/
라벨, since full `.udb` message content never leaves the browser) and render the
result with a `categorizedSummaryHtml`-style function that splits it into "📢 전달
사항" and "✅ 할 일" sections. Each "할 일" line gets a checkbox
(`data-text="<line>"`); a date input + "선택 항목 할 일에 추가" button next to the
list inserts the checked lines into `tasks` (`{owner_id, title: <line text>,
due_at: <picked date or null>}`) without leaving the summary view. This exists in
three near-identical copies (`messages.html`'s `.sum-todo-*` classes,
`my-custom-page.html`'s `mp-` prefixed classes, `my-page.html`'s `mi-` prefixed
classes) per this repo's copy-paste-per-page convention — replicate all three if
you change the behavior.

A saved summary (`saved_message_summaries`, one row per `AI 요약` result the user
chose to keep) must render identically whether or not the device has a `.udb` file
connected — the summary's `notices`/`todos` arrays are self-contained and were
already saved to the server, unlike the message originals. On `messages.html`
specifically, the result/save elements (`#summarizeResult`, `#btnSaveSummary`)
must NOT be nested inside `#sumMainControls` (which is `display:none` until a
`.udb` file connects) — only the *controls for making a new summary* belong there;
the saved-summary list and the rendered result must be siblings that are always
visible, or clicking a saved summary silently renders into a hidden container.

The "할 일에 추가" step also lets the teacher pick a save destination — 로컬 (the
site's own `tasks` table), Microsoft To Do, or Google Tasks — via a `<select
class="...TodoDest">` next to the deadline input, but only offering the options
for services that are actually connected. Connection state and API access are
detected the same way `my-todo.html` already does it (that page is the original,
fullest implementation — copy its patterns for anything new here): a
`msal-browser` `PublicClientApplication` with the same `MS_CLIENT_ID`/`MS_SCOPES`
and `cacheLocation: 'localStorage'` (so `msalApp.getAllAccounts()` sees an account
even if the user connected from a *different* page — the cache is shared by
origin, not by page), and a Google access token read straight out of
`localStorage['ks_todo_google_token']` (checking `expires_at`, no need to
re-trigger a login flow just to check). `msDefaultListId()`/`gtDefaultListId()`
resolve which list to add to, independent of whichever list the user last picked
in `my-todo.html`'s own UI (read from `localStorage['ks_todo_list_prefs']` if
present, else the account's default/first list) — they work even if the visiting
page never shows a list picker of its own. Posting a task: MS Graph
`POST /me/todo/lists/{id}/tasks` with `{title, dueDateTime: {dateTime: 'YYYY-MM-
DDT00:00:00', timeZone: 'Asia/Seoul'}}`; Google Tasks `POST
/lists/{id}/tasks` with `{title, due: 'YYYY-MM-DDT00:00:00.000Z'}`.

**Gotcha specific to `my-page.html`**: unlike every other page in this repo, it has
**two separate top-level `<script>` IIFEs**, not one — the first holds the
dashboard blocks (including `mi-sum-block`), the second is a near-complete copy of
`my-todo.html`'s local/MS/Google task-list UI (`cardTasks`). They do not share a
closure, so a function defined in one is `ReferenceError`-undefined in the other;
this bit us once already (`msAccount`/`gtFetch` etc. looked reachable from
`miDestSelectHtml` while writing it, then threw at runtime). The established fix,
already used elsewhere in that file (`window.msTasksCache`, `window.gtTasksCache`,
`window.reRenderWeek`), is to hang anything the *other* block needs off
`window` — e.g. `window.msAccount = msAccount;` — and call it as `window.msAccount()`
from the far side. `gtAccessToken` specifically must be exposed as a getter
function (`window.getGtAccessToken = () => gtAccessToken;`), not a plain
assignment, since its value changes after a silent reconnect completes and a
one-time snapshot would go stale.