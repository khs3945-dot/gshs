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

## `collect.html` (제출함) is password-based by design, with one login-based shortcut

`collect.html` never requires Supabase Auth login — submitters pick 학생/선생님 and
authenticate with a name+password pair they set at submit time (students have no
site account at all), and managers authenticate with a separate manager
name+password set when the box was created. All of the actual CRUD (`create_collection`,
`manager_auth`, `update_collection`, `delete_collection`, `submit_files`,
`submitter_auth`) is Postgres RPCs (`SECURITY DEFINER`) that hash-check the password
server-side — the client never sees a password hash, and `verify_manager()` is the
one shared helper all the manager-side RPCs call.

`collections.owner_id` (nullable `uuid → auth.users`) lets `verify_manager()` also
pass when the **currently logged-in Supabase Auth account** matches the box's
creator, regardless of what name/password was passed in — set at creation time
from `sb.auth.getSession()` if the creator happened to be logged in (`collect.html`
still doesn't gate anything on login; it just opportunistically records who created
the box when it can). Clicking "담당자이신가요?" first tries `manager_auth` with
blank credentials (`onShowManageClicked`) — if the logged-in account owns the box,
this succeeds via the `owner_id` bypass and skips the password screen entirely;
otherwise it falls back to the normal password form.

**This bypass does not extend to Google Drive-touching actions** (템플릿 파일
추가/삭제, 개별 제출파일·전체 zip 다운로드, 제출함 폴더 자체 삭제) — those go through
the separate Apps Script (`driveApi`/`SCRIPT_URL`), which authenticates to Supabase
with the **service-role key** to re-check the same `verify_manager()` RPC. A
service-role call carries no user JWT, so `auth.uid()` is `null` in that context and
the `owner_id` bypass never applies there — only a real manager name+password still
works for those. `collect.html` reflects this in the UI: when the owner-bypass path
is used (`isOwnerBypass = true`), it hides "이 제출함 삭제", both zip-download
buttons, and the 양식 파일 add/remove controls, and shows a banner explaining that
those need "관리 비밀번호로 다시 들어오기" (`btnExitOwnerBypass`, which just resets
`isOwnerBypass` and re-shows the password gate) — don't try to route those actions
through the bypass without also updating the Apps Script.

## Weekplan document summaries (same Apps Script as `collect.html`)

`my-page.html`'s 주간계획 card and `chat-teacher`'s weekplan context both call the
`listWeekPlanFiles` action on the same Apps Script (`actionListWeekPlanFiles` in
`collect-setup.md`), which lists a Drive folder's files and attaches a short
`.summary` string to each. Only Google Docs/Slides get a summary (PDF/Sheets/images
get `summary: null`, and each page falls back to its own iframe preview or just a
filename+link); summaries are generated for the **5 most recent** files (matching
`chat-teacher`'s `fetchWeekPlanContext()`, which reads `data.files.slice(0,5)`) and
cached per `fileId+modifiedTime` in script properties so re-opening the page or
asking the chatbot repeatedly doesn't re-call Gemini.

Summary generation (`ks_extractWeekPlanSummary_`) tries, in order: (1) if a Gemini
key is configured in Apps Script properties, summarize the document's full text;
(2) otherwise (or if that call fails) pull just the heading-styled paragraphs,
list items, and tables via `ks_extractDocOutline_`/`ks_extractSlidesOutline_`,
capped at 14 items / 500 chars; (3) if a doc has no headings/lists/tables at all,
fall back to its first few raw lines. Full text (`ks_getFullText_`) is now built by
walking the document body's children directly (`ks_getDocFullTextWithTables_`)
rather than `Body.getText()`, specifically because `getText()` skips table content
entirely — a weekplan doc's schedule is very often laid out as a table, and that
content used to be completely invisible to both the AI summary and the outline
fallback. `ks_tableToText_` flattens each table to one `" | "`-joined line per row
(cell newlines collapsed to spaces) so a table reads as plain text without losing
its row/column shape. **Editing this script means updating `collect-setup.md` and
manually redeploying** — see its own instructions for pushing a new version to the
existing Apps Script deployment (never deploy fresh, or the `SCRIPT_URL` embedded
in `collect.html`/`chat-teacher` breaks).

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
  **`profiles_update_self`'s `WITH CHECK` blocks changing `is_admin`, `approved`,
  or `must_change_password` on your own row** (it requires those three columns to
  equal whatever is already stored for `auth.uid()`) — without this, any signed-up
  account could `PATCH /rest/v1/profiles?id=eq.<self>` with `{"is_admin":true}`
  and self-promote, since RLS is row-level, not column-level, and the original
  policy only checked `auth.uid() = id`. Admins still update those columns on
  *anyone's* row via the separate `profiles_update_admin` policy, which has no such
  restriction. If you ever add another admin-only or security-relevant column to
  `profiles`, add it to this same equality list — don't assume "self row" is a safe
  boundary for privilege-relevant fields.
  New teacher accounts are approved either by an admin (`member-admin.html`) or,
  if they match a name in the `staff` table, auto-approved at signup by the
  `self-register` Edge Function (see below).

## Password reset / forced change

There is no "temp password assigned at account creation" flow — every account is
self-registered via `login.html`'s signup form with a password the teacher picks
themselves (`self-register` Edge Function), so there's nothing to force-change on
first login. The only password-reset path today is **admin-initiated**:
`member-admin.html`'s "비밀번호 재설정" calls the `reset-member-password` Edge
Function (checks `is_admin` server-side), which sets a new password (typed in, or
random if left blank) and shows it once on screen for the admin to relay. There is
still no self-service "이메일로 재설정 링크 받기" — accounts use synthetic
`<base64 name>@teachers.gshs.local` addresses that can't receive real email, so
Supabase's standard reset-by-email can't work here without a different
verification mechanism.

Whenever `reset-member-password` resets someone's password, it also sets
`profiles.must_change_password = true`. `login.html`'s and `my-page.html`'s
session/profile gates both check this flag right after the `approved` check and
redirect to `change-password.html` before anything else loads if it's `true`;
that page forces a new password (`sb.auth.updateUser`) meeting a basic strength
check (8+ chars, letters+digits) and then clears the flag via the
`clear_must_change_password()` RPC (`SECURITY DEFINER`, always operates on
`auth.uid()` — never a client-supplied id) before continuing to `my-page.html`.
This gate is only wired into `login.html`/`my-page.html` (the two pages every
session actually starts from) — other pages don't independently re-check it, so a
determined user with a live session could still navigate straight to another page's
URL before changing their password. That's a UX gap, not a security one: the
actual privilege boundary is enforced at the RLS layer regardless (see
`profiles_update_self` above).

## Key Supabase tables

- **`profiles`**: id, name, role, phone, email, is_admin, approved, department,
  subject, extension, is_homeroom, homeroom_class, `must_change_password` (forces
  a detour through `change-password.html` — see above), `groups` (plain
  comma-separated `text`, e.g. `"국어과, 2학년, 담임"` — deliberately not a
  normalized join table, matching this repo's "free-text tags" convention used
  elsewhere like `staff.homeroom`), `ui_prefs` (jsonb — a grab-bag for per-user UI
  state like `dash_collapse`, `dash_block_order`).
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
- **Teacher groups (`profiles.groups`, `teacher-groups.html`)**: any *approved*
  teacher (not admin-gated) can assign any other teacher's `groups` field —
  free-text, comma-separated tags mixing subject/department/grade/anything else
  (e.g. `"국어과, 2학년, 담임"`) — via `teacher-groups.html`, a standalone page
  listed in `nav.js`. Writes go through the `set_profile_groups(p_target_id,
  p_groups)` RPC (`security definer`, scoped to touch only the `groups` column,
  gated by `current_user_is_approved() or current_user_is_admin()` rather than
  admin-only, per the user's explicit request that this be usable by every
  teacher). The page reads the full teacher list from `public_profiles` (a plain
  view, not RLS-scoped — see below) rather than `profiles` directly, since a
  non-admin can only `select` their own `profiles` row. `member-admin.html`'s
  detail panel also has a plain `groups` text field (saved via its normal
  admin-only `profiles` update, not the RPC, since that page is already
  admin-gated). `my-page.html`'s task-assignment picker (블록 "나에게 배당된 할
  일" → "+ 새로 배정하기" → "그룹별" 탭) unifies department/subject/grade/custom
  `groups` tags into a single flat checkbox list (`profileTagsOf()` builds each
  profile's tag set, `allGroupTags()`/`profileIdsForTag()` derive the list and
  reverse-lookup) rather than the old two-step kind-then-value dropdown pair —
  matching the "개인별" tab's own checkbox-list UI per the user's explicit
  request. Checking one or more tags and clicking "선택한 그룹 적용" just turns on
  the matching people's checkboxes in the "개인별" tab (a union across all
  checked tags); what's actually persisted on submit is still the plain
  per-person `assignee_id` list, same as before. The "제출 현황" popup
  (`openSubmissionModal`/`submissionRows`) also shows each assignee's 담임반
  next to their name (via a new `homeroomLabelFor(id)` lookup against
  `allProfiles`) whenever they're a homeroom teacher — this fires for anyone
  with `is_homeroom && homeroom_class` set, not just people added via a
  grade-tag group selection, since `task_assignments` has no per-assignment
  record of *how* someone was added to a task.
- **`memos`** (`memo.html`, and the `memo` widget on `my-custom-page.html`): personal
  notes per teacher — title, content, `labels` (text array), timestamped. RLS is
  plain per-owner (`auth.uid() = owner_id`) for all four commands, like `tasks`.
- **`app_settings`** (single row, `id = 'site'`): site-wide config. RLS: anyone can
  `select`, only `profiles.is_admin = true` can `update`. This is the pattern to
  follow for any new site-wide (as opposed to per-user) setting — add a column here
  and reuse the existing policies. Current columns: `require_approval` (signup
  approval policy, toggled in `member-admin.html`), `collapse_defaults` (jsonb —
  see below), `default_dash_block_order` (jsonb, my-page.html layout default),
  `default_dash_col_widths` (jsonb, my-page.html 3-column width default — see
  below), `link_hub_category_order` (jsonb, ordered array of category names).

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
`blockAssignedBody`, `blockBriefingBody`, `blockWeekBriefingBody`,
`blockTodayBody`, `blockWeekBody`, `cardTasks` (all `my-page.html` — every
dashboard block there is collapsible now); `cardLocal`, `cardMs`,
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

`my-page.html`'s dashboard also has column-width resizing, active only in the same
"✏️ 배치 편집" edit mode as block reordering. `.dash-grid`'s `grid-template-columns`
is `var(--dash-col-w0,1fr) 16px var(--dash-col-w1,1fr) 16px var(--dash-col-w2,1fr)` —
the two 16px tracks are real `.dash-col-resize-handle` grid children (not just CSS
`gap`) sitting between the three `.dash-col`s, always reserved at that width so the
default (no custom widths) layout is pixel-identical to a plain `1fr 1fr 1fr` grid;
only their visible drag bar (a `::after` pseudo-element) and `pointer-events` are
gated behind `body.dash-editing`, which is also why they need `align-self:stretch`
(an empty grid item with no content otherwise collapses to 0 height under this
grid's `align-items:start`). Dragging a handle changes only its two neighboring
columns' fr values (keeping their combined fr constant, clamped to a `140px`
minimum each), leaving the third column and the underlying `.dash-frame` block
order completely untouched. Persistence follows the exact same 3-tier pattern as
block order: `localStorage` (`ks_dash_col_widths_v1`) for instant paint,
`profiles.ui_prefs.dash_col_widths` as the cross-device source of truth (committed
on every pointerup, like `dash_block_order`), and `app_settings.
default_dash_col_widths` as the admin default (captured/cleared by the same
"🔧 이 배치를 기본으로 설정" / "↺ 기본값 초기화" buttons that already handle collapse
state and block order). Resizing is desktop-only by design — below the 760px
breakpoint the handles are `display:none` and the grid reverts to its plain
mobile `1fr 1fr` / `1fr` templates, since a stacked single/double-column mobile
layout has no meaningful "column width" to adjust.

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
  finish entirely server-side: it inserts into `tasks` (`{owner_id, title,
  due_at}`) **and** a matching `task_assignments` row (`{task_id, assignee_id:
  uid}`) before returning a canned confirmation reply — no second Gemini call
  needed. The `task_assignments` row is not optional: every to-do list on this
  site (`my-todo.html`/`my-page.html`'s local task list) renders its checkbox
  disabled unless the current user has a `task_assignments` row for that task
  (`item.myAssignment`), since completion state lives on the assignment, not the
  task itself — a task inserted without one shows up with a permanently
  unclickable checkbox. This bit every "add a personal to-do via X" path that
  only inserted into `tasks`: fixed here, in `messages.html`/`my-custom-page.html`/
  `my-page.html`'s "할 일에 추가" (로컬 destination) in the message-summary flow,
  and must be kept in mind for any future one.
- When no school-specific source (RAG matches, weekplan, calendar, approved facts)
  answers the question, the system prompt tells the model to say so honestly
  (reusing the existing `NO_ANSWER_PATTERNS` regex bank used for the suggested-
  question stats), but it must also decide *why* it doesn't know: if the question
  is about something specific to 경성고등학교 itself (a person, schedule, facility,
  internal policy — anything where another school's case wouldn't help), it's told
  to include the fixed sentence "이 내용은 우리 학교만 해당되는 정보라 자료에서 확인되지
  않으면 알려드리기 어려워요." (matched server-side by `SCHOOL_SPECIFIC_NO_SEARCH_RE`);
  otherwise (a generally-applicable question — education policy, law, common
  procedure — that just isn't covered by uploaded materials) it uses a plain
  "찾지 못했어요" phrasing. The web-search fallback only fires when
  `looksLikeNoAnswer(replyText)` matches **and** `SCHOOL_SPECIFIC_NO_SEARCH_RE`
  does not — searching the web for other schools' cases when the question was
  never answerable that way just adds noise. When it does fire, a **second**
  Gemini call is made with the `google_search` grounding tool instead of the
  custom `functionDeclarations` tools (Gemini doesn't allow mixing the two kinds
  of tools in one request), instructed to lead with "우리 학교 자료에서는 찾지
  못했지만" and to NOT write source URLs or "출처: ..." lines in the answer body
  itself (a regex strips any trailing `출처:`/`참고 링크:` block as a safety net
  in case the model does anyway). Citations come from
  `groundingMetadata.groundingChunks[].web.{uri,title}` and replace `sourcesUsed`
  as `"제목 (URL)"` strings — `chatbot-teacher.html`'s `renderSources` renders only
  the title as a clickable link and never shows the raw URL text. Web-sourced
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

## PDF reference-material uploads are extracted in the browser, not the server

All three doc-upload surfaces (`chatbot-teacher.html` → `chat-teacher-ingest`,
`chatbot-builder.html` → `custom-bot-doc-ingest`, `my-bot.html` →
`personal-bot-doc-ingest`) used to have their Edge Function download the file and
extract text server-side for every format including PDF (via `unpdf`). A ~20MB/
200-page PDF reliably blew past Supabase's free-plan Edge Function limits (2s CPU,
150s wall-clock) doing that parsing, so **PDF specifically** was moved to a
client-side pipeline; **txt/xlsx/pptx/hwpx are unchanged** (still extracted
server-side in the same functions — only the PDF branch was removed from each,
along with the `unpdf` import).

Each of the three HTML pages loads `pdfjs-dist@3.11.174` from jsdelivr (`build/
pdf.min.js` + `build/pdf.worker.min.js`, exposing the `pdfjsLib` global — no
bundler needed) and, only when the selected file's extension is `pdf`, runs this
client-side sequence (implemented three times, copy-paste-per-page as usual —
keep all three in sync if you touch this logic):
1. `extractPdfPages(file, onProgress)` — `pdfjsLib.getDocument()` + `page.getTextContent()`
   per page, keeping pages **unmerged** (unlike the server's old single merged-text
   approach) so each chunk can carry an accurate page number.
2. `chunkPageText(text)` — the same paragraph/heading-based chunking algorithm as
   the server's `chunkText()` (`CHUNK_SIZE=1500`, `CHUNK_OVERLAP=150`,
   `HEADING_RE`), ported to JS verbatim, but run **once per page** rather than on
   one merged string, so a chunk never spans a page boundary and always has a
   well-defined `pageNumber`. `buildPdfChunks()` flattens all pages' chunks in
   order, caps the total at `PDF_MAX_CHUNKS=400` (matching the server's old cap),
   and assigns a global sequential `chunkIndex`.
3. Chunks are POSTed to the ingest function in sequential batches of `PDF_BATCH_SIZE=25`
   (`runPdfBatches()`; batches are never sent concurrently) as
   `{documentId, chunks: [{content, pageNumber, chunkIndex}], isFirst, isLast}`.
   Each batch retries up to `PDF_MAX_ATTEMPTS=4` (1 try + 3 retries, backing off
   800ms×attempt) before giving up. The Edge Function's pre-chunked branch (taken
   whenever the request body has a `chunks` array, checked before the legacy
   `{documentId}`-only path) does **only** embedding + insertion — `isFirst`
   triggers `delete().eq('document_id', documentId)` first (so a re-upload
   replaces old chunks, same convention as the legacy path) and kicks off
   `classifyDocument` (chat-teacher-ingest only) using the first batch's content as
   a sample; `isLast` touches the document's `updated_at`. `page_number` is a
   plain nullable `integer` column added to `chat_chunks`/`custom_bot_chunks`/
   `personal_bot_chunks` — populated for PDFs, `null` for every other format.
4. If a batch ultimately fails after all retries, the client remembers
   `{documentId, batches, failedBatchIndex, title}` in a module-scope
   `pendingPdfResume` variable and renders a "⏸ 이어서 저장" button (delegated
   click handler on `document.body`, since the message container's `innerHTML` is
   replaced on every status update) that resumes `runPdfBatches()` from exactly
   that batch — it does **not** re-extract or re-chunk the file, and critically
   does not resend `isFirst` (which would wipe the batches that already saved).
5. Near-empty extraction (scanned/image-only PDFs, checked via total non-whitespace
   character count and the fraction of pages with any real text) skips the batch
   step entirely and reports "글자를 추출할 수 없는 PDF입니다. 스캔본인지 확인해
   주세요" — the file itself is still kept in storage/`*_documents`, same as any
   other "couldn't extract content" case.

Progress is shown as plain status text through the same message element the
non-PDF upload path already used (`onStatus(...)` → `setMsg(...)`), not a numeric
progress bar — `텍스트 추출 중 (45/200페이지)` during extraction,
`저장 중 (3/10묶음)` during batch upload. The upload button stays disabled for the
whole multi-file loop exactly like before, so no separate "PDF is processing"
lock was needed. `chatbot-teacher.html`'s "파일 교체" (replace-file) flow has its
own copy of this same batch-upload logic, since it re-ingests into an existing
`documentId` rather than creating a new document row.

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
(txt/xlsx/pptx/hwpx server-side; PDF is client-side — see the PDF section above)
and chunking code verbatim — keep all three ingest functions in sync if you
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
사항" and "✅ 할 일" sections. `todos` is `{text, dueDate}[]` — the Edge Function is
given today's date (KST) and told to resolve any deadline mentioned in the message
text itself (explicit dates or relative ones like "다음 주 금요일까지") into a
YYYY-MM-DD `dueDate`, `null` when no deadline is mentioned (never guessed). Each
"할 일" line renders with a checkbox (`data-text="<line>"`) **and its own** date
input pre-filled from that item's `dueDate` (still editable, and left blank when
there was nothing to find) — there is no single shared deadline field anymore;
"선택 항목 할 일에 추가" reads each checked row's own date input when building the
`tasks` insert (`{owner_id, title: <line text>, due_at: <that row's date or
null>}`). A `normalizeTodoItem`-style helper treats a plain string as `{text,
dueDate: null}` so old rows in `saved_message_summaries` (saved before this
per-item-date change, when `todos` was `string[]`) still render correctly. This
exists in three near-identical copies (`messages.html`'s `.sum-todo-*` classes,
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