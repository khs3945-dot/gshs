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
- **A second host, Vercel, is also connected (2026-10-21) — `main`/Netlify stays the
  stable production site; `work`/Vercel is the live preview for in-progress changes.**
  The Vercel project (`gshs`, under the repo owner's own account, GitHub-integration-
  linked) auto-deploys on every push, same static-publish-of-repo-root setup as
  Netlify (no build command, `framework: null`). New work should be pushed to the
  `work` branch (not directly to `main`) and opened as a standing PR from `work` →
  `main` — Vercel builds a real preview deployment for that PR/branch automatically,
  giving a live clickable link to check changes on before merging (this repo's
  `netlify.toml` deliberately disables Netlify's own PR previews to save Netlify
  credits, so Vercel's preview is the actual "see it before it's live" mechanism now).
  Merge `work` → `main` once reviewed; that merge is what actually updates both the
  Vercel production domain and (next deploy) Netlify. SSO/deployment protection on
  the Vercel project is turned off so these links are publicly viewable with no
  Vercel login. Login via Google OAuth and the Kakao Maps SDK need their allowed-
  domain lists in Google Cloud Console / Kakao Developers to include the Vercel
  domain too (see `AUTH-SETUP.md`/`KAKAO-MAP-SETUP.md`) — both consoles support
  registering multiple domains at once, so the Netlify domain doesn't need to be
  removed.
- **Backend**: Supabase (Postgres + Auth + Edge Functions), project id
  `tmssupuskkajahpuswcj`. The publishable/anon key is intentionally hardcoded in
  many pages (`sb_publishable_...`) — this is safe by design, security is enforced
  via RLS policies, not by hiding the key. Do not treat it as a secret.
- **`.github/workflows/keep-supabase-alive.yml`**: a cron (every 3 days) that pings
  the Supabase REST API so the free-tier project doesn't auto-pause after 7 days of
  inactivity (relevant during school breaks).
- **File/Drive-backed features use Google Apps Script instead of Supabase.**
  Several pages (`collect.html`, `link-hub.html`, the weekplan integration) call a
  Google Apps Script Web App URL (`const SCRIPT_URL =
  'https://script.google.com/macros/s/.../exec'`) rather than Supabase, because they
  need to write into Google Drive folders or existing Google Sheets. Supabase is
  used for structured/relational data (accounts, tasks, chat, settings); Apps
  Script is used specifically where the source of truth is a Sheet or Drive files.
  See `collect-setup.md` for how to (re)deploy that Apps Script web app — the
  deployment URL changes if you deploy fresh instead of pushing a new version to
  the existing deployment. (`room-request-setup.md` documents a similar Apps
  Script intake-form approach for classroom bookings that was never actually built
  as an `.html` page — it's superseded by the Supabase-backed `room-booking.html`
  below and can be treated as stale/unused; the `room-request.html` filename it
  references doesn't exist in this repo.)
- One-time external API setup is documented in `AUTH-SETUP.md` (Google OAuth client
  for login), `GCAL-SETUP.md` (Google Calendar API key for `date.html`), and
  `KAKAO-MAP-SETUP.md` (Kakao Maps JavaScript key for `food-map.html`) — read
  these before touching login, calendar-embed, or food-map code.
- **`_headers` forces revalidation on the shared scripts** (`nav.js`, `auth.js`,
  `site-login-badge.js`, `cal-shared.js`) via `Cache-Control: no-cache` — Netlify
  auto-applies a plain-text `_headers` file at the publish root, no build step or
  config needed. `nav.js` in particular gets edited very often (nearly every nav/
  menu/tile feature in this file touches it) and every `<script src="./nav.js"
  defer>` tag across every page references it with no version query string —
  without this, a browser that already had `nav.js` cached could keep running an
  old copy indefinitely, surviving any number of new Netlify deploys, with no
  visible error. `no-cache` here does **not** mean "never cache" — it means
  "cache it, but always ask the server to confirm it's still current first" (a
  conditional `If-None-Match` request, answered with a fast `304` when
  unchanged), so this costs nothing in the common case while guaranteeing every
  visitor picks up a script change on their next page load instead of whenever
  their browser's cache happens to expire. Worth adding an entry here for any
  future shared script in the same category as `nav.js`.
- **Netlify's "Pretty URLs" post-processing setting rewrites every internal
  `./이름.html` link in the deployed HTML to an extension-less absolute path**
  (e.g. `./calendar.html` → `/calendar`) — this is a Netlify **dashboard**
  setting (Site configuration → Build & deploy → Post processing → Asset
  optimization → "Pretty URLs"), invisible from this repo (`netlify.toml` has no
  `[build.processing]` section, so grepping the repo for it finds nothing) and
  was evidently on from very early in this project's life. **This actually
  mattered to app code, not just cosmetics**: `nav.js` compares `href`s it reads
  back off the live DOM (`el.getAttribute('href')`, `window.location.pathname`)
  against the literal `./이름.html` strings in `DEFAULT_NAV_ITEMS` — on the
  deployed site those two sides were never byte-equal, so every such comparison
  silently failed. See the `pageKeyOf()` incident below for what this broke and
  how it was fixed.

## `collect.html` (제출함) is password-based by design, with one login-based shortcut

`collect.html` is teacher-only (no 학생/선생님 role picker — that was removed;
every submission is treated as a teacher submission, `type = '선생님'`, unless the
box is in "사용자 지정" target mode, see below) and never requires Supabase Auth
login — submitters authenticate with a name+password pair they set at submit time,
and managers authenticate with a separate manager name+password set when the box
was created. All of the actual CRUD (`create_collection`, `manager_auth`,
`update_collection`, `delete_collection`, `submit_files`, `submitter_auth`) is
Postgres RPCs (`SECURITY DEFINER`) that hash-check the password server-side — the
client never sees a password hash, and `verify_manager()` is the one shared helper
all the manager-side RPCs call. (The `학생` branches of `submitter_key_of()` and
the `student_id` column are kept, unused going forward, purely for backward
compatibility with submissions made before this teacher-only change.)

### Two submission target modes: 자유 입력 vs 사용자 지정

`collections.target_mode` (`'free'` default, or `'custom'`) plus
`collections.target_names` (`jsonb` array, only populated for `'custom'`) let a
box creator optionally pin down exactly who/what can submit, instead of anyone
typing any name. Set once at creation time (`#cTargetMode`/`#cTargetNames` on the
create form, parsed/deduped client-side by `parseTargetNames()`) — not editable
afterward via 폼 편집. In `'custom'` mode, the target names don't have to be
people at all — the motivating case is collecting **by subject** (e.g. "공통국어1,
공통수학1") rather than by person, so multiple teachers' submissions for the same
subject are tracked as one target. When `targetMode === 'custom'`:
- The submit form and "내 기록 확인" form (`applyTargetModeUi()`) swap their free
  `#sName`/`#mcName` text input for a `<select>` (`#sTargetSelect`/
  `#mcTargetSelect`) populated from `targetNames` — submitters pick, they don't
  type, so there's no way to typo a target name and split it into two "different"
  submitters.
- `currentSubmitFields()`/`currentCheckMineFields()` send `type: '과목'` and the
  selected option's value as `name` (still + a self-chosen password, exactly like
  the free-input path, so the same person/target can come back and check/resubmit).
  `submitter_key_of()` has a `'과목' → '과목|' || name` branch alongside its
  pre-existing `학생`/else(선생님) branches.
- `submit_files` rejects the request server-side (`ok: false`) if the submitted
  name isn't literally in the collection's `target_names` (jsonb `?` containment
  check) — the dropdown already prevents this from the UI, but the RPC enforces it
  regardless of caller.
- The manager dashboard's stat row gains two extra tiles (대상/미제출, hidden in
  free mode) and the 제출 목록 tab gains a `#targetStatusArea` chip list showing
  every target name with a ✓ 완료/미제출 badge (`renderTargetStatus()`) — this is
  the "제출 여부 확인은 과목명으로" requirement: status is checked per target name,
  not per person, since several different people could submit under the same
  subject target.

### Picking `custom` target names by 개인별/그룹별 instead of typing them

`#cTargetNames` is still a plain comma-separated text input (`parseTargetNames()`/
the underlying `target_names` storage format didn't change), but typing every name
by hand doesn't scale once a box targets a whole department or grade. Two
"👤 선생님 이름으로 추가"/"👥 그룹으로 추가" toggle links next to the field open a
picker (`#cTargetIndividualWrap`/`#cTargetGroupWrap`) — a plain teacher-name
checklist, or the same department/subject/homeroom-grade/custom-group tag list
`my-page.html`'s task-assignment picker already builds (`cTargetProfileTagsOf()`
is a copy-pasted port of that page's `profileTagsOf()`) — and an "추가" button that
**appends** the checked names into `#cTargetNames` (dedup via `appendCTargetNames()`,
which reuses `parseTargetNames()` to read what's already there first) rather than
replacing it. This is purely a typing shortcut layered on the exact same free-text
field: typing a subject name that isn't a real teacher (the collect-by-subject case
above) still works exactly as before, since the picker only ever adds comma-
separated text, never switches the field to a different input type. `public_profiles`
is queried lazily (`loadCTargetProfiles()`, once) the first time either picker is
opened — collect.html normally has no reason to load the teacher list at all, since
box creation never requires being logged in.

### Linking a new task assignment's file-submission box directly to its assignees

`my-page.html`'s task-assignment form creates the box (`#assignNewCollectionForm` →
`btnAssignNcCreate` → the same `create_collection` RPC) *before* this change always
left it in `target_mode: 'free'` — even though the task's assignees (checked in
"배정 대상") were already known and about to become that same box's only intended
submitters. Free mode meant a submitter had to type their own name exactly right
for `get_file_task_submissions`/`get_my_file_submission_status`'s exact-string
match against `profiles.name` to work (a typo silently produced "no match", not an
error). Now `btnAssignNcCreate` reads `currentAssignTargetNames()` (the profile
names behind whatever's currently checked in 배정 대상) and passes them as
`p_target_names` with `p_target_mode: 'custom'` whenever that list is non-empty —
so the box's own submit form shows a name **dropdown** scoped to exactly those
assignees, eliminating the typo/mismatch risk entirely for boxes created this way.
This only works if 배정 대상 is chosen *before* clicking "제출함 만들기", so the
**배정 대상 field-row was moved above 완료 방식/연결할 제출함 in the form's HTML
order** (previously the reverse) to make that the natural top-to-bottom fill order;
`#assignNcTargetHint` (a small hint line inside the new-collection sub-form,
updated on every checkbox change via a delegated `.assignTargetChk` change listener
plus explicit calls after the 그룹별/직접 지정 apply buttons, since programmatic
`checked = true` doesn't fire `change`) shows the teacher exactly which names will
become the box's target list, or warns that it'll be free-input if none are picked
yet. If 배정 대상 is left empty at creation time, behavior is unchanged (falls back
to `'free'`) — this is additive, not a requirement.

### Per-collection shareable link

Every collection list item (`renderListHtml`) has a "🔗 링크 복사" button
(`.btnCopyItemLink`, delegated click handler) that copies
`collect.html?id=<id>` to the clipboard — the same URL the "제출"/"수정" links
already point to, and the same one shown right after creating a box
(`#createdLink`/`#btnCopyLink`). Opening that link directly lands on the public
detail view with a "자료 제출" button leading straight to the name(or 대상
선택)+password submit form — no separate share/invite flow needed, since the
link alone is already sufficient for a submitter to authenticate and submit.

`collections.owner_id` (nullable `uuid → auth.users`) lets `verify_manager()` also
pass when the **currently logged-in Supabase Auth account** matches the box's
creator, regardless of what name/password was passed in — set at creation time
from `sb.auth.getSession()` if the creator happened to be logged in (`collect.html`
still doesn't gate anything on login; it just opportunistically records who created
the box when it can). Clicking "담당자이신가요?" first tries `manager_auth` with
blank credentials (`onShowManageClicked`) — if the logged-in account owns the box,
this succeeds via the `owner_id` bypass and skips the password screen entirely;
otherwise it falls back to the normal password form.

**This bypass now also extends to Google Drive-touching actions** (템플릿 파일
추가/삭제, 개별 제출파일·전체 zip 다운로드, 제출함 폴더 자체 삭제) — these go through
the separate Apps Script (`driveApi`/`SCRIPT_URL`), which authenticates to Supabase
with the project's **anon/publishable key** (not a secret — see "Backend" above)
to re-check the same `verify_manager()` RPC via `callSupabaseRpc()`. This used to be
a hard limitation: an anon-key call carries no user JWT, so `auth.uid()` was always
`null` in that context and the `owner_id` bypass branch inside `verify_manager()`
could never match — only a real manager name+password worked for those. Fixed by
threading the logged-in user's own `session.access_token` through: every
`driveApi({...})` call from `collect.html` now also sends `accessToken:
mySession ? mySession.access_token : null`, and `callSupabaseRpc(fnName, params,
accessToken)` uses that token as the RPC call's `Authorization` bearer instead of
the anon key whenever one is given (falling back to the anon key otherwise, so
nothing breaks for submitters/managers with no session). PostgREST then resolves
`auth.uid()` from that token exactly as it would for a direct `sb.rpc()` call made
from the browser, so `verify_manager()`'s existing owner_id branch passes without
any new RPC or any change to `verify_manager()` itself — `verifyManager()` and
`resolveFolderIdForManager()` (Apps Script) just gained an optional trailing
`accessToken` param that's passed straight through to `callSupabaseRpc()`.
`collect.html`'s `applyOwnerBypassUiRestrictions()` no longer hides "이 제출함
삭제", the zip-download buttons, or the 양식 파일 add/remove controls under owner
bypass — it only toggles the informational banner now (`btnExitOwnerBypass` still
lets someone switch to password mode if they want to verify as a different
manager). `update_collection`/`delete_collection` (제목/설명/마감일 수정, 제출함
메타데이터 삭제) were never affected by this limitation in the first place — those
go straight through `sb.rpc(...)` on the Supabase JS client, which already attaches
the logged-in session's JWT automatically, so `auth.uid()` always resolved correctly
there even before this fix.

The manager dashboard's toolbar also has a "📁 폴더 열기" button (`#btnOpenFolder`)
that just opens `https://drive.google.com/drive/folders/<folderId>` in a new tab —
unlike the Drive-touching actions above, this doesn't call the Apps Script at all
(it's a plain navigation link, not a write), so it stays visible under owner
bypass too and isn't in `applyOwnerBypassUiRestrictions()`'s hide-list. `folderId`
comes from `collections.folder_id` (already written at creation time by
`apiCreate`), which `manager_auth()` didn't used to return — it was added to that
RPC's `jsonb_build_object('collection', ...)` output specifically to power this
button; the button hides itself when `folderId` is null (a collection somehow
created without a Drive folder). `actionCreateFolder` also calls
`folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)` on
the newly-created folder itself, not just on the individual files
`saveFilesToFolder` saves into it — without this, "폴더 열기" opened a Drive
"액세스 권한이 필요합니다" screen even though the files inside were already
link-shareable, since folder-level and file-level sharing are independent in
Drive. This only affects folders created after this fix; older collections'
folders would need the same `setSharing` call run against them once by hand
(or a one-off migration script) to pick it up retroactively.

### Master password — one admin-set password that opens any collection

`collect.html`'s manager-login card always had a hint saying "관리자 비밀번호를
알고 계시면, 이름은 아무거나 입력하고 그 비밀번호로 들어올 수 있어요" (if you know
the admin password, you can enter any name and use it to get in), but no such
backend logic ever existed — `verify_manager()` only ever checked the owner-id
bypass or an exact per-collection name+password match; the hint described a
feature that was never actually wired up. It's now real. `collect_settings`
(single row, `id = 'site'`, holding `master_password_hash`/`master_password_salt`)
is **deliberately not `app_settings`** even though this is exactly the kind of
site-wide setting that pattern covers — `app_settings` has an `anyone can select`
RLS policy (needed so every page can read its non-secret columns like
`collapse_defaults`), which would make a password hash stored there
world-readable to any anonymous visitor. `collect_settings` instead has RLS
enabled with **no select policy at all, for any role** — nobody, not even an
admin, can `select` it directly from the client; the only access is through three
`SECURITY DEFINER` RPCs, all internally gated by `current_user_is_admin()`:
`set_collect_master_password(p_password)` (validates 4+ chars, hashes with a
fresh salt exactly like `create_collection` hashes a manager password),
`clear_collect_master_password()`, and `collect_master_password_is_set()` (a
boolean status check that never returns the hash itself — used to render "✅
켜져 있어요" / "⬜ 설정되지 않았어요" without exposing anything).
`verify_manager()` gained a third `or exists(...)` branch alongside the existing
owner-id and per-collection-password checks: it hashes the submitted password
against `collect_settings.master_password_hash` **without checking
`manager_name` at all**, matching the hint text's "이름은 아무거나" promise. Because
this lives inside `verify_manager()` itself (not a separate client-side bypass
flag like `isOwnerBypass`), it applies everywhere that function is consulted —
including the Apps Script's Drive-touching actions (delete, zip download, 양식
파일 변경), which re-call `verify_manager()` with the same manager_name+password
the client sent. This is the opposite of the owner-id bypass's limitation (see
above): a master-password login is a real password credential as far as every
check is concerned, so it is never restricted the way `isOwnerBypass` restricts
UI — `isOwnerBypass` stays `false` for a master-password login, and every button
(삭제, 다운로드, 양식 파일 변경) shows normally.

The admin-only management UI lives on `collect.html`'s **list view** (not any
one collection's detail view, since this is a site-wide setting) — a
"🔑 마스터 비밀번호 관리" toggle link (`#btnShowMasterPw`) stays `display:none`
for everyone until `initMasterPasswordUi()` asynchronously confirms
`mySession` exists and `profiles.is_admin` is true (same "reveal only after an
async admin check resolves" pattern as `nav.js`'s admin-only search results),
so a non-admin or logged-out visitor never even sees the link exists. The
revealed card (`#masterPwCard`) has a password input + 저장/마스터 비밀번호 끄기,
calling the three RPCs above; 끄기 asks `confirm()` first since it immediately
revokes that password's access everywhere.

### 제출 파일 이름 규칙 (`collections.file_name_template`)

Submitted files used to always land in Drive named with a hardcoded
`[제출자이름] 원본파일명` prefix (`namePrefix: '[' + p.name + '] '` passed to the
Apps Script's `uploadFiles` action). A box's manager can now set this format
themselves: `collections.file_name_template` (`text`, default
`'[{name}] {original}'` — matches the old hardcoded behavior exactly, so every
existing row keeps working unchanged) holds a template string with placeholders
`{name}` (submitter/target name), `{original}` (original filename incl.
extension), `{ext}` (extension incl. the dot), `{seq}` (this submission's
file index, 1-based — useful for a person uploading several files at once),
`{date}` (submission date, `YYYYMMDD`).

Both the create form (`#cFileNamePreset`/`#cFileNameCustom`) and the manager
dashboard's 폼 편집 tab (`#eFileNamePreset`/`#eFileNameCustom`) show the same
`<select>` of 3 presets (`[{name}] {original}`, `{name}_{original}`,
`{name}-{seq}{ext}`) plus a "직접 입력" option that reveals a free-text template
input — matching the user's explicit request for "몇 가지 프리셋 중 선택 + 직접
지정도 가능하게". `readFileNameTemplateForm(prefix)`/`setFileNameTemplateForm(prefix,
template)` are the shared helpers that read the select+custom-input pair into a
single template string, and reverse-populate them from an existing template
(matching a known preset selects that option; anything else falls back to
"직접 입력" with the raw string shown). Editing an existing box's rule only
affects files submitted from then on — already-saved files keep whatever name
they were given at submit time, since Drive files aren't renamed retroactively.

Critically, **this needed no Apps Script changes at all**. `applyFileNameTemplate()`
now builds the complete final filename entirely client-side in `collect.html`
before calling `driveApi({action:'uploadFiles', ...})`, and no longer passes a
`namePrefix` for submissions — the Apps Script's existing `saveFilesToFolder(folder,
files, namePrefix)` already falls back to using `f.name` as-is whenever
`namePrefix` is omitted, so sending fully-templated names in `files[].name`
works against the already-deployed script unchanged. (Template files still use
the old hardcoded `namePrefix: '[양식] '` path — this feature only applies to
submitter uploads.) If `applyFileNameTemplate()`'s result is empty (e.g. a
custom template with no placeholders that evaluates to nothing after trimming),
it falls back to the original filename rather than saving a blank/garbage name.

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

**Incident: `weekplan.html`/`my-page.html`'s 주간계획 card could render completely
blank with no error, no loading text, nothing — looking fully broken even when
everything was actually working.** Both pages' `loadWeekPlan()` cache logic
(`weekplan_cache` table, 15-minute TTL) only ever showed the Supabase-cached file
list when it was still *fresh* (within the TTL) — it fetched that cache first, but
if the cache had gone stale, the code discarded it to a `staleFiles` variable and
sat there showing nothing at all while it `await`ed a fresh `listWeekPlanFiles`
call, only falling back to `staleFiles` in the `catch` block if that fresh call
*failed*. Since Apps Script cold-starts are already documented as "느릴 때가
많음" above, and the top (most recently edited) file's AI summary gets regenerated
synchronously whenever its `modifiedTime` changes (i.e., almost every time a
teacher is actively editing the current week's plan — exactly when someone would
be checking this card), a `listWeekPlanFiles` call can easily take many seconds to
tens of seconds. For that whole window, with a stale-but-perfectly-good cached
list sitting right there unused, the page just showed nothing — no "불러오는
중" indicator existed anywhere, so this looked identical to "broken" rather than
"loading." **Fixed** in both `loadWeekPlan()` copies: a stale cache is now
rendered immediately (with a small "최신 정보를 확인하고 있어요…" notice in
`#wpMsg`) before the fresh Apps Script call even starts, and that notice is simply
cleared (not replaced with an error) if the background refresh later fails — the
already-shown stale content is never pulled out from under the viewer. When there
is no cache at all yet (first-ever load), a "불러오는 중이에요…" message now
shows instead of a silent blank wait. Verified via Playwright with a mocked slow/
failing Apps Script route: cached content appears before the network call
resolves, survives a failed refresh unchanged, and is silently swapped for fresh
data on success.

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

**`ks_summarizeWithGemini_`'s prompt was tightened to force real line breaks
between items.** The date-subheading + `"  · "`-prefixed detail-line format was
already specified, but the prompt didn't explicitly forbid the model from
running several items together on one line (comma/period-joined) instead of
one per line — since both `my-page.html`'s and `weekplan.html`'s
`.wp-summary-body` already render with `white-space:pre-wrap` (so line breaks
in the text display correctly whenever the model actually produces them), the
fix is prompt-only: it now explicitly says never to join items with commas/
periods, one item per line only, and a blank line between date (or `[공통]`)
groups for visual separation.

**Incident: even after that prompt tightening, teachers kept reporting the line
breaks worked for some weekplan documents but not others ("줄바꿈 됐었다가 어떨
땐 또 안 됨").** Two compounding causes, both fixed together: (1) a prose-only
instruction like "never join items with commas" doesn't *guarantee* compliance
from the model — some documents' content apparently confused it into joining
items anyway, which is an inherent LLM-output limitation, not a one-time bug;
(2) `ks_getCachedWeekPlanSummary_` caches the summary per `fileId+modifiedTime`
in script properties, so whichever result the model happened to produce the
*first* time a given document version was summarized — well-formatted or
comma-joined — is what gets served back forever for that unchanged document,
with no retry ever happening. **Fixed** `ks_summarizeWithGemini_` three ways:
it now includes a concrete few-shot example of the exact desired output shape
(a full worked example, not just prose rules — this is normally the single
most effective lever for format compliance), sets `generationConfig:
{temperature: 0.2}` on the Gemini call (lower temperature favors consistent
formatting over creative variation), and — if the result still looks
comma-joined (a heuristic: any line longer than 140 chars, since a real
`"  · "`-prefixed single item is normally much shorter) — retries once with an
extra, more forceful corrective instruction appended, using whatever that
retry returns even if it's still imperfect (a slightly-malformed but non-empty
summary beats permanently showing nothing). None of this guarantees 100%
compliance on every call (still an LLM, still probabilistic), but it's far more
consistent than prose instructions alone. The cache key version was also
bumped `wpSummary_v2_...` → `wpSummary_v3_...` specifically so every
already-cached (and potentially still comma-joined, from before this fix)
summary gets regenerated under the new prompt on next access, rather than the
old inconsistent result continuing to be served forever for a document whose
content never changes again.

**This edit lives only in `collect-setup.md` — it has not been pushed to the
live Apps Script deployment**, since that requires the manual
script.google.com 배포 관리 → 새 버전 flow documented in this file's install
instructions, which no tool in this environment can drive (no Apps Script API
access here). Paste the updated `ks_summarizeWithGemini_` (and the
`wpSummary_v3_` cache-key change in `ks_getCachedWeekPlanSummary_`) from
`collect-setup.md` into the existing script project and redeploy a new version
to actually see the fix take effect. (The user later confirmed via a screenshot
of their actual Apps Script editor that this code — including the `wpSummary_v3_`
cache key — is already present there, so this particular caveat no longer
applies to their deployment; it's left here as a reminder for whoever next
edits this script from a fresh checkout of this repo, since `collect-setup.md`
itself has no way to know what's actually live.)

**두 번째, 진짜 원인: 바로가기로 새 문서를 등록했는데 "최신 문서"로 안 올라오는
버그 — `actionListWeekPlanFiles`가 바로가기 자체가 아니라 대상 문서의 수정
시각만으로 정렬하고 있었다.** 선생님이 이미 예전에 만들어둔(최근에 고친 적
없는) 문서를 이번에 '주간계획' 폴더에 바로가기로 막 추가해도, 그 문서 자체의
`modifiedTime`은 여전히 예전 값이라 폴더 안 다른 기존 항목들보다 정렬 순서가
뒤로 밀렸다 — "방금 등록했는데 예전 주간계획이 계속 맨 위로 나온다"는 증상이
정확히 이 버그와 일치한다. **고쳐서** 바로가기를 리졸브할 때 바로가기 자체의
수정 시각(`f.getLastUpdated()` — 폴더에 막 추가된 시점과 거의 같음)과 대상
문서의 수정 시각 중 **더 최근 쪽**을 `modifiedTime`으로 쓰도록 했다 — 막
추가한 바로가기는 대상 문서가 아무리 오래됐어도 바로 최신으로 올라오고, 이미
등록된 바로가기의 대상 문서를 나중에 실제로 고치면 그때도 여전히 최신으로
올라온다(둘 다 보장). 이 수정도 위와 마찬가지로 `collect-setup.md`에만
반영돼 있고, 실제 배포에 적용하려면 같은 수동 재배포 단계가 필요하다.

**거기에 더해, 선생님이 방금 바로가기를 추가한 직후 바로 확인하고 싶을 때를
위한 "↻ 새로고침" 버튼을 추가했다.** 위 정렬 버그를 고쳐도, `my-page.html`/
`weekplan.html` 둘 다 `weekplan_cache`(Supabase, 15분 TTL)로 결과를 캐시해서
재배포 직후에도 캐시가 안 지나면 최대 15분을 기다려야 했다 — `loadWeekPlan()`에
`forceRefresh` 매개변수를 추가해서, 이 플래그가 `true`면 캐시가 아직 fresh해도
건너뛰고 바로 Apps Script를 다시 부른다. `my-page.html`의 "이번주 주간계획 AI
요약" 블록 헤드(`btnWpRefresh`, 접기/펼치기 버튼 옆)와 `weekplan.html`의
`#mainView` 상단(`.wp-refresh-row`, 위젯 모드에서도 숨겨지지 않음 — `#wpMsg`와
같이 `body.widget-mode`에 안 가려지는 영역에 둬서, iframe 위젯으로 열렸을 때도
새로고침할 수 있게 함) 양쪽에 같은 버튼을 달았다. 클릭하는 동안 버튼이
비활성화되고 "↻ 불러오는 중…"으로 라벨이 바뀌었다가 끝나면 원래대로 돌아온다.
`test_weekplan_refresh.js`/`test_mypage_weekplan_refresh.js`로 (1) fresh한
캐시가 있으면 로드 시 Apps Script를 안 부르는지, (2) 새로고침 버튼을 누르면
캐시가 fresh해도 강제로 다시 부르는지, (3) 그 결과로 화면 내용이 실제로
갱신되는지 — 두 페이지 모두 검증했다.

**요약이 짤리던 문제("A": 전체 텍스트)를 고치고, 날짜별/부서별 표로 바꿔 볼 수 있는
작은 탭을 추가했다("B"/"C").** 사용자가 스크린샷(원시 `"부서 | ▪ item ▪ item..."`
형태의 테이블 덤프 — AI 호출이 아니라 아래 폴백 경로를 타고 있었다는 신호)과 함께
"요약이니까 짤리지 않고 끝까지 나오는게 좋겠다"고 요청했다. 근본 원인은
`collect-setup.md`에 두 군데 있던 하드코딩된 절삭이었다 — (1) AI 요약 자체
(`ks_summarizeWithGemini_`, 아래에서 `ks_summarizeWeekPlan_`로 바뀜)가 900자에서
잘렸고, (2) AI 호출이 실패했을 때의 구조 추출 폴백(`ks_extractWeekPlanSummary_`)은
항목을 10개까지만 쓰고 그마저도 500자에서 다시 잘랐다. **고쳐서** 둘 다 절삭을
없앴다 — AI 요약은 이제 `baseInstruction`이 이미 지시하는 "8~12개 항목" 제한에만
맡기고, 폴백 경로는 항목 수 제한(10개)을 없앤 뒤 `ks_extractDocOutline_`/
`ks_extractSlidesOutline_`의 안전장치 상한도 14개 → 60개로 넉넉하게 올렸다(완전히
없애지는 않음 — 아주 긴 문서에서 Apps Script 실행 시간이 과도해지는 걸 막는
최소한의 안전망).

AI 요약 텍스트는 이미 "날짜(또는 `[공통]`) 소제목 줄 + `'  · 카테고리: 내용'`"
형식으로 구조화돼 있어서(`ks_summarizeWeekPlan_`의 few-shot 프롬프트), **그 텍스트를
클라이언트에서 다시 파싱하기만 하면 날짜별/부서별 표도 똑같은 데이터로 그릴 수
있다** — Apps Script나 캐시 스키마를 전혀 바꾸지 않고 순수 프론트엔드 변경만으로
끝났다. `my-page.html`/`weekplan.html` 둘 다(copy-paste 관행) `parseWeekPlanOutline
(text)`가 줄 단위로 훑어 `{heading, category, content}` 배열을 만든다 — "  · " 로
시작하는 줄을 찾아 그 직전까지의 소제목(날짜/`[공통]`)을 `heading`으로, `"카테고리:
내용"` 패턴이 있으면 분리해 `category`/`content`로 쓰고 없으면 `category: '기타'`로
둔다. 형식이 전혀 안 맞는 텍스트(예전 캐시, 구조 추출 폴백 결과 등 — "  · " 줄이
하나도 없는 경우)는 `null`을 돌려줘서 그 경우엔 탭 없이 기존 줄글만 보여준다 —
파싱 성공 여부로 탭 노출을 결정하므로 별도의 "이 요약은 구조화됐는지" 플래그가
필요 없다. 탭은 세 개: "줄글"(기본, 원문 그대로) / "날짜별 표"(`heading`으로
그룹핑) / "부서별 표"(`category`로 그룹핑) — `wpSummaryTableHtml(items, by)`가
그룹별로 `<tr class="wp-summary-table-head">` 헤더 행 + 각 항목의 나머지 축
(날짜별 표라면 카테고리, 부서별 표라면 날짜)을 `.wp-summary-table-tag` 칼럼에 보여주는
행들을 만든다. 탭 전환은 이미 받아둔 텍스트를 다시 그릴 뿐이라 Apps Script를 다시
부르지 않는다 — `document`에 델리게이트한 클릭 핸들러 하나(`.wp-summary-tab-btn`)가
`#wpSummaryBody`의 내용만 교체한다. `test_mypage_weekplan_tabs.js`/
`test_weekplan_tabs.js`로 (1) 구조화된 요약에서 전체 텍스트가 안 잘리고 다 보이는지,
(2) 탭 3개가 보이는지, (3) 날짜별/부서별 표로 전환하면 각 그룹 헤더가 올바르게
나오는지, (4) 줄글로 되돌리면 원문이 그대로 돌아오는지, (5) 형식이 안 맞는 텍스트는
탭 없이 줄글만 보이는지 — 두 페이지 모두 검증했다.

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

`login.html`'s 이름+비밀번호 로그인 tab has an "아이디 저장" checkbox — it only
remembers the typed **name** (`localStorage['ks_login_remember_name']`, prefilled
into `#liName` and the checkbox pre-checked on next visit), not the password and
not the session itself. This is unrelated to whether the login *persists* across
browser restarts — Supabase's client is created with library defaults everywhere
in this repo (no page sets `persistSession`/`storage`), so a signed-in session is
already always kept in `localStorage` and silently restored on next visit
regardless of this checkbox. "아이디 저장" is purely a typing-convenience checkbox
for the name field, saved/cleared right after a successful `signInWithPassword`
call based on the checkbox's checked state at that moment.

**로그인 성공 후엔 무조건 나의 페이지/대시보드로 보내는 대신, 로그인 전에 보고
있던 페이지로 돌아간다.** `login.html`은 로그인 성공 시(이름+비밀번호, 구글 로그인
둘 다 같은 `refresh()`로 끝남) 항상 `profile.ui_prefs.landing_page`에 따른
랜딩 페이지(`my-page.html`/`my-custom-page.html`)로 보냈는데, 사용자가 다른
페이지를 보다가 로그인만 하러 간 경우에도 매번 랜딩 페이지로 떨어지는 게
불편하다는 요청으로 바뀌었다. 돌아갈 페이지는 두 경로로 전달된다:
- **`site-login-badge.js`**(교사용 주요 페이지 대부분에 로드되는 공용 코너
  배지)의 "로그인" 링크가 `./login.html?return=<현재 pathname+search를
  encodeURIComponent한 값>`을 실어 보낸다 — 가장 흔한 진입 경로.
- 그 외 여러 페이지의 로그인/승인 게이트 뷰에 흩어진, 파라미터 없는 순수
  `<a href="./login.html">로그인하러 가기</a>` 링크나 북마크로 바로 연 경우처럼
  `?return=`이 없는 경로는 `login.html`이 `document.referrer`를 대신 읽어서
  같은 로직으로 처리한다(동일 오리진일 때만) — 23개 안팎의 그 정적 게이트
  링크들은 코드를 한 줄도 안 건드려도 이 fallback 하나로 전부 커버된다.

`login.html`의 `safeReturnTo(raw)` 헬퍼가 두 경로 모두를 검증한다: `//`로
시작하거나 `^https?:\/\//i`에 걸리는(다른 사이트로 열리는) 값은 **오픈
리다이렉트 방지**로 거부하고, `/` 또는 `./`로 시작하지 않는 값도 거부하고,
`login.html` 자신을 가리키는 값도 **로그인 루프 방지**로 거부한다 — 셋 중
하나라도 걸리면 `null`을 돌려줘서 기존처럼 랜딩 페이지로 떨어진다. 구글
로그인은 `signInWithOAuth({..., redirectTo: location.href})`를 쓴다.
`test_login_return_to.js`로 (1) 배지
링크가 실제로 `?return=`을 실어 보내는지, (2) `?return=`을 들고 로그인하면
그 페이지(쿼리스트링 포함)로 정확히 돌아가는지, (3) `?return=` 없이
referrer만으로 도착해도 그 페이지로 돌아가는지, (4) 둘 다 없으면 기존처럼
랜딩 페이지로 가는지(회귀 없음), (5) `?return=`에 외부 URL을 넣으면 무시되고
랜딩 페이지로 가는지(오픈 리다이렉트 방지) — 다섯 가지를 모두 검증했다.

**Incident: "구글로 로그인"을 쓰면 어느 페이지에서 들어갔든 항상 나의 페이지/
대시보드로 떨어지는 버그 — referrer로만 알아낸 returnTo가 OAuth 왕복에서
증발했다.** 사용자가 "어느 페이지에서든 로그인했을 때 보고 있던 페이지를
보여주게 해줘. 지금까지는 나의 페이지나 대시보드가 나오게 했다"고 다시
요청해서 코드를 다시 읽었다 — 이 기능은 이미 구현/테스트까지 돼 있었는데도
실제로는 절반만 동작했던 것. `./login.html?return=...`로(배지 링크) 들어온
경우는 `location.href` 자체에 `?return=`이 이미 있으니 OAuth
`redirectTo: location.href`로도 그대로 유지되지만, **파라미터 없는 순수
`<a href="./login.html">`(이 저장소 11개 페이지가 쓰는 게이트 링크)로 들어와
`document.referrer`로만 `returnTo`를 알아낸 경우는 그 값이 JS 변수에만 있고
URL(`location.href`)에는 전혀 반영되지 않았다** — 구글 로그인 버튼을 누르는
순간 `redirectTo: location.href`에는 애초에 `?return=`이 없었으므로 그대로
증발했고, 구글 화면을 한 번 거쳐 login.html이 완전히 새로 로드될 때는
`document.referrer`도 이미 구글 쪽 주소로 바뀌어 있어 다시 알아낼 방법이
없었다 — 결국 항상 랜딩 페이지로 떨어졌다. 이름+비밀번호 로그인은 페이지
재로드 없이 같은 스크립트 컨텍스트 안에서 바로 `refresh()`를 호출하므로 이
문제가 전혀 없었고, 그래서 기존 테스트 5개(이름+비밀번호 로그인만 검증)는
전부 통과한 채로 이 버그가 숨어 있었다. **고쳐서** `returnTo`를 계산한
직후, 그 값이 `?return=` 파라미터에서 온 게 아니라면(=referrer로 알아낸
경우) `history.replaceState`로 지금 URL 자체에 `?return=`을 바로 박아
넣는다 — 그 뒤로는 구글 로그인을 포함해 `location.href`를 읽는 모든 경로가
항상 같은 값을 보게 된다. `test_login_return_to.js`에 [6]을 추가해, 진짜
구글 화면으로 이동하지 않고도 `signInWithOAuth`를 가로채는 가짜 supabase
클라이언트로 (6a) 로드 직후 URL에 `?return=`이 실제로 심어지는지, (6b)
"구글로 로그인" 클릭 시 `redirectTo`에도 그 값이 그대로 실려 있는지를
검증했다.

## Name collisions at signup ("계정 연결 요청") — not treated as 동명이인 duplicates

Both `self-register` (login.html's signup form) and `bulk-register-users`
(member-admin.html's bulk-paste/add-one-member forms) derive a synthetic auth
email deterministically from the trimmed name (`nameToEmail()`, base64-encoded),
so a second signup attempt under a literal name that's already registered always
fails at `admin.auth.admin.createUser()` with an "already exists" error — a real
Supabase Auth email-uniqueness collision, not application logic. In practice this
almost never means a genuine 동명이인 (two different real teachers sharing a
name) — it means the same teacher trying to register again (forgot they already
have an account, forgot their password, etc.) — so instead of a dead-end "이미
등록된 이름이에요" error with nothing else to do, both functions now look up the
existing `profiles` row by that name and write a row to `account_link_requests`
(`name`, `existing_profile_id`, `status` — a partial unique index on
`(name) where status = 'pending'` means a repeat attempt just bumps
`requested_at` on the existing pending row instead of piling up duplicates).
`self-register` returns `{ok:false, linkRequested:true, error:...}` telling the
teacher an admin has been notified; `login.html` shows this as a `success`-styled
message (not `error`) since it's a "request sent" outcome, not a stuck failure.

**This is deliberately admin-mediated, not automatic** — auto-linking a new
password to an existing account based on name alone would let anyone who knows a
teacher's name take over their account. `member-admin.html` has a "계정 연결
요청" card (hidden entirely when there are no pending requests) listing each
request with the existing profile's department/subject/homeroom for context, and
two actions per row: "본인 확인 후 비밀번호 재설정" (admin has verified the
person's identity out-of-band, then reuses the exact same `reset-member-password`
Edge Function call the per-member "비밀번호 재설정" section already uses — see
above — and marks the request `resolved`) or "무시" (marks it `dismissed`; a
future signup attempt under that name creates a fresh pending request). Both
`account_link_requests` RLS policies gate on `current_user_is_admin()` — only
admins can see or act on these requests, same as `staff`.

**Edge Function gotcha this surfaced**: `self-register` used to return non-200
HTTP status codes (400/409/500) for its `{ok:false,...}` error bodies. This is a
trap with `sb.functions.invoke()` — on any non-2xx response it throws
`FunctionsHttpError` and returns `{data: null, error}`, where `error.message` is
the **hardcoded generic string** `"Edge Function returned a non-2xx status
code"`, not the response body's own `error` text (the parsed JSON only lands in
`error.context`, a raw `Response` object, which nothing in this codebase reads).
Since every caller here follows the `if(error){...} else if(data.ok===false)
{...}` pattern, a non-2xx `ok:false` response was silently showing that generic
string instead of the specific Korean message — `self-register`'s status codes
were normalized to always return `200` (matching `bulk-register-users`, which
already did) so its `ok:false` bodies actually reach `data.error`. Keep this in
mind for any Edge Function invoked via `sb.functions.invoke()`: return `200` and
signal failure purely through the JSON body's `ok` field, never rely on the HTTP
status code being inspected client-side.

### Google-login name collisions get the same admin-mediated treatment, plus a self-service link button

The `self-register`/`bulk-register-users` collision path above only ever applied
to **이름+비밀번호** signup, where `admin.auth.admin.createUser()` can reject a
colliding synthetic email *before* any new auth account exists. "구글로
시작하기"/"구글로 로그인" can't be pre-checked that way — Supabase Auth creates
the user (and `handle_new_user` creates a blank `profiles` row) the moment the
OAuth round-trip finishes, *before* `login.html`'s `completeProfileView` ever
asks for a name. So a teacher who already has a 이름+비밀번호 account could
click "구글로 시작하기", type the exact same name into the 프로필 완성 form, and
(without this fix) silently end up with two separate accounts under one name —
no `createUser` collision to catch it, since the two accounts have completely
different real emails.

**`complete-google-profile` Edge Function** closes that gap: `login.html`'s
`btnCompleteProfile` handler now calls it (`sb.functions.invoke('complete-
google-profile', {body:{name, phone}})`) instead of doing a direct
`profiles.update()`. It checks `select id from profiles where name = :name and
id != auth.uid()` first — if nothing matches, it fills in the profile exactly
like before (name/role/phone/email, plus the same staff-table auto-
approve/department/subject/extension/homeroom prefill `self-register` does).
If something matches, it does **not** touch the caller's own (still-blank)
profile — `completeProfileView` stays showing, since `profile.name` is still
null — and instead reuses the exact same `account_link_requests` row-per-name
mechanism as the password-collision path, now with two new columns:
`request_type` (`'password'` default, or `'google'`) and `new_auth_user_id`
(the uid of the just-created duplicate Google account, so an admin has
something concrete to delete). The existing partial unique index
`account_link_requests_pending_name_idx` is on `name` alone (not
`name+request_type`), so a repeat attempt — password or Google, either
direction — just overwrites the one pending row's `request_type`/
`existing_profile_id`/`new_auth_user_id`/`requested_at` in place, same
"bump, don't duplicate" behavior as before.

**`member-admin.html`'s 계정 연결 요청 card branches on `request_type`.** A
`'google'` row shows a "구글 로그인 중복" badge next to the name and a single
"본인 확인 후 중복 계정 삭제" button instead of the password row's new-password
input + "비밀번호 재설정" button — there is no password to reset here; the
*existing* account is already fine and is never touched. Clicking it reuses
the already-existing `delete-member` Edge Function (admin-only,
`admin.auth.admin.deleteUser(id)`) with `ids: [request.new_auth_user_id]` —
deleting only the just-created duplicate, never the original — then marks the
request `resolved` and shows a result line telling the admin to have the
teacher log back into their *original* account and use "구글 계정
연결하기" there. `delete-member` needed no changes for this reuse; it already
accepted an arbitrary `ids` array.

**Self-service linking (`my-page.html`'s "나의 정보" card)**: a teacher who
already has a working 이름+비밀번호 (or already-Google) account and just wants
to *add* Google as an additional login method — the actual fix for "본인이
나중에 연결하기" rather than ending up in the admin queue at all — gets a
"구글 계정 연결하기" button right under "정보 변경". `renderInfoView()` checks
`session.user.identities.map(i => i.provider)` and only shows the button when
`'google'` isn't already in that list (so it never reappears once linked, and
never shows at all for an account that signed up via Google originally).
Clicking it calls `sb.auth.linkIdentity({provider:'google', options:
{redirectTo: location.href}})` — Supabase's own identity-linking API: it hits
`/auth/v1/user/identities/authorize` with the *current* session's access
token (so GoTrue knows which existing account to attach the new identity to,
rather than creating a separate one) and then browser-redirects through
Google's consent screen and back to `location.href` (my-page.html), at which
point `loadMyInfo()` re-reads `session.user.identities` and the button is
gone. No new table/RPC was needed — `linkIdentity` is a built-in `supabase-js`
method, and "Manual Linking" was already confirmed enabled on this project
(an existing admin account was observed with `providers: ['google','email']`
before this feature was built).

**Why the admin-mediated path still exists at all, given the self-service
button**: the self-service button only works when the teacher is *already
logged into their real account* and chooses to add Google proactively. The
admin path is for the case that actually happens in practice — a teacher
forgets they have an account and clicks "구글로 시작하기" cold, winding up
with a second, blank, duplicate account with no way to get back into their
original one from there (same "no self-service password-reset-by-email"
limitation documented above — these synthetic/Google accounts have no real
recoverable inbox). Deleting the stray duplicate and pointing them at the
self-service button on their *original* account is the two-step fix for that
case; auto-merging the two based on name alone was rejected for the same
reason the password path rejected it — a name alone is not proof of identity.

Tested with Playwright (mocked Supabase Auth/REST/Edge Function responses,
since no real Google OAuth round-trip is reachable from this sandbox):
confirms (1) a colliding Google profile-completion call leaves
`completeProfileView` showing and shows a `success`-styled "관리자에게 계정
연결을 요청했어요" message rather than saving the name, (2) a non-colliding
call completes the profile and redirects to the landing page as before, (3)
`member-admin.html` renders the "구글 로그인 중복" badge + "중복 계정 삭제"
button (no password input) for a `request_type:'google'` row and calls
`delete-member` with exactly `new_auth_user_id`, (4) "구글 계정 연결하기"
shows for a session with no Google identity and calls `linkIdentity` with
`provider=google` against the authorize endpoint, (5) the button stays
hidden once `google` is already among `session.user.identities`.

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

`member-admin.html`'s detail panel also shows a "로그인 기록" line (가입일 · 최근
로그인) per member, sourced from `member-auth-info`'s `listUsers()` call
(`u.created_at`/`u.last_sign_in_at`, both already returned by the GoTrue admin
API — no extra API call or new table needed) alongside the existing Google-link
badge, since that Edge Function already fetches this admin-only data for every
account on every page load.

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
- **Teacher groups (`profiles.groups`, `custom_groups`, `teacher-groups.html`)**:
  `profiles.groups` is still a free-text, comma-separated tag list (e.g.
  `"인성교육위원회, 급식소위원회"`), but it's no longer edited per-teacher by typing
  tags into a text field. `teacher-groups.html` (admin-only — see below) instead
  works at the *group* level: "+ 새 그룹 추가" opens a modal to name a group and
  check members off a full teacher checklist, and saving applies that exact
  membership. Department/subject/homeroom-grade are shown as read-only "자동
  그룹" sections (derived the same way as `autoGroupTagsFor()`/`profileTagsOf()`
  below) and can't be created/edited/deleted here — a custom group name that
  collides with an existing auto-group value is rejected client-side. The actual
  create/rename/membership-diff/delete logic lives in two admin-only (`security
  definer`, `current_user_is_admin()`-gated) RPCs rather than in JS loops over
  individual `profiles` updates: `upsert_custom_group(p_name, p_member_ids,
  p_old_name)` — if `p_old_name` is given and differs from `p_name` it's a
  rename (every current holder of the old tag gets it swapped for the new one
  first), then it upserts the name into the `custom_groups` registry and adds/
  removes the tag on exactly the profiles in `p_member_ids` vs. the tag's
  current holders — and `delete_custom_group(p_name)`, which strips the tag from
  everyone and removes the registry row. `custom_groups` (`name text primary
  key`) exists only so an admin can rename or delete a group that currently has
  zero members (a plain scan of `profiles.groups` alone couldn't find it) —
  the page's actual custom-group *list* is still a union of this registry and
  whatever tags already appear in `profiles.groups` (so any tag set before this
  registry existed, or via `member-admin.html`'s own field below, shows up and
  is manageable immediately, not just ones created through the new modal). The
  old `set_profile_groups(p_target_id, p_groups)` RPC (approved-teacher-writable,
  free-text per-person) was dropped since nothing calls it anymore — this page
  used to be usable by any approved teacher, but the user explicitly reversed
  that decision alongside this redesign, so it's admin-only now (gated like
  `member-admin.html`) and reached only via a `교무 업무 도구` tool-card in
  `admin-tools.html`, not a top-level `nav.js` entry. The page reads the full
  teacher list from `public_profiles` (a plain view, not RLS-scoped — see below).
  `teacher-groups.html` also has an "엑셀로 그룹 일괄 추가" card (`xlsx@0.18.5` from
  jsdelivr, same library/pattern `bulk-register.html` uses) taking just two
  columns — 이름/그룹 — with one row per (name, group) pair, so the same name can
  repeat across several rows to join several groups and the same group name can
  repeat across rows to add several people at once. It reuses
  `upsert_custom_group` exactly like the modal, but since that RPC **replaces**
  a group's full membership with whatever `p_member_ids` it's given, the upload
  handler always unions the *existing* holders of a tag (`customTagsOf`) with the
  newly-matched names before calling it — otherwise every upload would silently
  kick out anyone not listed in that particular file, turning "add" into
  "replace". Names are matched against the already-loaded `teachers` array by
  exact string equality; unmatched names and any group name that collides with
  an auto-group (`autoGroupNameSet()`) are reported back in the result message
  rather than silently dropped or blocked outright.
  `member-admin.html`'s
  detail panel also has a plain `groups` text field (saved via its normal
  admin-only `profiles` update, not an RPC, since that page is already
  admin-gated) — department/subject/homeroom-grade are shown above it as
  read-only "자동" chips (`autoGroupTagsFor(m)`, same derivation as
  `profileTagsOf()` below) rather than something the admin has to type into
  the field themselves; the text input only holds the custom, freely-typed
  tags, and those three auto ones are never written into `profiles.groups`
  itself (they're derived fresh from `department`/`subject`/`homeroom_class`
  every time, so they can't go stale). `my-page.html`'s own "나의 정보" self-edit
  form (`infoEditForm`) also has a `groups` field now — unlike `teacher-groups.html`,
  this one is reachable by any approved teacher for their own row (RLS allows it:
  `profiles_update_self`'s `WITH CHECK` only pins `is_admin`/`approved`/
  `must_change_password`, not `groups`). It keeps the same free-text input
  (`#infoGroups`, saved as-is) but adds a `<select>` (`#infoGroupsSelect`,
  populated from every custom tag already appearing in any profile's `groups` via
  `allProfiles` — the same array the task-assignment picker below already loads)
  with an "추가" button that appends the picked name into the text field rather
  than replacing it, so typing a brand-new tag still works exactly as before —
  the dropdown is purely a typo-avoidance shortcut for joining a group that
  already exists, not a replacement for free text. `my-page.html`'s task-assignment picker (블록 "나에게 배당된 할
  일" → "+ 새로 배정하기" → "그룹별" 탭) unifies department/subject/grade/custom
  `groups` tags into a single flat checkbox list (`profileTagsOf()` builds each
  profile's tag set, `allGroupTags()`/`profileIdsForTag()` derive the list and
  reverse-lookup) rather than the old two-step kind-then-value dropdown pair —
  matching the "개인별" tab's own checkbox-list UI per the user's explicit
  request. Checking one or more tags and clicking "선택한 그룹 적용" just turns on
  the matching people's checkboxes in the "개인별" tab (a union across all
  checked tags); what's actually persisted on submit is still the plain
  per-person `assignee_id` list, same as before. A third "직접 지정" tab does the
  same trick from typed names instead of tags: comma-separated names typed into
  `#assignCustomNames` are matched against `allProfiles` by exact `name` (all
  matches checked, to handle same-name teachers; unmatched names are listed back
  in the result message so a typo is obvious) and, like the other two modes,
  just flips checkboxes in the "개인별" tab rather than being its own storage path.
  The "제출 현황" popup
  (`openSubmissionModal`/`submissionRows`) also shows each assignee's 담임반
  next to their name (via a new `homeroomLabelFor(id)` lookup against
  `allProfiles`) whenever they're a homeroom teacher — this fires for anyone
  with `is_homeroom && homeroom_class` set, not just people added via a
  grade-tag group selection, since `task_assignments` has no per-assignment
  record of *how* someone was added to a task.
  A single `#assignedHideCompleted` checkbox above both sub-lists ("내가 배정한
  업무"/"나에게 온 업무") only filters "나에게 온 업무" — once I complete my own
  assignment I don't need to keep seeing it, so auto-hiding is fine there
  (`renderAssignedToMe` filters on `r.assignment.completed`). It deliberately does
  **not** filter "내가 배정한 업무": the person who assigned the task is the one who
  needs to act once everyone has submitted (처리/확인/채점 등), so a task going
  100% complete is exactly the moment it should stay visible, not disappear —
  `renderAssignedOwned` no longer checks `assignedHideCompleted` at all (it used to,
  via a now-removed `assignedOwnedAllDone` helper, before this split). The checkbox
  label says "(나에게 온 업무만 해당)" so this isn't a surprise.
  State persists in `localStorage` only (`ks_assigned_hide_completed`, not
  `ui_prefs` — this is a lighter-weight, single-page preference, unlike the
  cross-device "admin default, user override wins" settings elsewhere in this
  file) and both render functions cache their last-fetched `rows` array
  (`lastAssignedOwnedRows`/`lastAssignedToMeRows`) so toggling the checkbox
  re-filters instantly without a Supabase refetch.
  **"내가 배정한 업무" rows blink when every assignee has submitted but the owner
  hasn't looked yet** — `tasks.owner_seen_completed_at` (nullable timestamptz,
  `null` = "not acknowledged since the last time this task's completion state
  changed"). `renderAssignedOwned`'s `rowHtml` computes `needsBlink = allDone &&
  !t.owner_seen_completed_at` and adds a `.owner-unseen-complete` class (a soft
  border/background pulse, `@keyframes owner-unseen-blink`) to the row — the
  owned-tasks query already does `select('*')`, so this column arrives with no
  query change needed. `ackOwnerSeenCompleted(row, rows)` is the one place that
  clears it: it checks `allDone && !owner_seen_completed_at`, then optimistically
  sets `row.task.owner_seen_completed_at` and re-renders immediately (so the
  blink stops the instant you act, not after a refetch) while firing a
  fire-and-forget `tasks.update({owner_seen_completed_at: now()})` in the
  background. It's called from two places a teacher would naturally land on an
  all-done task: clicking "제출 현황" (`.submissionStatusBtn`, always present
  regardless of task type) and expanding the row's own detail panel via its
  title (`.assignedOwnedToggle`, only present when the task has notes/
  attachments/is a poll) — either one is enough to stop the blink, so a plain
  checklist task with no detail panel still gets acknowledged through the
  universally-present 제출 현황 button. **Resetting back to "unacknowledged" on
  a fresh completion is a database trigger, not client code**: a Postgres
  trigger (`trg_reset_owner_seen_completed` on `task_assignments`, firing after
  any insert/update/delete) sets the owning task's `owner_seen_completed_at`
  back to `null` on *any* row change for that task — a newly-added assignee, a
  completion checkbox toggling either direction, a poll/form response landing,
  an assignee being removed. This was deliberately done as a trigger rather
  than threading a reset call through every client-side completion-toggle code
  path (`renderAssignedToMe`/`renderAssignedToMeDetail`, the file-task
  auto-sync RPCs, `my-todo.html`'s copy, poll responses, "미제출자 삭제", etc. —
  there are too many of these scattered across pages to safely cover by hand)
  — the trigger guarantees correctness regardless of which page or code path
  caused the change, at the cost of occasionally over-resetting on a touch that
  didn't actually change `completed` (harmless: worst case is one extra blink).
  A 설문(투표)/양식 task's `tasks.form_schema` (jsonb array of `{key, label, type,
  options?, required?}`) can mark individual fields required — set via a "필수"
  checkbox next to each field row in the creation form's `renderAssignFormFields()`
  (my-page.html, the only place `form_schema` is authored). Required fields show a
  red `*` after their label, and each of the three near-identical fill-out/submit
  UIs that render a `form_schema` (`my-page.html`'s `renderAssignedToMeDetail` for
  "나에게 온 업무", `my-page.html`'s second-IIFE `renderLocalDetail` and
  `my-todo.html`'s copy of the same, both for a personal task that happens to have
  a delegated assignment) independently check `schema.filter(f => f.required &&
  !String(resp[f.key] || '').trim())` right before the `task_assignments` update
  and refuse to submit (showing which labels are missing) if anything required is
  empty — client-side only, no RLS/RPC-level enforcement, so treat it as a UX
  nicety rather than a hard guarantee the response is complete.
  A `completion_type: 'file'` task (linked to a `collect.html` `collection_id`)
  used to let its assignee — or its owner, from the 제출 현황 popup — mark it
  "완료" with a bare checkbox, with nothing actually checking that a file was
  submitted. Both self-checking paths were removed for file-type rows; completion
  is now driven entirely by whether a real `submissions` row exists. Since
  `submissions` has RLS with no client-reachable policies (only accessed via
  `SECURITY DEFINER` RPCs like `manager_auth`/`submit_files`, per the `collect.html`
  section above), this needed two new narrow RPCs matched by exact submitter-name
  string equality against the assignee's `profiles.name` (this only works cleanly
  for `target_mode = 'free'` collections — a `'custom'`/subject-keyed collection's
  `submissions.name` won't match any one person's profile name, so those file
  tasks fall back to showing no match, never a false positive):
  - `get_file_task_submissions(p_task_id)` — callable by the task's **owner**
    (checks `tasks.owner_id = auth.uid()`), returns every submission for that
    task's collection. Used by `openSubmissionModal`/`renderSubmissionTable` to
    show each assignee's real status, actual submitted file names (replacing the
    old static "제출함 참고" placeholder text), and to silently flip any assignment
    from 미완료→완료 (never the reverse — an old manually-completed row with no
    matching submission is left alone rather than auto-un-completed) when a real
    submission is found but the stored `completed` flag hadn't caught up yet.
  - `get_my_file_submission_status(p_task_id)` — callable by an **assignee**
    (checks a `task_assignments` row exists for `auth.uid()`), returns only their
    own match (never other assignees' — a teacher shouldn't see classmates'
    submission status through this path). `loadAssignedWidget` calls this for
    every file-type "나에게 온 업무" row in parallel, applies the same one-way
    completed sync, and `renderAssignedToMe`/`renderAssignedToMeDetail` show a
    plain ✅/⬜ badge (not a checkbox) plus the real file name(s) instead of the
    old "제출함에 제출했어요" self-report checkbox.
  The 제출 현황 popup also gained a 담당자 이름 검색 filter and a 이름순/미완료
  먼저/완료 시각순 sort (`currentSubmissionFilter`, re-rendered client-side over
  the already-fetched rows — no refetch per keystroke), and 완료 시각 now uses a
  new `fmtWhenTime()` helper (always shows `M/D H:MM`) instead of the existing
  `fmtWhen()` (date-only, kept as-is since due-date displays elsewhere still want
  date-only). **Known gap**: this fix covers the two most common paths (다른 사람이
  배정한 업무, and the owner's own 제출 현황 view) — a `file`-type task a teacher
  assigns *only to themselves* would render through `my-todo.html`'s/my-page.html's
  second-IIFE local-task detail instead, which still has the old bare-checkbox
  behavior for that rare case; apply the same `get_my_file_submission_status` fix
  there if it comes up.
  **Editing an already-created assigned task** ("내가 배정한 업무" rows only — a
  personal-only task from "내 할 일 목록" still has no edit UI) reuses the exact
  same `#assignCreateForm` the "+ 새로 배정하기" button opens, rather than a
  separate edit form: a "수정" button next to 제출 현황/숨기기/삭제
  (`renderAssignedOwned`'s `rowHtml`) calls `openEditAssignForm(t, assignments)`,
  which sets module-level `editingTaskId`/`editingExistingAssigneeIds`, prefills
  every field (title/마감일/설명/첨부파일/완료 방식/투표 문항/제출함 선택) from the
  task row, and pre-checks the 개인별 tab's checkboxes for the task's current
  assignees (`loadAssignCollections` gained an optional `preselectId` param for
  this). `btnAssignSubmit`'s handler branches on whether `editingTaskId` is set:
  when it is, it does `tasks.update(...)` instead of `.insert()`, then diffs the
  newly-checked assignee id set against `editingExistingAssigneeIds` — ids only in
  the new set get a fresh `task_assignments` insert, ids only in the old set get
  `.delete()` — rather than naively deleting-and-reinserting everyone (which would
  needlessly wipe `completed`/`form_response` on assignees who didn't change).
  `btnNewAssign`/`btnAssignCancel` both reset `editingTaskId = null` and the
  submit button's label back to "만들기" so the same form correctly falls back to
  create-mode afterward.
  **"배당자 추가 시 알림"**: this site has no push/email/in-app notification system
  to hook into (see the messenger-integration and Apps Script sections elsewhere
  in this file — nothing here can reach a teacher outside their next page load),
  so instead of a real notification, `renderAssignedToMe`'s `rowHtml` shows a red
  "NEW" badge on any "나에게 온 업무" row whose `task_assignments.created_at` is
  within the last 3 days and still incomplete — this covers both a brand-new task
  and an existing task a teacher was just newly added to via the edit form above.
  The edit form's own success message additionally lists newly-added assignees by
  name (`toAdd.map(id => profilesMap[id])`) so the person doing the editing can
  immediately confirm who was just added, even though the assignees themselves
  only see it via the NEW badge on their own next visit.
  **"미제출자 삭제"**: the 제출 현황 popup (`openSubmissionModal`/
  `renderSubmissionTable`) gained a "미제출자 삭제" button in its `modal-foot`
  (next to 엑셀로 다운로드) that bulk-deletes `task_assignments` rows for every
  assignee `submissionRows()` currently reports as not completed — for an owner
  who wants to stop tracking people who never responded, without touching anyone
  who already submitted/completed (deliberately excluded from the delete set, so
  a completed row can never be accidentally wiped by this button).
- **`memos`** (`memo.html`, and the `memo` widget on `my-custom-page.html`): personal
  notes per teacher — title, content, `labels` (text array), timestamped. RLS is
  plain per-owner (`auth.uid() = owner_id`) for all four commands, like `tasks`.
- **`app_settings`** (single row, `id = 'site'`): site-wide config. RLS: anyone can
  `select`, only `profiles.is_admin = true` can `update`. This is the pattern to
  follow for any new site-wide (as opposed to per-user) setting — add a column here
  and reuse the existing policies. Current columns: `require_approval` (signup
  approval policy, toggled in `member-admin.html`), `collapse_defaults` (jsonb —
  see below), `default_dash_block_order` (jsonb, my-page.html layout default),
  `default_dash_col_widths` (jsonb, my-page.html column width default — see
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
  `<a class="tool-card">` blocks in `index.html`. **Gotcha**: a tile whose
  `href` has no `group` in `DEFAULT_HREF_GROUP_MAP` (i.e. no `group` on its
  `DEFAULT_NAV_ITEMS` entry) always renders pinned in a `tile-pinned-grid`
  **before every group**, regardless of where its `<a class="tool-card">`
  actually sits in the HTML source — this bit us once with the 대시보드
  (`my-custom-page.html`) tile, whose source block used to sit near the bottom
  of `.card-list` (visually implying it belonged with the 업무 도구 group) while
  it actually rendered pinned first, since it has no `group` in
  `DEFAULT_NAV_ITEMS` (by design — it's meant to be prominent, matching its
  early position in the hamburger menu right after 나의 페이지). Its tile is now
  physically the first child of `.card-list` too, so the source order matches
  what actually renders. Keep any future ungrouped tile's source position at
  the front of `.card-list` for the same reason, or give it a `group` if it
  should render inline with a group instead of pinned.
- Also builds the floating "교사용 챗봇" chat button (`buildTeacherChatFab`),
  which embeds `chatbot-teacher.html?widget=1` in an iframe that stays mounted
  (just hidden) while the panel is closed. Because of that, anything that should
  happen "on open" (e.g. scroll-to-bottom) can't just run once at load — it needs
  a `postMessage` from `nav.js` to the iframe each time the panel is opened.
- Also builds the floating "🔍" site-search button (`buildSearch`, top-right,
  every page) — a "quick open" style page directory search, not a full-text
  search of page bodies (this is a static site with no build step or crawler, so
  indexing arbitrary HTML content isn't practical). Its corpus is
  `SITE_SEARCH_INDEX = DEFAULT_NAV_ITEMS.concat(EXTRA_SEARCH_ITEMS)`: every
  `DEFAULT_NAV_ITEMS` entry now carries an optional `desc` (a one-line summary,
  reusing `index.html`'s `.tool-card` copy where one exists) alongside its
  `label`/`href`, and `EXTRA_SEARCH_ITEMS` adds pages that are reachable only via
  the `admin-tools.html` hub (`exam-generator.html`, `score-generator.html`,
  `bulk-register.html`, `member-admin.html`, `teacher-groups.html`) or via another
  page's own link (`my-todo.html`) — none of which are in the floating nav menu
  itself but should still be find-able by search. Typing a query
  (`searchSitePages(query, includeAdminOnly)`) matches against lowercased
  `label`/`desc` substrings, ranking a title match above a description-only
  match; results render as real `<a href>` elements (external links get
  `target="_blank"`) so click and Enter-key navigation share one code path.
  `bulk-register.html`/`member-admin.html`/`teacher-groups.html` are flagged
  `adminOnly: true` in `EXTRA_SEARCH_ITEMS` and excluded from results unless the
  current session belongs to an admin (a lazy `sb.auth.getSession()` +
  `profiles.is_admin` check, shared with the menu-tile visibility feature below
  under `siteIsAdmin`/`loadSiteNavState()` so the two features spend only one
  Supabase round-trip between them, kicked off once at the top of `init()` and
  re-run into `renderResults()` when it resolves) — those pages are already
  hidden from non-admins in `admin-tools.html`'s own card grid, so letting
  anyone search their way to them (even though the pages themselves would still
  gate on `is_admin`) would be an inconsistent, needlessly confusing UX gap.
  This button **replaced** an older version of the same modal that only
  offered a "날짜로 이동"/"교사 이름으로 이동" pair of inputs (jumping to
  `date.html?d=`/`teacher.html?name=`) — that pair was dropped (along with the
  `TEACHER_NAMES` array) since both lookups are ordinary destinations in this
  same general search now. `index.html`'s own main-page "날짜로 보기"/"교사별
  보기" quicknav cards were **not** touched by this and are still there — they
  stay as a deliberate one-click shortcut on the landing page itself, independent
  of the nav's own search feature.
- **Content search, not just page names — 제출함/문서 양식/할 일/자료실/학사일정.**
  The same 🔍 modal now also searches *inside* five content sources, so
  "제출함이나 학사일정, 자료실의 폴더명·파일명, 문서 양식의 파일명·제목, 할 일" are
  all find-able, not just page titles/descriptions. This is deliberately a
  **separate, async, debounced** layer on top of the instant synchronous
  `searchSitePages()` page-directory search, not merged into the same scoring
  function — page results render immediately on every keystroke exactly as
  before, while content results (network round-trips) only fire 350ms after
  typing stops (`contentDebounceTimer`) and get appended below a "콘텐츠 검색
  결과" divider inside the same `#gsnavResults` list (`lastContentHtml`,
  concatenated onto the page-results HTML by `renderResults()` so both scroll
  together in one list) once they resolve — a `contentSearchToken` counter
  discards a still-in-flight response if the query has since changed, so a
  slow network round-trip can't clobber a newer, faster one.
  - **`searchCollectionsContent(q)`** — `public_collections.title`/`.description`
    `ilike` match (open read, no login needed for `collect.html` itself either),
    linking to `./collect.html?id=<id>` — the one content source with a real
    per-item deep link, since `collect.html` already supports `?id=`.
  - **`searchFormTemplatesContent(q)`** — `form_templates.title`/`.content`
    `ilike` match (RLS already allows any authenticated user to `select`, same
    as `form-board.html` itself), linking to `./form-board.html?q=<query>`.
  - **`searchMyTasksContent(q)`** — two queries, both scoped to the current
    user only (never someone else's tasks): `tasks` where `owner_id = me`
    (내가 배정한 업무) and `task_assignments` where `assignee_id = me` with an
    embedded `tasks!inner(id,title)` filter (나에게 온 업무) — both `ilike`
    against the task title. Both link to `./task-assign.html` (no per-task deep
    link exists there yet, unlike the other sources).
  - **`searchLibraryContent(q)`** — a direct `fetch()` POST to the same Apps
    Script `SCRIPT_URL` file-library.html uses, calling its `librarySearch`
    action (see the file-library.html section above) and linking to
    `./file-library.html?q=<query>`. **Maps both `data.files` and
    `data.folders`** — an early version of this only mapped `data.files`
    (`librarySearch` already returned folders in its response, they just
    weren't read), so a folder name typed into the quick search produced no
    result even though `file-library.html`'s own in-page search already found
    it; fixed by mapping `data.folders` too (sub `'자료실 · 폴더'`, same
    `?q=` link as files).
  - **`searchCalendarContent(q)`** — hits the Google Calendar `events.list` API
    directly with the same public `GCAL_API_KEY`/`GCAL_CALENDAR_ID`
    `date.html` already uses (see `GCAL-SETUP.md`), using its `q` free-text
    search param (`singleEvents=true&orderBy=startTime`, `timeMin` = 1 year
    ago so very old events don't dominate, capped at 6 results) — no Supabase
    table involved, since 학사일정 isn't backed by one anywhere in this
    codebase (the actual school calendar lives entirely in Google Calendar).
    Links to `./date.html?d=<event date>`.
  - **`searchLinkHubContent(q)`** — 업무링크 모음(`link-hub.html`)도 검색 대상에
    추가됐다. `file-library.html`과 달리 이 쪽 Apps Script 배포(`LINK_HUB_SCRIPT_URL`,
    `link-hub.html`이 쓰는 것과 동일한 URL)의 GET은 검색이 아니라 전체 링크 목록을
    그대로 돌려줄 뿐이라(링크 개수가 많지 않아 서버 쪽 검색이 필요 없음), 받아온
    목록을 이름/설명/카테고리 기준으로 클라이언트에서 직접 걸러 최대 6개까지
    보여준다. **다른 네 소스와 달리 결과의 `href`가 사이트 내부 페이지가 아니라
    그 링크의 실제 목적지 URL이다** — 교사가 찾는 건 "link-hub.html을 열어서 그
    링크를 또 클릭하는 것"이 아니라 그 링크 자체이므로, 곧장 외부 주소로 연결한다.
  - **All six (and the content-search layer entirely) are skipped outright
    when there's no logged-in session** (`searchSiteContent()` returns `[]`
    immediately if `siteSession` is null) — `form_templates`/`tasks` RLS would
    reject an anonymous request anyway, and even though `public_collections`/
    자료실/학사일정/업무링크 don't actually require login, splitting the gate
    per-source would make "콘텐츠 검색 결과" appear/disappear inconsistently
    depending on login state in a way that's more confusing than just gating
    the whole layer together. `siteSb`/`siteSession` are captured once inside
    the existing `loadSiteNavState()` (the same one-shot admin-check/hidden-tiles
    fetch every page already does) rather than issuing a second, redundant
    session check just for content search.
  - **`form-board.html` and `file-library.html` both read a `?q=` URL param on
    load** and immediately run their own in-page search with it (`form-board.html`
    prefills `#tplSearch`; `file-library.html` prefills `#librarySearchInput`
    and calls `runLibrarySearch()`) — this is what makes clicking a content
    result land the teacher on an already-filtered view instead of a bare list
    they'd have to re-type the same query into. **`link-hub.html` now does the
    same** (prefills `#searchInput` and runs its existing `applyFilter()`) — added
    specifically so its own content-search entries above land on an already-filtered
    list too, matching the other two.
  - **The content-result `<a>` template never added `target="_blank"` for an
    external href** — harmless for the first five sources (all of them link to
    this site's own pages), but it meant a 업무링크 search result would navigate
    the search modal's own tab away to the external site instead of opening it
    in a new tab like the page-search results and every other external
    `DEFAULT_NAV_ITEMS` link already do. Fixed by adding the same
    `/^https?:\/\//.test(item.href)` check `renderResults()`'s own `<a>` template
    already uses, to `renderContentResults()`'s template too.
- **Admin-only menu tile show/hide, always synced with the hamburger menu.**
  Every `a.tool-card` on `index.html` whose `href` is a real `DEFAULT_NAV_ITEMS`
  entry (`NAV_HREF_SET`) gets an admin-only "숨기기"/"표시하기" button
  (`.gsnav-tile-toggle`, injected as a child of the `<a>` itself with
  `preventDefault`+`stopPropagation` on click so pressing it never triggers the
  card's own navigation) once `loadSiteNavState()` resolves. Clicking it
  read-modify-writes `app_settings.hidden_nav_items` (a plain `jsonb` array of
  hrefs, reusing `app_settings`' existing "anyone can select, only
  `is_admin` can update" RLS — same site-wide-setting pattern as
  `collapse_defaults`/`default_dash_block_order` etc. above) and calls
  `applyTileVisibility()` + re-renders the hamburger list
  (`renderNavListHtml()` already filters `NAV_ITEMS` through the same
  `hiddenNavHrefs` Set) so both update together immediately — this is the
  "내비 메뉴는 늘 메뉴타일에 동기화" requirement: there is exactly one
  `hiddenNavHrefs` Set driving both surfaces, never two separately-maintained
  hidden-lists. For a non-admin, a hidden tile gets `display:none` (and the
  corresponding hamburger item is filtered out) — they never see it exists.
  For the admin who hid it, the tile stays in place but dimmed
  (`.gsnav-tile-off`, `opacity:0.45`) with the toggle now reading "표시하기",
  specifically so the admin has a way to turn it back on again; **the admin's
  own hamburger menu still hides it like everyone else's** (the sync
  requirement applies without a carve-out for the person who hid it) — an
  admin who wants to reach a hidden page without un-hiding it first can still
  use 🔍 search, which is intentionally *not* filtered by `hiddenNavHrefs`
  (only by the pre-existing `adminOnly` flag), so hiding something from the
  main menu never makes it unreachable. `loadSiteNavState()` is fetched once at
  the very start of `init()`, *before* `build()` — `build()` calls
  `buildSearch()`, which reads the same promise, so fetching after `build()`
  would leave that read pointed at `null` and throw. Since the fetch is async
  but `build()`/`groupToolCardTiles()` render immediately for snappiness, there
  is a brief flash of every tile un-hidden before `applyTileVisibility()` prunes
  them once the promise resolves — the same "render permissively first, then
  correct once the async check lands" trade-off `checkSearchAdminStatus` (now
  folded into `loadSiteNavState`) already made for admin-only search results.

- **`adminOnly: true` on a `DEFAULT_NAV_ITEMS` entry** (not just an
  `EXTRA_SEARCH_ITEMS` one — see above) is a different mechanism from the
  admin-toggled `hidden_nav_items` just described, for a different purpose:
  parking a page that's in the main menu/tile grid but still unfinished so
  only admins see it, without touching the database at all. It's a plain code
  flag on the nav entry (`ADMIN_ONLY_HREF_SET`, computed once from
  `DEFAULT_NAV_ITEMS.filter(it => it.adminOnly)`), checked alongside
  `hiddenNavHrefs` everywhere visibility is decided — `renderNavListHtml()`'s
  item filter, and `applyTileVisibility()` (where it takes priority over the
  admin's own manual hide/show toggle: an `adminOnly` tile shows a static
  "관리자만" badge instead of the usual 숨기기/표시하기 button, since that
  toggle writes to `hidden_nav_items` and wouldn't do anything meaningful
  here). A non-admin never sees the item at all — not even briefly dimmed —
  in the hamburger menu, the tile grid, or 🔍 search (search already
  special-cased `adminOnly` for `EXTRA_SEARCH_ITEMS`; since `SITE_SEARCH_INDEX`
  concatenates both arrays, `searchSitePages()` needed no change to also
  respect it on a `DEFAULT_NAV_ITEMS` entry). An admin sees it normally, plus
  `(관리자만)` after the label in the hamburger list and the badge on the
  tile, as a reminder it's not yet public. First used for `food-map.html`
  (see its own section below) — add `adminOnly: true` to any other
  in-progress page you want in the real menu/tile position (so the layout
  reads right once launched) without exposing it to every teacher yet; delete
  the flag when it's done.

**Incident: every `href` comparison in this file was silently broken on the
live site by Netlify's "Pretty URLs" setting, since before groups even
existed — "메인 화면 타일 그룹핑이 한 번도 일치한 적이 없다" turned out to be literally
true.** Diagnosed by adding a temporary on-page debug box to `index.html`
(dumping `.card-list`'s actual post-`groupToolCardTiles()` DOM structure as
plain text, since DevTools wasn't practical on the reporting teacher's phone)
and asking them to screenshot it — the dump showed the deployed page's real
`<a>` tags had `href="/calendar"`, `href="/duty"`, etc. (no `./`, no `.html`),
while this file's own `DEFAULT_NAV_ITEMS` and everything derived from it
(`DEFAULT_HREF_GROUP_MAP`, `NAV_HREF_SET`) were keyed by the literal
`'./calendar.html'` string — so `HREF_GROUP_MAP[el.getAttribute('href')]`
always missed, `groupToolCardTiles()` always fell into its "no groups found"
flat fallback, and `NAV_HREF_SET.has(card.getAttribute('href'))` in
`applyTileVisibility()` always missed too (the one external `https://` link
was the sole exception, since Pretty URLs leaves absolute URLs alone — which
is exactly why that one tile alone always rendered correctly grouped, the
detail that eventually pointed at a systematic href-form mismatch rather than
a one-off bug). The hamburger menu's own grouping (`renderNavListHtml()`)
never showed this symptom, because it builds `<a href>` HTML fresh from
`item.href` in memory and never reads a value back off the DOM — which is
also why an `_headers`/cache fix (see above) looked promising at first but
didn't actually touch this bug: both the stale-cache theory and this one
produce "HTML looks fresh, behavior looks stale," and only directly dumping
the live DOM distinguished them.

**Fix: `pageKeyOf(href)`** (defined once, right after `DEFAULT_NAV_ITEMS`) is
now the single normalization every href comparison in this file goes through
before comparing: strips a query string/hash, strips a leading `./` or `/`,
strips a trailing `.html`, and passes external `https://` links through
untouched — reducing `'./calendar.html'`, `'/calendar'`, and `'calendar.html'`
alike to the bare key `'calendar'`. Every site in this file where an href gets
*compared* (never where one gets *written* into new HTML — `navItemHtml`'s
`<a href="${item.href}">` still emits the real, clickable `item.href` as-is)
now runs both sides through it: `DEFAULT_HREF_GROUP_MAP`'s keys,
`NAV_HREF_SET`'s entries, `groupToolCardTiles()`'s `HREF_GROUP_MAP[...]`
lookup, `applyTileVisibility()`'s `card.getAttribute('href')` read (the `href`
variable it produces then flows into `NAV_HREF_SET.has()`,
`hiddenNavHrefs.has()`, and the hide/show toggle's stored value, fixing all
three with one change), `loadSiteNavState()`'s `hiddenNavHrefs` construction
from `app_settings.hidden_nav_items` (also defensively normalizing whatever's
already stored, in case any pre-fix value was ever saved in a different
form), `toggleNavItemHidden()`'s own re-read of the current stored array
before writing (same defensive reasoning), `renderNavListHtml()`'s hidden-item
filter, and `navItemHtml()`'s active-page highlighting. `currentFile()` itself
now returns the bare `pageKeyOf()` form rather than a raw path segment, which
meant updating the handful of places that used to compare its result against
a literal `'xxx.html'` string (the `my-custom-page`/`chatbot-builder`/
`chatbot-teacher` branches in `init()`, and one `currentFile() ===
'my-custom-page'` check inside `buildGlobalChat()`) to compare against the
bare form instead — grep for `currentFile()` before adding a new literal
comparison against its result. This fix is independent of whatever Netlify's
Pretty URLs setting is actually set to — it works whether internal links
arrive as `./x.html`, `/x`, or `x.html`, so toggling that Netlify setting
later (on or off) can't silently reintroduce this class of bug.

**Reproducing this class of bug locally** (the sandbox this repo is usually
edited from has no way to reach the live Netlify URL to inspect what it
actually serves): `python3 -m http.server` never applies Pretty URLs, so the
bug is invisible against a plain local checkout. A Playwright test can still
reproduce it faithfully by intercepting the `index.html` response itself and
rewriting `href="./이름.html"` → `href="/이름"` in the response body before
handing it to the page (regex: `/href="\.\/([a-zA-Z0-9_-]+)\.html"/g` →
`'href="/$1"'`) — this exercises the exact same DOM shape the real site
serves, without needing network access to Netlify at all.

## `index.html` quicknav — "날짜로 보기"/"교사별 보기" merged into one combined search

The landing page's `.quicknav` row used to have three one-click tiles: 나의 페이지,
날짜로 보기 (a `<input type="date">` + button → `./date.html?d=`), and 교사별 보기
(a name `<input>` with autosuggest from a hardcoded `NAMES` array + button →
`./teacher.html?name=`). Per explicit request, the latter two were merged into one
tile — "날짜·교사로 보기" — with a single text input that infers intent from what
was typed rather than requiring two separate fields. `.quicknav`'s grid went from
`1fr 1fr 1fr` to `1fr 1fr` to match the new two-tile layout.

`parseQSearchDate(raw)` recognizes `YYYY-MM-DD`/`YYYY.MM.DD`/`YYYY/MM/DD`,
`M월 D일`, bare `M/D`/`M-D`/`M.D` (assumed to be this year), and the literal
words 오늘/내일/어제 — anything else is treated as a teacher-name query, since
none of those date patterns can collide with a real teacher name. `#qSearchGo`
(the tile's own button) and the autosuggest dropdown (`renderQSearchSuggest`,
reusing the exact `.quicknav-search`/`.quicknav-suggest` CSS the old teacher tile
already had) both route through this same parser — the dropdown shows a single
`"📅 <date> 날짜로 보기"` item when the typed text parses as a date, plus up to 8
matching teacher names (substring match against the same hardcoded `NAMES` array
the old teacher tile used) whenever the input is non-empty; picking either kind of
item or clicking "조회하기" with no matching suggestion still navigates (a
not-found name falls through to `teacher.html?name=<as-typed>`, same as the old
tile's behavior — that page's own "일치하는 교사가 없습니다" handling is
unchanged). This is purely a landing-page UI convenience with no backend
involvement, consistent with `nav.js`'s own 🔍 quick search already being a
separate, independent feature (see below) — this tile isn't replaced by that
search, both still coexist exactly as documented in the `nav.js` section.

**두 타일의 버튼이 서로 다른 높이에 떠서 카드 크기가 안 맞아 보이던 문제 —
`display:grid`의 기본 `align-items:stretch` 덕분에 바깥 테두리 높이 자체는
이미 같았지만(Playwright로 실측: 184.5px 동일), 왼쪽(나의 페이지)은 설명
한 줄+버튼뿐이고 오른쪽(날짜·교사로 보기)은 설명(2줄)+입력칸+버튼이라 버튼이
서로 다른 Y 위치에 있었다.** `.quicknav-col`을 `display:flex;
flex-direction:column`으로 바꾸고 버튼에 `margin-top:auto`를 줘서, 위쪽
내용이 얼마나 많든 버튼이 항상 카드 맨 아래에 붙게 했다 — 두 카드 다 같은
높이인 채로 버튼도 같은 Y 위치(카드 하단)에 오므로 시각적으로도 맞아떨어진다.

**정정: 위 수정으로 두 카드끼리는 맞았지만, 여전히 다른 `tool-card`들
(127.1px)보다 두 카드만 184.5px로 유독 컸다.** 사용자가 "나의 페이지를
늘리는 게 아니라 날짜·교사로 보기를 줄여서 다른 타일과도 크기를 맞춰달라"고
바로잡았다 — `align-items:stretch`는 두 칼럼을 서로 같게 맞출 뿐, 그 기준이
되는 높이 자체가 다른 타일보다 큰 건 못 고친다는 걸 놓쳤던 것. 오른쪽
카드(날짜·교사로 보기)의 설명 문단을 아예 빼고(제목+입력칸 placeholder
`"날짜 또는 이름 입력 (예: 10/8, 김경성)"`만으로도 사용법이 충분히 짐작
가능), 카드 패딩(`18px 18px 20px` → `16px 18px 14px`)과 제목/입력칸/버튼
사이 여백·패딩을 모두 줄였다. 왼쪽 카드(나의 페이지)의 설명 문단 여백도
맞춰 줄였다(텍스트 자체는 유지). 오른쪽 카드의 자연스러운 높이가 줄어들면
`stretch`가 두 칼럼에 적용하는 기준 자체가 낮아지므로, 왼쪽도 같이
줄어들면서 결과적으로 두 카드 모두 131.75px — 다른 `tool-card`(127.1px)와
거의 같은 높이로 수렴한다.

## `link-hub.html` (업무링크 모음) — 3-column fixed grid, default-expanded categories, 메인 노출 moved into 수정

Three related tweaks requested together via a wireframe image showing a 2-row ×
3-column grid of link cards:

- **`.link-grid` is now a fixed 3-column CSS grid** (`grid-template-columns:
  repeat(3, 1fr)`), not the original `repeat(auto-fill, minmax(130px, 1fr))` —
  the card count per row no longer depends on viewport width; a category with 7
  links simply wraps to a 3rd row with 1 card rather than reflowing to however
  many fit. Media-query breakpoints step this down to 2 columns at ≤640px and 1
  column at ≤420px, matching this repo's usual mobile-stacking convention. The
  widget-mode override (`body.widget-mode .link-grid`, used when this page is
  embedded via `?widget=1`) keeps its own separate `auto-fill` rule untouched —
  that's a much narrower embedded context where a fixed 3-column grid wouldn't
  fit.
- **Categories default to expanded, not collapsed.** `isCategoryOpen()`'s
  fallback (when neither a per-user `localStorage` override nor an admin
  `app_settings.collapse_defaults` default exists) flipped from `false` to
  `true` — this still goes through the same existing 3-tier
  "admin default, user override wins" pattern documented above (per-user
  override → admin default → hardcoded page default), only the hardcoded
  page-level default itself changed.
- **"메인 페이지에도 보이기" (메인 노출) moved out of the always-visible card
  and the "+ 새 링크 추가" form, into the per-link 수정 (edit) form only.**
  Previously every link card had its own always-visible `.main-chk` checkbox
  (calling a dedicated `{action:'setMainShow', id, mainShow}` Apps Script
  endpoint the instant it was toggled) and the add-link form had its own
  `#fMainShow` checkbox — per explicit request, both were removed; a new link
  is now always created with `mainShow: false`, and the only way to turn it on
  is to open 수정 on an existing link, where a `.ef-mainshow` checkbox
  (pre-filled from that link's current `mainShow`) now lives alongside the
  other editable fields. `onSaveEdit()` still sends the existing `{action:
  'update', id, category, name, url, desc}` call for the text fields (this
  page's separate, undocumented Apps Script deployment's `update` action was
  never verified to also accept a `mainShow` field, so nothing risky was
  guessed at there), and only fires a **second**, already-proven
  `{action:'setMainShow', id, mainShow}` call afterward, and only when the
  checkbox's value actually differs from the link's last-known `mainShow` — so
  editing a link's text without touching the checkbox never sends a redundant
  setMainShow request. The now-unused always-visible checkbox's handler
  (`onToggleMainShow()`) and its `.main-chk` listener wiring were removed
  entirely; the card's `.bottom-row` is now just the 수정/삭제 buttons,
  right-aligned. The card-click-opens-link guard's exclusion selector dropped
  `.main-toggle` (no longer a direct child of `.link-card`) since the
  checkbox's new home (`.edit-form`) was already in that exclusion list.

**재설계: 카테고리 자체가 3열 그리드로, 링크 카드는 최대한 압축.** 위
"3-column fixed grid"는 실제로는 **카테고리 하나 안의 링크 카드들**을 3열로
배치하는 것이었는데, 사용자가 손으로 그린 와이어프레임으로 다시 확인해보니
의도한 건 **카테고리 섹션 자체**를 3열로 흘려보내는 것이었다("업무 링크는
카테고리 자체를 3개의 열로 보내 보여 달라는 거였어... 카테고리가 9개면은
삼열 3행이 나와야 되고 카테고리가 6개면 3열 이행이 나오면 돼") — 행 수는
카테고리마다 링크 개수가 달라 들쑥날쑥해도 괜찮다는 전제였다. 동시에 링크
카드 한 장의 세로 공간을 "제목 최대 2줄 + 오른쪽 끝 수정/삭제 버튼"만
남도록 압축해달라는 요청도 함께 받았다.
- **`#listArea`가 `display:grid; grid-template-columns:repeat(3,1fr)`** —
  카테고리 섹션(`.category-section`)들이 이 그리드의 아이템이 되어 왼쪽→
  오른쪽, 위→아래 순서로 3열에 채워진다(`align-items:start`라 각 열의 높이는
  그 열에 들어간 카테고리들의 실제 내용 높이만큼만 — 열마다 길이가 달라도
  된다는 요청 그대로). 900px 이하는 2열, 560px 이하는 1열로 줄어든다. 카테고리
  *안의* 링크 목록(`.link-grid`)은 더 이상 그리드가 아니라 단순한
  `display:flex; flex-direction:column` 세로 스택 — 카드 한 장짜리 "행"이
  이어지는 모양이다.
- **링크 카드(`.link-card`) 압축**: 기존의 `top-row`(제목)/`desc`(설명 한
  줄)/`bottom-row`(버튼) 3단 구조를 버리고, `.card-row`(제목 + 오른쪽 끝
  수정/삭제 버튼) 한 줄만 남겼다. 제목(`.name`)은
  `flex:0 1 55%; max-width:55%`로 카드 폭의 절반 정도까지만 차지하고,
  `-webkit-line-clamp:2`로 2줄까지만 보여주고 넘치면 말줄임 — 요청한 "왼쪽부터
  중간 정도까지 두 줄 안에 끊고 너무 길면 말줄임표"를 그대로 구현한 것.
  설명(`desc`)은 더 이상 카드에 보이는 줄을 차지하지 않고, 있으면 제목 `<a>`
  태그의 `title` 속성(마우스 오버 툴팁)으로만 남는다 — 수정 폼을 열면
  `.ef-desc` 입력칸에서 여전히 보고 고칠 수 있으므로 데이터 자체가 없어진
  건 아니다. `.card-actions`에 `margin-left:auto`를 줘서 수정/삭제 버튼이
  항상 카드 오른쪽 끝에 붙는다. 카드 색상 강조선도 `border-top`에서
  `border-left`로 바꿨다(세로로 압축된 카드에는 왼쪽 세로선이 더 자연스럽다).
- **드래그앤드롭 카테고리 순서 재배치 버그와 고친 방법**: 기존 드래그 로직
  (`updateCatDropIndicator()`)은 매 `pointermove`마다
  `document.elementFromPoint(x,y).closest('.category-section')`로 드롭 대상을
  다시 찾았는데, 이건 `#listArea`가 1열 세로 목록이던 시절에는 문제가 없었지만
  **3열 그리드에서는 드롭 표시선(`.cat-drop-indicator`, 평범한 `<div>`) 자체가
  그리드의 새 아이템으로 끼어 들어가면서 그 뒤에 있던 카테고리들을 전부 다른
  칸으로 밀어버린다** — 그래서 드래그 도중 매번 레이아웃이 다시 흐르고, 그
  다음 `elementFromPoint` 호출이 더 이상 존재하지 않는(밀려난) 위치를 짚어
  빗나가는 피드백 루프가 생겼다. 실제 증상: 마지막 카테고리를 첫 카테고리
  위로 끌어다 놓아도 순서가 전혀 안 바뀌고(표시선이 어느새 맨 끝으로
  가버림), Supabase 저장 요청만 (바뀌지 않은) 원래 순서로 나갔다 —
  `test_linkhub_cat_order.js`로 재현·확인. **고쳐서** 드래그를 시작하는
  `pointerdown` 시점에 그 순간의 모든 카테고리 섹션 위치(`getBoundingClientRect()`)
  를 `catDragCandidates`에 캐시해두고, 그 뒤로는 `pointermove`마다 이 고정된
  캐시 좌표만으로 가장 가까운 후보를 찾는다(`nearestCatCandidate()`, 중심점
  유클리드 거리) — 드롭 표시선을 끼워 넣느라 실제 DOM이 재배치돼도 다음
  타겟 탐색에는 영향이 없다. 앞/뒤 판정도 "같은 줄이면(세로 거리가 그
  후보의 반 높이 이내) 가로 위치로, 아니면 세로 위치로" 읽는 순서 기준으로
  바꿔(`before = sameRow ? clientX <= centerX : clientY < centerY`) 3열
  레이아웃에서도 "왼→오, 위→아래" 순서가 자연스럽게 성립한다.
  `test_linkhub_cat_order.js`가 다시 통과함을 확인했다 — 캐시는 드래그가
  끝나거나 취소되면 비운다.
- `test_linkhub_3col_categories.js`(새 테스트)로 카테고리 9개가 실제로 3개의
  x좌표(3열)로 배치되는지, 카드 높이가 전부 50px 이하(압축된 2줄 수준)인지,
  제목 폭이 카드 폭의 약 40~60%인지, 수정 클릭 시 edit-form이 카드 아래로
  (겹치지 않게) 펼쳐지는지, 500px 좁은 화면에서 1열로 줄어드는지 확인했다.
  기존 `test_linkhub_grid_expand_mainshow.js`의 "3열 고정 그리드" 단언은
  `.link-grid`(카드 목록) 대신 `#listArea`(카테고리 섹션)를 보도록 고쳤다 —
  3열이라는 요구사항 자체가 카드 목록이 아니라 카테고리 섹션 쪽으로 옮겨졌기
  때문.

**카테고리 안 링크가 10개를 넘으면 그 카테고리의 `.link-grid`만 캡을 씌워 스크롤되게
한다 — 카테고리 섹션 자체나 다른 카테고리는 전혀 영향받지 않는다.** 링크가 많은
카테고리 하나가 전부 펼쳐져서 다른 카테고리들까지 한참 아래로 밀려나는 걸 막기
위한 요청("링크모음은 카테고리별로 10개까지 표시하고 스크롤"). `renderLinks()`가
카테고리별 링크 배열(`byCategory[cat]`)의 길이를 이미 `cat-count`로 세고 있었어서,
그 길이가 10을 넘는 카테고리에만 `.link-grid`에 `link-grid-capped` 클래스를
추가로 붙인다 — CSS `.link-grid.link-grid-capped{ max-height:390px;
overflow-y:auto; }`(카드 한 장이 보통 한 줄 ≈33px, 10장+9번의 6px gap을 더하면
약 384px, 여유를 살짝 둔 근사치 — `room-booking.html`의 그리드 세로 스크롤
캡과 같은 "약 N개 분량" 방식)가 실제 스크롤을 만든다. 10개 이하인 카테고리는
이 클래스가 안 붙어서 캡/스크롤바 없이 평소처럼 전부 보인다. 위젯 모드
(`body.widget-mode`, 카드 패딩/gap이 더 작음)는 그 축소된 치수에 맞춰 캡을
300px로 따로 둔다. 검색(`applyFilter`)도 같은 `renderLinks()`를 거치므로, 검색
결과로 카테고리당 링크 수가 10개 이하로 줄어들면 그 카테고리는 자동으로 캡이
풀려서 스크롤 없이 전부 보인다 — 별도 분기 없이 렌더링 시점의 개수만으로
결정된다. `test_linkhub_category_cap.js`(새 테스트)로 13개짜리 카테고리는
`link-grid-capped`가 붙고 실제로 `scrollHeight > clientHeight`인지(스크롤
가능), 3개짜리 카테고리는 캡이 전혀 안 붙고 스크롤도 없는지 확인했고,
`test_linkhub_widget_cap.js`로 위젯 모드에서 캡 높이가 300px로 다르게 적용되는지
확인했다.

**카테고리 기본 정렬 순서 — 링크 개수가 많은 카테고리가 위로.** 사용자 요청
("링크모음은 링크 개수가 많은 순서대로 상위에 나오게 해줘")과, 이미 있던
관리자 드래그 순서 편집 기능(바로 위 "링크-hub.html: admin drag-and-drop
category reordering" 참고 — 한 번 드래그로 저장하면 `app_settings.
link_hub_category_order`에 전체 카테고리 순서가 고정됨)이 충돌할 수 있어
사용자에게 직접 확인했다: **드래그로 정해둔 순서가 있으면 그게 항상 우선,
아직 한 번도 드래그로 정해지지 않은 카테고리만 링크 개수 내림차순으로
정렬**(개수가 같으면 이름순)하기로 했다. `sortedCategoryList(cats, counts)`가
기존처럼 `categoryOrder`(관리자가 저장한 순서)에 있는 카테고리는 그 순서를
그대로 쓰고(`known`), 거기 없는 카테고리(`unknown`)만 알파벳순(`.sort()`)
대신 `counts[cat]` 내림차순(동률이면 `localeCompare`)으로 정렬하도록
바꿨다 — `renderLinks()`가 `byCategory[cat].length`로 이미 세어둔 카운트를
그대로 `categoryCounts` 맵으로 넘겨준다. `categoryOrder`는 드래그로 한 번
저장될 때 **그 시점에 보이던 카테고리 전체**를 담으므로(`saveCategoryOrder()`
가 `.category-section` 전체를 읽고 저장 — 특정 카테고리만 옮긴 게 아니라),
실제로는 "한 번도 드래그해본 적이 없는 사이트"에서만 모든 카테고리가 개수순으로
정렬되고, 이미 한 번이라도 드래그해본 사이트는 그 저장된 순서가 계속 유지된다
(이후 새로 생기는 카테고리만 개수순으로 끝에 붙는다) — 이건 기존 "관리자가
직접 정한 값이 항상 우선"이라는, 이 저장소의 다른 site-wide 설정들과 같은
우선순위 원칙과 일치한다. `test_linkhub_count_sort.js`(새 테스트)로 (1) 저장된
순서가 하나도 없을 때 링크 수 2/5/1/5인 네 카테고리가 5,5,2,1(동률은 이름순)
순으로 나오는지, (2) 전체 순서가 저장돼 있으면 개수와 무관하게 그 순서가
그대로 유지되는지, (3) 일부 카테고리만 저장돼 있으면 그 둘은 저장된 순서대로,
나머지는 개수순으로 뒤에 붙는지 — 세 가지를 모두 검증했다. 기존
`test_linkhub_cat_order.js`는 테스트 데이터의 카테고리 3개가 전부 링크 1개씩이라
동률→이름순 결과가 바뀌지 않아 그대로 통과한다.

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

Separately, individual blocks' internal scroll areas got their own height-resize
handles (`.dash-resize-height-handle`, same `body.dash-editing`-gated visibility as
column resize) — this is **not** a row×column grid feature like the one below;
`my-page.html`'s blocks still free-stack vertically with no row concept, so "height"
here just means the fixed `max-height` a handful of scroll boxes already had in CSS
(`#dutyList`, `#assignedOwnedList`, `#assignedToMeList`, `#weekList`,
`#dashTaskList`) becoming user-draggable instead of a hardcoded constant. A thin
handle div sits right after each of those elements in markup (`data-target="<id>"`)
rather than wrapping them, since they're arbitrarily positioned within each block's
content rather than sitting in a grid. **Gotcha**: these handles are nested inside
`.dash-frame` (via `.dash-block-body`), and `body.dash-editing .dash-frame >
*:not(.dash-frame-handle){ pointer-events:none; }` (which disables interaction with
block *content* while in edit mode, so drag-reordering a block doesn't also trigger
its buttons) inherits down through descendants — so the handle needed its own
`body.dash-editing .dash-resize-height-handle{ pointer-events:auto; }` override, or
pointerdown silently never fires. Dragging sets **both** `max-height` and `height`
inline styles (not just `max-height`) on the target — `max-height` alone doesn't
visibly resize a box whose actual content is shorter than the dragged value (e.g. an
empty "배정한 업무가 없습니다" list), since `max-height` only caps, never forces, a
block element's size. Persistence is the same 3-tier pattern as column width:
`localStorage` (`ks_dash_block_heights_v1`, `{elementId: px}`),
`profiles.ui_prefs.dash_block_heights` as the cross-device source of truth, and
`app_settings.default_dash_block_heights` as the admin default (folded into the
same "🔧 이 배치를 기본으로 설정" / "↺ 기본값 초기화" buttons — one more field on the
same read-modify-write update/reset payload as `default_dash_col_widths`).

`my-page.html`'s dashboard is intentionally kept to a fixed 3-column grid — resize
and reorder only, no layout-count picker. An earlier iteration briefly added a
3열/4열 switch here (`#dashColCountSelect`, `body.dash-cols-4`, a 4th
`.dash-col-extra`/`.dash-col-resize-handle.dash-handle-extra`, `dash_col_count`
persistence) but that was corrected: a true multi-row×column grid layout picker
belongs on "대시보드" (`my-custom-page.html`)'s declarative `LAYOUTS` system
instead (see below), since that page's cells sit in fixed grid areas whereas
`my-page.html`'s blocks free-stack vertically within a column — a real
row×column layout switch would need much more invasive changes to the
drag/reorder code here for comparatively little benefit.

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
`custom-page-chat` Edge Function (which the "대시보드 도우미" chatbot uses to
validate/describe widgets it can place). Adding a widget means updating both.

The 위젯 배치 dropdown (`#selCell`/`#selWidget`/`#btnPlaceWidget`) has a
"— 빈 칸으로 두기 —" option (empty-string `value`) prepended ahead of the real
`WIDGETS` entries by `populateWidgetSelect()` — it's UI-only, not a real widget
key, so it's **not** added to the `WIDGETS` map itself (nothing should be able to
"place" it via the chatbot's widget tool either). Selecting it and clicking 배치
`delete`s that cell from `pageState.cells` rather than setting it to some
`{type:'empty'}` value, so `renderCellContent()`'s existing `!v || !v.type` branch
(already used for a cell that was never assigned anything) renders it exactly the
same as a never-configured cell — no separate "emptied" state to keep in sync.

When redeploying `custom-page-chat` (or any Edge Function originally deployed
with `verify_jwt: false`), pass `verify_jwt: false` explicitly — the deploy
tool defaults it to `true`, which would make the platform reject the function's
own CORS `OPTIONS` preflight before the function's manual
`admin.auth.getUser(token)` check ever runs.

`LAYOUTS` includes wide 4-column entries — `layout8` (4×2 격자, 8 cells) and
`layout9` (4×3 격자, 12 cells) — for teachers who want more cells than the
original 3-column layouts fit. The grid/resize code (`renderGrid()`,
`setupResizeHandles()`, `trackPxSizes()`, `boundaryPositions()`, `parseTracks()`,
`effectiveTemplate()`) is fully generic and derives column/row counts from each
layout's own `columns`/`rows` string at runtime, so adding these needed no
resize-logic changes. `renderGrid()` toggles a `body.mp-wide-layout` class
whenever the active layout has 4+ columns (`parseTracks(layout.columns).length
>= 4`), which widens `.wrap`'s `max-width` from `1180px` to `1880px` via CSS —
mirroring the widening pattern `my-page.html` briefly used for its own (since
reverted) 4-column experiment, but scoped correctly to this page. As with any
`LAYOUTS` change, `layout8`/`layout9` were also added to the mirrored
`LAYOUTS` map inside the `custom-page-chat` Edge Function (`name`+`cells` only,
no CSS properties needed there) and the function was redeployed — see the
sync note above.

## AI provider strategy: Claude first, Gemini fallback (all AI-calling Edge Functions)

The user pays for Claude API access directly (Supabase secret `CLAUDE_API_KEY`,
alongside the pre-existing `GEMINI_API_KEY`). Every Edge Function that calls an
LLM for actual text generation (not embeddings — see below) tries Claude first
and only falls back to the pre-existing Gemini code path if the Claude call
throws (network failure, non-2xx including 429 quota exhaustion, or the key
being unset). This is a deliberate product decision, not a cost-driven
default — Claude is preferred, Gemini is the safety net.

- **Model**: two tiers, both called via raw `fetch()` to
  `https://api.anthropic.com/v1/messages` (`anthropic-version: 2023-06-01`,
  `x-api-key: CLAUDE_API_KEY`) — matching this repo's existing convention of
  no SDK dependencies in Edge Functions. `claude-sonnet-5-5` is used for the
  flagship/complex functions (`chat-teacher`, `personal-bot-chat`,
  `custom-page-chat`, `student-bot-chat` — these used `claude-opus-5-5`
  originally, swapped to Sonnet 5.5 by explicit user request to try it as the
  default "best" tier; revert to Opus if quality turns out worse).
  `claude-haiku-4-5-20251001` is used for every simple/single-call function
  (`refine-suggested-questions`, `summarize-messages`, `week-brief-summarize`,
  `refine-chat-doc-text`, `bot-session-summarize`, `chatbot-builder-assistant`,
  `auto-label-messages`, and the `classifyDocument` step inside
  `chat-teacher-ingest` — these used `claude-sonnet-5-5` before this same
  request lowered them a tier). This is a deliberate, user-directed choice
  of model per function, not an automatic cost optimization — don't change
  either tier's model without being asked.
- **Embeddings stay Gemini-only** (`gemini-embedding-001`) in every function
  that does RAG (`chat-teacher`, `personal-bot-chat`, `student-bot-chat`, and
  the three `*-doc-ingest` functions) — Claude has no embeddings API, so there
  is nothing to fall back from there.
- **Pattern for a single-call function** (`summarize-messages`,
  `week-brief-summarize`, `refine-suggested-questions`, `refine-chat-doc-text`,
  `bot-session-summarize`, `chatbot-builder-assistant`, and the `classifyDocument`
  step inside `chat-teacher-ingest`): build the prompt once, `try { await
  callClaude(prompt) } catch { await callGemini(prompt) }`, then run the same
  parsing/validation logic on whichever raw text came back. A function that
  expects JSON back appends an explicit "반드시 JSON 형식으로만 답하세요" instruction
  to the Claude call (Claude has no `responseMimeType: 'application/json'`
  equivalent — Gemini's `generationConfig.responseMimeType` still gets used on
  the Gemini-fallback path) and parses with a lenient `extractJson()` helper
  (plain `JSON.parse`, or a substring between the first `{` and last `}` if
  that fails) rather than trusting the model to never wrap its answer in
  prose or a code fence.
- **Pattern for a multi-turn/chat function** (`personal-bot-chat`,
  `custom-page-chat`): the existing Gemini `contents` array
  (`{role: 'user'|'model', parts: [{text}]}`) is converted to Claude's
  `messages` shape (`{role: 'user'|'assistant', content: string}`) by a small
  per-function `callClaude(systemInstruction, contents)` — `role: 'model'` →
  `'assistant'`, and each turn's `parts` are joined into one string. Both
  functions keep their existing prompt-tag/JSON-parsing logic (`custom-page-chat`'s
  `<action>{...}</action>` regex, `personal-bot-chat`'s plain-text reply)
  unchanged — only which provider produced the raw text differs.
- **`chat-teacher` is the one function with real tool-calling** (function
  declarations `search_calendar_events`/`find_document`/`remember_fact`/
  `add_todo`/`summarize_messages`) and needed a heavier rework: `TOOL_SPECS`
  defines each tool once, `toGeminiFunctionDeclarations()`/`toClaudeTools()`
  convert it to each provider's schema shape, and `executeTool(name, args, ctx)`
  is the single shared dispatcher both `runClaudeLoop()`/`runGeminiLoop()`
  call — so the actual business logic (inserting a task, saving a fact,
  signed-url lookup, etc.) exists in exactly one place regardless of which
  provider is driving the conversation. Claude's tool loop uses
  `output_config: {effort: 'medium'}` — chosen deliberately over a lower
  effort level, since this is the flagship, most tool-heavy function and
  correct tool selection matters more here than shaving cost; this predates
  and is independent of the Opus→Sonnet model swap above, so it was left
  as-is when the model changed. The web-search fallback (`runWebSearchFallback`)
  is unchanged and always uses Gemini's `google_search` grounding tool
  regardless of which provider produced the primary answer — Claude has no
  equivalent grounding tool in this codebase's usage.
- **`student-bot-chat`'s `chat` action streams tokens** (`bot.html` appends
  raw response bytes directly with no SSE parsing of its own), so its fallback
  decision has to happen *before* committing to a response stream, not mid-stream:
  `startClaudeStream()` opens a `stream: true` request to `/v1/messages` and
  returns `null` (never throws) on any non-ok response or network failure;
  the caller falls back to the pre-existing Gemini `streamGenerateContent`
  request only when that's `null`. Once a stream is committed to, a single
  `ReadableStream` reader loop parses **both** providers' SSE framing (both
  send `data: {json}\n\n` lines, but the JSON shape differs — Claude's
  `content_block_delta`/`delta.text_delta.text` vs. Gemini's
  `candidates[0].content.parts[].text`) and re-emits only the extracted text
  deltas as raw bytes, exactly as before. A failure *after* the stream has
  started (either provider) just ends the stream early with whatever text
  had already been sent — this already-existing limitation wasn't changed.

**Incident: `chat-teacher` was silently falling back to Gemini on every
single call.** An admin noticed `ai-usage.html` showed only Gemini usage for
`chat-teacher` and asked why. `query_logs` showed every Claude call failing
with `400: 'claude-sonnet-5-5' does not support the \`speed\` parameter. This
feature is only available on supported models.` — the deployed
`runClaudeLoop()` was sending `speed: 'fast'` in the request body plus an
`'anthropic-beta': 'fast-mode-2026-02-01'` header (a "fast mode" feature,
apparently added for `claude-opus-5-5` back when that was the model here —
an earlier log entry from the same day shows a 429 specifically naming
`claude-opus-5-5`'s fast-mode token quota), but neither was removed when the
model was swapped to `claude-sonnet-5-5`, which doesn't support `speed` at
all. Since `runClaudeLoop()` throws on any non-ok response and the caller
catches that and falls through to Gemini, this bug was invisible from the
teacher-facing side (every chat still got an answer) and only showed up as
"why does ai-usage.html say Gemini" days later. **Fixed** by removing both
the `speed` field and the `anthropic-beta` header from `chat-teacher`'s
Claude request, going back to plain `output_config: {effort: 'medium'}` —
matching the pattern every other Claude-calling function already uses (none
of `personal-bot-chat`/`custom-page-chat`/`student-bot-chat` ever had the
`speed`/fast-mode addition, so this was isolated to `chat-teacher`).
Redeployed as version 40. If `ai-usage.html` ever again shows a function as
100% one provider when it's supposed to be Claude-first, check
`query_logs` for that function's own `"Claude API failed, falling back to
Gemini:"` console.error line (or whatever each function's own catch-block
logs) before assuming it's a quota/outage issue — a parameter the model
doesn't support fails exactly as "shouldn't happen but keeps replying" as a
real outage would, from a teacher's point of view.

**Incident: `student-bot-chat` occasionally streamed literal `<invoke
name="think"> </invoke>` tool-call-syntax to a student, repeated hundreds of
times until it ate the whole `max_tokens` budget.** A teacher screenshotted a
student session (`bot.html`) where the assistant's reply was nothing but that
repeated tag instead of an actual answer. `ai_usage_log` confirmed it: one
call in that session had `output_tokens: 4096` — it hit the hard cap
mid-generation rather than ending normally, which is what you'd expect if the
model got stuck emitting the same token sequence in a loop and never reached
a stop condition. Root cause: `startClaudeStream()`'s request body carried
`output_config: { effort: 'low' }` even though this function defines **no
tools at all** (unlike `chat-teacher`, which also sets an `effort` value but
pairs it with a real `tools` array) — sending a reasoning-effort knob with no
tool schema for the model to actually invoke is the likely trigger for the
model trying to express an internal "think" tool call as literal text and
never recovering. Scoped by querying `ai_usage_log` for `output_tokens >=
3900` across the trailing 7 days: out of 739 `student-bot-chat` calls, exactly
one hit the cap — rare, but a real student saw broken output from it. **Fixed**
by dropping `output_config` entirely from `student-bot-chat`'s Claude request
(redeployed as version 25) — this function doesn't need an effort tier since
it was never doing tool-assisted reasoning to begin with. Unlike the `speed`-
parameter incident above, this wasn't a hard API rejection (the call returned
200 and streamed real tokens, so `ai_usage_log` alone didn't flag it — the
giveaway was `output_tokens` pinned at the `max_tokens` ceiling, not a provider
mismatch). If a similar "pinned at max_tokens" pattern shows up again in any
Claude-calling function, check whether `output_config.effort` is set without a
matching `tools` array before assuming it's just a verbose answer.

**Two Edge Functions were found completely broken (`"SEE_FILE"`-corrupted
deployed source — see the `student-bot-chat` incident already documented
below) while rolling this out**: `chat-teacher` and `auto-label-messages`
were both throwing `ReferenceError: SEE_FILE is not defined` on every
invocation (confirmed via `query_logs`, not just a guess). Both were
reconstructed from scratch — using this file's own documentation of their
contracts, the live DB schema, sibling functions' conventions, and (for
`chat-teacher`) `chatbot-teacher.html`'s actual request/response shape — with
the Claude-first pattern above folded in at the same time, and redeployed.
No independent test invocation of either could be run from this environment
(outbound network to `*.supabase.co` is blocked from this sandbox), so the
usual advice applies: watch `messages.html`'s 자동 라벨링/자동 분류 and
`chatbot-teacher.html` for the first real uses after this change.

## AI usage logging (`ai_usage_log` table + `ai-usage.html`)

Every Edge Function that makes an actual text-generation call (Claude or
Gemini — not an embedding call; RAG embeddings are never logged, per the
"Embeddings stay Gemini-only" note above) fires a non-blocking insert into
`ai_usage_log` right after a successful response: `function_name`,
`provider` (`'claude'`|`'gemini'`), `model`, `user_id` (nullable — the
Supabase Auth uid when the caller is a logged-in teacher), `actor_label`
(nullable — used instead of `user_id` for callers with no Supabase Auth
session), `input_tokens`/`output_tokens` (from Claude's `data.usage` or
Gemini's `data.usageMetadata`), and `cache_creation_input_tokens`/
`cache_read_input_tokens` (Claude only, `null` for Gemini calls). Each
function defines its own small `logAiUsage(admin, {...})` helper
(`admin.from('ai_usage_log').insert(...).then(() => {}, e => console.error(...))`)
rather than sharing one across functions, matching this repo's usual
copy-paste-per-function convention for Edge Functions (which have no shared
module system either). A failed insert is only logged to the console, never
surfaced to the caller — usage logging must never be able to break an actual
AI reply.

- **Single-call functions** (`week-brief-summarize`, `chatbot-builder-assistant`,
  `personal-bot-chat`, `custom-page-chat`, and the `classifyDocument` step in
  `chat-teacher-ingest`) log once per request, right after the Claude or
  Gemini call that produced the reply.
- **`chat-teacher`'s tool-calling loop** (`runClaudeLoop`/`runGeminiLoop`) can
  make several API calls per user turn (once per tool round-trip, up to
  `MAX_TOOL_LOOPS`), so both loops accumulate `inputTokens`/`outputTokens`
  (and, for Claude, the two cache token fields) across every iteration and
  return them alongside the final text; one `logAiUsage` call fires after the
  loop resolves, with the summed totals. `runWebSearchFallback` (the separate
  Gemini call with the `google_search` grounding tool, used when the primary
  answer looks like a "couldn't find it") is a genuinely separate billable
  call, so it logs under its own `function_name` — `'chat-teacher-websearch'`,
  not `'chat-teacher'` — so the two can be told apart when reviewing usage.
- **`student-bot-chat`'s streaming `chat` action** has no single response
  object to read `usage`/`usageMetadata` off of — token counts arrive as part
  of the SSE stream itself. The reader loop's `evt` parsing was extended to
  also capture usage fields as they stream by: Claude's `message_start` event
  carries `message.usage.{input_tokens, cache_creation_input_tokens,
  cache_read_input_tokens}` and `message_delta` carries `usage.output_tokens`;
  Gemini's chunks carry `usageMetadata.{promptTokenCount, candidatesTokenCount}`
  (usually only populated on the final chunk, but every chunk is checked so a
  provider that changes when it sends this can't silently break the count).
  Since a student bot session has no Supabase Auth user, `logAiUsage` is
  called with `userId: null` and an `actorLabel` built from the bot's title
  plus the student's collected name/학번 (e.g. `"수학 탐구 챗봇 - 홍길동(10203)"`,
  or `"익명"` if the bot doesn't collect a name) — this is the one function
  that actually uses the `actor_label` column rather than `user_id`. The log
  call happens in the stream's `finally` block, after the assistant's full
  reply has already been saved to `custom_bot_messages`.

**`ai-usage.html`** is the admin-only page that reads this table back
(RLS on `ai_usage_log` has no client-facing insert policy at all — every
insert goes through the service-role key inside an Edge Function — and its
one `ai_usage_log_select_admin` policy gates `select` on
`current_user_is_admin()`, so the page queries the table directly with
`sb.from('ai_usage_log')` rather than needing its own RPC/Edge Function).
Reached the same way `member-admin.html`/`teacher-groups.html` are — an
admin-only tool-card on `admin-tools.html` and an `adminOnly: true` entry in
`nav.js`'s `EXTRA_SEARCH_ITEMS`, not a top-level `DEFAULT_NAV_ITEMS`/
`index.html` tile. A period `<select>` (오늘/최근 7일/최근 30일/전체, default
최근 7일) re-fetches from Supabase on change (pushed down as a
`created_at >= ...` filter, capped at 20,000 rows — this table is new and
low-volume, so no server-side aggregation was needed yet); a function-name
`<select>` (populated from whatever distinct `function_name` values the
fetched rows actually contain) re-filters the already-fetched rows
client-side with no refetch, same "filter what's already loaded" pattern
`room-booking.html`'s 교실별/위치별 필터 uses. Three tables, all aggregated
client-side over the filtered rows: **기능별 집계** (keyed by
`function_name|provider|model`, so `chat-teacher` and
`chat-teacher-websearch` — or a Claude vs. Gemini-fallback split of the same
function — show as separate rows), **로그인 사용자별 집계** (keyed by
`user_id`, rows with no `user_id` excluded; a second `profiles` query
`.in('id', ids)` on just the distinct ids present joins in display names —
a `user_id` with no matching profile, e.g. a deleted account, falls back to
showing a truncated id rather than breaking the row), and the **학생 챗봇
사용량** card (rows with a `user_id` excluded — this is where
`student-bot-chat`'s rows land, since those have no Supabase Auth user).
`parseActorLabel(label)` splits `actor_label` back into `{bot, name,
studentNo}` — it's written by `student-bot-chat` as `` `${bot title} -
${student name}(${student no})` ``, so the parser finds the **last**
`' - '` in the string (not the first) specifically so a bot title that
itself contains `' - '` — e.g. `"국어 - 문학 챗봇"` — still splits correctly
into the bot title and the name/학번 part. Two tables share this card: a
**학생별 합계** table keyed by `name|studentNo` alone, which sums a
student's usage across every different bot they used (answering "how much
did this specific student use, in total" rather than per-bot), and a
**챗봇별 합계** table keyed by `parseActorLabel(label).bot` alone — one row
per chatbot, summing every student's usage of that bot (plus an "이용 학생
수" column, a distinct count of `name|studentNo` combinations seen for that
bot). This table used to be keyed by the *full* `actor_label` (one row per
bot+student combination, "챗봇별 세부 내역") — per explicit feedback that a
per-student breakdown was already redundant with 학생별 합계 directly above
it, it was simplified to a pure per-bot aggregate with no 이름/학번 columns
at all, rather than adding a filter or a bot-picker dropdown (the two other
options raised) — since the user's own stated preference was "그냥 챗봇에서
사용한 학생들의 전체 사용량을 보여주는 걸로". An "이름 또는 학번으로 검색" text
input (`studentSearchFilter`, substring match against the parsed
`name`/`studentNo`, re-filtering client-side on every keystroke — no
refetch) still narrows both tables at once (filtering which raw rows get
aggregated into 챗봇별 합계, even though that table itself no longer shows
names), so an admin can still narrow 학생별 합계 by name/학번 while 챗봇별
합계 reflects just the matching subset's totals. All
tables and the stat tiles above them re-render from the already-fetched
`allRows` array whenever the function filter or the student search changes;
only the period filter triggers a real
Supabase query.

**로그인 사용자별 집계** and **학생별 합계** are paginated (the other two
tables, 기능별 집계/챗봇별 합계, are not — those stay small in practice).
Each has its own `userPage`/`userPageSize` and `studentPage`/`studentPageSize`
module-scope state (default page size 20), a shared `paginationHtml(prefix,
total, page, pageSize)` helper rendering a page-size `<select>` (exactly
10/20/30/50/100, matching the explicit request — not an arbitrary set) plus
이전/다음 buttons and a "N / M페이지 (총 K명)" status line, appended right
after each table inside the same `innerHTML` render. Since the table (and its
pagination controls) are fully replaced on every render, click/change
handling for 이전/다음/페이지-크기 is one pair of delegated listeners on
`document` (matched via `.pg-prev`/`.pg-next`/`.pg-size-select` +
`data-pg-prefix="user"|"student"` ) rather than re-attached per render.
Pagination is purely a client-side slice of the already-sorted `entries`
array — no refetch on page/size change, same "filter what's already loaded"
principle the function/student filters already use. Changing the page size
resets that table's own page back to 1; changing the 기능 필터, the 기간
필터(which also refetches), or the 학생 검색 box all reset **both** tables'
pages back to 1 where relevant (기간/기능 changes affect both tables' row
sets; 학생 검색 only resets `studentPage`, since it doesn't touch the teacher
table) — otherwise a page number left at, say, 3 could silently show an
empty table once a filter shrinks the row count.

**예상 비용 (`app_settings.ai_model_pricing`, admin-editable, no hardcoded
rates).** Anthropic/Google's actual $/token billing rate for a given model
isn't something this codebase can know on its own — rates change, and
hardcoding a guessed number would silently mislabel real spend as fact. So
instead of baking in fixed prices, a "모델별 단가 설정" card (right below the
기간·기능 필터 card, above 기능별 집계) lets an admin type in the $(USD) price
per 1M(백만) tokens for each `provider|model` combination that has actually
appeared in `ai_usage_log` — four inputs per row (입력/출력/캐시 생성/캐시
읽기 $ per 1M), matching the four token fields already recorded. Saved as a
single jsonb map keyed by `` `${provider}|${model}` `` in the new
`app_settings.ai_model_pricing` column (same single-row/RLS pattern as every
other site-wide setting in this file — "anyone select, admin update" — reused
as-is even though this page is already admin-gated end to end). The pricing
form is built from the **union** of `Object.keys(pricing)` and every
`provider|model` pair in the currently-fetched `allRows` (`allKnownPriceKeys()`)
rather than just the latter, so a model priced once doesn't silently vanish
from the settings UI just because the currently-selected 기간 filter happens
to have no rows for it. Saving is a plain read-then-write of the whole map
(`savePricing()`, one `app_settings.update` call) — it starts from a shallow
copy of the existing `pricing[key]` object per row rather than an empty one,
so leaving one of the four fields blank on an otherwise-filled row clears
just that field instead of dropping the other three.

`costForRow(r)` computes one row's cost as `input_tokens/1e6 * inputPrice +
output_tokens/1e6 * outputPrice + cache_creation_input_tokens/1e6 *
cacheWritePrice + cache_read_input_tokens/1e6 * cacheReadPrice` via
`priceFor(provider, model)` (defaults every field to `0` when nothing's been
entered yet, so an unpriced model just contributes $0 rather than throwing or
showing `NaN`). This is folded straight into the existing `aggregate()`
helper (one more accumulated field, `agg.cost`) so every aggregated table gets
cost for free, plus into `renderStatGrid`'s total. A 예상 비용 column/tile was
added to all four tables (기능별 집계, 로그인 사용자별 집계, 학생별 합계, 챗봇별
합계) and the stat grid — `기능별 집계`'s breakdown by
`function_name|provider|model` is specifically what answers "비용이 모델에
따라 얼마씩인지" ( cost broken out per model), since that's the one table
already keyed by model. `fmtCost(n)` shows 4 decimal places below $1 (token
costs are routinely sub-cent) and 2 decimals at or above $1, always prefixed
`$` — there's no ₩ conversion, since Claude/Gemini billing itself is in USD.
Gemini rows always have `cache_creation_input_tokens`/`cache_read_input_tokens`
at `0`/`null` already (prompt caching is a Claude-only concept in this
codebase's usage), so leaving a Gemini model's 캐시 생성/읽기 price fields
blank has no effect on its cost regardless.

**학생 챗봇 AI 모델 설정 (`app_settings.student_bot_model`) — admin toggle
between Sonnet and Haiku for `student-bot-chat`.** An admin noticed the
student-facing chatbot (`bot.html` / `student-bot-chat`) was burning through
more Claude tokens than expected and wanted a cost/quality lever without
redeploying the Edge Function every time. `student-bot-chat` used to hardcode
`const CLAUDE_MODEL = 'claude-sonnet-5-5'`; this was replaced with
`DEFAULT_CLAUDE_MODEL` (same value, used only as the fallback) plus a new
`resolveClaudeModel(admin)` helper that reads `app_settings.student_bot_model`
on every `chat` request and falls back to the default when it's null/empty —
no RPC needed, since `app_settings` already has "anyone select, admin update"
RLS and this read happens server-side with the service-role client anyway.
The resolved model is threaded through `startClaudeStream()` and into the
`logAiUsage()` call (so switching models is immediately visible in
ai-usage.html's per-model breakdown, not just a silent behavior change). A
new "학생 챗봇 AI 모델 설정" card on **ai-usage.html** (right above 모델별 단가
설정, same admin-only page) holds a plain two-option `<select>` — 소넷
(`claude-sonnet-5-5`, 기본값) / 하이쿠 (`claude-haiku-4-5-20251001`, 비용 절감,
the same exact model string `chatbot-builder-assistant` already uses) — and a
저장 button that does a single `app_settings.update({student_bot_model})`
call, mirroring the pricing card's save pattern. This only affects
`student-bot-chat`'s own Claude call; every other Claude-calling Edge
Function keeps its own hardcoded model per the "AI provider strategy"
section below, and the Gemini fallback path (triggered whenever the Claude
call fails, regardless of which Claude model was selected) is untouched.

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
- **RAG sources carry a subtitle/page when available.** `chat-teacher-ingest`'s
  `chunkText()` already prefixes a chunk's stored `content` with `[heading]\n` when
  it detects a heading-looking paragraph right before it (see `withHeading()`), and
  the client-side PDF chunking pipeline (see the PDF section below) sets a real
  `page_number` per chunk — so no new column was needed for headings, just
  extraction at query time. `match_chat_chunks` additionally selects `page_number`
  (added via a `DROP FUNCTION` + recreate migration, since Postgres can't
  `CREATE OR REPLACE` a function's return-column list). `chat-teacher` extracts each
  RAG match's heading with `content.match(/^\[(.+?)\]\n/)`, and — since matches come
  back ordered by similarity — keeps only the first (highest-similarity) chunk's
  `{heading, page}` per document title in a `ragDocTitles` → info map. `sources` is
  no longer always `string[]`: a RAG-sourced title that actually has a heading or
  page is emitted as `{title, heading?, page?}`; every other source (site-menu
  guide, weekplan, calendar, approved facts, web-search results) stays a plain
  string, exactly as before. Both shapes are valid inside the same `sources` array
  (jsonb, so no schema change needed for `chat_messages.sources` /
  `chat_faq_cache.sources`), and `chatbot-teacher.html`'s `renderSources()` handles
  both — a string renders as before (plain text, or a link if it matches the
  `"제목 (URL)"` web-source pattern), an object renders as `제목 — 소제목 (p.5)` with
  the heading/page parts omitted when absent. This also keeps old rows saved before
  this change (plain strings only) rendering correctly.
- Suggested-question chips come from `top_asked_questions(p_limit, p_min_count)`;
  only questions asked `p_min_count` times or more are shown, and the UI reveals
  them progressively (2 by default, "더보기" for the rest) rather than all at once.
- Speech-to-text input dedupes on the *text*, not on `SpeechRecognition`'s
  `resultIndex`/`isFinal` fields — in practice the browser sometimes re-emits an
  already-finalized segment as a longer/duplicate "final" result, so naively
  trusting `isFinal` produces repeated words. The fix compares each new segment
  against the previously accumulated text and only appends genuinely new content.
- **마이크로 듣는 중에 "보내기" 버튼(또는 Enter)을 바로 눌러도 음성 인식이
  멈춘다 — 예전엔 마이크 "중지" 버튼 자신의 클릭 핸들러에만 멈추는 로직이
  있어서, 다른 경로로 전송하면 녹음이 계속 듣고 있는 상태로 남아있었다.**
  `sendMessage()` 맨 앞(`sending = true` 전)에 `if(listening && recognizer)` 가드를
  추가해, 전송 경로가 무엇이든(보내기 버튼 클릭, Enter 키) 녹음 중이면
  `recognizer.stop()`을 호출하고 `listening = false`로 바꾸고 마이크 버튼의
  시각 상태도 직접 되돌린다 — 마이크 버튼 자신의 클릭 핸들러가 가진
  멈추기+전송 로직과는 별개의, `sendMessage()` 쪽에서 선제적으로 멈추는
  경로다.
- **마이크 "중지" 버튼으로 전송한 뒤에도 입력창에 같은 내용이 다시 채워지는
  버그 — `SpeechRecognition.stop()`은 동기적으로 인식을 끝내지 않는다.**
  `recognizer.stop()`을 호출해도 브라우저가 그 직전까지 듣던 음성을 비동기로
  한 번 더 `'result'` 이벤트로 늦게 보내올 수 있다 — `sendMessage()`가 이미
  입력창을 비우고 전송을 마친 뒤에 그 뒤늦은 이벤트가 도착하면, 그 핸들러가
  다시 `el('chatInput').value = ...`로 입력창을 채워버려서 "전송했는데 같은
  내용이 또 남아있다"처럼 보였다. 고쳐서 `'result'` 핸들러 맨 앞에
  `if(!listening) return;` 가드를 추가했다 — 멈추기를 요청한 시점(마이크
  중지 버튼이든, 바로 위 항목의 `sendMessage()` 쪽 선제 멈추기든)에 이미
  `listening`을 `false`로 바꿔두므로, 그 이후 늦게 도착하는 모든 `'result'`
  이벤트는 조용히 무시된다. `test_chatbot_teacher_mic_send.js`(가짜
  `SpeechRecognition` 스텁, `_emit()`으로 임의 시점에 `'result'` 이벤트를
  수동으로 발생시켜 이 레이스를 직접 재현)로 (1) 음성 입력 중 "보내기"를
  누르면 `recognizer.stop()`이 호출되고 listening이 꺼지는지, (2) 전송 후
  입력창이 비워지는지, (3) 그 뒤 도착하는 뒤늦은 result 이벤트가 입력창을
  다시 채우지 않는지, (4) 마이크 중지 버튼으로 전송한 경우도 동일하게
  동작하는지 — 네 가지 모두 검증했다.
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
  `messages.html` has a "🤖 챗봇 참고자료로 보내기" action (per-message and as a
  bulk checkbox action), open to **any logged-in (approved) teacher** — not just
  admins. It never uploads a message's raw text directly — the click opens a
  review queue (`openChatRefQueue`, one modal, reused for both the single-message
  and bulk cases) showing an editable title/content prefilled from the message.
  The sender can hand-edit it, or click "✨ AI로 다듬기" to have the
  `refine-chat-doc-text` Edge Function (Gemini, strips greetings/signatures and
  condenses multi-person chat into plain statements without inventing facts)
  rewrite it first — nothing is sent until "이 내용으로 보내기" is clicked for that
  item, and only the current (possibly edited) text is what actually gets
  uploaded. Bulk selection just queues multiple messages through the same modal
  one at a time ("건너뛰기" skips an item without sending). The upload itself
  (`sendChatDocText`) is the same sequence `chatbot-teacher.html`'s "텍스트
  직접 입력" tab uses: upload a text `Blob` to the `chat-teacher-docs` storage
  bucket, insert the `chat_documents` row (tagged `category: '메신저'`), then call
  `chat-teacher-ingest` with the new `documentId` to chunk+embed it. Reuse
  `sendChatDocText` for any future "send this as chatbot reference material"
  feature elsewhere — but keep the review-before-send step, since the whole point
  is that nothing goes into the chatbot's knowledge unedited and unconfirmed.

  **Admin-only gate removed (both button visibility and server-side).** This
  feature originally hid the button behind `profile.is_admin` in `messages.html`
  and separately enforced `is_admin` again inside `refine-chat-doc-text` — per
  explicit request to open it to every logged-in teacher, both gates were
  dropped at once. In `messages.html`, `isAdmin` was removed entirely (it had no
  other use on that page) — `#msgBulkChatbotRef`'s `display:''` and the
  per-message `<button data-act="chatbot-ref">` now render unconditionally once
  `mainView` shows. **This needed a matching server-side change, not just a UI
  tweak** — `refine-chat-doc-text` (the "✨ AI로 다듬기" call) still checked
  `profiles.is_admin` and returned 403 `"관리자 계정만 사용할 수 있습니다."`, so a
  non-admin would have seen the button, opened the review modal, and then hit a
  wall the moment they clicked "다듬기" (editing by hand and sending directly
  would still have worked, since that path only ever went through `chat_documents`'
  `insert` RLS, which already only required `current_user_is_approved()` — see
  `chat_documents_insert_approved` policy — never admin). Fixed by swapping that
  function's `profiles.select('is_admin')` + `is_admin` check for
  `profiles.select('approved')` + `approved`, redeployed as version 7. No client
  change was needed for this half — `messages.html` already sends the same
  bearer token regardless of admin status. There is still no separate management
  UI for "sent-to-chatbot" reference items — deleting one was already possible
  (and still is, unchanged) via `chatbot-teacher.html`'s own "자료 목록" tab,
  which has never been admin-gated (any approved teacher can delete any shared
  doc there, per its own comment: "승인된 선생님이면 누구나 파일을 교체·삭제할 수
  있어요") — `messages.html`-sent docs just show up there tagged `category:
  '메신저'` like any other upload.

## Chatbot "답변 기다리는 중" indicator — animated three-dot pulse, not static text

Every chat UI on the site (`chatbot-teacher.html`, `bot.html`, `my-bot.html`,
and `nav.js`'s two floating-assistant fabs — 대시보드 도우미 in
`buildGlobalChat()` and 수업용 챗봇 만들기 도우미 in `buildBuilderAssistantFab()`)
showed a plain static string — "생각하는 중..." or "생각 중…" — while waiting
for the AI's reply, with no visual cue that anything was actually happening
versus the page being stuck. Per explicit request for "점 세 개 밝기가
변하면서 진행중임을 보여주는 표시" (the classic chat-app "typing" indicator —
three dots pulsing in sequence), all five were replaced with the same
`.ks-typing-dots` markup/CSS pattern: three `<span class="dot">` elements
inside one `<span class="ks-typing-dots">`, each animated via
`@keyframes ksTypingDotPulse` (opacity/scale pulse, `1.2s infinite
ease-in-out`) with `animation-delay` staggered `0.2s` apart per dot so they
visibly ripple left-to-right rather than blinking in unison. Since this repo
has no shared stylesheet, the identical CSS block (`.ks-typing-dots`/`.dot`/
the keyframes) is copy-pasted into each of the three standalone HTML pages'
`<style>` blocks, and once into `nav.js`'s own injected `<style>` tag (shared
by both of its chat-fab builders, since they're in the same file) — same
copy-paste-per-page convention as every other shared-but-not-modularized
pattern in this codebase. Each page's own `appendTyping()`/typing-bubble
code just swapped a `div.textContent = '생각하는 중...'` (or the `nav.js`
builders' `typing.textContent = '생각 중…'`) for
`div.innerHTML = '<span class="ks-typing-dots"><span class="dot"></span>
<span class="dot"></span><span class="dot"></span></span>'` — no other logic
changed (the element is still appended/removed the same way once the reply
arrives or the request fails). `my-bot.html`'s version replaces what used to
be a plain static `'...'` three-character string with the same animated
markup, for consistency with the other four spots. Verified with
`test_typing_dots.js` that the three dots render and that
`getComputedStyle(dot).animationName` is actually `ksTypingDotPulse` (not
`none`), confirming the CSS keyframe is applied, not just present in the
stylesheet unused.

## `chat-teacher` can now search several other site pages directly, not just uploaded documents

The chatbot used to only answer from material someone deliberately uploaded
(RAG chunks, weekplan, approved facts) or from the fixed calendar window — a
question like "문서 양식 공유에 기안문 양식 있어?" or "3층 교실 오늘 비어있어?"
had no path to an answer even though the data already lives elsewhere on the
site, because re-uploading every page's content as a separate chatbot document
would mean maintaining it twice. Per explicit request ("문서 양식 공유에 있는
글들도 챗봇이 읽어서 참고하게 할 수 있어? ... 링크나 문서 양식 공유, 교사별 일정,
주간계획, 학사일정, 교실 사용 예약 현황 같은 것들도 페이지 내에 있는 질문들이니까
질문하면 바로 답변할 수 있으면 좋을 것 같은데. 사실 자료실도 마찬가지고"),
`TOOL_SPECS` gained five more Gemini-function-calling/Claude-tool entries that
each query the live table (or, for 업무링크/자료실, the relevant Apps Script)
directly at answer time — no separate ingest/embedding step, so the data is
always current and there's nothing to keep in sync:

- **`search_form_templates`** — `form_templates` `ilike` across
  title/category/content (admin client, so RLS doesn't gate it — this tool
  already only runs for an `approved` teacher, same trust level the page
  itself requires), returns up to 3 matches with `stripHtmlTags(content)`
  truncated to 800 chars (the rich-editor HTML from the section above would
  otherwise feed raw tags to the model for no benefit).
- **`search_links`** — fetches `LINK_HUB_SCRIPT_URL` (link-hub.html's own,
  separate Apps Script deployment — not the shared `SCRIPT_URL` collect.html/
  file-library.html use) with a plain GET, exactly like `link-hub.html`'s own
  `loadLinks()` does, and filters the returned array by name/desc/category
  substring server-side before returning the top 5.
- **`search_file_library`** — POSTs `{action:'librarySearch', query}` to the
  shared `SCRIPT_URL` (the same `librarySearch` action `file-library.html`'s
  own search already calls), returning up to 5 files (with their real
  `uc?export=download` link) and 5 folders.
- **`search_teacher_schedule`** — `staff` `ilike` on `name`, then reshapes
  `schedule` (the same `{day: {period: {subject, room}}}` shape documented
  under "teacher.html/teachers.html schedule data shape" above) into a short
  `"월: 1교시 수학(301), ..."`-style line per teacher, rather than handing the
  model raw nested JSON to parse.
- **`search_room_bookings`** — `room_bookings` filtered by `booking_date`
  (defaults to today if the model didn't pass a valid date) and, optionally,
  `room_name ilike`, returning each match's time range/title/teacher_name.

All five follow the exact same `{found: boolean, ...}` JSON-string return
convention the existing tools (`find_document`, `remember_fact`) already use,
and the system prompt's `[규칙]` section was extended with one more sentence
telling the model which tool to reach for per topic (문서 양식/업무 링크/자료실/
선생님 시간표/교실 예약) — `find_document` (챗봇 참고자료 전용) and
`search_file_library` (자료실 전체) are both mentioned together in that
sentence so the model doesn't conflate the two. Deployed as `chat-teacher`
version 41; redeploy the same way documented elsewhere in this file (never a
fresh deployment, always a new version of the existing function) if you touch
this again.

**`search_duty_roster`** was added later (a gap found while verifying a
user-shared checklist that asked for the chatbot to be able to search 학생
지도 당번/교사 시간표/학사일정/캘린더 — the other three already existed via
`search_teacher_schedule`/the calendar context+`search_calendar_events`, but
nothing queried `duty_roster`). Same shape as `search_room_bookings`: filters
`duty_roster` by `duty_date` (defaults to today if the model didn't pass a
valid `YYYY-MM-DD`) and, optionally, `zone ilike` (e.g. 정문/후문/중식/야자),
returning each match's `{zone, time, who}` — matching "오늘 정문 지도 누구예요?"
style questions. The `[규칙]` sentence above was extended with "...교실 예약
현황을 물어보면 search_room_bookings 도구를, 학생 지도 당번표를 물어보면
search_duty_roster 도구를, 할 일을 추가해달라고 하면..." to tell the model when
to reach for it. Deployed as `chat-teacher` version 43. Like every other
Edge Function change in this file, this could only be code-reviewed
(TypeScript-checked) and deployed from this sandboxed environment — there's
no outbound network to `*.supabase.co` here to invoke it end-to-end, so
watch `chatbot-teacher.html`'s real usage (or `query_logs`) for the first
actual uses.

## `chat-teacher`도 이제 등록(쓰기)이 된다 — 검색뿐 아니라 문서 양식/업무 링크/교실 예약을 챗봇이 직접 올릴 수 있음

바로 위 검색 도구들을 추가한 뒤 사용자가 명시적으로 물었다: "교사 챗봇에 문서양식
업무링크 맛집지도, 교실 예약, 할일 등을 등록하게하는것도 되는거야?" — 그 시점에는
`add_todo` 하나만 실제로 쓰기가 가능했고 나머지는 전부 검색(읽기) 전용이었다. 이후
"등록기능도 추가", "챗봇에서 등록 할 수 있게 해"로 두 번 더 명시적으로 확인받아
`TOOL_SPECS`에 쓰기 도구 세 개를 추가했다(`chat-teacher` version 42):

- **`register_form_template`** — `form_templates`에 바로 `insert`한다
  (`title`/`category`/`content` 모두 필수, `is_html: false`, `author_id`는
  호출자의 `uid`, `author_name`은 함수 맨 위에서 이미 조회해둔 `profile.name`을
  `ToolExecCtx`에 `teacherName`으로 실어 재사용 — `remember_fact`가 매번
  `profiles`를 다시 조회하던 것과 달리 한 번 조회한 값을 그대로 쓴다). RLS가
  `auth.uid() = author_id`만 요구하는 셀프-귀속 insert라, 서비스 롤 클라이언트로
  직접 `author_id: uid`를 넣는 것만으로 조건을 만족한다.
- **`register_link`** — `link-hub.html`의 "+ 새 링크 추가" 폼이 실제로 보내는
  요청(`{category, name, url, desc, mainShow}`, **`action` 필드 없음** — 삭제/수정은
  각각 `action:'delete'`/`action:'update'`를 보내지만, 새로 추가할 때는 `action`
  없이 이 다섯 필드만 보내는 게 그 페이지 자신의 코드로 확인된 유일한 "성공하는"
  요청 모양이다)를 그대로 `LINK_HUB_SCRIPT_URL`에 복제해서 보낸다. **이 Apps
  Script는 `collect-setup.md`에 소스가 문서화돼 있지 않아**(link-hub.html만의
  별개 배포, 이 저장소 어디에도 그 서버 쪽 코드가 없음) 요청 모양을 클라이언트
  코드에서 그대로 베껴 추론한 것 — 실제 배포 핸들러가 "action 없음 = 새로 추가"로
  정확히 분기하는지는 이 환경에서 직접 호출해 확인할 수 없었다(아래 참고).
- **`register_room_booking`** — `room_bookings`에 `insert`한다
  (`roomName`/`date`/`startTime`/`endTime`/`title` 모두 필수, 날짜/시간 형식과
  시작<종료를 먼저 정규식/문자열 비교로 검증). 로그인한 교사의 직접 예약 경로와
  동일하게 `teacher_id: uid, teacher_name`을 실어 보내고(비밀번호가 필요한 익명
  예약 RPC 경로는 쓰지 않음 — 챗봇 호출자는 이미 Supabase Auth로 로그인한
  `approved` 교사), 겹치는 예약(`23P01`, exclusion constraint)과 존재하지 않는
  교실 이름(`23503`, FK violation)을 각각 "이미 다른 예약이 있습니다"/"교실을
  찾을 수 없습니다"로 번역해 되돌린다 — 두 에러 코드 모두 이미 `room-booking.html`
  문서화된 그 테이블의 실제 제약과 일치한다.

**맛집 공유지도(`food_spots`)는 의도적으로 제외했다.** 스키마를 직접 조회해
확인한 결과 `food_spots.lat`/`lng`가 둘 다 `double precision NOT NULL`이고, 이
코드베이스 어디에도 서버 쪽(Edge Function/Apps Script) 지오코딩 기능이 없다
(food-map.html 자신의 위치 입력도 전부 브라우저에서 Kakao Maps JS SDK로 지도를
직접 클릭하거나 Kakao 장소검색 결과를 고르는 방식뿐 — 주소나 이름 텍스트만으로
좌표를 서버에서 알아낼 방법이 이 저장소에 전혀 없음). 주소 문자열만 받아서
좌표 없이 저장하는 건 `NOT NULL` 제약을 어기므로 불가능하고, 임의의 좌표를
지어내는 것도 당연히 받아들일 수 없는 선택이라 판단해 쓰기 도구를 만들지
않았다 — 대신 `SITE_MENU_GUIDE`에 food-map.html을 한 줄 추가하고(위치를
지도에서 직접 찍어야 한다는 설명 포함), 시스템 프롬프트의 `[규칙]`에 "맛집
등록 요청은 food-map.html에서 직접 하도록 안내하라"는 문장을 넣었다 — 챗봇이
아예 모르는 척하는 대신, 왜 안 되는지와 어디서 할 수 있는지를 정확히 안내하게
했다.

시스템 프롬프트의 `[규칙]`도 한 문장 추가해서, 선생님이 서식/링크/교실 예약을
"등록해줘/올려줘/예약해줘"라고 하면 검색 도구가 아니라 이 세 등록 도구를 쓰도록,
등록에 필요한 정보가 부족하면 먼저 물어보고, 등록 성공/실패 결과를 분명히
알려주도록 지시했다. 세 도구 모두 `add_todo`와 같은 패턴으로 확인 없이 바로
실행한다(별도의 "정말 등록할까요?" 왕복 없음) — 교사가 챗봇에 직접 요청한 것
자체가 이미 확인 단계이므로, 이 저장소의 기존 쓰기 도구(`add_todo`,
`remember_fact`)와 일관된 단순함을 유지했다.

**이 환경에서 직접 테스트할 수 없는 변경이다.** `*.supabase.co`로의 아웃바운드
네트워크가 이 샌드박스에서 막혀 있어(이 문서 다른 곳에도 반복 언급된 제약)
배포된 Edge Function을 직접 호출해 실제 AI가 이 세 도구를 올바르게 선택·호출하는지
확인할 수 없었다 — 코드 리뷰(문법 균형, RLS/제약 조건과의 일치, 기존 패턴과의
일관성)와 배포 자체만 이 환경에서 할 수 있는 전부였다. 특히 `register_link`의
요청 모양은 위에서 설명했듯 추론에 기반하므로, 실제로 `link-hub.html`에 새
링크가 안 생기면 가장 먼저 의심해볼 지점이다. 실제 사용 후 문제가 보이면
`query_logs`로 `chat-teacher`의 콘솔 에러(`register_* insert/link-hub search
failed` 등 각 분기의 `console.error` 라벨)를 먼저 확인할 것.

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

## Student-facing chatbot links use a separate, fixed domain

The main site is one Netlify deploy of this whole repo (teacher tools, admin
pages, everything). Student-facing `bot.html` pages (created via
`chatbot-builder.html`, PIN/slug-protected — see below) are additionally served
from `https://inspiring-macaron-9aabd8.netlify.app/`, a **second** Netlify site
deployed from this same repo/branch — same code and same Supabase backend, just a
separate domain so students never see or stumble into the teacher-only pages'
URLs. `chatbot-builder.html`'s `renderEditor()` builds the "학생 공유 링크"
(`shareUrl`) from a hardcoded `STUDENT_BOT_BASE_URL` constant rather than
`location.origin` — it used to be `location.origin`-based, which meant the
generated link's domain depended on which domain the teacher happened to have
`chatbot-builder.html` open on. Since this is a plain constant (not derived from
`app_settings` or any other per-request state), changing the student domain later
means editing that one constant and redeploying — no migration needed.

**학생 공유 링크 옆에 QR 코드도 함께 보여준다** (`chatbot-builder.html`'s
share-box, 링크+암호 복사 버튼들 바로 아래). 교실에서 학생들에게 링크를 타이핑
시키는 대신 QR 한 번 찍고 들어오게 하기 위한 순수 클라이언트 기능 — `shareUrl`
문자열을 그대로 인코딩할 뿐이라 서버 호출이나 새 테이블이 전혀 필요 없다.
`qrcodejs`(davidshimjs, npm 미러 패키지명 `qrcodejs`, jsdelivr:
`https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js`)를 쓴다 — **이
저장소에서 더 널리 알려진 `qrcode`(soldair/node-qrcode) 패키지를 쓰지 않은 이유**:
그 패키지는 `package.json`의 `files`가 `build`를 포함한다고 적어두고 있지만
실제로 npm에 배포된 tarball에는 `build/` 폴더가 들어있지 않아서(패키지 자체의
알려진 결함), `cdn.jsdelivr.net/npm/qrcode@.../build/qrcode.min.js` 같은 흔히
보이는 CDN 경로가 실제로는 404난다 — 직접 `npm pack`으로 받아서 확인하고 나서
dropped. `qrcodejs`는 `new QRCode(엘리먼트, {text, width, height,
correctLevel})` 호출 한 번으로 그 엘리먼트 안에 `<canvas>`를 직접 그려 넣는 구식
(생성자 기반) API라 `renderEditor()`가 다시 그릴 때마다(다른 챗봇으로 전환하거나
편집기를 다시 열 때) `#shareQrBox.innerHTML = ''`로 먼저 비워야 한다 — 안 비우면
같은 엘리먼트에 캔버스가 계속 누적돼서 겹쳐 그려진다. "QR 이미지 다운로드"
버튼은 그 안의 `<canvas>`를 찾아 `toDataURL('image/png')`로 변환해 임시
`<a download>` 링크를 클릭해주는 흔한 패턴 — 파일명은 `${챗봇 제목}_QR.png`.

**"QR 이미지 복사" 버튼도 있다** (다운로드 버튼 바로 옆, 먼저) — 파일로 내려받았다가
다시 첨부하는 과정 없이 한글/문서/메신저 등에 바로 Ctrl+V로 붙여넣을 수 있게 하기
위해서다. `navigator.clipboard.write([new ClipboardItem({'image/png': <Promise>})])`를
쓰는데, `canvas.toBlob()`의 콜백을 `ClipboardItem`에 **Promise로 감싸서** 넘기는
게 핵심이다 — 이렇게 하면 blob 생성이 비동기로 끝나더라도 `clipboard.write()` 호출
자체는 클릭 핸들러 안에서 동기적으로 이뤄진 것으로 브라우저가 간주해서, "사용자
동작(user gesture) 중에만 클립보드 쓰기를 허용"하는 보안 정책을 통과한다(`await
canvas.toBlob()`처럼 먼저 기다렸다가 `clipboard.write()`를 나중에 호출하면 이 정책에
걸려 실패하는 브라우저가 있다). `navigator.clipboard`나 `window.ClipboardItem`이 없는
구형 브라우저에서는 그냥 실패 메시지로 "QR 이미지 다운로드"를 대신 쓰라고 안내한다.

**챗봇 목록 카드(`.bot-row`)를 클릭하면 바로 편집 화면이 열린다 — 예전엔 행 오른쪽의
별도 "편집" 버튼(`.botEditBtn`)을 따로 눌러야 했다.** 이 행에서 할 수 있는 동작이
편집 하나뿐이라, 버튼 없이 행 전체를 누르는 쪽이 더 자연스럽다는 요청으로 바꿨다 —
`.bot-row`에 `cursor:pointer`를 주고 클릭 리스너를 (버튼이 아니라) 행 자체에
위임했고, 행 오른쪽엔 버튼 대신 단순한 `›` 화살표(`.row-arrow`, 클릭 핸들러 없음 —
순전히 "눌러서 들어갈 수 있다"는 시각적 힌트)만 남겼다. 이 변경으로 그동안
`.botEditBtn`을 클릭해 편집기를 열던 여러 테스트 파일(`test_bot_expiry_field.js`,
`test_bot_expiry_position.js`, `test_builder_assistant_fab.js`,
`test_chatbot_export_excel.js`, `test_chatbot_notes_teacher_view.js`,
`test_chatbot_qr.js`, `test_chatbot_qr_copy.js`, `test_student_bot_share_domain.js`,
`test_chatbot_builder_share.js`)가 전부 `.bot-row`를 클릭하도록 함께 고쳐져야 했다 —
`.bot-row .name` 같은 행 내부 요소를 읽는 부분은 구조가 안 바뀌어서 그대로 뒀다.

## Student chatbot sessions (`bot.html` + `student-bot-chat`) resume by name+학번

Each PIN entry on `bot.html` creates a `custom_bot_sessions` row identified by an
opaque `session_token`, kept client-side only in `sessionStorage` (per-tab, keyed
`ks_bot_session_<slug>`) — so a page refresh survives, but a closed tab or a
different device never did, and every re-visit used to start a brand-new, empty
session even for the same student. `student-bot-chat`'s `start` action now looks
up an existing session **only when the bot collects both name and 학번**
(`bot.collect_name && bot.collect_student_no`) — matching on both is required
because 학번 alone is reliably unique per student but name alone is not (동명이인),
so a single-field bot always starts fresh rather than risk merging two different
students' conversations under a typo or a shared name. When both are collected and
an exact `bot_id + student_name + student_no` match exists (picking the most
recently active one if a student somehow has more than one), the response carries
`resumed: true` plus up to `RESUME_HISTORY_LIMIT` (60) prior messages, which
`bot.html` renders into the chat view before the student sends anything new — so
returning to the same bot on any device, after any amount of time, continues the
same conversation instead of losing it. The AI's own context already worked this
way regardless (the `chat` action always reads `custom_bot_messages` by
`session_id`); this change is what makes the *student* see that same continuity
rather than just the model.

**Edge Function code has no backup outside Supabase itself — this bit us once.**
On 2026-09-29, `student-bot-chat`'s deployed source was found corrupted to the
literal 8-character string `SEE_FILE` (not a placeholder — the actual deployed
`index.ts` body), crashing every invocation with `ReferenceError: SEE_FILE is not
defined` and taking every student bot down (`bot.html` showed "서버에 연결하지
못했어요" for every PIN/message). Since this repo deliberately doesn't check Edge
Function source into git (see "Deployment / infrastructure" above), there was no
previous version to roll back to — recovery meant reconstructing the function
from scratch by cross-referencing this file's documentation, `bot.html`'s actual
request/response contract, the live DB schema (`custom_bots`/`custom_bot_sessions`/
`custom_bot_messages`/`custom_bot_chunks`, RLS policies, the `match_custom_bot_chunks`
RPC), and a working sibling function (`personal-bot-chat`) for shared conventions
(CORS headers, the `json()`/`corsHeaders()` helper shapes, Gemini call patterns).
The rebuilt function additionally documents behavior that wasn't written down
elsewhere: `custom_bots.pin` is a plain 4-digit numeric string with **no hashing**
(`chatbot-builder.html` reads it straight back for the teacher to relay to
students, so there's nothing to hash against), guarded by `failed_pin_attempts`/
`pin_locked_until` (5 wrong attempts locks the bot's PIN entry for 10 minutes);
`preset_type` (`guide`/`inquiry`/`summary`, chosen in `chatbot-builder.html`'s
"안내형"/"탐구형"/"요약형" cards) maps to a distinct system-prompt instruction
layered under the teacher's own free-text `system_prompt`; the `chat` action
streams by calling Gemini's `:streamGenerateContent?alt=sse` endpoint and
re-emitting only the extracted text deltas as raw bytes (not the SSE envelope)
since `bot.html`'s reader loop appends whatever bytes arrive directly to the
screen with no SSE parsing of its own. If you ever touch this function again,
consider keeping a copy of its source in this repo (even just as a reference
file never actually deployed from) precisely because this one has no other
backup — unlike every other Edge Function here, which are equally undocumented
in git but at least have deploy history/version numbers Supabase itself could
theoretically be asked to diff, this one was corrupted at its only copy.

**Replies are deliberately kept short, and pushed to develop across turns
rather than dump everything at once.** A student reported answers were long
enough that reading them ate up class time. `LENGTH_AND_DIALOGUE_INSTRUCTION`
is a fixed system-prompt clause appended after the per-preset instruction and
the teacher's own custom prompt (so it applies to every bot regardless of
preset type, and can't be overridden by a teacher's `system_prompt` short of
them explicitly telling the bot to ignore it): keep replies to roughly 3–5
sentences, don't try to hand over a complete answer/finished deliverable in
one turn, and
end with a short follow-up question or suggestion that carries the
assignment/question forward into the next turn — unless the student has
already asked for a final conclusion or finished result, in which case don't
force a trailing question just to have one. This is prompt-only (no
`max_tokens` change, no hard truncation) so a reply that genuinely needs more
room isn't cut off mid-sentence; length control is advisory, same as every
other instruction in this system prompt.

**Also warns about foul language, and the warning is honest, not a bluff.**
`CONDUCT_WARNING_INSTRUCTION` (another fixed clause, same placement as the
length/dialogue one, applied to every bot) tells the model that if a student
uses profanity or abusive language, it should calmly ask them to stop and
mention that the teacher who made this bot can review the conversation, and
that continuing could mean the teacher sees it. This is true, not an empty
threat: `chatbot-builder.html`'s session list has a "대화 보기" button
(`sessionViewBtn`) that reads the full `custom_bot_messages` transcript for any
session, so a teacher genuinely can — and, if a student was flagged, likely
would — go read it. There is still no active push notification to the teacher
(same "no notification system to hook into" limitation noted elsewhere in this
file) — the bot's line is a deterrent based on real reviewability, not a
promise that the teacher is alerted immediately.

**`bot.html`'s chat view is two columns: chat on the left, a research-notes
panel on the right.** Students often need somewhere to jot down what they've
found while researching alongside the chat, separate from the conversation
itself. `custom_bot_notes` (`id`, `session_id` → `custom_bot_sessions.id` on
delete cascade, `title`, `content`, `source` nullable, `created_at`) holds
these — student-side reads/writes go through `student-bot-chat` (service-role
key) only: it checks the caller's `sessionToken` resolves to a real session
before touching that session's own notes, so one student can never see or edit
another's. Three actions, all authenticated the same way `chat` already is (a
bare `sessionToken`, no Supabase Auth — this whole page is PIN-gated, not
login-gated): `listNotes`/`saveNote` (title+content required, source optional,
all trimmed/length-capped server-side)/`deleteNote` (ownership re-checked via
`.eq('session_id', session.id)`, not just the note id, so a guessed/leaked
note id from another session can't be deleted). `getSessionByToken()` is a
small shared helper for these three handlers; the pre-existing `chat` action's
own inline session lookup was left as-is to keep this change minimal.

**The bot's owning teacher can also read notes directly via RLS** — a
`custom_bot_notes_select_owner` policy (join `session → custom_bots`, check
`owner_id = auth.uid()` or `current_user_is_admin()`) mirrors the pattern
`custom_bot_messages`/`custom_bot_sessions` already use for the exact same
"only the bot's teacher (or an admin) can read this student's data" shape —
correcting an earlier note in this file that claimed messages/sessions have
"no client-facing policies at all"; they do, and notes now follows the same
one rather than needing a fourth Edge Function action. `chatbot-builder.html`'s
session list gained a "메모 보기" button next to the existing "대화 보기"
(`toggleNotes()`, copy-pasted from `toggleTranscript()`'s lazy-load-once-then-
toggle-visibility shape, querying `custom_bot_notes` directly with `sb.from()`
the same way `toggleTranscript` already queries `custom_bot_messages`), and
`exportSessionsToExcel()`'s "엑셀로 내려받기" sheet gained two columns — `메모
수` and `메모 내용` — appended after the existing `대화 내용` column, one row
per student exactly as before (not one row per note): each note is rendered
as `■ 제목\n내용\n(출처: ...)` and joined with a blank line between notes, a
student with none gets `(메모 없음)`.

On the client, `body.bot-chat-active` (toggled by `show()` whenever
`chatView` is shown) widens `.wrap` from the site's normal 640px to 1060px so
two panels have room; `.chat-layout` is a flex row (`chat-shell` at `flex:
1.15`, `.notes-panel` at `flex:1`) that collapses to a column below 760px,
matching this repo's usual mobile-stacking convention, with the notes panel
capped at `max-height:340px` there so it doesn't push the chat below the
fold. The notes list is a simple accordion — clicking a `.note-item-title`
toggles `.open` on its `.note-item` (CSS shows/hides `.note-item-body`, no
JS per-item state) — with content/source only rendered inside the (initially
hidden) body, so titles stay scannable in a tall list. `loadNotes()` runs
whenever `chatView` is shown (both the normal start flow and the
same-tab-refresh resume path at the bottom of the script) and fails silently
on error, since the notes panel is a convenience layered on top of the chat,
not something that should block the student from chatting if it has a
hiccup. Deleting a note updates the local `notes` array and re-renders
immediately (optimistic), then fires the server delete in the background —
if that call fails, the note simply reappears next time `loadNotes()` runs
rather than showing an error the student can't do anything about.

**`.notes-panel` now stays visible as the chat grows long — on mobile too,
not just desktop.** The original fix only covered desktop: `.notes-panel` got
`position:sticky` so it wouldn't scroll away as `.chat-messages` grew the
whole page taller than the viewport, but mobile was deliberately left with
the old "scrolls away below a long chat" behavior (see the dropped
`test_bot_notes_sticky.js`, replaced by `test_bot_notes_fixed_viewport.js`
below) — the reasoning at the time was that a sticky panel snapping to the
top of a narrow stacked layout, only after scrolling past the whole chat
above it, would look jarring. A student explicitly asked for the mobile case
too ("대화가 길어지면 메모 내용도 같이 아래로 내려와서 항상 확인할 수 있게... 이거
모바일에서도 되는거지?"), which made clear sticky-on-a-stacked-column was
never going to satisfy this anyway — sticky only "catches" the panel once
your scroll position reaches where it naturally sits in the flow, i.e. only
*after* scrolling past the entire (now very tall) chat box above it; it does
nothing to keep the panel visible from the very start of a long chat.

**Root-caused and fixed properly instead of patching around it further**: the
actual reason the page was growing taller than the viewport at all is that
`body` only had `min-height:100vh` (a floor, not a ceiling) with no
`overflow` constraint — a flex container with `min-height` instead of a true
`height` doesn't force its flex children to shrink-to-fit, so `.wrap` /
`.chat-layout` / `.chat-shell` grew to fit content instead of being capped,
and the *document itself* scrolled rather than `.chat-messages`'s own
`overflow-y:auto` (the scroll-to-bottom code already only ever touches
`chatMessages.scrollTop`, confirming internal scrolling was always the
intended design — this was a containment bug, not a missing feature). Fixed
by capping the page outright while chatting: `body.bot-chat-active{
height:100vh; height:100dvh; overflow:hidden; }` (the `100dvh` declaration
only wins in browsers that support it, accounting for a mobile browser's
address bar collapsing/expanding; `100vh` is the fallback) plus
`.wrap{ min-height:0; }` so the flex chain actually shrinks instead of
overflowing. With the document itself now permanently pinned to viewport
height, `.chat-messages` is the *only* thing that scrolls, and both the
desktop side column and the mobile stacked column simply split that one
fixed-height screen between `.chat-shell` and `.notes-panel` — neither one
is ever pushed off-screen by chat length, so there's nothing left for
`position:sticky` to work around. The old sticky/`position:static`-on-mobile
split was removed entirely: `.notes-panel` is now a plain flex child
everywhere (desktop: `flex:1` beside `.chat-shell flex:1.15`; mobile
`@media (max-width:760px)`: stacked column, `.chat-shell flex:1.6` /
`.notes-panel flex:1; max-height:38vh`, so chat gets the larger share and
notes keeps a guaranteed-visible minimum). `test_bot_notes_fixed_viewport.js`
sends 15 message round-trips (30 chat bubbles) at both a desktop (1200×800)
and a mobile (390×844) viewport and confirms: the document's `scrollHeight`
never exceeds the viewport height (no document-level scroll exists at all),
`.notes-panel`'s bounding rect stays fully inside the viewport at both sizes,
the note title input is actually clickable (not covered by anything), and
scrolling `#chatMessages` internally doesn't move `.notes-panel` at all
(proving the panel's position is independent of chat scroll position, not
just "currently still visible by luck").

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

## Announcements (`announcements` table)

`my-page.html` and `my-custom-page.html` both show an active-announcement banner
(`#blockAnnounce`/`#announceList`), queried the same way in both — rows where
`starts_at <= now <= ends_at`, newest `starts_at` first — with `announce.html`
as the separate standalone write/manage page (linked from the banner area).
The banner list shows **titles only** (`.announceOpen`, underlined/clickable);
clicking one opens a small popup (`#announceModal`/`#announceModalOverlay`,
`openAnnounceModal(a)`) showing the author/date range and full `content` via
`textContent` (not `innerHTML` — no `escapeHtml` needed, and it preserves
newlines because `.announce-item-body` already has `white-space:pre-wrap`).
`my-page.html` reuses its existing generic `.modal-overlay`/`.modal-box`
classes (shared with the submission-status modal); `my-custom-page.html` has
no such shared modal convention yet, so it got its own scoped
`.announce-modal-*` classes instead — keep both in sync if you touch this
behavior, per this repo's copy-paste-per-page convention.

## `teacher.html`/`teachers.html` schedule data shape

`staff.schedule` (fetched via `public_staff`, mapped into `teacher.html`'s
`TEACHERS` array and `teachers.html`'s own `TEACHERS` array) is
`{ [day]: { [String(period)]: {subject, room} } }` — 5 days (`월화수목금`,
`wdList`/`DAYS`), 7 fixed periods (`periods`/`PERIODS = [1..7]`), a missing key
meaning "free" (no explicit null sentinel). Both pages' `TEACHERS.forEach`
patches Friday period 6 to duplicate period 5's value right after loading
(금요일 5교시 수업이 실제로는 6교시까지 이어지는 2시간짜리라 데이터엔 6교시가
비어있음) — any free/busy check must run against `TEACHERS` *after* that patch,
never against the raw `staff.schedule` fetched separately, or Friday 6th period
would be wrongly treated as free.

**The trailing-letter suffix on some subject names** (e.g. `역학과에너지D`,
`영어독해와작문G1`) is **not** a co-teaching marker — per `exams.html`'s own UI
copy ("과목명 옆 괄호 속 알파벳은 분반(그룹) 표시입니다"), it's an elective-group
label: many students pick the same elective, so the school splits them into
parallel sections (A/B/C/…) that meet at the same day+period in different
rooms with different teachers, and a trailing digit (`G1`) is a further
sub-split. **A letter-suffixed class is locked to its scheduled day+period** —
per the user, it can't just be moved to a different slot.

## `teacher.html`/`teachers.html` — 수업 교체 가능자 찾기 (find-a-swap)

A `.swapCell`/`#swapModal` click-to-find-coverage UI on both pages (a
`.swapCell` on every occupied timetable cell; clicking one opens `#swapModal`
listing who could take over that slot), briefly removed on 2026-09-29 pending
a clearer spec (the letter-suffix constraint above had just been discovered
and the feature's interaction with it wasn't yet worked out), then restored
per the user's own concrete restatement of the requirement: "1반 1교시, 3반
3교시라면 다른 선생님과 바꿔서... 첫 번째고, 안 되면 3자 교체로... 원래 내가
들어가야 되는 수업이 단순히 빠지지 않고 나중에라도 다시 들어가서 시수를
채워야돼" — i.e. try a direct 1:1 swap first, fall back to a 3-way cycle, and
never just drop a class outright (everyone's total teaching load must come out
the same as before).

**Why the letter-suffix constraint turned out not to require any special-
casing here**: this feature is a *substitute-coverage* model, not a
*reschedule* model — a class's own day+period (and room) never changes; only
who is physically teaching it does. Clicking teacher A's occupied cell
(day D, period P) finds another teacher B who is free at that exact D+P and
willing to substitute for A there; nothing about D, P, or the room is touched.
Because no cell ever moves to a different slot, a letter-suffixed class
(locked to its own day+period) is just as substitutable as any other class —
the constraint only blocks *rescheduling* a class, which this feature never
attempts. (This is also why documenting the constraint before rebuilding
didn't actually change the algorithm from its original shape — see below.)

- `isFree(teacher, day, period)`: `!teacher.schedule[day]?.[String(period)]` —
  a missing key means free, per the schedule shape documented above.
- `findSwapCandidates(targetTeacher, day, period)`: every other teacher free
  at that exact slot, each scored by whether a same-day-anywhere reciprocal
  ("맞교체") slot exists — some other day+period where the candidate is busy
  and the target teacher is free, so the target can cover the candidate back
  in exchange (this is what keeps the target's total teaching hours whole:
  the class they gave up at D+P is replaced by the candidate's class
  elsewhere, not just dropped). Sorted 1:1 mutual (score 2) > 3-way cycle
  (score 1) > free-only with no reciprocal at all (score 0), ties broken by
  name.
- `findThreeWayCycle(a, b)`: only tried when `a`/`b` have no direct mutual
  slot. Searches every other teacher `c` for a slot where `b` is busy and `c`
  is free (`c` covers `b` there) and a different slot where `c` is busy and
  `a` is free (`a` covers `c` there) — closing a 3-person loop where all three
  keep their original total teaching load, just reshuffled. Returns the
  *first* valid `c` found (in `TEACHERS` array order), not necessarily the
  "best" one — with multiple valid partners the choice is arbitrary and that's
  fine, any valid cycle satisfies the requirement. Does not search beyond a
  3-way cycle (no 4+-way chains).
- The modal (`openSwapModal`) shows every free-at-that-slot candidate,
  labeling each "맞교체 가능: …" (1:1), "3자 교체 가능(<partner> 선생님과
  함께): …" spelling out both hand-off slots by name (3-way), or "이 시간엔
  비어있어요 (맞바꿀 시간은 없어요)" (free but no way to reciprocate — still
  shown, since a same-direction substitute is useful information even without
  a literal swap-back).
- Identical logic on both pages, adapted to each page's own naming
  (`teacher.html`'s `wdList`/`periods`/`DIRECTORY`+`currentTeacherName` vs.
  `teachers.html`'s `DAYS`/`PERIODS`/`byName`, since `teachers.html` can show
  several teachers at once and needs `data-teacher` on each `.swapCell` to
  resolve which teacher's slot was clicked via one delegated listener).
  `teachers.html`'s own `TEACHERS` query gained `department`/`subject`
  columns (previously unfetched there) purely to populate the modal's
  per-candidate department line, matching `teacher.html`'s `DIRECTORY` lookup.
- If this needs a deeper look at the original shape (before the brief
  2026-09-29 removal-then-restore), commits `f062343`/`70caf2a` have it; the
  restored version is line-for-line the same algorithm, since re-deriving the
  requirement from the user's own description above landed back on the exact
  same design.

## 학기별 전체 교사 시간표 갱신은 사이트 기능이 아니라, 학기당 1회 Claude에게 맡기는 수작업 처리

`staff.schedule`을 학기 전체 단위로 갈아끼우는 일(새 학기 시간표 반영)은 한 학기에 한
번뿐이고, 그 원본 파일(교무실에서 받는 엑셀)의 형식도 학교/담당자 사정에 따라 매번
달라질 수 있어 — 사용자가 직접 "그 파일이 내가 담당자가 아니라서 파일 형식을 미리
정하기는 어려운거 같고, 한학기에 한번이니까 그 때마다 양식이 바뀔 수 있어. 그럼 양식을
만들어두기보다는 한학기에 한번 시간표가 바뀔 때 너한테 처리를 맡겨서 업데이트하는
방향은 어때?"라고 제안한 대로, **범용 업로드/파싱 UI 기능을 만들지 않기로 했다** — 매
학기 그 시점에 실제 파일을 Claude에게 건네 그때그때 구조를 파악해 1회성으로 파싱하고
DB를 갱신하는 방식으로 처리한다 (staff-edit.html의 엑셀 양식 다운로드/업로드 기능은
한 번에 한두 명만 손보는 평소 편집용으로 그대로 남고, 이 학기 전체 갱신과는 별개).

**2026학년도 2학기 갱신 때 실제로 겪은 일** (다음 학기에도 같은 흐름을 따르면 됨):
사용자가 처음엔 교사별로 블록이 나뉜 텍스트형 시간표 파일을 보여줬는데, 바로 뒤이어
"더 구조화된 시간표 파일이 있었어"라며 **교실(행) × 요일·교시(열)** 형태의 깔끔한
그리드 파일(시트명 `주간시간표(YYYY-MM-DD)`, 1행에 요일 병합 헤더, 2행에 교시 번호,
각 셀이 `"과목명\n교사명"` 형식)을 추가로 건넸다 — 이쪽을 실제 갱신 소스로 썼다.
처리 순서:
1. 그리드를 교실별로 훑으며 (요일,교시) 열 위치 → 과목/교사로 역색인해서, **교사
   이름 기준으로 뒤집어** `{teacher: {day: {period: {subject, room}}}}` 형태로
   재구성한다 — `room`은 숫자로만 된 문자열이면 JSON number로, `컴퓨터실`/`AI교실`/
   `진학관2층이동교실`/`직업반(진학관3층이동교실)` 같은 특수실 이름은 문자열 그대로
   유지해, 이미 DB에 저장돼 있던 기존 `schedule` 값들의 타입 관례와 맞춘다.
2. 이렇게 역색인하는 과정에서 "같은 교사가 같은 요일·교시에 서로 다른 두 교실에서
   수업하는" 충돌이 하나도 없는지 확인해 — 있었다면 그리드 자체가 내부적으로
   모순된다는 뜻이라 원본을 다시 확인해야 했을 것(이번엔 0건, 깨끗했다).
3. **쓰기 전에 반드시 안전망을 먼저 만든다**: 이번에 갱신 대상이 될 교사 이름 전원의
   현재 `schedule` 값을 `execute_sql`로 통째로 조회해 그대로 백업해둔다(롤백용) —
   실제로 이번엔 이 백업 조회 자체가 뜻밖의 발견으로 이어졌다: 여러 교사(김혜숙,
   배하늬, 유두선, 윤은혜, 이슬아, 이종용, 정민재)의 기존 `schedule`이 이미
   `{"room":null,"subject":205}`처럼 room/subject 필드가 서로 뒤섞인 상태로
   깨져 있었고, 이상진은 아예 `schedule: null`이었고, 추희정은 본인 수업이 아닌
   다른 교사(화법과작문 담당 이상진)의 수업이 섞여 들어가 있었다 — 이런 선행 오염을
   먼저 눈으로 확인해두면, 새 파일로 갈아끼운 뒤 "숫자가 줄어든 것 같은데 맞나"
   싶은 교사를 일일이 의심하지 않고도 "이건 원래 깨져 있던 걸 고친 것"이라고
   확신할 수 있다.
4. 새로 뒤집은 JSON으로 46~47명 분을 한 번의 `update ... from (values (...), ...)
   as v(name, schedule) where s.name = v.name` 쿼리로 일괄 반영한다(개인별 UPDATE
   수십 번이 아니라 단일 트랜잭션) — 이름은 정확히 `staff.name`과 일치해야 하므로,
   실행 전 반드시 파일에서 뽑은 교사 이름 목록을 `select name from staff`와
   대조해 오타/미등록 이름이 없는지 전수 확인한다(이번엔 47명 전원이 정확히
   일치, 오타 0건).
5. 실행 후 몇 명을 다시 조회해서 반영이 제대로 됐는지(특히 3번에서 발견한 오염
   사례들이 깨끗해졌는지) 확인한다.

이 파일 하나가 학교 전체(1~3학년 공통/선택과목 교실)를 담지 못하는 경우도 있을 수
있다 — 이번엔 58명의 `staff` 중 47명만 이 파일에 등장했고, 나머지 11명(행정/비교과
등으로 추정)은 애초에 `schedule`이 `null`인 채 그대로 남았다(건드리지 않음, 해당 파일이
다루는 범위 밖이라 임의로 추측해 채우지 않았다). 다음 학기에 다른 형식의 파일을
받더라도, 이 섹션에 적은 "교사 이름 기준 역색인 → 충돌 검사 → 백업 → 일괄 UPDATE →
반영 확인"이라는 절차 자체는 그대로 재사용하면 된다 — 매번 바뀌는 건 1번 단계의 구체적인
파싱 로직(그 학기 파일의 실제 셀 구조에 맞춰 매번 새로 작성)뿐이다.

**정정: 위 "학기당 1회 Claude에게 맡기는 수작업 처리"는 사용자의 의도를 잘못 읽은
것이었다 — 실제로는 사이트 기능을 만들어달라는 요청이었다.** 사용자가 "이 양식대로
올릴 수도 있어. 이건 좀 정형화된 양식이라"며 두 번째(더 구조화된) 파일을 보여준 건
그 특정 파일 하나를 처리해달라는 뜻이 아니라, **그 구조 자체가 매 학기 재사용 가능한
정형화된 양식이니, 그 구조를 읽어서 시간표를 갱신하는 기능 자체를 만들어달라는
의미**였다("양식만 보내준거고 변경까지 하라는 말은 아니었는데... 그런 구조니까 구조를
읽어서 시간표 업데이트가 가능하게 기능만 만들어달라는거였어"). 바로 위에서 실행한
"한 번은 Claude가 직접 SQL로 처리"는 결과적으로 유효한 작업(실제로 기존 데이터 오염
몇 건을 바로잡는 효과까지 있었다)이었지만, 그건 이번 학기 1회분 처리였을 뿐 — 다음
학기부터는 **`staff-edit.html`의 "전체 교사 시간표 일괄 업데이트" 카드**(아래 설명)를
써야 한다. 이 섹션 제목 자체("학기별 전체 교사 시간표 갱신은 사이트 기능이 아니라...")가
이제는 틀린 전제이니, 향후 이 주제를 다시 참고할 땐 바로 아래 `staff-edit.html` 섹션을
기준으로 삼을 것 — 위 1~5번 절차는 "그 기능이 없던 시절, 1회성으로 어떻게 처리했는지"의
기록으로만 남겨둔다.

## `staff-edit.html` — 전체 교사 시간표 일괄 업데이트 (교실×요일·교시 그리드 엑셀 파싱)

바로 위 정정 사항에 따라 실제로 만든 기능. 교무실에서 받는 "교실별 주간 시간표" 엑셀
파일(교실이 행, 요일·교시가 열인 그리드 — 2026학년도 2학기 갱신 때 실제로 받은 파일의
구조를 그대로 재사용 가능한 형식으로 일반화했다: 시트 1행은 요일 병합 헤더, 2행은 교시
번호, 1열은 순번, 2열은 교실명, 그 뒤 각 칸은 `"과목명"` 다음 줄에 `"교사명"`)을 그대로
업로드하면, 사이트가 알아서 교사 이름 기준으로 뒤집어 전체 교사의 `staff.schedule`을
한 번에 갱신한다 — 더 이상 매 학기 Claude에게 파일을 맡길 필요가 없다.

`staff-edit.html`의 기존 "교사 시간표 편집"(선생님 한 명씩 고르는 폼) 카드 바로 아래
새 카드 "전체 교사 시간표 일괄 업데이트"를 추가했다. 로직:
- **`parseScheduleGridSheet(rows)`** — 2026-2학기 처리 때 검증했던 파싱 로직을
  그대로 클라이언트 JS로 옮겼다: 1행에서 요일(괄호 날짜 부분은 정규식으로 제거)을
  병합 칸 기준으로 캐리포워드하고, 2행에서 교시 번호를 읽어 열 인덱스 → `{day,
  period}` 맵을 만든 뒤, 3행부터 각 행(교실)의 각 칸을 훑어 `"과목\n교사"`를
  파싱한다 — `room`은 숫자로만 된 문자열이면 JSON number로, 특수실 이름(컴퓨터실
  등)은 문자열 그대로 유지해 기존 DB 타입 관례와 맞춘다. 같은 교사가 같은
  요일·교시에 두 번 나오면(그리드 자체의 모순) **먼저 읽은 값을 유지하고** 목록에
  충돌로 기록한다 — 조용히 덮어쓰지 않고 업로드한 사람이 원본 파일을 확인하도록
  경고로 보여준다.
- 업로드 직후 **미리보기**(`renderBulkSchedPreview()`)가 (1) 반영 대상 선생님 수와
  이름 목록, (2) `public_staff`에 이미 등록된 이름과 대조해 **명렬에 없어서 반영되지
  않는 이름**(오타이거나 아직 등록 안 된 교사 — "교직원 명렬에 먼저 등록해주세요"
  안내와 함께), (3) 위에서 설명한 같은 시간 충돌 경고를 모두 보여주고, 반영 대상이
  1명이라도 있으면 "N명 반영하기" 버튼을 띄운다 — `staff_roster_upsert`/엑셀
  업로드 미리보기와 같은 "파싱 → 미리보기 → 확인 버튼" 흐름.
- **`staff_schedule_bulk_upsert(p_password, p_updates)`** RPC(새로 추가, `shared_edit_
  settings` 비밀번호 패턴 재사용 — `verify_shared_edit_password`로 게이트) —
  `p_updates`는 `[{name, schedule}, ...]` jsonb 배열을 받아 이름이 일치하는
  `staff` 행만 `schedule` 컬럼을 덮어쓰고, 매칭된 수와 매칭 안 된 이름 목록을
  `{updated, not_found}`로 돌려준다. 기존 `staff_schedule_upsert`(선생님 한 명)를
  대체하지 않고 나란히 둔다 — 한 명씩 고쳐 쓰는 기존 폼은 그대로 쓸모가 있다.
  여러 교사를 한 번에 반영하지만 한 쿼리 안에서 이름별로 개별 `update`를 돌리는
  PL/pgSQL 루프라, 2026-2학기 때처럼 SQL 텍스트에 자바스크립트 문자열을 직접
  끼워 넣어 이스케이프를 신경 쓸 필요가 전혀 없다 — supabase-js가 JSON을 그대로
  RPC 파라미터로 보내므로 작은따옴표 이스케이프 문제 자체가 사라진다.
- 반영 확정 전 `confirm()`으로 "되돌릴 수 없다"는 경고를 한 번 더 보여준다(공유
  비밀번호만 알면 누구나 전체 교사의 시간표를 한 번에 덮어쓸 수 있는, 파급력이 큰
  동작이라서) — `room-booking.html`의 엑셀 일괄 예약 업로드가 다루는 위험도와는
  다른 급으로, 이 경고 단계는 생략하지 않는다.
- 파일에 이름이 없는 선생님의 기존 `schedule`은 전혀 건드리지 않는다 — RPC 자체가
  `p_updates`에 들어있는 이름만 순회하므로, 2026-2학기 때처럼 파일 범위 밖(행정/
  비교과 등) 교사는 자동으로 안전하게 제외된다.
- `test_staff_edit_bulk_schedule.js`로 (1) 명렬에 있는 이름만 반영 대상으로
  잡히는지, (2) 명렬에 없는 이름이 "반영되지 않는 선생님"으로 분리돼 보고되는지,
  (3) 같은 시간 충돌이 경고로 뜨는지(충돌 시 먼저 읽은 값이 유지되는지), (4) 확인
  버튼을 누르면 RPC가 정확한 payload로 호출되는지(room 타입 변환 포함) 검증했다.

## `room-booking.html` — "교실 목록 관리"의 "삭제" 버튼을 눌러도 아무 반응이 없다는 보고

관리자가 "교실 목록 관리" 카드의 특정 교실 "삭제" 버튼을 눌렀을 때 확인(confirm)
창조차 뜨지 않고 교실이 그대로 남아있다는 보고가 있었다 — 같은 페이지의 다른
삭제/취소 버튼(내 예약 취소, 예약 팝업 안 삭제 등)은 정상 동작한다고 확인했으므로
브라우저가 confirm 자체를 막는 문제(카카오톡 인앱 브라우저 등)는 아니었다. RLS
(`rooms_admin_write`가 `current_user_is_admin()`으로 DELETE까지 전부 허용),
`room_bookings_room_name_fkey`의 `ON DELETE CASCADE`, `current_user_is_admin()`
함수 정의를 Supabase에서 직접 조회해 모두 정상임을 확인했고, 클라이언트 코드
(`.btnDeleteRoom` 클릭 핸들러, 이벤트 바인딩 순서, CSS)도 다시 읽어봤지만 정적으로는
버그를 찾지 못했다. Playwright로 정상 삭제 흐름(`test_room_booking_delete_room.js`)을
재현해도 confirm → DELETE 호출 → 목록 갱신까지 전부 기대대로 동작해, 이 코드 경로
자체는 멀쩡하다는 것도 확인했다.

**그래도 안전장치를 하나 추가했다**: `btnDeleteRoom`의 클릭 핸들러 전체를
`try/catch`로 감쌌다 — 이전에는 `row`를 못 찾거나(`row.dataset.name`에서 바로
예외), `confirm()`이나 `sb.from('rooms').delete()` 호출 중 예상 못한 예외가 나면
`async` 클릭 핸들러 안의 미처리 예외라 브라우저가 콘솔에만 조용히 기록하고
사용자에게는 **아무 알림도 없이** 그대로 끝나버렸다 — 정확히 "눌러도 반응이
없다"는 증상과 일치한다. 이제는 그런 예외도 전부 `catch`돼서 "삭제 중 예상치
못한 문제가 발생했어요: ..." alert로 드러난다(`test_room_booking_delete_room.js`의
[C]가 깨진 서버 응답으로 이 경로를 검증). `row`/`name`을 못 찾는 경우도 조용히
멈추지 않고 "삭제할 교실 정보를 찾지 못했어요. 새로고침 후 다시 시도해주세요."로
알려준다.

**이 수정이 실제 근본 원인을 고쳤는지는 확인하지 못했다** — 정적 분석과 모킹
테스트로는 재현되지 않는 버그라, 실제 운영 환경(브라우저 캐시가 오래된 버전의
페이지를 들고 있었거나, 특정 브라우저 확장/보안 소프트웨어가 해당 요청만 막는
경우 등)에만 있는 문제일 수 있다. 다음에 같은 보고가 또 들어오면: (1) 페이지를
새로고침(캐시 무시, Ctrl+Shift+R)한 뒤 다시 시도해보고, (2) 그래도 안 되면
브라우저 개발자 도구(F12) → 콘솔 탭에서 클릭 시 빨간 에러가 뜨는지 확인해달라고
요청할 것 — 이제는 그 에러가 `catch`를 거쳐 alert로도 보이므로, "삭제 중 예상치
못한 문제가 발생했어요: ..." 라는 alert가 뜨는지부터 물어보면 원인이 바로
좁혀진다.

**후속: 실제 근본 원인을 나중에 찾아서 고쳤다 — HTML 속성에 담긴 `\r\n`이
파싱 중에 `\n`으로 조용히 바뀌는 문제였다.** "맨 끝 목록의 도서관 문화카페가
안 지워진다"는 구체적인 재보고를 받고 그 교실의 실제 저장된 이름을 Supabase에서
직접 조회해보니, 이름에 진짜 줄바꿈 문자(`\r\n`, 엑셀 셀에서 Alt+Enter로 줄을
나눈 내용이 xlsx 업로드를 통해 그대로 들어온 것으로 보임)가 섞여 있었다. 삭제
버튼은 `renderRoomListArea()`가 각 행에 심어둔 `data-name="${escapeHtml(r.name)}"`
속성을 `row.dataset.name`으로 다시 읽어서 그 값으로 `.eq('name', ...)` DELETE를
보냈는데, **HTML5 파서는 마크업을 파싱하기 전에 속성 값 안의 `\r\n`/`\r`를
전부 `\n`으로 정규화한다**(스펙의 "입력 스트림 전처리" 단계) — 그래서
`row.dataset.name`으로 되읽은 문자열은 원래 `r.name`과 바이트 단위로 달라져
있었고, `.eq('name', 그 변형된 값)`은 실제 행과 전혀 매치되지 않아 0건
삭제되면서도 에러 없이 조용히 끝났다 — "버튼을 눌러도 반응이 없다"는 증상과
정확히 일치한다(위에서 추가한 try/catch는 애초에 예외가 안 나는 이 경로를
잡을 수 없었다). **고쳐서** `renderRoomListArea()`의 행 템플릿을 `data-name`
속성 대신 `data-idx="${idx}"`(그 행이 `rooms` 배열의 몇 번째인지)로 바꾸고,
수정/저장/삭제 세 핸들러 모두 `rooms[Number(row.dataset.idx)].name`으로 실제
교실 이름을 가져오도록 바꿨다 — 배열 조회는 DOM 왕복을 거치지 않으므로 HTML
파싱 정규화의 영향을 전혀 받지 않는다. `test_room_booking_delete_crlf_name.js`
로(이름에 실제 `\r\n`이 섞인 교실을 만들어) DELETE 요청에 실제로 원본과
바이트 단위로 일치하는 이름이 실리는지, 그 교실이 실제로 목록에서 빠지는지
확인했다. 같은 문제가 수정(저장) 경로에도 똑같이 있었을 것이므로 함께 고쳤다.

## 교실 예약(room-booking.html) 드래그앤드롭 — 이동/복사를 Ctrl 키 대신 팝업으로 선택

예약 칩을 다른 칸에 끌어다 놓는 기존 드래그앤드롭(위 "room-booking.html" 섹션의
"예약 칩을 다른 교실·날짜 칸으로 드래그하면... Ctrl(또는 ⌘)을 누른 채 드래그하면
복사한다" 참고)은 Ctrl/⌘ 키를 누르고 있어야만 복사가 됐는데, **터치 기기(태블릿,
터치스크린 노트북)엔 Ctrl 키 자체가 없어서 복사를 할 방법이 아예 없었다.** 사용자
요청대로 놓는 순간 바로 처리하지 않고, 놓인 자리에 작은 선택 팝업
(`.rb-drop-choice-popup`, "➡️ 이동"/"📋 복사" 두 버튼)을 띄우도록 바꿨다.

- 드래그 중 안내 말풍선(`.rb-drag-ghost`) 텍스트도 Ctrl 키 상태에 따라 "이동하기"/
  "복사하기"로 바뀌던 것을 "✋ 놓으면 이동/복사를 선택해요"라는 고정 문구로
  바꿨다 — 어차피 선택은 놓은 뒤에 하므로, 드래그 중엔 무엇이 될지 미리 알려줄
  필요가 없다.
- `pointerup` 핸들러는 더 이상 `e.ctrlKey || e.metaKey`로 즉시
  `handleBookingDrop(...)`을 호출하지 않는다 — 드롭 대상 칸이 원래 칸과 다르면
  (같은 칸에 놓은 경우는 할 일이 없으니 팝업 자체를 안 띄운다)
  `showDropChoicePopup(clientX, clientY, bookingId, isAnon, toRoom, toDate)`를
  호출해 그 위치에 작은 팝업을 띄운다. `handleBookingDrop()` 자체(이동/복사 각각의
  소유권·비밀번호 처리 로직)는 전혀 바뀌지 않았다 — 어떤 경로로 `isCopy`가
  결정되는지만 바뀌었다.
- 팝업은 뷰포트 밖으로 나가지 않도록 clamp되고, "이동"/"복사" 버튼을 누르면 그
  즉시 팝업을 닫고 `handleBookingDrop(..., false/true)`를 호출한다. 팝업 바깥을
  클릭하거나 Esc를 누르면(`onDropChoiceOutsideClick`/`onDropChoiceEscape`, 둘 다
  캡처 단계 리스너) 아무 요청도 보내지 않고 조용히 닫힌다 — 드래그했다가 마음이
  바뀐 경우를 위한 되돌리기 경로.
- `test_room_booking_grid_height_pan_dnd.js`를 이 흐름에 맞게 고쳤다 — Ctrl 키를
  누른 채 드래그하는 대신 팝업의 "이동"/"복사" 버튼을 클릭하도록, 그리고 팝업이
  뜨기 전까지는 어떤 요청도 안 나가는지, 바깥 클릭 시 팝업만 닫히고 아무 요청도
  안 나가는지 검증하는 케이스를 추가했다.

**"취소" 버튼도 명시적으로 추가했다 — 바깥 클릭/Esc로 닫는 기존 경로는 그대로
두고, 세 번째 버튼으로 눈에 보이게 만든 것뿐이다.** 팝업에 이동/복사 버튼만 있던
동안은 "그냥 그 자리에 두고 싶다"는 선택지가 화면에 전혀 안 보여서(바깥을 클릭하거나
Esc를 눌러야 한다는 걸 알아야만 취소할 수 있었다), 사용자 요청대로
`showDropChoicePopup()`의 `innerHTML`에 `#btnDropCancel`("✕ 취소", 기존 `#btnDropCopy`와
같은 `.btn.small.secondary` 스타일)을 세 번째 버튼으로 추가했다. 클릭 핸들러는
`closeDropChoicePopup()`만 호출할 뿐 `handleBookingDrop()`을 전혀 부르지 않으므로
동작은 바깥 클릭/Esc와 완전히 동일하다 — 추가된 건 "그 선택지가 존재한다는 걸
보여주는 버튼"뿐이고, 새로운 취소 경로나 RPC는 없다. `test_room_booking_drop_cancel_button.js`로
(1) 드래그해서 놓으면 이동/복사/취소 세 버튼이 모두 보이는지, (2) "취소"를 누르면
팝업만 닫히고 update/insert 둘 다 호출되지 않는지, (3) 예약이 원래 칸에 그대로
남아있는지, (4) 취소를 한 번 거친 뒤에도 "이동" 버튼이 여전히 정상 동작하는지(회귀
없음) — 검증했다.

## `room-booking.html` (교실 예약)

Replaced `index.html`/`nav.js`'s old "교실 사용 예약" tile, which used to link
straight out to a manually-managed Google Sheet (a monthly calendar table) — this
is a real Supabase-backed page now, reached the same way but at `./room-booking.html`.
Two tables:
- **`rooms`**: `name text primary key`, `category text` — displayed everywhere in
  the UI as **위치** ("location"), not "구분" ("category"); only the column name
  and the JS variable (`category`) stayed as-is per this repo's usual
  rename-display-text-only convention (see the 나의 페이지/대시보드 naming note
  below) — grep for "구분" if you ever need to confirm no old label text crept
  back in. RLS: any authenticated user can `select`; only
  `current_user_is_admin()` can write. Populated via an admin-only "엑셀로 일괄
  등록" card (이름/위치 두 열, `upsert` on `name` so re-uploading just updates
  `category` rather than erroring/duplicating) — no per-room add/edit form,
  matching the user's explicit choice to manage the ~40 rooms in bulk rather
  than one at a time; a per-room "삭제" button still exists for one-off cleanup
  (cascades to that room's bookings).
- **`room_bookings`**: `id`, `room_name` (FK → `rooms.name`, cascade delete),
  `booking_date`, `start_time`/`end_time` (`time`, **not** the fixed 1–7 class
  periods this originally shipped with — see the migration note below),
  `title`, `teacher_id`/`teacher_name`. Real overlap prevention, not just an
  exact-slot unique constraint, since a room can now have several bookings on
  the same date as long as their times don't overlap: a generated
  `time_range tsrange` column (`tsrange(booking_date + start_time, booking_date +
  end_time)`) backs an `EXCLUDE USING gist (room_name WITH =, time_range WITH &&)`
  constraint (needs `create extension btree_gist`) — this is the actual
  conflict guard, enforced by Postgres itself regardless of caller, same
  "database constraint over client-side checking" principle as the collection
  name-uniqueness checks elsewhere in this repo. Booking flow is direct-click,
  first-come-first-served with **no approval step** (explicit user choice); the
  client catches the resulting Postgres `23P01` (`exclusion_violation`) error
  and reloads the grid with "이 시간에는 이미 다른 일정이 있어요" rather than
  treating it as a hard failure. RLS: anyone authenticated can `select` all
  bookings (so teachers can see who has what, not just their own); `insert`
  requires `auth.uid() = teacher_id` (self-attribution only — `teacher_name` is
  a separate free-text display field, see below); `delete` allows either the
  booking's own teacher or an admin. `update` is also allowed, via
  `room_bookings_update_self`/`room_bookings_update_admin` (mirroring the
  delete policies' `auth.uid() = teacher_id` / `current_user_is_admin()` shape
  exactly, both `USING` and `WITH CHECK`) — added when the day-modal redesign
  below turned "editing a booking" into a real in-place update instead of
  cancel-and-rebook; the exclusion constraint still guards an edited time range
  exactly like a fresh insert.

**Migrated off fixed class periods to free time ranges.** The very first version
of this page mirrored `teacher.html`'s 1–7 교시 grid (`period integer`, a plain
`unique(room_name, booking_date, period)` constraint), matching the request's
literal "요일/시간별" wording. Immediate follow-up feedback made clear that was
wrong for this page's actual use case (선생님 협의회, 동아리 회의, 행사 등— nothing
tied to the class schedule): a booking needed an arbitrary start/end time, and
a room needed to allow several non-overlapping bookings on the same day. The
schema was migrated in place (`period` dropped, `start_time`/`end_time` added,
exclusion constraint replacing the unique one) rather than kept alongside the
old model — there was exactly one real test booking in the table at migration
time, converted to a placeholder `09:50–10:40` (2교시's typical clock time; no
period→time mapping exists anywhere in this codebase, so this was a one-off
guess for that single row, not a general conversion rule).

**Grid layout matches the original Google Sheet's shape, not a single-room
view.** An earlier iteration had a room `<select>` + one room's week shown at a
time; per explicit follow-up ("교실 목록을 세로로 쭉 보여주고 가로로는 날짜를"), the
grid always shows **every room as a row and every date as a column** (like
the old manually-kept sheet), with a sticky first column (room name + category)
for horizontal scrolling. Once room counts grow past a handful, the table would
otherwise just get taller forever, so `.grid-scroll` also caps vertical height
(`max-height:1000px`, `overflow:auto` — roughly 20 room rows before it scrolls,
bumped up from an initial `480px`/~10 rows per follow-up feedback that 10 was
too short)
and the header row's `<th>` cells are `position:sticky; top:0` so the 요일/날짜
header stays visible while scrolling through rooms; the top-left corner cell
(`th:first-child`) is sticky on **both** axes at once (row header + column
header intersection) and needs the highest `z-index` of the three sticky layers
so it stays above both the sticky header row and the sticky first column as they
scroll past each other. The first column's width is a CSS custom property
(`--rb-name-col-w`, default `100px`, set on `#rbGrid` itself so both `th:first-
child`/`td:first-child` read the same value) rather than a hardcoded pixel
width, because room names were originally given a fixed `150px` that was wider
than most rooms actually need — a drag handle (`.rb-col-resize-handle`, rendered
fresh inside the header cell on every `renderGrid()` call, so its `pointerdown`
listener is delegated on `document` rather than attached per-element like
`my-page.html`'s static resize handles) lets a teacher narrow or widen it
(clamped `60px`–`260px`), persisted to `localStorage` only (`ks_room_name_col_w`
— a personal, this-browser-only preference, not the cross-device 3-tier pattern
used for site-wide admin defaults elsewhere in this file, since this is a minor
per-viewer convenience on one utility page rather than a layout every teacher
should see the same way).

The page's own `.wrap` is wider than this repo's usual `640px`/`1180px`
single-column pages — `max-width: 1416px` (bumped up 20% from an initial
`1180px` per explicit feedback that the grid felt cramped), since a room×date
matrix genuinely needs the extra horizontal room the rest of this site's
narrower pages don't.

**A room with zero bookings in the currently-viewed month gets its name cell
shaded** (`.rb-room-empty`, a translucent dark overlay layered over the
opaque `--paper-card` the same way sticky `th`s already avoid scroll-bleed-
through) — `renderGrid()` builds a `Set` of room names that appear in any key
of `bookingsByRoomDate` (which only ever holds `room|date` keys that actually
have a booking) and checks membership per room row. This is purely a
this-month visual cue, not a stored flag — switching months recomputes it
from that month's own `bookingsByRoomDate`, so a room shaded in October isn't
necessarily shaded in November.

**Month view, not a week at a time, with horizontal scroll.** Per explicit
follow-up ("예약 현황 표는 한달씩 보여주면 어떨까 싶고, 가로로 스크롤 할 수 있게 하되,
맨 왼쪽열은 고정"), the date axis shows one calendar month at once
(`monthStart`/`startOfMonth()`/`monthDates()`, replacing the original week-nav —
◂ 이전 달/이번 달/다음 달 ▸ buttons step `monthStart` by whole months) rather than
a 7-day window, with `.grid-scroll` scrolling horizontally through ~28–31 date
columns while the first (room name) column stays pinned via the same sticky
mechanism as the vertical case above. `WEEKDAY_LABELS` (`['일','월',...,'토']`,
indexed by each date's own `getDay()`) replaced the old fixed 7-element
`dayLabels` array, since a month's dates don't line up with a fixed weekday
position the way a single week's did. **Getting the horizontal scroll to
actually happen took a real fix, not just adding columns**: `table.rb-grid`
uses `table-layout:fixed` with an explicit `width:104px` on every date `<td>`/
`<th>` (bumped up from an initial `78px` per later follow-up feedback that
cells needed to be a bit wider — see the wrap/expand paragraph below) so a
full month is wider than the container — but per the CSS spec,
`table-layout:fixed` only treats per-column widths as authoritative when the
`<table>` itself has an explicit (non-`auto`) width; leaving the table at
`width:auto` (which is what simply dropping the old `width:100%` did) makes
those column widths mere hints and the browser silently falls back to
content-based sizing instead — the table quietly shrank to fit content instead
of overflowing. The fix is `updateTableWidth()`, called at the end of every
`renderGrid()` and from `applyRoomNameColWidth()` (so both a month change and a
name-column drag stay correct): it sets `#rbGrid`'s own `style.width` to
`currentRoomNameColWidth() + currentDateColCount * 104` in px, which is what
actually forces `table-layout:fixed` to honor the per-column widths and
produces real horizontal overflow. If you ever change the date column width
constant, or let `renderGrid()` run without calling `updateTableWidth()`
afterward, the scroll silently stops working again with no visible error —
worth grep'ing for `updateTableWidth` before touching this section.

**Cell content wraps to ~3 lines by default, with a page-top "펼쳐 보이기"
toggle to show everything.** The original cell preview showed only the first
2 bookings' bare time range (`HH:MM~HH:MM`, no title) plus a "+N건" overflow
chip, single-line-ellipsised — per follow-up feedback that bookings were
getting cut off and unreadable, `renderGrid()`'s per-cell chip now shows every
booking in the cell as its own `HH:MM~HH:MM 제목` line (`.rb-booking-chip`,
`white-space:normal` so long titles wrap instead of ellipsis-truncating), all
wrapped in one `.rb-cell-content` div. By default that wrapper is capped at
`max-height:56px` (`overflow:hidden` — roughly 3 chip-lines before the rest is
simply clipped, no "+N건" indicator anymore since the point is real content,
not a count) and `.rb-cell` itself has a matching `min-height:70px` so a
mostly-empty cell doesn't look oddly tall. A checkbox at the top of the 예약
현황 card (`#chkExpandCells`, "펼쳐 보이기") toggles a `body.rb-expand-cells`
class that removes both caps (`max-height:none; overflow:visible` on the
content, `min-height:auto` on the cell) so every booking in every cell renders
in full — rows with more content just grow taller, rows with little content
stay compact, since the cap is per-cell not per-row. Like the name-column
width, this is a personal, this-browser-only viewing preference
(`localStorage['ks_room_booking_expand_cells']`), not a site-wide
`app_settings` default — restored on load and applied via the same body class
before the first `renderGrid()` call. The date column width was also widened
alongside this (`78px` → `104px`, see `updateTableWidth()` above) so a
time+title chip has more room to wrap into fewer lines.

**Clicking any cell opens one popup that also handles add/edit/delete** — per
explicit follow-up ("예약된 목록을 누르면 그 교실의 그날 예약 내역을 보여주는 팝업창이
목록으로 떠야돼. 그 팝업창에서도 추가가 가능하고. 예약한 사람은 거기서 수정 삭제도
가능하고"), the old per-chip cancel / plus-button-opens-add-only-modal flow was
replaced with a single `#dayModal`, opened by clicking **anywhere in a
`.rb-cell`** (`data-room`/`data-date` on the `<td>` itself). `renderGrid()`
shows every booking as its own `HH:MM~HH:MM 제목` chip (`.mine` tinted
differently; see the wrap/expand paragraph below for how a cell with several
bookings is kept from growing the whole row unboundedly), or a faint "+" hint
on an empty cell — the actual booking text, and all mutation, happens inside
the modal. `openDayModal()`
reads straight from the already-loaded `bookingsByRoomDate[room|date]` (no
extra fetch — the whole month's bookings are already in memory from
`loadGrid()`); `renderDayBookingList()` renders each booking as a
`.rb-day-row` (plain text row) unless it's the one currently being edited
(`editingBookingId`), in which case that one row alone swaps to a
`.rb-day-edit-row` of `<input>`s (시작/종료 시간, 제목, 사용자) with 저장/취소 —
same "only one row editable at a time, inline, no separate form" pattern
already used for the admin room-list edit mode above. 수정/삭제 buttons only
render when `b.teacher_id === session.user.id || myProfile.is_admin` (same
authorization the RLS policies enforce server-side); 저장 does a plain
`room_bookings.update(...).eq('id', id)`, relying on the new update RLS
policies and the same `23P01` exclusion-conflict handling as a fresh insert. A
"+ 새 예약 추가" mini-form is permanently visible at the bottom of the modal
(제목/사용자/시작·종료 시간 + "+ 이 시간에 추가") regardless of whether the day
already has bookings, so adding another non-overlapping booking to a day never
requires closing and reopening the popup. Every mutation (add/edit/delete)
calls `loadGrid()` to refresh `bookingsByRoomDate` (keeping the underlying
month grid in sync once the modal closes) and then re-renders the still-open
modal's own list in place — the modal never closes itself after a successful
action, only on explicit ✕/닫기/overlay click. `cancelBooking(id)` is shared
between the modal's 삭제 button and the "내 예약" list's own cancel button
below the grid, and checks whether `#dayModal` is currently open to refresh its
list too when invoked from there. `WEEKDAY_LABELS` covers all 7 days, not just
weekdays — once bookings are free-form time ranges for arbitrary purposes
rather than tied to the class schedule, weekend use (events, supervision) is
just as valid, and the original Google Sheet never excluded weekends either. A
separate "내 예약" list below the grid queries by `teacher_id` across all
rooms/dates (not scoped to the visible month) so a teacher can find and cancel
their own upcoming bookings without hunting through the matrix. It has its own
collapse/expand toggle (`#toggleMyBookings`, hiding/showing `#myBookingsBody`
which wraps both the message area and the list) — a personal, this-browser-only
preference (`localStorage['ks_room_booking_collapse_mine']`), same convention as
the name-column width and "펼쳐 보이기" toggle elsewhere on this page, rather than
the site-wide `collapse_defaults` admin-default pattern (this page doesn't
participate in that 3-tier system at all).

**Excel round-trip for bulk scheduling.** A non-admin-gated "엑셀로 일괄 예약" card
lets any approved teacher download a template for a chosen date range (capped at
60 days client-side to keep the file sane) and re-upload it to create many
bookings at once. The template is a flat sheet with columns `예약ID, 교실, 위치,
날짜, 시작시간, 종료시간, 제목, 사용자` — critically, it always covers **every room ×
every date in the range** (one row per that combination), and any date+room that
already has a booking gets that row **pre-filled** (`예약ID` = the real booking
UUID) instead of a blank one; a room+date with multiple existing bookings gets
multiple pre-filled rows. This is what lets a teacher safely add new bookings
without re-typing what's already there or double-booking a slot they can't see:
they just fill in blank rows (or copy one to add another entry for the same
room+date) and re-upload. `위치` is filled from `rooms.category` purely for the
teacher's own reference while picking a room in the spreadsheet — `room_bookings`
has no location column of its own, so the upload parser (which reads by column
*name*, not position) never looks at `위치` at all, exactly like it ignores any
other extra column; it exists on the download side only. On upload, any row that
still carries a `예약ID` is skipped outright (it's just a reference row echoing
existing state, never re-inserted); a fully-blank row is silently ignored;
everything else is validated (room exists, date/time parse, start < end, title
non-empty) and shown in a preview before commit. `parseExcelDateValue()`/`parseExcelTimeValue()`
defensively handle both plain strings and Excel's native numeric date/time
serials (in case a cell gets auto-reformatted by Excel when someone edits it),
normalizing everything back to `YYYY-MM-DD`/`HH:MM`. Rows are inserted **one at
a time sequentially** rather than as a single batch insert — a single exclusion-
constraint conflict would otherwise abort an entire batch insert in one SQL
statement — so a conflicting row is reported and skipped (`23P01` → "시간
겹침") while every other valid row in the same upload still goes through, with
a running "반영 중… (i/N)" status and a final success/fail tally.

**업로드 직후 미리보기가 "N건"이라는 숫자만 보여줬는데, 실제로 어떤 일정이
반영될지 구체적으로 보고 나서 누르고 싶다는 요청으로 상세 목록을 추가했다.**
`bulkExcelInput`의 `change` 핸들러가 `valid` 배열을 만든 뒤 바로 반영 버튼을
보여주던 것을, 그 사이에 `.bulk-preview-list`(스크롤 가능한 작은 박스,
`max-height:320px`)를 끼워 넣어 유효한 각 행을 `bulkRowPreviewHtml()`로
한 줄씩(`M/D(요일) HH:MM~HH:MM · 교실 · 제목 · 사용자`, `fmtMD`/`WEEKDAY_LABELS`
재사용 — 이 페이지의 다른 날짜 표시와 같은 형식) 렌더링한다. 행 모양은
`#dayModal`의 `.rb-day-row`를 그대로 재사용했고(새 CSS는 스크롤 박스
`.bulk-preview-list` 하나뿐), 반영 전 안내 메시지("N건의 새 예약을
추가합니다")와 건너뛴 줄 사유 안내는 그대로 유지한 채 그 사이에 목록만
끼워 넣었다 — "반영하기" 버튼을 누르기 전까지는 어떤 서버 호출도 일어나지
않으므로(`commitBulkExcel`은 버튼 클릭 때만 실행), 이 목록은 순수하게
브라우저에서 이미 파싱해 둔 `valid` 배열을 다시 그리는 것뿐이고 추가
네트워크 요청이 없다.

**Rooms have a manual display order (`rooms.sort_order`).** Originally rooms only
sorted by name; teachers wanted the matrix's row order (and the admin room list)
to match the order rooms are actually listed on paper/in practice, so `rooms`
gained a nullable `sort_order integer` column. `loadRooms()` orders by
`sort_order` ascending with nulls last, then by name — so a room with no number
set just falls to the bottom rather than breaking the sort, and this one query's
order is the single source of truth for both the matrix's row order and the
admin list's order (no separate client-side re-sort). The 교실 목록 관리 card
also gained a **하나씩 추가** mini-form (순번/이름/위치 inputs + "+ 추가") above
the existing bulk-Excel section, for admins who just want to add or fix one room
without building a spreadsheet — it's a plain single-row `upsert` on `name`,
identical in spirit to the bulk path. The bulk Excel template/upload
(`btnDownloadRoomTemplate`/`roomExcelInput`) gained a third **순번** column
alongside 이름/위치; like 위치, leaving 순번 blank on a re-upload clears any
existing value for that room on conflict (full overwrite-on-conflict, not a
merge) — consistent with how 위치 already behaved before this change.

**The room-list template pre-fills already-registered rooms, same idea as the
booking template.** `btnDownloadRoomTemplate` used to always write the same
two hardcoded example rows (`201`/`시청각실`) regardless of what was actually
registered, so editing an existing room's 위치/순번 by Excel meant retyping
its name correctly by hand (a typo there just creates a new room instead of
updating one, since the upload's `upsert` matches on exact `name`). It now
builds its rows from the already-loaded `rooms` array when non-empty — one row
per registered room, `name`/`category`/`sort_order` as-is (blank cell when
`sort_order` is `null`) — so downloading, editing a few cells, and re-uploading
Just Works. The two hardcoded example rows are kept as a fallback only for the
very first download when `rooms` is still empty (nothing to prefill from yet).

**Matrix header sort (순번/이름) is open to everyone, not just admins.** The
`rooms.sort_order`/`name` fields the admin sets are just a *default* order —
anyone trying to book a room needs to be able to re-sort the view too, so the
first column's header renders two small `.rb-sort-btn` toggles ("순번"/"이름",
each showing ▲/▼ once active) instead of a plain "교실" label. Clicking one is
a purely client-side re-sort of the already-loaded `rooms` array
(`sortRoomsForDisplay()`, re-running `renderGrid(currentGridDates)` — no
refetch) — it's never written back to `app_settings` or `rooms` itself, and
resets to the default (순번 ascending) on reload, since this is a personal,
in-the-moment viewing preference, not a site-wide setting. A room with no
`sort_order` always sorts to the bottom regardless of ascending/descending
direction (flipping direction would otherwise yank null-order rooms to the
top when sorting 내림차순, which is more confusing than just leaving them
last either way).

**Admin room list has inline click-to-edit, not just add/delete.** The
"등록된 교실" list gained an "✏️ 편집 모드" toggle; once on, clicking any row
(`.room-editable`) swaps just that row into 순번/이름/위치 `<input>`s with
저장/취소 buttons — no separate edit form or modal, and only one row is
editable at a time (clicking a different row while one is being edited just
discards the unsaved one and opens the new one, since this is a low-stakes
admin tool where that's an acceptable simplicity trade-off). Saving does a
plain `rooms.update({name, category, sort_order}).eq('name', <original name>)`
— renaming a room this way changes the table's primary key while
`room_bookings.room_name` still points at the old value, so
`room_bookings_room_name_fkey` was migrated from `ON UPDATE NO ACTION` (the
default) to `ON UPDATE CASCADE` specifically to make renames safe: existing
bookings for that room automatically follow the rename instead of the
`UPDATE` on `rooms` failing outright (or, worse, silently orphaning bookings
if the constraint were looser). `ON DELETE CASCADE` was already in place from
this table's original design and is unchanged.

**교실별/위치별 필터** — a `.room-filter-row` above the month grid holds two
plain `<select>`s (`#roomFilterSelect`/`#locationFilterSelect`, populated from
the already-loaded `rooms` array), open to every user (not admin-gated, same
as the 순번/이름 sort toggles above). `visibleRoomsForGrid()` filters the
`rooms` array by exact name and/or exact `category` match before `renderGrid()`
builds rows from it — `rooms` itself is never mutated, so sorting/admin
editing/the Excel round-trip are all unaffected. Picking a specific room in
`#roomFilterSelect` narrows the matrix down to that one room's row, which is
this page's answer to "교실별 일정 보기" — there's no separate single-room
page or view, since the existing day-cell click (`openDayModal`) already
handles viewing/adding/editing a booking regardless of how many rows are
currently visible; filtering the matrix down to one room turns the exact same
grid+popup into a de-facto per-room schedule. Both filters persist to
`localStorage` only (`ks_room_booking_filter_room`/`ks_room_booking_filter_location`
— a personal, this-browser-only viewing preference, same convention as the
name-column width and "펼쳐 보이기" toggle above), and `populateRoomFilters()`
resets a stale selection (e.g. a room that no longer exists) back to `'all'`
on every `loadRooms()`.

**No login required — viewing and booking both work anonymously.** This page
originally hard-gated everything behind Supabase Auth login (`approved`
profile required just to see the grid), even though booking itself is
already "선착순, no approval step" per its own design. Per explicit request
to drop that requirement, the login/approval gate was removed entirely —
`room-booking.html` now calls `sb.auth.getSession()` once, keeps `session`/
`myProfile` as values that may legitimately be `null`, and derives `myUid =
session ? session.user.id : null` — every `session.user.id`/`myProfile.name`/
`myProfile.is_admin` reference in the file was updated to tolerate that
(`myUid &&`, `myProfile &&`). `nav.js`'s `DEFAULT_NAV_ITEMS` entry for this
page had its `loginRequired: true` flag removed too (that flag is purely
cosmetic — it just adds a "*" marker in the hamburger/search list — so
dropping it doesn't change access, just stops advertising a requirement that
no longer exists).

`room_bookings.teacher_id` (`uuid`, FK to `auth.users`) was `NOT NULL`, which
made an anonymous insert structurally impossible even before RLS was
considered — migrated to nullable. Three new RLS policies admit the `anon`
role (additive, the existing `authenticated`-only policies are untouched):
`rooms_select_anon`/`room_bookings_select_anon` (`using (true)`, same open
read as the authenticated policy) and `room_bookings_insert_anon` (`with
check (teacher_id is null)` — an anonymous booking is only ever allowed to
insert itself with no owner, it can never claim someone's `teacher_id`).
Client-side, an anonymous booking sends `teacher_id: myUid` (`null`) and
requires the "사용자" field to be typed in by hand (no `myProfile.name` to
fall back to) — both the single day-modal add form and the bulk-Excel upload
path now validate this explicitly (`사용자 이름을 입력해주세요.` / `사용자
이름이 없어요` per invalid row) rather than silently sending a blank/
undefined `teacher_name` (that column stays `NOT NULL`).

**Known, accepted gap**: an anonymous booking can never be edited or
canceled by its own creator afterward — there's no identity to check it
against, unlike a logged-in booking's `auth.uid() = teacher_id` match. Only
an admin (`room_bookings_update_admin`/`_delete_admin`, unaffected by this
change) can touch it, same "admin-or-nobody" trade-off `file-library.html`
already accepts for Drive files with no uploader record. `renderDayBookingList`'s
`canManage` and `renderGrid`'s "mine"-chip highlighting both already guard on
`myUid` being non-null first, so this isn't a new code path — an anonymous
visitor's own booking just never qualifies for either. The "내 예약" card
also can't show anything meaningful without an identity to filter by, so for
an anonymous visitor it skips the query entirely and shows "로그인하면 내가
예약한 목록을 여기서 보고 수정·취소할 수 있어요." instead — logging in is
still the only way to manage one's own bookings later, it's just no longer
required to view the grid or make a first booking.

**익명 예약도 등록 시 이름+숫자 비밀번호를 받아서, 본인이 나중에 직접 수정·삭제할 수
있다.** 이전까지는 "익명 예약은 생성자 본인도 나중에 수정/취소할 수 없고 관리자만
가능"이 받아들여진 한계였는데(바로 위 "Known, accepted gap" 참고), 비밀번호를 걸어
그 한계를 좁혔다. `room_bookings`에 `password_hash`/`password_salt`(둘 다
nullable — 로그인한 사람의 예약은 `teacher_id` 자체가 소유권 증명이라 비밀번호가
필요 없고, 계속 `null`로 남는다) 컬럼을 추가하고, `collect_settings`/
`shared_edit_settings`와 같은 해시 패턴(`digest(password || '|' || salt,
'sha256')`)을 쓰는 세 개의 `SECURITY DEFINER` RPC로 익명 예약의 생성/수정/삭제를
전부 옮겼다:
- `room_booking_create_anon(p_room_name, p_booking_date, p_start_time, p_end_time, p_title, p_teacher_name, p_password)`
  — `p_password`가 숫자 4자리 이상인지(`^[0-9]{4,}$`) 서버에서 직접 검증한 뒤 해시로만
  저장한다. day-modal의 "+ 새 예약 추가" 폼은 `myUid`가 없을 때만(비로그인일 때만)
  "비밀번호(숫자 4자리 이상)" 입력칸(`#dayAddPasswordRow`)을 보여주고, 그 경우
  직접 `insert` 대신 이 RPC를 호출한다 — 로그인한 사람은 지금까지와 동일하게 직접
  `insert`(비밀번호 없음).
- `room_booking_verify_anon_password(p_id, p_password)` — 저장된 해시와 맞는지만
  boolean으로 확인하고, 해시/salt 자체는 함수 밖으로 절대 내보내지 않는다. 아래 두
  RPC가 이 함수를 내부적으로 호출한다.
- `room_booking_update_anon(p_id, p_password, p_start_time, p_end_time, p_title, p_teacher_name)`
  / `room_booking_delete_anon(p_id, p_password)` — 비밀번호가 틀리면 그냥 예외를
  던진다(`error.message`에 "비밀번호가 올바르지 않아요." 그대로 뜸).

클라이언트는 `room_bookings`를 조회하는 모든 `select(...)`에서 지금까지처럼
`password_hash`/`password_salt`를 절대 포함하지 않는다(명시적 컬럼 목록을 쓰는 이
파일의 기존 관행 그대로 — RLS가 열려 있어도 select 목록에 없으면 브라우저로 넘어가지
않는다).

`renderDayBookingList()`의 `canManage`는 `!b.teacher_id`(익명 예약)일 때도 항상
true가 되도록 바뀌었다 — 익명 예약은 누가 만들었는지 알 길이 없으니 수정/삭제
버튼 자체는 누구에게나 보여주고, 실제로 누르는 순간에 비밀번호를 요구해서 걸러낸다.
단, **관리자가 보는 중이면 비밀번호 없이 바로** 수정/삭제된다 — 기존
`room_bookings_update_admin`/`_delete_admin` RLS가 `teacher_id`와 무관하게 이미
허용하고 있어서, `needsPassword = isAnon && !isAdmin`로 admin 세션일 때만 패스워드
RPC 경로를 건너뛴다. 수정 모드로 들어간 익명 예약의 `.rb-day-edit-row`는
`needsPassword`일 때만 비밀번호 입력칸(`.dayEditPassword`)을 추가로 렌더링하고,
삭제는 `cancelBooking(id, needsPassword)`(`"내 예약"` 목록의 취소 버튼은 항상
`needsPassword` 없이 호출되므로 로그인한 사람의 직접-삭제 경로는 전혀 안 바뀜)가
`prompt()`로 비밀번호를 받아 RPC를 호출한다.

**의도적으로 손대지 않은 범위**: "엑셀로 일괄 예약" 탭으로 익명 방문자가 올리는
행은 여전히 비밀번호 없이(`teacher_id: myUid`가 `null`인 그대로) 바로 `insert`된다
— 한 번에 여러 줄을 upload하는 흐름에 비밀번호 입력까지 끼워 넣으면 복잡도가 크게
늘어나는 데 비해, 이 기능이 해결하려던 "가장 흔한 등록 경로"는 day-modal 쪽이라고
판단했다. 일괄 예약으로 만들어진 익명 예약은 지금까지처럼 관리자만 수정/삭제할 수
있다.

**Incident: `room_booking_delete_anon` initially couldn't be deployed from this
sandbox** — every `execute_sql`/`apply_migration` call whose body contained a
literal `DELETE FROM` kept coming back `cancelled`/`timed out`, while the
sibling `create_anon`/`verify_anon_password`/`update_anon` functions (same
shape, no `DELETE`) deployed instantly — strongly suggesting the Supabase MCP
tool's destructive-statement safeguard was flagging it and never getting a
confirmation back in this non-interactive flow. Worked around by having the
user paste the one `CREATE FUNCTION room_booking_delete_anon(...)` statement
directly into the Supabase dashboard's SQL Editor themselves, which isn't
subject to that same tool-level gate.

**Second bug, found only once end-to-end testing actually ran**: the very
first live test of `room_booking_create_anon` failed with `function
gen_random_bytes(integer) does not exist` — `pgcrypto` on this project lives
in the `extensions` schema, not `public`, and all four of these new functions
were declared with `set search_path = public` (copied from the
`collect_settings`/`shared_edit_settings` RPCs, which only ever call
`digest()` — this project's pgcrypto placement means even that call was
silently relying on `public`'s search path including `extensions` by some
other mechanism, or just never actually being pgcrypto-schema-qualified
under test before now). Fixed by changing all four functions' `search_path`
to `public, extensions`. Confirmed end-to-end after the fix (create with a
test booking → `delete_anon` with a wrong password correctly raises "비밀번호가
올바르지 않아요." → `delete_anon` with the right password removes the row).
If you add another password-hashing RPC anywhere in this codebase, copy
`search_path = public, extensions` from here rather than the older
`collect_settings`/`shared_edit_settings` functions' plain `public` — safer
to be explicit about where `digest()`/`gen_random_bytes()` actually live on
this project.

**Date-header 학사일정 display tweaks** (after the feature above first
shipped): per follow-up feedback, each event under a date header now renders
on its own line (`titles.join('\n')` + `white-space: pre-line` on
`.rb-th-academic`, replacing the original `', '`-joined single line) and the
clamp was raised from 2 lines to 4 (`-webkit-line-clamp`) so a busier day
shows more before truncating — both the visible text and the `title` tooltip
attribute use the same newline-joined string, so hovering shows every event
with the same line breaks even when the display itself clips.

**교실/위치 필터는 다중 선택(체크박스)이다— 원래는 둘 다 단일 `<select>`
였다.** `#roomFilterBtn`/`#locationFilterBtn`(plain `<button>`, not a
`<select>` anymore) toggle a small floating checklist panel
(`.ms-filter-panel`, absolutely positioned under the button, closed by
clicking anywhere outside `.ms-filter`) built once per `loadRooms()` call by
the shared `renderMsFilterPanel()` helper — one generic function reused for
both the 교실 list and the 위치 list, since the two are otherwise identical
(checkbox list + "전체 선택"/"전체 해제" shortcut links). Selection state is
two `Set`s (`filterRoomNames`/`filterLocations`, empty = "전체" = no
filtering, matching the old `'all'` sentinel's meaning) persisted to
`localStorage` as JSON arrays (`ks_room_booking_filter_rooms_v2`/
`..._locations_v2` — versioned `_v2` keys since the old singular-value
format under the unsuffixed keys couldn't represent a multi-value selection
and was intentionally not migrated, just abandoned). `visibleRoomsForGrid()`
changed from an exact-match single comparison to
`set.size === 0 || set.has(...)` — everything downstream of it (the grid,
the admin room list is unaffected since that's unfiltered) needed no other
change. `populateRoomFilters()` also prunes any selected name/category that
no longer exists in `rooms` (e.g. a room was renamed or deleted) on every
reload, same defensive cleanup the old single-select version already did
for its one stored value.

**위치 필터는 칩(토글 버튼) 방식으로 다시 바뀌었다 — 교실 필터는 그대로 체크박스
팝오버.** 위치는 건물 층 단위라 가짓수가 적으니(교실 ~40개와 달리), 버튼을 눌러
패널을 열고/체크하고/닫는 과정 없이 한눈에 보이는 토글 칩을 눌러 즉시 켜고 끌 수
있는 편이 더 편하다는 명시적 피드백을 반영했다. `#locationFilterPanel`/
`#locationFilterBtn`을 `#locationFilterPills`(단순 `<div>`)로 교체하고,
`renderLocationPills(locations)`가 위치마다 `.rb-loc-pill` 버튼을 그려서 클릭 시
바로 `filterLocations` Set을 토글 + `localStorage` 저장 + `renderGrid()` 재호출까지
한 번에 처리한다(패널 열림/닫힘 상태 자체가 없어서 `closeAllMsFilterPanels()`나
바깥 클릭 감지가 전혀 필요 없음). 교실 필터(`#roomFilterBtn`/`#roomFilterPanel`)는
여전히 `renderMsFilterPanel()` 기반 체크박스 팝오버로 남아있다 — 가짓수가 많은
목록(교실)엔 그 UI가 더 적합하다고 판단했고, 사용자도 위치만 콕 집어 요청했다.
`LOCATION_FILTER_KEY`(`ks_room_booking_filter_locations_v2`) 저장 형식은 바뀌지
않았으니 기존에 저장된 선택값은 칩 UI로 넘어와도 그대로 복원된다.

**"일괄 예약" 탭도 자기만의 교실/위치 다중 선택 필터를 갖는다 — 예약 현황 탭의
필터와 상태를 의도적으로 공유하지 않는다.** 원래 "엑셀 양식 다운로드"는 항상
등록된 모든 교실 × 선택한 기간의 모든 날짜를 담아서 내려줬는데, 교실이 많아질수록
받는 사람이 원하지 않는 교실들까지 다 같이 받게 되는 문제가 있었다. `#bulkRoomFilterBtn`/
`#bulkRoomFilterPanel`, `#bulkLocationFilterBtn`/`#bulkLocationFilterPanel`(여전히
체크박스 팝오버 — 다운로드는 즉시 반영되는 화면이 없어서 칩으로 바꿀 이유가 없다)이
자체 상태(`bulkFilterRoomNames`/`bulkFilterLocations`, `localStorage` 키는
`ks_room_booking_bulk_filter_rooms`/`_locations` — 그리드 필터의 `_v2` 키와 완전히
분리)를 갖고, `roomsForBulkTemplate()`이 `rooms`를 그 기준으로 걸러서
`btnDownloadBookingTemplate` 핸들러가 (기존의 전체 `rooms` 대신) 그 필터링된
목록으로만 양식 행을 만든다. 상태를 분리한 이유: 그리드 화면은 전체 교실을 보면서도
다운로드만 2~3개 교실로 좁히고 싶은 경우가 자연스러워서다. 이를 위해
`renderMsFilterPanel()`에 `onApply` 콜백 매개변수를 추가했다(생략 시 기존처럼
`renderGrid(currentGridDates)`를 호출 — 예약 현황 탭의 교실 필터는 그대로 동작) —
일괄 예약 탭의 두 패널은 다시 그릴 그리드가 없으니 `onApply: () => {}`로 넘긴다.

**예약 현황 날짜 헤더/빈 교실 찾기 슬롯 모두 그날의 학사일정을 함께 보여준다.**
`fetchAcademicEvents(startKey, endKey)`는 `nav.js`의 `searchCalendarContent()`와
동일한 공개 구글 캘린더(`GCAL_API_KEY`/`GCAL_CALENDAR_ID`, 로그인 불필요)를
그대로 복사해 썼고, `{ 'YYYY-MM-DD': ['제목', ...] }` 형태로 돌려준다 — 이
페이지엔 `cal-shared.js` 같은 공용 스크립트가 없어서(그 스크립트는 msal/구글
토큰 등 이 페이지엔 필요 없는 의존성까지 끌고 들어와서) 이 저장소의 일반적인
copy-paste 관행대로 함수 하나를 그대로 복제했다. `loadGrid()`가 `room_bookings`
조회와 함께 `Promise.all`로 그 달 전체 범위를 한 번에 가져와 `academicEventsByDate`
에 캐시해두고, `renderGrid()`는 각 날짜 `<th>` 밑에 `.rb-th-academic`(2줄 clamp +
`title` 속성으로 전체 텍스트)로 덧붙인다. **빈 교실 찾기**(`addVacancySlotRow`)는
이 달 단위 캐시에 기대지 않는다 — 찾으려는 날짜가 지금 보고 있는 달 바깥일 수도
있어서, 슬롯의 `.vSlotDate`가 바뀔 때마다 `updateVacancySlotDayInfo()`가 그 하루치만
가볍게 다시 조회해서 날짜 입력칸 바로 옆(사용자가 요청한 "날짜 → 요일/학사일정 →
시작/종료 시간" 순서)의 `.vSlotDayInfo`에 `"화요일 · 학사일정: 중간고사"` 식으로
표시한다 — 비동기 응답이 돌아올 때쯤 날짜가 또 바뀌어 있을 수 있어 응답 처리 직전에
`.vSlotDate.value`가 여전히 그 요청을 보낸 날짜와 같은지 재확인한 뒤에만 반영한다.
새 슬롯을 추가할 때도 같은 흐름(요소 추가 → change 리스너 연결 → 즉시 한 번 조회)을
타므로 모든 줄이 항상 자기 날짜에 맞는 정보를 보여준다.

**`fetchAcademicEvents`는 학교 자체 학사일정 캘린더뿐 아니라 "대한민국 공휴일"
구글 공개 캘린더(`ko.south_korea#holiday@group.v.calendar.google.com`)도 함께
조회해 합친다.** 학교 캘린더에는 추석·설날 같은 법정 공휴일이 따로 입력돼 있지
않을 수 있어서, 같은 API 키로 로그인 없이 바로 읽을 수 있는 이 공개 캘린더를
`Promise.all`로 나란히 호출하고, 날짜별로 `Set`에 모아 두 캘린더에 같은 제목이
우연히 겹쳐도 한 번만 보이게 중복 제거한다(`fetchOneCalendar()` 내부 헬퍼 +
`seenByKey`). 날짜 헤더/빈 교실 찾기 슬롯 양쪽 모두 이 하나의 함수를 그대로
재사용하므로 별도 변경 없이 공휴일이 같이 뜬다.

**날짜 헤더의 학사일정은 최대 4줄까지만 보이고(CSS `-webkit-line-clamp:4`) 넘치는
나머지는 "…"로 잘린다 — 그 칸을 클릭하면 `#academicModal` 팝업으로 전체 목록을
한 줄씩 보여준다.** `.rb-th-academic`에 `data-date` 속성을 심어두고, `#rbGrid`에
델리게이트한 별도 클릭 리스너(기존의 `.rb-cell` 클릭 리스너와는 셀렉터가 겹치지
않아 서로 간섭하지 않음 — `<th>` 안의 `.rb-th-academic`은 `.rb-cell`에 매치되지
않는다)가 `openAcademicModal(dateStr, academicEventsByDate[dateStr])`을 호출해
`academic-modal-item`들을 나열한다. `#dayModal`과 똑같은 `.modal-overlay`/
`.modal-box` 클래스를 재사용하는 별도 모달이다.

**빈 교실 찾기 슬롯 행(`.vacancy-slot-row`)이 `display:flex`였을 때는 학사일정
텍스트 길이가 날짜마다 달라서(한 줄 vs. 여러 줄 vs. 없음) 같은 줄의 시작/종료
시간 입력칸이 줄마다 다른 가로 위치에 놓이는 문제가 있었다 — flexbox는 독립된
행마다 각자 레이아웃을 잡기 때문에 "표처럼 열이 맞춰진다"는 보장이 없다.**
`display:grid; grid-template-columns:150px minmax(180px,1fr) 130px 130px auto;`로
바꿔 날짜/학사일정/시작시간/종료시간/삭제 다섯 칸의 너비를 고정했다 — 학사일정이
길어서 줄바꿈되면 그 칸만 세로로 늘어날 뿐, 옆 칸들의 가로 위치는 모든 행에서
항상 동일하다(`align-items:start`). 삭제 버튼도 다른 칸들과 똑같이 빈 `&nbsp;`
라벨을 가진 `.field-inline`으로 감싸서, 라벨 줄 높이만큼 아래로 내려 입력칸과
수평이 맞게 했다.

**모든 `<input type="time">`에 `step="600"`(600초=10분)을 추가해, 네이티브 시간
선택기의 "분" 스크롤이 10분 단위로만 움직이게 했다** — 분을 1분 단위로 일일이
스크롤해야 했던 불편함을 줄이기 위함. 빈 교실 찾기 슬롯, 빈 교실 예약 패널,
`#dayModal`의 새 예약 추가/수정 폼 등 이 페이지의 모든 시간 입력칸에 동일하게
적용했다 — 어차피 15분/30분 단위로 예약하는 경우가 대부분이라 10분 단위로도
충분히 세밀하다는 판단. (수동으로 `HH:MM`을 직접 타이핑하는 것 자체는 막지 않는다
— `step`은 스피너/피커의 증가 단위일 뿐, 브라우저가 임의의 값을 거부하진 않는다.)

**모든 시간 입력칸에 `lang="en-GB"`를 추가해 오전/오후 대신 24시간 형식으로
표시되게 했다.** `<input type="time">`의 12시간제(오전/오후) vs 24시간제 표시는
`step`과 무관하게 **브라우저가 `lang` 속성을 보고 결정**한다(크롬/엣지 기준) — 페이지
전체의 `lang`은 `ko`로 둔 채, 24시간제를 쓰는 영국 영어(`en-GB`)를 이 입력칸들에만
지정하면 저장되는 값(`HH:MM`, 24시간 기준 문자열)은 전혀 바뀌지 않고 화면 표시와
스피너만 24시간제로 바뀐다. "오전 4:00"처럼 AM/PM을 먼저 고르고 시:분을 입력해야
했던 것보다, 24시간제가 숫자만 쭉 타이핑하기(`1430` 식)에도 더 간편하다는 사용자
피드백으로 추가했다. `step="600"`이 이미 적용된 8개 시간 입력칸(`#dayAddStart`/
`#dayAddEnd`, `#calAddStart`/`#calAddEnd`, `.dayEditStart`/`.dayEditEnd`,
`.vSlotStart`/`.vSlotEnd`, `.vbSlotStart`/`.vbSlotEnd`) 전부에 똑같이 추가했다.
Firefox/Safari는 `lang` 속성을 무시하고 OS 자체 로캘을 따르는 경우가 많아서
이 트릭이 100% 모든 브라우저에서 통하진 않지만, 크롬/엣지(교직원들이 가장 흔히
쓰는 브라우저) 기준으로는 확실히 적용된다.

**`step="600"`만으로는 "스크롤로 분을 고를 때 여전히 1분 단위로 움직인다"는
피드백이 나왔다 — 크롬 계열 브라우저에서 시간 입력칸 위 마우스 휠 스크롤은
`step`을 무시하고 항상 ±1분으로만 움직이는 알려진 동작(위/아래 화살표 키 입력에는
`step`이 반영되지만, wheel 이벤트는 브라우저가 별도로 처리해서 그냥 ±1을 적용함)
때문이다.** 처음엔 `change` 이벤트(포커스 이탈 시점)마다 값을 가장 가까운 10분
단위로 강제 반올림하는 방식으로 고쳤는데, 이러면 **숫자를 직접 타이핑으로 넣은
값까지 덩달아 보정돼버려서** "타이핑은 그대로 둬도 되는데 스크롤만 문제다"라는
명시적 피드백으로 다시 수정했다 — 타이핑/키보드 입력은 전혀 건드리지 않고,
**`wheel` 이벤트만** 가로채는 방식으로 교체했다. `stepTimeInputByWheel(input,
deltaY)` + `document`에 델리게이트한 `wheel` 리스너(`{ passive: false }` — 그래야
`e.preventDefault()`가 먹힘)가, **포커스된 시간 입력칸 위에서 스크롤할 때만**
브라우저의 기본 ±1분 동작을 막고 그 자리에 직접 계산한 ±10분을 넣는다 —
`document.activeElement === e.target`을 확인해서, 포커스되지 않은 입력칸 위의
스크롤은 그대로 페이지 스크롤로 넘어가게 둔다(대부분의 브라우저도 포커스된
입력에서만 wheel로 값이 바뀌므로 동작 범위가 원래의 네이티브 동작과 일치한다).
59분을 넘겨 올리면 시(時)도 함께 올라가고, 23시를 넘기면 다음날 0시로 넘어간다
(`((h*60+m+dir*10) % 1440 + 1440) % 1440`로 음수 나머지 없이 0~1439분 범위를
순환). 리스너는 개별 입력칸마다 따로 붙이지 않고 `document`에 하나만 델리게이트해
`input[type="time"]`인지만 확인한다 — 이 페이지의 시간 입력칸은 정적인 것
(`#dayAddStart` 등)과 "+ 시간 추가"로 동적으로 생기는 것(`.vSlotStart` 등)이
섞여 있는데, 델리게이트 방식이라 동적으로 추가된 입력칸에도 별도 리스너 연결
코드 없이 똑같이 적용된다. `test_room_booking_time_snap.js`로 (1) 타이핑한 값은
전혀 보정되지 않고 그대로 유지됨, (2) 포커스 상태에서 위/아래 스크롤이 정확히
±10분씩 움직임, (3) 59분을 넘기는 스크롤에서 시 단위까지 올라감, (4) 포커스 안 된
입력칸 위 스크롤은 값이 안 바뀜 — 네 가지를 모두 검증했다.

**빈 교실 찾기에서 시작·종료 시간을 둘 다 비워두면 "종일" 검색이 된다"** — 그
날짜에 그 교실 예약이 하나라도 있으면 "비어있지 않음"으로, 아예 없으면
"종일 비어있음"으로 판정한다(`freeRoomsFor()`가 `slot.start`가 없을 때는 시간
겹침 계산 없이 그 날짜의 해당 교실 예약 유무만 본다). 시작·종료 중 하나만
입력하면 "둘 다 입력하거나 둘 다 비워주세요" 에러를 띄운다. `slotLabel()`도
종일 슬롯은 `"10/20(화) 종일"`처럼 시간 없이 표시한다.

**빈 교실 찾기 결과의 교실 칩을 클릭하면 그 교실을 바로 예약할 수 있는 패널이
열린다** — "여러 날짜 반복된 것을 자동으로 넣어서 바로 예약"하자는 요청을
반영한 것. 각 `roomListHtml()` 결과의 교실은 이제 정적 `<span>`이 아니라
`data-room`/`data-slots`(JSON)를 담은 클릭 가능한 `<button>`이고, "공통으로
비어있는 교실" 그룹은 전체 슬롯을, 슬롯별 그룹은 그 슬롯 하나만 `data-slots`에
싣는다. `#vacancyResultArea`에 델리게이트된 클릭 리스너가 `openVacancyBookPanel
(roomName, slots)`을 호출해 `#vacancyBookPanel`을 연다. 종일 검색으로 찾은
슬롯은 실제 예약에 쓸 시간이 없으므로(그 날짜 전체가 비어있다는 것만 확인됐을
뿐), 패널은 슬롯마다 시작·종료 시간 입력칸을 다시 보여주고(`#vacancyBookSlotsList`,
시간이 있던 슬롯은 미리 채워주고 종일 슬롯은 빈 채로 필수 입력을 요구) 모든 줄을
채워야 "예약 확정"이 진행된다. 예약 생성 로직 자체는 `#dayModal`의 "+ 새 예약
추가" 폼과 완전히 동일한 분기(`myUid`가 있으면 직접 `insert`, 없으면
`room_booking_create_anon` RPC + 비밀번호)를 그대로 재사용하고, 슬롯마다 순서대로
호출해 23P01(시간 겹침) 등 슬롯별 실패를 모아 "N건 중 M건 예약했어요" 식으로
결과를 보여준다. 성공한 건이 하나라도 있으면 그리드/내 예약을 새로고침하고 빈
교실 찾기를 다시 실행해 방금 예약된 슬롯이 결과에서 빠지는 걸 바로 확인할 수
있게 한다.

**예약을 만들고 나면 "📅 학교 공용 캘린더에도 추가" 버튼이 나타나서, 그 예약을
학교 공용 학사일정 캘린더(날짜 헤더/빈 교실 찾기에서 읽기 전용으로 보여주는 바로
그 캘린더)에도 등록할 수 있다.** 예약 생성(Supabase)과 캘린더 등록(구글 캘린더)은
완전히 분리된 두 단계로 설계했다 — 캘린더 등록을 건너뛰거나 실패해도 방금 만든
예약 자체는 이미 끝난 상태라 영향이 없다. 구글 캘린더 읽기에 쓰는 `GCAL_API_KEY`는
`events.list`만 되는 공개 읽기 전용 키라 일정을 새로 쓸 수 없어서, 쓰기는 파일
수합함/자료실과 같은 공용 Apps Script 배포(`SCRIPT_URL`, `collect.html`과 완전히
동일한 URL을 그대로 재사용 — `driveApi()` 헬퍼도 이름·구현 모두 그대로 복사)에
새로 추가한 `addCalendarEvent` 액션으로, 즉 **그 스크립트를 배포한 구글 계정의
권한으로** 처리한다(`actionAddCalendarEvent`, `collect-setup.md` 9번). 이 계정이
학사일정 캘린더에 "일정 수정" 권한을 갖고 있어야만 성공하며, 권한이 없으면
`CalendarApp.getCalendarById`가 `null`을 돌려주거나 `createEvent`가 예외를 던지는데
두 경우 모두 사람이 읽을 수 있는 에러 메시지로 감싸서 돌려준다 — 조용히 실패하지
않는다.

**Incident: 모든 조건(배포 실행 계정, 배포 액세스 권한, 캘린더 ID, 그 계정의 캘린더
공유 권한)을 하나씩 확인했는데도 "학교 공용 캘린더에 접근할 수 없습니다" 에러가
계속 재현된 사례가 있었다.** `CalendarApp.getCalendarById`가 던지는 예외를
`catch(err){ cal = null; }`로 그냥 삼켜버리고 있어서, 실제로 어떤 이유로 실패했는지
(권한 문제인지, 다른 예외인지) 전혀 알 수 없었던 게 원인 — 사용자가 계정/권한을
전부 맞게 설정했다고 확인했는데도 같은 메시지가 반복되면, 그 메시지 자체가 더 이상
신뢰할 수 있는 진단 정보가 아니라는 뜻이다. **고쳐서** 이제 `err.message`를 잡아뒀다가
에러 응답에 "(상세: ...)"로 그대로 포함시킨다 — 재배포 후 다시 시도하면 실제 예외
메시지가 화면에 그대로 보여서 다음 진단 단계를 바로 잡을 수 있다.

버튼을 누르면 바로 등록하지 않고, `#calendarAddModal`(제목/날짜/시작·종료 시간이
해당 예약 내용으로 미리 채워진, 수정 가능한 작은 검토 팝업)이 먼저 뜬다 — "그 자리에서
내용을 확인하고 실행하면 캘린더에 일정이 입력되게" 해달라는 요청대로, 확정 버튼을
한 번 더 눌러야 실제 `addCalendarEvent` 호출이 나간다. 이 버튼/모달은 day-modal의
"+ 새 예약 추가"(`#dayModalCalAddArea`)와 빈 교실 찾기의 예약 패널
(`#vacancyBookCalAddArea`) 둘 다에서 공유하는 하나의 로직(`calAddPromptHtml()`,
`openCalendarAddModal()`) — 버튼 HTML 자체에 그 예약의 제목/날짜/시작·종료 시간을
`data-booking`(JSON)으로 실어두고, `document`에 델리게이트한 클릭 리스너 하나가
어느 쪽에서 눌렸든 똑같이 처리한다. 빈 교실 찾기 예약 패널은 여러 슬롯을 한 번에
예약할 수 있어서(위 문단 참고), 정확히 한 건만 성공했을 때만(가장 흔한 단일
예약 케이스) 이 버튼을 보여준다 — 여러 건이 한꺼번에 성공하면 이 버튼 하나로는
그중 어느 것을 캘린더에 넣을지 애매해지므로, 그 경우엔 아예 버튼을 띄우지 않는다
(각 예약은 여전히 정상적으로 다 생성된다 — 캘린더 등록만 생략될 뿐).
`openDayModal()`/`openVacancyBookPanel()`은 각각 자기 영역을 열 때마다 이 버튼
영역을 비워서, 다른 날짜·다른 교실로 옮겨간 뒤에도 전 예약의 버튼이 남아있지
않게 한다.

**Apps Script 쪽 변경은 이 문서를 작성한 이 환경에서 직접 반영할 수 없다** —
파일 수합함/자료실과 똑같은 제약으로 script.google.com에 이 저장소 밖에서 수동으로
붙여넣고 **배포 → 배포 관리 → 수정 → 새 버전**으로 재배포해야 실제로 동작한다.

**Incident: "학교 공용 캘린더에 접근할 수 없습니다" 에러가, 실행 계정/액세스 권한/
캘린더 ID/캘린더 공유 권한을 전부 하나씩 직접 확인해도 계속 재현됐다.** 처음엔
`addCalendarEvent`를 `collect.html`/`file-library.html`과 같은 **공용** Apps Script
배포(학교 Workspace 조직 계정 `khs3945@senedu.kr`로 배포됨)에 추가했는데, 다음을
전부 확인했는데도 실패가 계속됐다: (1) 배포의 "다음 사용자 인증 정보로 실행" = 그
조직 계정 본인, (2) 액세스 권한 = 모든 사용자, (3) `GCAL_CALENDAR_ID`가 가리키는
캘린더와 사용자가 확인한 캘린더의 ID가 정확히 일치, (4) 그 조직 계정이 그 캘린더에
"변경 및 공유 관리"(최고 권한) 상태. 진짜 원인은 `CalendarApp.getCalendarById`가
던지는 예외를 그냥 삼키고 있어서(`catch(err){ cal = null; }`) 안 보였던 것 —
`err.message`를 에러 응답에 포함시키도록 디버그 코드를 한 번 심어서 드러난 실제
메시지는 `"The script does not have permission to perform that action. Required
permissions: (...auth/calendar...)"` — 즉 **Calendar OAuth 범위(scope) 승인 자체가
막혀 있었던 것**이지, 캘린더 ACL 공유 권한 문제가 전혀 아니었다. 대상 캘린더 소유자가
조직(`senedu.kr`) 바깥의 **개인 계정**이었다는 점이 결정적 단서였다 — 학교/교육청
Workspace 도메인은 보안을 이유로 ① "API 제어 → 앱 액세스 제어"로 스크립트가 쓸 수
있는 OAuth 범위 자체를 화이트리스트로 제한하거나, ② "조직 외부 캘린더 공유"를 아예
차단해두는 경우가 흔한데, 둘 다 **개인이 아무리 캘린더 쪽 ACL을 올바르게 설정해도
조직 관리자만 풀 수 있는** 상위 레벨의 제한이다. 승인 팝업조차 뜨지 않고 바로
런타임 예외로 거부된 것도 "개인 동의로 우회할 수 없는 관리자 정책" 쪽에 더 들어맞는
정황이었다.

**해결: 공용 스크립트의 소유권을 옮기는 대신(그러면 파일 수합함/자료실까지 전부
그 계정에 묶여 위험해진다), 이 기능 하나만 쓰는 완전히 독립된 Apps Script 프로젝트를
(조직 Workspace 정책의 영향을 받지 않는) 개인 구글 계정으로 새로 만들어 분리했다**
— `link-hub.html`이 이미 자기만의 별도 Apps Script 배포를 쓰는 것과 같은 패턴.
`room-booking.html`의 `driveApi()`/`SCRIPT_URL`(공용 배포, 이제 이 파일에서는 더
안 쓰임)을 `calendarApi()`/`CALENDAR_SCRIPT_URL`(새 독립 배포 전용)로 교체했고,
설정 방법은 `CALENDAR-SETUP.md`에 별도 문서로 분리했다 — 새 Apps Script 프로젝트
생성, **Calendar 권한을 처음 한 번 편집기에서 직접 함수를 실행해 승인 팝업을
통과시키는 단계**(이걸 건너뛰면 또 같은 에러가 난다 — 승인 팝업은 그 API를 실제로
호출하는 코드가 한 번은 성공적으로 실행돼야 뜬다), 웹앱 배포까지 전부 포함.
`CALENDAR_SCRIPT_URL`은 다른 플레이스홀더 상수들(`KAKAO_JS_KEY` 등)과 같은 패턴 —
`YOUR_PERSONAL_CALENDAR_SCRIPT_URL` 그대로면 `calendarScriptMissing`이 `true`가
되어 네트워크 요청 없이 바로 "아직 설정되지 않았어요" 안내만 뜨고, 교실 예약 자체
(생성/조회/수정/삭제)에는 전혀 영향이 없다.

**"🔍 빈 교실 찾기" card** (between 내 예약 and 엑셀로 일괄 예약) answers "which
rooms are free at this date+time" without needing to scan the whole grid by
eye. One or more **슬롯** rows (날짜 + 시작 시간 + 종료 시간, "+ 시간 추가" to
add more, "삭제" per row but at least one row always stays) are submitted
together: `findVacantRooms()` collects every distinct date across all slots,
queries `room_bookings` directly for exactly those dates (not the
already-cached `bookingsByRoomDate` from the visible month grid, since a
searched date can fall outside whatever month is currently being viewed),
then for each slot filters `rooms` down to those with no booking on that
room+date whose time range overlaps (`aStart < bEnd && bStart < aEnd`, the
same half-open-interval overlap test the `room_bookings` exclusion
constraint enforces server-side). Each slot's free-room list renders as its
own `.vacancy-result-group`; when 2+ slots are entered, an additional
"✅ 모든 시간에 공통으로 비어있는 교실" group is computed as the set
intersection across every slot's free list and rendered first — this is the
"내가 같은 교실을 여러 시간에 걸쳐 써야 하는데 어디가 다 비어있는지" case
the feature was explicitly built for, not just a per-slot lookup. Works
anonymously like the rest of this page (no login required) — the query is a
plain open `room_bookings` select, same as the grid's own.

**"📅 달력형태로 다운로드" — exports the on-screen room×date grid exactly as
shown, to Excel, with freeze panes and in-cell line breaks.** This needed a
real OOXML feature (frozen first row/column, and cells that render multiple
bookings on separate lines) that `xlsx@0.18.5` — the community-edition
SheetJS build this file already loads for every other Excel feature on this
page — **cannot produce at all**: confirmed empirically (not assumed) by
generating a file with `ws[addr].s = {alignment:{wrapText:true}}` and
`ws['!freeze'] = {...}`, then unzipping the result and inspecting
`xl/styles.xml`/`xl/worksheets/sheet1.xml` directly — neither the style nor
the freeze info ever made it into the XML; `get_cell_style()` in this
library's own source only ever handles a cell's number format (`cell.z`),
and the sheetView writer (`write_ws_xml_sheetviews()`) has no pane/freeze
parameter at all. Line breaks inside a cell string (`\n`) *are* written and
preserved correctly (confirmed the same way) — only the style/freeze side
is unsupported.

The fix is to post-process the already-written .xlsx (which is itself just
a zip file) with **JSZip** (`jszip@3.10.1` from jsdelivr, loaded as a third
script tag alongside `xlsx.full.min.js`/supabase-js — chosen over hand-
rolling a zip reader since this is exactly the well-established, widely-used
library for that): `buildWrapAndFreezeXlsxBlob()` runs `XLSX.write(wb,
{type:'array'})` as normal, reopens that ArrayBuffer with
`JSZip.loadAsync()`, then edits two files in place before re-zipping —
`xl/styles.xml` gets one new `<xf>` appended to `<cellXfs>` with
`<alignment wrapText="1" vertical="top"/>` (bumping the `count` attribute to
match), and `xl/worksheets/sheet1.xml` gets that new style index applied to
every `<c ` cell tag (a global regex replace adding `s="<index>"`) plus a
`<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight"
state="frozen"/>` inserted inside `<sheetView>` — both are plain, spec-legal
OOXML markup that Excel reads natively; this file's own `xlsx` library
simply never learned to *write* them (its reader doesn't surface `<pane>`
back out as `!freeze` either when re-reading the patched file, which is
expected — the gap is in that library, not in the file). This only works
because the export always creates exactly one sheet (so it's always
`sheet1.xml`) — don't reuse `buildWrapAndFreezeXlsxBlob()` for a multi-sheet
export without adjusting the hardcoded path. Each data row's height
(`ws['!rows']`, which — unlike cell styles — this library *does* support
writing) is set to fit whichever cell in that row has the most `\n`-joined
lines, so a room+date cell with several bookings doesn't visually overlap
the row below it.

The UI is a 시작일/종료일 pair (`#calDlStartDate`/`#calDlEndDate`, defaulted
once at page load to the currently-displayed month via
`syncCalendarDlDatesToMonth()` — not re-synced on 이전/다음 달 clicks, so
browsing the live grid to another month never silently resets an
already-chosen download range) plus a "📅 달력형태로 다운로드" button, right
under the grid inside the same 예약 현황 card. The exported sheet mirrors
`renderGrid()`'s own shape and ordering exactly — rows come from
`visibleRoomsForGrid()` (so the current 교실/위치 필터and 순번/이름 정렬
both carry over into the download), the first column holds
`name` + (if any) `category` on two lines, and each room+date cell joins
every booking as its own `HH:MM~HH:MM 제목 · 사용자` line (the on-screen chip
omits the user name since the chip is small; the export includes it since
there's more room and it's more useful standalone). The date range is capped
at 180 days client-side (a plain `rangeDates(startStr, endStr).length > 180`
check) — generous enough for a full semester, while still keeping the
column count sane. Row heights are the line-count formula's result × 1.2
(`Math.round(Math.max(18, maxLines * 14 + 4) * 1.2)`, per explicit feedback).
Column widths went through two rounds of "still too wide" feedback: date
columns `wch: 26` → `17` (2/3) → `13` (3/4 of that), and the room-name
column `wch: 22` → `15` (2/3) — both are plain `ws['!cols']` entries, no
JSZip patch needed (unlike the wrap/freeze/font work below, column width is
one of the few style-adjacent things this community `xlsx` build *does*
write correctly on its own). **Font size (11pt) did need the same JSZip
patch as the wrap-text alignment** — the default font (12pt) is `fonts[0]`
in `styles.xml`, which the community build has no API to resize, so
`buildWrapAndFreezeXlsxBlob()` now also appends a second `<font>` entry
(`<sz val="11"/>`, same family/scheme as the default) to `<fonts>`, bumping
its `count`, and the custom cellXf created for wrap-text alignment points
at this new font (`fontId="<new index>" applyFont="1"`) instead of
`fontId="0"` — so the same single custom style already applied to every
cell (via the `<c s="...">` regex) carries both the alignment and the font
size in one pass, no second style or second regex sweep needed.

**Incident: the very first version of this feature downloaded as a `.zip`
instead of a `.xlsx`, even though the filename passed to `a.download` always
ended in `.xlsx`.** Root cause: `buildWrapAndFreezeXlsxBlob()` originally
ended with `return await zip.generateAsync({ type: 'blob' })` — JSZip's own
source (`lib/object.js`) hardcodes `mimeType: "application/zip"` as the
default for every `generateAsync()` call, so the returned `Blob`'s `.type`
was always `application/zip` regardless of what's actually inside it (an
OOXML/.xlsx file is itself a zip container, so the *bytes* were always
correct — only the `Blob`'s declared MIME type was wrong). The browser used
that MIME type (not just the `download` attribute's filename) to decide how
to label/save the file, so it came through as a zip. **Fixed** by generating
`{ type: 'arraybuffer' }` instead and wrapping the result in
`new Blob([buf], { type:
'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })`
explicitly — confirmed by intercepting `URL.createObjectURL` in a Playwright
test and asserting the Blob's actual `.type` before and after the fix. Any
future `zip.generateAsync()` call in this codebase that produces a file
meant to be something other than a plain zip (another Office format, an odd
archive-based format, etc.) needs the same explicit MIME override — never
rely on JSZip's default.

**Tabs (예약 현황/빈 교실 찾기/일괄 예약/내 예약) — the page kept growing one
card at a time (filter/grid, 내 예약, 빈 교실 찾기, 일괄 예약, admin room
list) until scrolling past all of them to reach the one you wanted became
the actual complaint.** A `.rb-tabs` row (four `.rb-tab-btn`s, in that exact
order) sits right under the page's intro paragraph, and each of those four
cards is now wrapped in its own `.rb-tab-panel[data-tab="status|vacancy|
bulk|mine"]` — `switchRbTab(tab)` toggles every panel's `display` and the
buttons' `.active` class together, so exactly one shows at a time. Nothing
about the four panels' internal markup/ids/JS changed — `renderGrid()`,
`findVacantRooms()`, the bulk-excel upload, 내 예약's list, etc. all still
read/write the exact same element ids as before; they just happen to live
inside a panel that's `display:none` until its tab is clicked (toggling
`display` back to visible doesn't lose any state — `bookingsByRoomDate`,
`rooms`, `parsedBulkRows` etc. are all plain module-scope variables, not
re-fetched on tab switch). The last-opened tab is remembered in
`localStorage['ks_room_booking_active_tab']` only — a personal,
this-browser-only convenience, same convention as this page's other
view-only preferences (name-column width, 펼쳐 보이기, filters) — defaulting
to `'status'` (예약 현황) when nothing's stored or the stored value isn't
one of the four known tabs.

**교실 목록 관리 (admin) deliberately stays *outside* the tab system**,
rendered unconditionally after the four `.rb-tab-panel`s (still gated on
`myProfile.is_admin`, unchanged) — it's a fundamentally different concern
(which rooms exist at all, admin-only) from the four tabs (which are all
either reading or writing *bookings*), so folding it into any one tab would
misleadingly suggest it belongs there, and it would disappear from view
every time an admin switched tabs away from whichever one happened to hold
it.

**"달력형태로 다운로드" moved to the very top of the 예약 현황 tab, above
the 교실/위치 필터·펼쳐 보이기·월 이동 toolbar and the grid itself** — per
explicit request, so it's the first thing visible on opening that tab
rather than something you have to scroll past the whole month's grid to
reach. `.calendar-dl-row`'s divider was flipped for this position
(`.calendar-dl-row-top` zeroes out the top margin/border the class normally
carries — which assumed it sat *below* the grid — and instead draws a
bottom border, since it's now followed immediately by the filter row).
Nothing about `buildWrapAndFreezeXlsxBlob()`/`downloadBlob()`/the date-range
inputs themselves changed; only their position in the DOM did.

**`link-hub.html`'s stale "교실 사용 예약" entry still pointed at the old,
manually-managed Google Sheet** — `link-hub.html` is backed by its *own*
separate Google Apps Script (`SCRIPT_URL` near the top of that file, a
different deployment from `collect.html`'s) that reads/writes a Google
Sheet directly; the `LEGACY_MAIN_LINKS` constant in that file is a one-time
seed list (fed through a "가져오기" button, `migrateLegacyLinks()`) for the
13 links that used to be hardcoded on `index.html` before `link-hub.html`
existed, and "교실 사용 예약" in that list still carried the old sheet URL
even after `room-booking.html` replaced it everywhere else in the repo
(`nav.js`/`index.html` were already fixed back when `room-booking.html` was
first built). Updated the constant to point at
`https://jocular-panda-50501a.netlify.app/room-booking.html` (the deployed
site's own domain, per `AUTH-SETUP.md`'s OAuth-origin example — there's no
dedicated "what's our domain" doc, so that's the one place it's written
down) for any future re-seed. **This alone doesn't fix what's already live**
— if that link was already imported into the actual Google Sheet (which it
likely was, back when `room-booking.html` first shipped), the already-saved
row still has the old URL, and this sandbox has no outbound network access
to `script.google.com` to call that Apps Script's own `{action:'update',
id, ...}` endpoint and fix it directly (confirmed by a direct `curl` to the
deployment URL timing out, same `*.supabase.co`-style egress restriction as
elsewhere in this environment). Fixing the already-live entry needs a human
with the page open: open `link-hub.html` as an admin, find "교실 사용
예약", click 수정, replace the URL with the one above, save — the page's
own `onSaveEdit()` already POSTs an `{action:'update', ...}` to the same
Apps Script, so no code change is needed for that part, just the one manual
click.

**표가 너무 길어서 화면을 내리기 힘들다는 피드백으로 `.grid-scroll`의 높이 제한을
더 줄였다(20줄/1000px → 15줄/750px, 1000px:20줄 비율 그대로 환산)** — 기존에 이미
"교실이 많아지면 끝없이 길어지지 않도록" 세로 스크롤 캡을 두고 있었는데, 그 캡
자체가 여전히 너무 길다는 추가 피드백이었다. 숫자만 바꾼 단순한 변경이라 별도 로직
변경은 없다.

**표 아무 곳이나 클릭한 채 드래그하면 상하좌우로 스크롤된다(패닝) — 스크롤바를
직접 잡지 않고도 손으로 끌어서 볼 수 있게.** `.grid-scroll`에 raw Pointer Events
기반 패닝을 추가했다(이 저장소의 드래그앤드롭 관행 — native `draggable`은 iOS
Safari에서 안 됨). `pointerdown`이 `.grid-scroll` 안쪽 어디서 일어나든(교실명 칸,
빈 칸, 예약 칩 위 등) 패닝 후보로 잡아두고, 손잡이(`.rb-col-resize-handle`)/정렬
버튼(`.rb-sort-btn`)/학사일정 칸(`.rb-th-academic`) 위에서는 그 자신의 클릭 동작을
그대로 쓰도록 제외한다. `DRAG_THRESHOLD`(6px) 이상 움직여야 실제 패닝으로
확정되고(그 전까지는 "그냥 클릭"일 수 있으니), 확정되면 `scrollLeft`/`scrollTop`을
마우스 이동량만큼 그대로 따라가게 하면서 `cursor:grabbing` + `user-select:none`을
준다. 패닝이 실제로 일어났으면 `suppressNextCellClick` 플래그를 세워서, pointerup
뒤에 이어지는 `.rb-cell`의 네이티브 `click`(날짜 모달 열기)을 한 번 무시한다 —
안 그러면 패닝으로 칸을 끌고 지나가기만 해도 그 칸의 모달이 열려버린다. 움직임이
없는 순수 클릭은 `suppressNextCellClick`이 세워지지 않으므로 기존처럼 날짜 모달이
정상적으로 열린다.

**예약 칩을 다른 교실·날짜 칸으로 드래그하면 그 예약을 그 칸으로 옮기고(이동),
Ctrl(또는 ⌘)을 누른 채 드래그하면 복사한다.** 패닝과 같은 Pointer Events 체계를
공유하지만, `pointerdown`이 일어난 대상이 드래그 가능한 칩(`.rb-chip-draggable`)
인지로 구분해서 서로 다른 상태(`chipDragState` vs `panState`)로 처리한다. 칩은
`renderGrid()`에서 수정/삭제 버튼과 똑같은 `canManage` 기준(내 예약, 관리자, 또는
익명 예약 — 익명은 누구나 시도할 수 있게 보여주고 실제 이동/복사 시점에 비밀번호로
걸러짐)일 때만 `rb-chip-draggable` 클래스 + `data-booking-id`/`data-anon`을 받는다
— 남의 예약 칩은 아예 드래그 후보가 되지 않고(패닝 후보로 떨어짐), 그 자리를 눌러도
기존처럼 그냥 날짜 모달이 열릴 뿐이다. 드래그 중에는 마우스를 따라다니는 작은
말풍선(`.rb-drag-ghost`, "➡️ 이동하기"/"📋 복사하기" — `e.ctrlKey`/`e.metaKey`를
매 `pointermove`마다 다시 읽어서 드래그 중간에 Ctrl을 누르거나 떼도 즉시 바뀜)과
`document.elementFromPoint()`로 찾은 현재 드롭 대상 칸의 강조(`.rb-drop-target`)를
보여준다. `loadGrid()`가 이미 채워둔 `bookingsById`(id → 예약 row, 이동/복사 시
원본 시간·제목을 바로 찾기 위해 새로 추가한 맵)에서 원본 예약을 찾아:
- **이동**은 `room_name`/`booking_date`만 바꾼다(시간·제목·사용자는 그대로) — 내
  예약이거나 관리자면 그냥 `sb.from('room_bookings').update(...)`, 익명 예약이면
  새로 만든 `room_booking_move_anon(p_id, p_password, p_room_name,
  p_booking_date)` RPC(비밀번호 검증 후 room_name/booking_date만 수정)를 호출한다.
  기존 `room_booking_update_anon`은 시간/제목/사용자만 바꿀 수 있고 room_name/
  booking_date를 바꿀 방법이 아예 없었어서(이동이라는 개념 자체가 그 RPC가
  설계될 때는 없었음), 같은 비밀번호 검증 패턴(`room_booking_verify_anon_password`
  재사용, `search_path = public, extensions`)으로 전용 RPC를 새로 만들었다.
- **복사**는 "+ 새 예약 추가"와 똑같은 소유권 규칙을 그대로 따른다 — 로그인했으면
  원본의 시간/제목을 그대로 가져와 내 이름의 새 예약으로 바로 `insert`하고(남의
  예약을 복사해도 그 복사본은 내 소유가 됨 — 템플릿으로 베껴 쓰는 것과 같은
  개념), 비로그인이면 이 복사본을 나중에 수정·취소할 새 비밀번호를 받아(원본
  예약의 비밀번호와는 무관 — 완전히 새로운 독립된 예약이므로) `room_booking_create_anon`
  을 호출한다.
둘 다 시간대가 겹치면 기존 exclusion 제약이 그대로 `23P01`을 던지고, 이동/복사
실패 메시지도 다른 곳과 같은 "이미 다른 일정이 있어요" 문구로 보여준다. 성공하면
`loadGrid()`로 다시 불러와서 그리드가 즉시 갱신된다.

**Incident: 예약 칩 드래그앤드롭(패닝 포함)이 안 된다는 보고 — `.grid-scroll`에
`touch-action` 자체가 설정돼 있지 않았던 게 원인.** 패닝/칩 드래그 둘 다 raw
Pointer Events로 직접 구현돼 있는데(이 문서의 다른 드래그앤드롭 기능들과 같은
관행), `.grid-scroll{ overflow:auto; ... }`에는 `touch-action`이 기본값(`auto`)
그대로 남아있었다 — 터치 기기에서는 브라우저가 이 영역 위의 터치 드래그를 먼저
"페이지 스크롤 제스처"로 해석해버려서, 우리 JS의 패닝/칩 드래그 처리와 경쟁하다가
지는 경우가 생긴다(`food-map.html`의 지도 터치 핀치줌/드래그가 안 먹히던 것과
정확히 같은 원인·같은 해법 — 그 섹션의 "touch-action:none" 항목 참고). **고쳐서**
`.grid-scroll`에 `touch-action:none`을 추가해 이 영역 안의 모든 제스처 해석을
전부 우리 JS(패닝은 `scrollLeft`/`scrollTop`을 직접 갱신해 스크롤을 완전히
대체하므로 네이티브 스크롤을 꺼도 기능 손실이 없음)에게 맡겼다. 마우스 기반
Playwright 테스트(`test_room_booking_grid_height_pan_dnd.js`)는 이 변경 전후로
모두 통과했는데(마우스는 `touch-action`의 영향을 받지 않음) — 이는 애초에 로직
자체는 멀쩡했고 터치 제스처 경쟁만 문제였다는 뜻이다. `food-map.html`의 지도와
마찬가지로, 이 수정도 실제 터치 기기에서 검증하지는 못했다(이 환경엔 터치
시뮬레이션이 없음) — 터치 제스처 경쟁에 대한 표준적인 대응이라 적용했다.

## `exams.html` (학생별 시험 시간표) is a list page, backed by `exam_schedules`

`exams.html` used to *be* the single student-exam-timetable page: a self-
contained file with a login gate and a hardcoded CSV blob
(`<script type="text/plain" id="embeddedCSV">`, one row per student per
period) for whichever exam was current, generated by `exam-generator.html`
and manually committed over the old copy each time. Since a school runs
several exams a year and teachers wanted to look back at a past one, `exams.html`
was first split into a chooser page (a hardcoded array, per an initial
follow-up) and then, per further follow-up ("생성된 파일에 '이 시험 추가하기'
버튼을 만들어서 시험 목록에 버튼이 추가되게 해줘. 관리자는 시험 목록에서 시험을
숨기거나 삭제할 수 있어야 돼"), that hardcoded array was replaced with a real
Supabase table — a generated exam page needed to be able to register *itself*
into the list by a button click, which a plain hardcoded JS array obviously
can't support.

- **`exam_schedules` table**: `id`, `title`, `period` (free-text display
  string like `"9/28(월) ~ 10/2(금)"`), `href` (e.g.
  `"./exam-2026-2-mid.html"`), `hidden boolean default false`, `sort_order`
  (unused by the UI today, reserved for a future manual-reorder feature),
  `created_by`, `created_at`. RLS is the load-bearing access control here,
  not client-side filtering: `exam_schedules_select` is
  `using (not hidden or current_user_is_admin())` — a non-admin's `select`
  never even receives a hidden row over the wire, it isn't just hidden by
  client JS — `exam_schedules_insert` is `with check (auth.uid() is not
  null)` (any logged-in account, not just admins, since the person clicking
  "이 시험 추가하기" on a freshly generated page is whichever teacher happened
  to run the generator), and `exam_schedules_update`/`_delete` are both
  `current_user_is_admin()`-gated (admin-only hide/unhide and delete, per the
  explicit request).
- **`exams.html` fetches from that table** (`loadExams()`, ordered by
  `created_at desc` — newest exam first) instead of reading a hardcoded array,
  and gates on `profiles.approved` exactly like before. An admin
  (`profiles.is_admin`) additionally sees "숨기기"/"보이기" and "삭제" buttons
  on each `.exam-card` (`.exam-card-admin`, only rendered when `isAdmin`); a
  hidden exam renders dimmed with a "숨김" badge for the admin who can still
  see it (everyone else's `select` never returns that row at all, per the RLS
  policy above). "삭제" only removes the `exam_schedules` row (with a
  `confirm()` warning that the underlying exam page itself is untouched) — it
  does not delete the `exam-<...>.html` file from the repo, which stays
  reachable by direct URL even after being removed from the list. A
  "+ 시험 추가하기" button at the top of the page links to
  `./exam-generator.html` — `exams.html` itself has no "add" form, since
  adding always happens from the generated exam page's own button (see
  below), never from the list page.
- **Each actual exam's data lives in its own file**, named
  `exam-<year>-<sem>-<type slug>.html` (e.g. `exam-2026-2-mid.html` for
  2026학년도 2학기 중간고사) — the original `exams.html` was `git mv`'d
  straight to this name when the list/data split first happened, with its
  content otherwise untouched (still has its own login gate, `EXAM_TITLE`,
  `embeddedCSV` block, print logic, everything). It has a "← 시험 목록으로"
  link back to `exams.html` at the top of `#examMainWrap`, since it's now
  reached by drilling in from the list rather than being the direct
  destination.
- **`exam-generator.html`'s embedded template now carries a "+ 이 시험 목록에
  추가" button itself**, so every newly generated exam page is self-
  registering — no separate admin step to hand-edit a list anywhere.
  `exam-generator.html`'s actual page-building logic (`buildReplacedHtml`,
  searching for `const STUDENTS = [...]`/`const EXAM_TITLE = "..."`/etc. in
  its own base64-embedded template, `EXAMS_TEMPLATE_B64`) is a separate,
  older snapshot of the page structure that predates the current
  `embeddedCSV`-based format live in `exam-<...>.html` today — that drift
  already existed and wasn't fixed (the generator still produces a complete,
  working standalone exam page, just via its own frozen `STUDENTS`-array
  template rather than by reading the live file) — but that frozen template
  is exactly where the new button was added, right after the
  `EXAM_TITLE`/`EXAM_TERM` assignment script: it loads supabase-js (the
  template didn't have it before), and on click calls `sb.auth.getSession()`
  (prompting "로그인 후에 추가할 수 있어요." if there isn't one — this button's
  own auth check, since this old template has no real login gate like the
  live pages do) then inserts one row into `exam_schedules` with `title` =
  `EXAM_TITLE` stripped of its trailing `" · 경성고등학교"`, `href` =
  `'./' + location.pathname.split('/').pop()` (the page's own deployed
  filename — this is *why* the button has to live inside each generated file
  rather than in the generator itself: only the deployed page knows its own
  final filename), and `period` computed client-side from every `STUDENTS[].
  timeline[].day` value present (`computeExamPeriod()`, parsing the
  `"M월 D일(요일)"` strings already in that data and formatting the earliest/
  latest as `"M/D(요일)"`, or `"M/D(요일) ~ M/D(요일)"` if they differ) — no
  separate period input was added to the generator UI for this, since the
  already-generated student data already has the answer. `suggestExamFilename
  (examTerm)` (parses year/semester/exam-type out of the exam term string to
  build `exam-<year>-<sem>-<slug>.html`, falling back to a timestamped
  `exam-new-<ms>.html`) was unaffected by this change — it was already in
  place from the earlier list/data split, and still runs at download time,
  before the button exists to need a filename.

## `exam-generator.html` → `exams.html`: "지금 바로 시험 목록에 추가하기" (no file/GitHub/deploy step)

Everything above this section describes the *original* flow: analyze a NEIS file, download
a generated `exam-<...>.html`, commit it to GitHub, wait for Netlify to deploy, then open
that deployed page and click its own "+ 이 시험 목록에 추가" button. A teacher asked
directly whether that file/GitHub step was actually required and said they wanted it
automated — clicking "추가하기" should make the tile appear in `exams.html` immediately.
It's now automated: `exam-generator.html` has a new "✅ 지금 바로 시험 목록에 추가하기"
button that inserts straight into Supabase, with no file ever touching disk or git.

**This needed closing a real, pre-existing gap first.** The old per-exam-file approach had
two separate, incompatible data formats living side by side (the generator's own frozen
`STUDENTS`-array template vs. the live `exam-2026-2-mid.html`'s `<script
id="embeddedCSV">` CSV-text format — see that file's own history above), and — more
importantly — real student names were always fully present in the deployed static file
regardless of login state; the login/approval gate only hid the screen client-side
(`exam-2026-2-mid.html`'s own code comment says this explicitly). Moving the data into
Supabase, gated by real RLS, fixes both at once: one canonical format, and student data
that's actually inaccessible (not just hidden) to anyone who isn't an approved, logged-in
teacher.

- **`exam_timetable_data` table** (new): `id uuid primary key references exam_schedules(id)
  on delete cascade`, `csv_text text not null` (same `일차,교시,시간,학년,반,번호,이름,과목,장소`
  CSV format `exam-2026-2-mid.html`'s `buildModel()`/`parseCSV()` already expect — unchanged,
  copied verbatim into the new viewer page below), `notice text` (the per-exam 유의사항
  textarea's starting value), `created_at`. This is **deliberately a separate table from
  `exam_schedules`**, not new columns on it — `exam_schedules_select`'s RLS
  (`not hidden or current_user_is_admin()`) is intentionally open to any authenticated
  user since title/period carry no PII, but real student names must not ride along on
  that same permissive policy. `exam_timetable_data` has RLS enabled with **no insert
  shortcut for permissiveness** — `select` requires `exists(select 1 from profiles where
  id = auth.uid() and approved = true)` (the exact same "logged in AND approved" gate every
  exam page's own client-side check already enforces, now actually backed by the database
  instead of just hiding a `<div>`), `insert` is `auth.uid() is not null` (any logged-in
  teacher, matching `exam_schedules_insert`'s existing policy), `update`/`delete` are
  `current_user_is_admin()`-gated (matching `exam_schedules`' own admin-only write
  policies).
- **`exam_schedule_create_with_data(p_title, p_period, p_csv_text, p_notice)` RPC** (new,
  plain `security invoker` — no `security definer` needed since both tables' insert
  policies already allow any logged-in caller) does both inserts atomically under one
  generated id: `new_id := gen_random_uuid()`, insert into `exam_schedules` with
  `href = './exam-view.html?id=' || new_id` already baked in, then insert into
  `exam_timetable_data` with that same id. The id is generated *before* either insert
  (rather than inserting into `exam_schedules` first and reading back its default-generated
  id) specifically so `href` can be set in that single insert — `exam_schedules_update_admin`
  is admin-only, so a non-admin caller's own exam-creation flow could never do a follow-up
  `update` to backfill `href` after the fact.
- **`exam-view.html`** (new) replaces the one-file-per-exam model with a single generic,
  parameterized viewer: `?id=<uuid>` tells it which exam to load. Its CSS, `parseCSV()`,
  `buildModel()`, grid-building (`periodsForGrade`/`buildGrid`/`computeDisplay`/`cellHTML`),
  and print logic (`gridTableHTML`/`studentPrintPageHTML`/`printStudents`) are copied
  **verbatim** from `exam-2026-2-mid.html` — only the data-loading step changed: instead of
  reading `document.getElementById('embeddedCSV').textContent`, it does the same
  login+approved check every exam page already does, then (only once approved) fetches
  `exam_schedules.{title,period}` and `exam_timetable_data.{csv_text,notice}` for that `id`
  in parallel and feeds `csv_text` into the exact same `parseCSV`/`buildModel` pipeline. A
  missing/bad `id`, or a row that doesn't exist (deleted exam, mistyped link), shows a
  dedicated `#examNotFoundView` card ("이 시험을 찾을 수 없어요") rather than silently
  rendering a blank page. **Keep this file's shared logic in sync with
  `exam-2026-2-mid.html` by hand if you ever touch the grid/print code** — this repo's
  usual copy-paste-per-page convention, same as every other shared-but-not-modularized
  block in this codebase; `exam-2026-2-mid.html` itself is left as-is (it's a real,
  already-deployed exam page with real data already baked in — migrating it retroactively
  into this table isn't part of this change) and only *new* exams created through the
  "지금 바로 추가하기" button use `exam-view.html`.
- **`exam-generator.html`'s new flow**: `buildCsvText(students)` converts
  `RESULT_STUDENTS` (the same `{id,name,grade,cls,num,timeline:[{day,period,time,type,
  subject,room}]}` shape `analyze()` already produces) into that CSV format —
  `type:'wait'` → 과목`'대기'`+장소=room, `type:'exam'` → 과목=subject+장소=room,
  `type:'done'` → 과목`'공강'`+장소 empty (matching `exam-2026-2-mid.html`'s
  `computeDisplay()`'s own `대기`/`공강` sentinel-string convention in the 과목 column —
  there's no separate "kind" column, the subject text itself carries the meaning).
  `computeExamPeriod(students)` is the exact same day-string-parsing logic the old
  template's self-register button used (`"M월 D일(요일)"` → `"M/D(요일)"`, or a `~`-joined
  range across every day appearing in the data) — now run inside the generator itself
  rather than inside a page that has to be deployed first to run it. Clicking
  "✅ 지금 바로 시험 목록에 추가하기" (`addNow()`) checks `sb.auth.getSession()` first
  (alert-equivalent inline message if not logged in — this page has no gate wrapper of its
  own, unlike the exam pages themselves, since creating a box was always a logged-in-only
  action gated at RPC level, not at page level), then calls
  `exam_schedule_create_with_data` with the title (examTermInput stripped of a trailing
  `" · 경성고등학교"`, same stripping the old template's button did), computed period,
  built CSV, and the notice textarea's raw text — and redirects straight to
  `./exam-view.html?id=<returned id>` on success. **The old "다운로드" button is kept as a
  clearly-labeled fallback** (re-numbered to step ⑦, its own card text now says "평소에는
  쓸 필요 없어요") rather than removed outright — it still produces a `STUDENTS`-array file
  via the frozen base64 template for the rare case someone actually needs a standalone
  file, but the default, intended path is the instant-add button above it.
- Tested end-to-end with Playwright (`test_exam_automation.js`): a minimal fake NEIS
  "N응시실" sheet (2 days × 2 periods, 2 students, no 자료/대기실 sheets — those are
  optional and only produce a warning) uploaded and analyzed, confirming `btnAddNow`
  calls the RPC with the correctly-stripped title, the correctly-computed date-range
  period, the exact CSV text (header + one row per student per timeline entry), and the
  raw notice text; then separately mocking `exam_schedules`/`exam_timetable_data`
  responses and loading `exam-view.html?id=...` directly, confirming the login-gated main
  view renders with the fetched title/period as the subtitle, the fetched notice
  pre-filling the textarea, and the student grid/preview table built correctly from the
  fetched CSV. **Gotcha hit while writing this test**: this repo's bundled
  `@supabase/supabase-js` version's `.maybeSingle()` does **not** set an
  `Accept: application/vnd.pgrst.object+json` header the way older postgrest-js versions
  did (confirmed by dumping the actual request headers) — it just marks the request
  client-side and unwraps whatever plain JSON *array* comes back (empty array → `null`,
  one-element array → that element). Every earlier test fixture's `wantsSingle ? obj : []`
  branch in this repo was therefore silently always taking the `[]`/array branch anyway
  (and happened to work, since that array branch already returned `[theObject]` in most of
  them) — but this test's first draft returned the real payload only in the (dead)
  `wantsSingle` branch and `[]` in the branch that always fires, so every `.maybeSingle()`
  read came back empty. Fixed by always responding with a one-element array for a
  `.maybeSingle()`-backed endpoint, never conditioning on an `Accept` header check for that
  method — worth remembering for any future mock of a `.maybeSingle()` call in this
  environment's Playwright tests, since the header-based branch silently does nothing.

## `task-assign.html` — standalone page for `my-page.html`'s 할 일 요청 block

A thin wrapper page, not a re-implementation. `my-page.html`'s "나에게 배당된
할 일" block (`#blockAssignedBody` — the task-assignment create/edit form, both
"내가 배정한 업무"/"나에게 온 업무" lists, the 제출 현황 modal, everything
described under `task_assignments` above) only ever existed embedded inside
`my-page.html` itself, with no standalone page of its own — unlike the personal
to-do list (`cardTasks`), which already had `my-todo.html` as its standalone
twin. `task-assign.html` fills that gap the same way every other `?widget=`
consumer in this codebase does: it's just a login-gated shell around
`<iframe src="./my-page.html?widget=blockAssignedBody">`, reusing the generic
`?widget=<any element id>` mechanism `my-page.html` already implements (see the
`my-custom-page.html` widgets section above) rather than duplicating any of that
block's logic. Because it's a live iframe of the same page hitting the same
`tasks`/`task_assignments` tables, there is no separate sync step to build —
assigning or completing something in either place is immediately visible in the
other on next load, same as any two browser tabs open to the same data.

The only code added *inside* `my-page.html` for this is a small "전체 화면으로
보기 →" link (`.assigned-fullpage-link`) next to `blockAssignedBody`'s intro
hint, pointing at `./task-assign.html`. It's deliberately hidden via
`body.widget-mode .assigned-fullpage-link{ display:none !important; }` — without
that, the link would also render *inside* the iframe (both when `task-assign.html`
embeds the block and when `my-custom-page.html`'s own widget grid does), and
clicking it would navigate that iframe to `task-assign.html` instead of the
top-level page, which just looks like a broken nested reload. Hiding it in
widget-mode means it only ever appears on `my-page.html`'s own standalone view,
where clicking it behaves like a normal link.

Unlike `my-todo.html` (reachable only via another page's own link plus site
search, not the hamburger menu), `task-assign.html` **is** a full
`DEFAULT_NAV_ITEMS` entry (`group: '업무 도구'`, `loginRequired: true`) and has
its own `index.html` tool-card, right after 공지사항 작성 in both — per this
repo's `nav.js` gotcha (see the `nav.js` section above), a `DEFAULT_NAV_ITEMS`
entry's tool-card must sit in `index.html`'s DOM in the same relative position
for the group ordering to visually match.

## `form-board.html` (문서 양식 공유)

A shared board for posting reusable document text (기안문/품의문/출결 공문/계획서/
안내문 등) so any teacher can copy an existing one instead of writing from
scratch. The page's user-facing title was renamed from an original working
title ("서식 공유 게시판") to "문서 양식 공유" per explicit follow-up request — only
display text changed (`<title>`, `<h1>`, the `nav.js` label, `index.html`'s
tool-card `<h2>`); the filename (`form-board.html`) and every internal
identifier (`form_templates`, `form_template_categories`, JS variable/function
names) were deliberately left as-is, per this repo's usual rename-display-
text-only convention (see the 나의 페이지/대시보드 naming note elsewhere in this
file). Deliberately **not** a file-upload/download page — per the user's
explicit request, a post's `content` is plain text pasted into a textarea, the
title click expands it inline (accordion, same `.tpl-item.open .tpl-item-body
{display:block}` pattern `bot.html`'s notes panel already uses), and a "내용
복사" button (`navigator.clipboard.writeText`, with a temporary "복사됨!" label
swap reverting after 1500ms — same convention as `collect.html`'s
`.btnCopyItemLink`) copies the raw content directly rather than downloading
anything.

- **`form_templates` table**: `title`, `category` (free text, not an enum —
  `#fCategory` is a plain `<input list="categoryOptions">` with a `<datalist>`
  suggesting 기안문/품의문/출결 공문/계획서/안내문/기타, so a category the
  datalist doesn't already know is still just typed text, exactly like
  `collect.html`'s free-text target-name field), `content`, `author_id`/
  `author_name` (written automatically from the signed-in session at save
  time — `author_name` is `profiles.name`, never a typed field — matching the
  user's explicit "올린 사람과 날짜는 입력되게 해야 돼" requirement), `created_at`/
  `updated_at`. RLS follows the exact `room_bookings` shape documented above
  (open collaborative table, not owner-scoped reads): `select` is open to any
  authenticated user (`auth.uid() is not null`), `insert` requires
  self-attribution (`auth.uid() = author_id`), `update`/`delete` are allowed
  for the post's own author or an admin (`current_user_is_admin()`).
- **Category tabs** (`#categoryTabs`) are derived from the union of whatever
  distinct `category` values already exist in the loaded rows and a separate
  `form_template_categories` registry table (`name text primary key` — same
  "registry exists so a zero-post category can still be found/managed" idea as
  `custom_groups` under 교사 그룹 above), so a category can exist as a tab before
  any post uses it, not just organically once someone types a new value into
  the post form's category field. A dashed-border "+ 카테고리 추가" tab is always
  appended after the real category tabs (`renderCategoryTabs()`); clicking it
  `prompt()`s for a name, `upsert`s it into `form_template_categories` (a no-op
  re-add of an existing name just switches `activeCategory` to it rather than
  erroring or duplicating), and re-renders both the tabs and the post form's
  `#categoryOptions` datalist (`renderCategoryDatalist()`, which unions the
  registry/used categories with the original 6 hardcoded suggestions) so a
  freshly-added category is immediately typeable there too. `insert` on
  `form_template_categories` only requires `auth.uid() is not null` (any
  approved teacher, matching the page's "누구나" openness — not admin-gated like
  `custom_groups`' RPCs, since this table has no membership/rename concept to
  protect, just a name). Selecting a tab is still a single-select client-side
  filter (`activeCategory`, re-running `renderList()` over the already-fetched
  rows, no refetch) — conceptually modeled on `link-hub.html`'s category
  structure but built fresh, since that page's categories are a totally
  different (drag-orderable, admin-curated) concept.
- **Search** (`#tplSearch`) matches title, content, and author name
  (`filteredTemplates()`), applied client-side alongside the active category
  filter, same as the search box on other list pages in this repo.
- Only a post's own author (or an admin) sees 수정/삭제 buttons on it
  (`isMine(t)`); everyone (any approved teacher) can post new ones and read/
  copy every existing one, per "누구나 올릴 수 있고 받을 수 있게". Editing reuses
  the exact same `#tplForm` the "+ 새 서식 올리기" button opens (`editingId`
  branches `insert` vs `update` in `btnSaveTpl`'s handler), same pattern as
  `my-page.html`'s task-assignment edit form.
- Reachable via a `DEFAULT_NAV_ITEMS` entry (`group: '업무 도구'`,
  `loginRequired: true`) and a matching `index.html` tool-card placed right
  after `task-assign.html`'s, per the `nav.js` DOM-order gotcha documented
  above.

**간단 에디터(글자 크기/글자색/글머리 기호) — 더 이상 순수 텍스트 전용이 아니다.**
새 서식 올리기/수정 폼의 `#fContent`가 평범한 `<textarea>`에서 `contenteditable`
div로 바뀌었고, 그 위에 작은 툴바(`#fFontSize` select — 작게/보통/크게/아주 크게,
`execCommand('fontSize', ...)`로 1~7 값을 적용 / `#fFontColor` color input —
`execCommand('foreColor', ...)` / `#btnBullet` — `execCommand('insertUnorderedList')`)
가 붙었다 — 외부 에디터 라이브러리 없이 브라우저 내장 `document.execCommand`만
쓰는, 이 레벨 요청("글자 크기, 글자색, 글머리기호 정도")에 딱 맞는 최소 구현이다.

- **`sanitizeHtml(html)`** — 저장 직전에 항상 거치는 화이트리스트 기반 정리 함수.
  허용 태그(`RICH_TAG_ALLOWLIST`: div/p/br/span/font/b/strong/i/em/u/ul/ol/li)가
  아닌 건 태그만 벗겨내고 내용은 남기며(완전히 지우면 텍스트까지 사라지므로),
  모든 엘리먼트의 속성은 `style`만 남기고(`sanitizeStyleValue()`가 그 안에서도
  `color`/`font-size` 선언만, 그것도 `url()`/`expression()`/`javascript:` 같은 패턴이
  섞이면 통째로 버리고) 나머지는 전부 제거한다 — 붙여넣기로 `<script>`/`onerror=`
  같은 게 섞여 들어와도 저장 시점에 걸러진다. `stripHtmlToText(html)`은 검색
  매칭/복사용 순수 텍스트 추출(`DOMParser` 대신 숨은 `<div>`의 `textContent`를
  읽는 흔한 패턴)이다.
- **`form_templates.is_html`**(새 컬럼, `boolean not null default false`) —
  이 에디터로 저장된 글(`insert`/`update` 모두 항상 `is_html: true`)과, 그 전부터
  있던 예전 순수 텍스트 글을 구분한다. 렌더링(`renderList()`의 `.tpl-content`)과
  수정 폼을 다시 열 때(`openForm()`)는 이 플래그로 분기한다 —
  `is_html`이면 저장된 HTML을 그대로 `innerHTML`에 꽂고, 아니면(예전 글)
  `escapeHtml(content).replace(/\n/g, '<br>')`로 변환해서 꽂는다. 이 분기가 없으면
  예전 글에 실제로 들어있던 `<`/`>` 같은 글자가 HTML 태그로 오인돼 화면에서
  사라지는 회귀가 난다 — 플래그 없이는 "이게 새 형식인지 예전 평문인지"를
  내용만 보고는 구분할 방법이 없다(새 글도 서식을 전혀 안 쓰면 태그가 하나도
  없는 순수 텍스트일 수 있어서, "태그가 있으면 새 형식"같은 휴리스틱은 못 쓴다).
- **"내용 복사" 버튼이 `is_html`인 글은 서식까지 함께 복사한다.** `navigator.clipboard
  .write([new ClipboardItem({'text/html': ..., 'text/plain': ...})])`로 두 MIME
  타입을 동시에 써서, 한글/워드 같은 서식 붙여넣기를 지원하는 곳에 Ctrl+V하면
  글자 크기/색이 그대로 살아있게 하고(`text/html`), 메신저처럼 서식을 못 받는
  곳을 위해 같은 클립보드 항목에 `text/plain`(= `stripHtmlToText()` 결과)도 함께
  담는다. `ClipboardItem`을 지원하지 않는 구형 브라우저나 쓰기가 실패하면
  `stripHtmlToText()`한 일반 텍스트로 조용히 폴백한다. 예전 평문 글(`is_html`
  false)은 그대로 `writeText(t.content)`.

## `file-library.html` (자료실) — Drive-backed folder browser, not Supabase storage

A shared file library ("선생님들이 자유롭게 올리고 받아가는 공용 파일 창고") where any
approved teacher can browse folders, upload files, and download by clicking a
filename — explicitly **not** built on Supabase Storage (too expensive for this
free-tier project at file-library scale), and explicitly **not** just a link out
to a raw Google Drive folder view either. It reuses the same shared Apps Script
deployment `collect.html` already uses (same `SCRIPT_URL` constant, copy-pasted
into this page too, per this repo's convention) — Drive is the actual file store,
Apps Script is the only thing with write access to it, and the page renders
Drive's folder/file listing as its own in-page browser (breadcrumb navigation,
click a folder to go in, click a breadcrumb segment to go back out) so a teacher
never leaves the site or sees Drive's own UI.

- **No new Supabase table.** Unlike almost everything else in this repo, this
  feature needed zero Supabase schema — folder/file structure lives entirely in
  Drive, queried fresh on every navigation via the Apps Script's `libraryList`
  action (no caching, no sync step, no staleness to worry about). The page still
  gates on the standard Supabase Auth + `profiles.approved` session check like
  every other page, purely to decide who's allowed to use the page at all — Drive
  itself has no idea who's logged in.
- **Apps Script additions** (`collect-setup.md`'s `Code.gs`, section 8): a
  self-initializing root folder ("경성고 자료실", separate from the file
  수합함's own "경성고 파일 수합함" root folder — script property
  `LIBRARY_ROOT_FOLDER_ID`, same lazy-create-on-first-call pattern as
  `getOrCreateRootFolder()`), plus seven `action`s in the shared `handle()`
  dispatcher: `libraryList`, `libraryCreateFolder`, `libraryUploadFiles`,
  `libraryDeleteFile`, `libraryDeleteFolder`, `librarySearch`, `libraryZip`.
  `libraryUploadFiles` calls the *existing* `saveFilesToFolder()` helper
  unchanged (same `[{name,mime,data}]` shape `collect.html`'s own uploads
  already use, same `uc?export=download` direct-link format) — no new
  file-saving logic needed, just a new folder to point it at.
- **전체 검색(모든 하위 폴더 포함) — `librarySearch`.** `libraryList` only ever
  lists one folder's direct children, so finding a file buried a few folders
  deep meant clicking in blind. `librarySearch(p.query)` instead uses
  `DriveApp.searchFiles`/`searchFolders` (which search "내 드라이브" as a whole,
  not just the library) and filters every hit through the same
  `ks_folderIsWithinLibrary_()` ancestry check `resolveLibraryFolder_()` already
  uses, so results never leak Drive content outside the library — capped at
  50 files / 30 folders. A file result carries `folderName` (its direct
  parent's name) since search results span many folders at once and the
  file's location is otherwise ambiguous. `file-library.html`'s `#librarySearchInput`
  + "검색" button (also triggered by Enter) switches the page into search mode
  (`isSearchMode`, breadcrumb hidden, "✕ 검색 초기화" shown) and renders matched
  folders (click → jump straight there, rebuilding `pathStack` as just
  `[홈, 그 폴더]` since the full ancestor chain isn't known — a minor, accepted
  simplification) and matched files (same row shape as normal browsing, plus a
  `.lib-folder-tag` chip showing which folder each file is in).
- **선택한 파일 여러 개를 한 번에 zip으로 다운로드 — `libraryZip`.** Every file row
  (both normal browsing and search results) has a checkbox now
  (`.fileChk`/`selectedFileIds`, a `Set` that **persists across folder
  navigation and search** — a "cart" you build up from anywhere before
  downloading), plus a "전체 선택" checkbox that checks/unchecks every file
  *currently visible* (`currentListFileIds`, not the whole persisted
  selection) and a "선택 다운로드 (N)" button. This was initially planned as a
  client-side JSZip bundle of the already-public `uc?export=download` links
  (to avoid an Apps Script redeploy), but Google Drive's direct-download
  endpoint doesn't reliably allow cross-origin `fetch()` the way `<a href>`
  navigation does — so it was built server-side instead, mirroring
  `collect.html`'s existing `actionZip` almost exactly: `libraryZip(p.fileIds)`
  resolves each file's actual parent folder, validates it's within the
  library (silently skipping any id that isn't — guards against a tampered
  request listing a file id from outside the library), `Utilities.zip()`s the
  blobs, saves the zip into the first valid file's folder, shares it
  `ANYONE_WITH_LINK`, and returns a download URL the client just
  `window.open()`s — no new client-side zip library needed.
- **Both `file-library.html` and `form-board.html` accept a `?q=` URL param**
  that prefills their own search box and runs it immediately on load — added
  specifically so nav.js's site-wide quick search (see below) can deep-link a
  content result straight into a pre-filtered view instead of dropping the
  teacher on an unfiltered list they'd have to re-search by hand.
- **Folders are the only classification mechanism — no separate category
  field.** Per the user's explicit framing ("폴더 안에 폴더를 만들어서 분류"), a
  folder can contain further sub-folders to any depth (a department folder
  containing year folders containing unit folders, etc.) — there's no
  Supabase-tracked hierarchy to keep in sync since Drive's own parent/child
  folder structure *is* the hierarchy, read fresh on every `libraryList` call.
- **Path traversal guard**: every action that takes a `folderId`/`parentFolderId`
  resolves it through `resolveLibraryFolder_()`, which walks the folder's Drive
  parent chain (capped at 20 hops) to confirm it's actually a descendant of the
  library's own root before doing anything with it — a `folderId` pointing at an
  unrelated Drive folder (typo, or someone poking at the API directly) is
  rejected rather than silently letting the page browse arbitrary Drive content
  the script's account happens to have access to.
- **List/create-folder/upload are open to any approved teacher** (no name+password
  gate like `collect.html`'s manager system — this page's own Supabase Auth
  login gate is considered sufficient, matching the openness convention used by
  `room-booking.html`/`form-board.html` elsewhere in this file). **Delete
  (file or folder) is admin-only** — but since Apps Script has no notion of a
  Supabase Auth session, the client sends its own `session.access_token` along
  with the delete request, and `isCallerAdmin_()` uses that token to call
  Supabase's own `/auth/v1/user` then `/rest/v1/profiles?id=eq.<uid>` REST
  endpoints directly (`UrlFetchApp.fetch`, not `callSupabaseRpc`/anon-key —  the
  *caller's* token, so the query runs as that user under RLS) and checks
  `is_admin` — Apps Script never decides admin status itself, it always asks
  Supabase fresh on every delete call. **Known gap**: there's no per-file
  "who uploaded this" record (Drive files don't carry a Supabase-linked owner,
  unlike every other per-item-ownership table in this repo), so "delete your own
  upload" isn't supported — only admin-or-nobody. The root folder itself can
  never be deleted (`actionLibraryDeleteFolder` explicitly refuses when the
  target equals the library root).
- **Apps Script changes require a manual redeploy the same way every other
  edit to this shared script does** (see "Weekplan document summaries" above) —
  this environment has no Apps Script API access, so `collect-setup.md`'s
  `Code.gs` block is the source of truth and the user must paste it into the
  existing script project and **배포 → 배포 관리 → 수정 → 새 버전** before
  `file-library.html` actually works end-to-end (list/create/upload/delete all
  depend on the new `action`s existing server-side).
- Reachable via a `DEFAULT_NAV_ITEMS` entry (`group: '업무 도구'`,
  `loginRequired: true`) and a matching `index.html` tool-card placed right
  after `form-board.html`'s, per the `nav.js` DOM-order gotcha documented above.

## `duty.html` (학생 지도 당번표) is Supabase-backed via `duty_roster`, normalized per-slot

`duty.html` used to be a standalone page with no backing at all — `DUTY_DATA` was
a hardcoded wide-format JSON array (one object per date, with fixed
`front1`/`front2`/`back`/`lunch1`/`lunch2`/`night`/`event`/`nightNote` fields)
baked directly into the page per semester and hand-edited when the roster
changed. It's now fully DB-backed: **`duty_roster`** (`id`, `duty_date`,
`duty_time` nullable free text like `"07:30~08:20"`, `zone` free text like
`"정문1"`/`"중식2"`/`"야자"`, `teacher_name` nullable free text) holds one row
per **(date, zone)** slot rather than one row per date — a day that used to be a
single wide object with 6 named fields is now up to 6 separate normalized rows.
RLS: `select` is open to everyone (`using (true)`, matching the page's old
no-login-required openness — `auth.js`/`#protected-content` were also dropped
from the page entirely, since `AUTH_ENABLED=false` there only ever made the
wrapper visible unconditionally anyway, so removing the wrapper is equivalent);
`insert`/`update`/`delete` are `current_user_is_admin()`-gated.

**This table pre-existed this redesign in an undocumented, half-wired state** —
a *different*, wide-format `duty_roster` (mirroring `DUTY_DATA`'s own field
names exactly, `select`-only RLS with no write policy at all) had already been
created and populated from `duty.html`'s `DUTY_DATA` at some earlier point, and
was already being read by `teacher.html` and `my-page.html` (via
`cal-shared.js`'s `fetchWeekBriefItems`) — but `duty.html` itself was never
updated to read from it, so the two stayed in sync only by accident (both
ultimately sourced from the same one-time copy of `DUTY_DATA`). That old table
was dropped and replaced by the new normalized schema as part of this redesign
(confirmed byte-identical to `DUTY_DATA` before dropping, so nothing was lost);
all three consumers were migrated to the new schema in the same change — see
below.

**Zone naming is free text, grouped by a shared client-side convention, not a
stored category column.** `baseZoneLabel(zone)` strips a trailing digit
(`"정문1"`/`"정문2"` → `"정문"`, `"중식1"`/`"중식2"` → `"중식"`, `"후문"`/`"야자"`
unchanged) — this one rule, copy-pasted into `duty.html`, `teacher.html`, and
`cal-shared.js` (as `dutyBaseZoneLabel`), is what recreates the old
"정문/후문/중식/야자" 4-group display from free-text zone rows without a
separate category field. `isSelfStudyZone(zone)` (`duty.html` only) matches
`야자`/`자율학습`/`자기주도` in the zone string to decide which of two hero
cards a zone belongs to — this is the "등교지도+중식지도는 한 카드로, 자기주도학습
감독은 별도 카드로" grouping the user asked for. Both rules are deliberately
regex/suffix-based rather than a fixed enum, so an admin typing a new zone name
(e.g. `"정문3"` or a second self-study zone) is picked up automatically without
a code change — `groupCellsHtml()`'s `expectedBases` param still always renders
정문/후문/중식 (gate/lunch card) and 야자 (self-study card) even when a
particular base has zero rows that day, so the hero's shape stays consistent.

**A day with zero `duty_roster` rows means "no duty scheduled" — there is no
longer a placeholder row for off days.** The old `DUTY_DATA` had explicit
all-`null` entries for breaks/exams/holidays (carrying an `event`/`nightNote`
reason string); the migration only ever generated rows where a name was
actually present, so those off days simply have no rows at all now. This is a
deliberate scope cut, not an oversight: the new 5-column schema
(날짜/요일/시간/구역/담당교사) the user explicitly asked for has no reason/event
field, so `renderHero()`'s empty-day message is now a generic "당번표에 이
날짜의 일정이 없어요" rather than echoing a specific reason like "대체휴일"/
"중간고사". One side effect that's actually an improvement: "이전 지도일"/
"다음 지도일" (`sortedDates`, built from `Object.keys(byDate)`) now literally
skip to the next date that has an actual assignment, instead of stepping onto
a dead placeholder day — which is what those buttons' own labels ("지도일")
already implied.

**"요일" is always derived from `duty_date`, never stored** — same principle
used elsewhere in this file (derived fields aren't persisted redundantly,
to avoid the two going out of sync). The admin edit grid still shows/exports a
요일 column, but it's computed at render/export time, not an editable input.

**Admin-only "당번표 관리" section** (`#adminBlock`, revealed only after an
async `sb.auth.getSession()` + `profiles.is_admin` check resolves — same
"render nothing, then reveal" pattern used for other admin-only UI in this
repo) has a 편집할 월 `<select>` (populated from every month that already has
rows, plus a rolling window of ~1 month back/8 months forward so an admin can
start a brand-new month with zero existing rows) and, below it, **every row
in that month rendered as an always-editable `<input>` grid** — 날짜/시간/구역/
담당교사 per row plus a 🗑 delete button, matching the literal "엑셀처럼 여러
행이 있을 때 그걸 바꿀 수 있고" request. Unlike `room-booking.html`'s
click-one-row-at-a-time 편집 모드 toggle, there's no separate read-only/edit
mode here — the whole admin section is already gated to admins, so the grid is
just always in its editable form; a "+ 행 추가" button appends a blank row
(prefilled with the selected month's first day) and "저장" does two batched
calls (`sb.from('duty_roster').upsert(rowsWithIds)` for existing rows,
`.insert(rowsWithoutIds)` for new ones) rather than one request per row.
Deleting is instant (immediate `DELETE` + local row removal, no batching),
since it's a single row and there's no destructive-Excel-blank-row ambiguity
to worry about for a one-click action. Saving/deleting both trigger a full
`loadDutyRows()` + re-render of the hero/month-list/search state too, so the
public-facing views never show stale data after an edit.

**Excel round-trip** follows the same shape as `room-booking.html`'s: "엑셀로
내려받기" exports the currently-selected month's rows (날짜/요일/시간/구역/
담당교사, plus a 행ID column carrying the real row UUID) with 10 blank rows
appended for easy additions, and "엑셀 올리기" parses columns by name (not
position). A row with a 행ID is treated as an update (skipped if 날짜/구역
ended up blank — never deletes); a row with no 행ID and a 날짜+구역 is a new
insert; a fully blank row is silently skipped. `parseExcelDateValue()` handles
both plain date strings and Excel's numeric date serials via `XLSX.SSF.parse_date_code`.

## 오늘의 브리핑 / 이번주 브리핑 (`my-page.html`, Apps Script + `week-brief-summarize`)

`my-page.html`'s "오늘 브리핑" card doesn't have the AI write out the day's items —
the item list (지도 일정/수업/할 일, tagged `학사일정`/`지도`/`수업 교시`/`할일`/
`기한초과`) is already known to the browser and rendered directly
(`itemsListHtml()`); the AI (`actionSummarizeTodayBrief` in the shared Apps Script,
`ks_generateTodayBrief_`) only writes a short 2-3 sentence comment on top, told
explicitly not to re-list the items. **Cost control**: the comment is cached in
`today_briefs` (`user_id + date_key` → `items_hash` + `brief`) and Apps Script's
own script-properties cache, keyed by a hash of the exact items text
(`todayBrief_v2_<userId>_<dateKey>_<hash>`) — so the AI is only called once per
unique combination of (user, day, item content), never on a timer. Adding a task,
completing one, or a due date crossing into "오늘/기한초과" changes the items text
and therefore the hash, which *does* trigger one fresh (cheap, Flash-model,
~2-3 sentence) AI call — but that's the existing, already-accepted cost model for
any due-today task, not something new; multiple such changes in a row from one
teacher's own actions cost at most a few calls, and a quiet day costs zero calls
beyond the first cached one. `이번주 브리핑` (`loadWeekBriefing`, `week-brief-summarize`
Edge Function, `week_briefs` table) follows the identical pattern, cached by
`user_id + week_key` instead.

**Overdue-task mention**: `loadTodayWidget()`'s due-today-or-earlier task query
(`task_assignments.completed = false` joined to `tasks.due_at <= todayEnd`) already
included overdue (past-due, still-incomplete) tasks, but only tagged them the same
as due-today ones (`할일`). It now splits them: anything with `due_at` before
today's start gets `tagClass: 'overdue', tagLabel: '기한초과'` instead (own red-fill
`.tag.overdue` style, vs. the existing soft-red `.tag.task`) — both so the on-screen
list itself flags it, and so the AI prompt's item text (`[기한초과] <title> (마감
<date>)`) makes the overdue status explicit rather than leaving the model to infer
it from a raw date. The prompt (`ks_generateTodayBrief_` in `collect-setup.md`) was
updated to say any `[기한초과]` item that looks like actual school work (성적 입력,
공문 처리, 회의 준비 등) **must** be mentioned — but an overdue item that looks like
a personal errand (병원 예약, 개인 물품 주문 등) doesn't need to be, since the point
is flagging important school-work slippage, not nagging about someone's personal
to-do list. There's no structured "official vs. personal" field on `tasks` to
filter by client-side (its only free-text tag is `category`, which teachers set to
whatever they want) — this judgment call is left entirely to the model reading the
item's title text, which is exactly the kind of fuzzy classification an LLM
prompt handles better than a keyword blacklist ever could. **Editing that prompt
requires manually redeploying the shared Apps Script** (see the note at the top
of `collect-setup.md`; never deploy fresh, reuse
the existing deployment URL) before it takes effect.

**Item text color by source**: in "오늘 브리핑" (`itemsListHtml()`, shared by both
`renderTodayList()`'s "오늘의 할 일" and `loadTodayBriefing()`'s item list) and
"이번주 일정" (`renderWeek()`, `#weekList`), each item's text gets an
`.item-text-school` class (blue, `var(--stamp)`) when it came from a school
source — `학사일정`/`지도`/`수업 교시`(`SCHOOL_SOURCE_TAG_CLASSES` = `school`/
`duty`/`class` tagClasses in `itemsListHtml`, and `renderWeek`'s 학사일정/캘린더
branches specifically) — versus default black text for personal-task-list items
(할일/기한초과). This is purely a text-color cue layered on top of the existing
tag-badge colors, not a new data source — `이번주 브리핑` (`loadWeekBriefing`) has
no item list of its own to color (it's AI-comment-only, see above), so this only
applies to the two blocks that actually render raw item chips.

**Incident: "오늘 브리핑"에 AI 코멘트가 거의 안 뜨는 문제 — 실패를 영구 캐시해버리는
버그였다.** 교사 보고: 항목 목록은 항상 뜨는데 그 위의 짧은 코멘트(" OOO 선생님, ...")
는 거의 항상 비어있다. 실제 `today_briefs` 테이블을 직접 조회해보니 최근 20건 중
15건이 `brief IS NULL`로 멈춰있었다 — 우연한 일회성 실패가 아니라 구조적인 문제였다.
원인은 `loadTodayBriefing()`(my-page.html)과 `actionSummarizeTodayBrief`
(collect-setup.md의 Apps Script) 두 레이어 모두에 있던 "실패도 성공처럼 캐시해버리는"
동일한 버그: Apps Script의 Gemini 호출(`ks_generateTodayBrief_`, 이 함수만 Claude
폴백 없이 Gemini 단독 호출이라 이 글 상단의 "AI provider strategy" Claude-우선
정책이 적용되지 않음 — Apps Script는 Edge Function과 별개 런타임이라 원래부터 그
정책 범위 밖이었음)이 할당량 초과·네트워크 등으로 가끔 실패해 `null`을 돌려주면,
(1) Apps Script 자신의 스크립트 속성 캐시(`todayBrief_v2_<...>`)에 그 실패가 빈
문자열로 저장되고, (2) 클라이언트도 `today_briefs.brief = null`을 그대로 Supabase에
`upsert`해버렸다. 그 뒤로는 그날 항목 구성(해시)이 똑같은 한 두 캐시 모두가 "캐시
적중"으로 그 null을 그대로 돌려줄 뿐, 재시도가 전혀 일어나지 않았다 — 한 번의 일시적
실패가 그 항목 조합에 대해서는 영구적인 실패로 고정돼버린 것. **고쳐서**:
- `my-page.html`의 `loadTodayBriefing()`/`loadWeekBriefing()` 둘 다, 캐시 조회
  조건을 `cached.items_hash === itemsHash`뿐 아니라 `&& cached.brief`까지로 좁혔다 —
  캐시된 brief가 null이면 캐시 적중으로 치지 않고 그대로 아래로 내려가 Apps
  Script/Edge Function을 다시 호출한다(재시도). 그리고 응답을 Supabase에 쓸 때도
  `data.brief`가 있을 때만 `upsert`하도록 바꿔서, 실패를 다시 캐시에 덮어쓰지
  않는다.
- `collect-setup.md`의 `actionSummarizeTodayBrief`도 같은 원리로 고쳤다 — 스크립트
  속성에 저장된 캐시가 빈 문자열(= 이전 실패)이면 캐시 적중으로 치지 않고 다시
  `ks_generateTodayBrief_`를 호출하며, 이번에도 실패(null)하면 스크립트 속성에
  저장하지 않는다(성공했을 때만 `props.setProperty`).
`test_mypage_null_brief_retry.js`로 (1) `today_briefs`/`week_briefs`에 `brief:null`
로 캐시된 행이 있어도 Apps Script/Edge Function을 다시 호출하는지, (2) 재시도도
실패하면 그 null을 다시 캐시에 덮어쓰지 않는지, (3) 재시도가 성공하면 코멘트가
정상적으로 뜨고 그제서야 캐시에 저장되는지 — 네 조합(오늘/이번주 × 실패/성공) 모두
검증했다. **`collect-setup.md` 쪽 수정은 이 환경에서 직접 배포할 수 없다** — 평소처럼
수동으로 Apps Script 프로젝트에 붙여넣고 새 버전으로 재배포해야 실제로 적용된다.
이 수정으로도 Gemini 호출 자체의 간헐적 실패율은 그대로 남아있을 수 있지만(이
환경에서는 그 실패가 할당량/네트워크/일시적 응답 오류 중 무엇인지 직접 확인할 수
없음), 적어도 그 실패가 더 이상 영구적으로 고정되지 않고 다음 로드마다 다시
시도된다.

**오늘 브리핑/이번주 브리핑/주간계획 요약 — 사용자 요청으로 셋 다 클로드
Sonnet 5.5를 우선 쓰도록 바꿨다.** 이번주 브리핑(`week-brief-summarize` Edge
Function)은 이미 Claude-first/Gemini-fallback 패턴이 있었지만, "AI provider
strategy" 섹션의 분류상 단순/단발 함수로 묶여 `claude-haiku-4-5-20251001`을
쓰고 있었다 — `CLAUDE_MODEL` 상수만 `claude-sonnet-5-5`로 바꿔 재배포했다(버전
7). 오늘 브리핑(`ks_generateTodayBrief_`)과 주간계획 요약(`ks_summarizeWeekPlan_`,
예전 이름 `ks_summarizeWithGemini_`)은 Apps Script라서 애초에 그 사이트 전체
정책의 범위 밖이었는데(Edge Function과 별개 런타임), 이번에 명시적으로 요청받아
같은 패턴을 Apps Script에도 들여왔다 — `ks_getClaudeApiKey_()`(스크립트 속성
`CLAUDE_API_KEY`)와 `ks_callClaude_(prompt, opts)`(Edge Function들의
`callClaude()`와 같은 모양, `UrlFetchApp`으로 `api.anthropic.com/v1/messages`를
직접 호출, 모델은 `claude-sonnet-5-5`)를 새로 추가하고, 두 함수 모두 이제 클로드를
먼저 시도하고 실패하거나 키가 없을 때만 기존 Gemini 경로로 넘어간다. `설치 방법
7번`에 `CLAUDE_API_KEY` 스크립트 속성 추가 단계를 더했다(Anthropic Console에서
발급 — 이 저장소의 Supabase Edge Function들이 쓰는 키를 재사용해도 됨). 캐시 키
버전도 모델이 바뀌었으니 올렸다 — `todayBrief_v2_` → `_v3_`, `wpSummary_v3_` →
`_v4_`(바로 위 두 incident의 "null 캐시 재시도" 수정과 "전체 텍스트" 수정이 각각
붙인 버전들 다음 번호). **이 세 함수 모두 이 환경에서 직접 테스트할 수 없다** —
`week-brief-summarize`는 Supabase MCP로 배포까지는 했지만 실제 Claude API 호출
성공 여부는 확인 못 했고(이 샌드박스에서 `api.anthropic.com`으로도 나가지 못함),
Apps Script 두 개는 평소처럼 `collect-setup.md`에만 반영되어 있고 수동 재배포가
필요하다 — 재배포 후 `CLAUDE_API_KEY`를 안 넣으면 그냥 기존처럼 Gemini로만
동작하므로(둘 다 "클로드 키 없으면 바로 Gemini" 분기가 있음) 안전하게 단계적으로
켤 수 있다.

## `messages.html`'s `.udb` connection can't read files under `AppData`

Chrome/Edge's File System Access API (`showOpenFilePicker`/`showDirectoryPicker`,
used to connect the local 쿨메신저 backup file) refuses to open anything inside a
short blocklist of OS-sensitive folders, `AppData` among them — this is a browser-
level restriction with no JS-side workaround, not a bug in this site's code. It
matters here because it's not a rare edge case: while the original CoolMessenger
client backs up to `문서\CoolMessenger\Memo` (fine), at least one popular
alternative launcher (HyperCool) defaults to `AppData\Local\CoolMessenger\Memo`
instead, so a teacher using that launcher hits "이 파일을 열 수 없음(시스템 파일을
포함하고 있어서)" the moment they navigate the folder picker into `AppData`. The
only fix is copying the `.udb` file out to a non-blocked folder (Desktop,
Documents, etc.) first and selecting the copy from there — `messages.html`'s DB
연결 card now says this explicitly, alongside the existing 문서\CoolMessenger\Memo
hint (`btnCopyPath` still copies that path, since it's still the more common
default for the original client).

## Message auto-labeling (`auto-label-messages`)

`messages.html`'s 일괄 작업 bar (shown once messages are checked) has two AI
labeling buttons that both call the same `auto-label-messages` Edge Function and
apply results through the same path (`addLabelDef` + `updateStateAndSync`, so a
message gets labeled and synced to the server exactly like a manually-applied
label — no separate storage or schema):
- **자동 라벨링** (`msgBulkAutoLabel`, the original): free-form — the model is
  given the site's existing label list (`existingLabels`) and told to prefer
  reusing one of those, inventing a short new label only when nothing fits.
- **자동 분류** (`msgBulkAutoClassify`, newer): fixed-taxonomy — always classifies
  into exactly one of `AUTO_CLASSIFY_CATEGORIES` (제출/협의/안내/협조/유의사항/기타,
  a plain JS array in `messages.html`), for teachers who want every message
  sorted into a small, consistent set of buckets rather than open-ended labels.

Both send the same request shape to the Edge Function, which picks its prompt
based on which field is present: `categories: string[]` triggers the fixed mode
(server-side response filtering rejects any label not exactly in that list —
the model cannot invent a 7th category), while `existingLabels: string[]`
(no `categories`) keeps the original free-form behavior. This is why fixed-mode
results are trustworthy to treat as an exhaustive category set for filtering/
stats, while free-form labels aren't — they're genuinely open-ended.

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

`my-todo.html`'s (and `my-page.html`'s `cardTasks` copy's) MS/Google Tasks rows
each have a delete (trash-icon) button directly in the row head — `.msDeleteBtn`/
`.gtDeleteBtn`, styled identically to the local list's `.localDeleteBtn` — calling
`DELETE /me/todo/lists/{listId}/tasks/{id}` / `DELETE /lists/{listId}/tasks/{id}`
directly, separate from the same delete action already reachable inside each
row's expanded detail panel (`.mDelete`/`.gDelete`). Both exist now; the row-head
one is there so all three sources (로컬/MS/Google) look and behave the same
without needing to expand a row first.

**Naming**: `my-page.html`'s user-facing label is "나의 페이지" and
`my-custom-page.html`'s (the customizable widget-grid page) is "대시보드" — this
was flipped from an earlier, short-lived rename that called `my-page.html`
"대시보드" instead; that direction was reverted per explicit follow-up request, and
the "대시보드" name was given to `my-custom-page.html` instead. Both labels are
kept in sync everywhere they appear in user-facing text: each page's own title
tag/`<h1>`, `nav.js`'s two menu entries and its fixed home-row `aria-label`s, the
"대시보드 도우미" chat assistant name (`buildGlobalChat` in `nav.js`, plus its own
self-identifying line in the `custom-page-chat` Edge Function's system prompt —
redeploy that function if you ever touch its wording), `index.html`'s quicknav
card and tool-card grid, the `selLandingPage` dropdown on `my-custom-page.html`,
and every widget-mode CSS/JS comment across the many pages that can be embedded as
a widget in either page (e.g. "대시보드의 캘린더 위젯이 이 페이지를 ?widget=1 로…").
The filenames/URLs (`my-page.html`, `my-custom-page.html`) and internal
identifiers (`landing_page` value `'my_page'`/`'my_custom_page'`, the
`my_custom_pages` table name, etc.) were deliberately left unchanged in both
directions — only display text ever changes. If this gets renamed again, grep
for both "나의 페이지" and "대시보드" (excluding `collect.html`'s unrelated "담당자
대시보드" — a manager-dashboard concept with no connection to either page) rather
than assuming one search term catches every reference.

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

**Incident: `cardTasks`의 `#dashCategoryFilter`("카테고리 전체" 드롭다운)가
고른 카테고리에 따라 "이번주 일정"까지 좁아지고, "전체"로 되돌려도 원래대로
돌아오지 않는 버그.** `populateDashCategoryFilter()`는 로컬 `category`/MS 목록
이름/Google 목록 이름을 전부 하나의 "카테고리" 드롭다운으로 합쳐서 보여준다(주석:
"로컬 category, MS 목록 이름, 구글 목록 이름을 하나로 모아 카테고리 드롭다운을
채워요") — MS/Google은 한 번에 한 목록(`msListId`/`gtListId`)의 할 일만 볼 수 있어서,
목록을 "카테고리"처럼 다루려면 그 목록으로 전환해야 한다는 발상이었다. 그래서
`#dashCategoryFilter`의 `change` 핸들러가 고른 카테고리 이름과 일치하는 MS/Google
목록을 찾아 `msListId`/`gtListId` 자체를 그 목록으로 바꾸고 `msLoadTasks()`/
`gtLoadTasks()`로 다시 불러왔는데, 이 두 함수는 끝에서 항상
`window.msTasksCache = msTasks;`/`window.gtTasksCache = gtTasks;`를 실행한다 —
그런데 이 두 `window.*Cache`는 "이번주 일정"(`tasksByDate()`/`renderWeek()`,
**첫 번째** IIFE 소속)가 읽는 바로 그 데이터다. 그 결과 (1) "할 일 목록"에서
카테고리를 하나 고르면 그 카테고리가 가리키는 MS/Google 목록의 할 일로
"이번주 일정"까지 덩달아 좁아졌고, (2) 다시 "카테고리 전체"로 되돌려도
`msListId`/`gtListId`는 그 목록에 그대로 머물러 있어(되돌리는 로직 자체가 없었음)
"전체를 눌러도 전체가 표시되지 않는 것 같다"는 문제로 이어졌다. **고쳐서**
`change` 핸들러에서 이 목록-전환 부작용을 완전히 제거했다 — 이제 카테고리를
고르는 건 순수하게 "지금 로드돼 있는 걸 걸러서 보여주기"일 뿐이고,
`msListId`/`gtListId`는 전혀 건드리지 않는다. MS/Google 쪽 필터링은
`msSortAndFilter()`/`gtSortAndFilter()`가 이미 갖고 있던 "활성 목록 이름이 고른
카테고리와 다르면 숨김"(`if(cat && currentListName !== cat) return [];`) 체크
하나만으로 충분하다 — 그 체크는 `msListId` 자체를 바꾸지 않고도 "이 카테고리는
지금 활성 목록 것이 아니니 안 보여준다"는 걸 정확히 표현하기 때문. 어느 목록을
볼지는 이미 별도의 전용 UI(`renderMsTabs()`/`renderGtTabs()`의 목록 탭)가 있으므로,
카테고리 드롭다운이 그 선택을 건드릴 필요가 아예 없었다. 이 변경으로
`msListId`/`gtListId`(따라서 `window.msTasksCache`/`gtTasksCache`, 즉 "이번주
일정")는 카테고리를 아무리 바꿔도 전혀 바뀌지 않는다 — 탭을 직접 클릭해서
목록을 바꾸는 경우에만 바뀌는데, 그건 이 버그와 무관한, 원래부터 있던 별개의
동작이다. `test_mypage_category_filter_week_isolation.js`로 로컬 카테고리 하나가
MS 목록 이름과 우연히 겹치는 상황을 재현해, 그 카테고리를 선택해도 MS 목록
재조회가 전혀 안 일어나고(`msGraphFetch` 호출 횟수가 베이스라인에서 안 늘어남)
"이번주 일정"도 전혀 안 바뀌는지, "전체"로 되돌리면 원래 활성 목록이 다시
온전히 보이는지 확인했다 — 수정 전 코드로 되돌려 같은 테스트를 돌려보면 실제로
세 가지 증상(재조회 발생, 이번주 일정 변경, 전체 복귀 실패)이 그대로 재현되는
것도 확인했다. (참고: `cal-shared.js`의 `fetchMsTasks()`는 "이번주 브리핑"
AI 카드용으로 이미 모든 MS 목록을 매번 순회해 가져오는 완전히 별개의 기능이라
—`msListId`와 무관하게 늘 "전체"를 반영함 — 이 버그와도, 이 수정과도 상관없다.)

**후속 수정: 위 수정이 "이번주 일정을 안 건드린다"는 목표는 지켰지만, 그 대가로
"할 일 목록" 카드의 카테고리 필터 자체가 사실상 못 쓰게 됐다.** `msSortAndFilter()`
가 `cat && currentListName !== cat`이면 무조건 `[]`를 돌려주게 바뀌어 있었던
탓에 — 활성 탭(`msListId`)과 다른 MS 목록 이름을 고르면 항상 빈 목록만 보였고,
"카테고리 전체"를 골라도 활성 탭 하나의 할 일만 보일 뿐 다른 목록은 전혀 안
보였다. 사용자 보고: "카테고리 전체나 다른 카테고리는 못 불러오고 있어." —
의도("탭 전환 없이 그냥 필터링만")는 맞았지만, 애초에 활성 탭 하나만 메모리에
있으니 필터링할 대상 자체가 하나뿐이었던 게 진짜 원인이었다. **고쳐서** 활성
탭과 별개로 `msAllTasksCache`(목록 id → 그 목록의 할 일 배열)를 두고,
`msEnsureAllListsLoaded()`가 `msEnter()` 직후 백그라운드로 나머지 모든 MS
목록을 받아와 채운다 — `msListId`/`window.msTasksCache`(이번주 일정이 읽는
값)는 여전히 `msLoadTasks()`만 건드리므로 이전 수정의 "이번주 일정은 활성
탭에서만 벗어나지 않는다"는 보장은 그대로 유지된다. `msSortAndFilter()`는 이제
`msAllItemsFlat()`(캐시된 모든 목록을 `{__listId, __listName}`을 붙여 평탄화)
위에서 카테고리를 거른다 — "전체"는 캐시된 모든 목록의 합집합, 특정 카테고리는
그 이름과 일치하는 목록만. 화면에 비활성 목록의 항목도 함께 뜰 수 있게 된
만큼, 체크/삭제/상세 편집(`renderMsDetail`, 단계 추가·삭제 포함)이 더 이상
`msListId`를 그대로 쓰면 안 된다 — 각 행에 `data-list-id`를 함께 심어두고,
`msFindTaskWithList(taskId)`로 상세 패널을 열 때도 그 항목이 실제로 속한
목록을 찾는다. 변경 후 다시 불러올 때는 `msRefreshAfterMutation(listId)`가
그 항목이 활성 탭 것이면 기존 `msLoadTasks()`(이번주 일정까지 같이 최신화)를,
아니면 그 목록 캐시만 새로 받아온다 — 이 분기 덕분에 비활성 목록 항목을
체크해도 이번주 일정이나 다른 목록의 네트워크 호출이 전혀 늘지 않는다.
"+ 새 할 일 추가"(`btnMsAdd`)는 그대로 활성 탭(`msListId`)에만 추가한다 —
어느 목록에 추가할지는 이미 탭 선택이 전담하는 별개의 UI라 손대지 않았다.
`test_mypage_category_filter_week_isolation.js`를 이 새 동작에 맞게 다시
써서 (1) 활성 탭이 아닌 목록 이름을 골라도 그 목록 할 일이 실제로 보이고,
(2) "전체"에서 활성+비활성 목록 모두가 함께 보이고, (3) 이번주 일정은
어느 경우에도 전혀 안 바뀌고, (4) 비활성 목록 항목을 체크하면 그 목록
엔드포인트로만 요청이 나가며 활성 탭 재조회는 없는지 — 네 가지를 검증했다.

**세 번째 수정: "이번주 일정"도 카테고리 전체(모든 MS/Google 목록)를 반영하도록
바뀌었다 — 위 두 수정이 의도적으로 지켰던 "이번주 일정은 활성 탭만 본다"는
제약을 이번엔 사용자가 직접 뒤집어달라고 요청했다.** 사용자: "카테고리 전체를
기준으로 할일도 넣어줘야지" — 바로 위 incident에서 "이번주 일정에 할일이 안
나온다"는 보고가 있었는데, 실제 원인은 데이터 부재가 아니라 이 설계 자체였다
(비활성 MS/Google 목록에 이번주 마감인 할 일이 있어도 "이번주 일정"은 절대
반영하지 않았음). `window.msTasksCache`/`window.gtTasksCache`(둘 다 `tasksByDate()`
가 읽는 유일한 소비자)를 활성 탭 하나의 스냅샷에서 **모든 목록의 합집합**으로
바꿨다:
- MS 쪽은 이미 있던 `msAllTasksCache`/`msAllItemsFlat()`을 그대로 재사용 —
  `msLoadTasks()`/`msEnsureAllListsLoaded()`/`msRefreshAfterMutation()` 세 곳
  모두 `window.msTasksCache = msAllItemsFlat()` + `window.reRenderWeek()`을
  호출하도록 바꿨다(기존엔 `msLoadTasks()`만 `window.msTasksCache = msTasks`로
  활성 탭 하나만 반영했음). `msAllTasksCache`를 아무리 채워도 이번주 일정엔
  영향이 없다던 기존 문서/주석은 이제 틀린 전제가 됐다 — 바로 그 반대로
  바꾼 것이 이번 수정의 핵심이다.
- Google 쪽은 이 "전체 목록" 캐시 자체가 아예 없어서(가 쪽 카테고리 필터
  `gtSortAndFilter()`는 여전히 활성 목록 하나만 본다 — 그건 이번 수정의 대상이
  아니다), `gtAllTasksCache`/`gtFetchListTasks(listId)`/`gtAllItemsFlat()`/
  `gtEnsureAllListsLoaded()`를 MS 쪽과 같은 모양으로 새로 추가했다. `gtEnter()`가
  `await gtLoadTasks()` 직후 `gtEnsureAllListsLoaded()`를 백그라운드로 호출하고,
  `gtLoadTasks()` 자신도 `gtAllTasksCache[gtListId]`를 채운 뒤
  `window.gtTasksCache = gtAllItemsFlat()`로 세팅한다. **의도적으로 범위를
  좁힌 부분**: "할 일 목록" 카드 자신의 Google 카테고리 필터(`gtSortAndFilter()`,
  `renderGtTasks()`, `renderGtDetail()`, 체크/삭제 핸들러)는 여전히 활성
  `gtListId` 하나만 다룬다 — MS 쪽처럼 `data-list-id`를 각 행에 심고
  `gtFindTaskWithList()`로 역탐색하는 전체 포팅은 이번 요청(이번주 일정 한정)
  범위 밖이라 하지 않았다. 그 카드에 대한 Google 쪽 "활성 목록 아닌 카테고리도
  보이게" 포팅은, MS 쪽에 이미 있는 것과의 비대칭이 남아있는 채로 — 나중에
  같은 요청이 Google 쪽에도 들어오면 그때 `msSortAndFilter()`/`renderMsTasks()`
  패턴을 그대로 복사하면 된다.
- `test_mypage_week_all_lists.js`(새 테스트)로 MS 쪽은 (1) 활성 목록(기본)의
  이번주 마감 할일이 보이는지, (2) 비활성 목록(부업무)의 이번주 마감 할일도
  보이는지(이번 수정의 핵심), (3) "할 일 목록" 카드의 카테고리 필터를 활성
  목록 이름으로 좁혀도 "이번주 일정"은 전혀 안 좁아지고 비활성 목록 것까지
  계속 보이는지 — 모두 확인했다. 기존
  `test_mypage_category_filter_week_isolation.js`(카테고리 필터가 msListId/
  gtListId 자체를 안 건드린다는 것, 그리고 msListId 활성 탭만 가진 비활성
  목록 항목 변경 시 PATCH가 그 목록으로만 나간다는 것을 검증하는 테스트)도
  이 변경 후 다시 돌려 그대로 통과함을 확인했다 — 그 테스트가 쓰는 비활성
  목록 항목(mst2)엔 마감일이 없어서, "이번주 일정이 전체를 반영하게 됐다"는
  변경과 그 테스트의 "이번주 일정은 그대로"라는 기대가 서로 충돌하지 않는다.

Three admin-only edit surfaces (duty.html's 당번표 관리, the 교직원 명렬 관리
bulk-paste, and a brand-new 교사 시간표 편집 grid that didn't exist before this
feature) needed a way for a handful of non-admin teachers (각 구역 담당자, 교무
업무 담당자) to edit them without the user wanting to hand out full
`profiles.is_admin` — admin also grants member approval, password resets, the
collect.html master password, etc., which is far more than "let this person
edit the duty roster." The user explicitly chose a single **공용 비밀번호**
(shared password) over a per-teacher granular-permission system, matching
`collect.html`'s existing master-password feature almost exactly (same
"single row, no select policy, SECURITY DEFINER RPCs only" shape, same
`encode(digest(password || '|' || salt, 'sha256'), 'hex')` hashing).

`shared_edit_settings` (single row, `id = 'site'`, `password_hash`/
`password_salt`) has RLS enabled with **no select policy for any role** —
exactly like `collect_settings`, nobody (not even an admin) can read it
directly from the client. Four RPCs:
- `set_shared_edit_password(p_password)` / `clear_shared_edit_password()` —
  admin-only (`current_user_is_admin()`-gated), same validate-4+-chars-then-hash
  shape as `set_collect_master_password`.
- `shared_edit_password_is_set()` — admin-only boolean status check (never
  returns the hash), used to render "✅ 켜져 있어요"/"⬜ 설정되지 않았어요".
- `verify_shared_edit_password(p_password)` — the one function every write
  path actually calls: `current_user_is_admin() OR the password hashes to a
  match`. Because the admin check is baked into this single function, an
  actual admin can call any of the write RPCs below with `p_password: null`
  and it still succeeds — there's no separate "admin path" vs "password path"
  branch in the client JS, just one RPC call that always passes
  `p_password: sharedEditPassword` (`null` until a non-admin unlocks it).

Four more SECURITY DEFINER RPCs do the actual writes, each starting with `if
not verify_shared_edit_password(p_password) then raise exception`:
`duty_roster_save(p_password, p_upsert_rows, p_insert_rows)` and
`duty_roster_delete_row(p_password, p_id)` (replacing `duty.html`'s old direct
`sb.from('duty_roster').upsert/insert/delete` calls, which only ever worked
for admins under the pre-existing `current_user_is_admin()`-only RLS — that
RLS is unchanged, these RPCs bypass it by being `SECURITY DEFINER`),
`staff_roster_upsert(p_password, p_rows)` (the same bulk-paste upsert
`member-admin.html`'s 교직원 명렬 관리 card already did, just routed through
the RPC instead of a direct admin-RLS-gated table write), and
`staff_schedule_upsert(p_password, p_name, p_schedule)` (new — updates only
the `schedule` jsonb column for one already-existing `staff` row, raising if
the name isn't found rather than silently creating a stray row).

**`duty.html`** gained a `#sharedEditPrompt` block (password input + "확인")
that shows instead of `#adminBlock` whenever `checkAdminAndInit()` resolves
`isAdmin = false` — unlike every other login-gated page in this repo,
`duty.html` has no login requirement at all (per its own section above), so
this prompt is shown to literally anyone, logged in or not; knowing the
password is the only authorization check, same as `collect.html`'s manager
password. On a correct `verify_shared_edit_password` call, the entered
password is kept in a module-level `sharedEditPassword` variable (never
persisted to `localStorage`/`sessionStorage` — re-entering it is required
after a page reload) and `#adminBlock` opens exactly as it would for an
admin, with `#adminModeHint` reading "관리자 계정으로 편집 중이에요." or "공용
편집 비밀번호로 편집 중이에요." depending on which path unlocked it.

**`member-admin.html` itself was deliberately left completely untouched** —
restructuring its single page-wide `if(!myProfile.is_admin) return;` gate to
safely expose *only* 교직원 명렬 관리 while keeping every other admin-only
card (가입 승인, 비밀번호 재설정, 계정 연결 요청, 마스터 비밀번호 관리, 회원
목록/수정/삭제 등) hidden was judged too risky to retrofit onto an existing,
heavily-admin-assuming page. Instead, a brand-new standalone page,
**`staff-edit.html`**, was built from scratch: login + `profiles.approved`
gated (same pattern as most other pages) and then, separately, `is_admin OR`
a correct shared password unlocks the two edit cards. Admins see an
additional 🔑 공용 편집 비밀번호 관리 card (same `set_/clear_/_is_set()` RPC
trio `collect.html`'s own master-password admin UI uses) that a
password-only visitor never sees, even after unlocking — `isAdmin` alone
gates that card's visibility, independent of the shared `unlock()` function
that reveals the other two. `member-admin.html`'s own 교직원 명렬 관리 card is
**still there and still works for admins** via its original direct
`sb.from('staff').upsert(...)` call (untouched, still admin-RLS-gated) —
there are now two independent ways to bulk-paste the staff roster (admins can
use either page; non-admin password-holders can only use `staff-edit.html`),
which is accepted duplication rather than a risky shared-gate refactor.

**교사 시간표 편집 (교사 시간표 is a genuinely new feature, not just a new
access path to an existing one)** — `staff.schedule` previously had *no* edit
UI anywhere in this codebase (`teacher.html`/`teachers.html`/`my-page.html`
only ever read it). `staff-edit.html`'s 시간표 편집 card reads teacher names +
schedules from `public_staff` (already public/RLS-open, no password needed
just to populate the dropdown and prefill the grid — writes are what the
password gates) and renders a plain 7-period × 5-day (`월~금`) table, two
small inputs (과목/교실) per cell. A blank 과목 input means that cell is
dropped from the saved schedule (= free period, matching the existing "missing
key means free" convention documented under `teacher.html`/`teachers.html`'s
schedule data shape above) — the hint text explicitly tells the admin that a
blank 금요일 6교시 will still show as a continuation of 5교시 on other pages
(the existing Friday-6th-period display patch), so they don't try to
hand-duplicate it. Saving only touches the `schedule` column for the one
selected teacher (via `staff_schedule_upsert`) — every other `staff` column is
left alone.

**교직원 명렬도 붙여넣기 대신 엑셀 양식 다운로드/업로드로 할 수 있다** — 반 학기마다
명렬을 통째로 갱신하는 게 번거롭다는 요청으로, 기존 탭-구분 붙여넣기(`#staffPasteArea`)
옆에 "엑셀 양식 다운로드"/업로드 한 쌍을 추가했다. 양식 헤더는 붙여넣기가 이미 쓰던
`STAFF_PASTE_COLUMNS`(이름/부서/교과/내선번호/휴대폰/담임반/담임교실/수업시수)와
정확히 같은 8개 칼럼 — 두 입력 경로 다 결국 같은 `staff_roster_upsert` RPC로
합쳐지므로, 업로드 쪽 파서가 그 RPC가 기대하는 모양으로 바꿔주기만 하면 된다.
`room-booking.html`의 "교실 목록 양식은 이미 등록된 교실을 미리 채워서 내려준다"는
관행을 그대로 따라, 다운로드는 이미 등록된 교직원이 있으면 전부 채워서 내려주고
(몇 군데만 고치거나 새 줄만 추가해서 다시 올리면 됨), 하나도 없을 때만 예시 한 줄을
내려준다. 문제는 `staff` 테이블 자체가 admin만 직접 `select`할 수 있고(비관리자 공용
비밀번호 보유자는 `staff_roster_upsert` 같은 `SECURITY DEFINER` RPC로 **쓰기만**
가능하다) — 양식에 기존 값을 채우려면 **읽기**도 같은 식으로 열어줘야 해서, 새
`staff_roster_list_for_edit(p_password)` RPC(`verify_shared_edit_password`로 같은
방식 검증, `select * from staff order by name`)를 추가했다. 업로드는 파일을 읽어
(`XLSX.read` + `sheet_to_json`) 한글 헤더로 칼럼을 다시 찾고, 이름이 빈 행은 버린
뒤 미리보기(몇 명이 반영될지 + 이름 나열)를 보여주고 "반영하기"를 눌러야 실제로
`staff_roster_upsert`가 호출된다 — `room-booking.html`의 교실목록 업로드와 같은
미리보기-확인 흐름이다.

**Tucked under 교무 업무 도구 instead of a top-level nav item, with the whole
hub gated behind a "🔑 관리자 모드" button.** `staff-edit.html` originally had
its own `DEFAULT_NAV_ITEMS` entry and `index.html` tool-card (reachable
directly from the main menu/page, since non-admin password-holders couldn't
reach `admin-tools.html`'s admin-only tiles at the time). Per explicit
follow-up request ("교직원 명렬과 시간표 편집은 교무 업무 도구 하위로 숨겨두자"),
it was moved under `admin-tools.html` instead — its `DEFAULT_NAV_ITEMS` entry
and `index.html` tool-card were removed, and it's now only reachable as a
tool-card on `admin-tools.html` itself (plus 🔍 site search, via a plain
`EXTRA_SEARCH_ITEMS` entry with no `adminOnly` flag — unlike `member-admin.html`/
`bulk-register.html`/`teacher-groups.html`'s search entries, since a non-admin
shared-password holder should be able to find this one too, not just real
admins). `staff-edit.html` itself needed no change — it already gated its own
edit UI on `is_admin OR verify_shared_edit_password`, so hiding its *entry
point* elsewhere didn't touch its own access logic. `staff-edit.html`'s own
back-link was repointed from `./index.html` to `./admin-tools.html`, matching
`teacher-groups.html`'s convention for every other hub-only admin page.

This meant `admin-tools.html` needed its own password-unlock UI, since its
existing admin-only tiles (회원 일괄 등록/회원 관리/교사 그룹 관리/AI 사용량) were
only ever gated by a real `is_admin` session check (`setVisible()` in its
footer script) — there was no password path there at all. A new
`.tool-card.admin-only.pw-gated-tile` class on the 교직원 명렬·시간표 편집 tile
specifically (not on any of the other four `admin-only` tiles — those stay
`is_admin`-only, unaffected, per the same reasoning that kept
`member-admin.html` untouched: a shared edit password meant for 당번표/명렬/
시간표 editing should never widen into account approval, password resets, or
AI usage visibility) is what a new "🔑 관리자 모드" button (`#btnAdminMode`,
next to the existing `#adminModeLink` hint in `header.page-head`) reveals.
Clicking it toggles an inline password prompt (`#adminModePrompt`); a correct
`verify_shared_edit_password` RPC call calls `setPwGatedVisible(true)` — a
second, narrower visibility toggle that only touches `.pw-gated-tile`
elements, deliberately kept separate from the existing `setVisible()` (which
still only responds to a real `is_admin` session and controls every
`.admin-only` tile). A real admin never needs the button at all — the
page's existing `is_admin` check already calls both `setVisible(true)` and
`setPwGatedVisible(true)` together and leaves `#btnAdminMode` hidden, so
admins see every tile (including 명렬·시간표) automatically, exactly as
before this change.

**`duty.html`'s 당번표 관리 area got the same "hidden behind a button" treatment**,
per the same request ("지도 당번이나 교무 업무 도구 상단엔 관리자 모드라는 버튼 만들어서
비번 입력 받으면 편집 가능한 메뉴들까지 나오게. 평소엔 숨기고"). It used to show
`#sharedEditPrompt` (the password box) directly to any non-admin visitor on
every page load — functionally password-gated already, but visually always
taking up space. A "🔑 관리자 모드" button (`#btnDutyAdminMode`, top of
`header.page-head`) now stands in for both `#sharedEditPrompt` and
`#adminBlock`, which both start (and stay) `display:none` regardless of
admin status until it's clicked. `checkAdminAndInit()` no longer runs at page
load or auto-opens anything — it only runs lazily, once, from inside the
button's click handler (`adminCheckDone` guards against re-running it on a
second click), which then opens `#adminBlock` directly for a real admin or
reveals `#sharedEditPrompt` for everyone else — same two-path split as
before, just deferred behind one explicit click rather than firing
automatically on load. `duty.html` still has no login requirement at all (see
its own section above), so the button appears for literally anyone, logged in
or not — clicking it with no account and no password still shows the
password box, it just doesn't resolve to anything without a correct one.

`staff-edit.html` (reached via `admin-tools.html`) and `duty.html` (reached
directly) are the two pages this "관리자 모드 버튼 → 비밀번호 → 편집 메뉴 노출" pattern
covers today; `admin-tools.html`'s own version additionally demonstrates that
the pattern composes with a hub page's pre-existing `is_admin`-only tiles
without widening what the shared password can unlock.

**Incident this surfaced**: while removing `staff-edit.html`'s top-level tile,
a check of `index.html`'s "업무 도구" tile-grid DOM order against `nav.js`'s
`DEFAULT_NAV_ITEMS` group order (the exact ordering gotcha documented under
`## nav.js` above) turned up an unrelated, pre-existing mismatch — `my-bot.html`
("나만의 챗봇 비서") had a `DEFAULT_NAV_ITEMS` entry (so it always showed up in
the hamburger menu's 업무 도구 group) but **no `index.html` tool-card at all**,
so the main page's tile grid silently never showed it. Fixed by adding its
tool-card to `index.html` in the matching position (between `chatbot-teacher.html`
and `chatbot-builder.html`, mirroring `nav.js`'s order) — this was a plain
missing-tile bug, unrelated to the `staff-edit.html` move itself, just found
while re-checking the same ordering invariant.

**공지사항 작성/메시지함/나만의 챗봇 비서도 같은 방식으로 `admin-tools.html`
(교무 업무 도구) 하위로 옮겼다** — `staff-edit.html`이 그랬던 것과 똑같은 패턴이지만,
이번 셋은 관리자 전용이 아니라 **승인된 교사라면 누구나** 쓰는 일반 업무 도구라는
점이 다르다. `nav.js`의 `DEFAULT_NAV_ITEMS`에서 세 항목을 통째로 지우고(`index.html`
의 해당 `tool-card` 세 개도 함께 삭제), `EXTRA_SEARCH_ITEMS`에 `adminOnly` 없이
그대로 추가했다 — 🔍 전체 검색으로는 여전히 누구나 찾을 수 있고, `loginRequired:
true`만 유지해서 검색 결과 이름 옆 `*` 표시도 그대로다. `admin-tools.html`의
`.card-list`에는 `admin-only` 클래스 **없이** 세 개의 평범한(`exam-generator.html`/
`score-generator.html`과 같은 모양) `tool-card`를 새로 추가했다 — `admin-only` 클래스가
있는 타일만 `setVisible()`이 숨기므로, 클래스를 안 붙이면 로그인 전이든 비관리자든
항상 보인다(이 페이지 자체가 로그인 게이트가 없다는 점은 기존에 이미 그랬음). 두
페이지 모두의 소개문(`nav.js`의 `admin-tools.html` 항목 desc, `index.html`/
`admin-tools.html`의 `<h1>` 아래 부제)도 "관리자용 도구 모음"에서 "시험 준비·
메시지함·챗봇 비서 등 교무 업무용 도구 모음"으로 고쳐서, 더 이상 관리자만 쓰는
곳이 아니라는 걸 분명히 했다. `test_admintools_moved_tiles.js`/
`test_nav_search_moved_items.js`로 (1) `index.html`에 세 타일이 더 이상 없고
`교무 업무 도구` 타일은 그대로 있는지, (2) `admin-tools.html`에 세 타일이 있고
`admin-only` 클래스가 없어 비로그인 상태에서도 보이는지, (3) 햄버거 메뉴에는
세 항목이 더 이상 안 뜨지만 🔍 검색으로는 여전히 찾아지는지 — 모두 검증했다.

## `food-map.html` (맛집 공유지도)

Any approved teacher can drop a pin for a restaurant/cafe they recommend (either
by clicking the map directly, or by searching Kakao's own place database and
picking a result to auto-fill name/category/address), and other teachers can
browse, filter, search, "좋아요", and leave a star-rated review. Standard login +
`profiles.approved` gate (same pattern as `form-board.html`) rather than
`room-booking.html`'s anonymous-access model — a social/attribution feature like
this fits the "identified teacher, like `form_templates`" shape better than the
"anyone, even logged out" shape.

- **Map library: Kakao Maps JS SDK, not Leaflet/OpenStreetMap.** The first
  version of this page used Leaflet + OSM tiles (no API key needed) purely to
  avoid a new external dependency. That changed after explicit user feedback
  asking for (1) business hours pulled from Kakao Map and (2) a lightweight
  review system — clarified via follow-up questions into "replace the map
  itself with Kakao Maps" (not just a link-out) plus "star rating (1–5) + short
  text" reviews. **Before building the hours-fetch part, I verified via web
  search that Kakao's official Local API/JS SDK does not expose business-hours
  data at all** (it's always `null`) — only unauthorized scraping of Kakao's own
  pages exposes it, which violates Kakao's ToS and was rejected outright. The
  user confirmed the fallback: instead of auto-fetched hours, every pin added
  via Kakao place search carries a `kakao_place_url` link ("🗺️ 카카오맵에서 보기
  (영업시간 확인)") straight to that place's real Kakao Map page, where the
  actual hours **are** visible. See `KAKAO-MAP-SETUP.md` for how to obtain and
  register the free JavaScript key this needs (`KAKAO_JS_KEY` near the top of
  `food-map.html`'s script) — until that key is set, the constant stays the
  literal placeholder `'YOUR_KAKAO_JAVASCRIPT_KEY'`, and
  `kakaoKeyMissing` short-circuits the whole map/search setup (`loadKakaoSdk()`
  is never called, `#foodMap` shows a plain "카카오맵 키 설정 후 지도가 여기
  표시돼요" note, and the map/내 위치/검색 controls are `disabled`) — **the list,
  좋아요, and reviews still work with no key configured**, since none of those
  touch Kakao at all. The SDK itself is loaded dynamically
  (`//dapi.kakao.com/v2/maps/sdk.js?appkey=...&libraries=services&autoload=false`,
  `kakao.maps.load(callback)` before first use) rather than a static `<script>`
  tag, specifically so the key-missing case can skip the network request
  entirely instead of loading a doomed script.
- **Two ways to add a pin: click the map, or search Kakao's place database.**
  The original click-to-place flow is unchanged (crosshair cursor in add mode,
  next map click opens the save form prefilled with nothing but the clicked
  coordinates). A new `#placeSearchInput`/`btnPlaceSearch` row above the map
  calls `kakao.maps.services.Places().keywordSearch(keyword, callback)`
  (requires `libraries=services` in the SDK URL) and renders up to 8
  `.place-result` rows; clicking one (`pickSearchResult()`) opens the same save
  form prefilled with the place's real name/address and a **guessed** category
  (`mapKakaoCategory()` — substring-matches Kakao's `category_name` string like
  `"음식점 > 한식 > 백반/한정식"` against this page's own 7 categories; never
  exact, always editable before saving) — and, critically, sets
  `pendingKakaoUrl` to `place.place_url` so the saved row gets a real
  `kakao_place_url`. A pin added by clicking the map instead has no Kakao place
  association, so `kakao_place_url` stays `null` for it — there's nothing to
  guess from a bare coordinate.
- **`food_spots` table**: `name`, `category` (free text with a `<datalist>` of
  7 suggestions — 한식/중식/일식/양식/카페·디저트/분식/기타 — same
  "suggest, don't force an enum" convention as `form_templates.category`),
  `description`, `address` (nullable, display-only), `lat`/`lng`
  (`double precision`, required), `kakao_place_url` (nullable `text`, see
  above), `author_id`/`author_name` (written from the session at save time,
  never a typed field — same convention as `form_templates`/`room_bookings`),
  `like_count` (denormalized, see below), `created_at`. RLS follows the exact
  `form_templates` shape: `select` open to any authenticated user, `insert`
  requires self-attribution (`auth.uid() = author_id`), `update`/`delete`
  allowed for the post's own author or an admin (`current_user_is_admin()`).
  Editing a pin (`openEditForm()`) never touches `lat`/`lng`/`kakao_place_url`,
  only name/category/description/address — correcting a pin's text never risks
  moving it or silently detaching its Kakao link.
- **`food_spot_likes` table** (`spot_id`, `user_id`, composite primary key —
  so an `insert` on an already-liked spot just fails the PK constraint rather
  than needing a separate uniqueness check): RLS lets any authenticated user
  `select` (needed so a teacher's own `loadMyLikes()` query —
  `eq('user_id', me)` — works), `insert` requires `auth.uid() = user_id`,
  `delete` same. **`food_spots.like_count` is kept in sync by a database
  trigger** (`trg_food_spot_likes_sync` → `food_spot_likes_sync()`,
  `SECURITY DEFINER`), not client-side increment/decrement calls — same
  "trigger over scattered client-side update calls" principle documented
  under `task_assignments.owner_seen_completed_at` above. `toggleLike()` on
  the client does an **optimistic update** that mirrors exactly what the
  trigger does (+1/-1 locally, re-render immediately) before firing the actual
  insert/delete in the background, rolling back on error — matches
  `custom_bot_notes`' optimistic-delete pattern elsewhere in this file.
- **`food_spot_reviews` table** — the star-rated review system: `spot_id` (FK,
  cascade delete), `author_id`/`author_name`, `rating` (`smallint`, `check
  (rating between 1 and 5)`), `comment` (nullable free text), `created_at`,
  plus `unique(spot_id, author_id)` so **one review per person per spot,
  edit-in-place** — a teacher coming back to re-rate a place updates their
  existing review rather than stacking a second one. RLS mirrors
  `food_spots`: open `select`, self-attributed `insert`, author-or-admin
  `update`/`delete`. The client never branches on insert-vs-update itself —
  `btnSaveReview`'s handler always does one `sb.from('food_spot_reviews')
  .upsert({...}, {onConflict: 'spot_id,author_id'})` call, letting the unique
  constraint decide whether that's a fresh row or an overwrite. Average
  rating is **not** a trigger-maintained column (unlike `like_count`) — it's
  computed client-side: `loadRatingStats()` does one `select('spot_id,
  rating')` across the whole table on page load and reduces it into
  `ratingStats[spotId] = {sum, count}` in memory, and `ratingFor(spotId)`
  derives `{avg, count}` on demand. This was a deliberate simplicity trade-off
  over adding a second trigger — the review count scale here (a handful of
  reviews per spot, site-wide) doesn't need a maintained aggregate column, and
  re-running `loadRatingStats()` after every save/delete keeps it correct with
  no extra schema.
- **Reviews are a lazy-loaded accordion per spot, not always-rendered.**
  Each list row has a "⭐ avg (count)" toggle button (`.review-toggle-btn`);
  the first click fetches that spot's reviews (`loadAndRenderReviews()`,
  `select('*').eq('spot_id', ...)`) and caches them in `reviewsCache[spotId]`,
  subsequent toggles just show/hide the already-fetched `#reviews-<id>` area.
  `renderReviewsArea()` sorts the signed-in teacher's own review (if any) to
  the top of the list, pre-fills the star picker and comment box from it, and
  swaps the save button's label to "내 리뷰 수정" (plus a "내 리뷰 삭제" button)
  instead of "리뷰 남기기" — reusing one render function for both the
  first-review and edit-existing-review cases rather than two separate forms.
  `paintStars()` is a plain closure over a `selected` rating variable, not a
  native `<input type="range">` or radio group — five `<span>`s re-rendered on
  every click to show ★ up to the selected value.
- **Pin popups are a second `kakao.maps.CustomOverlay`, not a native
  bind-popup API** — Kakao Maps has no Leaflet-style `marker.bindPopup()`
  equivalent, so `togglePopup()`/`closePopup()` manage one `popupOverlay`
  instance by hand (create on open, `setMap(null)` + discard on close),
  positioned via `yAnchor: 1.3` to sit above the clicked emoji marker.
  `refreshOpenPopupIfNeeded(spotId)` is called after any like/review change so
  an already-open popup's like count / star average updates in place instead
  of going stale until the next open. Category markers are **also**
  `CustomOverlay`s (not Kakao's native `Marker`) holding a plain `<div>` with
  one emoji (`CATEGORY_EMOJI`, same 🍚/🍜/🍣/🍝/☕/🍢/🍴 mapping as before) —
  chosen because a `CustomOverlay` can hold arbitrary HTML/click-handling with
  no separate image asset, matching this repo's general preference for
  dependency-free solutions.
- **List + map are one filtered view, not two independent ones.**
  `filteredSpots()` (category-pill `Set` ∩ free-text search across
  name/description/address/author) drives both `renderList()`'s cards and
  `applyMarkerVisibility()`'s overlay show/hide calls, so narrowing the list by
  category or search also hides the matching markers. Clicking a list card
  pans the map to that spot (`map.setCenter()`/`setLevel(4)`) and opens its
  popup; the category pills reuse the same toggle-chip pattern as
  `room-booking.html`'s 위치 필터 (`.cat-pill.active`, `Set`-based multi-select,
  click toggles and re-renders immediately — no apply button).
- **Default map center is 경성고등학교 itself** (서울 마포구 성미산로 111 —
  approximate coordinates `37.5632, 126.9195`, looked up via web search since
  no school-specific coordinates existed anywhere in this codebase before
  this; close enough for a default viewport, not claimed as surveyed-exact),
  level 5 initially (later tightened to level 3 — see "지도 크기/배율 확대" below),
  replacing an earlier placeholder center on 서울시청
  (37.5665, 126.9780) at level 7 that had no connection to the school at all.
  `fitSpotsBounds()` still re-fits to every existing pin once real data
  loads, so this only matters for the very first paint (or a day with zero
  spots loaded yet); "📍 내 위치로" (`navigator.geolocation`) lets a teacher
  jump to their own location on demand regardless.
- **Layout is three columns — 장소 검색(place search) / 지도(map) / 맛집
  목록(category filter + saved list)**, left to right
  (`.fm-layout`/`.fm-search-col`/`.fm-map-col`/`.fm-list-col`, `flex`-based,
  stacking to one column below 1100px). This replaced an earlier two-column
  version (map left, list right, with the Kakao place search tucked above
  the map) per explicit follow-up request to pull the search box/results out
  into their own leftmost column — the map's own controls (내 위치로/지도
  클릭해서 추가, the add-mode hint, the save form) stayed with the map
  column rather than moving to the search column, since filling out the
  save form while watching its pin on the map is the more natural flow than
  watching the search results list. `.wrap` is widened to `1480px`;
  `#foodMap` is `620px` tall, and both the search column's
  `#placeSearchResults` and the list column's `#spotList` get their own
  independent scroll area capped to the map's height
  (`max-height` matched, `overflow-y:auto`) so a long results/spot list
  scrolls on its own instead of pushing the page down past the map. The
  search column is narrower (`flex:0.85`, capped `340px`) than the list
  column (`flex:1`, capped `420px`), and the map column is the widest
  (`flex:1.5`) of the three.
- **`KAKAO_JS_KEY` is a real, live key** (obtained from Kakao Developers per
  `KAKAO-MAP-SETUP.md`), not the placeholder — the map/search features are
  live, not in the graceful-degradation state described above.
- **In `nav.js`/`index.html`, now public — `adminOnly: true` was removed once
  the page was considered done.** The page briefly had no nav entry at all
  while first being rewritten (per "맛집 공유지도는 아직 메뉴에 넣지 말고 만든
  다음에 완성하고 넣자"), then went admin-only-visible for a while ("일단 메인
  메뉴에 추가는 하는데 관리자한테만 보이게 해줘. 좀 완성되면 모두에게 보이게
  하자") — both the `DEFAULT_NAV_ITEMS` entry and the matching `index.html`
  tool-card carried an `adminOnly: true` flag during that period (see
  `## nav.js` below for what that flag actually does). Per explicit follow-up
  ("이제 맛집지도 모두에게 보이게 공개하자"), that flag was deleted from the
  `nav.js` entry — nothing else needed to change (the `index.html` tile itself
  never carried the flag; visibility was always driven entirely from the
  nav.js entry) — so every approved teacher now sees it in the hamburger menu
  and the main tile grid, not just admins.
- **Design polish pass** (card shadows, larger radius, pill-shaped buttons/
  tags, hover/focus states) — the original build reused this repo's classic
  flat-bordered `.card` look; once the map was actually working, a visual
  pass softened borders into `--shadow-sm`/`--shadow-md` box-shadows,
  bumped `border-radius` to 14px on cards/`#foodMap`/the add-form wrapper and
  999px on pills/tags/like-review buttons, and gave every list row
  (`.spot-block`) its own bordered+shadowed card instead of a flat
  divider-separated list. This was a page-local polish only — the
  site-wide theme question (the "테마 레이아웃" Artifact mockups discussed
  with the user) stayed on hold; nothing here touches any other page's CSS.
- **정렬(최신순/좋아요순/평점순/이름순) + 필터(내가 올린 곳만/좋아요한 곳만) +
  "내가 올린 맛집" 통계줄.** `#fmSort` is a plain client-side re-sort of the
  already-filtered list (`sortedFilteredSpots()`, wrapping `filteredSpots()`)
  — ratings sort by `ratingFor(id).avg`, never refetched from the server.
  `#toggleMyOnly`/`#toggleLikedOnly` are two independent toggle pills
  (`.toggle-pill.active`) that extend `filteredSpots()`'s existing
  category/search predicate with `author_id === myUid` /
  `myLikedIds.has(id)` — this doubles as the "내가 올린 맛집 관리" feature the
  user asked for (no separate management screen; toggling "내가 올린 곳만"
  just narrows the existing list down to rows where `canManage()` already
  shows 수정/삭제). While that toggle is on, `renderMyStatsLine()` shows a
  one-line summary (총 등록 수 · 받은 좋아요 합 · 평균 별점), computed
  client-side from the already-loaded `spots`/`ratingStats` — no new query.
- **카테고리 선택 시 지도 범위를 그 카테고리의 핀들에 맞춰 재조정.**
  `fitFilteredBounds()` (new) calls `map.setBounds()` over
  `filteredSpots()`'s coordinates whenever a category pill or the
  내가 올린 곳만/좋아요한 곳만 토글 changes — before this, toggling a
  category only hid/showed markers in place (`applyMarkerVisibility()`)
  without moving the viewport, so a filtered-to-a-few-pins category could
  leave the user looking at an empty patch of map if those pins were
  off-screen. Plain text search deliberately does **not** trigger this (re-
  centering the map on every keystroke while typing would be more jarring
  than useful).
- **일반 맛집 마커에 상호명 라벨이 함께 뜬다.** `makeOverlayEl(category, name,
  onClick)` used to render just an emoji with no text — once several pins of
  the same category were visible at once there was no way to tell them
  apart without clicking each one. It now renders emoji + a small white
  pill label carrying the spot's name (`renderMarkers()` passes `s.name`),
  so "선택하면 그 리스트에 해당하는 곳들이 지도 위에 상호명과 같이 쭉
  표시"된다는 요청을 그대로 충족한다. A pending/temp marker (map-click-to-add
  flow) still renders label-less, since there's no name yet at that point.
- **카카오맵 장소검색 결과도 목록만이 아니라 지도 위에 핀으로 함께 뜬다.**
  Previously `doPlaceSearch()` only populated the text list
  (`#placeSearchResults`) — nothing showed on the map until a result was
  clicked. `renderSearchResultMarkers(data)` now plots a numbered red-badge
  pin (`makeSearchMarkerEl()`) per result right after the list renders.
  Clicking a map pin calls the same `pickSearchResult()` the list row's
  click already used. **No photo preview was added** — verified that
  Kakao's `keywordSearch` response has no image/photo field at all (same
  category of limitation as the already-documented missing business-hours
  data above), so instead the list/pin rows show whatever real info the API
  *does* return: category, phone number, and distance (see the radius bullet
  below for where that distance is measured from). A teacher who wants to
  see an actual photo still has the `kakao_place_url` link once the spot is
  saved.
- **화면은 검색 결과 때문에 임의로 움직이지 않는다 — 검색 자체는 반경으로
  제한하지 않는다.** An earlier version both (a) called `map.setBounds()` to
  fit every search result, panning the view away from the school, and (b)
  passed a `radius` option to `keywordSearch()` to hard-filter results to
  within 5km of the school. (a) was *supposed to be* removed per an earlier
  follow-up ("검색을 해서 리스트가 나오더라도 일단 학교 주변으로 화면은
  한정해줘. 목록에서 선택하면 위치를 옮겨서 보여주고"), but the actual fix
  never shipped — `renderSearchResultMarkers()` kept calling
  `map.setBounds(bounds)` over every result regardless, and this file kept
  claiming otherwise until the mismatch was caught by re-reading the live
  code (see the 홍익분식 incident below, which this directly explains:
  distant same-named results were dragging the whole view out to fit them,
  making a real nearby match look "missing"). It's now actually removed —
  the map never moves just from rendering search pins; it only moves when a
  specific result is actually picked (`pickSearchResult()`'s existing
  `map.setCenter()`/`setLevel(4)`). (b) was tried, then reverted the same
  session after a real regression: a teacher reported a genuinely nearby,
  real place (카츠토랑
  연남본점, literally on the same street as the school) missing from search
  — Kakao's `radius` filter does hard-exclude anything outside it server-
  side, and an admin-tuned radius around an only-approximate school
  coordinate (see below) is exactly the kind of boundary that can silently
  cut off a real match. `keywordSearch()` still passes `location: <fixed
  school coordinate>` (never `map.getCenter()`, so distance doesn't drift if
  the teacher has already panned) purely so `place.distance` populates for
  display — it's a sort/display hint only now, not a filter. A "🏫 학교
  주변" button next to "📍 내 위치로" (`#btnSchoolArea`) resets the map back
  to `SCHOOL_LATLNG`/the default zoom level on demand, for whenever a teacher has wandered
  the map (via 내 위치로, panning, or picking a far-off result) and wants
  back to the default view — this is the feature that actually answers
  "학교 주변으로 화면 한정," not a search-radius filter.
- **A second "missing search result" report turned out to be a spelling
  difference, not a bug** — a teacher searched "가츠토랑" (ㄱ) and got
  nothing; the real business name is "카츠토랑" (ㅋ). Confirmed by a
  screenshot of Kakao Map's own web UI, which silently autocorrects
  "가츠토랑 검색결과가 없어 카츠토랑(으)로 검색했습니다" before showing
  results — that fuzzy-correction happens in Kakao's web front end, not in
  the plain `keywordSearch()` JS API this page calls, so an exact-but-wrong
  spelling returns zero results here exactly as it would if typed literally
  into Kakao's own search box. Worth remembering before assuming a "real
  place missing from search" report is this page's bug: check the exact
  spelling on Kakao Map itself first.
- **다시 검색하기 전까지는 검색 목록/지도 핀이 그대로 유지된다 — 목록에서 다른
  결과를 고를 때마다 초기화되지 않는다.** This was a real regression a
  teacher hit: clicking a search result used to clear `#placeSearchResults`
  and every numbered pin (`exitAddMode()`'s old body did both), so comparing
  a few candidates meant re-searching from scratch each time. Fixed by
  splitting `exitAddMode()` into `resetAddState()` (clears
  `addMode`/`pendingLatLng`/the previous temp "about to save" pin/the open
  add form — safe to re-run on every pick) plus the two result-clearing
  lines, which now live only in `exitAddMode()` itself (called by "추가
  취소"/캔슬, and at the start of a **new** `doPlaceSearch()` call via
  `renderSearchResultMarkers()`'s own `clearSearchResultOverlays()`).
  `pickSearchResult()` calls `resetAddState()` only — the search list and
  every numbered pin stay exactly as they were, and the newly-picked result
  gets its own labeled temp marker (from `makeOverlayEl`) layered on top, so
  a result can end up showing both its numbered search badge and a "pending
  save" pin at once until the form is actually saved or canceled.
- **지도 크기/배율 확대**: `#foodMap`'s height went `620px` → `760px`, and the
  default/reset zoom level went `5` → `3` (every `kakao.maps.Map` init or
  `setLevel()` call in this file — initial map creation, "📍 내 위치로",
  "🏫 학교 주변", picking a search result, clicking a list row — all use the
  same level constant together, so the map always returns to the same
  zoomed-in framing regardless of which of those triggered it). The user
  confirmed the target zoom by sending a screenshot of Kakao Map's own app at
  roughly this zoom (street names and individual buildings legible, not just
  a neighborhood-level overview) — level 3 was picked to match that
  reference image, not an arbitrary "a bit more" guess. The card max-heights
  that mirror the map's height (`.fm-search-col .card`/`.fm-list-col .card`)
  were bumped to match (`calc(760px + 2px)`).
- **Bug: the 3-column layout silently collapsed to 1 column on a phone's
  "데스크탑 사이트"(request-desktop-site) mode, even though that mode reports
  a ~980–1038px viewport width** — wide enough that a teacher would expect
  the desktop 3-column layout, not the narrow single-column one.
  `@media (max-width: 1100px)` was simply too generous a breakpoint; it was
  lowered to `820px` (`.fm-layout{flex-direction:column}`) so only genuinely
  narrow viewports (regular mobile Safari/Chrome, not desktop-site mode)
  fall back to stacking.
- **오타/불완전 입력 자동 재검색.** A teacher correctly spelling a real,
  nearby, Kakao-listed restaurant ("홍익분식") still got zero results from
  this page's search — and **this could not be explained by the earlier
  radius restriction**, since `git log`/`git show main:food-map.html`
  confirmed that restriction was removed before it was ever pushed to `main`
  (the live site only ever sent `{ location: ... }`, never `radius`) — so
  whatever caused that specific report remains unconfirmed; no live browser
  access to the real Kakao API was available in this environment to
  reproduce it directly. Two defensive, best-effort mitigations were added
  without being able to confirm either is the actual root cause of that
  report:
  - **Typo/truncation auto-retry** (`generateRetryKeywords()`,
    `doPlaceSearch()` now `async`): if the exact typed keyword returns zero
    results, the page automatically retries with up to 6 variants before
    giving up — one 평음/격음 (plain/aspirated consonant) swap per character
    that has a counterpart (ㄱ↔ㅋ, ㄷ↔ㅌ, ㅂ↔ㅍ, ㅈ↔ㅊ; e.g. "가츠토랑" →
    "카츠토랑", matching the confirmed 가츠토랑/카츠토랑 case above), plus the
    keyword with its last 1–2 characters dropped (covers an incomplete/
    truncated name). `decomposeHangul()`/`composeHangul()` do plain Unicode
    syllable-block math (`code = ch.charCodeAt(0) - 0xAC00`; 초성/중성/종성
    via `/588`, `%588/28`, `%28`) rather than a lookup table. The first
    variant that returns a non-empty result wins, and the result list shows
    a small notice ("'가츠토랑' 검색 결과가 없어 '카츠토랑'(으)로 다시
    찾았어요.") so the teacher knows the exact term actually matched —
    `renderPlaceResults(results, noticeText)` was factored out of the old
    synchronous `doPlaceSearch()` body specifically so both the first-try
    and retry paths render through one function. If every variant also
    returns nothing, the existing "검색 결과가 없어요" message shows as
    before.
  - **IME composition guard on Enter-to-search**: the search input's
    `keydown` listener now ignores Enter while `e.isComposing` (or
    `e.keyCode === 229`) is true — without this, pressing Enter mid-Hangul-
    composition (common when a teacher types a name and immediately hits
    Enter) could submit the search before the IME has finished combining the
    last character(s), silently truncating the query (e.g. "홍익분식" search-
    submitted as "홍익분"). This is a standing risk fix, not a confirmed
    cause of the 홍익분식 report specifically.
  - **실제 원인으로 확인된 두 가지, 둘 다 고침.** 사용자가 직접 재현해 다시
    보고한 뒤("홍익 분식이 연남동에 하나 나와야 되는데 안 나오고") 코드를
    다시 읽어서 찾았다 — 이전에 "안 보인다"로만 보고됐을 때는 추측성
    완화책(오타 재검색, IME 가드)만 추가하고 실제 원인은 못 찾았었는데,
    `renderSearchResultMarkers()`를 다시 보니 바로 위 항목에서 "제거했다"고
    적어놨던 `map.setBounds()` 호출이 **실제로는 코드에 그대로 남아있었다**.
    1. **정확도(accuracy) 정렬만 쓰고 있었다.** `keywordSearch()`에 `sort`를
       전혀 안 넘기면 기본값이 정확도 정렬인데, "홍익분식"처럼 전국에 같은
       이름의 가게가 여러 곳 있으면 연남동 지점이 카카오의 정확도 점수에서
       상위 8개 밖으로 밀려날 수 있다. `location`(학교 좌표)과 함께
       `sort: kakao.maps.services.SortBy.DISTANCE`를 넘겨서, 학교에서 가까운
       결과가 먼저 오도록 바꿨다 — `radius` 하드 필터와 달리 결과를 아예
       배제하지는 않고 순서만 바꾸므로, 카츠토랑 사례에서 겪은 것 같은
       "경계에서 실제 결과가 걸러지는" 위험은 없다.
    2. **모든 검색 결과에 `map.setBounds()`를 호출하고 있었다.** 바로 위
       항목에서 "제거했다"고 적었던 그 수정이 실제로는 반영된 적이 없었다
       — 전국에 흩어진 동명 매장들을 다 지도에 꽂고 그 전체 범위로
       `setBounds()`를 호출하면, 학교 근처는 멀리 줌아웃되고 먼 결과들까지
       화면에 다 들어오게 돼서 "분명히 가까운 데 있는 가게인데 안 보인다"처럼
       보일 수 있었다. 이번에 실제로 제거했다 — 검색은 더 이상 지도 화면을
       전혀 움직이지 않는다.
  - **추가로 요청받은 것: 검색 결과 핀을 전부 다 지도에 꽂을 필요는 없다 —
    실제 화면(viewport) 근처에 있는 것만 핀으로 보여주면 된다.** 위 수정과
    함께 반영 — `renderSearchResultMarkers()`가 이제 `map.getBounds()`로
    지금 실제로 보이는 지도 범위를 구하고, 그 범위 `contain()` 안에 드는
    결과만 핀을 꽂는다(화면이 전혀 안 움직이므로 이 범위는 항상 "교사가
    지금 보고 있는 그 화면"이다). 목록(`#placeSearchResults`)에는 여전히
    전체 결과가 번호와 함께 다 나오고, 번호는 항상 원래 `data` 배열 순서를
    쓰므로 화면 밖이라 핀이 안 보이는 결과를 목록에서 클릭해도
    `pickSearchResult()`는 그대로 동작한다.
- **줌아웃/드래그해서 지도가 다시 멈추면(`idle`), 화면 밖이라 안 보이던 검색
  핀도 새 화면 기준으로 다시 계산돼서 나타난다.** 위 viewport 필터링은 검색
  "직후" 한 번만 `map.getBounds()`를 읽어서 핀을 거르는데, 그 뒤 교사가 직접
  지도를 줌아웃하거나 드래그해서 더 넓은(또는 다른) 범위를 보게 되면 그 핀들이
  계속 숨어있는 게 아니라 새로 보이는 범위에 맞춰 다시 채워져야 자연스럽다.
  `lastSearchResultData`(마지막 검색 결과 전체, 화면 밖이라 핀이 안 뜬 것까지
  포함)를 모듈 스코프에 기억해두고, 지도 생성 시
  `kakao.maps.event.addListener(map, 'idle', ...)`로 줌/드래그가 끝나고 지도가
  멈출 때마다 `lastSearchResultData`가 있으면 `renderSearchResultMarkers()`를
  다시 호출한다 — 매번 전체 리스트를 다시 넘기므로 핀이 사라지고 나타나는
  계산은 항상 `renderSearchResultMarkers()` 한 곳의 로직만 탄다. 검색을 아예
  취소(`exitAddMode()`)하거나 결과가 없을 때는 `lastSearchResultData = []`로
  같이 비워서, 그 뒤 지도를 움직여도 이미 지운 핀이 `idle` 이벤트로 되살아나지
  않게 한다. `kakao_stub.js`(테스트용 스텁)에도 `idle` 리스너를 등록·보관하는
  로직과 `window.__fireKakaoIdle()`(등록된 모든 idle 핸들러를 한 번에 울리는
  테스트 헬퍼)을 추가했다 — 실제 SDK는 줌/드래그가 실제로 끝나야 이 이벤트가
  울리지만, 테스트에서는 `window.__fakeMapBoundsBox`를 바꾼 뒤 이 헬퍼를 직접
  호출해서 "줌아웃했다"를 흉내낸다.
- **핀의 이름을 클릭하면 팝업으로 좋아요/별점 남기기/수정 같은 빠른 액션이
  뜬다 — 아직 저장 안 된 카카오 검색 결과 핀을 누르면 "맛집 목록에 추가"
  버튼이 뜬다(누르는 즉시 저장됨, 폼 없음).** 이전까지 지도 핀 클릭 동작은
  두 종류였다: 이미 저장된 맛집 핀(`makeOverlayEl`)은 읽기 전용 정보 팝업
  (`togglePopup`)만 떴고, 아직 저장 전인 카카오 검색 결과 핀
  (`makeSearchMarkerEl`)은 클릭하자마자 바로 추가 폼으로 건너뛰어서
  (`pickSearchResult`) 팝업이라는 중간 단계가 전혀 없었다. 두 경우 다 팝업을
  거치도록 통일했다:
  - **저장된 맛집 핀의 팝업(`popupHtml`/`buildPopupContent`)**이 정보 표시에
    그치지 않고 `.popup-actions` 액션 버튼 줄을 갖는다 — "🤍/❤️ 좋아요"(목록의
    `toggleLike`를 그대로 재사용), "⭐ 별점 남기기"(누르면 팝업 안
    `.popup-reviews` 영역에 인라인 리뷰 폼이 펼쳐짐), 그리고 `canManage(s)`일
    때만(글쓴이 본인 또는 관리자) "✏️ 수정"(`openEditForm`으로 바로 연결).
    **삭제 버튼은 팝업에 없다** — "이름을 클릭했을 때 뜨는 팝업에는 제거
    버튼은 없애자. 목록에서만 삭제할 수 있게"라는 명시적 follow-up으로,
    처음엔 "🗑 맛집 목록에서 제거"(`deleteSpot`)도 넣었다가 뺐다 — 삭제는
    여전히 `renderList()`의 `.spot-item-actions` 안 목록 "삭제" 버튼으로만
    가능하다. 리뷰 폼은 목록의 `renderReviewsArea()`/`loadAndRenderReviews()`
    를 그대로 재사용하되, 둘 다 렌더링 대상 컨테이너를 선택적 두 번째 인자
    (`containerEl`)로 받도록 바꿨다 — 생략하면 기존처럼 목록의
    `id="reviews-<id>"`를 찾고, 넘기면 그 엘리먼트에 직접 그린다. id가 아니라
    엘리먼트 참조로 넘기는 이유는, 목록의 리뷰 영역과 팝업의 리뷰 영역이
    "같은 spotId"로 동시에 화면에 떠 있을 수 있어서 `id="reviews-<id>"`를
    팝업에도 그대로 쓰면 문서에 같은 id가 두 번 생겨 `getElementById`가 항상
    첫 번째(목록 쪽)만 찾는 문제가 생기기 때문이다.
  - **아직 저장 안 된 검색 결과 핀(`onSearchPinClick`)**은 먼저
    `kakao_place_url`로 이미 저장된 맛집과 같은 장소인지 찾아본다
    (`findSpotByPlaceUrl`) — 같은 장소가 이미 있으면(다른 교사가 먼저
    추가했거나, 검색 결과와 기존 핀이 같은 곳을 가리키는 경우) "추가" 팝업
    대신 그 기존 항목의 팝업(`togglePopup`, 위와 동일한 좋아요/별점/수정
    액션)을 그대로 열어준다. 아직 아무도 추가하지 않은 곳이면
    `buildSearchAddPopupContent(place)`가 이름/주소 + 카테고리 입력칸(아래
    설명) + "➕ 맛집 목록에 추가" 버튼짜리 작은 팝업을 띄운다 — **처음엔 그
    버튼이 `pickSearchResult(place)`로 기존 추가 폼을 열었는데, "맛집 목록에
    추가 하면 바로 추가되게 해야지"라는 follow-up으로 폼 없이 즉시
    `quickAddFromSearchPin(place, category)`가 `food_spots`에 바로
    `insert`하도록 바꿨다**(이름/주소/좌표/카카오 링크는 검색 결과 그대로,
    작성자는 로그인 세션에서). 카테고리만은 `mapKakaoCategory()`의 자동
    추정이 이 페이지 기본 카테고리 목록에 아예 없는 종류(예: "베이커리")를
    못 맞히는 경우가 있어서, 추정값이 미리 채워진
    `<input list="fmCategoryOptions">`(기존 추가 폼과 같은 datalist 재사용)
    를 팝업에 함께 둬서 타이핑으로 직접 고칠 수 있게 했다 — "추가" 버튼을
    누르는 순간 그 입력칸의 값을 그대로 저장한다. **목록(`.place-result`)에서
    고르는 건 이 변경과 무관하게 그대로 즉시 추가 폼으로 간다** — 목록
    클릭은 이미 "여러 후보 중 이걸로 확정"이라는 의도가 분명한 다른 종류의
    클릭이라 굳이 즉시저장으로 바꾸지 않았다. `closePopup()`은
    `openPopupSpotId`와 `openSearchPlaceUrl`(검색-추가 팝업이 지금 어느
    place_url/이름을 띄우고 있는지, 같은 핀을 다시 누르면 토글-닫힘 하기
    위한 상태) 둘 다 리셋하므로, 저장된 핀 팝업과 검색-추가 팝업은 하나의
    `popupOverlay`를 공유하면서도 서로 깔끔하게 전환된다.
- **검색어의 띄어쓰기 차이도 자동 재시도하고, 그래도 전혀 못 찾으면 비슷한
  이름으로 한 번 더 찾아본다.** `generateRetryKeywords()`에 세 번째 변형을
  추가했다 — 키워드에 공백이 있으면 공백을 전부 없앤 버전도 시도한다(예:
  "홍익 분식"으로 검색했는데 실제로는 "홍익분식"으로 저장돼 있는 경우). 그
  모든 변형(평음/격음, 뒷글자 drop, 공백 제거)으로도 전혀 못 찾으면
  `similarSearchKeyword()`가 공백을 뺀 키워드의 앞 2글자만으로 마지막으로 한
  번 더(거리순 정렬 그대로) 찾아보고, 찾으면 "'키워드' 검색 결과가 없어요.
  비슷한 이름의 장소를 보여드려요."라는 안내와 함께 보여준다 — 정확한 매치가
  아니라는 걸 분명히 알리면서도, 아예 "검색 결과 없음"으로 끝내지 않고 뭐라도
  단서를 준다.
- **전체 공개로 전환.** `adminOnly: true`였던 `nav.js`의 `DEFAULT_NAV_ITEMS`
  항목에서 그 플래그만 삭제했다(사용자 요청 "이제 맛집지도 모두에게 보이게
  공개하자") — 다른 변경은 필요 없었다(`index.html`의 타일 자체는 애초에
  플래그를 들고 있지 않았고, 노출 여부는 전부 nav.js 쪽 플래그 하나가
  결정했기 때문). 이제 로그인한 모든 승인된 교사에게 햄버거 메뉴·메인 타일
  양쪽 다 보인다.
- **목록 카드 레이아웃을 이름+설명(카테고리 배지 포함) 2줄 정도로 압축.** 원래
  카드(`renderList()`)는 이름/설명/주소/작성자·날짜·카카오맵 링크를 전부 세로로
  나열하고, 오른쪽에 좋아요/별점/수정/삭제 버튼까지 세로로 쌓아서 카드 하나가
  꽤 길었다. 사용자 요청("이름과 설명만 먼저 나오고 카드를 클릭하면 주소와 맵
  연결 나오게. 수정과 삭제는 맨 오른쪽으로 빼서 높이는 두 줄 정도로")에 따라:
  - `.spot-item-addr`/`.spot-item-meta`(주소·작성자·날짜·카카오맵 링크) 줄을
    카드에서 아예 빼버렸다 — 이미 카드(`.spot-item`)를 클릭하면 그 맛집의 지도
    핀 팝업(`togglePopup`)이 열리고, 그 팝업이 주소·작성자·날짜·카카오맵 링크를
    전부 보여주므로 별도의 펼치기/접기 상태 없이 그대로 "클릭하면 나오게"가
    충족된다. 추가 토글 로직이 전혀 필요 없었다.
  - `.spot-item-desc`에 `overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap`을 줘서 설명이 아무리 길어도 한 줄로 잘리게 했다 — 이름
    줄 + 설명 한 줄로 카드 높이가 항상 ~2줄로 고정된다.
  - `.spot-item-side`(좋아요/별점/수정/삭제)를 `flex-direction:column`에서
    `row`로 바꿨다 — 세로로 3줄 쌓이던 게 오른쪽 끝에 한 줄로 나란히 모여서,
    왼쪽(이름+설명 2줄)과 오른쪽(버튼 1줄) 높이가 맞춰진다.
  - 카테고리 배지(`.spot-item-cat`)는 그대로 이름 옆에 남아있다 — "이름과
    설명만"이라는 표현은 주소/메타를 빼라는 뜻이었지 카테고리까지 빼라는 뜻은
    아니었다(사용자가 직접 "카테고리 다시 보여줘봐"로 확인·재확인).
- **페이지 로드 시 "등록된 모든 맛집이 다 보이도록" 지도 범위를 자동으로
  재조정하던 `fitSpotsBounds()`를 완전히 제거.** 맛집이 전국/시 전역으로
  퍼지면서, 새로고침할 때마다 지도가 학교 근처가 아니라 모든 핀을 다 담으려고
  계속 멀리 줌아웃돼버리는 문제가 생겼다(사용자: "새로고침하니까 등록된
  목록이 모두 표시되게 지도가 축소되는데, 학교 주변만 보이게 기본값으로"). 이
  함수는 `loadSpots()` 직후 딱 한 곳에서만 호출되고 있었어서, 호출부와 함수
  정의를 둘 다 지웠다 — 이제 첫 화면은 항상 지도 생성 시 설정한 기본값
  (`SCHOOL_LATLNG`, 레벨 3)으로 고정이고, 전체 맛집을 보려면 교사가 직접
  지도를 줌아웃하거나 카테고리 필터로 원하는 범위만 좁혀 보면 된다.
- **페이지 폭/지도 크기 확대 — 지도 세로 1.5배(760px→1140px), 전체 wrap
  1480px→1880px, 지도 칸 flex 비중도 같이 키움(1.5→2.3).** 사용자 요청("페이지
  가로 너비 더 넓히고 지도 크기도 키우자. 지도 1.5배 정도")을 그대로 숫자로
  반영했다 — `#foodMap` 높이와 그 높이에 맞춰 캡을 공유하는 검색·목록 칸 카드의
  `max-height` 공식(`calc(지도높이 + 2px)`)도 같이 1140px 기준으로 올렸다.
  **이 변경이 실제 버그를 하나 만들었다가 바로 잡았다**: 지도 칸의 flex 비중을
  올리면서 좁은 화면(테스트 기준 1300px 뷰포트)에서 왼쪽 검색 칸이 너무
  좁아져서, 그 안의 검색창+검색 버튼 한 줄(`search-add-row`)이 카드 폭보다
  넓어져 버튼이 카드 테두리 밖으로 삐져나갔고, DOM상 뒤에 그려지는(그래서 겹칠
  때 위에 놓이는) 지도 칸의 카드가 그 자리를 덮어버려서 "검색" 버튼을 아예
  클릭할 수 없게 되는 문제였다(`test_food_map_kakao_regression.js`/
  `test_food_map_retry_and_layout.js`가 `#btnPlaceSearch` 클릭 타임아웃으로
  바로 잡아냈다). `.fm-search-col`이 `min-width:0`이라 flexbox가 필요한 만큼
  얼마든지 줄여버릴 수 있었던 게 근본 원인 — `min-width:300px`(검색창+버튼이
  한 줄에 들어갈 최소 폭)을 줘서 고쳤다.
- Playwright coverage for this batch lives in
  `test_food_map_retry_and_layout.js` (typo-retry notice text, exact-match
  no-notice case, exhausted-retries fallback message, IME-composing Enter
  ignored vs. a normal Enter after composition ends, and the 820px/1000px
  breakpoint behavior), `test_food_map_search_viewport.js` (distance-sort
  keyword passed to `keywordSearch`, only in-viewport results get pins while
  the full result list still shows everything, an off-screen result is still
  selectable from the list, search never calls `setBounds`, and — the
  zoom-out/zoom-in `idle` cases — a far-away result's pin appears once the
  fake viewport widens and `window.__fireKakaoIdle()` fires, disappears again
  once it narrows back, and never revives after the search itself is
  canceled), `test_food_map_pin_popup_actions.js` (an unsaved search pin opens
  the "add" popup and then inserts directly — no form — when its own "추가"
  button is clicked; a search pin that matches an existing spot's
  `kakao_place_url` opens that spot's popup instead; the owner's popup has a
  수정 button but no 제거 button and a stranger's popup has neither; the
  inline "별점 남기기" review form upserts with the right payload; and the
  list row's own "삭제" button still fires the delete call), the updated
  `test_food_map_features2.js` (search leaves `setBounds`'s call count
  unchanged; clicking a search pin opens the add popup and its "추가" button
  inserts directly rather than filling a form), `screenshot_food_map_card_v2.js`
  (category badge still renders, address line no longer does), and the
  flipped `test_food_map_adminonly_nav.js` (now asserts the tile/menu item are
  visible to non-admins too, with no "관리자만" badge) — alongside every
  previously-passing food-map test, all re-run clean after the widened-layout
  min-width fix above.
- **카테고리 11종으로 확장** (기존 한식/중식/일식/양식/카페·디저트/분식/기타 7종 →
  고깃집·구이🥩/아시안🍲/술집·요리주점🍻/패스트푸드·버거🍔 4종 추가) — 연남동/성산동
  일대는 쌀국수·이자카야·수제버거·고깃집처럼 기본 7종만으로는 못 담는 가게가 많다는
  사용자 요청. `category`가 free text라 스키마 변경은 필요 없고,
  `DEFAULT_CATEGORY_SUGGESTIONS`/`CATEGORY_EMOJI` 두 배열/객체만 수정 — 기존에
  저장된 7종 데이터는 그대로 유지된다. `mapKakaoCategory()`도 새 키워드(버거/
  패스트푸드/치킨, 쌀국수/베트남/태국/타이/아시안, 술집/요리주점/호프/이자카야/
  와인바/포차, 고깃집/구이/갈비/삼겹살)를 추가하면서 **검사 순서를 좁은 카테고리
  먼저**로 바꿨다 — 안 그러면 "버거"가 기존 양식 분기("버거" 키워드가 거기 있었음)에
  먼저 걸리고 "고기"가 한식 분기에 먼저 걸려서 새 카테고리가 영영 선택되지 못한다.
  중식(🍜)과 이모지가 겹치지 않도록 아시안은 🍲로 골랐다. `test_food_map_categories.js`
  로 datalist에 11종이 다 들어있는지, 카카오 검색 결과의 `category_name`이
  새 카테고리 4종 각각으로 정확히 매핑되는지 검증했다.
- **목록 카드 폭이 좁아질 때 상호명이 한 글자씩 세로로 쌓이는 버그 — 실제
  원인은 `.fm-list-col`의 폭이 아니라 `.spot-item-side`의 flex-shrink:0.**
  스크린샷으로 실제 제보된 버그("동베르데" 같은 이름이 카드 안에서 한 글자씩
  세로로 길게 늘어짐)를 디버그 스크립트(`getBoundingClientRect()`로 각 요소
  실제 치수를 찍어봄)로 추적했다 — 처음엔 `.fm-list-col{ min-width:0 }`이
  원인이라 보고 `min-width:260px`를 줬지만(이것도 실제로 필요한 보강이라
  남겨뒀다), 그것만으로는 안 고쳐졌다. 진짜 원인은 `.spot-item-side`(좋아요/
  별점/수정/삭제 버튼 묶음)가 `flex-shrink:0`이라 **카드 전체 폭보다 넓은
  최소 폭을 요구할 수 있다**는 것 — `.spot-item-main`(이름+설명)은
  `min-width:0`이라 끝없이 줄어들 수 있는데, side가 필요한 만큼 안 줄어드니
  flexbox가 그 부족분을 전부 main에서 가져가버려서 main이 결국 0px까지
  짓눌리고, `word-break:break-word`가 더 쪼갤 공간이 없어 한 글자씩 세로로
  줄바꿈하는 극단적인 모양이 나왔다. **고쳐서** `.spot-item`에
  `flex-wrap:wrap`을 주고 `.spot-item-main{ flex:1 1 160px; min-width:160px; }`
  로 최소 폭을 보장했다 — 공간이 부족하면 이제 side가 다음 줄로 통째로
  줄바꿈되고(카드가 한 줄 더 길어질 뿐), main은 항상 읽을 수 있는 최소 폭을
  유지한다. `.spot-item-side`에도 `max-width:100%`를 줘서, 줄바꿈된 side
  자신도 카드 폭을 넘어서지 않고 내부 버튼들이 자체적으로 `flex-wrap`되게
  했다(안 주면 side 혼자 둘째 줄에 있을 때도 카드 밖으로 삐져나갈 수 있었다).
  `debug_list_col_width2.js`로 1150px 폭에서 main이 더 이상 0px로 짓눌리지
  않고(184px 확보), side도 카드 폭 안에 들어오는지(184px, overflow 없음)
  직접 치수를 찍어 확인했다.
- **목록 카드를 다시 손봐 — 상호명은 한 줄 전체 폭을 쓰고(카테고리 뱃지와
  분리), 카테고리+설명은 그 아래 둘째 줄에 한 줄로, 세로 패딩은 더 줄임.**
  사용자가 실제 렌더링된 카드 스크린샷에 손으로 네모를 그려 "상호명과
  설명칸은 좀 너비 길게, 위아래 높이는 더 줄여달라"고 요청했다. 기존엔
  `.spot-item-title-wrap`가 상호명과 카테고리 뱃지를 같은 줄에 나란히
  두고(`display:flex; align-items:baseline`) 설명은 그 아래 별도 줄이었는데,
  상호명이 카테고리 뱃지만큼의 폭을 뺏기고 있었다. 이름(`.spot-item-title`)을
  그 묶음에서 빼내 단독으로 한 줄 전체를 쓰게 하고(`white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis`로 넘치면 말줄임), 카테고리 뱃지와
  설명을 새 `.spot-item-sub` 줄(`display:flex`)에 한 줄로 합쳤다 —
  `.spot-item-desc`도 이제 `flex:1; min-width:0`이라 카테고리 뱃지
  (`flex-shrink:0`)가 차지하고 남는 폭을 전부 설명 텍스트가 쓰고, 넘치면
  거기서 말줄임된다. 높이를 더 줄이기 위해 `.spot-item`의 세로 패딩을
  `14px`→`10px`로, 줄 사이 간격(`gap`)을 `6px`→`4px`로, `.spot-block`의
  카드 사이 여백을 `10px`→`8px`로 줄였고, 좋아요/별점 버튼(`padding:5px
  11px`→`4px 10px`, `font-size:12.5px`→`12px`)과 수정/삭제 버튼
  (`.spot-item-actions .btn.small{ font-size:11.5px; padding:5px 9px; }` —
  사이트 전역 `.btn.small`을 바꾸면 다른 페이지에도 영향이 가므로, 이 카드
  안에서만 더 작게 덮어씀)도 같이 줄였다. `.spot-item-main`의 최소 폭도
  `120px`→`160px`로 올려서 "상호명·설명칸 폭을 더 넓게"라는 요청에 맞게
  최소 확보 폭 자체를 키웠다.
- **카테고리 필터(한식 등)를 누르면 지도가 전국 단위로 멀리 줌아웃되던 버그
  — `fitFilteredBounds()`를 완전히 제거.** 등록된 맛집이 "강마을다람쥐
  팔당본점"처럼 학교에서 아주 먼 곳까지 퍼지면서, 카테고리를 고를 때마다
  그 카테고리에 맞는 핀 전체(멀리 있는 것 포함)가 다 보이도록 지도 범위를
  재조정하던 기존 동작이 "카테고리 하나 눌렀을 뿐인데 지도가 전국 지도로
  축소돼버린다"는 실제 버그로 이어졌다(사용자: "한식 카테고리를 누르니까
  이렇게 지도가 축소돼 버렸어. 축소 안 되게 해"). 이건 검색 결과에 대해 이미
  적용했던 "지도는 필터링/검색 때문에 임의로 움직이지 않는다" 원칙과
  똑같은 문제라, 카테고리 필터뿐 아니라 "내가 올린 곳만"/"좋아요한 곳만"
  토글까지 포함해 `fitFilteredBounds()` 호출 세 곳과 함수 정의 자체를
  전부 지웠다 — 이제 필터를 바꿔도 지도 중심/줌은 전혀 움직이지 않고
  마커만 보이거나 숨겨진다(`applyMarkerVisibility()`). 멀리 있는 필터링된
  맛집을 보려면 교사가 직접 지도를 줌아웃하거나 "🏫 학교 주변" 버튼으로
  기본 화면으로 돌아오면 된다. `test_food_map_features2.js`의 [B2]도 "지도
  범위가 재조정된다"는 옛 기대값을 "setBounds 호출 횟수가 전혀 바뀌지
  않는다"는 반대 방향 검증으로 고쳤다.
- **모바일에서 지도 세로 높이를 420px로 줄임.** `#foodMap`의 `1140px`
  높이는 넓은 화면에서 지도를 더 키우려던 값인데, 그 값을 그대로 휴대폰
  화면(이 페이지는 실제로 모바일에서 많이 보게 될 가능성이 높다는 사용자
  지적)에 적용하면 지도 하나가 화면 몇 개 분량을 차지해버려서 검색/목록까지
  스크롤이 지나치게 길어진다 — `@media (max-width: 820px)` 안에
  `#foodMap{ height:420px; }`를 추가해 모바일에서는 지도를 짧게 줄이고
  바로 아래 검색·추가 버튼, 목록까지 자연스럽게 스크롤되게 했다. 같은
  모바일 블록에 `.fm-search-col, .fm-list-col{ min-width:0; }`도 추가했다
  — 데스크톱 3단 레이아웃용으로 준 `min-width:300px`/`260px`가 1열로
  쌓인 모바일 레이아웃에서는 불필요하게 폭을 강제할 이유가 없다(이미 그
  미디어 쿼리에서 `max-width:none`으로 폭 제한도 풀어주고 있다).
- **지도 빈 곳(카카오 기본 지도에 그려진 가게 아이콘/라벨)을 클릭해도
  그 가게 정보 팝업이 바로 뜨고, 거기서 맛집 목록에 추가할 수 있다 —
  검색을 거칠 필요가 없다.** 사용자 요청: "여기서 가게를 누르면 가게
  정보가 뜨고, 거기서 맛집 목록에 추가하게도 해줘. 검색한 상태가 아니고
  지도에서 바로 클릭했을 때도 그 가게의 팝업이 나와야돼." 문제는 카카오맵
  JS SDK에 "정확히 어떤 가게(POI)를 클릭했는지" 알려주는 공식 이벤트가
  없다는 것 — `kakao.maps.event.addListener(map, 'click', ...)`은 클릭한
  좌표(`LatLng`)만 돌려주고, 그 좌표에 그려진 네이티브 지도 타일의 가게
  아이콘이 무엇인지는 알 수 없다(이미 문서화된 "카카오는 영업시간을 안
  준다"는 한계와 같은 종류의 제약). 대신 클릭한 좌표 근처(반경
  `NEARBY_CLICK_RADIUS = 60`미터 이내)를 `kakao.maps.services.Places().
  categorySearch()`로 음식점(`FD6`)·카페(`CE7`) 두 카테고리 각각 거리순
  조회해서, 둘 중 더 가까운 결과 하나를 "그 자리를 클릭했다"고 간주하는
  방식으로 흉내 냈다(`findNearestPlaceNear()`). 이 페이지가 다루는 11개
  카테고리(한식~패스트푸드·버거)가 카카오 분류상 전부 이 두 그룹 코드
  아래에 들어가 있어서 두 번이면 충분하다. categorySearch 결과는
  `keywordSearch`와 똑같은 `Place` 객체 모양(`place_name`/`place_url`/
  `category_name`/`x`/`y`/`road_address_name` 등)이라, 검색 결과 핀을
  클릭했을 때 이미 쓰던 `onSearchPinClick(place)`를 그대로 재사용했다 —
  이미 저장된 맛집과 같은 장소(`kakao_place_url` 일치)면 그 기존 팝업을,
  아니면 "맛집 목록에 추가" 즉시저장 팝업을 그대로 보여준다. "추가 모드"
  (`addMode`)일 때는 이 조회를 하지 않고 기존의 좌표 기반 추가 흐름이
  그대로 동작한다 — 둘은 `onMapClick()` 안에서 `addMode` 여부로 분기된다.
  60m 이내에 아무 가게도 없으면(두 카테고리 다 결과 없음) 조용히 아무
  일도 일어나지 않는다 — 추가하려면 여전히 "지도 클릭해서 추가" 모드를
  명시적으로 켜야 한다. 비동기 조회 도중 다른 클릭이 또 들어올 수 있어서
  `nearbyClickToken` 카운터로 가장 최근 클릭의 결과만 반영하고 먼저
  시작된(느린) 조회의 응답은 버린다. `kakao_stub.js`에 `categorySearch`
  스텁(`window.__fakeCategoryResults = {FD6:[...], CE7:[...]}`,
  `window.__lastCategorySearchCalls`로 어떤 코드·옵션으로 호출됐는지
  기록)을 추가했고, `test_food_map_nearby_poi_click.js`로 (1) 음식점·카페
  둘 다 반경 60m·거리순으로 조회하는지, (2) 둘 중 더 가까운 쪽 팝업이
  뜨는지, (3) 이미 저장된 장소면 기존 팝업을 보여주는지, (4) 근처에
  아무것도 없으면 아무 일도 안 일어나는지, (5) 추가 모드에서는 이 조회
  자체를 안 하고 기존 흐름이 그대로인지 — 다섯 가지를 모두 검증했다.
- **지도 기본값을 다시 "등록된 맛집 전체를 핀으로 보여주기"로 바꾸고, 카테고리/
  목록 필터를 선택하면 그 필터에 해당하는 핀들 쪽으로 지도가 이동하게 했다 —
  단, 아주 먼 핀 하나 때문에 전국 단위로 줌아웃되지는 않도록 상한을 뒀다.**
  바로 위 "카테고리 필터를 누르면 지도가 전국 단위로 멀리 줌아웃되던 버그 —
  fitFilteredBounds()를 완전히 제거" 항목에서 이 동작 자체를 없앴었는데, 사용자가
  다시 "등록된 맛집 목록 지도에 핀으로 보여주는 걸 기본값으로 해줘. 그리고
  카테고리나 목록을 선택하면 그 위치로 지도 이동해서 그 가게만 보여주고"라고
  요청해서 **되살리되, 이번엔 그때 겪은 "전국 단위 줌아웃" 버그가 재현되지
  않도록 상한을 추가**했다 — 둘은 모순이 아니라, "핀을 다 보여주는 범위 맞춤
  자체"가 문제가 아니라 "그 범위 맞춤에 상한이 없어서 outlier 핀 하나가 전체
  뷰를 전국 단위로 끌고 가버리는 것"이 진짜 문제였다는 걸 이번에 명확히 했다.
  - `DEFAULT_MAP_LEVEL`(기본값 3 → "지도 첫페이지 조금 축소해줘" → 4 →
    "지도 조금 더 축소" follow-up으로 다시 5까지 올림 — 숫자가 클수록 더
    축소돼 보임) 상수로 뽑아서, 지도 생성/"📍 내 위치로"/"🏫 학교 주변"/
    가게 하나 포커스(검색 결과 선택, 목록 클릭)에 쓰던 리터럴 `3`을 전부
    이걸로 통일했다.
  - `FILTERED_BOUNDS_MAX_LEVEL = 8` — 카테고리·내가 올린 곳만·좋아요한 곳만
    필터에 맞는 핀들로 지도 범위를 맞출 때, 결과 레벨이 이보다 더 축소되지는
    않도록 깎는 상한. "한식 카테고리를 눌렀더니 강마을다람쥐 팔당본점처럼
    아주 먼 핀 때문에 지도가 전국으로 줌아웃됐다"는 바로 그 재현 시나리오를
    다시 테스트로 만들어(`test_food_map_default_bounds_and_cap.js`) 레벨이
    8을 넘지 않는지 확인했다.
  - `fitBoundsToSpots(list, {maxLevel})` — 좌표 있는 항목이 **정확히 1개**면
    `setBounds` 대신 `setCenter`+`setLevel(DEFAULT_MAP_LEVEL)`로 그 가게 하나에
    바로 포커스하고(이미 있던 "가게 하나 클릭 시 포커스" 동작과 결과가
    같아짐), 2개 이상이면 `kakao.maps.LatLngBounds`로 전부 담아
    `map.setBounds(bounds, 48,48,48,48)`(상하좌우 패딩 48px — 핀이 화면
    가장자리에 딱 붙지 않고 여유 있게 보이도록, "조금 축소"의 또 다른 축)를
    호출한 뒤, `maxLevel`이 주어졌고 결과 레벨이 그보다 크면(더 축소됐으면)
    `setLevel(maxLevel)`로 깎는다. **처음 구현할 때 이 비교 방향을
    거꾸로(`getLevel() < maxLevel`일 때 올리는 식) 써서, 상한이 오히려
    "항상 최소 그만큼은 축소시키는" 반대 로직이 돼버린 버그가 있었다** —
    카카오 레벨 스케일은 숫자가 클수록 더 축소된 상태라는 걸 헷갈려서 생긴
    실수였고, 바로 코드를 다시 읽다가 발견해 `getLevel() > maxLevel`로
    고쳤다(테스트를 작성하기 전에 스스로 잡아낸 버그라 별도 incident는 아니지만,
    카카오 레벨 방향을 또 헷갈릴 수 있어 적어둔다).
  - `loadSpots()`가 저장/삭제 후에도 다시 호출되는 함수라, 매번 전체 범위를
    다시 맞추면 교사가 보고 있던 화면이 자꾸 바뀌어버린다 — `initialBoundsFitted`
    불리언으로 **최초 로드 때 딱 한 번만** `fitBoundsToSpots(spots, ...)`를
    호출하게 막아뒀다. (최초엔 "등록된 전체"를 보여주는 게 목적이라 상한 없이
    호출했었는데, 바로 아래 항목에서 그것도 결국 상한을 걸게 됐다 — 이
    문단은 "한 번만 맞춘다"는 `initialBoundsFitted` 자체의 목적만 남기고 상한
    유무는 아래 항목이 최신값이다.)
  - **후속 버그: 최초 로드 쪽은 상한을 안 걸어뒀더니, 등록된 맛집 중 하나가
    멀리 떨어져 있으면(예: 팔당 쪽 식당) 첫 화면부터 전국 지도로 줌아웃된
    채로 열리는 문제가 재현됐다** — 사용자가 스크린샷으로 "또 첫페이지가
    전체 줌으로 나와"라고 재보고. 카테고리 필터 쪽엔 이미
    `FILTERED_BOUNDS_MAX_LEVEL` 상한을 걸어놨으면서, 최초 로드 쪽만 "전체를
    보여주는 게 목적"이라는 이유로 상한을 빼놓은 게 원인 — 그 "전체를 보여주는
    목적"보다 "첫 화면은 학교 주변이어야 한다"는 더 기본적인 기대가 우선이라고
    판단해, `loadSpots()`의 최초 호출도 `fitBoundsToSpots(spots, {maxLevel:
    FILTERED_BOUNDS_MAX_LEVEL})`로 똑같이 상한을 걸도록 고쳤다 — 화면 밖의 먼
    맛집은 교사가 직접 줌아웃하면 보인다.
    `test_food_map_default_bounds_and_cap.js`에 `[A3]`(최초 로드 레벨이 상한
    이하인지)를 추가해 이 회귀를 다시 테스트로 잡아뒀다.
  - 카테고리 pill 클릭, "내가 올린 곳만"/"좋아요한 곳만" 토글 세 핸들러 모두
    기존 필터링 로직(`applyMarkerVisibility()` 등) 뒤에
    `fitFilteredBoundsCapped()`(= `fitBoundsToSpots(filteredSpots(), {maxLevel:
    FILTERED_BOUNDS_MAX_LEVEL})`) 호출을 추가했다 — 필터를 전부 끄면
    `filteredSpots()`가 전체 목록을 돌려주므로, 그 경우 자연스럽게 "등록된
    맛집 전체 보기"로 돌아간다(별도 분기 불필요). 목록(개별 가게 카드) 클릭은
    이미 `map.setCenter()`/`setLevel(DEFAULT_MAP_LEVEL)`로 그 가게 하나에
    포커스하고 있었어서 손댈 필요가 없었다 — "카테고리나 목록을 선택하면...
    그 가게만 보여주고" 요청의 "목록" 쪽은 이미 충족돼 있었던 셈이다.
  - `kakao_stub.js`(테스트 스텁)에 `getLevel()`이 아예 없어서(기존엔 `setLevel`만
    있었다) 이 기능을 테스트하다가 바로 드러났다 — 추가하면서 `setBounds`도
    그냥 좌표를 기록만 하던 것에서, 넘어온 포인트들의 위경도 폭(거친 근사치)에
    비례해 `_level`을 실제로 변화시키도록 바꿨다(포인트가 멀리 퍼질수록 더 큰
    레벨) — 실제 SDK의 정확한 확대/축소 공식을 흉내낼 필요는 없고, "먼 핀이
    섞이면 레벨이 커진다"는 상대적 경향만 있으면 상한 로직을 테스트할 수
    있어서 이 정도로 충분했다. `window.__lastSetBoundsPadding`도 같이
    기록하게 해서 패딩이 실제로 전달되는지도 검증할 수 있게 했다.
  - `test_food_map_features2.js`의 [B2]/[B4]/[E1]도 새 동작에 맞게 다시
    고쳤다 — [B2]는 "setBounds가 호출 안 됨"에서 "한식 2곳으로 범위가
    이동함(count===2)"으로, [B4]는 필터 해제 시 다시 전체(3곳)로 돌아가는지
    확인하는 항목을 새로 추가, [E1]은 "학교 주변" 버튼 클릭 후 기대 레벨을
    3→5로 갱신했다. 새 `test_food_map_default_bounds_and_cap.js`가 이
    섹션에서 설명한 세 가지(최초 전체 범위 맞춤+패딩, 상한이 실제로 먼 핀을
    깎아내는지, 매칭 1개일 땐 setBounds를 안 쓰고 바로 포커스하는지)를
    전담해서 검증한다.
- **목록 카드를 클릭해도 주소/작성자가 "확장"되지 않는 것처럼 보이던 버그 —
  실제로는 지도 핀 팝업(togglePopup)이 정상적으로 뜨고 있었지만, 지도가 화면
  밖(모바일에서는 목록보다 위쪽, 혹은 데스크톱에서도 스크롤 밖)에 있으면 그
  변화가 교사 눈에 안 띄어서 "눌러도 반응이 없다"로 보였다.** 클릭 핸들러
  (`el('spotList').querySelectorAll('.spot-item').forEach(...)`)와
  `popupHtml()`/`buildPopupContent()` 둘 다 코드 자체는 멀쩡했고(Playwright로
  직접 클릭해 팝업 DOM에 주소/작성자/날짜가 실제로 들어있는지 확인함) — 문제는
  "팝업이 지도 위에만 뜬다"는 UX 설계 자체가 지도 상태(스크롤 위치, 접혀있는
  좁은 화면 레이아웃)에 기대고 있었다는 것. **고쳐서** 지도 포커스+팝업 동작은
  그대로 둔 채, 카드 자체도 클릭 시 아코디언으로 펼쳐져(`.spot-block.open
  .spot-item-details{ display:block; }`) 주소/작성자·날짜/카카오맵 링크를
  지도 상태와 무관하게 바로 보여주도록 추가했다 — `renderList()`의 각
  `.spot-block`에 `.spot-item-details`(처음엔 `display:none`) 블록을 넣고,
  `.spot-item` 클릭 핸들러 맨 앞에서 `row.closest('.spot-block').classList
  .toggle('open')`을 한 줄 추가했을 뿐, 기존 `map.setCenter()`/
  `setLevel()`/`togglePopup()` 호출은 전혀 건드리지 않았다(지도 팝업도 여전히
  함께 뜬다 — 둘은 서로 배타적이지 않은 별개의 UI). `.spot-item-details` 안의
  `<a>`(카카오맵 링크)는 `onclick="event.stopPropagation()"`으로 클릭 시
  아코디언이 다시 접히지 않게 했다(기존 `.spot-item` 핸들러의 `e.target
  .closest('a')` 체크와 같은 이유). 이전에 쓰이지 않고 남아있던
  `.spot-item-addr`/`.spot-item-meta` CSS(카드 재설계 전 레이아웃의 잔재)는
  그대로 두고, 이번엔 새 `.spot-item-details`/`.sid-row` 클래스로 스타일을
  새로 짰다 — 이름이 겹치는 걸 피하고, 이 블록이 `.spot-item-side`와 무관하게
  카드 전체 폭을 쓰는 레이아웃이라 기존 클래스를 재사용하기보다 새로 만드는 게
  더 명확했다. `test_food_map_card_expand.js`로 (1) 처음엔 접혀있음, (2) 클릭
  시 펼쳐지고 주소/작성자/카카오맵 링크가 다 보임, (3) 다시 클릭하면 접힘
  (토글), (4) 주소/카카오링크가 없는 맛집도 에러 없이 작성자만 정상 렌더,
  (5) 지도 팝업도 기존처럼 함께 뜸(회귀 없음) — 다섯 가지를 검증했다.
- **최초 로드/새로고침 기본 화면을 "등록된 맛집 전체로 범위 맞춤"에서 완전히
  손 떼고, 다시 "🏫 학교 주변" 버튼과 100% 동일한 고정값으로 되돌렸다 — 지도도
  한 단계 더 확대(레벨 5 → 3, 카카오맵 축척 표시 기준 "50m" 줄에 해당).**
  바로 위 두 항목("지도 기본값을 다시... 등록된 맛집 목록 지도에 핀으로
  보여주는 걸 기본값으로...", 그 직후의 "후속 버그")에서 상한을 걸어가며
  시도했던 "최초 로드도 전체 핀에 맞춰 범위를 잡되 너무 멀리 줌아웃은 안 되게"
  라는 절충안 자체가, 또 다른 먼 맛집(스크린샷 기준 동두천/포천/인천/수원까지
  보일 정도로 줌아웃된 전국 지도)이 등록되면서 다시 깨졌다 — 상한(8)을 걸어도
  "학교 주변" 기본 화면과는 다른, 줌아웃된 화면이 뜰 수 있다는 근본적인 문제가
  남아있었던 것. 사용자가 "기본 화면과 새로고침 시 화면은 '학교 주변'을
  클릭했을 때 나오는 것과 같게... 지도는 조금 확대해야겠어. 50미터 축척
  정도로"라고 명확히 정리해줘서, 이번엔 절충(상한 걸고 범위 맞춤)이 아니라
  **최초 로드에서 범위 맞춤 자체를 아예 하지 않는 쪽으로 되돌렸다** — 등록된
  맛집이 몇 개든, 얼마나 멀리 퍼져 있든 최초 화면/새로고침은 항상
  `SCHOOL_LATLNG`+`DEFAULT_MAP_LEVEL`(지도 생성 시 이미 쓰던 바로 그 고정값,
  "학교 주변" 버튼이 되돌아가는 값과 완전히 동일)로 고정된다.
  - `loadSpots()`에서 `initialBoundsFitted` 플래그와 그 아래의
    `fitBoundsToSpots(spots, {...})` 호출을 통째로 제거했다 — 이제 `loadSpots()`
    는 목록/마커만 다시 그릴 뿐 지도 범위에는 전혀 손대지 않는다. 카테고리/
    내가 올린 곳만/좋아요한 곳만 필터를 고를 때 쓰는 `fitFilteredBoundsCapped()`
    (→ `fitBoundsToSpots(filteredSpots(), {maxLevel: FILTERED_BOUNDS_MAX_LEVEL})`)
    는 그대로 남아있다 — "카테고리나 목록을 선택하면 그 가게들로 지도 이동"
    요청은 이번 되돌리기 대상이 아니었고, 그 기능 자체는 상한 덕분에 문제없이
    잘 동작하고 있었다.
  - `DEFAULT_MAP_LEVEL`을 5 → 3으로 다시 낮췄다(숫자가 작을수록 더 확대돼
    보인다) — 카카오맵 자체 축척 표시 기준으로 대략 레벨 1=20m, 2=30m,
    **3=50m**, 4=100m, 5=250m 순으로 커지므로, "50미터 축척 정도로"라는
    요청을 레벨 3으로 매핑했다. 지도 생성/"📍 내 위치로"/"🏫 학교 주변"/
    가게 하나 포커스(검색 결과 선택, 목록 클릭)가 전부 이 상수 하나를 공유하는
    기존 구조 그대로라, 상수값만 바꿔도 다섯 곳 전부 일관되게 적용됐다.
  - `test_food_map_default_bounds_and_cap.js`의 `[A]` 섹션을 완전히 새로
    고쳤다 — 기존엔 "최초 로드 시 등록된 맛집 전체(3곳)로 범위가 맞춰짐"을
    검증했는데, 이제 그 반대(**"최초 로드 시 `setBounds`가 전혀 호출되지
    않고, 중심/레벨이 `SCHOOL_LATLNG`/`DEFAULT_MAP_LEVEL`과 정확히 일치"**)를
    검증하도록 뒤집었다 — s3(팔당, 아주 멀리)가 등록 맛집에 섞여 있는 그대로
    둬도(일부러 지우지 않음) 최초 화면이 흔들리지 않는지가 핵심이라서다.
    `[C1]`(매칭 1개일 때 포커스)과 `test_food_map_features2.js`의 `[E1]`
    (학교 주변 버튼)의 기대 레벨도 5→3으로 갱신했다.
- **지도 위 "이미 등록된 맛집"의 상호명을 클릭하면 근처 다른 가게가 대신 뜨는 것처럼
  보이던 버그 — 실제로는 등록된 맛집이지만 지도 클릭으로(카카오 검색 없이) 추가된
  경우라 `kakao_place_url`이 `null`이었던 게 원인.** 사용자가 스크린샷으로 "메가MGC커피
  연남하늘채점"을 클릭했는데 이미 등록된 그 가게 정보 대신 "맛집 목록에 추가" 팝업이
  뜨는 걸 보고했다. 지도 빈 곳 클릭 시 근처 가게를 찾는 `findNearestPlaceNear()`(바로
  위 "지도 빈 곳을 클릭해도... 가게 정보가 뜨고" 항목 참고)는 `categorySearch` 결과를
  기존 `findSpotByPlaceUrl()`로만 매칭했는데, 이 함수는 `kakao_place_url`이 일치하는
  것만 찾는다 — 그런데 **지도를 직접 클릭해서 추가된 맛집은 애초에 카카오 place_url이
  없다(`kakao_place_url: null`)**, 그 가게를 나중에 카카오의 근처 조회로 다시 찾으면
  그때는 카카오가 진짜 `place_url`을 돌려주므로 등록 당시 저장된 `null`과 절대 일치하지
  않는다. **고쳐서** `findExistingSpotForPlace(place)`를 새로 추가했다 —
  `findSpotByPlaceUrl(place.place_url)`로 먼저 찾고, 못 찾으면 상호명 완전 일치
  (`spots.find(s => s.name === place.place_name.trim())`)로 한 번 더 찾는다.
  `onSearchPinClick(place)`(검색 결과 핀 클릭과 근처-클릭 양쪽이 공유하는 하나의
  진입점)의 기존 매칭 호출을 이 새 함수로 교체한 것만으로 양쪽 경로 다 고쳐졌다 — 검색
  결과로 찾은 가게는 `place_url` 매칭이 그대로 먼저 걸리고, 지도 클릭으로 등록된 가게는
  이름 매칭으로 걸린다. `test_food_map_name_fallback_match.js`로 (등록된 가게와
  이름은 같지만 `place_url`은 다른 근처 검색 결과를 흉내 내어) 이름 매칭 경로가 실제로
  기존 팝업(주소 등 저장된 정보 포함)을 띄우는지 확인했다.
- **카테고리별 이모지 아이콘 제거 — 지도 마커/목록 카드 둘 다 텍스트만.** "아이콘이 눈에
  잘 안 들어온다"는 피드백으로, `CATEGORY_EMOJI` 매핑과 `emojiFor()` 헬퍼를 통째로
  삭제했다. 대신 지도 마커(`makeOverlayEl`)는 이모지 없는 동일한 모양의 점 핀 +
  "**상호명 · 카테고리**" 텍스트 라벨(카테고리가 있으면 `·`로 이어붙이고, 없으면
  상호명만)로 바꿔서, 이모지 없이도 지도에서 바로 어떤 종류의 가게인지 보이게 했다 —
  "지도에도 라벨처럼 표시"라는 요청대로다. 카테고리 필터 pill(`renderCategoryPills`),
  팝업의 카테고리 줄(`popupHtml`), 목록 카드의 카테고리 배지(`renderList`) 세 곳 모두
  이모지 접두사를 뺀 순수 텍스트로 바꿨다. **아직 저장되지 않은 카카오 검색 결과 핀**
  (`makeSearchMarkerEl` — 번호 배지 + 상호명만, 카테고리 없음)은 이 변경과 무관해서
  그대로 뒀다 — 저장 전엔 카테고리가 아직 사용자가 고르기 전(추정값일 뿐)이라 마커
  라벨에 넣을 확정된 카테고리가 없다. 이 라벨 형식 변경으로 기존 Playwright 테스트
  몇 개가 "상호명만"으로 정확히 일치하는 마커를 찾던 게 깨졌다 —
  `test_food_map_features2.js`([B1])와 `test_food_map_pin_popup_actions.js`([C]/[D],
  등록된 내 가게/남의 가게 마커를 직접 클릭하는 부분)를 `"<상호명> · "` 접두 매치로
  고쳤다 — 카테고리 값이 바뀌어도 테스트가 깨지지 않도록.
- **카테고리 필터 pill을 지도 바로 위로 옮겼다 — 목록은 그대로 지도 오른쪽
  (`.fm-list-col`)에 남아있다.** "맛집 필터 버튼은 지도 바로 위에 표시해주자. 목록은
  지도 오른쪽에 나오더라도. 모바일에서도 그게 편할거 같아"라는 요청대로, `#categoryPills`
  엘리먼트를 `.fm-list-col` 카드(검색·정렬 토글바 아래)에서 `.fm-map-col` 카드의
  "지도" 제목/버튼 줄 바로 다음, `#foodMap` 바로 위로 옮겼다 — HTML 위치만 바뀐
  것이고 `renderCategoryPills()`/`filteredSpots()`/`applyMarkerVisibility()` 등
  필터링 로직은 전혀 손대지 않았다(그 함수들은 `#categoryPills`를 `el()`로 찾아
  쓸 뿐, DOM 트리 상 어디에 있는지는 신경 쓰지 않는다). 모바일 폭(`@media
  (max-width:820px)`)에서는 `.fm-layout`이 `flex-direction:column`으로 접히는데,
  소스 순서가 `fm-search-col → fm-map-col → fm-list-col`이라 지도(그리고 그 바로
  위 필터 pill)가 이미 검색 칸 다음, 목록 칸보다 먼저 오므로 추가 미디어쿼리 조정
  없이도 "모바일에서도 편하게" 요청이 그대로 충족된다. 내가 올린 곳만/좋아요한 곳만
  토글(`#toggleMyOnly`/`#toggleLikedOnly`)과 검색·정렬 입력은 "맛집 필터 버튼"이
  가리키는 핵심 대상이 아니라고 보고 `.fm-list-col`에 그대로 뒀다 — 카테고리 pill만
  유일하게 눈에 보이는 버튼 형태의 필터라 이동 대상으로 좁혔다.
- **지도 위 등록된 맛집 핀(이름)을 클릭하면 팝업이 잠깐 보였다가 바로 사라지는 버그 —
  `e.stopPropagation()`만으로는 카카오 지도 자신의 `click` 이벤트까지 막지 못해서
  생긴 문제였다.** `makeOverlayEl`/`makeSearchMarkerEl`(마커)과 `buildPopupContent`/
  `buildSearchAddPopupContent`(팝업) 안의 DOM 클릭 핸들러들은 전부 평범한
  `e.stopPropagation()`만 걸어뒀는데, 카카오맵 JS SDK는 `kakao.maps.event
  .addListener(map, 'click', onMapClick)`로 등록한 지도 자신의 click을 **DOM 버블링과
  무관하게 내부적으로 별도 추적**한다 — CustomOverlay 콘텐츠를 클릭해도 그 click이
  지도 자신의 click으로도 똑같이 전달된다는 뜻이다. 그 결과: 마커를 클릭하면 (1) 마커
  자신의 핸들러가 동기적으로 `togglePopup(s.id)`를 호출해 팝업이 뜨고, (2) 거의 동시에
  같은 클릭이 지도의 `onMapClick()`도 실행시켜 "근처 가게 찾기"(`findNearbyPlaceAndShowPopup`
  → `categorySearch`, 비동기)가 돌고, 그 결과가 조금 뒤 돌아오면 같은 스팟을 찾아
  `onSearchPinClick()` → `togglePopup(existing.id)`를 **다시** 호출한다.
  `togglePopup()`은 `if(openPopupSpotId === spotId){ closePopup(); return; }`로 이미
  열려 있는 같은 스팟을 또 호출하면 **토글-닫음**으로 처리하므로, 방금 뜬 팝업이 비동기
  콜백이 돌아오는 그 짧은 순간 뒤에 스스로 닫혀버린 것처럼 보였다 — "잠깐 보였다가
  바로 사라진다"는 증상 그대로다. **고쳐서** 카카오 SDK가 공식으로 제공하는
  `kakao.maps.event.preventMap(e)`를 호출하는 공용 헬퍼 `stopMapClick(e)`
  (`e.stopPropagation()` + `preventMap(e)`)를 새로 만들어, 마커 두 종류의 클릭
  핸들러와 두 팝업 컨텐츠 루트(각각 `content.addEventListener('click', stopMapClick)`
  한 번으로 안의 모든 버튼에 적용됨 — 좋아요/별점/수정 버튼 하나하나에 따로 걸 필요
  없음)에 적용했다. 이 버그는 `kakao_stub.js`(테스트용 스텁)가 실제 SDK처럼 "마커
  클릭이 지도 자신의 click도 자동으로 발생시키는" 동작을 전혀 흉내내지 않았기 때문에
  (테스트는 `window.__kakaoMapClickHandler(...)`를 직접 호출해서 그 경로를 수동으로
  흉내낼 뿐이었다) 기존 테스트 어디에서도 걸리지 않았던 사각지대였다 —
  `kakao.maps.event.preventMap`을 스텁에도 추가하고(호출 횟수만 기록, 실제 차단은
  흉내내지 않음) `test_food_map_popup_preventmap.js`로 마커/팝업 클릭이 실제로 그
  공식 API를 호출하는지, 클릭 직후에도 팝업이 계속 보이는지 확인했다.
- **모바일에서 지도 핀치줌/터치 드래그가 전혀 안 먹히는 문제 — `#foodMap`에
  `touch-action:none`을 추가했다.** 사용자가 재현 상황을 "모바일: 핀치줌/터치
  드래그가 안 먹힘"(데스크톱 마우스 휠/드래그는 정상)으로 구체화해줘서 범위를
  좁혔다. `touch-action`의 기본값은 `auto`인데, 이 지도는(전체화면 분리형이 아니라)
  평범하게 세로 스크롤되는 페이지 한가운데 박혀있는 영역이라, 모바일 브라우저가
  지도 위 터치를 "페이지를 스크롤하려는 제스처"로 먼저 해석해버리고 카카오맵 SDK
  자신의 터치 팬/핀치줌 처리와 경쟁하다가 질 수 있다 — 핀치줌/드래그가 전혀 안
  먹히는 것처럼 보이는 증상과 정확히 들어맞는다. `#foodMap`에 `touch-action:none`을
  명시해서 그 지도 영역 안의 모든 제스처 해석을 카카오 SDK에게 전적으로 맡겼다.
  **이 수정은 이 샌드박스 환경에서 실기기로 검증하지 못했다** — 이 환경은
  `dapi.kakao.com`으로 나가는 아웃바운드 네트워크가 막혀 있어(`curl`로 직접 확인:
  프록시가 CONNECT 터널을 403으로 거부함) 실제 카카오맵 SDK를 띄워 모바일 터치
  동작을 재현/검증할 수 없었고, 기존 Playwright 테스트들은 전부 `kakao_stub.js`(최소
  동작 스텁)를 쓰는데 그 스텁은 터치 제스처나 `touch-action` CSS의 실제 영향을
  전혀 흉내내지 않는다(마우스 클릭 기반 동작만 재현). 정적 코드 검토로는 지도
  생성 코드에 draggable/zoomable을 끄는 옵션이 없고, food-map.html 자신이나
  공용 스크립트 어디에도 wheel/touch 이벤트를 가로채는 코드·`touch-action`을
  제한하는 CSS가 전혀 없었다 — `touch-action:none`은 이 증상(페이지 스크롤과
  지도 제스처의 경쟁)에 대한 잘 알려진 표준 대응이라 적용했지만, 실제 효과는
  사용자가 모바일 기기에서 직접 확인해줘야 한다.
- **후속 버그: "모바일에서 데스크탑 버전으로" 맛집 지도를 보면 확대·스크롤이
  전혀 안 됨 — 바로 위 `touch-action:none` 수정이 모든 화면 폭에 똑같이
  적용돼 있었던 게 원인.** 모바일 브라우저의 "데스크탑 사이트로 보기"는
  `<meta name="viewport">`의 `width=device-width`를 무시하고 레이아웃
  뷰포트를 고정폭(보통 980~1038px)으로 강제한다 — 이 페이지의 `.fm-layout`
  3단 구성이 접히는 기준은 `@media (max-width:820px)`라서, 그보다 넓은 이
  뷰포트에서는 데스크탑용 레이아웃이 그대로 적용되고 `#foodMap`도 그
  데스크탑 전용 높이(1140px)로 렌더링된다. 문제는 **이 경우 실제 물리
  화면보다 페이지(레이아웃 뷰포트) 자체가 더 넓어서, 사용자가 핀치줌·스크롤로
  "지도가 아니라 페이지 전체"를 움직여 보려는 것**인데, `touch-action:none`이
  폭과 무관하게 `#foodMap`에 항상 걸려 있었던 탓에 화면 대부분을 차지하는
  그 지도 영역에서 시작하는 모든 핀치줌/스크롤을 브라우저가 전혀 처리하지
  않고 카카오 SDK에게 그대로 넘겨버렸다 — 원래 이 속성이 풀려던 "지도
  제스처 vs 페이지 스크롤 경쟁"과는 정반대로, 이번엔 사용자가 원하는 그
  "페이지 전체 줌/스크롤" 자체를 막는 결과가 됐다. **고쳐서**
  `touch-action:none`을 `#foodMap`의 기본(데스크탑) 규칙에서 빼고,
  `@media (max-width:820px)`(지도가 420px로 줄어 한 화면에 알맞게 들어가는
  진짜 모바일 1열 레이아웃) 블록 안으로만 옮겼다 — 그 폭에서는 페이지 자체가
  화면보다 넓지 않으니 지도 터치를 전부 SDK에 맡겨도 페이지 줌/스크롤과
  충돌하지 않는다. 데스크탑 버전으로 보는 경우(또는 실제 데스크탑)는
  이제 지도 위에서도 평범한 브라우저 핀치줌/스크롤이 그대로 동작하고,
  지도 자체의 팬/줌은 카카오 SDK의 마우스 드래그/휠 처리(터치와 무관)로
  계속 가능하다. 바로 위 항목과 마찬가지로 이 수정도 이 샌드박스에서
  실기기로 검증하지 못했다(`dapi.kakao.com` 아웃바운드 차단, `kakao_stub.js`가
  터치 제스처를 흉내내지 않음) — 데스크탑 버전 보기에서 핀치줌/스크롤이
  정상 동작하는지, 그리고 진짜 모바일 레이아웃에서 지도 자체의 터치 팬/줌이
  여전히 잘 되는지(회귀 없음) 둘 다 사용자가 실기기에서 직접 확인해줘야 한다.
- **마커 라벨 형식을 "카테고리 - 이름"(카테고리는 작고 음영 있는 칩)으로 바꾸고,
  좌표 앵커(anchor) 버그를 고쳤다 — "지도의 파란 점이 엉뚱한 곳을 가리키고, 이름을
  눌러도 반응이 없다"는 실제 버그였다.** 사용자 보고: "맛집 지도에 제목 라벨 형식으로
  지도에 표시되는데 라벨 - 이름 형식으로 표시되게... 파란점이 있는데 엉뚱한 곳을
  가리키고 있어. 그래서 지도상 이름을 클릭하면 정보가 안 나오고 실제로는 실제 가게가
  있는 위치를 클릭해야 가게 정보가 나와." 근본 원인은 `makeOverlayEl()`이 점(핀)과
  라벨을 한 줄짜리 flex row(`[점][라벨]`)로 묶어 그 wrap 전체를 `CustomOverlay`의
  content로 넘기면서 `yAnchor:1`만 주고 `xAnchor`는 기본값(0.5)에 맡겨뒀던 것 — 카카오맵은
  xAnchor를 "content 전체의 가로폭 중앙"으로 계산하므로, 실제 좌표는 맨 왼쪽의 점이
  아니라 점+라벨을 합친 너비의 한가운데에 찍혔다. 이름이 길수록 그 중앙이 점에서 더
  멀어지고, 점은 실제 가게 위치에서 그만큼 벗어나 보였다(이름을 눌러도 반응이 없던
  것도 같은 원인 — 눈에 보이는 점/라벨의 위치와 실제 클릭 가능한 좌표 앵커가 서로
  어긋나 있었다). 게다가 content에 수동으로 걸어둔 `transform:translateY(-50%)`가
  `yAnchor:1`의 자체 보정과 또 겹쳐 세로로도 어긋나 있었다.
  - **고쳐서** `makeOverlayEl()`의 wrap(`.fm-marker-wrap`)을 점과 정확히 같은 크기
    (17×17px, 테두리 포함)로 고정하고, 점(`.fm-marker-pin`)은 그 안을 꽉 채우는
    절대위치 요소로 뒀다 — `xAnchor:0.5, yAnchor:0.5`를 주면 wrap의 가로·세로 중앙
    (=점의 중앙)이 항상 정확히 좌표에 맞춰진다(수동 `transform`은 완전히 제거).
    라벨(`.fm-marker-label`)은 그 wrap을 기준으로 오른쪽에 떠 있는 절대위치 형제
    요소라, 이름이 아무리 길어도 wrap 자신의 측정 크기(앵커 계산의 기준)에는 전혀
    영향을 주지 않는다 — 점의 좌표는 항상 정확하다. 점을 클릭해도 이름을 클릭해도
    같은 wrap의 자식이라 둘 다 동일한 `onClick`(버블링)이 걸린다. 저장된 맛집 핀
    (`renderMarkers()`)과 add-모드의 임시 핀(검색 결과 선택 직후, 지도 직접 클릭
    직후) 세 호출부 전부 `yAnchor:1` → `xAnchor:0.5, yAnchor:0.5`로 맞췄다 — 아직
    저장 전 카카오 검색 결과 핀(`makeSearchMarkerEl`, 번호 배지)은 이 변경과 무관해서
    손대지 않았다(이번 보고는 "목록에 이미 등록된 맛집" 핀에 대한 것이었다).
  - **라벨 형식도 함께 바꿨다** — "이름 · 카테고리"(한 줄 텍스트)에서 "카테고리(칩) +
    이름" 두 개의 별도 `<span>`(`.fm-marker-cat`/`.fm-marker-name`)으로: 카테고리는
    목록 카드의 `.spot-item-cat`과 똑같은 스타일(10px, `var(--stamp-soft)` 배경 +
    `var(--stamp)` 글자색의 작은 알약 칩 — "목록에는 그렇게 나오고 있는거 같아"라는
    사용자 관찰 그대로 맞췄다)로, 이름은 그보다 크고(11.5px) 진하게(`font-weight:700`)
    둬서 "이게 라벨이고 이게 진짜 이름이구나"가 글자 크기·음영만으로 한눈에 구분된다.
  - `test_food_map_marker_anchor.js`(새 테스트)로 (1) wrap이 렌더링되는지,
    (2) 라벨이 카테고리/이름 두 span으로 정확히 분리되고 카테고리 글자가 더 작으며
    음영 배경이 있는지, (3) 점을 클릭해도 이름을 클릭해도 똑같이 팝업이 뜨는지
    검증했다. 이 변경으로 마커 라벨 텍스트를 "이름 · 카테고리" 한 줄 문자열로 찾던
    기존 테스트 2개(`test_food_map_features2.js`의 [B1], `test_food_map_pin_popup_
    actions.js`의 [C]/[D] 등록 핀 클릭, `test_food_map_popup_preventmap.js`)도
    `.fm-marker-name`/`.fm-marker-wrap` 클래스 기반의 정확한 매치로 함께 고쳐서
    모두 재확인했다 — `kakao_stub.js`의 `CustomOverlay`도 `xAnchor`를 기록하도록
    확장했다(실제 SDK처럼 지오-투-픽셀 투영을 흉내내진 않지만, 앵커 옵션이 실제로
    전달되는지는 확인할 수 있다).
- **목록 카드의 설명 줄이 좋아요/별점/수정/삭제 버튼과 가로폭을 나눠 쓰던 탓에,
  말줄임표도 못 보일 만큼 일찍(한두 어절만에, 깔끔한 "..." 대신 보기 흉하게)
  잘리던 버그 — 설명을 버튼과 같은 줄에서 떼어내 카드 전체 폭을 혼자 쓰는 둘째
  줄로 내렸다.** 사용자가 "이미양과자" 카드 스크린샷("베이커리도 맛있지만 제철
  벗"에서 잘림, 말줄임표 없이 글자가 어색하게 잘려 보임)을 보여주며 "카드의 행
  높이를 줄이게 이렇게 배열하면 어때... 설명은 조금 더 길게 나오면 되고"라고
  요청했다. 원인은 `.spot-item-main`(이름+카테고리+설명)과 `.spot-item-side`
  (좋아요/별점/수정/삭제)가 나란히 한 줄을 나눠 쓰는 구조라, 설명이 쓸 수 있는
  실제 폭이 `.spot-item-main`의 최소폭(160px)에 불과했던 것.
  - **고쳐서** HTML 구조를 `.spot-item-row1`(이름+카테고리 배지+버튼이 모두
    한 줄, `flex-wrap:wrap`)과 그 아래 `.spot-item-desc`(설명, 카드 전체 폭을
    혼자 쓰는 별도 줄)로 재배치했다 — `.spot-item-main`/`.spot-item-sub` 클래스는
    없앴다. `.spot-item`은 `flex-direction:column`으로 바뀌어 row1과 설명 줄이
    세로로 쌓이고, `.spot-item-title`은 `flex:1 1 100px; min-width:100px`로
    줄어들며 말줄임되고, `.spot-item-side`는 `margin-left:auto`로 row1 안에서
    오른쪽 끝에 붙는다. 총 줄 수는 그대로 2줄(row1 + 설명)이라 카드 높이는 거의
    그대로지만(버튼 4개가 다 안 들어가는 아주 좁은 화면에서만 row1 자체가
    줄바꿈돼 3줄이 될 수 있음), 설명이 실제로 쓸 수 있는 폭은 테스트 기준
    160px → 266px로 늘었다 — 스크린샷으로 "..."가 깔끔하게 보이는 것까지
    확인했다.
  - `.spot-item-main`을 셀렉터로 쓰던 `test_food_map_kakao.js`/
    `test_food_map_kakao_regression.js`의 목록 클릭 지점을 `.spot-item-title`로
    고쳤다(그 자리를 클릭해도 `.spot-item` 자신의 클릭 핸들러가 그대로 버블링돼
    팝업이 뜨는 동작은 동일). `test_food_map_card_expand.js`/
    `test_food_map_features2.js`는 구조 변경과 무관하게 그대로 통과함을 재확인했다.
- **바로 위에서 한 번 손본 2줄 구조가, 실제로는 여전히 "이름+카테고리 한 줄 /
  버튼 한 줄 / 설명 한 줄"로 3줄이 되는 경우가 잦았다 — `.spot-item-side`가
  `.spot-item-row1` 안에서 하나의 박스(플렉스 아이템)였던 탓에, 자리가 모자르면
  그 박스 전체(좋아요+별점+수정+삭제 네 개를 한꺼번에)가 통째로 다음 줄로
  넘어가 버렸다.** 사용자가 "이름 카테고리 좋아요 별점 수정 삭제 한 줄 / 설명
  한 줄로 해서 총 2줄 이내로" 다시 요청해서 구조를 더 다듬었다.
  - **고쳐서** `.spot-item-side{ display:flex; ... margin-left:auto; }`를
    `.spot-item-side{ display:contents; }`로 바꿨다 — `display:contents`는 그
    박스 자체를 레이아웃에서 없애고 안의 자식(좋아요/별점 버튼, 수정+삭제 묶음)을
    `.spot-item-row1`의 "직속 플렉스 아이템"처럼 펼쳐 보여준다. 그 결과 자리가
    모자를 때도 버튼 네 개가 통째로 넘어가는 대신 하나씩(또는 수정+삭제 두 개가
    묶인 작은 단위만) 다음 줄로 넘어갈 수 있어, 한 줄에 다 들어갈 가능성이 훨씬
    높아진다. `.spot-item-title`도 `flex:1 1 100px`(고정 100px 기본 폭을
    항상 먼저 차지)에서 `flex:0 1 auto; min-width:40px`(실제 글자 길이만큼만
    차지하고, 모자르면 40px까지 줄어들며 말줄임)로 바꿔 "맛집" 같은 짧은
    이름이 버튼들이 쓸 공간을 불필요하게 먼저 가져가지 않게 했다 — 처음엔
    실수로 `flex:1 1 auto`(flex-grow:1)로 바꿨다가, 남는 공간을 제목이 전부
    끌어가 버려 버튼이 오히려 더 안 들어가는 반대 효과가 나는 걸 치수를 직접
    재서(`getBoundingClientRect`) 확인하고 `flex:0 1 auto`(grow 없음)로
    고쳤다. 카테고리 배지/좋아요·별점 버튼/수정·삭제 버튼의 패딩·글자 크기도
    조금씩 더 줄여(`spot-item-row1`의 `gap`도 `4px 10px`→`4px 6px`) 한 줄에
    들어갈 여유를 더 만들었다.
  - **이 변경 전과 마찬가지로, 모든 화면 폭에서 100% 2줄을 보장하지는 못한다 —
    물리적인 폭 한계다.** `.fm-list-col`은 `flex:1; max-width:420px`라, 지도
    칸(`flex:2.3`)이 넓은 화면 비중을 가져가는 한 실제 목록 칸 폭은 그보다 훨씬
    좁을 때가 많다(Playwright로 직접 측정: 1900px 이상 뷰포트에서만 목록 칸이
    420px 상한에 도달 — 그보다 좁은, 흔한 노트북 해상도(1400~1500px)에서는
    목록 칸이 ~342px, 카드 안쪽 실제 사용 가능 폭은 ~266px에 그쳤다). 그 폭에서
    "이미양과자"(5글자) 이름+카테고리 배지+좋아요+별점+수정+삭제를 다 합치면
    최소 ~336px가 필요해, 버튼을 읽을 수 있는 수준으로 유지하는 한 물리적으로
    한 줄에 다 안 들어간다 — 이 경우엔 여전히 별점/수정/삭제 정도가 둘째 줄로
    넘어가 카드가 3줄이 된다(다만 이전처럼 "버튼 네 개가 통째로" 넘어가진
    않고 일부만 넘어가, 이전보다는 항상 더 작거나 같다). **실제로 2줄이
    보장되는 건 지도 칸이 420px 상한에 닿을 만큼 넓은 화면, 또는 목록 칸이
    전체 폭을 혼자 쓰는 모바일 1열 레이아웃(`@media max-width:820px`에서
    `.fm-layout`이 세로로 쌓임)뿐이다** — 지도 칸의 비중(`flex:2.3`)은 이전에
    사용자가 명시적으로 "지도 크게"를 요청해 키운 값이라 이번 변경에서는
    건드리지 않았다. `test_food_map_card_expand.js`/`test_food_map_features2.js`/
    `test_food_map_kakao_regression.js`/`test_food_map_pin_popup_actions.js`/
    `test_food_map_marker_anchor.js`/`test_food_map_popup_preventmap.js`/
    `test_food_map_name_fallback_match.js`/`test_food_map_categories.js` 전부
    재실행해 회귀가 없음을 확인했다(이번 변경은 CSS와 일부 인라인 치수뿐이라
    DOM 클래스/구조 자체는 안 바뀌었다).
- **바로 위 "물리적으로 100% 2줄을 보장 못한다"는 한계를, 줄바꿈 자체를 없애고
  대신 줄임표로 끊는 방식으로 해소했다 — "오른쪽 끝에서부터 삭제 수정 별표
  하트 순서로 고정, 첫째 줄엔 이름+버튼, 둘째 줄엔 카테고리+설명, 모자라면
  이름/설명을 줄임표로 줄여라"는 구체적인 재요청으로 카드 구조를 다시 짰다.**
  기존 `.spot-item-row1`(이름+카테고리+버튼 전부 한 줄, `flex-wrap:wrap` +
  `.spot-item-side{display:contents}`로 좁으면 버튼 일부가 둘째 줄로 새는
  방식)과 별도의 `.spot-item-desc`(설명만 혼자 쓰는 줄) 구조를 완전히
  버리고, 다음 두 줄짜리 구조로 교체했다:
  - **첫째 줄(`.spot-item-row1`)**: 이름(`.spot-item-title`, 왼쪽) + 버튼
    묶음(`.spot-item-side`, 오른쪽). `flex-wrap:nowrap`이라 **절대 줄바꿈되지
    않는다** — 이름은 `flex:1 1 auto; min-width:0; white-space:nowrap;
    overflow:hidden; text-overflow:ellipsis`라 자리가 모자르면 끝까지
    줄어들며 말줄임되고, 버튼 묶음은 `flex:0 0 auto; margin-left:auto`로
    항상 카드 오른쪽 끝에 고정폭으로 붙는다 — 모든 카드에서 버튼이 같은
    위치에 나오는 이유. 버튼 묶음 자체는 `.spot-item-side{ display:flex;
    flex-wrap:nowrap; }`로 되돌려(이전 `display:contents`는 버림) 좋아요→
    별점→수정→삭제 순서(요청한 "오른쪽 끝에서부터 삭제, 수정, 별표, 하트"와
    동일 — 오른쪽 끝이 삭제, 그 왼쪽이 수정, 그 왼쪽이 별점, 그 왼쪽이
    좋아요)를 한 덩어리로 유지한다.
  - **둘째 줄(`.spot-item-row2`, 새로 추가)**: 카테고리(`.spot-item-cat`,
    왼쪽 고정폭) + 설명(`.spot-item-desc`, 나머지 공간). 이것도
    `flex-wrap:nowrap`이라 줄바꿈되지 않고, 설명만 `flex:1 1 auto;
    min-width:0`이라 모자르면 말줄임된다.
  - 이 구조에서는 버튼 묶음 자체의 고정 폭(4개 버튼 + 패딩, 보통 200px
    안팎)이 카드 폭을 넘어서는 극단적으로 좁은 경우가 아니라면 — 이름이
    아무리 길어도 줄임표로 줄어들 뿐 — 항상 정확히 2줄로 끝난다. 아주 좁은
    화면(실측: 뷰포트 1000px, 3단 데스크톱 레이아웃에서 목록 칸이 ~266px로
    눌리는 극단치)에서 이름이 완전히 0px까지 줄어든 뒤에도 버튼 묶음 자체가
    남은 공간보다 넓으면 버튼이 카드 오른쪽 경계를 살짝 넘어갈 수 있다 —
    이것도 물리적 한계지만, 지도 칸이 420px 상한에 닿는 넓은 화면이나 모바일
    1열 레이아웃 등 이 페이지가 실제로 자주 쓰이는 폭에서는 재현되지 않음을
    1900/1400px 뷰포트에서 직접 측정해 확인했다(둘 다 버튼 오른쪽 끝이
    모든 카드에서 정확히 같은 좌표에 위치).
  - `test_food_map_card_expand.js`/`test_food_map_features2.js`/
    `test_food_map_kakao_regression.js`/`test_food_map_pin_popup_actions.js`/
    `test_food_map_marker_anchor.js`/`test_food_map_popup_preventmap.js`/
    `test_food_map_name_fallback_match.js`/`test_food_map_categories.js`/
    `test_food_map_nearby_poi_click.js`/`test_food_map_default_bounds_and_cap.js`/
    `test_food_map_retry_and_layout.js`/`test_food_map_search_viewport.js`
    전부 재실행해 회귀가 없음을 확인했다 — HTML 클래스 이름(`.spot-item-title`/
    `.spot-item-cat`/`.spot-item-desc` 등)은 그대로 유지했으므로 이 클래스들을
    셀렉터로 쓰는 기존 테스트는 손댈 필요가 없었다.
- **카테고리별로 지도 마커 핀/라벨 색깔이 다르게 나온다.** 이전엔 모든 핀이
  같은 색이라(카테고리는 라벨 텍스트로만 구분) 지도가 복잡해지면 한눈에
  분류가 안 됐다 — 요청대로 카테고리마다 점(`.fm-marker-pin`)과 카테고리
  칩(`.fm-marker-cat`, 배경 음영 포함)을 다른 색으로 그린다. `CATEGORY_COLOR_
  PALETTE`(11개 hex 색상, `DEFAULT_CATEGORY_SUGGESTIONS`의 11개 기본
  카테고리와 인덱스로 1:1 매칭 — 한식/중식/일식 등 이미 알려진 카테고리는
  항상 같은, 서로 눈에 잘 구분되는 색을 쓰도록 의도적으로 고른 것이지 해시의
  부수효과가 아니다)와, 거기 없는(자유 입력) 카테고리를 위한 해시 기반
  폴백(`categoryColorFor()` — 이름 글자들을 합산해 팔레트 11개 중 하나로
  매핑, 같은 이름은 항상 같은 색)으로 구성된다. `hexToRgba()`는 칩의 옅은
  배경색(`alpha:0.14`)을 만드는 용도로만 쓴다. `makeOverlayEl()`의 점과
  카테고리 칩 양쪽에 이 색을 입혔고, 아직 저장 전인 임시 핀(검색 결과를
  막 고른 직후, 지도를 직접 클릭한 직후)에도 똑같이 적용된다(카테고리 값이
  있는 모든 `makeOverlayEl()` 호출이 공통으로 거치므로 별도 분기가 필요
  없었다). `.fm-marker-name`(이름 라벨)의 글자색은 바꾸지 않았다 — 카테고리
  구분은 점+칩만으로 충분하고, 이름까지 색을 입히면 가독성이 떨어질 수
  있어서다. `test_food_map_category_colors.js`로 (1) 서로 다른 카테고리의
  마커 3개가 각각 다른 색으로 렌더링되는지, (2) 카테고리 칩의 글자색도 점과
  짝을 이루며 서로 다른지, (3) 새로고침해도 같은 카테고리는 항상 같은 색을
  유지하는지 확인했고, 기존 `test_food_map_marker_anchor.js`/
  `test_food_map_popup_preventmap.js`/`test_food_map_features2.js`/
  `test_food_map_pin_popup_actions.js`/`test_food_map_name_fallback_match.js`
  를 다시 돌려 회귀가 없음을 확인했다.
- **① 지도 영역이 작을 때 핀 팝업이 화면 밖으로 잘림 → 팝업을 열기 전에 그
  핀을 지도 정중앙으로 옮긴다. ② 카테고리/기타 필터가 지도를 그 핀 쪽으로
  이동시키던 동작을 완전히 제거 — 필터를 걸든 끄든 지도는 항상 "학교 주변"에
  고정. ③ 카테고리 필터 pill을 맛집 목록 위에도 하나 더 둬서, 지도 위/목록 위
  양쪽 다 있고 서로 동기화되게.** 사용자가 세 가지를 한 번에 요청했다: "모바일로
  보면 지도 화면이 작은데, 상호명을 클릭했을 때 그 업소 정보가 지도 화면 밖으로
  잘려서 지도를 이동해야 볼 수 있다 — 화면이 작을 때는 화면 중앙에 보이게 해달라.
  필터(카테고리)를 누르면 지도가 그 핀 위치로 바뀌고, 다시 끄면 넓은 범위로 또
  바뀌는데, 사용자가 스크롤하기 전에는 무조건 학교 주변을 보여줘야 한다(필터된
  핀이 멀리 있어도 상관없다 — 이 지도의 목적 자체가 학교 주변 맛집 공유이기
  때문). 필터는 맛집 목록 위에도 같이 있어야겠다 — 모바일에서 지도까지
  스크롤해야만 필터를 누를 수 있어 불편하다. 양쪽 다 있고 눌렀을 때 서로
  동기화되도록."
  - **①**: `togglePopup()`(저장된 맛집 핀)과 `onSearchPinClick()`의 "아직 저장
    안 된 검색 결과 핀" 분기 둘 다, 팝업용 `CustomOverlay`를 만들기 전에 새
    `centerMapForPopupIfSmall(position)` 헬퍼를 거친다 — `#foodMap`의 실제
    렌더링 높이(`clientHeight`)가 `SMALL_MAP_HEIGHT`(500px, 모바일 CSS가 지도를
    420px로 줄이는 그 경우를 정확히 잡아내는 여유 있는 기준) 이하일 때만
    `map.setCenter(position)`으로 그 핀을 화면 정중앙으로 옮긴다. 뷰포트 폭이
    아니라 지도 자신의 실제 높이로 판단하는 이유는, "작은 화면"이 실제로
    의미하는 건 지도가 그려지는 영역의 크기 자체이기 때문 — 모바일 미디어쿼리
    경우뿐 아니라 데스크탑에서 창을 세로로 작게 줄인 경우처럼 폭과 무관하게
    지도 자체가 작아진 경우까지 함께 커버한다. 목록 클릭(`renderList()`의
    `.spot-item` 클릭 핸들러)과 "검색 결과가 이미 등록된 맛집과 같은 장소"
    분기는 이미 항상(화면 크기와 무관하게) `map.setCenter()`를 호출하고 있었어서
    따로 손대지 않았다 — `togglePopup()` 안에서 한 번 더 같은 위치로
    `setCenter`하는 건 멱등이라 무해하다. 큰 화면(지도 높이 > 500px)에서는 이
    헬퍼가 그냥 아무 일도 안 하므로, 지도를 직접 클릭해 핀을 열 때 지도가
    불필요하게 움직이지 않는다(기존 동작 그대로 유지).
  - **②**: "카테고리나 목록을 선택하면 그 핀들 쪽으로 지도 이동" 기능
    (`fitFilteredBoundsCapped()`, `FILTERED_BOUNDS_MAX_LEVEL` 상한과 함께 몇 번
    전에 추가됐던 것)을 완전히 삭제했다 — 카테고리 pill 클릭, "내가 올린 곳만"/
    "좋아요한 곳만" 토글 세 핸들러 모두에서 그 호출을 뺐고, 다른 어디서도 안
    쓰이게 된 `fitFilteredBoundsCapped()`/`fitBoundsToSpots()` 함수 자체와
    `FILTERED_BOUNDS_MAX_LEVEL` 상수까지 통째로 지웠다. 이제 필터는
    `applyMarkerVisibility()`/`renderList()`로 어떤 핀·카드가 보이는지만 바꿀
    뿐, 지도의 중심·줌은 전혀 건드리지 않는다 — 사용자가 직접 지도를 움직이기
    전까지는 항상 지도 생성 시의 고정값(`SCHOOL_LATLNG`, `DEFAULT_MAP_LEVEL`,
    "🏫 학교 주변" 버튼과 완전히 동일한 값)에 머문다. 이건 그 전의 "필터를
    걸면 지도가 그 핀 쪽으로 움직이고 상한이 있어서 전국 단위로는 안 간다"는
    설계를 한 단계 더 되돌린 것 — 이번에는 "아예 안 움직인다"는 더 단순하고
    명확한 요구라, 상한값을 조정하는 정도로는 해결이 안 되고 그 기능 자체를
    없애는 게 맞았다.
  - **③**: `#categoryPillsList`라는 두 번째 `<div class="cat-pills">`를 "맛집
    목록" 카드의 `<h2>` 바로 아래(검색/정렬 toolbar-row보다 위)에 추가했다.
    `renderCategoryPills()`는 이제 `['categoryPills', 'categoryPillsList']`
    두 엘리먼트 id를 순회하며 똑같은 pill HTML을 그리고, 각각에 독립적으로(하지만
    똑같은 로직의) 클릭 핸들러를 건다 — 어느 쪽 pill을 클릭해도 같은
    `activeCategories` Set을 바꾸고 `renderCategoryPills()`를 다시 불러서 두
    자리 모두 즉시 `active` 클래스가 동기화된다. 별도의 "동기화 로직"이 필요
    없었던 이유는 두 컨테이너가 처음부터 같은 상태(`activeCategories`)를
    읽어서 그리는 하나의 함수로 묶여 있기 때문 — 두 개의 독립된 UI 상태를
    나중에 맞추는 게 아니라, 애초에 상태가 하나뿐이고 뷰만 두 군데다.
  - `test_food_map_filter_sync_and_popup_center.js`(새 테스트)로 (1) 카테고리
    필터를 걸거나 끄거나 "내가 올린 곳만" 토글을 바꿔도 지도 중심/레벨이 전혀
    안 바뀌는지, (2) pill이 지도 위/목록 위 두 자리에 모두 렌더링되는지, (3)
    목록 위 pill을 클릭하면 지도 위 pill도 즉시 동기화되고 실제 필터링도
    적용되는지, (4) 지도가 충분히 큰 화면(desktop)에서는 마커를 직접 클릭해도
    지도가 안 움직이는지, (5) 지도가 작은 화면(모바일 폭, `#foodMap` 418px)에서
    마커를 직접 클릭하면 그 핀 좌표로 지도가 재중앙화되는지, (6) 모바일
    레이아웃에서도 목록 위 필터 pill이 실제로 화면에 보이는지 — 모두 확인했다.
    `fitFilteredBoundsCapped()`/`FILTERED_BOUNDS_MAX_LEVEL`을 테스트하던 옛
    `test_food_map_default_bounds_and_cap.js`의 [B]/[C] 섹션은 이번 변경으로
    대상 기능 자체가 없어져 그 파일을 지웠고, `test_food_map_features2.js`의
    [B2]/[B4]도 "그 핀들로 지도가 이동함" 기대를 "setBounds 호출 횟수이 전혀
    안 바뀜(지도가 안 움직임)" 쪽으로 뒤집어 다시 통과시켰다. ①(팝업 중앙
    정렬)은 다른 Kakao Maps 관련 수정들과 마찬가지로 `kakao_stub.js`(최소
    동작 스텁)로만 검증했다 — 실제 기기의 터치 동작이나 실제 SDK의 팝업
    렌더링 크기까지는 이 환경에서 확인할 수 없다.
- **모바일(1열) 레이아웃에서 지도 칸이 목록 칸보다 좌우 여백이 더 남아 두 칸의
  실제 폭이 서로 달라 보이는 버그 — `.fm-layout`의 `align-items:flex-start`가
  원인이었다.** 사용자가 스크린샷으로 지적: "위쪽 지도가 좌우 여백이 아래의
  목록보다 많이 남아서 아래 목록만큼 지도 영역을 넓혀도 되겠어." `.fm-layout`
  (데스크톱 3열 플렉스)은 처음부터 `align-items:flex-start`였는데, 모바일
  미디어쿼리(`@media max-width:820px`)가 `flex-direction:column`으로 세로
  1열로 접을 때 그 `align-items:flex-start`를 그대로 물려받았다 — 플렉스
  방향이 세로로 바뀌면 cross axis(가로)의 기본 정렬 기준이 되는 이 속성이,
  각 칸(검색/지도/목록)의 가로폭을 `.fm-layout`의 전체 가용폭에 맞춰
  늘리지 않고 **내용물에 맞춰 줄이는(fit-content) 쪽으로 동작**한다. 목록
  칸(`.fm-list-col`)은 안에 "가게 이름·소개·올린 사람으로 검색" 입력창이나
  카테고리 pill 줄처럼 자연스럽게 넓게 퍼지는 내용이 있어 우연히 꽉 차
  보였지만, 지도 칸(`.fm-map-col`)은 그런 내용이 없어 fit-content 폭이
  실제 가용폭보다 좁게 계산돼 좌우 여백이 더 남았다 — 둘 다 같은 `.card`
  스타일(패딩 `20px 22px` 동일)을 쓰는데도 카드 자체의 바깥쪽 폭이 서로
  달랐던 것. **고쳐서** 모바일 미디어쿼리 안에서만
  `.fm-layout{ flex-direction:column; align-items:stretch; }`로
  `align-items`를 `stretch`로 덮어썼다 — 세로 1열일 때는 검색/지도/목록
  세 칸 모두 항상 `.fm-layout`의 가용폭(=`.wrap`의 좌우 패딩을 뺀 폭)을
  꽉 채우게 된다. 데스크톱 3열 레이아웃의 `align-items:flex-start`는
  그대로 둬서(각 칸 높이가 서로 다를 때 위쪽 기준으로 정렬되는 기존 동작
  유지), 이 변경은 모바일 1열일 때만 적용된다. 390px 모바일 뷰포트에서
  Playwright로 직접 `getBoundingClientRect()`를 찍어, 수정 전에는 지도
  칸과 목록 칸의 좌우 경계가 서로 달랐다가 수정 후에는 두 `.card` 모두
  정확히 같은 left(20px)/right(370px) 경계를 갖는 것을 확인했다 —
  `test_food_map_retry_and_layout.js`(820px 접힘 breakpoint 검증)와
  `test_food_map_filter_sync_and_popup_center.js`(모바일 폭에서 지도
  높이/필터 pill 노출 검증)를 다시 돌려 회귀가 없음을 확인했다.

## `grade-estimate.html` (예상 등급 산출)

사용자가 학업성적관리지침 발췌 이미지 두 장(석차등급 산출 방식/석차누적비율표,
등급별 학생수 산정 예시, 동점자 중간석차 처리 규정과 예시 두 개)을 보여주며
"애들 성적이 5등급으로 나오는데, 점수 일람표를 입력하면 예상 등급과 등급 컷을
산출해주는 페이지를 만들고 싶어"라고 요청해서 만든 새 페이지다.
`exam-generator.html`/`score-generator.html`과 같은 패턴 — Supabase 호출이 전혀
없는 순수 클라이언트 계산기이고, `auth.js`가 꺼져 있어(`AUTH_ENABLED=false`)
로그인 없이 누구나 바로 쓸 수 있다. `admin-tools.html`(교무 업무 도구 허브)의
타일 하나로만 들어가고(시험 문항 배점 생성기 타일 바로 다음), `nav.js`의
`EXTRA_SEARCH_ITEMS`에만 등록돼 있다 — `DEFAULT_NAV_ITEMS`/`index.html` 상단
타일은 없다(exam-generator.html/score-generator.html과 동일한 노출 방식).

**계산 로직(`computeGrades`)은 이미지에 제시된 두 규정을 그대로 코드화한 것이다**,
임의로 단순화하거나 근사하지 않았다:
- **등급별 누적 인원**: `등급별 누적비율표`(5등급: 10/34/66/90/100%, 또는 사용자가
  고를 수 있는 9등급: 4/11/23/40/60/77/89/96/100% — 9등급은 이미지에 없던 것이라
  일반 선택과목에 흔히 쓰이는 표준 9등급 누적비율로 추가했다)의 각 등급 상한 비율에
  수강자수를 곱해 **반올림**한 값을 그 등급까지의 누적 인원으로 쓴다
  (`boundaryCounts()`) — 이미지의 178명 예시(누적비율 10/34/66/90/100% →
  누적인원 17.80/60.52/117.48/160.20/178 → 반올림 18/61/117/160/178 → 등급인원
  18/43/56/43/18)와 정확히 일치하는지 테스트로 확인했다.
- **동점자(동석차) 처리**: "4) 과목별 석차등급은... 석차 순에 따라 평정한다"에
  따라 동점자가 없으면 그냥 누적 위치로 등급을 매기지만, 동점자 그룹이 등급
  경계에 걸친 경우(=그 그룹의 시작 위치와 끝 위치가 서로 다른 등급에 속하는
  경우)에만 "5)"의 중간석차 규정을 적용한다: **중간석차 = 석차 + (동석차
  인원수−1)/2**, **중간석차백분율 = 중간석차 / 수강자수 × 100**을 계산해, 그
  백분율이 누적비율표의 어느 구간에 들어가는지로 **그 동점자 그룹 전체에 하나의
  등급**을 부여한다 — 등급 범위 안에서(경계를 안 넘고) 생기는 동점자에게는
  적용하지 않는다는 규정도 그대로 반영했다(`gStart === gEnd`면 중간석차 없이
  바로 그 등급). 이미지의 예1(수강자수 96명, 1등 동점자 19명 → 중간석차 10,
  백분율 10.42% → 전원 2등급)과 예2(수강자수 120명, 1등 1명+2등 동점자 15명 →
  중간석차 9, 백분율 7.5% → 전원 1등급, 1등급 정원(12명)을 초과한 16명이 1등급이
  됨)를 각각 그대로 재현해 정확히 일치하는지 테스트로 확인했다 — 이 두 예시가
  "1등급 정원을 초과/미달해도 동점자 그룹 전체가 같은 등급을 받는다"는, 직관과
  어긋날 수 있는 핵심 규칙을 보여주는 부분이라 특히 꼼꼼히 맞췄다.
- **석차 표시**: "6)"의 "동점자 모두에게 해당 순위의 최상의 석차를 부여하고
  ( )안에 동점자 수를 병기한다" 규정대로, 결과 표의 석차 칸은 동점이 없으면
  `"N위"`, 있으면 `"N위 (M명 동점)"`으로 표시한다.

**입력**: `#scoreInput` 텍스트영역에 한 줄에 한 명씩 붙여넣는다 — 엑셀에서 복사한
"이름\t점수"(탭 구분) 형식, 공백으로 구분한 "이름 점수", 또는 이름 없이 점수만
있는 줄 모두 `parseScoreInput()`이 허용한다(이름이 없으면 `학생{줄번호}`로
자동 채움). 점수를 읽지 못한 줄이 있으면 계산을 막고 몇 번째 줄인지 알려주는
에러 메시지를 보여준다(최대 5건까지 나열, 그 이상은 "외 N건"으로 요약).

**출력**: 학생별 예상 등급 표(석차/이름/점수/등급 뱃지, 등급 뱃지는 등급이
낮을수록(1등급에 가까울수록) 더 진한 남색), 중간석차가 적용된 동점자 그룹만
따로 설명하는 카드(어느 등급 경계에서 몇 명이 어떤 등급으로 묶였는지), 등급별
분포/등급컷 표(등급별 인원·비율·최고점·최저점 — 최저점이 곧 그 등급의 컷
점수). "엑셀로 다운로드" 버튼은 이 저장소의 `xlsx@0.18.5`(jsdelivr) 관행을
그대로 써서 석차/이름/점수/예상 등급/중간석차 적용 여부 열을 가진 시트를
내려받는다.

`test_grade_estimate.js`로 (1) 178명(동점 없음) 등급인원이 이미지 예시와
정확히 일치하는지, (2) 예1(96명, 1등 동점 19명 → 전원 2등급, 중간석차
10/10.42%)과 예2(120명, 1등 1명+2등 동점 15명 → 전원 1등급, 중간석차 9/7.5%)가
그대로 재현되는지, (3) 실제 UI로 입력→계산 시 결과/등급컷 표가 올바르게
렌더링되는지(작은 수강자수 예시에서 등급 경계에 걸친 두 동점자 그룹이 각각
올바르게 묶이는 것까지 확인), (4) 점수를 읽지 못하는 입력에서 에러 메시지가
뜨고 결과가 숨겨지는지, (5) 9등급으로 바꾸면 누적비율표가 9칸으로 바뀌는지 —
모두 확인했다.

**엑셀 일람표 직접 업로드 — NEIS "정기시험 교과목별 일람표" 형식을 그대로 읽는다.**
사용자가 실제 NEIS에서 내려받는 일람표 엑셀 파일을 보내며 "이 양식을 업로드하면
분석해서 응시자수와 학번별 점수, 학번별 예상 등급, 1~5등급의 인원과 등급컷이
정리되어 나오게" 해달라고 요청했다. 실제 파일을 열어보니(`xl/worksheets/sheet1.xml`을
직접 zip 압축 해제해 확인 — 이 환경엔 엑셀 파싱 라이브러리가 없어 XML을 직접
읽었다) **학번/이름 컬럼이 전혀 없는, 반번호(열) × 반 안에서의 번호(행) 그리드**
형식이었다: `A5`셀이 `"반번호"`이고 그 오른쪽(`B5`~)에 1,2,3...처럼 반 번호가
한 줄로 나열되며, 그 아래 각 행은 그 번호(`A6`=1, `A7`=2, ...)의 학생이 각 반에서
받은 점수를 가로로 나열한다(해당 번호의 학생이 그 반에 없으면 빈 칸). 그 아래로
`응시생수`/`총점`/`평균` 요약 행이 이어지고, `A4`셀에
`"고사 : 중간고사   교과목 : 국어:화법과 언어(4)   만점 : 100.00"`처럼 고사명/
교과목/만점이, `L4`셀에 `"교과담당교사 : ..."`가, `A3`셀에
`"2026학년도   2학기   주간      2학년"`처럼 학기/학년 정보가 들어있다. 이 형식엔
학번이 없으므로, 사용자의 "학번별"이라는 표현을 임의의 학번으로 지어내지 않고
**이 파일의 실제 고유 식별자인 "반+번호"를 그대로 드러내 "N반 M번"으로 표시**하기로
했다 — 예: `3반 5번`.

`parseNeisRosterSheet(rows)` (`rows`는 `XLSX.utils.sheet_to_json(sheet, {header:1,
defval:null})`의 2차원 배열)가 이 구조를 파싱한다: 모든 셀을 훑어 `"반번호"`
문자열이 정확히 일치하는 셀을 찾아 그 행·열을 헤더 기준점으로 삼고, 그 오른쪽의
숫자 셀들을 반 번호 열 목록으로 모은 뒤, 그 아래 행을 번호가 숫자인 동안(=
`응시생수` 같은 요약 행을 만나면 중단) 훑으며 반 번호 열마다 숫자 점수가 있는
칸만 `{name: "N반 M번", score, classNo, no}`로 모은다. 이렇게 모은 학생 배열을
**반 구분 없이 전부 하나로 풀(pool)해서** 기존 `computeGrades()`에 그대로
넘긴다 — 같은 과목(선택과목처럼 여러 반이 섞여 듣는 분반)의 석차등급은 분반과
무관하게 전체 수강자를 함께 순위 매겨야 하므로, 반별로 따로 계산하지 않는다.
메타 정보(고사명/교과목/만점/학기·학년/교과담당교사)는 전체 셀 문자열 중
`/고사\s*[:：]\s*(.+?)\s{2,}교과목\s*[:：]\s*(.+?)\s{2,}만점\s*[:：]\s*([0-9.]+)/`
패턴과 `/학년도/`·`/^교과담당교사/` 패턴으로 찾아 표시용으로만 쓴다 — 못 찾아도
점수 계산 자체엔 전혀 영향이 없다(계산은 오직 반번호 그리드에서 읽은 점수만으로
이뤄진다).

UI는 점수 입력 카드 맨 위에 `#xlsxFileInput`(파일 선택) + 안내 문구를 추가했고,
파일을 고르면 `onXlsxFile()`이 `XLSX.read()`로 모든 시트를 순회하며
`parseNeisRosterSheet()`가 성공하는 첫 시트를 쓴다(이 양식은 시트가 보통 하나뿐
이지만, 혹시 여러 시트가 있어도 안전하게 처리). 파싱에 성공하면 (1) `#scoreInput`
붙여넣기 칸에도 같은 내용을 "N반 M번\t점수" 형식으로 채워 넣어, 업로드 후에도
손으로 몇 명을 고치고 다시 계산할 수 있게 하고(기존 텍스트 붙여넣기 흐름과
완전히 같은 경로를 타므로 등급 체계 전환이나 재계산도 그대로 동작), (2) 찾은
메타 정보를 `#xlsxMetaBox`(학기/고사명/교과목/만점/교과담당교사/응시생수)로
보여주고, (3) 기존 `computeGrades()` → `renderResults()` 경로를 그대로 호출해
결과/등급컷 표를 렌더링한다. "반번호" 형식을 찾지 못하면(이 양식이 아닌 엑셀을
올린 경우) 계산을 진행하지 않고 에러 메시지로 바로 알려준다. 기존
`onCalc()`/`onClear()`는 `runCalc(students, successPrefix)` 공용 함수로 묶어
붙여넣기 흐름과 업로드 흐름이 동일한 계산 경로를 타도록 했고, `onClear()`도
파일 입력/메타 박스를 함께 초기화하도록 확장했다.

사용자가 실제로 보내준 샘플 파일(2026학년도 2학기 중간고사, 국어:화법과
언어(4), 7개 반에 걸쳐 응시생수 25/26/26/25/25/26/22명 = 총 175명)로 끝까지
검증했다 — `test_grade_estimate_xlsx_upload.js`(이 샌드박스는 `cdn.jsdelivr.net`
아웃바운드가 막혀있어 `page.route()`로 xlsx 스크립트 요청만 로컬 node_modules의
동일 버전 파일로 가로채 응답했다, 페이지 코드 자체는 전혀 안 바꿈)로 (1) 업로드
직후 "175명의 점수로... 계산했어요" 성공 메시지가 뜨는지, (2) 메타 정보 박스에
고사명/교과목/교과담당교사/응시생수가 정확히 표시되는지, (3) 결과 표 행이
175개이고 이름이 전부 "N반 M번" 형식인지, (4) 등급별 인원 합이 175와 정확히
일치하는지, (5) 붙여넣기 칸에도 같은 175줄이 "N반 M번<TAB>점수" 형식으로
채워지는지, (6) 지우기를 누르면 메타 박스/결과/텍스트영역이 모두 초기화되는지,
(7) "반번호" 형식이 아닌 엑셀(이름/점수 2열짜리 평범한 시트)을 올리면 에러
메시지로 바로 알려주는지, (8) 업로드 후 9등급으로 바꿔 재계산해도 정상 동작하는지
— 모두 확인했다. 실제 파일에는 92.9점 동점자 2명이 1등급-2등급 경계에 걸려
있어, 중간석차 규정(중간석차 18.5, 상위 10.6% → 둘 다 2등급)이 실제 데이터에서도
정확히 적용되는 것까지 스크린샷으로 확인했다 — 합성 예시뿐 아니라 실제 학교
데이터로도 동점자 처리 규정이 올바르게 작동함을 검증한 셈이다.

**교무 업무 도구 하위로 이동, 엑셀에 누적인원·등급컷 추가, 바로 인쇄 기능.**
사용자가 세 가지를 한 번에 요청했다: "등급 산출은 교무 업무 도구 하위 메뉴에
넣어주고, 학생별 시험 시간표도 교무 업무 도구 하위로 옮겨줘. 등급 계산에서
엑셀 다운로드를 받으면 학생별 점수와 등급, 누적인원, 등급 컷 등이 나오게 해줘.
바로 출력 가능하게도 해주고". 확인해보니 `grade-estimate.html`은 처음부터
`admin-tools.html` 타일 하나로만 들어가 있었어서(이 섹션 위쪽에 이미 문서화된
그대로) 그 부분은 추가 작업이 필요 없었다 — 실제로 옮길 대상은 `exams.html`
(학생별 시험 시간표)뿐이었다: 이 페이지는 그동안 `nav.js`의 `DEFAULT_NAV_ITEMS`
(업무 도구 그룹, 햄버거 메뉴+`index.html` 최상위 타일에 노출)에 들어있었다.
`staff-edit.html`을 옮길 때 썼던 것과 같은 패턴으로 `DEFAULT_NAV_ITEMS`에서
빼고 `index.html`의 해당 `tool-card`를 지운 뒤, `EXTRA_SEARCH_ITEMS`에
`loginRequired: true`를 유지한 채(🔍 전체 검색으로는 계속 찾을 수 있게) 추가하고,
`admin-tools.html`에 "시험 시간표 생성기" 타일 바로 다음 자리에 평범한(관리자
전용 아님 — 메시지함/공지사항 작성과 같은 "누구나 쓰는 업무 도구" 취급) 새
`tool-card`를 추가했다. `exam-generator.html`에서 만든 시험을 바로 이어
확인하는 흐름이라 생성기 다음 자리가 자연스러웠다.

엑셀 다운로드(`onExportExcel`)는 기존 "학생별 결과" 시트(석차/이름/점수/예상
등급/중간석차 적용) 하나뿐이었는데, 두 번째 시트 "등급별 분포·등급컷"(등급/
기준 누적비율/인원/**누적인원**/비율(%)/최고점/**등급컷(최저점)**)을 추가했다
— `boundaryCounts()`가 이미 계산해서 `computeGrades()`의 반환값 `result.counts`
에 들고 있는 "그 등급까지의 누적 인원" 배열을 그대로 `result.counts[g-1]`로
읽어 쓰면 되므로, 별도 계산이 필요 없었다. 화면에 보이는 `#distTable`(등급별
분포/등급컷 카드)도 같은 누적인원 컬럼을 "인원"과 "비율" 사이에 추가해 화면과
엑셀이 똑같은 정보를 보여주게 맞췄다.

"바로 출력 가능하게"는 결과 카드에 "🖨 바로 인쇄하기" 버튼(`onPrintResults`,
단순히 `window.print()` 호출)을 "엑셀로 다운로드" 버튼 옆에 추가하고, `@media
print` 블록으로 인쇄 시 불필요한 요소를 가렸다: 점수 입력 카드(파일 업로드+
붙여넣기 칸+계산 버튼), 안내 문단, 누적비율표 안내 박스, 뒤로가기 링크, 그리고
인쇄/다운로드 버튼 자신(`.no-print` 클래스를 각 요소에 붙이고 `@media print{
.no-print{ display:none !important; } }`로 일괄 처리) — 학생별 결과 표/등급
경계 동점자 카드/등급별 분포 표만 종이에 남는다. `nav.js`가 모든 페이지에
주입하는 햄버거 메뉴·🔍 검색·챗봇 fab 같은 떠다니는 UI(`.gsnav-*` 클래스
전부 이 하나의 접두사를 쓴다 — nav.js 섹션 참고)도 `[class^="gsnav-"],
[class*=" gsnav-"]{ display:none !important; }`로 같은 블록에서 한 번에
가렸다 — nav.js 자체는 건드리지 않고 grade-estimate.html의 인쇄 CSS에서만
처리했다. 이 페이지는 로그인 게이트가 없어(`AUTH_ENABLED=false`) `#scoreTableWrap`
의 최대 높이 제한도 인쇄 시엔 풀어서(`max-height:none; overflow:visible`)
학생이 아무리 많아도 표가 잘리지 않고 여러 페이지로 자연스럽게 이어지게 했다.

`test_grade_estimate_print_export.js`(새 테스트)로 (1) `#distTable` 헤더에
"누적인원" 칼럼이 있고 178명(동점 없음) 예시에서 18/61/117/160/178로 정확히
표시되는지, (2) "바로 인쇄하기" 클릭 시 `window.print()`가 호출되는지, (3) 그
버튼이 담긴 줄에 `no-print` 클래스가 있어 인쇄 시 제외되는지, (4) 엑셀
다운로드 결과가 "학생별 결과"/"등급별 분포·등급컷" 정확히 두 시트로 나오는지,
(5) 두 번째 시트의 누적인원·등급컷(최저점) 칼럼이 화면과 같은 값(18/61/117/
160/178, 1등급 등급컷 98.3 등)으로 채워지는지 — 모두 확인했다.
`test_exams_moved_to_admintools.js`(새 테스트)로 (1) `index.html` 최상위
타일에서 exams.html이 빠졌는지, (2) 햄버거 메뉴에도 더 이상 없는지, (3)
`admin-tools.html`에 admin-only 아닌 평범한 타일로 들어가 있는지, (4) 🔍
전체 검색("시험 시간표")으로는 여전히 찾아지는지 — 모두 확인했다.

**NEIS 일람표 두 번째 양식("반별", 이름 포함) 지원 추가 — 반마다 파일이 하나씩이라 다중 파일
업로드가 필요했다.** 사용자가 "등급 계산기는 이름까지 들어간 반별 일람표를 넣어도 계산될까
양식이 반별과 전체 학급 두가지 스타일이 있거든"이라고 물으며 실제 NEIS 파일 두 개를 올려줬다 —
지금까지 지원하던 `parseNeisRosterSheet()`(반번호 그리드, 이름 없음)는 **전체 학급** 양식
하나뿐이었고, 사용자가 말한 **반별** 양식은 완전히 다른 구조(시트 하나 = 반 하나, "반/번호"
(예: `"1/1"`)·"성명"·"점수" 열)였다. 두 파일의 실제 셀 값을 대조해 같은 시험(2026-2 중간고사,
국어:화법과 언어)의 같은 데이터라는 것도 확인했다 — 그리드 양식의 1반(B열) 점수와 반별 양식
(1반) 파일의 "성명"별 점수가 정확히 일치했다. 사용자가 스스로 "학급별을 입력한다면 모든
학급을 입력하는 걸로 해야겠지"라고 정리한 그대로 — 반별 양식은 한 반만 담고 있으므로, 전체
학생을 계산하려면 반 수만큼의 파일을 **한꺼번에** 올려야 한다.

- **`parseNeisClassRosterSheet(rows)`**(새 함수, `parseNeisRosterSheet` 바로 아래) — "반/번호"
  셀을 찾아 헤더 행을 잡고, 그 행에서 "성명"/"점수" 열을 이름으로 찾는다(그리드 양식처럼 열
  위치가 고정이 아니라 헤더 텍스트로 찾으므로 열 순서가 달라도 안전). 그 아래 행을
  `"반/번호"` 칸이 `숫자/숫자` 패턴(`/^\d+\s*\/\s*\d+$/`)에 안 맞을 때까지(응시생수 등 요약
  행에 닿으면 중단) 읅어, 이름이 있고 점수가 숫자인 행만 학생으로 담는다(결시 등으로 번호
  자체가 없거나 점수 칸이 빈 학생은 자동으로 빠진다 — 그리드 양식의 빈 칸 처리와 같은
  원리). **(2026-10-14 수정)** 이름은 반 접두사 없이 실제 성명 그대로 저장한다(처음엔 여러
  반을 합쳤을 때 동명이인을 구분하려고 `"N반 실명"`처럼 반 접두사를 붙였었는데, 바로 아래
  "석차/학번/이름/점수/등급" 섹션에서 학번(5자리, 학년+반+번호)이 새로 생기면서 반 구분을
  그 학번 칸이 전담하게 돼, 이름 칸은 접두사 없이 순수 성명만 보여주도록 다시 바꿨다 —
  `computeGrades()`는 `name`을 등수 계산에 전혀 쓰지 않고 표시용으로만 쓰므로 동명이인이
  있어도 계산 자체엔 영향이 없다). 메타 정보(고사/교과목/만점/학기학년/교과담당교사) 추출도
  반별 양식의 다른 띄어쓰기/줄바꿈 패턴(고사·교과목이 한 줄, "과목만점"이 별도 줄,
  교과담당교사가 `"(이름,이름) 인"` 형식)에 맞춰 별도로 짰다 — 그리드 양식 쪽
  `parseNeisRosterSheet()`의 메타 추출 로직은 손대지 않았다(그 양식은 이미 정상 동작하던
  걸 건드릴 이유가 없어서).
- **`#xlsxFileInput`에 `multiple` 속성을 추가**하고, `onXlsxFile(file)`(파일 하나)을
  `onXlsxFiles(fileList)`(파일 여러 개)로 바꿨다 — 파일마다 `parseNeisClassRosterSheet()`를
  먼저 시도하고 실패하면 `parseNeisRosterSheet()`(그리드)로 넘어가므로, 어느 쪽 양식을
  올리든(심지어 두 양식을 섞어 올려도) 파일 하나하나가 자동으로 판별된다. 모든 파일에서
  읽은 학생을 한 배열로 합쳐 `computeGrades()`에 그대로 넘기고, 붙여넣기 칸(`#scoreInput`)
  에도 합쳐진 전체 목록이 `"이름\t점수"` 형식으로 채워진다(그리드 양식 때부터 있던 "업로드
  후에도 손으로 고쳐서 다시 계산할 수 있게" 동작을 그대로 유지). 메타박스(`metaBoxHtml`)는
  여러 파일의 메타를 합쳐서 보여주고(고사명/교과목/만점/교과담당교사는 처음 찾은 값을 쓰고,
  교과담당교사는 파일마다 다를 수 있어 중복 제거 후 합집합으로 보여준다), 반별 양식 파일들에서
  모인 반 번호 목록을 `"포함된 반: 1반, 2반, ..."`으로 새로 추가해 몇 반이 실제로 반영됐는지
  한눈에 확인할 수 있게 했다.
- **같은 반 파일이 두 번 올라오면(예: 실수로 같은 파일을 두 번 선택) 경고를 보여주되 계산은
  막지 않는다** — 반별 양식 파일들 사이에서만 반 번호 중복을 검사해(그리드 양식 파일은 애초에
  모든 반을 담고 있어 이 검사 대상이 아님) "N반이 두 번 이상 올라왔어요" 메시지를
  `successPrefix`에 붙여 보여준다. 막지 않은 이유: 중복이 정말 의도적인 경우(예: 같은 반을
  다른 시험에 재사용하려는 디버깅)를 임의로 차단하기보다, 교사가 직접 보고 판단할 수 있게
  경고만 주는 쪽을 택했다 — `collect.html`의 다른 비파괴적 경고들과 같은 원칙.
- **파일명/경고 메시지는 `escapeHtml()`로 감싸서 `innerHTML`에 꽂는다** — 업로드된 파일의
  실제 이름(`file.name`)은 사용자가 통제할 수 있는 문자열이라, 이스케이프 없이 그대로
  `innerHTML`에 넣으면 XSS 위험이 있다(파일명에 `<script>` 같은 문자가 섞여 있는 극단적인
  경우). 파일 읅기 실패 메시지(`fileErrors`)와 반 중복 경고(`dupClassWarnings`) 모두 최종
  렌더링 직전에 `escapeHtml()`을 거친다.
- **검증**: 실제 사용자가 올린 두 파일(전체 학급 그리드 1개, 반별 1반 1개, 같은 시험의 같은
  데이터임을 직접 셀 값으로 대조 확인)에 더해, 그 그리드 파일의 실제 점수를 반별로 그대로
  쪼개 만든 나머지 6개 반의 반별 양식 샘플을 테스트 전용으로 생성해(`build_class_fixtures.js`,
  이름은 테스트용 가짜 이름 — 실제 데이터와 무관), `test_grade_estimate_class_roster.js`로
  (1) 그리드 단일 파일 업로드가 기존처럼 175명/`"N반 M번"` 형식으로 동작하는지(회귀),
  (2) 반별 파일 7개(반마다 하나)를 한꺼번에 올리면 175명이 합산되고 실제 이름이 표시되는지,
  (3) **그 7개 합산 결과의 등급별 분포표가 그리드 단일 파일 결과와 완전히 동일한지**(같은
  원본 데이터를 반으로 쪼갠 것뿐이므로 등급 계산 결과가 정확히 같아야 함 — 가장 핵심적인
  정확성 검증), (4) 메타박스에 "포함된 반" 7개가 모두 표시되는지, (5) 반별 양식 파일 하나만
  (1반) 올리면 실제 업로드된 이름("강석찬" 등, 접두사 없이)이 그대로 보이는지, (6) 같은 반
  파일을 두 번 올리면 중복 경고가 뜨고도 계산(50명)은 정상 진행되는지 — 모두 확인했다.
  Playwright의 `setInputFiles`가 이 환경에서 한글 파일명을 가진 파일은 인식하지 못하는(파일이
  전혀 첨부되지 않는) 것으로 확인돼, 테스트용 픽스처 파일은 전부 영문/숫자 파일명으로 복사해서
  썼다 — 사이트 코드 자체의 문제가 아니라 이 샌드박스의 Playwright 환경에 한정된 제약이라,
  앞으로 이 페이지의 파일 업로드를 Playwright로 테스트할 때도 한글 파일명은 피해야 한다는
  걸 기록해둔다.

**결과 표/엑셀 열 순서를 석차·학번·이름·점수·등급으로, 카드 순서를 등급컷→석차로 바꿨다 —
위 두 양식(그리드/반별)을 한 화면에서 같이 봤을 때 학생을 서로 다른 방식으로만 식별할 수
있던 문제를 "학번"이라는 공통 식별자로 묶었다.** 사용자 요청: "등급 산출에서는 석차 학번
(5자리) 이름(이름이 있을 경우) 점수 등급으로 나오게 하고. 맨 처음에 등급컷, 그 다음에
석차가 나오게 해줘."

- **`extractGradeDigit(flatStrings)`/`buildStudentNo(grade, classNo, no)`**(새 헬퍼, 두
  파서가 공유) — 학번을 **학년(1자리)+반(2자리)+번호(2자리) = 5자리**로 조합한다(예:
  2학년 1반 1번 → `"20101"`). 학년 숫자는 두 파서 모두 이미 긁어모으고 있던
  `flatStrings`(메타 텍스트 조각 모음)에서 `/(\d)학년(?!도)/`로 찾는다 — `(?!도)`가 핵심
  안전장치로, 이게 없으면 `"2026학년도   2학기   주간      2학년"` 같은 문자열에서
  "2026학년**도**"의 `'6'`을 학년으로 잘못 집어버린다(정규식이 음수 전방탐색에 걸려
  그 자리를 건너뛰고 계속 스캔하다가, 문자열 뒤쪽의 진짜 "2학년"에서 올바르게 매치한다).
  학년을 못 찾으면(메타 텍스트가 이 패턴과 안 맞는 파일) `'0'`으로 채운다 — 계산 자체엔
  영향 없는 표시용 값이라 완전히 막을 필요는 없었다. 이 메타/학년 추출 블록은 두 파서
  모두에서 **학생 행을 만드는 루프보다 먼저** 실행되도록 순서를 옮겼다(이전엔 루프 뒤에
  있었는데, 학번을 만들려면 학년이 먼저 있어야 해서).
- **`hasRealName` 플래그** — 세 입력 경로(그리드 파서, 반별 파서, 수동 붙여넣기
  `parseScoreInput`) 각각이 학생 객체에 `hasRealName: false|true`를 싣는다. 그리드(반번호)
  양식은 애초에 이름이 없는 양식이라 `false`(렌더링 시 이름 칸을 비워 보여준다 — 예전처럼
  `"N반 M번"`을 이름 칸에 채우지 않는다), 반별 양식과 수동 붙여넣기는 실제 이름이 있으니
  `true`. 렌더 쪽(`renderResults`/`onExportExcel`)은 `r.hasRealName === false`를 정확히
  (strict) 비교해서만 이름을 비운다 — `undefined`(이 플래그가 아직 없던 옛 코드 경로나
  캐시된 데이터)는 그냥 기본값대로 이름을 보여주는 쪽으로 안전하게 떨어진다.
- **`computeGrades()`의 동점자 처리 루프가 결과 행을 만들 때 `name`/`score`만 복사하고
  나머지 필드를 전부 버리던 버그** — `studentNo`/`hasRealName`/`classNo`/`no`를 학생
  객체에 새로 추가했는데도 이 루프가 `{ name: ..., score: ..., rank, ... }`처럼 딱 두
  필드만 골라서 결과 행(`rows[sorted[k].origIdx]`)을 만들고 있어서, 그 필드들이 등수 계산
  이후 전혀 살아남지 못하고 사라지는 걸 오늘 이 기능을 구현하면서 직접 발견했다. **고쳐서**
  `{ ...sorted[k], rank, tieCount, grade, usedMidRank, midRank, midPct }`처럼 원본 학생
  객체 전체를 펼친 뒤 등수 관련 필드를 덧붙이는 방식으로 바꿨다 — 어떤 학생 필드를 나중에
  추가해도(이번 `studentNo`/`hasRealName`처럼) 자동으로 결과 행까지 살아남는다.
- **열 순서**: 결과 표(`#scoreTable`, `renderResults()`)와 엑셀 "학생별 결과" 시트
  (`onExportExcel()`) 둘 다 **석차 → 학번 → 이름 → 점수 → 등급**으로 통일했다 — 전엔
  이름/점수/등급만 있었다. 학번 칸은 `r.studentNo`(없으면 `'-'`), 이름 칸은
  `r.hasRealName === false ? '' : r.name`(위 플래그 그대로). 엑셀 쪽 컬럼 너비
  (`ws1['!cols']`)도 학번 칸만큼 하나 늘렸다. **엑셀 시트 자체의 순서는 안 바꿨다** —
  "맨 처음에 등급컷, 그 다음에 석차" 요청은 화면 카드 순서를 가리키는 맥락이었다고 판단해,
  "학생별 결과" 시트가 여전히 "등급별 분포·등급컷" 시트보다 먼저 온다(sheet2는 전혀 안
  건드림).
- **카드 순서**: HTML에서 `#distCard`(등급별 분포/등급컷)를 `#resultCard`(학생별 예상
  등급)보다 **앞**으로 옮겼다 — `#midRankCard`(등급 경계 동점자 처리)는 여전히
  `#resultCard` 바로 뒤에 그대로 둬서, 석차 표 → 그 표에서 중간석차가 적용된 동점자
  설명이라는 기존 읅기 순서는 유지했다. `style.display` 토글 코드는 전혀 안 바꿨다(표시/
  숨김은 순서와 무관 — DOM 위치만 결과를 좌우한다).
- 업로드 카드의 안내 문구(`.hint`, `#xlsxFileInput` 근처)도 "학번"이 학년+반+번호를 조합한
  값이라 실제 NEIS 학번과 다를 수 있다는 것과, "이름"은 반별(이름 포함) 양식에서만 채워지고
  그리드(반번호) 양식은 이름이 없어 빈칸으로 나온다는 것을 명시하도록 고쳤다.
- **검증**: `test_grade_estimate_class_roster.js`를 이 새 열 순서(`td:nth-child(2)`=학번,
  `td:nth-child(3)`=이름)에 맞게 다시 써서 (A) 그리드 단일 파일은 이름 칸이 전부 비어있고
  학번은 전부 5자리 숫자 형식인지, (B) 반별 7개 파일 합산은 이름 칸이 전부 채워져 있고
  학번도 5자리 형식이며, 그 등급 분포가 그리드 단일 파일과 완전히 동일한지(같은 원본
  데이터이므로), (C) 반별 1개 파일(1반)만 올리면 "강석찬"이 접두사 없이 보이고 그 학번이
  정확히 `"20101"`(2학년 1반 1번)인지, (D) 중복 업로드 경고가 여전히 뜨는지(회귀 없음),
  (E, 새 항목) `distCard`가 DOM상 `resultCard`보다 먼저 나오는지 — 모두 확인했다.
  `test_grade_estimate.js`/`test_grade_estimate_print_export.js`(수동 붙여넣기 기반, 열
  위치를 직접 읽지 않는 테스트들)는 변경 없이 그대로 재확인했다. 기존
  `test_grade_estimate_xlsx_upload.js`의 두 단언도 이 변경에 맞게 고쳤다 — `[B6]`은
  "이름이 N반 M번 형식"에서 "학번이 5자리 숫자 형식 + 이름 칸은 비어있음"(그리드 양식
  기준)으로, `[E]`(형식이 안 맞는 엑셀의 에러 메시지)는 업로드 핸들러가 반별 파서를 먼저
  시도하는 지난 세션의 기존 동작 때문에 실제 에러 문구가 `"반/번호"`(슬래시 있음)로 나오는
  걸 확인하고 그 문구로 맞췄다 — 이건 오늘 바꾼 게 아니라 원래부터 있던 동작이라, 페이지
  로직을 건드리는 대신 테스트의 기대값만 현실에 맞게 고쳤다.

## `grade-estimate.html` — 학기 성적 누적 관리 (가중합산 + 절대평가), 유일하게 Supabase 저장이 필요해진 기능

이 페이지는 원래 완전한 클라이언트 전용 계산기였다(Supabase 호출 없음, 로그인 불필요). 사용자가
"중간고사, 수행평가1~4, 기말고사를 비율별로 합산해서 등급을 내는 기능"과 "A~E 성취도(절대평가,
과목별 분할점수)"를 함께 요청하면서, **그 전체 설계를 실제 구현 전에 여러 라운드의 요구사항
확정 대화로 먼저 정리했다**(사용자가 명시적으로 "우선 작업하지 마. 정해야 할 것들부터 정하고
하자"라고 요청) — 매칭 키(학번 5자리), 인정점 공식의 적용 범위, 반올림 규칙, 저장 단위, 버전
관리 방식, 분할점수 재사용 여부 등을 하나씩 확인받은 뒤에야 코드를 작성했다. 사용자가 보내준
"2026학년도 2학기 중간고사 결시생 인정점 부여/동점자 처리규정" 가정통신문 PDF로 실제 학교
규정(학업성적관리규정 제23조④/⑦, 제26조③)을 직접 확인하고 그 공식을 그대로 코드화했다.

**왜 이 기능만 Supabase가 필요해졌는지**: 중간고사→수행평가→기말고사를 몇 주에 걸쳐 단계적으로
입력하고 "저장해뒀다가 나중에 이어서" 쓸 수 있어야 한다는 요청 때문에, 이 기능만 이 페이지의
"완전 클라이언트 전용" 원칙에서 벗어났다. 기존 단일 시험 계산기(`#scoreInput`/엑셀 업로드 →
`computeGrades()` → 결과 표)는 전혀 손대지 않고 그대로 뒀고, 새 기능은 같은 페이지 하단에
**별도의 넓은 2단 레이아웃 섹션**(`.wrap-wide`, 1500px — 기존 `.wrap`의 860px보다 훨씬 넓게,
스크롤이 길어지지 않도록 왼쪽은 설정/입력, 오른쪽은 결과를 나란히 보여줌, 980px 이하에서는
1단으로 접힘)으로 추가했고, 기본은 "열기" 버튼으로 접혀있다.

- **`grade_calc_sheets` 테이블**(새 테이블): `owner_id`(`auth.users` 참조) + `year`/
  `semester`/`subject` 조합에 `unique` 제약을 걸어 "학년도+학기+과목명" 단위로 성적표 하나를
  식별한다(같은 과목을 여러 교사/분반이 나눠 맡아도 하나로 합쳐서 관리 — 사용자가 명시적으로
  고른 방향). `elements`(평가 요소 정의: 이름/구분/만점/반영비율의 jsonb 배열)와 `students`
  (학생별 요소 점수·결시 기록의 jsonb 배열)를 한 레코드에 통째로 담고, 저장은 항상 그 레코드
  전체를 덮어쓰는 **upsert**(`onConflict: 'owner_id,year,semester,subject'`)다. RLS는 네
  정책 모두 `auth.uid() = owner_id`만 — **본인만** 보고 고칠 수 있다(사용자가 "만든 교사
  본인만"을 명시적으로 선택). "스냅샷은 안 남긴다"고 결정했지만, 요소별 원점수는 레코드 안에
  항상 전부 남아있다 — 중간고사만 저장했다가 나중에 수행1을 추가해 다시 저장해도 중간고사
  점수는 그대로 유지되고, 화면에는 늘 요소별 점수 열이 각각 다 보이며 총점 열 하나가 매번
  다시 계산될 뿐이다("스냅샷 없음"은 "저장 시점별 이력을 보관하지 않는다"는 뜻일 뿐, 요소별
  데이터 손실을 의미하지 않는다).
- **이 섹션만 로그인이 필요하다** — 페이지 자체(단일 시험 계산기)는 여전히 `auth.js`가
  `AUTH_ENABLED=false`로 꺼져 있어 로그인 없이 쓸 수 있고, 이 새 섹션만 그 안에서 별도로
  `sb.auth.getSession()` + `profiles.approved`를 확인해 로그인·승인 전에는 `#weightedMain`을
  열지 않는다(세션 없으면 `login.html?return=...` 링크, 미승인이면 승인 대기 안내). 이 페이지가
  Supabase를 쓰는 건 이번이 처음이라, 다른 페이지들과 똑같은 `createClient(SUPABASE_URL,
  SUPABASE_KEY)` 패턴을 그대로 복사해 들여왔다.

### 가중합산 — 지필고사는 정규화, 수행평가는 만점=반영비율로 두면 자동으로 같은 공식

평가 요소(`elements`)는 이름/구분(`exam`|`performance`)/만점/반영비율(%)을 갖는 행 단위
목록이고, "+ 요소 추가"로 몇 개든 추가·삭제할 수 있다(수행1만 먼저 넣거나 수행1~4를 한 번에
넣는 것 모두 그냥 행 개수 차이일 뿐). `computeWeightedTotal(student, elements, students)`가
모든 요소에 대해 **딱 하나의 공식**(`점수/만점 × 반영비율`)만 적용한다 — 지필고사(만점 100)는
이 공식이 그대로 "100점만점×비율" 정규화가 되고, 수행평가는 만점을 그 반영비율 점수로 두면
(예: 반영비율 20%면 만점도 20) 같은 공식이 "점수가 곧 반영 점수"로 자연스럽게 축약된다 —
사용자가 말한 "수행평가는 보통 점수가 곧 비율"을 구현하기 위해 별도 분기를 두지 않고, 만점
필드 하나로 두 경우를 하나의 공식 안에 통합했다. 합산 총점은 **소수 둘째자리에서 반올림**
(`round2`). 반영비율 합이 100%가 아니어도 계산은 그대로 진행하고 경고 메시지만 보여준다(`중간
점검` 목적 — 중간고사+수행평가만 넣고 먼저 확인해보고 싶을 수 있다는 사용자 요청).

**학번은 5자리(학년 1자리 + 반 2자리 + 번호 2자리)로 통일** — 이미 `parseNeisRosterSheet`/
`parseNeisClassRosterSheet`가 쓰던 `buildStudentNo()`를 그대로 재사용해, 다른 평가 요소를
다른 시점에(반별로 나뉜 NEIS 파일일 수도 있음) 입력해도 같은 학번으로 정확히 매칭된다.
요소별 점수 입력은 **엑셀 업로드**(기존 두 NEIS 일람표 파서를 그대로 재사용 — 그리드/반별
양식 모두, 파일 여러 개를 한꺼번에 올려도 됨) 또는 **붙여넣기**(`학번\t점수` 또는 `학번\t
이름\t점수`, `parseWeightedPaste()`) 둘 다 가능하고, `mergeScoresIntoSheet(sheet, elementKey,
parsedStudents)`가 학번 기준으로 기존 학생 레코드에 그 요소 점수만 추가/갱신한다(다른 요소의
기존 점수는 그대로 유지 — 이게 "중간고사 넣고 저장 → 수행1 넣고 저장 → 기말고사까지" 단계적
입력을 가능하게 하는 핵심).

### 결시 인정점 — 학업성적관리규정 제23조④/⑦-1호를 그대로 코드화, 매번 전체 데이터로 다시 계산

결시 사유는 `ABSENCE_REASONS`(14개, PDF의 1~15호를 그대로 옮김 — 2번과 7호는 예시가 생략돼
합쳐짐)로 정의되고, 각각 인정비율 카테고리(`'100'`|`'80'`|`'lowest_minus_1'`)에 매핑된다.
학생의 요소별 점수칸이 비어있으면 그 칸 밑에 결시 사유 `<select>`가 나타나고, 선택하는 즉시
`computeExemptScore()`가 **자동으로** 인정점을 계산해 보여준다(사용자가 결시 사유만 고르면
다른 고사 점수를 직접 찾아 계산해줄 수 있냐고 물어서 확인된 요구사항):

1. **같은 학생의 다른 지필고사(기준고사) 점수가 있으면** — 공식④: 인정점 = 기준고사 점수 ×
   (결시고사 평균 / 기준고사 평균) × 인정비율. 두 평균 모두 **실제 응시자(결시·제외 제외)만**
   으로 계산해(`avgRawScore`) 순환계산을 막는다.
2. **기준고사가 없으면**(예: 중간고사만 입력된 시점에 중간고사 결시) — 공식⑦-1호: 그 학생의
   수행평가 누적 점수를 100점 만점으로 환산(`perfTotal100`, 그 학생이 실제 입력한 수행평가
   요소만 합산)한 값에 (결시고사 평균 / 반 전체 수행평가 100점환산 평균) × 인정비율을 곱한다.
   ⑦-1호보다 더 아래 단계(같은 학생의 다른 과목 평균, 같은 과목 다른 학생 평균)와 ⑥호(부분
   재시험)는 **범위 밖**으로 명시적으로 뺐다 — 사용자가 "그 이상으로의 인정점이 필요한 경우는
   거의 없다"고 확인했고, 수행평가 자체가 결시된 경우도 범위 밖(지필고사 결시만 다룸).
3. **"최하점의 차하점"**(미인정 결석/징계/소년원 등) — 공식이 아니라 **그 시험 실제 응시자 중
   최저점 − 1점**(0 미만이면 0)이다. 처음엔 "최저점을 가진 다른 학생의 점수"로 잘못 이해했다가
   사용자가 "최하점보다 1점 낮은 점수"라고 직접 정정해줘서 고쳤다.

**인정점은 저장된 값이 아니라 매번 전체 데이터로 다시 계산되는 값이다** — `student.scores`에
결시 사유(`absences[elementKey].reason`)만 저장하고, 인정점 자체(및 총점)는 화면을 그릴 때마다
`computeExemptScore()`/`computeWeightedTotal()`로 새로 계산한다. 그래서 중간고사 결시를 수행
평가 기반(⑦-1호)으로 처리해둔 뒤 기말고사를 입력해 기준고사가 새로 생기면, 다음 렌더링부터
자동으로 더 정확한 공식④로 바뀐다 — 사용자가 "기말고사를 봐서 새롭게 적용할 수 있는 인정점
기준이 생겼다면 업데이트하는 게 좋다"고 명시적으로 요청한 동작이다. "제외"(자퇴/전출) 체크박스는
그 학생을 수강자수·평균 계산에서 완전히 뺀다(`computeWeightedTotal`이 `excluded`면 항상
`null`을 돌려주고, `avgRawScore`/`avgPerfTotal100`도 `excluded`를 건너뜀).

### 절대평가(성취도 A~E) — 분할점수는 매번 입력, 저장하지 않음

**(정정: 이 "저장하지 않는다"는 결정은 나중에 뒤집혔다 — 맨 아래 "절대평가 분할점수 —
성적표와 함께 저장/불러오기" 섹션 참고. 분할점수가 학기 중 중간/학기말 두 번 발표되는
경우가 많아, 지금은 `grade_calc_sheets.cutoffs` 컬럼에 저장되고 불러오기 시 복원된다 —
아래 이 섹션의 "저장하지 않는다" 서술은 더 이상 사실이 아니다.)**

A/B, B/C, C/D, D/E 네 분할점수를 입력하면(`#cutoffAB`~`#cutoffDE`) `achievementLevelFor(score,
cutoffs)`가 **동점자 처리 없이** 점수만으로 A~E를 판정한다(사용자가 명시적으로 "A~E 분류는
점수만을 기준으로 하면 된다"고 확인) — 상대평가의 중간석차 같은 등급-경계 규정이 전혀 없다.
~~분할점수는 그 세션에서 입력받아 쓰고 저장하지 않는다~~(사용자가 "분할점수는 그때만 입력받으면
된다"고 명시적으로 확인했던 **원래** 결정 — 위 정정 참고), 입력을 비워두면
성취도 분포 카드(`#achievementDistCard`)가 선택사항답게 그냥 숨겨진다. 상대평가(5/9등급,
기존 `computeGrades()`를 그대로 재사용)와 절대평가는 **한 화면에 같이** 표시된다(둘 다 같은
가중합산 총점을 입력으로 공유) — 사용자가 "한 화면에서 같이 보여줄 수 있으면 좋겠다"고 요청한
대로, 모드 전환 없이 학생별 결과 표의 등급/성취도 두 칼럼이 나란히 보인다.

### 테스트

순수 계산 함수(`computeWeightedTotal`/`computeExemptScore`/`achievementLevelFor`/
`mergeScoresIntoSheet`/`parseWeightedPaste`/`totalWeight`)는 `window.__gradeEstimatePage`에
노출돼 있어(기존 단일 시험 계산기 함수들과 같은 패턴) Node에서 `window` 전역만 흉내내 바로
`require`해 검증할 수 있다 — 기준고사 있는 경우/수행평가 기반 대체/최하점의 차하점(0 바닥
포함) 세 가지 인정점 공식 분기, 가중합산 기본 케이스, 병합 시 다른 요소 점수 보존·결시 기록
자동 해제를 모두 숫자로 직접 검증했다. UI는 Playwright로 로그인 세션/`profiles.approved`/
`grade_calc_sheets` upsert를 모킹해 요소 추가 → 엑셀/붙여넣기로 점수 반영 → 결시 사유 선택 시
인정점이 화면에 바로 뜨는지(공식④, 45점으로 정확히 일치) → 상대평가·성취도 카드가 함께
나타나는지 → 저장 시 올바른 payload(`owner_id`/`year`/`subject`/학생 배열)가 나가는지까지
끝에서 끝으로 확인했다.

## `link-hub.html` — 카테고리 섹션을 고정 4열로, 카테고리 내부 자동 캡(10개 초과 시 스크롤)은 제거, 관리자가 카테고리별 높이를 직접 조절

기존 3열 그리드(위 "`link-hub.html` (업무링크 모음) — 3-column fixed grid..." 섹션 참고)는
카테고리가 많아질수록 열이 세로로 더 쌓일 뿐 가로 공간을 넓게 못 썼고, 카테고리 안의 링크가
10개를 넘으면 자동으로 390px 높이 캡+스크롤이 걸려 "전부 펼쳐서 쭉 보고 싶다"는 요청과
어긋났다. 사용자가 "모든 카테고리를 열로 펼쳐서... 프레임 작게 잡고 스크롤할 필요 없을 것
같아... 화면은 기존보다 더 넓게 써달라"고 요청했고, 코드를 바로 고치기 전에 두 가지 레이아웃
후보(A. 카테고리 수만큼 열 + 가로 스크롤, B. 고정 4열 + 넘치면 다음 줄로)를 Artifact로
나란히 비교해서 먼저 보여준 뒤, "4열로 하자"는 선택을 받아 B안으로 구현했다.

- **`#listArea`가 `repeat(3,1fr)`에서 `repeat(4,1fr)`로** — 1300px 이하에서 3열, 900px
  이하 2열, 560px 이하 1열로 줄어든다(가로 스크롤은 쓰지 않음 — B안의 핵심). `.wrap`의
  `max-width`도 `1040px` → `1680px`로 넓혔다.
- **카테고리 안 링크 10개 초과 시 자동으로 걸리던 `.link-grid-capped`(390px, 위젯 모드
  300px) 캡을 완전히 제거했다** — 기본값은 이제 "캡 없음", 링크가 몇 개든 그 카테고리가
  전부 세로로 펼쳐진다. 위젯 모드의 `body.widget-mode .link-grid.link-grid-capped{
  max-height:300px; }` 오버라이드도 함께 삭제했다(더 이상 의미가 없음 — 아래 참고).
- **그 대신 관리자가 카테고리별로 원하면 직접 높이를 조절할 수 있다** — "관리자가 세로
  높이 조절할 수 있게 해줘"라는 후속 요청. 기존 "📋 카테고리 순서 편집" 버튼을
  "📋 카테고리 순서·높이 편집"으로 넓혀 재사용했다(별도의 새 토글을 만들지 않음 — 둘 다
  관리자 전용 편집 동작이라 하나의 편집 모드 아래 묶는 게 자연스럽다). 이 모드에서 각
  카테고리의 링크 목록 바로 아래에 작은 드래그 바(`.cat-height-handle`, "⋯ 높이 조절")가
  나타나고, 위아래로 끌면(raw Pointer Events — 이 저장소의 기존 드래그앤드롭 관행과 동일,
  `my-page.html`의 `.dash-resize-height-handle`과 같은 패턴) 그 카테고리의 `.link-grid`에만
  `max-height`(60px~1600px로 clamp)가 걸리고 `overflow-y:auto`가 붙는다. 더블클릭하면 그
  캡을 다시 없앤다(원래의 "캡 없음"으로 복귀).
- **값은 `app_settings.link_hub_category_heights`**(새 `jsonb` 컬럼, 기본값 `{}`, 카테고리명
  → px 맵)에 저장된다 — `link_hub_category_order`/`collapse_defaults`와 같은 "anyone
  select, admin update" RLS를 그대로 재사용하는 사이트 전체 설정이라 별도 RLS 정책이
  필요 없었다. `loadCategoryOrder()`가 `link_hub_category_order`/`collapse_defaults`와
  함께 한 번의 쿼리로 같이 읽어온다. 카테고리 이름을 그대로 키로 쓰므로(다른 사이트 전체
  설정들과 같은 패턴 — `custom_groups`처럼 이름이 바뀌면 그 카테고리의 저장된 높이와
  연결이 끊긴다는 한계는 기존 `link_hub_category_order`도 똑같이 갖고 있던 것이라 새로
  생긴 문제는 아니다). 드래그가 끝나는 즉시(마우스를 떼는 순간) 저장되고, 별도의
  "저장" 버튼은 없다 — 카테고리 순서 드래그(`commitCategoryOrder()`)와 같은 방식.
- **"↺ 기본값 초기화" 버튼도 카테고리별 높이까지 함께 초기화한다** —
  `resetCategoryDefaults()`가 `link_hub_category_order: []`/`collapse_defaults`에서
  `linkHubCategories` 삭제와 함께 `link_hub_category_heights: {}`도 같은 요청에 묶어
  리셋한다.
- 위젯 모드(`?widget=1`)에서도 관리자가 설정한 카테고리별 높이는 그대로 적용된다(인라인
  `max-height`가 특이도상 CSS 클래스보다 항상 우선이라 별도 분기가 필요 없다) — 과거의
  "위젯 모드는 항상 300px로 캡" 하드코딩과 달리, 이제는 관리자가 정한 값(또는 캡 없음)이
  표준 페이지와 위젯 양쪽에 동일하게 반영된다. `.cat-height-handle`은
  `body.cat-editing`에서만 보이므로 위젯(학생/교사 대시보드 임베드 뷰)에는 애초에 편집
  동작 자체가 노출되지 않는다.
- `test_linkhub_4col_height.js`(새 테스트)로 (1) `#listArea`가 실제로 4열인지,
  (2) `.wrap` 폭이 1040px보다 넓은지, (3) 링크 14개짜리 카테고리가 캡 없이 전부
  렌더링되는지(기본 `link-grid-capped` 클래스 없음), (4) 편집 모드 진입 시 높이 조절
  핸들이 보이는지, (5) 핸들을 드래그하면 그 카테고리에만 `max-height`가 걸리고
  `app_settings.link_hub_category_heights`로 저장되는지, (6) 다른 카테고리는 영향받지
  않는지, (7) 더블클릭하면 캡이 초기화되고 저장값에서도 빠지는지 — 모두 검증했다. 기존
  `test_linkhub_category_cap.js`/`test_linkhub_widget_cap.js`(10개 초과 시 자동 캡을
  검증하던 테스트)는 이 설계 변경으로 더 이상 유효한 기대값이 아니다 — 자동 캡 자체를
  없앴으므로 "10개 넘으면 스크롤 가능"이라는 예전 단언은 이제 항상 거짓이 되는 게 맞다.

## `link-hub.html` 링크 카드 — 설명을 기본 2줄 표시에서 "설명까지 보기" 토글로

**(이 섹션 바로 위의 "카테고리 섹션을 고정 4열로..." 변경과 같은 시기에, 카드 자체의
높이/설명 표시 방식도 바뀌었는데 그 변경 자체는 그동안 이 문서에 기록돼 있지 않았다 —
아래에서 한꺼번에 정리한다.)** 사용자 요청: "링크 모음 목록들을 위아래 높이를 조금
크게 하고 아래 줄에 사이트에 대한 간단한 설명을 좀 넣으면 어떤가 싶은데" — 그 전까지
`.link-card`는 `.card-row`(이름+수정/삭제) 한 줄뿐이었고 설명(`l.desc`)은 이름의
`title` 툴팁으로만 숨어있었다. `.link-card`를 `flex-direction:column`으로 바꿔 세로
패딩을 늘리고, `.card-row` 아래에 `<div class="desc">`(최대 2줄,
`-webkit-line-clamp:2`)를 추가해 `l.desc`가 있으면 항상 보여주도록 했다.

**이어서 "설명까지 보기" 옵션으로 다시 바뀌었다 — 사용자 요청: "'설명까지 보기' 옵션을
만들어서 클릭하면 사이트별 설명까지 나오게 하고 꺼져있을 땐 사이트명만 나오게 해줘(이때
크기는 설명이 없을 때의 기존 크기로)".** 즉 설명을 보여줄지 말지를 선택할 수 있게 하되,
꺼진 상태의 카드 크기는 "설명 칸 자체가 차지하는 세로 공간이 아예 없던" 원래 크기와
정확히 같아야 한다는 요구 — 단순히 설명 텍스트를 지우는 게 아니라 그 칸이 차지하던
공간까지 없애야 하므로 `visibility:hidden`이 아니라 `display:none`이 필요했다.

- **순수 CSS 토글, 목록 재렌더링 없음.** `renderLinks()`의 HTML 생성 자체는 그대로
  (`l.desc`가 있으면 항상 `<div class="desc">`를 만듦) — 대신 `.link-card .desc`의
  기본값을 `display:none`으로 바꾸고, `body.lh-show-desc .link-card .desc`일 때만
  기존의 `-webkit-box`/`line-clamp:2` 스타일이 적용되도록 CSS 우선순위로 나눴다.
  토글은 그래서 `<body>`에 `lh-show-desc` 클래스 하나를 붙였다 뗐다 하는 것뿐이라
  —`renderLinks(allLinks)`를 다시 부를 필요가 없고(카테고리 펼침 상태·검색 결과
  등 현재 화면이 전혀 흔들리지 않는다), 토글 자체도 즉시 반영된다.
- **검색/필터 입력창 바로 아래, 기존 관리자 전용 버튼 행(📋 카테고리 순서·높이 편집
  등)과 같은 줄 오른쪽 끝에 `<label class="main-toggle"><input type="checkbox"
  id="descToggle">설명까지 보기</label>`를 추가했다** — 편집 폼의 "메인 노출"
  체크박스가 이미 쓰던 `.main-toggle`(작은 체크박스 + 옅은 글자) 스타일을 그대로
  재사용해, 새 CSS 없이 기존 톤과 자연스럽게 맞췄다. 이 버튼 행은 관리자 전용
  버튼들과 달리 애초에 `admin-only` 토글 로직의 영향을 받지 않는 평범한 엘리먼트라,
  "설명까지 보기"는 로그인 여부·관리자 여부와 무관하게 누구에게나 항상 보인다.
- **`localStorage['ks_linkhub_show_desc']`에 저장되는, 이 브라우저에서만 기억하는
  개인 보기 설정** — 이 페이지의 카테고리 펼침 상태·순번/이름 정렬 등 다른 여러
  "이 브라우저에서만 기억"하는 설정들과 같은 수준(사이트 전체 `app_settings`에
  저장하는 관리자 기본값이 아니다). 기본값은 꺼짐(사이트명만) — `loadShowDescPref()`
  가 페이지 로드 시 그 값을 읽어 체크박스 상태와 `body` 클래스를 함께 맞춘다.
- `test_linkhub_desc_toggle.js`(Playwright)로 (1) 처음엔 토글이 꺼져 있고
  `.desc`가 실제로 `display:none`인지, (2) 설명이 있는 카드와 없는 카드의 높이가
  토글이 꺼져 있을 때 정확히 같은지("설명이 없을 때의 기존 크기"가 그대로 유지되는지
  직접 측정해 확인), (3) 토글을 켜면 `body.lh-show-desc`가 붙고 `.desc`가 다시
  보이는지, (4) 설명 있는 카드만 더 커지고 설명 없는 카드 높이는 토글 전후로 전혀
  안 바뀌는지, (5) `localStorage`에 저장되고 새로고침 후에도 체크 상태·`body` 클래스가
  그대로 복원되는지 — 모두 확인했다.

## `grade-estimate.html` 가중합산 섹션 — 배포 후 신고받은 버그 3건(2건 수정, 1건은 버그가 아님을 확인)

실사용 중 스크린샷 2장과 함께 "제목이 겹쳐서 나오고. 중간고사만 넣었을 때도 등급과
석차가 나와야 할 것 같은데 안 나와. 성취도 입력 받는 부분이 깨져서 나와"라는 신고를
받았다.

- **버그 ①(진짜 버그, 수정함): 중간고사만 입력하면 총점/석차/등급이 전혀 안 나옴.**
  `computeWeightedTotal(student, elements, students)`가 **요소 중 하나라도** 점수/인정점이
  비어있으면 그 즉시 `null`을 돌려주던 게 원인 — 가중합산 기능 자체가 "중간고사와
  수행평가1만 넣고 중간 점검을 해보고 싶을 수도 있다"는 요구사항으로 설계됐는데(반영비율
  합이 100%가 아니어도 계산을 진행하는 기존 정책과 같은 취지), 요소를 미리 다 정의해두고
  점수를 단계적으로 채우는 실제 사용 패턴에서는 모든 요소가 채워지기 전까지 어떤 학생도
  총점이 안 나오는 결과로 이어졌다. **고쳐서** 점수/인정점이 있는 요소만 더해 부분 총점을
  계산하고(`anyCounted` 플래그로 하나도 집계된 요소가 없을 때만 `null`), 중간고사만 입력된
  상태에서도 그 요소의 반영비율만으로 총점·석차·등급이 즉시 나온다 — 나중에 기말고사/수행평가
  점수가 추가되면 재계산 시 자동으로 더 정확한(요소가 많이 반영된) 총점으로 갱신된다.
- **버그 ②(진짜 버그, 수정함): 절대평가 분할점수(A/B B/C C/D D/E) 입력칸이 찌그러져 보임.**
  `.field select, .field textarea{ width:100%; ... }` 규칙에 **plain `<input>`이 빠져있었다**
  — 이 계산기는 원래 `<select>`/`<textarea>`만 있던 화면이라 이 CSS가 작성될 때 `<input>`을
  고려할 필요가 없었는데, 가중합산 기능이 `#sheetYear`/`#sheetSubject`/`#cutoffAB`~`#cutoffDE`
  같은 plain text/number `<input>`을 여러 개 새로 들여오면서 전부 브라우저 기본 폭(~170px,
  부모 `.field`의 `flex:1` 너비와 무관)으로 렌더링돼, `.cutoff-row{display:flex}` 4칸이
  나란히 있어야 할 자리에 제각각 다른 폭으로 비좁게 찌그러져 보였다. `.field input`을
  목록에 추가하고 `box-sizing:border-box`를 같이 줘서 고쳤다 — 분할점수 4칸뿐 아니라
  학년도/과목명 입력칸도 같은 수혜를 받는다.
- **버그 ③("제목이 겹쳐서 나오고" — 실제로는 이 페이지만의 버그가 아니라, nav.js가
  모든 페이지에 띄우는 플로팅 아이콘(☰/🏠/👤, `position:fixed; top:16px;
  z-index:9998`)이 스크롤 중인 일반 콘텐츠 위에 그대로 겹쳐 보이는, 사이트 전체의 기존
  동작임을 Playwright로 재현해 확인.** 처음엔 `#weightedTable`(학생별 합산 결과 표)의
  `position:sticky; top:0` 헤더가 어떤 스크롤 상태에서 뷰포트 맨 위에 고정되면서 저
  아이콘과 겹치는 게 원인이라고 추정했으나, 실제 겹침이 일어나는 스크린샷을 여러 번
  재현해 직접 좌표를 찍어보니 **겹치는 건 `#weightedTable`이 아니라 왼쪽 칼럼의 "평가
  요소 정의" 표(`table.elements-table`, sticky 전혀 아닌 평범한 정적 콘텐츠)였다** —
  `.weighted-grid`가 왼쪽(420px)/오른쪽(1fr) 두 칼럼을 `align-items:start`로 나란히
  배치하는데, 오른쪽 칼럼(학생 수가 많으면 매우 긴 표)이 왼쪽 칼럼보다 훨씬 길어서,
  페이지를 오른쪽 칼럼의 중간쯤까지 내려 스크롤하면 그 높이에 걸리는 왼쪽 칼럼 내용이
  때마침 "평가 요소 정의" 표 헤더 부근이고, 이 화면 높이(뷰포트 y≈16~56px 부근)가 nav.js
  아이콘이 항상 떠 있는 바로 그 자리와 겹친 것뿐이다. **이건 sticky 포지셔닝의 결함이
  아니라, 어느 페이지든 스크롤 중 일반 콘텐츠가 저 아이콘들이 떠 있는 화면 좌표를 지나칠
  때마다 생기는, 사이트 어디서나 동일하게 받아들여지고 있는(다른 어떤 페이지도 이를 위해
  패딩을 추가하지 않음) 동작**이다 — 이 페이지가 유독 눈에 띈 이유는 단지 이 섹션이
  이 저장소에서 보기 드물게 넓고(2단 그리드) 긴(학생 수가 많으면 표가 매우 긺) 레이아웃이라,
  스크롤하는 동안 "읽고 있는 표 제목"이 저 좌표를 지나칠 확률이 다른 페이지보다 높아서다.
  한 표의 `top` 오프셋을 조정하는 식의 국소적 수정은 근본적으로 문제를 못 없앤다 — 왼쪽
  칼럼에만도 카드가 3개(평가 요소 정의/요소별 점수 입력/절대평가 분할점수) 있어 스크롤
  위치에 따라 그중 어느 것의 헤더든 같은 자리에 걸릴 수 있고, 오른쪽 칼럼도 마찬가지다.
  사이트 전체에 적용되는 nav.js 아이콘의 fixed 배치 자체를 바꾸지 않는 한(다른 모든
  페이지의 기존 동작을 건드리는, 이 세션의 범위를 벗어나는 변경) 고칠 수 없는 성격이라
  **수정하지 않았다** — 혹시 또 이 리포트가 들어오면, 이 섹션을 참고해 "어느 특정 표의
  sticky 버그"를 다시 의심하지 말고, 바로 이 설명을 재확인할 것.
- `test_grade_estimate_partial_total.js`(새 테스트)로 (1) 중간고사만 입력해도 반영비율
  30%만큼의 부분 총점(80→24, 70→21, 50→15)이 계산되고 석차·등급도 함께 나오는지,
  (2) 절대평가 분할점수 4칸이 모두 `.field`의 실제 폭을 꽉 채우는지, (3) 학년도/과목명
  입력칸도 같은 CSS 수혜를 받는지(회귀 확인) — 확인했고, 기존
  `test_grade_estimate_weighted.js`(모든 요소가 채워진 "완전한" 시나리오)도 다시 돌려
  회귀가 없음을 확인했다.

## `grade-estimate.html` 절대평가 성취도 — 일부 과목은 E 아래 "미도달"까지 있음 (선택 입력)

사용자 요청: "어떤 과목들은 성취도 A, B, C, D, E 다음에 미도달도 있어. 그래서 D와 E의
경계 말고도 E와 미도달의 경계도 점수를 받아야 돼. 선택 입력사항으로 E와 미도달 사이도
필요할 것 같아." — 기존 분할점수 입력은 A/B·B/C·C/D·D/E 4개뿐이었는데, 5번째로
**E/미도달 경계**를 선택 입력으로 추가했다. "선택사항"이라는 요청 그대로, 비워두면
기존과 완전히 동일하게 동작한다(D/E 미만은 전부 E) — 과목 대부분은 미도달 자체가 없기
때문에 이 입력칸이 강제되면 안 된다.

- `achievementLevelFor(score, cutoffs)`가 `cutoffs`의 5번째 값(`eMiss`, 선택)을 읽어서,
  **그 값이 유한수로 주어졌을 때만** `score < eMiss`이면 `'미도달'`을 돌려준다 — 5번째
  값이 비어있으면(`parseFloat('')` → `NaN`) 이 분기 자체가 타지 않아 기존처럼 D/E 미만은
  무조건 `'E'`.
- `currentCutoffs()`가 `#cutoffEMiss`(5번째 입력칸)까지 포함해 5개짜리 배열을 돌려주도록
  바뀌었다. `cutoffsValid()`는 필수 4개(A/B~D/E, 유한수+내림차순)는 그대로 검증하고, 5번째는
  **값이 있을 때만** D/E보다 작은지 추가로 검증한다(비어있으면 그 검사 자체를 건너뜀) —
  필수 4개가 멀쩡해야 성취도 섹션 자체가 보인다는 기존 동작(`cutoffsValid()`가 false면
  `achievementDistCard`가 안 보임)은 그대로 유지된다.
- `renderAchievementDist()`의 분포표 행 목록(`levels`)이 `Number.isFinite(cutoffs[4])`일
  때만 `'미도달'`을 끝에 추가한다 — 미도달 경계를 안 쓰는 과목(대부분)은 분포표에 쓸데없이
  0명짜리 미도달 행이 안 뜬다.
- HTML: `.cutoff-row`에 다섯 번째 `<div class="field"><label>E/미도달 (선택)</label>
  <input ... id="cutoffEMiss"></div>`를 추가하고, 안내 문구(`.hint`)에 "일부 과목은 E
  아래에 미도달이 추가로 있다"는 설명과 선택사항이라는 점을 명시했다. 바로 위 버그
  수정에서 `.field input{width:100%}`를 이미 고쳐뒀기 때문에, 5칸으로 늘어난
  `.cutoff-row`도 별도 CSS 손질 없이 고르게 폭을 나눠 가진다(`flex:1`이 이미 모든
  `.field`에 걸려 있음).
- 학생별 결과 표(`#weightedTable`)의 성취도 열은 `achievementLevelFor(total, cutoffs)`를
  그대로 호출하므로(이미 `currentCutoffs()`가 5개를 돌려주게 바뀌어서) 별도 수정 없이
  '미도달'이 자동으로 표시된다. 분할점수는 이 페이지의 다른 설정들과 마찬가지로
  **세션에서만 쓰고 저장하지 않는다**(기존 정책 그대로 — `grade_calc_sheets`에 분할점수
  칼럼 자체가 없음) — E/미도달 경계도 같은 원칙이라 저장/불러오기 쪽은 전혀 손대지 않았다.
- `test_grade_estimate_achievement_eminus.js`(새 테스트)로 (1) 미도달 경계를 비워두면
  기존처럼 D/E 미만 학생이 전부 E로 분류되고 분포표에 미도달 행이 안 뜨는지(회귀 없음),
  (2) 미도달 경계를 입력하면 그보다 낮은 점수만 미도달로 분류되고(E 구간 학생은 그대로 E)
  분포표에 미도달 행(1명)이 추가되는지, (3) 경계를 다시 비우면 원래대로 복귀하는지 —
  검증했고, 기존 `test_grade_estimate_weighted.js`/`test_grade_estimate_partial_total.js`도
  다시 돌려 회귀가 없음을 확인했다.

## `grade-estimate.html` 절대평가 분할점수 — 성적표와 함께 저장/불러오기 (정책 뒤집음: 더 이상 "세션에서만 쓰고 저장 안 함"이 아님)

이 기능을 처음 설계할 때는(위 "학기 성적 누적 관리" 섹션 참고) "분할점수는 그때만
입력받아 쓰고 저장하지 않는다"가 명시적 결정이었다 — 그런데 실제로 써보니 사용자가
"분할점수도 저장했다가 필요할때 수정하면 업데이트 하는걸로 하자. 중간분할이랑 학기말
분할 두번 나오거든"이라고 요청했다 — 분할점수가 학기 중 **중간 발표**와 **학기말 최종
발표**로 두 번 나뉘어 공지되는 경우가 많아서, 매번 새로 타이핑하는 대신 한 번 저장해두고
나중에 최종 값으로 고쳐서 다시 저장하는 흐름이 필요했다. 요소/학생 점수가 이미 "같은
학년도+학기+과목명으로 저장하면 덮어쓰기(누적 업데이트)" 방식으로 동작하는 것과 정확히
같은 패턴을 분할점수에도 그대로 적용했다.

- **`grade_calc_sheets`에 `cutoffs jsonb`(nullable) 컬럼을 추가**했다 — `[AB, BC, CD, DE,
  eMiss]` 5개짜리 배열, 입력칸이 비어있던 항목은 `null`로 저장한다(미도달 경계는 선택
  사항이라 대부분 `null`로 남는다). RLS/정책은 전혀 안 바꿨다 — `elements`/`students`와
  같은 행에 같이 저장되므로 기존 owner-only RLS를 그대로 탄다.
- **`CUTOFF_FIELD_IDS`** 상수(`['cutoffAB','cutoffBC','cutoffCD','cutoffDE','cutoffEMiss']`)
  로 다섯 입력칸 id를 한 곳에 모아, `currentCutoffs()`(읽기)와 새로 추가한
  `applyCutoffs(arr)`(쓰기 — 불러온/비운 값을 다시 입력칸에 채워 넣음) 양쪽이 같은
  목록을 공유한다.
- **`onSaveSheet()`**이 `currentCutoffs().map(v => Number.isFinite(v) ? v : null)`로
  변환한 배열을 `cutoffs` 필드에 실어 기존 `elements`/`students`와 같은 upsert
  payload에 함께 보낸다 — 분할점수 저장을 위한 별도 버튼/RPC는 없고, 기존 "저장" 버튼
  하나가 전부 같이 처리한다.
- **`onLoadSheet()`**이 `data.cutoffs || []`을 `applyCutoffs()`에 넘겨 다섯 입력칸을
  채운다(없는 칸/옛 성적표처럼 `cutoffs` 자체가 없는 경우는 전부 빈 칸으로). **`onNewSheet()`**
  도 `applyCutoffs([])`로 다섯 칸을 모두 비워서, "새로 만들기"를 누르면 이전에 불러와
  있던 분할점수가 남아있지 않게 한다.
- 안내 문구(성적표 선택 카드의 `.hint`)에 "아래 절대평가 분할점수도 이 성적표와 함께
  저장돼요 — 중간 발표 때 한 번 입력해 저장해두고, 학기말에 최종 분할점수가 나오면
  입력칸만 고쳐서 다시 저장하면 돼요"를 추가해 이 흐름을 명시적으로 안내한다.
- `test_grade_estimate_cutoffs_persist.js`(새 테스트)로 (1) 저장 시 payload에 분할점수가
  정확히 실리는지(미도달 비움=null 포함), (2) "새로 만들기"를 누르면 입력칸이 전부
  비워지는지, (3) 저장된 학년도+학기+과목으로 "불러오기"하면 저장해둔 분할점수가
  그대로 복원되는지, (4) 중간 발표 값을 학기말 최종 값(미도달 경계 포함)으로 고쳐서
  다시 저장하면 그 업데이트된 값이 payload에 실리는지, (5) 다시 불러오면 최종(학기말)
  값이 복원되는지 — 끝에서 끝으로 검증했고, 기존 가중합산 테스트 4종
  (`test_grade_estimate_weighted.js`/`test_grade_estimate_partial_total.js`/
  `test_grade_estimate_achievement_eminus.js`/`test_grade_estimate.js`)도 다시 돌려
  회귀가 없음을 확인했다.

## `grade-estimate.html` 상단(단일 시험) 계산기 — 학번↔이름 공유 명단(`student_name_roster`)

사용자 요청: "예상 등급 산출은 학생 학번 이름이 입력된 엑셀 파일을 업로드 하거나 붙여넣기
하면 이름까지 매칭되도록. 학번 이름도 저장돼 있어야겠지." 이어서 두 가지를 명시적으로
확인받았다 — (1) 점수 없이 학번+이름만 담긴 "명렬표"를 따로 업로드하는 기능도 추가할
것(나이스 "전체 학급(반번호)" 양식 자체에 이름이 없어서, 매번 반별 파일을 다 모으는 대신
명렬표 한 번으로 매칭 명단을 채울 수 있게), (2) 이 명단은 "이 브라우저에만" 저장하는 게
아니라 **학교 전체가 공유**해야 한다(로그인 기반 Supabase 저장 필요, localStorage 아님).

**(정정: 아래 문단은 이 기능이 처음 나왔을 때의 설명이고, 더 이상 사실이 아니다 —
`grade-estimate.html` 전체가 이후 로그인 게이트 페이지로 바뀌었다. 최신 상태는 바로
아래 "## `grade-estimate.html` 전체를 로그인 페이지로" 섹션을 볼 것.)**

~~이 계산기는 원래 완전한 클라이언트 전용(로그인 불필요)이었는데, 이 기능만 예외적으로
로그인을 요구한다~~ — `grade_calc_sheets`(가중합산 섹션)가 이미 같은 이유로 예외를
만든 전례를 그대로 따른 것: 학번+이름 같은 실제 학생 데이터를 다루려면 RLS로 실제
접근 제어가 필요하고, 완전 공개(누구나 읅고 쓸 수 있음)로 두기엔 적절하지 않다고
판단했다. ~~점수 계산 자체(붙여넣기/엑셀 업로드/등급 산출)는 로그인 없이 그대로
동작한다~~ — 로그인하지 않았거나 승인 전이면 명렬표 업로드 영역이 통째로 숨겨지고,
학번만 있는 입력은 매칭 시도 자체를 안 해서 그냥 "학번만" 표시된다(사용자가 먼저
확인해준 전제: "학번 내용이 없으면 그냥 학번만 표시하고 만약에 명렬표로 학번 이름까지
입력이 되면 학번 이름까지 매칭시켜서 표시"). **이 매칭 로직(`applyNameRoster` 등) 자체는
그대로 남아있다 — 바뀐 건 그 위에 씌워진 페이지 전체 게이트뿐이다.**

- **`student_name_roster` 테이블**(`student_no text primary key`, `name text not null`,
  `updated_at`, `updated_by`) — 과목과 무관하게 학교 전체에서 고정되는 학번↔이름
  매핑이라, `grade_calc_sheets`(소유자 1인 전용)와 달리 **로그인한 승인된 선생님
  전체가 함께 읅고 쓰는 공유 표**다. RLS는 select/insert/update 세 정책 모두
  `exists(select 1 from profiles where id = auth.uid() and approved = true)` 하나만
  검사 — 관리자 전용이 아니라 "승인된 교사라면 누구나"로 열어둔 것은
  `room_bookings`/`form_templates`가 이미 쓰는 "열린 협업 표" 수준의 신뢰를 그대로
  적용한 것이다. delete 정책은 없다(삭제 UI 자체가 요청되지 않았고, 잘못 들어온
  값은 다시 upsert해서 덮어쓰면 되므로 — 이 저장소의 "불필요한 걸 먼저 만들지 않는다"
  원칙).
- **`ensureAuthChecked()`**(새 공유 헬퍼, 가중합산 섹션의 기존 로그인+승인 확인 로직을
  뽑아낸 것) — `sb.auth.getSession()` + `profiles.approved` 조회를 **한 번만** 실행하고
  그 결과를 Promise로 캐시해, 가중합산 섹션(`initWeighted`)과 이 명단 섹션
  (`initNameRoster`)이 페이지 로드 시 동시에 호출해도 실제 네트워크 요청은 한 번만
  나간다. `initWeighted()`는 이 공유 함수를 쓰도록 리팩터링됐을 뿐 동작은 그대로다.
- **`parseScoreInput`**(상단 붙여넣기 칸)이 탭으로 구분된 줄의 첫 칸이 순수 숫자면
  학번으로 인식하도록 확장됐다 — "학번\t점수"(이름 없음, `hasRealName:false`) 또는
  "학번\t이름\t점수"(`hasRealName:true`). 사람 이름이 숫자로만 이뤄지는 경우가 거의
  없어서 이 구분은 안전하다. 기존 "이름\t점수"/"점수만" 입력은 전혀 영향받지 않는다
  (첫 칸이 숫자가 아니면 그대로 기존 분기).
- **`parseGenericStudentSheet(rows)`**(새 함수) — "학번"/"이름"(또는 "성명")/"점수" 열
  머리글을 가진, NEIS 전용 양식이 아닌 평범한 표를 엑셀 업로드에서 인식한다. 기존 두
  NEIS 전용 파서(그리드/반별)가 둘 다 실패했을 때만 시도하므로, 기존
  `test_grade_estimate_xlsx_upload.js`의 "반번호 형식이 아닌 엑셀은 에러"
  케이스(학번 열 자체가 없는 이름/점수 2열 시트)는 영향받지 않는다. 결과 행에
  `fromGenericRoster:true`를 붙여, 상단 텍스트영역 되돌림 시 "학번\t이름\t점수"
  3칸 형식으로 쓰도록 구분한다(그리드/반별 NEIS 양식은 기존처럼 "이름\t점수"
  2칸 유지 — 기존 테스트의 되돌림 형식 검증과 충돌하지 않게 함).
- **`parseNameRosterSheet(rows)`**/**`parseNameRosterPaste(raw)`**(새 함수, 점수 없는
  "명렬표" 전용) — 전자는 (1) "반/번호"+"성명" 헤더(NEIS 학급별 명부와 같은 모양,
  점수 열 없어도 됨 — `buildStudentNo`로 학번을 만들어 그리드/반별 파서와 **같은
  5자리 키 체계**를 쓴다)와 (2) "학번"+"이름"/"성명" 헤더 중 먼저 맞는 쪽으로 파싱,
  후자는 "학번\t이름" 붙여넣기를 파싱한다. 둘 다 `{studentNo, name}` 쌍만 돌려주고
  점수는 전혀 다루지 않는다.
- **`applyNameRoster(students)`** — 로그인+승인 상태가 아니면 아무 것도 안 하고 그대로
  돌려준다(네트워크 호출 0건, 학번만 있는 입력은 매칭 없이 학번만 표시). 승인된
  상태면 (1) 실명+학번이 함께 들어온 학생을 공유 명단에 upsert하고(fire-and-forget —
  느려도 계산 자체를 막지 않음), (2) 학번은 있지만 이름이 비어있는 학생들의 학번을
  모아 `.in()`으로 한 번에 조회해 공유 명단에서 찾은 이름으로 채운다
  (`hasRealName:true, nameFromRoster:true`로 표시). `onCalc`/`onXlsxFiles` 모두
  최종 계산(`runCalc`) 직전에 이 함수를 거친다.
- **학번+이름만(점수 없이) 등록하는 "학생 명렬표 업로드/붙여넣기" 필드**가 상단 "엑셀
  일람표 업로드" 밑, "점수 일람표 붙여넣기" 위에 추가됐다 — 엑셀(`#rosterFileInput`,
  `parseNameRosterSheet` 재사용) 또는 붙여넣기(`#rosterPasteInput`+`#btnSavePastedRoster`,
  `parseNameRosterPaste` 재사용) 둘 다 지원하고, 로그인하지 않았거나 승인 전이면
  `#rosterUploadBody` 전체가 숨겨지고 `#rosterAuthMsg`에 로그인 링크만 보인다. 저장은
  즉시 공유 명단에 upsert될 뿐 당장 화면의 계산 결과엔 반영되지 않으므로("이미 계산된
  결과에는 바로 반영되지 않으니, 다시 '등급 계산하기'를 눌러주세요" 안내), 별도의
  자동 재계산 로직은 넣지 않았다 — 이 페이지의 다른 비동기 기능들과 달리 "방금 입력한
  것과 무관한, 과거에 이미 끝난 계산"을 건드리는 부작용을 피하기 위한 의도적 단순화다.
- `#inputMsg` 바로 아래 `#rosterInfo` 한 줄이 로그인 상태에 따라 "학번만 있는 입력은
  '학번만' 표시돼요. 로그인한 승인된 선생님이면... 로그인하러 가기" 또는 "로그인됨 —
  ... 공유 명단에 자동으로 저장되고..."를 보여준다(`renderRosterInfo()`).
- `test_grade_estimate_roster.js`(새 테스트)로 (1) 순수 파싱 함수 4종의 학번 인식/회귀,
  (2) 비로그인 상태에서 명렬표 영역이 숨겨지고 학번만 있는 입력이 매칭 시도 없이
  학번만 표시되며 `student_name_roster`로 네트워크 호출이 0건인지, (3) 로그인+승인
  상태에서 학번만 붙여넣으면 공유 명단(모킹)에서 이름이 매칭되고 `.in()` 조회에
  두 학번이 정확히 실리는지, (4) 학번+이름 붙여넣기가 공유 명단에 자동 upsert되는지,
  (5) 명렬표 붙여넣기/엑셀 업로드 둘 다 성공 메시지+upsert 호출이 정확한지, 그리고
  그렇게 등록한 학번을 점수만 다시 입력해도 이름이 매칭되는지, (6) 일반 학번/이름/점수
  엑셀(비-NEIS 양식)이 인식되어 계산되고 텍스트영역 되돌림이 3칸 형식인지 — 모두
  검증했고, 기존 테스트 6종(`test_grade_estimate.js`/`test_grade_estimate_xlsx_upload.js`/
  `test_grade_estimate_class_roster.js`/`test_grade_estimate_partial_total.js`/
  `test_grade_estimate_achievement_eminus.js`/`test_grade_estimate_cutoffs_persist.js`)도
  다시 돌려 회귀가 없음을 확인했다.

## `grade-estimate.html` 전체를 로그인 페이지로

사용자가 명시적으로 요청: "그럼 예상 등급 산출 페이지도 로그인에 필요한 페이지로
만들고", 그리고 다시 한번 "그리고 예상 등급 산출 전체를 로그인 페이지로"로 재확인했다.
바로 위 `student_name_roster` 섹션이 도입될 때는 **그 기능 하나만** 예외적으로
로그인을 요구했는데(계산기 본체는 비로그인으로도 동작), 이제는 페이지 전체가
`school-status.html`/`duty.html` 류와 같은 표준 3단 게이트
(`#gateView`/`#pendingView`/`#protected-content`)로 바뀌었다 — 학생 이름·학번이
실제로 화면에 나타나는 페이지이니만큼, 그 어떤 부분도 비로그인 상태로 열어두지
않겠다는 더 단순하고 일관된 정책으로 교체한 것.

- `auth.js`/`accounts.google.com` 스크립트 태그와 예전의 비활성 `#protected-content`
  래퍼(과거 `AUTH_ENABLED=false` 관행의 흔적)를 지우고, 이 저장소의 표준 로그인/승인
  게이트 패턴(`login.html` 섹션 상단에 문서화된 그 패턴)을 그대로 심었다 —
  `#gateView`(세션 없음, 기본으로 보임)/`#pendingView`(세션은 있지만 `profiles.approved`
  가 false)/`#protected-content`(승인됨 — 실제 계산기 전체가 이 안에 있음).
- `init()`이 `ensureAuthChecked()`(학번↔이름 공유 명단 섹션이 이미 쓰던 그 메모이즈된
  헬퍼)를 **제일 먼저** `await`하고, 그 결과에 따라 세 뷰 중 하나만 보이게 전환한 뒤,
  **승인된 경우에만** `renderRatioInfoBox()`/`initWeighted()`/`initNameRoster()`를
  포함한 나머지 모든 이벤트 리스너 등록을 진행한다 — 비로그인/미승인 상태에서는
  `#scoreInput`/`#btnCalc` 등 어떤 요소에도 리스너가 붙지 않는다(엘리먼트 자체는
  DOM에 있지만 `#protected-content`가 `display:none`이라 평소엔 안 보임).
- `window.__gradeEstimatePage`(순수 계산 함수 export, 유닛 테스트용)는 `init()`과
  무관하게 스크립트 로드 시점에 항상 노출된다 — 로그인 게이트는 **UI**만 막을 뿐,
  `computeGrades`/`parseScoreInput` 같은 순수 함수를 직접 호출하는 테스트까지 막을
  필요는 없어서 그대로 뒀다.
- 이 변경으로 `student_name_roster` 섹션의 "비로그인: 명렬표 업로드만 숨겨지고
  점수 계산 자체는 된다" 는 예전 동작은 더 이상 해당되지 않는다 — 이제는 비로그인
  상태에서 계산기 자체(`#scoreInput`/`#btnCalc`)에 아예 닿지 못하므로, "학번만 입력하면
  매칭 없이 학번만 표시"되는 케이스는 (이론적으로는 코드에 남아있지만) 실제로는
  로그인하지 않은 사용자에게 전혀 노출되지 않는다.
- 8개의 기존 Playwright 테스트(`test_grade_estimate.js`,
  `test_grade_estimate_xlsx_upload.js`, `test_grade_estimate_class_roster.js`,
  `test_grade_estimate_print_export.js`, 그리고 이미 로그인을 모킹하고 있던
  `test_grade_estimate_weighted.js`/`test_grade_estimate_achievement_eminus.js`/
  `test_grade_estimate_cutoffs_persist.js`/`test_grade_estimate_partial_total.js`)를
  전부 다시 돌려 확인했다 — 앞의 4개는 세션 모킹이 없어 게이트에 막혀 깨졌으므로,
  나머지 4개가 이미 쓰던 것과 같은 `fakeSession`+`profiles.approved:true` 모킹을
  추가해 고쳤다(계산 로직 자체는 전혀 안 건드림). `test_grade_estimate_roster.js`의
  [B] 섹션("비로그인: 명렬표 숨김+계산기는 동작")도 이제 맞지 않는 전제라, "비로그인:
  `#gateView`만 보이고 계산기 자체(student_name_roster 네트워크 호출 포함)에 전혀
  닿지 못함"으로 다시 썼다. 새 `test_grade_estimate_login_gate.js`로 세 상태(세션
  없음/세션 있음+미승인/세션 있음+승인)를 전담 검증했다 — 미승인 상태를 직접
  검증하는 테스트는 이번이 처음이다.

## `school-status.html` (학교 현황) — 학교 기본정보·학년별 명렬표·학사일정

사용자가 학교 자체의 "학교 현황" Google Sheet 링크를 공유하며, 나이스 "전체 학급"
일람표에 이름이 없어 매번 반별 파일을 다 모아 올려야 하는 번거로움을 해결하고 싶다고
설명했다 — 그 시트에 이미 학년별 명렬표/반 편성/학교 기본정보가 다 정리돼 있으니,
그 내용을 사이트 안으로 가져와서 `student_name_roster`(위 섹션)의 이름 출처로 직접
쓰자는 것. 네 가지를 명시적으로 확인받았다: (1) 반영 방식은 **지금 세션에서 한 번
가져와 담아두고(일회성), 이후엔 관리자가 엑셀로 다시 업로드하는 방식** — Google
시트에 매번 실시간으로 접속하는 라이브 연동이 아니다(관리자용 "다시 가져오기"
버튼으로 재반영 가능해야 한다는 요건), (2) 이번 주 작업 범위는 반 편성(담임/부담임/
인원)과 수업일수/학사일정까지 전부, (3) 페이지 위치는 자유, (4) 탭 구조는 "학교
현황 탭 + 1~3학년 명렬표 탭 + 학사일정 탭"(사용자가 직접 음성으로 지정).

**Google 시트는 일회성 시드 소스였을 뿐, 라이브 의존성이 아니다.** 이 환경에
Google Sheets API를 직접 호출하는 MCP 도구가 없어서(`download_file_content`는
`exportMimeType`을 줘도 "구현되지 않음" 에러), `get_file_metadata`를
`snippetVerbosity: 'MAX_ALLOWED'`로 호출해 시트 전체 내용을 텍스트로 받은 뒤,
Node.js로 직접 작성한 토크나이저/검증 스크립트(`/tmp/.../scratchpad/roster_raw/
parse.js`)로 파싱해 Supabase에 한 번 밀어넣었다 — 584명(1학년 195+2학년 181+3학년
208, `select grade, count(*) from students group by grade`로 정확히 일치 확인)의
학생 행, 학교 기본정보 1행, 반 편성 21행, 학사일정(주요 행사만 요약, 전체 수업일수
그리드는 의도적으로 생략 — 이미 Google Calendar 기반 학사일정 기능과 중복되고,
병합 셀이 빽빽한 그리드를 손으로 옮기면 오류 위험이 컸다) 21행. 파싱 과정에서
실제 데이터 버그 하나를 잡았다(아래 참고) — 줄 경계가 깨지는 문제였고, 수정 후
3학년 8반이 26번을 건너뛰는 것 등 남은 불규칙은 전부 원본 데이터 자체의 특징으로
직접 확인했다. **3학년 반 편성의 `note`(비고) 컬럼만 의도적으로 비워뒀다** — 원본
CSV에서 3학년만 콤마로 묶인 복합 비고 문자열이 모호해서 안전하게 옮길 수 없었고
(1~2학년은 깔끔한 파이프 구분 표라 정확히 옮겼다), 틀린 추측보다는 빈 값이 낫다고
판단했다.

**(정정: 위 "3학년 비고는 의도적으로 비워뒀다"는 더 이상 사실이 아니다 — 사용자가
원본 "2026학년도 학교 현황" 시트의 실제 캡처 이미지를 보내줘서, 그 이미지에 보이는
3학년 8개 반의 비고 값을 Supabase에 직접 채워 넣었다.** 1반=`빙1, 직5, 특수학급1`,
2반=`빙1, 특수학급1`, 3반=`빙1, 특수1`, 4반=`직3`, 5반=`직2, 특수학급1`,
6반=`직1, 특수학급1`, 7반=`빙2, 지1, 특수학급1`, 8반=`빙2` — `class_sections`의
해당 8개 행을 `UPDATE`로 채우고 재조회해 확인했다. 이미지로 직접 원본 표를
받았으므로 콤마로 묶인 문자열을 추측해서 나눌 필요가 없었다(이미지의 각 반 칸이
이미 그 반 하나의 비고로 분리돼 있었다). 이 수정도 순수 데이터 교정이라 어떤
파일도 바뀌지 않는다(git 커밋 대상 아님) — 이 문단 자체가 그 변경을 기록해두기
위한 CLAUDE.md 수정이다.

이렇게 일회성으로 들여온 뒤, **그 이후의 유지보수는 사이트 안에서 직접 수정/
재업로드하는 것**이 설계상 기본 경로다 — Google 시트를 다시 열어 고치고 또 가져오는
흐름이 아니라, `school-status.html`의 관리자 모드가 이미 "학교 현황 자료 업로드나
수정 자체를 사이트 내에서" 하는 바로 그 기능이다(엑셀 재업로드 + 인라인 수정 폼
둘 다). 사용자가 나중에 "지금은 Google 시트에서 내용을 불러오지만... 나중에 그런
구조 그대로 사이트에... 수정 편집 사이트 내에서 하게 바꾸는 거는 어렵지 않지?"라고
물었을 때도 같은 답 — **이미 그렇게 만들어져 있다.** Google 시트는 최초 1회의
데이터 소스였을 뿐, 이후 한 번도 다시 읽지 않고 그럴 계획도 없다.

- **4개 테이블**: `school_overview`(연도별 1행 — 학교명/학교번호/전화/주소 등
  기본정보), `class_sections`(학년+반 단위 — 담임/부담임/인원/비고), `students`
  (학년+반+번호+이름 — `student_name_roster`가 쓰는 것과 같은 5자리 `buildStudentNo`
  키 체계를 그대로 공유), `academic_events`(날짜+제목+설명, 주요 행사 요약). RLS는
  네 테이블 모두 같은 모양 — `select`는 승인된 교사 전체(`exists(select 1 from
  profiles where id=auth.uid() and approved=true)`), `insert`/`update`/`delete`는
  관리자만(`current_user_is_admin()`). `student_name_roster`가 "승인된 교사 누구나
  쓸 수 있는" 더 열린 RLS였던 것과 의도적으로 다르다 — 이쪽은 학교 전체의 공식
  현황 데이터라 쓰기는 관리자로 좁혔다(읽기는 둘 다 승인된 교사 전체).
- **탭 구조**: `#tabOverview`/`#tabGrade1`/`#tabGrade2`/`#tabGrade3`/`#tabEvents`
  (사용자가 지정한 순서 그대로), 다른 탭 UI(room-booking.html의 `.rb-tabs` 등)와
  같은 "하나만 보이게 토글" 패턴. 로그인+승인 게이트는 이 저장소의 표준 3단
  (`#gateView`/`#pendingView`/`#protected-content`) 패턴을 그대로 썼다.
- **학년별 명렬표 탭**: 이름/학번/반/번호 검색 필터(클라이언트 사이드), 그리고
  "📋 공유 명단에 반영" 버튼(`onSyncRoster`) — 그 학년 전체 학생을
  `student_name_roster`에 upsert해서, `grade-estimate.html`의 학번↔이름 매칭이
  바로 이 데이터를 쓸 수 있게 한다. 이게 이 페이지가 만들어진 근본 이유다: 나이스
  반별 파일을 매번 모아 올리는 대신, 학교 현황에 이미 있는 명렬표를 한 번
  동기화해두면 모든 과목의 모든 선생님이 그 매칭을 재사용한다.
- **관리자 전용 재업로드**: 학년별 탭마다 "엑셀 양식 다운로드"(현재 그 학년 데이터로
  미리 채워진 템플릿, `room-booking.html`/`staff-edit.html`과 같은 "현재 값을
  선반영한 템플릿" 관행) → 수정 → "엑셀 올리기" → 파싱 미리보기("N명으로 OO학년
  전체 명렬표를 덮어씁니다 — 기존 M명은 전부 지워지고...") → 확인 버튼을 누르면
  그 학년 범위에서 `delete` 후 `insert`(전체 교체, 부분 병합 아님 — 명렬표는
  "현재 상태의 정확한 스냅샷"이어야 하므로 merge보다 replace가 맞다고 판단).
  `school_overview`도 같은 관리자 모드 안에 인라인 수정 폼이 있다(`onSaveOverview`,
  단순 `update`). **"🔑 관리자 모드" 버튼**(`#btnAdminMode`)이 `staff-edit.html`/
  `duty.html`과 같은 패턴으로 이 모든 관리자 전용 카드(`#overviewAdminCard`,
  학년별 `#gradeAdminCard${g}` 세 개)를 한 번에 드러낸다 — `is_admin` 확인 후에만
  버튼 자체가 보인다.
- **버그 하나 발견·수정**(테스트로 잡힘): 엑셀 업로드 확인 핸들러가 성공/실패
  메시지를 `await loadGradeRoster(grade)` **이전에** DOM에 써넣고 있었는데,
  `loadGradeRoster`가 곧바로 `renderGradeTab`으로 그 탭 전체를 다시 그리면서
  (빈 `uploadMsg` div 포함) 방금 쓴 메시지를 조용히 지워버렸다 — 메시지를
  `loadGradeRoster` **완료 후**, 다시 쿼리한 `el('uploadMsg'+grade)`에 쓰도록
  순서를 바꿔 고쳤다.
- `nav.js`에 `room-booking.html` 다음 항목으로 추가(`group: '업무 도구'`,
  `loginRequired: true`), `index.html`에도 `link-hub.html` 타일 바로 앞에 짝이
  되는 타일을 추가했다(nav.js의 href-group DOM 순서 일치 관행).
- `test_school_status.js`로 비로그인/미승인/승인 세 게이트 상태, 학교 기본정보·
  반 편성 렌더링, 학년 탭 전환, 명렬표 검색 필터, "공유 명단에 반영" 호출, 학사일정
  탭, 그리고 관리자 모드의 기본정보 수정 저장/엑셀 재업로드(미리보기 문구, delete→
  insert 호출, 업로드 후 성공 메시지)까지 끝에서 끝으로 검증했다.

## `school-status.html` — Google 시트 연동 UI(주소 저장/변경) + 반 편성·학사일정 엑셀 재업로드

사용자가 데이터 갱신 방법으로 세 가지를 명시적으로 요청했다: "① Google 시트 주소를
저장하고 그 저장된 주소에서 불러오는 방법, ② 시트 주소가 바뀌면 바뀐 주소를 넣으면
그 새 주소에서 불러오는 방법, ③ 시트에서 불러오지 않고 페이지 내에서 자체적으로
수정하거나 엑셀을 업로드하는 방법." 이어서 두 가지를 확인받았다 — (1) 저장된 주소를
"다시 불러올" 때 기대하는 시트 형식은 **원래 학교가 쓰던 복잡한 형식이 아니라, 지금
이미 만들어둔 엑셀 업로드 양식과 똑같은 간단한 표 형식**(권장) — 그래야 파싱 로직을
새로 안 만들고 그대로 재사용할 수 있고, 시트 레이아웃이 조금만 바뀌어도 깨지는 위험이
없다. (2) Google 시트는 브라우저가 CORS 때문에 직접 읽을 수 없어 Apps Script를
거쳐야 하는데, 그 배포는 지금 당장은 하지 않고 **UI(주소 저장·변경, 엑셀 업로드·
직접 수정)부터 먼저** 완성한다 — `room-booking.html`의 `CALENDAR_SCRIPT_URL`/
`food-map.html`의 `KAKAO_JS_KEY`와 같은 "아직 설정 안 됨" 플레이스홀더 관행 그대로.

- **`school_overview.source_sheet_url`**(새 nullable `text` 컬럼) — 연도별로 저장되는
  Google 시트 주소. 기존 `school_overview_write_admin`(관리자만 쓰기)/
  `school_overview_select_approved`(승인된 교사 전체 읽기) RLS를 그대로 타므로 새
  정책이 필요 없었다.
- **"🔑 관리자 모드" → 학교 기본정보 수정 카드 하단에 "Google 시트 연동" 섹션**이
  새로 생겼다 — `#editSheetUrl` 입력칸 + "주소 저장"(`onSaveSheetUrl`, `source_
  sheet_url`만 upsert — 학교 기본정보 저장(`onSaveOverview`)과는 별개 버튼이라 섞여
  덮어쓰지 않는다) + "🔄 저장된 주소에서 다시 불러오기"(`onSyncFromSheet`).
  `onSyncFromSheet()`는 입력칸의 현재 값이 저장된 값과 다르면 **먼저 그 새 주소로
  저장**(②)한 뒤 불러오기를 시도한다 — 바뀌지 않았으면 그대로 저장된 주소에서(①).
  둘을 하나의 버튼으로 합친 이유: "저장된 주소에서 불러오기"와 "바뀐 주소로
  저장 후 불러오기"는 사용자 입장에서 "그냥 지금 입력칸에 있는 주소로 다시
  불러와줘"라는 같은 동작이라, 버튼을 둘로 나누면 오히려 더 헷갈린다.
- **`SCHOOL_STATUS_SCRIPT_URL`**(플레이스홀더 상수, `'YOUR_SCHOOL_STATUS_SHEET_
  SCRIPT_URL'`) — `schoolStatusScriptMissing`이 `true`인 동안 `onSyncFromSheet()`은
  실제 네트워크 요청을 전혀 보내지 않고 "주소는 저장했어요. 다만 시트를 실제로
  읽어오는 연동(Apps Script)이 아직 설정되지 않았어요 — 그 전까지는 아래 엑셀 양식
  다운로드/올리기나 이 페이지의 직접 수정으로 갱신해주세요"라는 안내만 보여준다
  (③으로 안내). 나중에 전용 Apps Script를 배포해 이 상수만 채우면, 이미 짜여 있는
  `fetch(SCHOOL_STATUS_SCRIPT_URL, {method:'POST', body:{action:'fetchSchoolStatus
  Sheet', url}})` 경로가 그대로 살아난다 — UI/주소 저장 로직은 이미 완성돼 있어서
  추가 작업 없이 연동만 끼워 넣으면 된다.
- **반 편성(`class_sections`)과 학사일정(`academic_events`)에도 학생 명렬표와 똑같은
  "엑셀 양식 다운로드(현재 값 포함) → 올리기 → 미리보기 → 확인 → 전체
  delete-then-insert" 패턴을 추가했다** — 이 두 테이블은 이전까지 조회만 가능하고
  관리자가 사이트 안에서 고칠 방법이 전혀 없었다(③ 요구사항의 빈틈이었다). 반 편성은
  1~3학년 전체를 한 번에(학년/반/담임/부담임/인원/비고 여섯 열), 학사일정도 전체를
  한 번에(시작일/종료일/대상학년/내용 네 열, `parseDateCell()`이 `YYYY-MM-DD` 문자열과
  엑셀 Date 객체 둘 다 받아들인다) 덮어쓴다 — 학생 명렬표처럼 학년별로 쪼개지 않은
  것은, 두 테이블 모두 전체 규모가 작아서(21개 반, 사용자가 쓴 주요 행사 수십 건)
  학년별로 나눠봐야 관리 이점이 없기 때문이다. `wireAdminMode()`의 "🔑 관리자 모드"
  토글이 `sectionsAdminCard`/`eventsAdminCard`도 기존 `overviewAdminCard`/
  `gradeAdminCard1~3`과 함께 한 번에 보이게 한다.
- `test_school_status.js`에 [E] 섹션을 추가해 (1) 주소 저장 성공 메시지와 실제
  upsert payload, (2) Apps Script 미설정 상태에서 "다시 불러오기"가 실제 fetch 없이
  안내만 보여주는지, (3) 빈 주소로 누르면 에러, (4) 반 편성 엑셀 업로드 미리보기·
  반영·delete/insert 호출, (5) 학사일정 엑셀 업로드(종료일 없는 1일짜리 일정 포함)
  미리보기·반영·delete/insert 호출까지 검증했다 — 기존 [A]~[D] 섹션도 다시 돌려
  회귀가 없음을 확인했다.

## `school-status.html` — 반 편성(학년별 반 편성) 데스크탑 레이아웃: 학년당 1행(가로 한 줄)

사용자 요청: "데스크탑 모드에서 반편성은 한 학년이 한 줄에 모두 나오게 해줘. 1,2,3학년
총 3개의 행으로 배열." 기존 `.sections-grid`는 `display:grid; grid-template-columns:
repeat(auto-fit, minmax(160px,1fr))`라, 반 수가 많은 학년(예: 8~9개 반)은 카드 폭이
160px 밑으로 안 줄어드는 한 한 줄에 다 못 들어가고 2줄 이상으로 흘러내렸다.

`@media (min-width:821px)`(이 저장소의 모바일-스택 기준 breakpoint와 동일한 폭) 안에서만
`.sections-grid`를 `display:flex; flex-wrap:nowrap; overflow-x:auto`로 바꾸고, 각
`.section-card`를 `flex:1 1 0; min-width:120px`로 설정했다 — 반이 몇 개든 한 줄(가로)에
배치되고, 카드 수가 적으면 `flex-grow`로 균등하게 늘어나 빈 공간을 채우고, 카드 수가
많아 `min-width:120px`보다 더 줄어들어야 하는 경우에만 가로 스크롤이 생긴다(완전히
안 보이는 것보다 스크롤로라도 한 줄 안에 유지하는 쪽을 선택). 모바일(821px 이하)은
기존 `grid`/`auto-fit` 그대로 둬서 좁은 화면에서는 여전히 자연스럽게 줄바꿈된다 — 이
요청이 "데스크탑 모드에서"로 명시했으므로 모바일 동작은 건드리지 않았다. 학년별로
별도의 `h3`+`.sections-grid` 블록이 이미 존재했으므로(`renderOverview()`), 이 CSS
변경만으로 "1,2,3학년 총 3개의 행"이 자연스럽게 만들어진다 — 별도의 JS 변경은
필요 없었다. `test_school_status_sections_row.js`(새 테스트)로 반 수가 각기 다른
(9/7/8개) 1~3학년을 데스크탑 폭(1280px)에서 렌더링해 세 학년 모두 카드들의
`top` 좌표가 전부 동일한(=한 줄) 것을 확인했고, 모바일 폭(390px)에서도 에러 없이
정상 렌더됨을 확인했다.

## `school-status.html` — 명렬표: 전출·자퇴 학생 취소선 + 데스크탑에서 학년당 한 줄

사용자가 원본 Google 시트 스크린샷(전출/자퇴 학생의 번호·이름에 취소선이 그어져 있는
"1학년 전체 명렬표" 시트, 반마다 열로 나란히 배치된 "2026학년도 학교 현황" 시트)을
보여주며 두 가지를 요청: "명렬표도 기존 전출 자퇴에는 취소선 그어주고, 명렬도 학년의
모든 반을 행바꾸지 않고 한번에 나오게." 바로 앞 세션에서 반 편성(`class_sections`)에만
적용했던 "데스크탑에서 학년당 한 줄" 레이아웃을 명렬표(`students`)에도 그대로 적용하고,
전출/자퇴 등 비고가 있는 학생의 취소선 표시를 새로 추가했다.

- **취소선**: `renderGradeTab()`의 학생 행 템플릿에서 이름 칸에 `class="name"`을 새로
  붙이고(기존엔 클래스 없는 plain `<td>`), `tr.departed td.no, tr.departed td.name{
  text-decoration:line-through; }`를 추가했다 — **비고(`td.note`) 칸 자체는 취소선을
  긋지 않는다**, 전출 사유 텍스트는 그대로 읽혀야 하기 때문(스크린샷의 대부분 행도
  번호·이름만 취소선이고 비고는 일반 텍스트). `tr.departed`의 기존 `opacity:0.55`는
  유지했다(0.6으로 아주 살짝만 조정) — 취소선과 옅은 명도를 함께 써서 "이 학생은 더 이상
  재학 중이 아니다"를 두 가지 시각 신호로 보여준다.
- **명렬표도 데스크탑 한 줄 배치**: `.roster-grid`(학년 하나의 반 카드들을 담는 컨테이너)
  에 반 편성과 같은 `@media (min-width:821px)` 패턴을 적용했다 — 다만 반 편성 카드와는
  달리 **폭을 줄이지 않는다**(`flex:0 0 230px`, 반 편성의 `flex:1 1 0; min-width:120px`와
  차이) — 반 편성 카드는 담임/부담임/인원 몇 줄뿐이라 좁아져도 읽히지만, 명렬표 카드는
  학생 이름이 쭉 나열된 표 전체가 들어있어 폭이 줄면 바로 안 읽히게 된다. 그래서 카드
  폭은 고정하고, 반 수가 많아 한 화면에 다 안 들어가면 `overflow-x:auto`로 가로
  스크롤되게 했다(반 편성처럼 "줄어들다가 필요하면 스크롤"이 아니라 "항상 고정폭 +
  필요하면 바로 스크롤"). `align-items:flex-start`도 추가해, 반마다 학생 수가 달라
  카드 높이가 제각각이어도 모든 카드가 위쪽 기준으로 나란히 정렬된다(flex 기본값인
  `stretch`였으면 가장 긴 카드 높이에 맞춰 짧은 카드들까지 억지로 늘어나 보였을 것).
  모바일(821px 이하)은 기존 `grid`/`auto-fit` 줄바꿈 그대로 유지.
- `test_school_status_roster_row.js`(새 테스트)로 1학년 7개 반(반마다 전출 학생 1명
  포함) 데스크탑 렌더링에서 (1) 카드 7개가 모두 같은 `top` 좌표(한 줄)에 있는지,
  (2) 전출 학생의 번호·이름 칸에 `text-decoration-line: line-through`가 실제
  computed style로 적용되는지, (3) 비고 칸은 취소선이 없는지, (4) 재학 중인 학생은
  취소선이 전혀 없는지(회귀 없음), (5) 모바일 폭에서도 카드 7개가 에러 없이 정상
  렌더되는지 — 모두 확인했고, 기존 `test_school_status.js`/
  `test_school_status_sections_row.js`도 다시 돌려 회귀가 없음을 확인했다.

## 학번↔이름 매칭을 `student_name_roster` 수동 반영에서 `students` 자동 조회로 전환 + 전출·자퇴 제외 + 관리자 모드 버튼 가시성 버그 수정

세 가지를 한 번에 요청받았다: (1) "전출 자퇴는 예상 등급에 매칭 했을 때 카운트 되지
않아야해", (2) "명렬표는 반영을 누르는 기능이 필요없어. 예상 등급 산출에서 학번이
입력되면 자동으로 이 이름을 끌어오면 돼", (3) "지금 관리자 모드 버튼을 눌러도 아무런
변화가 없어."

### (2) `school-status.html`의 "👤 공유 명단에 반영" 버튼 제거 + `grade-estimate.html`이 `students`에서 직접 자동 매칭

이전엔 관리자가 `school-status.html`의 각 학년 탭에서 "공유 명단에 반영" 버튼을 눌러야만
그 학년 명렬표가 `student_name_roster`(grade-estimate.html이 읽는 보조 명단)로 복사됐다
— 사용자는 이 수동 단계 자체가 불필요하다고 판단했다: `students`(학교 전체 공식 명렬표)가
이미 있으니, `grade-estimate.html`이 학번을 입력받는 순간 **그 테이블에서 직접** 이름을
끌어오면 되고, 중간에 복사해두는 캐시 단계가 필요 없다는 것.

- `school-status.html`: `onSyncRoster()` 함수, "👤 공유 명단에 반영" 버튼, `#syncMsg${grade}`
  div를 전부 제거했다. 각주 텍스트도 "반영 버튼을 눌러주세요"에서 "학번을 입력하면
  자동으로 이름을 끌어와요 — 따로 반영 버튼을 누를 필요가 없고, 전출·자퇴 학생은 자동으로
  계산에서 제외돼요"로 바꿨다.
- `grade-estimate.html`의 `applyNameRoster(students)`가 **1순위로 `students` 테이블을
  직접 조회**(`fetchSchoolRosterMap()`, `select('grade,class_no,no,name,note')` 전체를
  한 번에 읽어 `buildStudentNo()`로 학번 키를 만든 맵으로 변환 — 이 테이블은 이미
  "승인된 교사 전체 읽기" RLS라 추가 권한 변경이 필요 없었다), 거기서도 못 찾은 학번만
  **2순위로 기존 `student_name_roster`**(보조 명단 — 학교 현황에 아직 없는 학번을 직접
  업로드/붙여넣기한 실명으로 메꿔주는 용도, 이 기능 자체는 그대로 유지)에서 찾는다.
  `student_name_roster`로의 자동 저장(`upsertRosterNames`, 실명이 함께 입력된 경우)도
  그대로 유지했다 — 두 테이블을 번갈아 쓰는 게 아니라, `students`가 모르는 학번을 위한
  **보완 경로**로 공존한다.

### (1) 전출·자퇴 학생은 매칭돼도 계산에서 완전히 제외(카운트 안 됨)

"비고"는 전출/자퇴처럼 더 이상 재학 중이 아님을 뜻하는 경우도 있지만, 하키부/특수학급
같은 단순 정보 태그인 경우도 있다(둘 다 재학 중) — `isDepartedNote(note)`
(`/전출|자퇴/.test(...)`, `school-status.html`과 `grade-estimate.html` 양쪽에 같은
정의로 복제) 헬퍼로 두 경우를 구분한다. `applyNameRoster()`는 입력된 학번이
`students`에서 매칭되고 그 매칭이 `isDepartedNote(note)`이면, 이름을 채우는 대신 **그
점수 행 자체를 결과 배열에서 제거**한다(단순 필터, `computeGrades()`에 아예 안 들어가므로
수강자수·석차·등급컷 전부 자동으로 그 학생을 빼고 계산된다) — `lastExcludedDeparted`
(모듈 스코프 배열, `{studentNo, name}`)에 기록해두고, `runCalc()`의 성공 메시지에
"(전출·자퇴로 표시된 N명은 계산에서 제외했어요: 이름1, 이름2)"로 보여준다. 명단에
아예 없는 학번(단순히 못 찾은 경우)은 전출/자퇴와 다르게 **제외하지 않는다** — 매칭
안 됨(학번만 표시)과 제외됨(전출/자퇴 확인됨)은 서로 다른 상태라서 구분했다.

### 이전 세션에서 추가한 취소선도 같은 기준으로 고쳐졌다

직전 세션에서 "비고가 있으면 취소선"으로 구현했던 게 너무 넓은 조건이었다(하키부 같은
단순 태그도 취소선이 그어졌을 것) — `school-status.html`의 `renderGradeTab()`도
`isDepartedNote(s.note)`로 바꿔, 전출/자퇴만 취소선이 그어지고 하키/특수학급 등은
정상 표기로 남는다.

### (3) `school-status.html` "🔑 관리자 모드" 버튼이 눌러도 반응 없던 버그

원인: `#btnAdminMode` 버튼이 **항상 보이는 상태**였는데, 클릭 리스너는
`wireAdminMode()` 안에서 `if(!myIsAdmin) return;` 가드를 통과해야만 붙었다 — 즉
관리자가 아닌 계정(또는 `profiles.is_admin`이 실제로 `false`인 계정)에게는 버튼이
멀쩡해 보이지만 눌러도 아무 리스너가 없어 조용히 아무 일도 안 일어났다. `staff-edit.html`/
`duty.html`/`admin-tools.html`이 이미 쓰고 있는 "비동기 관리자 확인이 끝난 뒤에만 버튼을
드러낸다" 패턴을 그대로 적용해 고쳤다 — HTML에서 `#btnAdminMode`에 `style="display:none"`
을 기본으로 주고, `init()`이 `profiles.is_admin`을 확인한 직후(`myIsAdmin = true`일
때만) `el('btnAdminMode').style.display = ''`로 드러낸다. 이제 비관리자는 그 버튼
자체를 아예 볼 수 없어서 "눌러도 반응 없음"이라는 혼란이 생기지 않고, 실제 관리자는
버튼이 보이는 순간부터 바로 정상 동작한다.

### 테스트

`test_grade_estimate_school_roster.js`(새 테스트)로 학번 5개(재학생/단순 태그 학생/
전출 학생/자퇴 학생/명단에 없는 학번)를 한 번에 입력해 (1) `students` 테이블로 실제
조회가 나가는지(자동 매칭 확인), (2) 결과 행이 5명이 아니라 3명(전출·자퇴 제외)인지,
(3) 전출·자퇴 학번은 결과 테이블에 아예 없는지, (4) 재학생/단순 태그 학생은 이름이
정상적으로 채워져 포함되는지, (5) 명단에 아예 없는 학번은 제외되지 않고 "학번만"으로
남는지, (6) 성공 메시지가 올바른 인원수와 제외된 학생 이름을 보여주는지 — 모두
검증했다. `test_school_status.js`도 "공유 명단 반영" 버튼 테스트를 제거하고 대신
(a) 비관리자에게 "관리자 모드" 버튼이 아예 안 보이는지, (b) 전출 학생은 취소선이
그어지고 "하키" 같은 단순 태그 학생은 취소선이 없는지로 바꿔 검증했다 — 기존
`test_grade_estimate_roster.js`/`test_school_status_sections_row.js`/
`test_school_status_roster_row.js`도 다시 돌려 회귀가 없음을 확인했다.

## `grade-estimate.html` 학기 성적 누적 관리 — 저장된 성적표도 학교 명단으로 이름 자동 매칭 + 학년도·과목 드롭다운

**문제 1: 가중합산(학기 성적 누적 관리) 섹션은 바로 위 섹션의 자동 매칭 작업과 전혀
무관했다.** 사용자가 스크린샷("학생별 합산 결과" 표의 이름 칸이 전부 비어있음)과 함께
"낮에 만들었던 성적 산출 내역에는 지금 명단표가 올라갔는데 이름이 안 나와. 기존에
이미 만들어져서 그런가"라고 물었다 — 코드를 다시 읽어보니 실제로 그랬다: 위 섹션에서
추가한 `fetchSchoolRosterMap()`/`applyNameRoster()`는 **상단의 단일 시험 계산기**
(`onCalc()`/`onXlsxFiles()`)만 거치는 함수였고, 가중합산 섹션은 완전히 별개의 코드
경로(`onLoadSheet()`/`onApplyElementScores()`/`onWeightedXlsxFiles()`)를 쓰고 있어서
그 자동 매칭 로직을 호출하는 곳이 단 한 군데도 없었다 — NEIS 그리드 양식 업로드는
애초에 이름이 없는 형식이라, 가중합산에 올린 성적표는 "기존에 이미 만들어져서"가
아니라 **단순히 이름을 채워주는 코드가 아예 연결돼 있지 않아서** 항상 빈 칸이었다.

`applyWeightedNameRoster()`(새 함수)가 그 연결을 메운다: `currentSheet.students`를
순회하며 `fetchSchoolRosterMap()`(이미 있는, `students` 테이블을 직접 조회하는 헬퍼)
으로 찾은 학번에 대해 — 전출·자퇴로 표시돼 있으면 `rec.excluded = true`로 바꾸고,
아니면(재학 중) 이름이 비어있을 때만 `rec.name`을 채운다. **상단 계산기의
`applyNameRoster()`와 의도적으로 다르게 설계했다**: 상단 계산기는 전출·자퇴 학생을
결과 배열에서 물리적으로 제거하지만, 가중합산은 요소별 점수 입력을 계속 들고 있다가
나중에 교사가 직접 고칠 수도 있는 "성적표"라서 행 자체를 지우면 되돌릴 방법이 없다 —
대신 가중합산 표에 이미 있던 `excluded`(제외) 체크박스(제외된 학생은 석차/등급 계산에서
빠지지만 행은 그대로 남아있고, 체크 해제하면 즉시 되돌릴 수 있음)를 자동으로 켜주는
쪽을 택했다. `applyWeightedNameRoster()`는 세 곳(`onLoadSheet()`, 요소별 점수 반영
`onApplyElementScores()`, 엑셀 업로드 `onWeightedXlsxFiles()`) 모두에서 점수/학생
목록이 갱신될 때마다 호출돼, 불러오기 직후든 방금 점수를 반영한 직후든 항상 최신
이름/제외 상태가 맞춰진다.

**문제 2: 성적표를 불러올 때 학년도+학기+과목명을 매번 정확히 다시 타이핑해야 했다.**
사용자 요청: "성적 산출 내역을 누적 관리를 불러올 때 학년도랑 학기 과목은 이미 입력되어
있는 과목이 있다면 드롭다운으로 보여주면 될 것 같은데. 학년도도." `loadSheetChoices()`
(새 함수)가 로그인한 교사 본인의 `grade_calc_sheets` 전체를 `year,semester,subject`만
가볍게 조회해(`owner_id` 필터, RLS는 기존 그대로) `savedSheetChoices`에 저장하고,
`renderSheetChoiceUI()`가 두 가지를 채운다 — (1) `#sheetQuickPick`(새 드롭다운, "2026학년도
2학기 · 화법과 언어" 식의 라벨, 선택하면 세 필드를 한 번에 채우고 바로 `onLoadSheet()`를
호출)은 저장된 성적표가 하나도 없으면 아예 숨겨지고(`display:none`), (2) `#sheetYear`/
`#sheetSubject`는 평소처럼 자유 입력 `<input>`으로 남긴 채 `<datalist>`(`sheetYearOptions`/
`sheetSubjectOptions`, 저장된 값들의 중복 제거 목록)만 덧붙여 자동완성 힌트를 준다 —
"직접 입력도 여전히 가능해야 한다"는, 이 저장소의 `<input list="...">` 관행을 그대로
따랐다. `loadSheetChoices()`는 로그인 직후(`initWeighted()` 끝)와 저장 성공 직후
(`onSaveSheet()`)에 호출돼, 새로 저장한 성적표가 곧바로 드롭다운/자동완성 후보에
나타난다.

### 테스트

순수 로직은 Node에서 `window.__gradeEstimatePage`로 바로 검증했다(수동 계산):
학생 2명(이름 없음+전출 표시 학번, 이름 없음+재학 학번)에 대해 `students` 테이블
모킹 응답을 넣고 `applyWeightedNameRoster()`를 실행 — 재학 학생은 이름이 채워지고
`excluded`는 그대로 `false`, 전출 학생은 이름은 안 건드리고 `excluded`만 `true`로
바뀌는지 확인했다. UI는 Playwright로 (1) `onLoadSheet()`가 불러온 성적표의 빈
이름 칸이 학교 명단 모킹 응답으로 채워지는지, (2) 전출 학생은 제외 체크박스가
자동으로 켜지는지, (3) 저장된 성적표가 2개 이상일 때 `#sheetQuickPick`에 두 옵션이
모두 보이고 그 중 하나를 고르면 세 필드가 채워지고 자동으로 다시 불러와지는지,
(4) 저장된 성적표가 하나도 없으면 드롭다운 필드 자체가 숨겨지는지, (5) 저장 직후
`#sheetYear`의 `<datalist>`에 그 학년도가 새로 추가되는지 — 모두 검증했다. 기존
`test_grade_estimate_weighted.js`/`test_grade_estimate_cutoffs_persist.js`도 다시
돌려 회귀가 없음을 확인했다.

## `grade-estimate.html` 학기 성적 누적 관리 — 스티키 헤더가 스크롤 중 데이터와 겹쳐 보이는 버그

**증상**: "학생별 합산 결과" 표(`#weightedTable`)를 세로로 스크롤하면, 맨 위에 고정돼
있어야 할 제목 행(중간고사/기말고사/수행평가 등)이 그 아래로 지나가는 데이터 행의
내용(결시 사유 드롭다운 등)과 시각적으로 겹쳐 보였다 — 사용자 스크린샷이 정확히 이
증상을 보여줬다.

**원인**: `position:sticky`를 쓴 `<th>`와 `border-collapse:collapse`를 함께 쓸 때
생기는, 잘 알려진 크로미움 렌더링 결함이다 — `border-collapse:collapse`는 인접한
셀들의 테두리를 하나로 합치기 위해 브라우저가 셀 경계를 특별하게 다시 계산하는데,
이 계산 방식이 `position:sticky`로 고정된 헤더 셀의 배경이 스크롤 중 매 프레임
완전히 다시 칠해지는 것을 방해해서, 그 아래로 지나가는 내용이 헤더의 배경을 뚫고
비쳐 보이는(bleed-through) 결과를 낳는다. 두 테이블(`table.result-table` — 상단
단일 시험 계산기, `table#weightedTable` — 가중합산)이 둘 다 `position:sticky` +
`border-collapse:collapse`를 쓰고 있어서, 사용자 스크린샷은 가중합산 쪽만 보여줬지만
같은 버그가 상단 테이블에도 잠재해 있어 둘 다 함께 고쳤다.

**고쳐서**: 두 테이블 모두 `border-collapse:collapse`를 `border-collapse:separate;
border-spacing:0;`로 바꾸고(이 테이블들은 애초에 `border-bottom`만 쓰고 좌우 테두리는
없어서, `separate`로 바꿔도 겉보기엔 전혀 달라지지 않는다 — 이중 테두리 같은 부작용이
생길 요소가 없음), `th`에 `z-index:1`을 추가해 스크롤되는 `td` 콘텐츠보다 항상 위에
그려지도록 안전장치를 더했다. `border-collapse:separate`로 바뀐 뒤에는 `position:sticky`
가 셀 경계 재계산의 영향을 받지 않아 매 프레임 배경이 온전히 다시 칠해지므로, 비쳐
보임 현상 자체가 사라진다.

**검증 방법**: 이 버그는 DOM 구조 단언만으로는 증명할 수 없는 순수 시각적 버그라,
Playwright로 30명 분량 데이터를 입력해 표를 스크롤한 상태에서 `#weightedTableWrap`
엘리먼트를 직접 스크린샷으로 캡처해 비교했다 — (1) 수정 전 CSS(`border-collapse:
collapse`, `z-index` 없음)로 되돌린 임시 사본을 별도 포트(8804)로 띄워 같은 스크롤
시나리오를 재현한 스크린샷에서는 실제로 헤더 영역에 그 아래 학생(10006) 행의 "결시
사유 선택" 드롭다운 일부가 겹쳐 보이는 것을 확인했고, (2) 실제 수정이 적용된 파일의
동일 스크린샷에서는 헤더가 깨끗한 단색 배경으로 그 아래 행(10006)을 완전히 가리고,
스크롤된 다음 행(10007)부터 정상적으로 잘려 보이는 것을 확인했다 — 수정 전/후를 같은
조건(같은 데이터, 같은 스크롤 위치)에서 나란히 비교해 원인 진단과 수정 효과를 모두
과학적으로 확인한 것. 임시 사본과 비교용 스크린샷은 검증 후 삭제했다.

## `grade-estimate.html` 학기 성적 누적 관리 — 학생별 합산 결과 표 칸 제목 클릭 정렬(오름차순↔내림차순 토글)

사용자 요청: "정렬 기능도 있어야 될 것 같아. 제목행을 누르면 중간고사를 누르면 중간고사
오름차순 한번 더 누르면 중간고사 내림차순, 등급을 누르면 등급 오름차순 한 번 더 누르면
등급 내림차순 이런 식으로." `#weightedTable`의 요소(과목) 칸들(중간고사/기말고사/수행평가
등, 요소가 몇 개든 전부)과 총점/석차/등급/성취도 칸이 전부 클릭 가능한 정렬 칸(`.sort-th`,
`cursor:pointer`)이 됐다 — 학번/이름/제외/삭제 칸은 정렬 대상이 아니다.

`weightedSortKey`(선택된 칸, 요소 key 또는 `'total'`|`'rank'`|`'grade'`|`'achievement'`)
/`weightedSortDir`(`'asc'`|`'desc'`) 두 모듈 변수가 정렬 상태를 들고 있다. `onWeightedTableClick`
이 `.sort-th` 클릭을 먼저 가로채서(기존 삭제 버튼 클릭 처리보다 앞에 분기) — 같은 칸을
다시 클릭하면 방향만 토글, 다른 칸을 클릭하면 그 칸으로 바꾸고 오름차순부터 시작 — 바로
`renderWeightedTable()`을 다시 호출한다. `weightedSortValueFor(key, row, elements)`가
칸별 "비교값"을 계산한다: 요소 칸은 입력된 점수(없으면 결시 인정점이 계산돼 있을 때 그
값), 총점/석차/등급은 이미 계산된 값, 성취도는 `['A','B','C','D','E','미도달']` 순서
인덱스(값이 좋을수록 작은 숫자가 되게 해서, 오름차순 = "좋은 순"이 자연스럽게 등급 칸과
같은 방향으로 맞춰짐). **값이 없으면(미입력/계산 불가) 정렬 방향과 무관하게 항상 맨
뒤로** 보낸다(`sortWeightedRows()`) — "내림차순을 누르면 빈 칸이 맨 위로 온다"처럼
빈 데이터가 눈에 띄는 자리를 왔다갔다하는 혼란을 막기 위한 의도적 선택이다. 같은 값
(동점)인 학생들은 원래(입력) 순서를 그대로 유지한다(안정 정렬).

정렬이 적용된 칸의 제목 옆에는 방향 화살표(오름차순 ▲, 내림차순 ▼)가 붙고(`sort-active`
클래스로 색도 진하게), 다른 칸을 클릭하면 이전 칸의 화살표는 사라진다 — 한 번에 하나의
칸만 정렬 기준이 될 수 있다(다중 칸 정렬은 요청받지 않았고, 이 표의 용도(한 성적표
안에서 빠르게 훑어보기)에는 불필요한 복잡도라 추가하지 않았다). 정렬은 순수
클라이언트 재정렬이라 Supabase 재조회가 없고, 다른 성적표를 불러오거나("새로 만들기"
포함) 정렬 상태를 초기화한다(`weightedSortKey = null`) — 요소 key(`e1`, `e2`, ...)는
성적표마다 다시 매겨지므로, 이전 성적표의 정렬 기준을 그대로 들고 있으면 완전히 다른
칸을 가리킬 수 있어서다.

### 테스트

`weightedSortValueFor`/`sortWeightedRows`를 `window.__gradeEstimatePage`에 추가로
노출해 Node에서 단위 검증했고(요소 점수/총점/등급/성취도 각각의 비교값이 기대한 숫자로
나오는지), Playwright로 학생 5명(중간고사 30/50/60/70/90점)을 입력해 (1) 초기 상태는
입력 순서 그대로인지, (2) 중간고사 칸을 클릭하면 오름차순(화살표 ▲ 표시 포함)으로
정렬되는지, (3) 다시 클릭하면 내림차순(▼)으로 바뀌는지, (4) 등급 칸 클릭도 같은
오름차순↔내림차순 토글이 동작하는지(1등급이 맨 위), (5) 다른 칸(총점)을 클릭하면
새 칸 기준으로 바뀌고 이전에 정렬했던 등급 칸의 화살표는 사라지는지, (6) 정렬 클릭
핸들러를 추가한 뒤에도 기존 삭제 버튼이 여전히 정상 동작하는지(회귀 없음) — 모두
검증했다. 기존 `test_grade_estimate_weighted.js`를 포함한 전체 `test_grade_estimate*.js`
스위트를 다시 돌려 회귀가 없음을 확인했다.

## `school-status.html` — 명렬표 다운로드 버튼(비관리자도 사용 가능) + 메인 메뉴 그룹 없는 상단 고정

사용자가 한 메시지로 세 가지를 요청: "그리고 그 학년별 명렬표 탭에서 명렬표 다운 받기
버튼도 있어야겠어. 학교 현황은 그룹 아래에 넣지 말고 그 메인 메뉴에서 맨 위에 있는
그룹 없는 곳에다가 넣어 줘. 그리고 시트 다시 불러오기 기능이 없는 거 같아. 엑셀로
업로드하기 기능도 없는 거 같아."

- **학년별 명렬표 탭에 "📥 명렬표 다운로드" 버튼 추가** — 기존에 관리자 전용 엑셀
  업로드/재업로드 기능(`onDownloadTemplate(grade)`)은 있었지만, 그냥 지금 명렬표를
  훑어보기용으로 받아가는 버튼은 승인된 교사 누구에게도 없었다. `renderGradeTab(grade)`
  의 명렬표 카드 안, 검색 입력칸 위에 `#btnDownloadRoster${grade}` 버튼을 새로 추가하고,
  **관리자 게이트(`if(myIsAdmin){...}`) 바깥에서** 무조건 리스너를 건다 —
  기존 `onDownloadTemplate(grade)`(반/번호/이름/비고 열을 가진 xlsx를
  `XLSX.writeFile(wb, \`\${grade}학년_명렬표.xlsx\`)`로 바로 저장)를 그대로 재사용했다 —
  이 함수는 원래 관리자의 "재업로드용 양식 다운로드"와 똑같은 모양의 파일을 만들기
  때문에, 별도의 "조회용" 포맷을 새로 만들 필요가 없었다. 관리자에게는 기존처럼
  "엑셀 양식 다운로드"(관리자 카드 안)도 그대로 남아있어 둘이 공존한다 — 하나는 모두가
  보는 "다운로드"고, 다른 하나는 관리자 전용 "재업로드용 양식"이라는 차이만 있을 뿐,
  내용은 같다.
- **`nav.js`/`index.html`: 그룹 없이 맨 위에 고정** — 기존엔 `DEFAULT_NAV_ITEMS`에서
  `group: '업무 도구'`가 붙어 있어 햄버거 메뉴·`index.html` 타일 그리드 양쪽에서
  그 그룹 안에 묻혀 있었다. `group` 속성을 제거하고, `my-custom-page.html`("대시보드")
  항목 바로 다음 자리로 옮겼다 — 이 저장소의 기존 "ungrouped = 핀으로 맨 위에 고정"
  관행(대시보드 타일이 그렇게 만들어진 것과 동일, `## nav.js` 섹션의 "그룹 없는 항목은
  `tile-pinned-grid`로 모든 그룹보다 먼저 렌더링된다" 규칙)을 그대로 따른 것. `index.html`
  의 `<a class="tool-card" href="./school-status.html">` 블록도 **DOM 순서를 그
  순서와 맞춰** `my-custom-page.html` 타일 바로 다음으로 옮겨야 했다 — 그룹 없는
  타일은 `.card-list`의 실제 DOM 위치가 렌더링 순서를 결정하는 그 gotcha(이미
  `## nav.js`에 문서화된 "대시보드" 사건과 같은 원리) 그대로라, nav.js만 고치고
  index.html 쪽 위치를 안 맞추면 두 UI의 순서가 서로 어긋났을 것이다. 옮기는 김에
  `<h2>학교 현황</h2>`에 빠져 있던 `<sup class="login-mark">*</sup>`도 추가했다 —
  `loginRequired: true`인 다른 모든 타일(나의 페이지/대시보드/메모장/교사용 챗봇 등)은
  이미 이 표식을 달고 있었는데 학교 현황만 빠져 있던 기존의 작은 불일치였다(이번
  이동 작업 중 발견해 같이 고쳤다).
- **"시트 다시 불러오기"/"엑셀로 업로드" 기능이 안 보인다는 세 번째 보고는 실제
  버그가 아니었다** — 코드를 다시 읽고 기존 Playwright 회귀 테스트
  (`test_school_status.js`의 [D]/[E] 섹션: 반 편성/학사일정/학년별 명렬표 엑셀
  재업로드, Google 시트 주소 저장·"다시 불러오기"의 플레이스홀더 안내 메시지)를 그대로
  재실행해 전부 정상 동작함을 재확인했다. 이 기능들은 모두 **"🔑 관리자 모드" 버튼**
  (페이지 맨 위, `profiles.is_admin === true`일 때만 비동기로 드러나는 — `staff-
  edit.html`/`duty.html`/`admin-tools.html`과 같은 "관리자 모드 버튼 → 편집 메뉴 노출"
  패턴) 뒤에 숨어있을 뿐이다. 관리자가 아닌 계정으로 보거나, 관리자 계정이라도 그
  작은 보조 버튼을 아직 눌러보지 않았다면 이 기능들의 존재 자체가 안 보인다 — 코드
  차원의 결함이 아니라 이 UX 설계(의도적으로 관리자 전용 기능을 숨겨둠)가 그대로
  반영된 결과라고 판단해, 기존 로직은 전혀 건드리지 않았다.
- `test_school_status_nav_and_download.js`(새 테스트)로 (1) `index.html` 타일 순서상
  대시보드 바로 다음에 학교 현황이 오는지, (2) 로그인 표식(`login-mark`)이 달려있는지,
  (3) 햄버거 메뉴에서 그룹(`gsnav-group`) 블록보다 앞에("ungrouped") 나오는지,
  (4) 비관리자 계정에는 "관리자 모드" 버튼이 전혀 안 보이는지, (5) 그런데도 "명렬표
  다운로드" 버튼은 보이는지, (6) 그 버튼을 클릭하면 실제 파일 다운로드 이벤트가
  발생하는지 — 모두 검증했고, 기존 `test_school_status.js`/
  `test_school_status_sections_row.js`/`test_school_status_roster_row.js`도 다시 돌려
  회귀가 없음을 확인했다.

## `school-status.html` 명렬표 — 관리자 모드에서 바로 텍스트 입력 수정 + 타이핑 즉시 취소선

사용자 요청: "명렬표에서 관리자 모드 누르면 바로 텍스트 입력해서 수정하는것도 가능하게
해줘. 자퇴 전출이 포함되면 취소선 자동으로 생기게 하고." 기존엔 명렬표를 고치는 유일한
방법이 "엑셀 양식 다운로드(현재 명단 포함) → 수정 → 올리기 → 미리보기 → 확인 → 그
학년 전체 delete-then-insert" 왕복뿐이었다 — 이름 하나, 비고 한 줄만 고치려 해도 매번
엑셀을 내려받아 열어야 했다. 이번 요청은 그 왕복 없이 표 안에서 바로 타이핑해 고칠 수
있게 해달라는 것.

- **"🔑 관리자 모드" 버튼을 눌러야만 인라인 입력칸이 나타난다 — `profiles.is_admin`이
  참이어도 버튼을 누르기 전엔 비관리자와 똑같은 줄글 표만 보인다.** 이 페이지(그리고
  `staff-edit.html`/`duty.html`/`admin-tools.html`)의 기존 "관리자 모드 버튼 → 편집
  메뉴 노출" 패턴(관리자 계정이어도 버튼을 누르기 전까진 아무 편집 UI도 안 보임)을
  그대로 따른 것 — `renderGradeTab()`의 행 템플릿이 `myIsAdmin`만이 아니라 새
  모듈 변수 `rosterEditMode`(기본 `false`)까지 함께 확인해서 `(myIsAdmin &&
  rosterEditMode)`일 때만 각 학생 행을 `<input>` 두 개(이름/비고)짜리로 그린다.
  `wireAdminMode()`의 `#btnAdminMode` 클릭 핸들러가 기존 관리자 카드들
  (`overviewAdminCard`/`gradeAdminCard${g}` 등)을 토글하던 바로 그 자리에서
  `rosterEditMode`도 같이 뒤집고, 이미 로드돼 캐시된(`rosterByGrade`) 1~3학년 탭을
  다시 그려(네트워크 요청 없음) 줄글↔입력칸을 전환한다.
- **번호(no)는 인라인 수정 대상에서 뺐다** — `students`의 기본키가
  `(year, grade, class_no, no)` 네 컬럼의 복합키라서(Supabase에서 직접 조회해 확인),
  번호를 고치는 건 "이 행을 수정"이 아니라 "다른 행으로 바꿔치기"가 돼버린다. 이름/
  비고만 인라인 입력칸(`input.roster-edit-name`/`input.roster-edit-note`)으로 바꾸고,
  번호를 바꾸고 싶으면 기존 엑셀 재업로드 경로를 쓰도록 남겨뒀다.
- **저장은 입력칸의 `change`(블러 또는 Enter) 시점에 한 번씩, 그 행의 네 기본키 값
  (`data-grade`/`data-class`/`data-no` + 고정된 `YEAR`)으로 정확히 그 학생 한 명만
  `update`한다** — 타이핑 중(`input`)마다 저장하면 너무 잦은 요청이 나가므로, 이
  저장소의 다른 "자동 저장" 기능들과 마찬가지로 blur/Enter 커밋 시점에만 서버에
  보낸다. 성공하면 입력칸에 `save-ok`(파란 배경이 1초간 옅게 깜빡임), 실패하면
  `save-err`(붉은 배경) + `alert`로 에러 메시지를 보여준다. 이름을 빈 값으로 저장하려
  하면 서버 호출 없이 그 자리에서 거부한다(`alert('이름은 비워둘 수 없어요.')`) —
  `name`이 `not null` 컬럼이라 빈 값으로 보내면 어차피 실패할 걸 미리 막은 것.
  저장이 성공하면 `rosterByGrade[grade]`의 해당 학생 객체도 같이 갱신해서(캐시
  동기화), "명렬표 다운로드"/엑셀 재업로드 양식이 새로고침 없이도 방금 고친 값을
  그대로 반영한다.
- **"자동으로 취소선"은 저장을 기다리지 않는다 — 비고 입력칸의 `input` 이벤트마다
  `isDepartedNote(value)`(기존 `/전출|자퇴/` 정규식 헬퍼, 그대로 재사용)를 다시
  판정해서 그 행의 `tr.departed` 클래스를 즉시 토글한다.** "자동으로 취소선이 생기게"
  라는 요청을 "저장 완료 후 재렌더링돼야 보인다"가 아니라 "타이핑하는 순간 바로
  보인다"로 해석한 것 — 서버 응답을 기다리는 저장과 완전히 분리된, 순수 클라이언트
  쪽 반응이다. 이름 칸도 같은 방식으로 `tr.dataset.name`을 즉시 갱신해서(검색 필터가
  읽는 값), 이름을 고치는 도중에도 검색이 최신 값을 기준으로 동작한다. 기존 CSS
  `tr.departed td.no, tr.departed td.name{ text-decoration:line-through; }`는 `<td>`
  자체에 거는 규칙이라, 이름 칸이 `<input>`으로 바뀐 관리자 모드에서는 그 규칙이
  입력칸 안의 텍스트에는 적용되지 않는다 — `tr.departed td.name input.roster-edit-name{
  text-decoration:line-through; }`를 별도로 추가해 입력칸 자체에도 취소선이 그려지게
  했다(`<input>` 엘리먼트도 자신의 값 텍스트에 `text-decoration`이 정상적으로 렌더링됨
  — Playwright로 직접 computed style을 찍어 확인).
- Playwright(`test_school_status_roster_inline_edit.js`, 스크래치패드 전용)로 (1)
  비관리자는 인라인 입력칸이 전혀 없이 기존처럼 줄글로만 보이는지, (2) 관리자 계정이어도
  "관리자 모드" 버튼을 누르기 전엔 역시 입력칸이 없는지, (3) 버튼을 누르면 그 학년의
  모든 학생 행에 입력칸이 생기는지, (4) 이름을 고치고 블러하면 `year/grade/class_no/no`
  네 조건이 정확히 실린 PATCH가 나가고 `save-ok` 클래스가 붙는지, (5) 비고에 "전출"을
  타이핑하는 즉시(저장 전) 그 행에 취소선이 반응하고, 입력칸 자신에도 실제
  `text-decoration-line: line-through`가 그려지는지, (6) 비고를 다시 지우면 취소선도
  즉시 풀리는지, (7) "하키" 같은 단순 태그(전출/자퇴 아님)는 관리자 모드에서도 취소선이
  안 붙는지(회귀 없음), (8) 이름을 빈 값으로 저장 시도하면 경고만 뜨고 PATCH는 아예
  안 나가는지, (9) "관리자 모드"를 다시 꺼면 입력칸이 사라지고 줄글로 돌아가되 방금
  저장한 값은 그대로 반영돼 있는지 — 모두 확인했고, 기존 `test_school_status.js`/
  `test_school_status_sections_row.js`/`test_school_status_roster_row.js`/
  `test_school_status_nav_and_download.js`도 다시 돌려 회귀가 없음을 확인했다.

## `grade-estimate.html` 상단(단일 시험) 계산기 — 과목별 성적표 저장/불러오기 (`grade_estimate_sheets`)

사용자 요청: "누적 성적 관리 말고 예상 등급 산출 내역도 과목별로 저장했다가 불러올 수
있게 하자." 같은 페이지 하단의 "학기 성적 누적 관리(가중합산)" 섹션은 이미
`grade_calc_sheets`로 학년도+학기+과목명 단위 저장/불러오기를 지원하고 있었는데,
상단의 단일 시험 계산기(붙여넣기/엑셀 업로드 → 바로 등급 계산)는 그 저장 기능이
전혀 없어서, 페이지를 벗어나면 입력했던 점수 일람표가 통째로 사라졌다.

- **새 테이블 `grade_estimate_sheets`** — `grade_calc_sheets`와 같은 "본인 소유만
  보고 고칠 수 있는" owner-only RLS(`auth.uid() = owner_id`, select/insert/update/
  delete 네 정책 모두)를 그대로 재사용했다. 다만 키는 **학년도+학기+과목명+고사명**
  네 값의 복합 유니크 제약(`unique(owner_id, year, semester, subject, exam_name)`)
  — 가중합산 쪽(`grade_calc_sheets`)은 중간고사+기말고사+수행평가를 한 학기 동안
  하나의 레코드에 누적해 합산하는 게 목적이라 "고사명"이라는 개념 자체가 없지만,
  이쪽은 **한 번의 시험 결과 그대로**를 저장하는 거라 같은 과목이라도 중간고사와
  기말고사를 서로 다른 레코드로 구분해야 했다 — "고사명"을 네 번째 키로 추가한 게
  유일한 구조적 차이다. `students`(jsonb, `parseScoreInput()`이 돌려주는 그대로 —
  `{studentNo?, name, score, hasRealName}` 배열)와 `grade_system`(`'5'`|`'9'`)만
  저장하고, **계산 결과(석차/등급/분포 등) 자체는 저장하지 않는다** — 원본 데이터만
  있으면 불러올 때 다시 계산하는 비용이 거의 없고, 나중에 등급 산출 로직이 바뀌어도
  옛 성적표가 그 변경을 자동으로 반영받기 때문(저장된 계산 결과를 캐시해뒀다가
  로직이 바뀐 뒤에도 옛 결과가 그대로 나오는 쪽이 훨씬 더 위험한 실수다).
- **UI는 가중합산 섹션의 "성적표 선택" 카드를 그대로 본떴다** — "점수 입력" 카드
  바로 위에 새 카드("성적표 저장/불러오기 (과목별)")를 추가해, 저장된 성적표
  드롭다운(`#estSheetQuickPick`, 있을 때만 보임) + 학년도/학기/과목명/고사명 네
  입력칸(`.sheet-picker-row` 재사용) + 불러오기/새로 만들기/저장 버튼을 둔다.
  가중합산 섹션과 달리 **이 페이지 전체가 이미 로그인+승인 게이트(이전 세션에서
  "그리고 예상 등급 산출 전체를 로그인 페이지로" 요청으로 전환됨) 뒤에 있어서**,
  이 카드만을 위한 별도 `ensureAuthChecked()`/안내 메시지가 필요 없다 — `init()`이
  이미 세션을 확인한 뒤에만 `loadEstSheetChoices()`를 호출한다.
- **저장(`onSaveEstSheet`)은 `#scoreInput`에 지금 보이는 텍스트를 그대로
  `parseScoreInput()`으로 다시 파싱해서 저장한다** — 엑셀 업로드든 직접 붙여넣기든
  결국 이 텍스트칸이 "지금 쓸 점수 데이터"의 단일 출처이므로, 별도의 상태 변수를
  두지 않고 textarea를 그대로 읽는 쪽을 택했다. **불러오기(`onLoadEstSheet`)는
  저장된 `students` 배열을 다시 "이름\t점수"(또는 학번이 있으면 "학번\t이름\t점수")
  형식으로 `#scoreInput`에 채워 넣고, `applyNameRoster()` → `runCalc()`까지 그
  자리에서 자동으로 실행한다** — 불러온 뒤 "등급 계산하기"를 한 번 더 눌러야 하는
  수고를 없앴다(가중합산 섹션의 `onLoadSheet()`가 `renderWeightedAll()`까지 바로
  호출하는 것과 같은 설계).
- **엑셀 일람표를 올리면 인식된 학년도/학기/과목명/고사명을 이 네 입력칸에
  자동으로 채워준다 — 단, 비어있을 때만.** `onXlsxFiles()`가 이미 뽑아내고 있던
  `combinedMeta.periodLabel`(예: `"2026학년도   2학기   주간      2학년"`)/
  `.subject`/`.examName`을 `autofillEstSheetIdentity()`가 각각
  `/(\d{4})\s*학년도/`/`/([12])\s*학기/` 정규식과 그대로 재사용해 학년도/학기/
  과목명/고사명 칸을 채운다 — 이미 손으로 타이핑해둔 값은 절대 덮어쓰지 않아서,
  "자동 인식이 틀렸을 때 고쳐 쓴 값이 다음 파일 업로드에 다시 지워지는" 사고가
  날 수 없다.
- **같은 네 값으로 다시 저장하면 그냥 덮어쓴다**(학기 성적 누적 관리와 같은
  "upsert, 별도 버전 관리 없음" 원칙) — 한 시험을 다시 채점했거나 결시자 인정점이
  바뀐 경우 등, 같은 시험을 고쳐 다시 저장하는 흐름을 자연스럽게 지원한다.
- `test_grade_estimate_sheet_save_load.js`(스크래치패드 전용 Playwright)로 (1)
  저장 payload에 학년도/학기/과목명/고사명/등급체계/학생 배열이 정확히 실리는지,
  (2) 저장 직후 "저장된 성적표에서 고르기" 드롭다운에 방금 저장한 항목이 나타나는지,
  (3) 지우기 후 네 값으로 불러오면 점수 일람표·등급 체계가 복원되고 계산까지 자동
  실행(결과 카드 표시)되는지, (4) 조건이 안 맞으면 "저장된 성적표가 없다" 경고가
  뜨는지, (5) 같은 키로 재저장하면 덮어써서 학생 수/점수가 바뀌는지, 그 뒤 다시
  불러오면 옛 데이터가 아니라 덮어쓴 최신 데이터가 보이는지, (6) 퀵픽 드롭다운을
  고르면 네 입력칸이 한 번에 채워지고 바로 불러와지는지 — 모두 확인했고, 기존
  `test_grade_estimate.js`/`test_grade_estimate_weighted.js`/
  `test_grade_estimate_cutoffs_persist.js`/`test_grade_estimate_login_gate.js`/
  `test_grade_estimate_partial_total.js`/`test_grade_estimate_achievement_eminus.js`/
  `test_grade_estimate_weighted_sort.js`/`test_grade_estimate_xlsx_upload.js`/
  `test_grade_estimate_class_roster.js`/`test_grade_estimate_school_roster.js`/
  `test_grade_estimate_roster.js`/`test_grade_estimate_print_export.js`도 전부
  다시 돌려 회귀가 없음을 확인했다.

## `grade-estimate.html` 상단(단일 시험) 계산기 — "명렬표 업로드/보조 명단(`student_name_roster`)" 기능 완전 제거

사용자 요청: "예상 등급 산출에서 명렬표 업로드 기능은 필요 없어. 학교 현황에 명렬표가
있으니까 오히려 충돌할 수 도 있을 것 같아. 명렬표가 필요한 경우는 모두 학교 현황에서
자동으로 불러오게 하는게 좋겠어." 바로 위 "학번↔이름 공유 명단(`student_name_roster`)"
섹션에서 처음 만든 뒤, 그 뒤 "`student_name_roster` 수동 반영에서 `students` 자동
조회로 전환" 섹션에서 1순위를 `school-status.html`의 `students` 테이블로 바꾸고
`student_name_roster`는 거기 없는 학번만 메꿔주는 2순위 보조 명단으로 남겨뒀는데,
이번 요청으로 그 2순위 경로 자체(보조 명단으로의 자동 저장 포함)를 완전히 걷어냈다
— 학교 현황이라는 단일한 출처 하나만 쓰게 하는 것이 "서로 다른 두 명단이 어긋날
위험"을 원천적으로 없애는 가장 확실한 방법이라고 판단했다.

- **제거된 것**: `#rosterUploadField`(파일 업로드 input/붙여넣기 textarea/저장 버튼
  전체를 담은 필드), `parseNameRosterSheet()`/`parseNameRosterPaste()`(명렬표 전용
  파싱 함수), `fetchRosterNames()`/`upsertRosterNames()`(student_name_roster read/
  write 헬퍼), `initNameRoster()`의 업로드 영역 와이어링, `onRosterFiles()`/
  `onSavePastedRoster()` 핸들러. `applyNameRoster()`는 학교 현황(`students`) 매칭
  로직 하나만 남기고, 거기서 못 찾은 학번을 `student_name_roster`에서 한 번 더 찾던
  2순위 분기와 실명이 함께 입력된 학생을 그 보조 명단에 자동 저장하던 `toSave`/
  `upsertRosterNames` 호출을 전부 들어냈다 — 이제 `student_name_roster`로는 이
  페이지에서 어떤 읽기/쓰기 요청도 전혀 나가지 않는다.
- **유지된 것**: `fetchSchoolRosterMap()`(학교 현황의 `students` 테이블 전체를 한 번에
  읽어오는, 유일한 이름 출처)과 전출/자퇴 제외 로직은 전혀 바뀌지 않았다 — "명렬표가
  필요한 모든 경우는 학교 현황에서 자동으로"라는 요청 그대로, 학번만 입력해도 이름이
  채워지는 핵심 동작은 그대로 남아있다. `student_name_roster` 테이블 자체는 Supabase에서
  드롭하지 않았다(사용을 멈추는 것 이상으로 스키마를 지우는 건 요청받지 않았고, 다른
  어떤 페이지도 참조하지 않는 고아 테이블로 남아있어도 무해하다).
- HTML 쪽 안내 문구도 함께 정리했다 — "점수 일람표" 필드의 힌트에서 "위 명렬표로
  등록"이라는, 이제 존재하지 않는 UI를 가리키던 문장을 지우고 "학번만 입력해도
  로그인한 승인된 선생님이면 학교 현황(school-status.html)의 전체 명렬표에서 자동으로
  이름을 찾아 채워줘요"로 바꿨고, `renderRosterInfo()`가 보여주는 안내문도 "학교
  현황에 아직 없는 학번은 아래 명렬표 업로드/붙여넣기나... 보조 명단에 직접 등록할 수
  있어요"라는, 역시 더 이상 존재하지 않는 경로를 안내하던 문장을 지웠다.
- `test_grade_estimate_roster.js`(기존 "명렬표 업로드 end-to-end" 테스트였던 파일)를
  이 기능 제거에 맞게 다시 썼다 — (1) 순수 파싱 함수(`parseScoreInput`/
  `parseGenericStudentSheet`)는 영향 없이 그대로 동작하는지(회귀), (2)
  `parseNameRosterSheet`/`parseNameRosterPaste`가 `window.__gradeEstimatePage`에서
  실제로 빠졌는지, (3) 비로그인/로그인 두 상태 모두에서 `student_name_roster`로는
  어떤 네트워크 호출도 전혀 나가지 않는지, (4) 로그인+승인 상태에서
  `#rosterFileInput`/`#rosterPasteInput`/`#btnSavePastedRoster`/`#rosterUploadField`
  네 엘리먼트가 DOM에서 완전히 사라졌는지, (5) 그런 상태에서도 학번만 입력하면
  `students`(학교 현황) 테이블 매칭만으로 정상적으로 이름이 채워지는지 — 모두
  확인했다. 기존 `test_grade_estimate.js`/`test_grade_estimate_weighted.js`/
  `test_grade_estimate_cutoffs_persist.js`/`test_grade_estimate_login_gate.js`/
  `test_grade_estimate_partial_total.js`/`test_grade_estimate_achievement_eminus.js`/
  `test_grade_estimate_weighted_sort.js`/`test_grade_estimate_xlsx_upload.js`/
  `test_grade_estimate_class_roster.js`/`test_grade_estimate_school_roster.js`/
  `test_grade_estimate_print_export.js`/`test_grade_estimate_sheet_save_load.js`도
  전부 다시 돌려 회귀가 없음을 확인했다.

## `school-status.html` — 반 편성 카드의 "인원"을 명렬표 기준 실시간 인원(전출·자퇴 자동 제외)으로 전환

사용자 요청: "학교 현황의 반 인원은 명렬표의 반별 학생수를 불러오되 전출과 자퇴는
자동으로 빼야 해." 기존엔 `class_sections.student_count`(관리자가 엑셀 업로드/직접
수정으로 손으로 넣어둔 값)를 그대로 보여줬는데 — 학년이 바뀌거나 전출·자퇴가 생겨도
그 수동 값을 누가 다시 고쳐주지 않으면 금방 실제 인원과 어긋났다. 이 페이지엔 이미
학년별 명렬표(`students` 테이블, `rosterByGrade`)가 있고 전출/자퇴 판정
(`isDepartedNote`)도 이미 존재하므로, 반 인원을 그 명렬표에서 직접 세는 쪽으로
바꿨다 — 더 이상 손으로 맞춰줄 필요가 없는, 항상 최신인 값이 된다.

- **`liveClassCount(grade, classNo)`**(새 헬퍼, `isDepartedNote` 바로 아래) —
  `rosterByGrade[grade]`를 그 반 번호로 필터링하고 `isDepartedNote(note)`인 학생을
  빼고 센다. `rosterByGrade[grade]`가 아직 로드되지 않았으면(`undefined`) `null`을
  돌려줘서, 호출하는 쪽이 옛 수동값(`student_count`)으로 안전하게 폴백할 수 있게 했다.
- **`renderOverview()`의 반 편성 카드 템플릿**이 각 반을 그릴 때 `liveClassCount()`를
  먼저 시도하고, `null`일 때만(명렬표를 못 불러온 예외 상황) `r.student_count`로
  폴백한다 — 평소에는 항상 명렬표 기준 실시간 값이 보인다.
- **`loadAll()`의 호출 순서를 바꿨다** — 기존엔 `renderOverview()`를 먼저 호출하고
  그 다음에 학년별 명렬표(`loadGradeRoster`)를 불러왔는데, 그러면 `renderOverview()`
  시점엔 `rosterByGrade`가 아직 비어있어서 매번 "폴백(수동값)" 경로만 타게 된다.
  세 학년의 명렬표를 전부 불러온 **뒤에** `renderOverview()`를 호출하도록 순서를
  바꿔서, 정상적인 경우엔 항상 명렬표 기준 값이 보이게 했다.
- `class_sections.student_count` 컬럼 자체, 그리고 반 편성 엑셀 양식(다운로드/업로드)
  의 "인원" 열은 전혀 건드리지 않았다 — 이번 변경은 **화면에 보여주는 값의 출처**만
  바꾼 것이고, 관리자가 그 컬럼에 참고용으로 뭔가 적어두는 것 자체를 막을 이유는
  없었다(평소엔 그 값이 그냥 화면에 안 쓰일 뿐).
- `test_school_status_live_section_count.js`(새 테스트)로 `class_sections`에 일부러
  틀린(오래된) 수동 인원값(99명/50명)을 넣어두고, 명렬표에는 1반 4명 중 전출·자퇴
  2명이 섞인 상태로 (1) 1반 인원이 수동값(99명)이 아니라 실제 재학생 수(2명)로
  표시되는지, (2) 2반 인원도 수동값(50명)이 아니라 실제 재학생 수(1명)로 표시되는지 —
  확인했다. 기존 `test_school_status.js`/`test_school_status_nav_and_download.js`/
  `test_school_status_roster_inline_edit.js`/`test_school_status_roster_row.js`/
  `test_school_status_sections_row.js`도 다시 돌려(특히 `loadAll()`의 호출 순서
  변경이 다른 기능을 깨뜨리지 않는지) 회귀가 없음을 확인했다.

## `grade-estimate.html` — 등급 색상을 "명암만 다른 같은 남색"에서 등급마다 고유 색상으로

사용자 피드백: "1등급인지 2등급인지가 색깔이 같고 명암만 다른 상태인 것 같아서 별로
구별이 안 돼. 아예 색깔을 다르게 하면 좋겠고, 1등급 색깔이 파란색이라면 1등급인
학생은 그 행 전체를 파란색으로 배경처리하되 투명도를 80% 정도 주면 어떨까. 1등급
라벨은 투명도 0%, 그 외 행 전체는 투명도 80%." 적용 전에 Artifact로 5등급/9등급
레이아웃 미리보기(기존 vs 제안 비교)를 먼저 보여주고 확인받은 뒤 반영했다.

기존 `GRADE_COLORS_5`/`GRADE_COLORS_9`는 전부 같은 남색(`#1E3A6E` 계열)을 그냥
더 밝게/어둡게만 바꾼 배열이라, 인접 등급(1등급 vs 2등급 등)이 거의 같은 색으로
보였다. **`GRADE_HSL_5`/`GRADE_HSL_9`**(각 항목이 `[H, S%, L%]`인 배열)로 교체해
1등급(파랑, hue 220)에서 마지막 등급(빨강, hue 0)으로 이어지는 색상 스펙트럼을
쓴다 — 등급마다 hue 자체가 달라서 명암이 아니라 색 자체로 구별된다.

- **`gradeColor(grade, total)`**(기존 함수, 시그니처 그대로 유지)은 이제
  `hsl(h s% l%)` 형태의 뱃지용 **100% 불투명** 색을 돌려준다 — `.grade-pill`(등급
  뱃지)이 쓰는 값은 전과 같은 자리에서 그대로 읽히므로, 단일 시험 계산기의
  `#scoreTable`/`#distTable`과 가중합산의 `#weightedDistTable`/`#weightedTable`
  네 곳의 뱃지 렌더링 코드는 거의 손대지 않고 팔레트만 바뀌었다.
- **`gradeRowBg(grade, total)`**(새 함수) — 같은 `[H,S,L]`을 그대로 쓰되 알파값만
  0.16(대부분 등급)~0.18(노란/올리브 계열, 옅게 칠해도 덜 도드라지는 색상 구간이라
  살짝 더 진하게)로 낮춘 `hsl(h s% l% / α)`를 돌려준다 — "80% 투명(=20% 안팎
  불투명도)"에 해당. 학생별 결과 행(`<tr>`)에 `style="background:${gradeRowBg(...)}"`
  로 적용했다 — **단, 결과 분포(등급컷) 요약 표(`#distTable`/`#weightedDistTable`)의
  행은 학생 한 명이 아니라 등급 전체를 나타내므로 행 배경 틴트는 적용하지 않았다**
  (뱃지 색만 새 팔레트로 바뀜).
- **`gradeTextColor(grade, total)`**(새 함수) — 노란/올리브 계열(hue 30~95) 색상은
  흰 글자보다 짙은 글자(`#2b2100`)가 더 잘 읽혀서 그 구간만 따로 처리하고, 그 외는
  전부 흰 글자(`#fff`) — 뱃지에 글자색을 inline으로 함께 지정한다(기존
  `.grade-pill{ color:#fff; }` 고정값은 CSS에 그대로 남아있지만 네 곳 전부 inline
  `color`를 이제 항상 지정하므로 실제로는 항상 덮어써진다).
- **적용 범위**: 단일 시험 계산기(`renderResults()`의 `#scoreTable` 학생별 결과 행)와
  학기 성적 누적 관리(`renderWeightedTable()`의 `#weightedTable` 학생별 결과 행) 둘
  다에 행 배경 틴트를 적용했다 — `renderWeightedTable()`의 경우 그 학생의 상대등급
  (`g`)이 아직 계산 안 된 행(요소 입력이 덜 끝난 경우)은 `g`가 없어 틴트를 건너뛴다
  (기존 로직이 이미 `g`가 없으면 등급 뱃지 자체를 `'-'`로 비워 보여주던 것과 같은
  전제).
- `test_grade_color_coding.js`(스크래치패드 전용 Playwright)로 (1) 10명(1~5등급 전부
  등장) 입력 시 등급 뱃지 5개가 실제로 서로 다른 RGB(단순 명암 차이가 아님)로
  렌더링되는지, (2) 1등급(hue~220, 파랑)과 5등급(hue~0, 빨강)의 hue가 실제로 크게
  다른지, (3) 1등급 행 배경의 알파가 대략 0.16(≈80% 투명)인지, (4) 1등급 뱃지는
  알파 1(100% 불투명)인지, (5) 행 배경과 뱃지가 같은 색상 계열(hue는 같고 알파만
  다름)인지, (6) `#weightedTable`에도 같은 규칙(행 0.16 알파, 뱃지 알파 1)이
  적용되는지 — 모두 확인했고, 기존 `test_grade_estimate.js`/
  `test_grade_estimate_weighted.js`/`test_grade_estimate_achievement_eminus.js`/
  `test_grade_estimate_print_export.js`도 다시 돌려 회귀가 없음을 확인했다.

## `school-status.html` 명렬표 — 화면 좌우로 꽉 차게 + 스크롤해도 "몇 반인지" 고정 + 전입생 데이터 오류 3건 수정

사용자가 네 가지를 연달아 요청했다: (1) "명렬표 아래로 스크롤 했을 때 위에 있는
몇반인지는 고정돼서 나와야 할 것 같은데", (2) "명렬표는 화면 좌우 넓이 화면에 꽉 차게
해줘. 부족하면 어차피 스크롤하니까... 좌우 여백이 거의 남지 않게", (3) "2학년 6반
26번은 나건후 이고, 2학년 7반 26번이 이지후인데 잘못 입력이 된 거 같애", (4) "4반
전입생으로 들어가 있는 김승언도 사실 5반 전입생이야."

**명렬표 카드를 `.wrap`(1100px) 폭 제약에서 벗어나 화면 좌우로 거의 꽉 차게** — 학년별
명렬표 탭의 바깥 카드(`<div class="card">학년 전체 명렬표...</div>`)에만
`roster-wide-card` 클래스를 추가하고, 표준 "가운데 정렬된 컨테이너를 벗어나 전체 폭을
쓰는" CSS 트릭(`max-width:none; width:calc(100vw - 32px); margin-left/right:calc(50% -
50vw + 16px)`)을 적용했다 — 다른 탭(학교 현황 개요/반 편성/학사일정)은 그대로
`.wrap`의 1100px 폭을 유지한다(사용자가 "명렬표는"이라고 특정했으므로 그 카드만 좁힘).

**명렬표 스크롤 시 "몇 반인지"(h3) 고정 — 처음 시도(단순 `position:sticky`)가 실제로는
전혀 동작하지 않는 걸 Playwright로 직접 재현·진단해서 알아냈다.** `.class-card h3`에
그냥 `position:sticky; top:0;`만 주고 테스트했더니, 800px를 스크롤해도 h3가 스크롤량과
똑같이(-800px) 같이 밀려나 전혀 고정되지 않았다 — 원인은 데스크탑 전용 CSS
(`.roster-grid{ display:flex; flex-wrap:nowrap; overflow-x:auto; }`, "학년의 모든 반이
한 줄에 나오게" 하려고 이미 있던 규칙)에 있었다: **CSS 스펙상 `overflow-x`를
`visible`이 아닌 값으로 주면 `overflow-y`도 암묵적으로 `auto`로 강제 승격된다** — 즉
세로로는 전혀 쓸 생각이 없었는데도 `.roster-grid`가 "가장 가까운 스크롤 컨테이너"로
등록돼버렸다. 문제는 이 div의 세로 높이가 `auto`(내용에 맞춰 늘어남)라 실제로는 절대
내부 스크롤이 일어나지 않는다는 것 — `position:sticky`는 "가장 가까운 스크롤
컨테이너"를 기준으로 고정되는데, 그 기준 자체가 페이지 스크롤과 무관하게 멈춰있는
(움직이지 않는) 엉뚱한 틀이 돼버려서 고정 효과가 완전히 사라졌다. `addStyleTag`로
`overflow-x:visible !important`를 임시로 덮어써서 "그 CSS 하나만 없으면 0px에 정확히
고정됨"을 직접 확인해 원인을 특정했다.

고쳐서, **room-booking.html의 `.grid-scroll`(세로 높이 제한 + `overflow:auto` + sticky
th)과 같은 해법**을 그대로 가져왔다 — `.roster-grid`(데스크탑 전용 규칙) 자체에
`max-height:640px`를 주고 `overflow-x:auto` 대신 `overflow:auto`(가로·세로 모두)로
바꿨다. 이러면 `.roster-grid`가 "진짜로" 내부 스크롤되는 영역이 돼서(반이 많으면
가로로, 한 반의 학생 수가 많으면 세로로), 그 안에서 `.class-card h3`의
`position:sticky; top:0`이 정상 동작한다 — 학생 목록을 마우스 휠로 내려도(그 영역
안에서) "몇 반인지" 제목이 위에 그대로 고정된 채 아래 학생들만 스크롤된다. h3에는
`background:var(--paper-card); z-index:2; padding:2px 0;`도 함께 줘서 아래 학생 행이
제목 밑으로 비쳐 보이지 않게 했다. 모바일(`max-width:820px`, 플레인 `display:grid`로
반마다 줄바꿈 — 원래부터 overflow가 없었음)은 이 문제 자체가 없어서 손대지 않았다.
`test_school_status_roster_sticky_width.js`(스크래치패드 전용)로 (1) 명렬표 카드의
좌우 여백이 20px 이하이고 1100px보다 훨씬 넓게 렌더링되는지, (2) `.roster-grid`의
내부 scrollTop을 400px 옮기면 35번째 학생 행이 실제로 400px 가까이 위로 이동하는지
(= 내부 스크롤이 진짜로 동작), (3) 그런데도 h3의 화면상 절대 위치는 거의 그대로인지
(비고정이었다면 역시 400px 가까이 움직였어야 함 — 실측 11px 이내로 고정 확인),
(4) 실제로 `position:sticky`가 computed style로 적용돼 있는지, (5) 배경색이 투명이
아닌지 — 모두 확인했고, 기존 `test_school_status*.js` 6개 전부 재실행해 회귀가 없음을
확인했다(특히 `test_school_status_roster_row.js`의 "반 카드 7개가 전부 같은 줄"
단언과 `test_school_status_sections_row.js`도 그대로 통과).

**전입생 데이터 오입력 3건(2학년 4~7반 26번) — 연쇄적으로 한 반씩 밀려 들어가 있었다.**
사용자가 두 번에 걸쳐 보고한 걸 Supabase에서 직접 조회해 교차 확인했다: 실제 저장된
값은 `4반26번=김승언(8.18.편입)`, `5반26번=나건후(3.3.편입 하키)`,
`6반26번=이지후(8.6.전입)`, `7반26번=없음` — 사용자가 말한 올바른 값(`6반26번=나건후`,
`7반26번=이지후`, `김승언은 5반 전입생`)과 대조하니 정확히 "각 전입생이 자기 반보다 한
반 낮게(4→5→6→7 방향으로 한 칸씩 밀려) 잘못 입력돼 있었다"는 패턴이 드러났다(1~3반의
26번은 전출/전입 표시 없는 정상 재학생이거나 다른 전입생이라 이 연쇄와 무관함을 확인).
`UPDATE students SET class_no = class_no + 1 WHERE ...`를 가장 높은 반(6→7)부터
역순으로 세 번 실행해(기본키가 `year+grade+class_no+no`라 순서를 거꾸로 하지 않으면
자리가 겹쳐 충돌한다) 교정했다 — `이지후`는 6반→7반, `나건후`는 5반→6반, `김승언`은
4반→5반으로 각각 이동. 이름까지 조건에 포함해(`AND name = '...'`) 혹시 모를 다른 행이
잘못 바뀌지 않도록 했다. 실행 후 재조회로 세 명 모두 올바른 반(7/6/5반)의 26번에
정확히 자리잡았고 원래 비고(전입/편입 날짜·사유)도 그대로 보존됐음을 확인했다 — 이
수정은 순수 데이터 교정이라 어떤 파일도 바뀌지 않는다(git 커밋 대상 아님).

**3학년 반 편성(class_sections) 비고가 비어 보이는 것은 버그가 아니라, 이 저장소에
이미 적혀 있던 처음부터의 의도적 공백이다** — 사용자가 "학교 현황의 3학년 반 현황
비고가 안 불러와 진 거 같아"라고 물어서 Supabase를 직접 조회해 확인했다: 1~2학년은
`class_sections.note`에 실제 값("빙1, 지1" 등)이 들어있는데 3학년 8개 반은 전부
`note: null`이다 — 렌더링/쿼리 쪽 버그가 아니라, 이 문서의 "학교 현황은 Google
시트에서 가져온 일회성 시드 데이터" 섹션에 이미 적힌 그대로("3학년 반 편성의
note(비고) 컬럼만 의도적으로 비워뒀다 — 원본 CSV에서 3학년만 콤마로 묶인 복합 비고
문자열이 모호해서 안전하게 옮길 수 없었고... 틀린 추측보다는 빈 값이 낫다고 판단했다")
처음부터 데이터 자체가 비어 있는 상태다. 고치려면 실제 3학년 비고 값을 알려주거나,
관리자 모드의 "반 편성 다시 올리기" 엑셀 양식(현재 값이 미리 채워져 내려오므로 비고
칸만 채워 다시 올리면 됨)으로 직접 채우면 된다 — 틀릴 수 있는 값을 추측해서 채우지
않는다는 원칙은 이번에도 그대로 지켰다.

## `school-status.html` 명렬표 — sticky 헤더/내부 스크롤 설계를 걷어내고 각 행에 "반/번호" 학번을 직접 표시

바로 위 섹션에서 구현한 "`.class-card h3`를 `position:sticky`로 고정 + `.roster-grid`에
`max-height:640px`+`overflow:auto`로 내부 세로 스크롤을 만드는" 설계를 사용자가 직접
더 단순한 대안으로 뒤집었다: "명렬표에 학번을 1반 11번(1/11) 이렇게 표시할까? 그럼
반 이름이 첫 행이 고정되지 않아도 될 거 같은데. 학생을 세로로 끝까지 보이게 해버리고.
내부에 스크롤이 되게 할 필요도 없을 거 같애." — h3가 스크롤 중에도 "몇 반인지"를
계속 보여줘야 했던 이유 자체가, 각 학생 행이 자기 반·번호를 스스로 말하게 하면
사라진다는 통찰이었다.

- **`table.roster-table`의 "번호" 열을 "학번"으로 바꾸고, 내용을 `${cno}/${s.no}`**
  (예: `1/11`)로 표시한다 — 관리자 편집 모드/일반 보기 두 템플릿 분기 모두 동일하게
  적용했다. 번호(`no`)는 여전히 `students`의 기본키 구성요소라 인라인 수정 대상이
  아니므로(바로 위 "인라인 수정" 섹션 참고), 이 칸은 어느 모드에서나 plain text만
  보여준다 — `td.no`에는 입력칸을 넣지 않는다.
- **`.class-card h3`에서 `position:sticky`/`top:0`/`background`/`z-index`/`padding`을
  전부 제거**하고 평범한 제목으로 되돌렸다 — 각 행이 이미 "1/11"로 자기 소속을
  보여주므로, h3가 스크롤 중에도 화면에 붙어있어야 할 이유가 없어졌다.
- **`.roster-grid`(데스크탑 전용 `@media (min-width:821px)` 규칙)에서
  `max-height:640px`와 세로 `overflow:auto`를 제거**하고 `overflow-x:auto`만 남겼다
  (반이 많아 가로로 다 안 들어갈 때의 가로 스크롤은 그대로 유지) — `.roster-grid`가
  더 이상 "가장 가까운 스크롤 컨테이너"로 등록될 이유가 없으므로, 바로 위 섹션에서
  겪은 "overflow-x:auto만 줘도 overflow-y가 암묵적으로 auto가 되면서 sticky 기준틀이
  어긋나는" 버그 자체가 애초에 성립하지 않는다(sticky를 아예 안 쓰므로). 카드들은
  이제 내용 높이만큼 자연스럽게 늘어나고, 페이지 자체가 세로로 스크롤된다 — 학생이
  많은 반이어도 끝까지 전부 한 화면 흐름 안에 보인다.
- `test_school_status_roster_inline_id.js`(스크래치패드 전용)로 (1) 테이블 헤더가
  "번호"가 아니라 "학번"으로 바뀌었는지, (2) 1반 1번/11번 행이 각각 "1/1"/"1/11"
  형식으로 표시되는지, (3) h3의 `position`이 더 이상 `sticky`가 아닌지(`static`),
  (4) `.roster-grid`에 `max-height` 제한이 없는지(`none`), (5) 반 2개×학생 40명(총
  80명, 뷰포트 900px보다 훨씬 긴 콘텐츠)을 렌더링했을 때 `.roster-grid` 자신의 실제
  높이와 문서 전체 스크롤 높이가 뷰포트보다 커서 내부 스크롤이 아니라 페이지 자체가
  길어지는지, (6) 페이지 맨 아래까지 스크롤하면 1반 40번째 학생 행이 실제로 화면에
  보이는지 — 모두 확인했다. 기존 `test_school_status.js`/
  `test_school_status_sections_row.js`/`test_school_status_roster_row.js`/
  `test_school_status_nav_and_download.js`/`test_school_status_roster_inline_edit.js`/
  `test_school_status_live_section_count.js`도 전부 다시 돌려 회귀가 없음을 확인했다
  (`test_school_status_roster_sticky_width.js`는 이 설계 변경으로 더 이상 유효한
  기대값이 아니다 — sticky/내부 스크롤이라는 기능 자체가 사라졌으므로, 그 테스트가
  검증하던 "스크롤해도 h3가 고정된다"는 동작은 이제 애초에 존재하지 않는다).

## `mock-interview.html` (AI 모의면접 분석 및 종합 보고서 시스템)

사용자가 완성된 HTML 파일 전체를 붙여넣어 그대로 레포에 새 페이지로 추가해달라고
요청했다 — `exam-generator.html`/`score-generator.html`/`grade-estimate.html`과 같은
"완전한 클라이언트 전용 도구" 계열에 합류하는 페이지다. 학생의 모의면접을 브라우저
내장 `SpeechRecognition`으로 실시간 전사하고, 문항이 바뀔 때마다 "다음 문항 마커"
버튼으로 녹음 전체를 문항별로 나눈 뒤, AI가 먼저 답변 전사만으로 1차 분석을 하고,
그 다음 담당 교사가 직접 관찰한 의견을 선택적으로 더해 최종 보고서(영역별 점수,
강점/보완점, 문항별 피드백)를 만들어 인쇄할 수 있는 도구다.

- **이 저장소의 다른 어떤 페이지와도 다른 CSS 스택**: 손으로 짠 CSS 대신 Tailwind CDN
  (`cdn.tailwindcss.com`) + Font Awesome CDN(`cdnjs.cloudflare.com`)을 그대로 썼다 —
  이 파일 하나가 완전히 독립된 단일 HTML이라 다른 페이지의 스타일과 전혀 충돌하지
  않으므로, 사용자가 통째로 넘겨준 코드를 재작성해 이 저장소의 손-CSS 관행에 맞추기보다
  그대로 두는 쪽을 택했다 — `xlsx@0.18.5`처럼 페이지별로 외부 CDN 라이브러리를 가져다
  쓰는 기존 관행의 연장으로 봐도 무리가 없다. 추가한 건 `<script src="./nav.js"
  defer></script>` 한 줄뿐 — 이 사이트 거의 모든 페이지가 공유하는 떠다니는 햄버거
  메뉴/🔍 검색을 이 페이지에도 띄우기 위함이다(이 스크립트가 자신의 `<style>` 태그를
  주입하는 방식이라 Tailwind와 충돌하지 않는다).
- **로그인 게이트 없음, Supabase 테이블 없음** — `exam-generator.html`/
  `score-generator.html`과 똑같이 `auth.js` 스크립트 태그조차 없다. 학생 정보·전사
  내용·보고서는 전부 그 브라우저 세션에서만 존재한다(새로고침하면 사라짐).
- **처음엔 교사가 직접 Gemini API 키를 입력하는 방식(`localStorage['gemini_api_key']`,
  브라우저에서 Google Gemini API를 바로 호출)으로 받아들였으나, 사용자가 명시적으로
  "Api 키 입력 받는 부분은 없애고 클로드 소넷 5.5 api 쓰도록해줘"라고 요청해 이
  사이트의 표준 "AI provider strategy"(Claude, Supabase Edge Function 경유 — API 키를
  브라우저에 절대 노출하지 않음) 패턴으로 다시 만들었다.** API 키 입력 모달
  (`#settingsModal`, `openSettingsModal()`/`saveApiKey()` 등)과 `localStorage` 읽기를
  전부 제거하고, 새 Supabase Edge Function **`interview-report`**(project
  `tmssupuskkajahpuswcj`, `verify_jwt:false` — 이 페이지가 로그인 자체를 안 쓰므로)를
  만들었다. 이 함수는 `week-brief-summarize` 등 기존 함수들의 관행(`json()`/
  `corsHeaders()` 헬퍼, `logAiUsage()`로 `ai_usage_log`에 비동기 insert, 느슨한
  `extractJson()`)을 그대로 따르되, `student-bot-chat`이 한 번 겪은 사고(도구가 전혀
  없는 호출에 `output_config.effort`를 실어 보내면 모델이 `<invoke name="think">`를
  무한 반복하다 `max_tokens`에 걸려버린 사건, 이 문서 다른 곳에 이미 기록돼 있음)의
  교훈을 선제적으로 적용해 **`output_config` 자체를 아예 안 보낸다**(이 함수도 도구가
  없으므로). 이 사이트의 평소 Claude-우선/Gemini-폴백 체인은 의도적으로 안 썼다 —
  사용자가 "클로드 소넷 5.5"를 명시적으로 지정했으므로 `claude-sonnet-5-5` 단일
  모델만 호출하고, 실패 시엔(바로 아래) 기존 `runLocalSimulation()`으로 폴백한다.
  `interview-report`는 `{studentName, major, teacherMemo, questions:[{id,
  questionText, transcript}]}`를 받아 Claude에 프롬프트를 보내고,
  `{scoreLogic/scoreMajor/scoreDelivery/scoreAttitude/overallGrade/strengths/
  weaknesses/detailed[]}` 형태의 JSON을 돌려준다 — `teacherMemo`가 비어있으면
  "아직 선생님 의견이 입력되기 전, 답변 전사만을 바탕으로 한 1차 분석"이라는 지시를,
  채워져 있으면 "이 보고서는 최종 보고서이므로 선생님 의견을 강점/보완점/종합 평가에
  반드시 반영하라"는 지시를 프롬프트에 분기해 넣는다 — **별도의 두 번째 함수를 만들지
  않고 하나의 함수가 `teacherMemo` 유무로 1차/최종 두 단계를 모두 처리한다.** 다른
  모든 Edge Function과 마찬가지로 이 함수의 소스는 git에 커밋돼 있지 않다("Edge
  Function code has no backup outside Supabase itself" — 이 문서 다른 곳에 이미
  기록된 이 저장소의 한계).
- **"교사 의견은 면접 답변 분석을 먼저하고 그 후 교사 분석을 입력하면(선택사항)
  최종 보고서가 만들어지게"라는 요청대로, 화면 흐름을 1단계/2단계 두 단계로
  재구성했다.** 기존의 단일 "AI 종합 보고서 생성하기" 버튼과 교사 메모 입력칸을
  하나로 묶어 "교사 메모 → AI 호출" 한 번에 끝내던 흐름을 버리고:
  - **1단계 "AI 답변 분석하기"**(`generateAnalysis()`, 교사 메모 카드보다 먼저
    렌더링되는 위치로 옮김) — `teacherMemo: ''`로 `interview-report`를 호출해 전사
    내용만으로 1차 분석을 받는다. 실패하면(네트워크 오류, 함수 500 등) 기존
    `runLocalSimulation()`(고정 샘플 평가)으로 조용히 폴백하고, 두 경로 모두
    `hasDraftAnalysis = true`로 세팅한 뒤 교사 메모 입력칸/프리셋 버튼/"최종 보고서로
    확정하기" 버튼을 전부 활성화한다(`setStageControlsEnabled(true)`) — 이 세 컨트롤은
    1단계가 끝나기 전까진 전부 `disabled` 상태(Tailwind `disabled:opacity-40` 등)다.
  - **2단계 "최종 보고서로 확정하기"**(`finalizeReport()`, `#btnFinalize`) — 교사 메모
    textarea가 비어있으면 **네트워크 호출을 전혀 하지 않고** 그 자리에서 바로
    "✅ 최종 보고서로 확정했어요 (선생님 의견 없음)."로 확정 상태(`isFinalized=true`,
    뱃지 색이 인디고→에메랄드로 전환)만 표시한다. 메모가 입력돼 있으면 그 메모를
    실어 `interview-report`를 **두 번째로** 호출해(1단계와 같은 엔드포인트, `teacherMemo`
    필드만 채워짐) 선생님 의견이 반영된 최종 결과로 화면을 다시 그린다. 이 호출이
    실패하면 1단계 결과를 그대로 최종 보고서로 확정한 것으로 처리한다(완전히 막다른
    길로 만들지 않음).
  - `#stageStatusMsg`(작은 안내 문구)가 매 단계 전환마다 다음에 뭘 할 수 있는지를
    알려준다 — "1단계 분석이 끝났어요. 선생님 의견을 입력하거나(선택), 바로 '최종
    보고서로 확정하기'를 눌러주세요." 등.
- `nav.js`의 `EXTRA_SEARCH_ITEMS`(adminOnly 없음 — 승인 여부와 무관하게 🔍 검색으로
  누구나 찾을 수 있음, `grade-estimate.html` 항목 바로 다음)와 `admin-tools.html`의
  "예상 등급 산출" 타일 바로 다음 자리에 평범한(관리자 전용 아님) `tool-card`로
  추가했다 — `DEFAULT_NAV_ITEMS`/`index.html` 최상위 타일은 없음, `exam-generator.html`/
  `score-generator.html`/`grade-estimate.html`과 동일한 노출 방식. 타일 설명 문구에
  한때 있던 "(Gemini API 키 직접 입력 필요)"는 API 키 UI를 없애면서 더 이상 사실이
  아니게 돼 지웠다.
- Playwright로 두 라운드 검증했다 — 처음엔 (1) 문항 탭 3개 렌더링, (2) "샘플 채우기"로
  학생 정보/문항 데이터 채움, (3) API 키 없이도(당시엔 키 입력 UI가 있었음)
  `runLocalSimulation()` 폴백으로 등급 뱃지가 채워짐, (4) JS 예외 없음을 확인했다.
  Claude Edge Function 전환 후 다시, `test_mock_interview_two_stage.js`로 (1) "API
  설정" 버튼/모달이 완전히 사라졌는지, (2) 초기 상태에서 메모·프리셋·확정 버튼이
  전부 비활성인지, (3) 1단계 호출의 `teacherMemo`가 빈 문자열인지, (4) 1단계 완료 후
  컨트롤이 활성화되는지, (5) 메모를 채운 뒤 확정하면 그 메모를 실은 별개의 2번째
  호출이 나가는지, (6) 뱃지/상태 문구가 올바르게 바뀌는지를 확인했고,
  `test_mock_interview_edgecases.js`로 (7) 1단계 API 실패 시 로컬 시뮬레이션으로
  폴백하면서도 2단계는 정상적으로 열리는지, (8) 메모 없이 확정하면 **네트워크 호출이
  전혀 없이** 바로 확정 메시지·초록 뱃지가 뜨는지를 확인했다 — 전부 통과했다.

## `school-status.html` 명렬표 — sticky 헤더/내부 스크롤 설계를 걷어내고 각 행에 "반/번호" 학번을 직접 표시

바로 위 섹션에서 구현한 "`.class-card h3`를 `position:sticky`로 고정 + `.roster-grid`에
`max-height:640px`+`overflow:auto`로 내부 세로 스크롤을 만드는" 설계를 사용자가 직접
더 단순한 대안으로 뒤집었다: "명렬표에 학번을 1반 11번(1/11) 이렇게 표시할까? 그럼
반 이름이 첫 행이 고정되지 않아도 될 거 같은데. 학생을 세로로 끝까지 보이게 해버리고.
내부에 스크롤이 되게 할 필요도 없을 거 같애." — h3가 스크롤 중에도 "몇 반인지"를
계속 보여줘야 했던 이유 자체가, 각 학생 행이 자기 반·번호를 스스로 말하게 하면
사라진다는 통찰이었다.

- **`table.roster-table`의 "번호" 열을 "학번"으로 바꾸고, 내용을 `${cno}/${s.no}`**
  (예: `1/11`)로 표시한다 — 관리자 편집 모드/일반 보기 두 템플릿 분기 모두 동일하게
  적용했다. 번호(`no`)는 여전히 `students`의 기본키 구성요소라 인라인 수정 대상이
  아니므로(바로 위 "인라인 수정" 섹션 참고), 이 칸은 어느 모드에서나 plain text만
  보여준다 — `td.no`에는 입력칸을 넣지 않는다.
- **`.class-card h3`에서 `position:sticky`/`top:0`/`background`/`z-index`/`padding`을
  전부 제거**하고 평범한 제목으로 되돌렸다 — 각 행이 이미 "1/11"로 자기 소속을
  보여주므로, h3가 스크롤 중에도 화면에 붙어있어야 할 이유가 없어졌다.
- **`.roster-grid`(데스크탑 전용 `@media (min-width:821px)` 규칙)에서
  `max-height:640px`와 세로 `overflow:auto`를 제거**하고 `overflow-x:auto`만 남겼다
  (반이 많아 가로로 다 안 들어갈 때의 가로 스크롤은 그대로 유지) — `.roster-grid`가
  더 이상 "가장 가까운 스크롤 컨테이너"로 등록될 이유가 없으므로, 바로 위 섹션에서
  겪은 "overflow-x:auto만 줘도 overflow-y가 암묵적으로 auto가 되면서 sticky 기준틀이
  어긋나는" 버그 자체가 애초에 성립하지 않는다(sticky를 아예 안 쓰므로). 카드들은
  이제 내용 높이만큼 자연스럽게 늘어나고, 페이지 자체가 세로로 스크롤된다 — 학생이
  많은 반이어도 끝까지 전부 한 화면 흐름 안에 보인다.
- `test_school_status_roster_inline_id.js`(스크래치패드 전용)로 (1) 테이블 헤더가
  "번호"가 아니라 "학번"으로 바뀌었는지, (2) 1반 1번/11번 행이 각각 "1/1"/"1/11"
  형식으로 표시되는지, (3) h3의 `position`이 더 이상 `sticky`가 아닌지(`static`),
  (4) `.roster-grid`에 `max-height` 제한이 없는지(`none`), (5) 반 2개×학생 40명(총
  80명, 뷰포트 900px보다 훨씬 긴 콘텐츠)을 렌더링했을 때 `.roster-grid` 자신의 실제
  높이와 문서 전체 스크롤 높이가 뷰포트보다 커서 내부 스크롤이 아니라 페이지 자체가
  길어지는지, (6) 페이지 맨 아래까지 스크롤하면 1반 40번째 학생 행이 실제로 화면에
  보이는지 — 모두 확인했다. 기존 `test_school_status.js`/
  `test_school_status_sections_row.js`/`test_school_status_roster_row.js`/
  `test_school_status_nav_and_download.js`/`test_school_status_roster_inline_edit.js`/
  `test_school_status_live_section_count.js`도 전부 다시 돌려 회귀가 없음을 확인했다
  (`test_school_status_roster_sticky_width.js`는 이 설계 변경으로 더 이상 유효한
  기대값이 아니다 — sticky/내부 스크롤이라는 기능 자체가 사라졌으므로, 그 테스트가
  검증하던 "스크롤해도 h3가 고정된다"는 동작은 이제 애초에 존재하지 않는다).

## `mock-interview.html` 재설계 — "질문+답변 함께 녹음 → AI가 분리해서 평가" + 화면 전체 다크/인디고 테마로 리디자인

사용자가 모바일 목업 스크린샷 두 장을 보여주며 두 가지를 함께 요청했다: (1) "디자인
이런 느낌으로 해주고", (2) "지금은 질문이 아예 추천돼서 나오는데 녹음 시작을 누르면
질문+답변 녹음받고 다음을 누르면 그다음 질문+답변 녹음 받는식으로 하고, 분석할땐
질문 답변 분리시켜서 분석하는거 가능해?"

**기존 아키텍처를 거의 그대로 살릴 수 있었다.** 연속 녹음 + "다음 문항 마커"로 구간을
나누는 기존 모델(`isRecording` 하나로 `SpeechRecognition.start()`를 한 번만 부르고,
마커를 누르면 버퍼만 리셋하고 활성 탭을 바꾸는 방식) 자체가 이미 "면접관이 그 구간에서
소리 내어 질문을 읽고, 이어서 학생이 답하면 그 둘이 통째로 그 문항의 전사문에 들어간다"
는 요청과 정확히 맞아떨어진다 — 브라우저 음성 인식에는 화자 구분이 없어서, 애초에 그
구간에서 들린 말은 전부(질문이든 답변이든) `transcript`에 함께 쌓인다. 진짜 바뀌어야
했던 건 두 가지뿐이었다: (1) AI 분석 프롬프트가 그동안 `questionText`(교사가 미리
타이핑한 참고 질문)와 `transcript`(답변만 들어있다고 가정)를 서로 다른 것으로 취급하고
있었던 것을 고쳐, `transcript`가 사실 질문+답변이 섞인 구간 전사일 수 있다는 걸 전제로
분리부터 하도록 바꾸는 것, (2) 화면 디자인.

- **녹음 버튼이 토글 하나에서 시작/마커/정지 세 개의 독립 버튼으로 바뀌었다.**
  기존 `toggleMasterRecording()` 하나가 `startRecording()`/`stopRecording()` 두
  함수로 쪼개졌고, 스크린샷처럼 초록색 "🎤 면접 녹음 시작"(`#startRecBtn`)·
  어두운 "🔖 다음 문항 구분 (마커)"(`#markerBtn`, 기존과 동일 로직)·정사각형
  "⏹"(`#stopRecBtn`, 새로 추가) 세 버튼이 나란히 놓인다. `setRecStatus(recording)`
  이 세 버튼의 활성/비활성과 상태 텍스트(`#recStatusText`: "면접 녹음 대기 중" ↔
  "🔴 면접 녹음 중")·점 색(`#recStatusDot`)을 한 번에 맞춘다 — 녹음 중이 아닐 땐
  시작만 눌릴 수 있고, 녹음 중엔 마커/정지만 눌릴 수 있다. 정지를 누르면(새 동작)
  현재 활성 문항의 `endTime`도 그 순간의 타이머 값으로 기록해둔다 — 예전엔 마커를
  누를 때만 `endTime`이 갱신되고 "정지"는 그냥 토글의 반대쪽이라 별도 기록이
  없었다.
- **"면접 질문 내용" 입력칸은 그대로 남아있지만 역할이 "참고용"으로 명확해졌다.**
  라벨에 "(참고용 — 실제로 말한 내용과 조금 달라도 괜찮아요)"를 덧붙였다 — 교사가
  미리 적어두는 예상 질문일 뿐, 실제 그 구간에서 면접관이 입으로 뭐라고 물었는지는
  "전사된 질문+답변 텍스트"(`transcript_${id}`, 기존 "실시간 전사 및 답변 텍스트"
  에서 라벨 변경) 쪽에 녹음된 그대로 들어간다는 걸 분명히 했다. 플레이스홀더 문구도
  "면접관의 질문과 학생의 답변이 함께 녹음되고, [다음 문항 구분 (마커)] 버튼을
  누르면 다음 문항으로 자동 전환됩니다"로 바꿔 이 동작을 설명한다.
- **AI 분석(Edge Function `interview-report`, Claude Sonnet 5.5)이 질문/답변을
  실제로 분리해서 평가하도록 프롬프트를 다시 썼다(버전 2로 재배포).** 문항별로
  보내는 텍스트를 "참고 질문: ...\n이 문항 구간의 전체 녹음 전사: ..."로 바꾸고,
  프롬프트에 세 단계 지시를 명시적으로 추가했다 — ① 전사 텍스트 안에서 "면접관이
  실제로 질문한 부분"과 "학생이 실제로 답변한 부분"을 문맥(질문형 문장/지시문 vs.
  1인칭 경험 서술)으로 스스로 구분해 분리할 것, ② 참고 질문은 예상 질문일 뿐이니
  실제로 무엇이 질문·답변인지는 전사 내용 자체로 판단하고, 전사에 질문을 읽은
  부분이 아예 없으면(학생 답변만 녹음된 경우) 분리된 질문은 참고 질문을 그대로 쓸
  것, ③ 점수·강점·보완점은 반드시 "분리해낸 학생 답변"만 근거로 삼을 것(질문
  문장을 답변으로 착각해 평가하지 말 것). `detailed[]` 응답 스키마에
  `question`/`answer` 두 필드를 추가해, AI가 실제로 분리해낸 질문/답변을 그대로
  돌려주도록 했다 — 이게 바로 "분석할 때 질문 답변 분리시켜서 분석"을 눈으로 확인할
  수 있는 지점이다. 클라이언트의 요청 payload 모양(`{id, questionText,
  transcript}`)은 전혀 안 바뀌었다 — 분리는 전적으로 서버(프롬프트) 쪽 변경이다.
- **보고서의 "문항별 상세 피드백" 카드가 이제 분리된 질문/답변을 함께 보여준다.**
  `renderReportUI()`가 `item.summary` 한 줄 평가 아래에 "질문(분리됨): ..."/
  "답변(분리됨): ..." 두 줄을 추가로 렌더링한다(필드가 없으면 그 줄 자체를
  생략 — 구버전 캐시 응답이나 로컬 시뮬레이션 폴백에서도 안전하게 동작). 이
  과정에서 **AI가 돌려주는 텍스트(질문/답변/강점/보완점/총평)를 `innerHTML`에
  그대로 꽂고 있던 기존 코드에 `escapeHtml()` 헬퍼를 새로 추가해 전부 거치도록
  고쳤다** — 전사 내용은 교사가 직접 타이핑하거나 수정할 수 있는 텍스트라, 이스케
  이프 없이 그대로 삽입하면 이론상 HTML/스크립트 삽입이 가능했던 지점이다.
  `runLocalSimulation()`(AI 호출 실패 시 폴백)도 같은 스키마에 맞춰 `question:
  q.questionText, answer: q.transcript || '(답변 전사 없음...)'`를 채운다 — 로컬
  폴백은 실제 AI 분리를 할 수 없으므로 참고 질문을 그대로 "질문"으로, 구간 전사를
  그대로 "답변"으로 보여주는 정직한 근사치다.
- **문항 삭제 버튼이 새로 생겼다** (스크린샷의 각 문항 패널 우측 상단 "🗑 삭제").
  `deleteQuestion(id)`는 `confirm()` 확인 후 그 문항을 배열에서 제거하고, **남은
  문항들의 `id`를 1..N으로 다시 매긴다** — 삭제 후에도 탭 번호가 항상 1번부터
  순서대로 이어지게 하기 위한 선택이다(안 그러면, 예를 들어 2번을 지운 뒤 "+ 문항
  추가"를 누르면 `questions.length+1`로 새 id를 매기는 기존 로직이 이미 존재하는
  id와 충돌할 수 있었다). 문항이 1개만 남았을 때는 삭제를 막는다("문항은 최소 1개
  이상이어야 해요"). 삭제된 탭이 활성 탭이었으면 그 자리(또는 마지막 탭)로 자동
  전환한다.
- **"전체 초기화" 버튼이 헤더에 새로 생겼다**(원형 새로고침 아이콘, 스크린샷의
  우상단 버튼과 같은 위치). `resetAll()`은 `confirm()` 확인 후: 녹음 중이면 먼저
  정지하고, 학생 정보/교사 메모/타이머를 비우고, `questions`를 기본 추천 질문
  3개로 되돌리고(`defaultQuestions()`로 뽑아낸 헬퍼 — 초기 로드 시에도 같은 함수를
  재사용), 1·2단계 상태(`hasDraftAnalysis`/`isFinalized`/`stageStatusMsg`)와
  보고서 전체(`resetReportUI()` — 점수바/강점·약점/문항별 상세/선생님 소견을 전부
  빈 placeholder 상태로)를 초기화한다.
- **레이아웃을 2단(좌: 입력, 우: 보고서) 그리드에서 위→아래 한 줄 흐름(싱글 컬럼,
  `max-w-2xl`)으로 재설계**하고, 전체 톤을 스크린샷처럼 인디고/퍼플 그라데이션
  헤더 + 짙은 네이비 녹음 패널 + 흰색 카드들로 바꿨다 — 헤더(마이크 아이콘,
  "녹음 & 구간 마커 평가 시스템" 타이틀, "⚡ 질문+답변 함께 녹음 → AI가 자동 분리"
  배지, 우상단 샘플 채우기/초기화 원형 버튼), 지원자 정보 카드, 녹음 패널(상태
  점+텍스트+타이머, 시작/마커/정지 버튼, 안내 문구), 문항 관리 카드(탭이 알약
  모양 토글로 바뀌고 전사 여부를 작은 점으로 표시), 1단계/2단계 버튼, 교사 메모
  카드, 그리고 보고서 영역은 짙은 헤더 바("학생 모의면접 평가 보고서" + 인쇄
  버튼) 아래 기존 `reportContainer`가 그대로 이어지는 구조다. 기존에 쓰이던
  모든 엘리먼트 `id`(studentName/targetMajor/interviewDate/recordingTimer/
  markerBtn/questionTabs/questionContents/btnAnalyze/aiBtnText/stageStatusMsg/
  teacherInputMemo/btnPresetGood/btnPresetImprove/btnFinalize/finalizeBtnText/
  reportContainer/repName/repMajor/repDate/totalScoreBadge/score1~4Val/bar1~4/
  repStrengths/repWeaknesses/detailedQAnalysis/repTeacherMemo)는 전부 그대로
  유지해 JS 로직을 다시 짤 필요가 없게 했다 — 바뀐 건 마크업/클래스와, 녹음
  버튼 구조·삭제/초기화 기능·질문-답변 표시뿐이다.
- 재배포된 Edge Function도 다른 모든 Edge Function과 마찬가지로 소스가 git에
  커밋돼 있지 않다("Edge Function code has no backup outside Supabase itself" —
  이 문서 위쪽에 이미 기록된 이 저장소의 한계) — 버전 2로 배포 완료.
- Playwright(`test_mock_interview_redesign.js`, 스크래치패드 전용)로 (1) 초기
  상태에서 시작 버튼만 활성인지, (2) 녹음 시작 시 시작이 비활성화되고 마커·정지가
  활성화되는지, (3) 마커를 누르면 2번 문항으로 넘어가는지, (4) 정지를 누르면 다시
  초기 버튼 상태로 돌아가는지, (5) 문항 삭제가 실제로 탭 개수를 줄이는지, (6)
  샘플 채우기 → 1단계 분석 → 보고서의 "문항별 상세 피드백"에 AI가 돌려준 분리된
  질문/답변 텍스트가 실제로 렌더링되는지, (7) 2단계 확정 시 교사 메모를 실은 두
  번째 API 호출이 나가는지(기존 두 단계 흐름 회귀 없음), (8) 전체 초기화가 학생
  정보/보고서/문항 탭 개수(3개로 복귀)를 전부 되돌리는지 — 모두 확인했다.

**음성 인식 오류 처리 — `SpeechRecognition`에 `onerror`/`onend` 핸들러가 전혀
없어서, 마이크 권한 거부·마이크 없음·네트워크 문제·Safari/Firefox(이 API 자체를
지원 안 함)에서 "녹음 중"이라고 화면엔 계속 뜨지만 전사는 전혀 안 되는 채로
조용히 멈추는 버그가 있었다.** "음성 입력은 잘 작동해?"라는 질문에 Playwright로
실제 `webkitSpeechRecognition`을 직접 띄워 확인하는 과정에서 발견했다 — 이
샌드박스 자체는 진짜 마이크도 없고 Google 음성 인식 백엔드로의 아웃바운드
네트워크도 막혀 있어(`net::ERR_TUNNEL_CONNECTION_FAILED`) 실제 전사 자체를 끝까지
검증할 수는 없었지만, 그 과정에서 코드에 오류/종료 핸들러가 아예 없다는 구조적
결함 자체는 명확히 확인됐다.

- **브라우저 미지원 배너**: 페이지 로드 시 `SpeechRecognition`/
  `webkitSpeechRecognition`이 둘 다 없으면(Safari·Firefox) `#recUnsupportedMsg`
  (호박색 경고 박스, "Chrome 또는 Edge 브라우저에서 이용해주세요")가 드러난다 —
  이 API 자체가 없는 브라우저에서는 녹음 버튼을 눌러도 아무 일도 안 일어나던
  기존 동작 대신, 처음부터 왜 안 되는지와 그래도 전사 칸에 직접 타이핑할 수
  있다는 안내를 보여준다.
- **`recognitionErrorMessage(code)`**가 `onerror`의 코드를 한국어 메시지로
  매핑한다 — `not-allowed`/`permission-denied`(마이크 권한 거부),
  `audio-capture`(마이크 없음), `network`(네트워크 문제),
  `service-not-allowed`(브라우저가 음성 인식 서비스 자체를 지원 안 함), 그 외는
  코드값을 그대로 보여주는 범용 메시지. **`no-speech`(단순히 잠깐 조용했을
  뿐 — 치명적 오류 아님)와 `aborted`(페이지 자신이 `.stop()`을 호출해서 발생 —
  역시 정상)는 둘 다 무시한다** — 녹음을 멈추지도, 에러 메시지를 띄우지도
  않는다. 그 외 모든 코드는 치명적 오류로 취급해 즉시 `stopRecording()`을 호출하고
  `#recErrorMsg`(붉은 경고 박스)에 매핑된 메시지 + "전사 칸에는 그래도 직접
  타이핑할 수 있어요"를 보여준다.
- **예상치 못한 `onend`(녹음 중인데 사용자가 멈추지 않았는데도 녹음이 끝난
  경우) 자동 재시작** — Chrome은 `continuous:true`로 설정해도 내부적으로 긴
  세션을 스스로 끊어버릴 수 있다는 것이 잘 알려진 동작이라, 이걸 감지하지 못하면
  긴 면접 중간에 전사가 조용히 멈춰버려도 교사는 알 방법이 없다. `recognition.
  onend`가 `isRecording`이 아직 `true`인 채로(=사용자가 직접 멈춘 게 아니라
  브라우저가 스스로 끝낸 경우) 발생하면, 300ms 뒤 `recognition.start()`를 다시
  호출해 세션을 이어 붙인다 — `restartPending` 플래그로 재시작 타이머가 겹쳐
  걸리는 것을 막는다.
- `startRecording()`은 시작할 때, `resetAll()`은 전체 초기화할 때 각각
  `clearRecError()`를 호출해 이전에 떠 있던 에러 메시지를 지운다.
- `test_mock_interview_speech_errors.js`(Playwright, `window.__fakeRec`을 노출하는
  `FakeRecognition` 스텁으로 `onerror`/`onend`를 수동으로 발생시켜 재현)로 (1)
  API 자체가 없으면 미지원 배너가 드러나는지, (2) `not-allowed` 같은 치명적
  오류는 녹음을 멈추고 "마이크 권한"을 언급하는 한국어 메시지를 보여주는지,
  (3) `no-speech`는 녹음을 멈추지도 메시지를 띄우지도 않는지, (4) 녹음 중
  예상치 못한 `onend`가 발생하면 `recognition.start()`가 자동으로 다시 호출되는지
  — 네 가지를 모두 검증했다. **이 샌드박스는 Tailwind CDN(`cdn.tailwindcss.com`)
  으로의 아웃바운드도 막혀 있어, 페이지의 `.hidden` 유틸리티 클래스가 실제로는
  아무 CSS 효과도 내지 못한다(`display`가 항상 `block`으로 남음)** — 그래서 이
  테스트들은 `page.isVisible()`(렌더링된 가시성) 대신 `classList.contains
  ('hidden')`(코드가 실제로 그 클래스를 추가/제거하는지)로 검증한다. 실제
  배포된 사이트에서는 Tailwind CDN이 정상 로드되므로 이 구분이 필요 없지만, 이
  샌드박스에서 같은 종류의 테스트를 또 작성할 때 `isVisible()`이 항상 `true`로
  나와 당황하지 않도록 기록해둔다.

**Incident: 마이크로 녹음할 때 같은 구절이 전사 칸에 무한히 반복되며 쌓이는 버그.**
교사 스크린샷 제보: "면접 질문 내용" 칸은 이미 채워진 채였고, 마이크를 눌러 녹음을
시작했더니 "우리 학교에 지원하게 된 개교와 고등학교" 같은 거의 동일한 구절이
`#transcript_1` 칸에 줄마다 계속 반복돼 쌓였다(말할수록 한 줄씩 늘어나는 모양). 원인은
`recognition.onresult`가 `event.resultIndex`/`isFinal`만 믿고 그 구간의 `final` 텍스트를
무조건 `currentTextBuffer`에 이어붙였던 것 — Chrome의 연속(`continuous:true`) 음성 인식은
내부적으로 이미 한 번 확정(`isFinal`)한 구간을 **똑같이, 또는 그 구간을 포함하는 더 긴
구절로 다시 한 번 "확정"된 결과로 재전송**하는 경우가 있다(특히
`recognition.onend`의 자동 재시작 직후에 두드러짐 — 매번 `resultIndex`가 0부터 다시
시작하는 새 세션이라, 직전 세션에서 이미 붙인 구절이 새 결과로 다시 들어와도
막을 방법이 없었다). 정확히 같은 원인으로 `chatbot-teacher.html`의 마이크 입력도 한 번
고친 적이 있다(이 문서의 chat-teacher 섹션 "Speech-to-text input dedupes on the text"
참고) — `resultIndex`/`isFinal`만으로는 막을 수 없고, 텍스트 자체를 비교해야 한다는
같은 교훈이다. **고쳐서** `lastFinalSegment`(직전에 실제로 이어붙인 구절) 변수를 추가해,
새로 들어온 `final`이 (1) 직전과 완전히 같으면 통째로 버리고, (2) 직전 구절로
시작하는 더 긴 문자열이면 겹치는 접두어를 뺀 나머지만 이어붙이고, (3) 완전히 새로운
구절이면 그대로 이어붙인다 — `startRecording()`이 녹음을 새로 시작할 때마다
`lastFinalSegment`를 비워서(완전히 새 세션이니 이전 문항의 잔여값에 막히지 않게),
`onend`의 자동 재시작처럼 세션 "안에서" 벌어지는 중복만 걸러낸다.
`test_mock_interview_mic_dedupe.js`(가짜 `FakeRecognition`에 `onresult`를 직접 호출해
재현 — 매번 `resultIndex:0`부터 시작하는 새 결과를 흉내냄)로 (1) 같은 구절이 그대로
다시 들어오면 중복 추가되지 않는지, (2) 직전 구절을 포함하는 더 긴 구절이 들어오면
겹치는 부분을 뺀 나머지만 이어붙는지, (3) 그 이후 완전히 새로운 구절은 정상적으로
이어붙는지 — 확인했고, 기존 `test_mock_interview_redesign.js`/
`test_mock_interview_speech_errors.js`도 다시 돌려 회귀가 없음을 확인했다.

## `korean-inquiry.html` (국어 현상 탐구 챗봇) — Gemini에서 구상한 설계를 그대로 구현

사용자가 Google Gemini에서 미리 구상해둔 "국어 현상 탐구" 수행평가용 챗봇+활동지 웹앱의
설계(화면 왼쪽 AI 챗봇 + 오른쪽 활동1~3·메모장 탭, 채점기준표를 반영한 시스템 프롬프트,
교사용 엑셀 다운로드)를 스크린샷으로 공유받아 그대로 구현했다. `exam-generator.html`/
`grade-estimate.html`/`mock-interview.html`과 같은 "교무 업무 도구 하위의 독립 도구"
계열에 합류하는 페이지지만, 그 셋과 달리 **이 페이지는 실제로 Supabase에 학생별 작업
내용을 저장하고, Claude를 호출하는 전용 챗봇 Edge Function을 쓴다** — 단발성 계산기가
아니라 학생이 여러 차시에 걸쳐 돌아와 이어서 작업하는, `bot.html`/`custom_bot_sessions`에
더 가까운 성격의 도구다.

- **학생 식별은 학번+이름뿐, 로그인 불필요** — `room-booking.html`의 "no login required"
  모델과 같은 신뢰 수준. `inquiry_sessions` 테이블(`student_no`+`student_name` 복합
  `unique` 제약)이 학생별 행 하나를 들고 있고, 클라이언트는 `localStorage['ks_inquiry_
  student']`에 `{studentNo, studentName}`을 저장해 다음 방문 때 자동으로 이어서 작업할 수
  있게 한다(같은 기기에서만 — `student-bot-chat`의 이름+학번 재개 로직과 같은 발상이지만,
  여긴 PIN도 없고 아예 Supabase Auth 세션 개념 자체가 없다).
- **모든 쓰기는 `SECURITY DEFINER` RPC로만** — `collect.html`의 관례 그대로, 클라이언트가
  `inquiry_sessions`에 직접 `insert`/`update`할 수 있는 RLS 정책은 전혀 없다(이 테이블의
  유일한 클라이언트 RLS는 `select`, 그것도 승인된 교사 전용). `inquiry_session_start`(최초
  접속 시 find-or-create), `inquiry_session_save`(활동1~3 필드 전체를 매번 덮어쓰는
  디바운스 자동저장, `checklist`까지 포함), `inquiry_session_add_memo`/
  `inquiry_session_delete_memo`(메모장), `inquiry_session_submit`(`submitted_at` 기록) —
  다섯 개 모두 `anon`/`authenticated`에 `grant execute`만 돼 있고 비밀번호 검증은 없다
  (설계 자체에 비밀번호 요구사항이 없었음 — `student-bot-chat`의 PIN 없는 이름+학번 재개와
  같은 신뢰 수준을 그대로 따른 것).
- **활동1~3의 각 필드는 `inquiry_sessions`의 평범한 컬럼**(jsonb로 뭉치지 않고 하나하나
  분리) — 내가 발견한 표현/언제·어디서/선정 이유/문법 개념/문법적 분석/추가 조사(활동1),
  시각자료 계획/서론·본론·결론/7개 체크리스트(활동2, `checklist` jsonb), 발표 대본
  5단계(활동3). `inquiry_session_save`는 `p_fields` jsonb에 들어있는 키만 선택적으로
  갱신하지만(`?` 연산자로 존재 여부 확인), 클라이언트(`currentFieldsPayload()`)는 항상
  현재 화면의 전체 필드 값을 보낸다 — 매 900ms 디바운스마다 전체 상태를 그대로 덮어쓰는
  단순한 모델이라, 필드별 부분 갱신 경합을 신경 쓸 필요가 없다.
- **메모장(`memos` jsonb 배열)은 `bot.html`의 연구 노트 패널과 같은 아코디언 UI** — 제목
  줄을 클릭하면 본문이 펼쳐지고(`.memo-item.open`), 삭제는 즉시 RPC 호출 후 로컬 배열에서
  바로 제거한다. 메모 id는 RPC 안에서 `gen_random_uuid()`로 서버가 생성해 돌려준다.
- **챗봇은 "현재 활동 단계"를 매 메시지마다 함께 보내 받는 순차적 가이드** — Gemini
  설계의 "1,2,3 활동에 맞는 단계에 맞는 가이드를 순서에 맞게"라는 요구사항을, 별도의
  상태 머신 없이 클라이언트가 지금 열려있는 탭(`activeTab`)을 `stage` 파라미터로
  Edge Function에 실어 보내는 것만으로 구현했다 — `inquiry-chat` 함수가 그 단계에 해당하는
  필드들을 현재 값 그대로 시스템 프롬프트 뒤에 붙여("[현재 활동 단계: 활동1 — ...]\n내가
  발견한 국어 표현: ...") 모델에게 맥락으로 준다. 메모장 탭에 있을 때는 특별한 단계
  맥락 없이 일반 모드로 응답한다.
- **`inquiry_settings`(단일 행, `id='site'`)가 채점기준표·대화 원칙 전문을 담은
  시스템 프롬프트를 들고 있다** — `collect_settings`/`app_settings`와 같은 "단일 설정
  행" 패턴. Gemini 스크린샷에서 "4. 시각 자료 활용 및 발표 내용 구성"의 배점이 캡처
  과정에서 잘려 보이지 않았는데, 추측으로 숫자를 채워 넣는 대신 그 항목만 "배점: 선생님이
  직접 정해주세요"로 남겨두고 **교사 모드에서 전체 텍스트를 자유롭게 고쳐 쓸 수 있는
  textarea**로 노출했다 — 이 저장소의 "AI가 재구성한 내용은 사람이 바로 고칠 수 있게
  열어둔다"는 원칙 그대로. RLS는 `select`/`update` 둘 다 승인된 교사 전체에 열려있다
  (관리자 전용이 아님 — 다른 과목 선생님도 참고할 수 있게, `form_templates`와 같은 개방
  신뢰 수준).
- **`inquiry-chat` Edge Function**(`verify_jwt:false` — 학생은 로그인하지 않으므로)은 이
  저장소의 "AI provider strategy"를 그대로 따르는 Claude 우선(`claude-sonnet-5-5`)/Gemini
  폴백(`gemini-3.6-flash`, `chat-teacher`가 이미 쓰는 모델과 통일) 구조다. `student-bot-chat`
  이 겪었던 "도구가 없는 단순 채팅에 `output_config.effort`를 실어 보내면 모델이 멈추지
  않고 같은 토큰을 반복하다 `max_tokens`에 걸리는" 사고(이 문서 위쪽에 이미 기록됨)를
  미리 염두에 두고, 이 함수도 도구가 전혀 없는 단순 멀티턴 채팅이라 `output_config` 자체를
  아예 보내지 않는다. 대화 기록(`chat_messages` jsonb 배열)은 학생이 보낸 메시지와
  챗봇의 답변을 **서버가** 매 호출마다 직접 이어붙여 저장한다(클라이언트는 낙관적으로
  먼저 화면에만 그려두고, 저장의 단일 소스는 Edge Function 쪽) — `ai_usage_log`에도
  `function_name:'inquiry-chat'`, `actor_label: "이름(학번)"`(student-bot-chat과 같은
  패턴, `user_id`는 로그인이 없으니 항상 `null`)로 기록한다.
- **교사 모드**(페이지 상단 "🔑 교사 모드" 버튼 → 로그인+`profiles.approved` 확인 →
  `#teacherPanel` 노출, `staff-edit.html`/`duty.html`의 "관리자 모드 버튼" 패턴과 동일한
  모양이지만 `is_admin`이 아니라 `approved`만 요구한다 — 이 과목을 가르치는 교사 누구나
  쓸 수 있어야 하므로)는 학생별 제출 현황 목록(클릭하면 모달로 전체 활동 내용+대화 기록
  보기), 엑셀 다운로드, 그리고 위 시스템 프롬프트 편집 textarea 세 가지를 제공한다. 엑셀은
  Gemini 설계의 최종 결정("질문과 답변을 모두 합친 열이 낫겠어")을 그대로 반영해, 학생 한
  명당 한 행에 활동1~3의 모든 필드 + 체크리스트 요약 + 메모장 + **챗봇과 나눈 질문·답변을
  `Q: .../A: ...`로 한 칸에 이어붙인 통합 열**을 담는다(이 저장소의 다른 엑셀 내보내기와
  같은 `xlsx@0.18.5`(jsdelivr) 관례).
- **발견된 실제 버그 — `style.display=''`로는 스타일시트 규칙으로 숨긴 요소를 다시
  보이게 할 수 없다.** 처음 구현에서 `#teacherPanel`을 `<style>` 블록의 `#teacherPanel{
  display:none; }` 규칙으로 숨겨두고, `tryEnterTeacherMode()`에서 `el('teacherPanel')
  .style.display = '';`로 다시 보이게 하려 했는데 — 인라인 스타일을 지우는 것은 그
  엘리먼트에 애초에 인라인으로 걸려있던 값만 되돌릴 뿐, 스타일시트(CSS 규칙)로 지정된
  `display:none`은 여전히 유효하게 남는다. Playwright로 "교사 모드 진입 후 패널이
  보이는지"를 검증하다가 바로 걸렸다 — **고쳐서** `#teacherPanel{ display:none; }`
  스타일시트 규칙을 지우고, `#mainView`/`#gateView`가 이미 쓰던 것과 같은 방식(HTML
  태그 자체에 `style="display:none;"` 인라인으로 걸어두기)으로 바꿨다 — 이제
  `.style.display=''`가 정확히 그 인라인 값을 지우고 기본값(`block`)으로 되돌린다.
  `el(id).style.display = ''`로 뭔가를 "다시 보이게" 하는 코드를 쓸 때는, 그 요소가
  애초에 인라인 스타일로 숨겨졌는지(이 패턴이 통함) 스타일시트 규칙으로 숨겨졌는지
  (안 통함, `'block'` 등을 명시해야 함) 항상 구분해서 확인할 것.
- 이 환경에서 실제 Claude API 호출 성공 여부까지는 끝까지 확인하지 못했다(이 샌드박스는
  `api.anthropic.com`/`*.supabase.co`로의 아웃바운드가 막혀 있다는, 이 문서 여러 곳에
  이미 기록된 제약) — RPC 다섯 개는 Supabase에 직접 `execute_sql`로 호출해 정상 동작을
  확인했고, `inquiry-chat` Edge Function은 배포까지 완료했지만 실제 호출은 교사가 처음
  써볼 때 확인해야 한다. `test_korean_inquiry.js`(Playwright, Supabase REST/RPC와
  `inquiry-chat` 엔드포인트를 전부 모킹)로 (1) 학번+이름 시작 → localStorage 재개,
  (2) 활동1 필드 입력 → 디바운스 자동저장(`checklist` 포함 payload 확인), (3) 활동2
  체크리스트 토글 → 저장, (4) 탭 전환 시 챗봇 안내 문구가 바뀌는지, (5) 활동3 탭에서
  챗봇에 메시지를 보내면 `stage:'3'`이 정확히 전달되는지, (6) 메모 추가/펼치기, (7)
  제출하기 → 뱃지 갱신, (8) 로그인 없이 교사 모드 시도 시 패널이 안 열리는지, (9) 교사
  목록 렌더링·상세 모달·엑셀 내보내기(통합 Q&A 열 포함)가 올바른지 — 모두 검증했다.
  **이 샌드박스는 `cdn.jsdelivr.net` 아웃바운드도 막혀 있어**(세션마다 허용 목록이 달라
  이전에는 가능했던 적도 있었다 — `food-map.html`/`xlsx` 관련 다른 섹션 참고), 테스트는
  `@supabase/supabase-js`/`xlsx` 패키지를 `npm install`로 로컬에 받아 `page.route()`로
  CDN 요청을 가로채 대신 응답하는 방식으로 돌렸다(페이지 코드 자체는 CDN URL 그대로).

### 학생 활동 내용은 "교사가 삭제하기 전까지" Supabase에 보관 — 교사 모드에 실제 삭제 버튼 추가

사용자가 실제 공식 "국어 현상 탐구 발표지" PDF 3쪽과 실제 채점기준표(평가시기 11월, 10점
만점: 서·논술형 5점+발표 5점) 이미지를 함께 보내며 "학생 탐구내용 학번 이름은 로컬말고
수파베이스 데이터베이스에 저장해줘. 교사가 삭제하기 전까지"라고 요청했다. 확인해보니 학생이
입력한 실제 활동 내용(활동1~3 필드/체크리스트/메모/대화 기록)은 애초부터 전부
`inquiry_sessions`에만 저장되고 있었다 — `localStorage`에는 다음 방문 시 자동으로 이어서
작업할 수 있게 해주는 `{studentNo, studentName}` **식별자 포인터 하나만** 들어있을 뿐,
실제 내용은 한 번도 로컬에 저장된 적이 없었다. 그래서 이 요청의 실제로 빠져 있던 부분은
"로컬 대신 Supabase에 저장"이 아니라 **"교사가 삭제하기 전까지"라는 조건을 실제로 만족시킬
삭제 기능 자체가 교사 모드에 없었다**는 것으로 판단했다 — 지금까지는 학생 데이터를 지울
방법이 전혀 없어서, 사실상 "영구 보관"이었지 "교사가 원할 때 지울 수 있는" 상태가 아니었다.

- **`inquiry_sessions_delete_approved` RLS 정책**(새로 추가)이 `profiles.approved = true`인
  교사 전체에게 `delete`를 허용한다 — 이 테이블의 기존 `select`/RPC 기반 쓰기와 같은
  신뢰 수준("이 과목을 가르치는 교사 누구나", 관리자 전용 아님)을 그대로 따른 것이다.
- **교사 모드 학생 목록 표에 "관리" 열과 행별 "삭제" 버튼이 추가됐다.** `renderTeacherList()`
  가 각 행 끝에 `<button onclick="event.stopPropagation(); deleteStudentSession(i)">삭제
  </button>`를 렌더링하고(`event.stopPropagation()`으로, 행 전체를 누르면 상세 모달이
  열리는 기존 동작과 겹치지 않게 분리), 표 아래 안내문을 "데이터는 선생님이 직접 삭제하기
  전까지 계속 Supabase에 보관돼요"로 바꿨다. `deleteStudentSession(i)`는 **두 번 연속
  `confirm()`**(학번·이름을 명시한 첫 확인 + "정말로 삭제할까요? 한 번 더 확인할게요" 두
  번째 확인)을 모두 통과해야만 `sb.from('inquiry_sessions').delete().eq('student_no',
  s.student_no).eq('student_name', s.student_name)`을 호출한다 — 되돌릴 수 없는 삭제라
  이 저장소의 다른 파괴적 동작(예: `teacher-groups.html`의 그룹 삭제, `link-hub.html`의
  마스터 비밀번호 끄기)과 같은 수준의 이중 확인을 거친다. 교사는 이미 로그인된 실제
  Supabase Auth 세션을 갖고 있으므로(교사 모드 진입 자체가 로그인을 요구), 학생 쪽의
  RPC 우회 없이 평범한 `sb.from(...).delete()` 호출 하나로 RLS가 바로 허용한다. 성공하면
  `teacherSessions` 배열에서 그 행을 `splice`로 제거하고 `renderTeacherList()`를 다시
  호출해 화면에서도 즉시 사라진다.
- `test_korean_inquiry.js`에 [12]번 검증을 추가했다 — (1) "관리" 열 헤더와 행마다 "삭제"
  버튼이 렌더링되는지, (2) 첫 번째 확인을 취소하면 DELETE 요청이 전혀 안 나가고 행이
  그대로 남는지, (3) 첫 확인은 수락하고 두 번째를 취소해도 역시 DELETE가 안 나가는지,
  (4) 두 확인을 모두 수락하면 `student_no=eq.20301&student_name=eq.홍길동` 필터가 정확히
  실린 DELETE 요청이 한 번 나가고 행이 화면에서 사라지는지 — 모두 확인했다.

### 채점기준표를 실제 공식 이미지 기준으로 정정

위에서 "배점: 선생님이 직접 정해주세요"로 남겨뒀던 항목 4(시각 자료 활용 및 발표 내용
구성)는, 사용자가 보내준 실제 채점기준표 이미지 덕분에 더 이상 추측할 필요가 없어졌다.
`inquiry_settings.system_prompt`를 실제 공식 배점 그대로 정확히 교체했다 — 서·논술형
5점(1.주제 선정 및 발견 2점 / 2.문법 지식 활용 분석 2점 / 3.탐구 과정 성실성 1점) + 발표
5점(4.시각 자료 2점 / 5.발표 내용 구성 1점 / 6.발표 기한 준수 2점, 각 항목의 부분 점수
구간(2/1.5/1/0점 등)까지 포함), 그리고 성취기준 코드 [12화언01-01]/[12화언01-03]/
[12화언01-04]/[12화언01-09]까지 전부 이미지에서 그대로 옮겼다. 이 교정은 `inquiry_settings`
행 하나를 덮어쓰는 순수 데이터 변경이라(그 행의 `updated_at`이 최초 삽입 시점과 그대로
일치해 그 사이 교사가 손으로 고친 적이 없음을 먼저 확인한 뒤 진행했다) 어떤 파일도 바뀌지
않는다 — `school-status.html`의 전입생 데이터 정정 사례들과 같은 "데이터만 고친, git
커밋 대상이 아닌 변경"이다. 교사 모드의 시스템 프롬프트 편집 textarea는 여전히 열려있으니,
학교 사정에 따라 배점이 달라지면 언제든 교사가 직접 다시 고칠 수 있다.

### 삭제 권한을 승인된 교사 전체에서 국어 과목 담당 교사(또는 관리자)로 좁힘

사용자가 "그 과목 담당 교사만 지울 수 있어야 돼"라고 요청했다 — 바로 위에서 추가한 삭제
버튼이 승인된 교사 **누구나** 쓸 수 있었던 걸, 이 활동 자체가 국어 과목 전용이니 국어
담당 교사(또는 관리자)만 지울 수 있게 좁힌 것. `profiles.subject`(이미 `staff`/`member-
admin.html`에서 자유 텍스트로 채워지는 기존 칼럼, 예: `"국어"`)를 기준으로 삼았다.

- **`inquiry_sessions_delete_approved` RLS 정책을 `ALTER POLICY`로 조건만 좁혔다**(정책
  이름은 그대로 — `DROP POLICY`를 쓰면 이 환경의 파괴적 SQL 안전장치에 걸려 `cancelled`로
  끝나는 걸 이미 한 번 겪었으므로, 조건만 바꾸는 `ALTER POLICY ... USING (...)`를 대신
  썼다): `approved = true AND (is_admin = true OR subject ilike '%국어%')`로 바뀌었다 —
  관리자는 과목과 무관하게 항상 삭제 가능, 그 외에는 국어 과목 교사만 가능하다.
- **`tryEnterTeacherMode()`**가 교사 모드 진입 시 `profiles.select('approved, is_admin,
  subject')`로 `subject`까지 함께 조회해 모듈 변수 `canDeleteInquirySessions = is_admin ||
  /국어/.test(subject)`를 세팅한다 — RLS와 똑같은 조건을 클라이언트에도 그대로 반영해,
  서버가 막기 전에 UI 자체가 먼저 정직하게 보여준다.
- **`renderTeacherList()`**는 `canDeleteInquirySessions`가 거짓이면 "관리" 열에 삭제
  버튼 대신 `-`만 보여주고, 표 아래 안내문에 "(삭제는 국어 과목 담당 선생님만 할 수
  있어요.)"를 덧붙인다. `deleteStudentSession(i)`도 호출 맨 앞에서 같은 플래그를 다시
  확인해(`alert('이 활동(국어) 담당 선생님만 삭제할 수 있어요.')`) — RLS만 믿고 UI를
  그대로 두면, 권한 없는 교사가 어쩌다 버튼을 보게 되는 경우(예: 플래그 세팅 전 레이스)
  서버 에러로만 알게 되는데, 클라이언트 쪽에서도 한 번 더 막아 더 분명한 한국어 안내를
  먼저 보여준다.

## 국어 현상 탐구 챗봇을 "학생 챗봇 만들기" 하위로 이동

사용자 요청: "국어 현상 탐구 발표 챗봇 페이지를 학생 챗봇 만들기 하위에 넣어줘." 지금까지
`korean-inquiry.html`은 `admin-tools.html`(교무 업무 도구 허브)의 평범한 타일 하나로만
들어가 있었는데, 이 페이지의 성격(학생이 학번+이름으로 접속하는 과목별 전용 챗봇)이
`chatbot-builder.html`("수업용 챗봇 만들기" — 교사가 학생 공유용 챗봇을 만드는 바로 그
페이지)과 더 밀접하다고 판단해, `staff-edit.html`을 `admin-tools.html` 하위로 옮겼던
것과 같은 패턴(상위 페이지 자체에 진입점을 두고, 기존 top-level 타일은 제거)으로
재배치했다.

- **`admin-tools.html`에서 "국어 현상 탐구 챗봇" `tool-card`를 완전히 제거**했다 — 이
  페이지가 유일한 top-level 진입점이었으므로, 이제 이 경로로는 더 이상 닿을 수 없다.
- **`chatbot-builder.html`의 "내가 만든 챗봇" 카드 바로 위에 "📚 미리 만들어진 과목별
  챗봇" 카드를 새로 추가**하고, 그 안에 "국어 현상 탐구 챗봇" 링크 한 줄을 뒀다 — 기존
  "내가 만든 챗봇" 목록(`.bot-row`, 교사가 직접 만든 커스텀 챗봇들)과 구분되는 별도
  카드로, 이 활동은 직접 만드는 게 아니라 이미 만들어진 전용 도구로 바로 들어가 쓰는
  것임을 분명히 했다. **일부러 `.bot-row` 클래스를 재사용하지 않고 `.builtin-bot-row`라는
  새 클래스**(시각적으로는 거의 동일하게 CSS를 베꼈다)를 썼다 — `loadBotList()`가 매번
  `document.querySelectorAll('.bot-row')`로(스코프 없이 문서 전체를 훑어) 클릭 리스너를
  다시 건 뒤 `openEditor(row.dataset.id)`를 호출하는데, 이 링크는 `data-id`가 없으므로
  `.bot-row` 클래스를 그대로 썼다면 클릭할 때마다 `openEditor(undefined)`가 함께
  호출돼(링크 자체는 그래도 정상 이동하지만) 의도치 않은 사이드 이펙트가 끼어들 뻔했다 —
  클래스 이름만 다르게 줘서 그 델리게이트 쿼리에 아예 걸리지 않게 피했다.
- `chatbot-builder.html`과 `admin-tools.html`을 다루는 기존 CLAUDE.md 섹션/테스트 어디도
  `korean-inquiry.html`의 "유일한 진입점"이 admin-tools.html이라고 가정하고 있지 않아서,
  재배치 외에 다른 파일 변경은 필요 없었다. `nav.js`의 `EXTRA_SEARCH_ITEMS` 항목(🔍 전체
  검색으로 찾을 수 있게 하는 등록)은 손대지 않았다 — 이 페이지는 애초에 `admin-tools.html`
  경유로만 메뉴에 노출됐을 뿐 검색 인덱스는 그 허브 페이지와 무관하게 독립적으로 등록돼
  있었으므로, 진입점이 바뀌어도 검색으로는 계속 똑같이 찾을 수 있다.
- `test_chatbot_builder_korean_inquiry_link.js`(새 테스트)로 (1) 새 링크가
  `korean-inquiry.html`을 정확히 가리키는지, (2) 라벨 텍스트가 올바른지, (3) 그 링크가
  `.bot-row` 클래스를 **갖지 않는지**(델리게이트 클릭 리스너에 안 걸리는지 확인하는
  핵심 단언) — 검증했다. 기존 `test_nav_korean_inquiry_search.js`도 다시 돌려 🔍 검색으로
  여전히 찾아지는지(회귀 없음) 확인했다.

## `mock-interview.html` — 음성 인식 미지원 브라우저에서 "녹음은 됐는데 전사가 전혀 안 된다"로 보이던 함정

교사 보고: "음성 입력이 안 되는 것 같다." 코드를 다시 읽어보니, `recUnsupportedMsg`
경고 배너(지원하지 않는 브라우저에서 보여주는 안내 — iOS Safari/Chrome-iOS, Firefox는
`window.SpeechRecognition`/`window.webkitSpeechRecognition` 자체가 없음)는 페이지 로드
시 제대로 나타났지만, **그 아래 큰 초록색 "면접 녹음 시작" 버튼은 지원 여부와 무관하게
항상 눌을 수 있는 상태로 남아있었다.** `startRecording()`은 `recognition` 객체가
`null`이어도 `isRecording = true`로 바꾸고 타이머를 돌리고 상태 텍스트를 "🔴 면접 녹음
중"으로 바꿔버려서, 지원하지 않는 브라우저에서는 **화면상으로는 정상적으로 녹음
중인 것처럼 보이지만 실제로는 아무 것도 전사되지 않는** 상태가 됐다 — 정확히
"음성 입력이 안 되는 것 같다"는 증상과 일치한다.

**고쳐서** 두 가지를 더했다: (1) `startRecording()` 맨 앞에
`if(!recognitionSupported)` 가드를 추가해, 지원하지 않는 브라우저에서는 타이머/녹음
상태를 전혀 켜지 않고 즉시 `recErrorMsg`로 "Chrome 또는 Edge 브라우저에서 이용해주세요"
안내를 보여주고 리턴한다, (2) 페이지 로드 시 `recognitionSupported`가 거짓이면
`#startRecBtn` 자체를 `disabled`로 바꾸고(`opacity-40`/`cursor-not-allowed`,
`markerBtn`/`stopRecBtn`이 이미 쓰는 것과 같은 비활성 스타일), `title`에도 이유를
달아 애초에 혼동의 여지를 없앴다. 지원하는 브라우저에서 마이크 권한 거부/네트워크
오류 등으로 실패하는 경우는 기존 `recognition.onerror` 핸들러가 이미 올바르게
`stopRecording()`을 호출하고 에러 메시지를 보여주고 있었다(이번 변경과 무관,
회귀 없음 — Playwright로 실제 `webkitSpeechRecognition` API가 있는 헤드리스
크로미움에서 마이크 권한을 거부시켜 직접 확인함: 바로 "마이크 권한이 거부됐어요"
메시지와 함께 대기 상태로 정상 복귀).

Playwright(스크래치패드 전용, `test_mock_interview_unsupported.js`)로 (1)
`SpeechRecognition`/`webkitSpeechRecognition`을 둘 다 지운 상태에서 배너가 뜨고
시작 버튼이 비활성화되는지, (2) 버튼을 강제로 다시 활성화해(스테일/레이스 클릭을
흉내냄) 클릭해도 `startRecording()` 자신이 "면접 녹음 대기 중" 상태를 유지하고
에러 메시지를 보여주는지(절대 가짜로 "녹음 중"이 되지 않는지), (3) API가 있는
정상 환경에서는 시작 버튼이 활성 상태인지 — 검증했고, 기존
`test_mock_interview_redesign.js`/`test_mock_interview_speech_errors.js`/
`test_mock_interview_mic_dedupe.js`도 다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — 마이크 중복 전사 재발: "직전 구절"만 비교해서는 부족했다

위 섹션에서 고친 `lastFinalSegment` 비교(새 `final`을 오직 **바로 직전에 추가한
final 하나**와만 비교)는, 교사가 실제로 쓰면서 보내준 스크린샷에서 여전히 재발했다
— 전사 칸에 "안녕하십니까 소개를 소개를 해 소개를 해 보세요 소개를 해 보세요"처럼
단어가 중복됐다. 재현해보니 원인은: Chrome의 연속 음성 인식이 **직전 chunk를
연장**하는 게 아니라, **그보다 조금 전에 이미 말한 독립된 단어를 다시 "확정"
결과로 재전송**하는 경우가 있다는 것 — 예를 들어 버퍼가 이미 "...소개를 해"로
끝난 상태에서, 다음 `onresult`가 "소개를"(직전에 이미 합쳐져 들어간 단어) 하나만
독립적으로 다시 보낸다. `lastFinalSegment`는 그 직전 호출의 **원본** final 문자열
("소개를 해")만 기억하므로, "소개를"은 그것과 같지도 않고 그것으로 시작하지도
않아 전혀 새로운 내용으로 취급돼 그대로 또 이어붙었다.

**고쳐서** 비교 대상을 "마지막 final 문자열 하나"에서 "**지금까지 누적된 버퍼의
최근 120자(`DEDUPE_LOOKBACK_CHARS`)**"로 넓혔다 — `mergeFinalIntoBuffer(buffer,
final)`가 (1) 새 `final`이 그 최근 구간에 이미 그대로 들어있으면 통째로 버리고,
(2) 아니면 버퍼의 꼬리와 `final`의 머리 사이에서 가장 긴 겹침(overlap)을 찾아 그
겹치지 않는 나머지만 이어붙이고, (3) 겹치는 부분이 전혀 없으면 완전히 새로운
내용으로 그대로 이어붙인다. 이 방식은 "직전 chunk의 연장"(기존에 잡던 패턴)과
"조금 전에 말한 단어의 독립 재전송"(이번에 새로 발견된 패턴) 둘 다 하나의 로직으로
잡아낸다 — 버퍼 꼬리 전체를 보므로 바로 직전 호출이 아니어도 최근 몇 번의 호출에
걸친 재전송까지 커버한다. `lastFinalSegment` 변수와 그 리셋 로직은 완전히
제거했다(더 이상 필요 없음 — 비교 기준이 변수 하나가 아니라 버퍼 자체이므로).

`test_mock_interview_mic_dedupe2.js`(스크래치패드 전용)로 실제 스크린샷에 나온
정확한 재현 시나리오("안녕하십니까" → "소개를" → "소개를 해" → "소개를"(재전송)
→ "소개를 해 보세요" → "소개를 해 보세요"(재전송))를 그대로 입력해, 최종 전사가
중복 없이 정확히 "안녕하십니까 소개를 해 보세요"가 되는지 확인했다 — 이 테스트는
이전 코드(직전 구절만 비교)로 돌리면 실제로 재현 실패함을 먼저 확인한 뒤 작성했다.
기존 `test_mock_interview_mic_dedupe.js`/`test_mock_interview_redesign.js`/
`test_mock_interview_speech_errors.js`/`test_mock_interview_unsupported.js`도 다시
돌려 회귀가 없음을 확인했다.

## `mock-interview.html` 분석 결과 — 강점/보완점을 키워드 칩으로, 서술 문장이 아니라 한눈에 훑어보게

사용자 요청: "분석내용이 너무 상세한데 키워드 중심으로 눈에 잘 보이게 해줘." 보고서의
"주요 강점"/"보완할 점 및 약점" 카드와 문항별 상세 피드백의 강점/보완점 줄이 전부 Claude가
생성한 긴 서술 문장(예: "전공에 대한 뚜렷한 목표 의식과 구체적인 동아리 활동 경험이
돋보입니다. 논리적인 기승전결로 답변 구성이 우수함.")을 `.innerText`로 그대로 꽂아 보여주고
있어서, 한 번에 읽어 들어오지 않고 줄글을 다 읽어야만 요점을 알 수 있었다.

- **`keywordTagsHtml(items, variant)`**(새 헬퍼, `escapeHtml` 바로 아래)이 짧은 키워드/구
  문자열의 배열을 작은 알약 모양 칩(`rounded-full`, `variant:'pos'`는 에메랄드,
  `'neg'`는 로즈 — 기존 강점/보완점 카드 색과 동일)으로 렌더링한다. 입력이 배열이 아니라
  문자열(오래된 캐시 응답이나 이전 버전 Edge Function이 여전히 프로즈를 돌려주는 경우에
  대한 방어적 폴백)이면 `,`/`·`/줄바꿈으로 나눠 배열처럼 다룬다. 빈 배열/빈 문자열이면
  "분석 결과가 없습니다"라는 평범한 텍스트를 보여준다(칩 없음).
- **HTML**: `#repStrengths`/`#repWeaknesses` 컨테이너 div가 `text-xs ... leading-relaxed`
  (줄글 전용 스타일)에서 `flex flex-wrap gap-1.5`(칩이 여러 개면 자동으로 줄바꿈되며
  나란히 흐름)로 바뀌었다. 초기 placeholder 텍스트도 그 안의 `<span>`으로 감싸서, 분석
  전/초기화 직후에도 같은 레이아웃 컨테이너를 그대로 쓴다(`resetReportUI()`도 같은 모양의
  `<span>` 하나짜리 `innerHTML`로 통일).
- **`renderReportUI(data)`**: `data.strengths`/`data.weaknesses`를 `.innerText =` 대신
  `keywordTagsHtml(..., 'pos'|'neg')`로 렌더링하고, 문항별 상세 피드백의 강점/보완점 줄도
  `${escapeHtml(item.strength)}`(단일 문자열 가정) 대신
  `${keywordTagsHtml(item.strength, 'pos')}`/`${keywordTagsHtml(item.improvement, 'neg')}`
  로 바꿔 각 줄을 `flex flex-wrap items-center gap-1`로 감쌌다 — "강점:"/"보완점:" 레이블
  뒤에 칩이 여러 개 나란히(또는 줄바꿈되어) 붙는다. `question`/`answer`(전사에서 분리한
  실제 질문/답변 — "분석 내용"이 아니라 사실 그대로의 전사 발췌)는 요청의 대상이 아니므로
  건드리지 않았다.
- **`runLocalSimulation()`**(AI 호출 실패 시 폴백)의 샘플 데이터도 같은 형식(문자열 →
  짧은 키워드 배열, 예: `["뚜렷한 목표 의식", "구체적 활동 경험", "논리적 답변 구성"]`)
  으로 바꿔, AI 경로와 로컬 폴백 경로가 시각적으로 일관되게 보인다.
- **Edge Function `interview-report`**(버전 2 → 3으로 재배포)의 프롬프트도 함께
  고쳤다 — JSON 스키마 설명에 "strengths/weaknesses/detailed[].strength/
  detailed[].improvement는 절대 완전한 문장으로 쓰지 말고, 짧은 키워드·구(각 2~8글자
  안팎)의 배열로만 작성하라"는 지시와, "~함"/"~입니다" 같은 서술형으로 끝나는 긴 항목은
  금지한다는 문장을 추가했다. 예시 JSON도 `"strengths": "..."` 단일 문자열에서
  `"strengths": ["짧은 강점 키워드1", "짧은 강점 키워드2", ...]` 배열 형태로 바꿨다 —
  `question`/`answer`(전사 분리 결과, 사실 그대로의 문장이어도 괜찮음을 명시)는 기존
  지시를 그대로 유지했다. 이 함수를 또 건드릴 때는 `question`/`answer`와
  `strength`/`improvement`/`strengths`/`weaknesses`의 형식 요구가 서로 다르다는 걸
  혼동하지 말 것 — 전자는 사실 발췌, 후자만 짧은 키워드 배열이다.
- `test_mock_interview_keyword_tags.js`(Playwright, `interview-report` 엔드포인트를
  배열 스키마 응답으로 모킹)로 (1) AI 경로에서 강점/보완점이 각각 독립된 `<span>` 칩으로
  렌더링되고 그 내용이 정확히 일치하는지, (2) 칩에 실제로 `rounded-full` 알약 스타일이
  적용돼 있는지, (3) 문항별 상세의 강점/보완점도 칩으로(보완점이 여러 개면 둘 다) 렌더링
  되는지, (4) AI 호출이 실패해 `runLocalSimulation()` 폴백으로 넘어가도 강점이 여러 개의
  짧은 키워드 칩(문장 종결 부호로 끝나지 않는)으로 나오는지 — 두 경로 모두 확인했다.
  `keywordTagsHtml()`은 `escapeHtml()`을 그대로 거치므로, 칩 텍스트에 대한 기존 XSS
  방지(이전 세션에서 이미 추가된 `escapeHtml` 적용)도 그대로 유지된다. 기존
  `test_mock_interview_redesign.js`/`test_mock_interview_speech_errors.js`/
  `test_mock_interview_mic_dedupe.js`/`test_mock_interview_mic_dedupe2.js`/
  `test_mock_interview_unsupported.js`도 다시 돌려 회귀가 없음을 확인했다
  (`test_mock_interview_two_stage.js`/`test_mock_interview_edgecases.js`/
  `test_mock_interview_smoke.js`는 이 변경과 무관한, 이전부터 있던 `button:has-text(
  "샘플 채우기")` 셀렉터 한계로 여전히 실패한다 — 그 버튼이 아이콘 전용이라 보이는 텍스트가
  없고 `title` 속성에만 라벨이 있어서다; `button[title="샘플 채우기"]`로는 정상 동작함을
  재확인했다).

## `mock-interview.html` 평가 등급 — 0~100 세부 점수/문자 등급 대신 상/중/하 3단계로 단순화

사용자 요청: "그리고 면접에 대한 평가는 상중하 정도로만 하는 게 좋을 것 같아." 기존엔 네 평가
영역(논리력 및 구성력/전공적합성 및 이해도/표현력 및 전달력/태도 및 진정성) 각각이 0~100 사이
정수 점수로, 종합 등급은 `"A (우수)"` 같은 문자+수식어 조합으로 나왔는데 — 실제 면접 평가는
그 정도의 세밀한 구분이 의미가 없고, 상/중/하 세 단계면 충분하다는 판단.

- **`interview-report` Edge Function의 프롬프트**가 `scoreLogic`/`scoreMajor`/
  `scoreDelivery`/`scoreAttitude`/`overallGrade` 다섯 필드를 전부 "상"/"중"/"하" 세 글자
  문자열 중 하나로만 답하도록 바뀌었다(0~100 정수 지시를 지우고, few-shot 예시 JSON도
  `"scoreLogic": "상"` 식으로 교체) — 세부 점수 차이를 억지로 구분하지 말고 그 영역이
  전반적으로 우수/보통/부족한지만 판단하라는 문장을 추가했다. `strengths`/`weaknesses`/
  `detailed[].strength`/`detailed[].improvement`를 짧은 키워드 배열로 쓰라는 기존 지시는
  그대로 유지했다(이 변경과 무관). 버전 4로 재배포(`verify_jwt:false` 명시).
- **클라이언트 쪽 정규화 — `normalizeLevel(v)`/`normalizeOverallLevel(v, levels)`**(새
  헬퍼, `escapeHtml()` 바로 뒤)가 AI 응답/로컬 시뮬레이션 양쪽을 거친다. `normalizeLevel`은
  값이 이미 '상'/'중'/'하'면 그대로 쓰고, 아니면(캐시된 구버전 응답이 숫자를 돌려주는 경우에
  대한 방어적 폴백 — 이 저장소의 "레거시/이상 데이터에 대한 방어적 처리" 관행) 숫자로 해석해
  80 이상→상, 60 이상→중, 그 외→하로 버킷팅한다. `normalizeOverallLevel`은 `overallGrade`가
  이미 상/중/하면 그대로, 아니면(예: 캐시된 `"A (우수)"` 같은 구버전 문자 등급) 네 영역의
  정규화된 레벨에 대해 다수결로 종합 등급을 역산한다 — 동점이면 상→중→하 순으로 먼저
  매칭된 값을 쓴다.
- **`renderReportUI(data)`**가 각 `scoreNVal`의 `innerText`를 숫자+"점" 대신 레벨 단어
  그대로 보여주고, `barN`의 width를 `LEVEL_BAR_WIDTH`(상=100%/중=66%/하=33%, 세 단계
  고정값) 테이블에서 가져온다. `totalScoreBadge`도 `"종합 등급: " + overallLevel` 형식으로
  바뀌었다(기존엔 등급 문자열을 그대로 붙여 보여줬을 뿐). HTML의 네 점수 placeholder와
  `resetReportUI()`의 초기화 값도 `-점`에서 `-`로 바꿔서, 숫자+단위라는 전제를 없앴다.
- **`runLocalSimulation()`**(AI 호출 실패 시 폴백)의 목 데이터도 `scoreLogic`~
  `scoreAttitude`/`overallGrade`를 전부 `'상'`으로 바꿨다 — 숫자 점수와 `"A (최우수)"` 문자
  등급 조합을 완전히 제거했다.
- `test_mock_interview_level_grading.js`(새 테스트)로 (1) AI가 상/중/하를 직접 돌려주면
  네 영역 모두 그 글자 그대로 렌더링되고 막대 폭도 정확히 100%/66%/33%인지, 종합 등급도
  그 글자 그대로 보이는지, (2) 캐시된 구버전 숫자 점수(88/65/40/90)+문자 등급(`"A (우수)"`)
  응답이 각각 상/중/하/상으로 버킷팅되고, 종합 등급도 다수결로 "상"(2표, 중/하는 1표씩)으로
  역산되는지, (3) 로컬 시뮬레이션 폴백도 네 영역+종합 모두 "상"으로 뜨는지 — 모두
  확인했다. 기존 `test_mock_interview_redesign.js`/`test_mock_interview_speech_errors.js`/
  `test_mock_interview_mic_dedupe.js`/`test_mock_interview_mic_dedupe2.js`/
  `test_mock_interview_unsupported.js`/`test_mock_interview_keyword_tags.js`도 다시 돌려
  회귀가 없음을 확인했다.

## `mock-interview.html` — 참고 질문 입력칸 제거 + 강점/보완점을 "키워드만"에서 "키워드 + 한 줄 설명"으로

사용자가 실제로 써보고 두 가지를 요청했다: "모의 면접 전사 분석이 잘 되는 걸 확인했어.
질문과 답변을 모두 전사하는 것이기 때문에 질문+답변 전사 칸만 필요하고 그 위에 질문 칸은
굳이 필요 없을 거 같애. 그리고 키워드 중심으로 잘 나오는데 너무 간결해. 키워드를
제시하되 강점과 보완 내용을 조금 더 설명해주면 좋겠어."

**① "면접 질문 내용"(참고 질문) 입력칸 완전 제거.** 각 문항은 이미 면접관의 질문과
학생의 답변을 **하나의 연속 녹음 구간**으로 함께 전사하므로(위 "모의면접 분석 및
종합 보고서 시스템" 섹션의 "교사가 미리 적어두는 예상 질문" 설계 자체가, 질문도 결국
같은 전사 칸에 그대로 들어가 있다는 걸 생각하면 중복이었다), 교사가 따로 참고 질문을
타이핑해 넣는 `renderQuestionContent()`의 "면접 질문 내용" `<textarea>`/라벨 블록을
통째로 지웠다 — 이제 문항 패널은 번호/구간 헤더 다음 곧바로 "전사된 질문+답변
텍스트" 칸으로 이어진다. `questionText` 데이터 필드 자체(와 `updateQData(id,
'questionText', ...)` 호출 지점)는 남아있지만 더 이상 어떤 UI에서도 쓰이지 않고,
`loadSampleData()`의 세 샘플 문항도 전부 `questionText: ""`로 비워뒀다 — 질문 내용은
전사 텍스트 안에 이미 들어있으므로, UI에서 입력받던 값이 사라져도 데이터 손실이 아니다.

**② 강점/보완점이 "키워드 칩만"에서 "키워드 + 그걸 뒷받침하는 1문장 설명"으로.**
바로 전 라운드에서 만든 키워드 칩(짧은 명사형 구절만, 설명 없음)이 "너무 간결하다"는
피드백 — 한눈에 훑어보는 장점은 유지하되, 그 키워드가 왜 그런지 바로 알 수 있는 설명을
덧붙이기로 했다.
- **스키마 변경**: `strengths`/`weaknesses`/`detailed[].strength`/
  `detailed[].improvement`가 전부 짧은 키워드 문자열 배열에서 `{keyword, detail}`
  객체 배열로 바뀌었다 — `keyword`는 그대로 2~8글자 안팎의 짧은 구(한눈에 훑어보는
  용도), `detail`은 그 키워드를 뒷받침하는 구체적인 설명 1문장(대략 20~60자, 전사
  내용의 어떤 부분이 근거인지 담음).
- **`keywordTagsHtml(items, variant)`**(클라이언트, 바로 전 라운드에서 만든 함수)를
  다시 썼다 — 평평한 칩 목록(`<span>` 여러 개를 나란히 흘려보냄) 대신, 각 항목을
  `<div class="flex items-start gap-2">` 한 줄로 만들어 왼쪽에 키워드 알약(기존과 같은
  `rounded-full` pill, 에메랄드/로즈 색)을, 그 옆에 설명 텍스트(`text-slate-600`)를
  나란히 보여준다. **이전 데이터 형태와의 하위 호환은 그대로 유지**했다 — 입력이
  평범한 문자열 배열(옛 키워드-전용 캐시 응답)이면 키워드만 있고 `detail`은 비워서
  보여주고(설명 줄 자체를 생략), 입력이 아예 한 줄짜리 줄글(그보다 더 예전의 프로즈
  캐시)이면 기존처럼 쉼표/가운뎃점/줄바꿈으로 쪼개 키워드만 보여준다 — 두 경우 모두
  새 객체 스키마가 아니라는 것만으로 화면이 깨지지 않는다.
- **HTML**: `#repStrengths`/`#repWeaknesses` 컨테이너를 `flex flex-wrap gap-1.5`(칩이
  옆으로 흐르는 레이아웃)에서 `flex flex-col gap-1.5`(설명이 붙어 폭이 넓어진 줄들이
  위아래로 쌓이는 레이아웃)로 바꿨다. 문항별 상세 피드백 블록의 강점/보완점도 같은
  이유로 인라인 한 줄(`<strong>` 라벨 + 칩들이 같은 줄)에서, 라벨을 자기 줄에 두고 그
  아래 `flex flex-col gap-1`로 키워드+설명 줄들을 쌓는 2단 구조로 바꿨다.
- **`runLocalSimulation()`**(AI 호출 실패 시 로컬 폴백)의 목 데이터도 전부 같은
  `{keyword, detail}` 형식의 실제 한국어 예시로 다시 썼다 — AI 경로와 로컬 폴백 경로가
  시각적으로 계속 일관되게 보인다.
- **Edge Function `interview-report`**(버전 4 → 5로 재배포)의 프롬프트를 두 군데
  고쳤다 — (1) `qaText` 템플릿에서 "참고 질문: ..." 줄을 완전히 뺐다(UI가 더 이상
  `questionText`를 수집하지 않으므로 보낼 값이 없다). 대신 프롬프트 지시사항 2번을
  "전사에 질문을 소리 내어 읽은 부분이 전혀 없으면, 분리된 질문 항목은 답변 내용으로
  미루어 짐작할 수 있는 간단한 질문 형태로 재구성하라(빈 값으로 두지 말라)"로
  바꿨다(이전엔 "참고 질문을 그대로 쓰라"였는데, 그 참고 질문 자체가 더 이상
  없으므로). (2) JSON 스키마 설명과 few-shot 예시를 `{keyword, detail}` 객체 배열
  형식으로 바꾸고, keyword(2~8글자)/detail(20~60자, 전사 근거 포함) 각각의 길이·내용
  기준을 명시했다 — `question`/`answer`(질문/답변 분리 자체는 이전 그대로, 사실
  발췌라 문장 형태 유지)와 `strength`/`improvement`/`strengths`/`weaknesses`(이번에
  객체로 바뀐 필드)의 형식 요구가 다르다는 걸 프롬프트 안에서 분명히 구분해뒀다.
- `test_mock_interview_no_question_field.js`(새 테스트)로 (1) 초기 상태/샘플 데이터
  로드 후/다른 탭으로 전환한 뒤 모두 "면접 질문 내용" 라벨이 전혀 없는지, (2) 전사
  텍스트 칸은 그대로 있고 정상적으로 값을 읽고 수정할 수 있는지 — 확인했다.
  `test_mock_interview_keyword_tags.js`를 새 `{keyword, detail}` 스키마와 DOM 구조에
  맞게 다시 썼다 — (A) AI 경로에서 강점/보완점/문항별 상세 모두 키워드+설명이 각각의
  줄로 올바르게 렌더링되는지(키워드 알약 스타일 유지 확인 포함), (B) 로컬 시뮬레이션
  폴백도 모든 줄에 설명까지 포함돼 있는지, (C) 하위 호환 — 옛 "키워드 문자열 배열"과
  그보다 더 옛 "쉼표로 묶인 줄글 문자열" 두 형태 모두 설명 없이 키워드만 깨지지 않고
  보이는지 — 모두 검증했다. 기존 `test_mock_interview_redesign.js`/
  `test_mock_interview_speech_errors.js`/`test_mock_interview_mic_dedupe.js`/
  `test_mock_interview_mic_dedupe2.js`/`test_mock_interview_unsupported.js`/
  `test_mock_interview_level_grading.js`도 다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — 기본 문항은 1개만 + 지도 교사(선택) 입력 → 보고서 이름/서명칸

사용자가 두 가지를 요청했다: "학생의 이름과 학번을 입력 받을 때 지도 교사도 입력
받고(선택 사항), 만약 지도 교사가 입력됐다면 보고서에도 지도 교사 이름과 서명칸이
나오도록. 지금은 질문 1, 질문 2, 질문3 이 기본 세팅되어 있고 질문2까지만 녹음하면
질문3을 대답하지 않았다고 나와. 기본적으로는 질문1만 보여주고, 문항 추가를 하면
질문2, 질문3 순서대로 생성하는 것으로 해줘."

**① 기본 문항 개수를 3개에서 1개로.** `defaultQuestions()`가 질문1/질문2/질문3을
전사 빈 채로 미리 깔아두던 게 실제 버그의 원인이었다 — 교사가 질문2까지만 마커를
눌러 녹음해도, 애초에 깔려있던 "질문3"이 전사가 비어있는 채로 AI 분석에 그대로
넘어가서 "대답하지 않음"으로 평가됐다. 사용자가 요청한 그대로 `defaultQuestions()`가
이제 1번 문항 하나만 돌려준다 — `addNewQuestion()`("+ 문항 추가" 버튼)과
`triggerQuestionMarker()`("다음 문항 구분 (마커)" 버튼, 녹음 중 다음 문항으로 넘어갈
때)는 이미 둘 다 그 시점의 `questions.length + 1`/`currentTabId + 1`로 다음 순번
문항을 그때그때 만드는 구조라 손댈 필요가 없었다 — 문항 2, 3, ...은 이제 교사가
실제로 "+ 문항 추가"를 누르거나 마커로 넘어갈 때만, 순서대로 생성된다. `resetAll()`도
`defaultQuestions()`를 그대로 재사용하므로 초기화 후에도 1개 탭으로 돌아간다 —
`loadSampleData()`(샘플 채우기)는 여러 문항 기능을 보여주는 데모라 그대로 3개 샘플
문항(전사 내용이 전부 채워진 채)을 유지한다.

**② 지도 교사(선택 사항) 입력 + 보고서 이름/서명칸.** "지원자 및 면접 정보" 카드의
"면접 일시" 입력칸과 같은 줄에 "지도 교사 (선택 사항)" 텍스트 입력칸
(`#supervisingTeacher`)을 추가했다 — 학생 이름/지원 학과처럼 필수가 아니라, 비워두면
아무 영향이 없다. 보고서(`reportContainer`) 맨 아래, "담당 선생님 종합 소견" 블록
바로 다음에 `#teacherSignatureBlock`(기본 `hidden`)을 새로 추가했다 —
"지도교사: <이름> 서명: ____"(밑줄만 그려진 빈 서명칸, 인쇄해서 직접 서명하는 용도)
형태로, **지도 교사 이름이 입력됐을 때만** 보인다. `updateTeacherSignatureDisplay()`
가 그 입력칸 값의 유무로 블록을 보이기/숨기기 하고 이름을 채워 넣는다 — 입력칸
자신의 `oninput`에도 바로 연결돼 있어서, 분석을 돌리기 전에 미리 입력해둬도 즉시
반영되고(분석/최종 확정을 거쳐야만 나타나는 게 아님), `generateAnalysis()`/
`finalizeReport()`에서도 한 번씩 더 호출해 안전망을 둔다. `resetAll()`은 그 입력칸을
비우고 `resetReportUI()`가 블록을 다시 숨긴다. `loadSampleData()`도 샘플 지도교사
이름("이지은")을 채워 넣어서, "샘플 채우기" 한 번으로 이 기능까지 바로 볼 수 있게
했다 — 학번 입력 자체는 애초에 이 페이지에 없는 필드라(학생 이름만 받음) 손대지
않았다.

`test_mock_interview_default_q_and_signature.js`(새 테스트)로 (A) 새 세션이 정확히
1개 탭으로 시작하고 "+ 문항 추가"를 두 번 누르면 2번, 3번이 순서대로 생성되는지,
(B) 질문1만 전사를 채운 뒤 분석을 돌리면 API에 실제로 문항 1개만 전송되는지(예전
버그의 "유령 미답변 문항 3" 재현 방지 확인), (C) 지도 교사 입력칸이 비어있으면
서명칸이 숨겨지고, 타이핑하면(분석 전에도) 즉시 나타나고, 지우면 다시 숨겨지고,
분석을 돌린 뒤에도 이름이 그대로 유지되고, 전체 초기화 후 다시 숨겨지는지, (D) 샘플
채우기가 지도 교사 이름과 서명칸을 함께 보여주는지 — 모두 확인했다. 기존
`test_mock_interview_redesign.js`의 탭 개수 관련 단언 세 곳(마커 직후 2개 탭으로
시작, 삭제 후 1개로 줄어듦, 초기화 후 1개로 복귀 — 전부 "3개 기본값" 전제가
바뀌었으므로)을 새 기본값에 맞게 고쳤고, `test_mock_interview_smoke.js`의 구식
"문항 탭 3개" 로그 문구도 "1개로 시작"으로 맞췄다(이 스모크 테스트는 이전부터
있던 버튼-셀렉터 한계로 여전히 예외 없이 완전하게는 안 돌지만, 문구 자체는
고쳐서 혼동을 줄였다). `test_mock_interview_speech_errors.js`/
`test_mock_interview_mic_dedupe.js`/`test_mock_interview_mic_dedupe2.js`/
`test_mock_interview_unsupported.js`/`test_mock_interview_level_grading.js`/
`test_mock_interview_keyword_tags.js`/`test_mock_interview_no_question_field.js`도
다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — 담당 선생님 소견이 없으면 인쇄할 때 그 카드 자체를 생략

사용자 요청: "담당 선생님 소견이 없는 경우 인쇄할 때 담당선생님 소견 칸은 아예 생략해
버리자. 있을 때만 나오게 하고." 기존엔 `#repTeacherMemo`가 비어있어도 "입력된 선생님
소견이 없습니다."라는 placeholder 문구와 함께 "담당 선생님 종합 소견" 카드 자체는
화면/인쇄 양쪽에 항상 그대로 떴다 — 실제로 아무 의견도 안 적혀 있는데 인쇄물에 그
카드 한 칸이 그대로 남는 게 어색하다는 요청.

- **화면에서는 placeholder를 그대로 유지하고, 인쇄할 때만 카드를 숨긴다** — 화면에서
  빈 카드를 완전히 없애면 "소견을 적을 수 있는 자리가 있다"는 걸 교사가 알기 어려워지므로,
  빈 상태의 placeholder 문구는 화면 작업 중엔 여전히 유용한 안내다. 숨기는 건 오직
  "인쇄/PDF" 시점 — 기존 `@media print{...}` 블록(`.no-print`/`.print-only`/
  `.print-shadow`와 같은 자리)에 새 `.print-hide-empty{ display:none !important; }`
  규칙을 추가했다.
- **`<div id="teacherMemoBlock">`**(기존엔 id가 없던, "담당 선생님 종합 소견" 제목+
  `#repTeacherMemo`를 감싸는 바깥 카드)에 id를 붙이고, **`updateTeacherMemoDisplay
  (teacherMemo)`**(새 함수, `updateTeacherSignatureDisplay()` 바로 앞) 하나가
  `repTeacherMemo`의 텍스트를 채우는 것과 `teacherMemoBlock`에 `print-hide-empty`
  클래스를 토글하는 것을 함께 처리한다 — `repTeacherMemo.innerText = ...`를 직접
  쓰던 기존 세 곳(`resetReportUI()`, `generateAnalysis()`의 1차 분석 직후,
  `finalizeReport()`의 최종 확정 직후) 모두 이 함수 호출로 교체했으므로, 어느 경로로
  보고서가 갱신되든 인쇄 숨김 여부가 항상 최신 소견 유무와 일치한다.
- `test_mock_interview_print_hide_memo.js`(새 테스트, Playwright `page.emulateMedia
  ({media:'print'})`로 실제 print 미디어 쿼리 하에서의 `computed display`를 직접
  확인)로 (1) 소견 없이 1단계 분석만 끝낸 상태에서 화면에는 카드가 여전히 보이지만
  print 미디어에서는 `display:none`으로 계산되는지, (2) 선생님 메모를 입력하고
  2단계로 확정하면 그 카드가 print 미디어에서도 숨겨지지 않는지, (3) "전체 초기화"
  후에는 다시 숨김 상태(+placeholder 문구)로 돌아가는지 — 모두 확인했다. 기존
  `test_mock_interview_redesign.js`/`test_mock_interview_speech_errors.js`/
  `test_mock_interview_mic_dedupe.js`/`test_mock_interview_mic_dedupe2.js`/
  `test_mock_interview_unsupported.js`/`test_mock_interview_level_grading.js`/
  `test_mock_interview_keyword_tags.js`/`test_mock_interview_no_question_field.js`/
  `test_mock_interview_default_q_and_signature.js`도 다시 돌려 회귀가 없음을
  확인했다.

## `mock-interview.html` — "다음 문항 마커" 지연으로 전사 앞부분이 잘릴 수 있다는 걸 AI 분석이 감안하도록

사용자 요청: "다음 문항 마커 구분을 누르는 걸 깜빡할 경우 앞부분 질문이나 답변이
짤릴 수 있는데 그건 분석에서 감안해 줬으면 좋겠어. 질문이 짤렸을 경우에는 학생의
답변을 바탕으로 질문을 추측해서 채워줘도 되고." 이 페이지의 "다음 문항 구분 (마커)"
버튼을 교사가 늦게 누르면, 그 문항의 전사 구간이 실제 질문/답변 경계보다 늦게
시작하게 돼 — 면접관의 질문 전체(또는 학생 답변의 도입부)가 그 문항의 전사에
전혀 안 들어가고 통째로 이전 문항의 전사 뒤쪽에 섞여 들어가거나, 아예 녹음 자체에
안 잡혀 사라질 수 있다. 이미 프롬프트에는 "전사에 질문이 전혀 없으면 답변으로
질문을 재구성하라"는 지시(2번 규칙)가 있었지만, "왜 질문이 없을 수 있는지"(마커
지연으로 인한 누락)와 "문장이 중간에서 끊긴 채 시작하는 경우"(완전히 없는 게
아니라 일부만 잘린 경우)는 다루지 않았다.

- **Edge Function `interview-report`의 프롬프트에 4번 규칙을 추가**(버전 5 →
  6으로 재배포) — "선생님이 마커 버튼을 누르는 시점이 늦어지면 전사가 질문/답변
  경계보다 늦게 끊기거나 시작될 수 있다"는 전제를 명시하고, 전사가 질문 없이
  답변 중간부터 시작하는 것처럼 보이거나 문장이 끊긴 채 시작하면 이를 "마커
  지연으로 인한 녹음 누락"으로 이해하라고 지시했다. 결정적으로 **"절대로 전사가
  불완전하다는 이유로 감점하거나 질문을 알 수 없음으로 처리하지 말고, 남아있는
  답변 내용만으로 질문을 자연스럽게 추측해 재구성하고, 남아있는 답변 내용을
  최대한 근거로 공정하게 평가하라"**는 문장을 함께 넣었다 — 이 지시는 기존 2번
  규칙(질문이 전혀 없을 때의 재구성)과 겹치지만, "완전히 없는 경우"뿐 아니라
  "일부만 잘린 경우"까지 명시적으로 커버하고, "불완전한 전사라서 감점하지
  말라"는 공정성 지시를 추가로 분명히 했다는 점이 다르다.
- 이 변경은 순수 프롬프트 수정이라 요청/응답 스키마, 클라이언트 코드 모두
  바뀌지 않았다 — 테스트는 기존 `test_mock_interview_redesign.js`(API 페이로드
  모양 검증)로 요청 스키마가 그대로임을 재확인했을 뿐, 이 환경에서는 실제
  Claude 호출 성공 여부/품질까지는 검증할 수 없다(이 문서 다른 곳에도 반복되는
  `api.anthropic.com` 아웃바운드 차단 제약). 실제 효과는 교사가 마커를 늦게
  누른 실제 면접에서 확인해야 한다.

## `mock-interview.html` — 인쇄 시 nav.js 플로팅 아이콘(홈/나의 페이지 등)과 중복된 앱 UI 제목 바를 모두 숨겨, 한 장짜리 보고서처럼 보이게

사용자 요청: "보고서 인쇄 페이지에 위에 홈 버튼 나의 페이지 아이콘 등이 나오는데
나오지 않게 하고 문서 한장이 하나의 보고서 형태처럼 보이게 정리해줘." 이 페이지도
다른 거의 모든 페이지처럼 `<script src="./nav.js" defer>`를 로드하므로, 그 스크립트가
주입하는 떠다니는 햄버거/🏠/👤 아이콘 묶음(클래스가 전부 `gsnav-`로 시작 — `nav.js`
섹션의 기존 설명 그대로)이 화면뿐 아니라 인쇄 시에도(`position:fixed` 요소는 크롬
인쇄에서 페이지마다 다시 그려질 수 있음) 그대로 찍혀 나왔다. `grade-estimate.html`이
이미 같은 문제를 겪고 똑같은 방식으로 고친 전례(이 문서의 "Bug: 3단 레이아웃..."
항목 — nav.js 자체를 건드리지 않고, 그 페이지 자신의 `@media print` 블록에
`[class^="gsnav-"], [class*=" gsnav-"]{ display:none !important; }`를 추가하는
방식)를 그대로 가져왔다.

- **`[class^="gsnav-"], [class*=" gsnav-"]{ display:none !important; }`**를 기존
  `@media print{...}` 블록에 추가 — nav.js 자신은 전혀 안 건드렸으므로 다른 모든
  페이지의 nav.js 동작에는 영향이 없고, 이 페이지의 인쇄 CSS에만 적용된다.
- **보고서 카드를 감싸던 바깥 앱 UI 프레임도 함께 정리했다.** 기존엔 보고서
  (`#reportContainer`, 실제 보고서 제목 "모의면접 역량 진단 및 종합 평가 보고서"를
  자체적으로 갖고 있음)를 둘러싼 바깥 카드(`#reportFrame`, 새로 id 추가)가 그 위에
  또 다른 짙은 남색 그라데이션 제목 바("학생 모의면접 평가 보고서" + 인쇄 버튼)를
  갖고 있어서 — 인쇄했을 때 제목이 두 번(앱 UI 제목 바 + 보고서 자체 제목) 겹쳐
  나오는 모양이었다. 그 제목 바 `<div>`에 `no-print`를 추가해 인쇄 시 완전히
  숨기고, `#reportFrame`에는 `border:none; box-shadow:none; border-radius:0`을
  줘서 "카드 안에 또 카드가 떠 있는" 느낌 없이 보고서 하나가 바로 종이 위에 놓인
  모양이 되게 했다(`#reportContainer`가 이미 갖고 있던 `print-shadow` 클래스가
  그 안쪽에 옅은 테두리를 그대로 유지한다).
- **`main`의 중앙 정렬·좌우 패딩도 인쇄 시엔 제거**(`padding:0; max-width:100%`)해서
  보고서가 화면에서처럼 좁은 한 칼럼(최대 `max-w-2xl`)에 갇히지 않고 인쇄 페이지
  너비를 그대로 채우도록 했다 — 종이 한 장에 들어찬 문서처럼 보이는 효과.
- `test_mock_interview_print_chrome_hidden.js`(새 테스트)로 (1) 화면에서는 nav.js의
  gsnav 아이콘이 실제로 존재/보이는지(사라진 걸 확인하려면 먼저 있다는 걸 확인해야
  하므로), (2) print 미디어 쿼리 하에서 그 아이콘들이 전부 `display:none`으로
  계산되는지, (3) 보고서 바깥의 중복 제목 바가 인쇄 시 숨겨지는지, (4) `#reportFrame`의
  테두리/그림자/모서리가 인쇄 시 전부 제거되는지, (5) `#reportContainer`의 실제
  보고서 제목은 인쇄 시에도 그대로 보이는지, (6) `main`이 인쇄 시 전체 폭으로 펼쳐지는지,
  (7) 화면(screen 미디어)으로 되돌리면 제목 바/아이콘 모두 다시 정상적으로 보이는지
  (회귀 없음) — 모두 확인했다. 기존 `test_mock_interview_redesign.js`/
  `test_mock_interview_speech_errors.js`/`test_mock_interview_mic_dedupe.js`/
  `test_mock_interview_mic_dedupe2.js`/`test_mock_interview_unsupported.js`/
  `test_mock_interview_level_grading.js`/`test_mock_interview_keyword_tags.js`/
  `test_mock_interview_no_question_field.js`/`test_mock_interview_default_q_and_signature.js`/
  `test_mock_interview_print_hide_memo.js`도 다시 돌려 회귀가 없음을 확인했다.

## `korean-inquiry.html` — 저장(중간 저장)과 제출(선생님께 최종 제출)을 분리

사용자 요청: "문법 탐구 챗봇은 중간까지의 과정을 저장할 수 있는 저장 버튼을 추가하고, 제출은
최종으로 선생님한테 낸다는 뜻이야." (여기서 "문법 탐구 챗봇"은 `korean-inquiry.html` —
국어 현상 탐구 챗봇 — 을 가리킨다. 활동1이 문법 개념/문법적 분석을 다루기 때문.)

이 페이지는 원래부터 **자동 저장**(각 입력 필드의 `input` 이벤트마다 `scheduleSave()`가
900ms 디바운스 뒤 `inquiry_session_save` RPC를 호출, `#globalSaveIndicator`에 "✓ 자동
저장됨 HH:MM"/"⚠ 저장 실패"로만 조용히 표시)과 **제출**(`#btnSubmit` → `submitActivity()`
→ `inquiry_session_submit` RPC, `submitted_at` 기록)을 둘 다 갖고 있었다 — 즉 "제출 =
선생님께 최종 제출"이라는 의미 자체는 이미 구현돼 있었다. 빠져 있던 건 **학생이 명시적으로
누를 수 있는 "저장" 버튼**뿐이었다 — 지금까지는 저장이 전부 조용한 자동 동작이라, 학생이
"지금까지 쓴 걸 바로 저장해달라"고 직접 요청할 방법이 없었다.

- **`#btnSaveProgress`**("💾 저장하기", `.btn.secondary`)를 활동 탭 영역 맨 아래,
  "✅ 제출하기" 버튼 바로 왼쪽에 추가했다. 그 위에 `.save-submit-hint` 한 줄("💾 저장하기:
  지금까지 쓴 내용을 저장해요 (언제든 눌러도 돼요). · ✅ 제출하기: 선생님께 최종으로
  제출해요.")을 둬서, 두 버튼의 역할이 서로 다르다는 걸 글로도 분명히 했다.
- **`saveProgressManual()`**(새 함수) — 클릭 즉시 `clearTimeout(saveTimer)`로 대기 중인
  자동 저장 디바운스를 취소하고(중복 저장 방지), `doSave()`(기존 자동 저장과 완전히 같은
  RPC 호출 — 새 엔드포인트나 새 RPC는 필요 없었다)를 **그 자리에서 바로** 실행한다. 버튼
  자신의 라벨을 "💾 저장 중…" → 성공 시 "✓ 저장했어요"/실패 시 "⚠ 저장 실패"로 1.5초간
  바꿔 보여주고(그 사이 버튼은 `disabled`), 그 뒤 원래 라벨로 되돌린다 — `collect.html`의
  "복사됨!" 라벨 임시 교체(1500ms 후 원복)와 같은 이 저장소의 관례를 그대로 따랐다.
  **절대로 `inquiry_session_submit`을 호출하지 않는다** — 저장은 저장일 뿐, 제출 배지
  (`#submitBadge`)는 "저장하기"를 눌러도 "아직 제출 전" 상태 그대로 유지된다.
- **제출 확인 문구**(`submitActivity()`의 `confirm()`)도 "최종"이라는 단어를 명시적으로
  넣어 고쳤다: `'지금까지 작성한 내용을 선생님께 최종 제출할까요? ("제출하기"는 선생님에게
  이 활동을 다 했다고 알리는 최종 동작이에요. 제출 후에도 내용은 계속 수정할 수 있어요.)'`
  — 기존 문구("제출 후에도 내용은 계속 수정할 수 있어요")가 담고 있던 "제출해도 잠기지
  않는다"는 사실은 그대로 유지했다(그 동작 자체는 바꾸지 않았다 — 제출 후에도
  `inquiry_session_save`는 계속 같은 행을 덮어쓴다). 제출 버튼/로직(`submitActivity()`)
  자체는 코드 변경 없음 — 이미 "최종"이라는 의미를 정확히 구현하고 있었으므로, 바뀐 건
  그 의미를 학생에게 더 분명하게 전달하는 문구뿐이다.
- `test_korean_inquiry_save_button.js`(새 테스트)로 (1) 저장하기/제출하기 버튼이 둘 다
  있고 둘의 역할을 설명하는 안내 문구가 있는지, (2) "저장하기"를 누르면 (자동 저장의
  900ms 디바운스를 기다리지 않고) 즉시 `inquiry_session_save`가 정확히 한 번 호출되고,
  `inquiry_session_submit`은 전혀 호출되지 않으며, 제출 배지가 "아직 제출 전"을 유지하고,
  버튼에 "저장했어요" 피드백이 뜬 뒤 원래 라벨로 돌아오는지, (3) 저장이 실패하면 버튼에
  "실패" 피드백이 뜨는지, (4) "제출하기"의 확인창 문구에 "최종"이라는 단어가 포함돼
  있고, 확인을 수락하면 `inquiry_session_submit`이 정확히 한 번 호출되는지 — 모두
  검증했다. 기존 `test_korean_inquiry.js`도 다시 돌려 회귀가 없음을 확인했다(이 과정에서
  그 테스트 자신의 두 가지 사전 존재 결함도 함께 고쳤다 — 아래 참고).

**부수적으로 발견·수정한 `test_korean_inquiry.js` 자체의 결함 2건(이번 변경과는 무관,
테스트 코드 안의 문제였다):**
1. [12]번(교사용 삭제 버튼) 검증이 `document.getElementById('teacherPanel').style.display
   = ''`로 로그인 없이 직접 패널을 열어두는 기존 방식을 쓰면서, 실제 로그인 플로우
   (`tryEnterTeacherMode()`)가 세팅하는 `canDeleteInquirySessions` 플래그를 함께 세팅하지
   않아 항상 `false`로 남아있었다 — 그 결과 "삭제 버튼이 보여야 한다"는 단언이 항상
   실패했다(이번 작업과 무관하게 이미 깨져 있던 상태였다). `page.evaluate`에
   `canDeleteInquirySessions = true;`를 추가해 고쳤다.
2. [6]번(챗봇 응답 렌더링) 검증의 `document.querySelectorAll('.chat-bubble.bot')`/
   `.chat-bubble.bot:last-child` 셀렉터가 문서 전체를 대상으로 해서, `showTyping()`이
   `#chatTypingArea`(채팅 목록과 별개의 컨테이너)에 띄우는 "입력 중" 점 세 개짜리 말풍선
   (`class="chat-bubble bot"`, 텍스트 없음)까지 함께 매치했다 — 타이밍에 따라 실제 답변이
   오기 전에 "입력 중" 말풍선 하나(+처음부터 있던 인사 말풍선)만으로 `length>=2` 조건이
   먼저 만족돼, `:last-child`가 그 빈 "입력 중" 말풍선을 집어 "reply rendered" 검증이
   빈 문자열로 실패하는 레이스 컨디션이었다. 두 셀렉터 모두 `#chatMessages
   .chat-bubble.bot`으로 좁혀서(타이핑 말풍선이 들어있는 `#chatTypingArea`는 제외) 고쳤다.

## `food-map.html` 목록 카드 — 수정/삭제를 글자 버튼에서 연필/엑스 아이콘으로

모바일 실사용 스크린샷 제보: 가게 이름이 "맛김치…"/"운남양…"처럼 2~3글자만 겨우 보이고
바로 말줄임돼 사실상 안 읽힌다는 보고였다. 원인은 레이아웃 버그가 아니라 단순 공간
부족이었다 — 첫째 줄(`.spot-item-row1`)에 제목 + 좋아요(💜N) + 별점(⭐-(N)) + "수정" +
"삭제" **다섯 개**가 전부 들어가야 했는데, 뒤의 네 버튼이 차지하는 고정폭이 (특히 좁은
모바일 화면에서) 제목이 쓸 수 있는 나머지 공간을 거의 다 먹어버렸다(`.spot-item-title`은
`flex:1 1 auto; min-width:0`이라 공간이 부족한 만큼 그대로 눌려 말줄임된다 — 데스크톱
스크린샷에서는 아예 글자가 한 글자도 안 보일 만큼 짓눌린 경우도 있었다). Supabase에서
실제 데이터를 직접 조회해 모든 가게에 이름이 정상적으로 들어있는 걸 먼저 확인했으므로
(데이터 손실이 아님), 이건 순수하게 레이아웃 공간 문제였다.

**레이아웃(어느 줄에 무엇이 있는지)은 그대로 두고, "수정"/"삭제" 글자 버튼만 작은 원형
아이콘 버튼으로 바꿨다** — 처음엔 카테고리/설명/좋아요/별점까지 줄 사이에서 재배치하는
더 큰 리디자인을 시도했다가, 사용자가 "이 구성[원래 레이아웃]으로 하고, 수정 삭제만
아이콘으로 바뀌지"라고 명시적으로 범위를 좁혀줘서 그 재배치는 전부 되돌리고 아이콘 전환만
남겼다:
- **첫째 줄**: 제목 + 좋아요 + 별점 + ✏️(수정) + ✕(삭제) — 순서·소속 줄 전부 기존 그대로.
- **둘째 줄**: 카테고리 + 설명 — 역시 기존 그대로.
- `.icon-btn`(새 클래스, 26×26px 원형 버튼, `border-radius:999px`)이 기존 `.btn.secondary
  .small`("수정")/`.btn.danger.small`("삭제") 텍스트 버튼을 대체한다 — 삭제 아이콘은
  `.icon-btn.danger`로 빨간 테두리/글자색을 유지(기존 `.btn.danger`와 같은 시각적 의미).
  `title`/`aria-label`에 "수정"/"삭제"를 그대로 남겨서 스크린리더·툴팁에서는 여전히 글자로
  읽힌다. 클릭 핸들러(`data-edit`/`data-del`, `openEditForm`/`deleteSpot` 호출)는 전혀
  안 바뀌었다 — 버튼의 보이는 모양만 바뀌었을 뿐 이벤트 위임 로직은 그대로다.
- 글자 버튼 두 개(약 45px씩, 90px)가 아이콘 두 개(26px씩 + 간격, 약 55px)로 줄어든 만큼
  제목이 쓸 수 있는 공간이 넓어졌다 — Playwright로 모바일 폭(390px)에서 "화림가든"/
  "치악추어탕" 같은 실제 이름이 말줄임 없이 온전히 보이는 것을 스크린샷으로 확인했다.
- `test_foodmap_icon_buttons.js`(새 테스트)로 (1) 첫째 줄에 제목+좋아요+별점+✏️+✕가 다
  있고 "수정"/"삭제" 글자는 더 이상 없는지, (2) 둘째 줄에 카테고리+설명이 그대로인지,
  (3) 옛 `.btn.secondary.small`/`.btn.danger.small` 텍스트 버튼이 하나도 안 남았는지,
  (4) ✏️ 클릭 시 여전히 그 가게 정보로 수정 폼이 열리는지, (5) ✕ 클릭 시 여전히 확인창
  → DELETE 요청(정확히 클릭한 가게의 id로) → 목록에서 제거까지 정상 동작하는지 — 모두
  검증했다.

## `food-map.html` 목록 카드 — 제목 칸에 절대 0px까지 눌리지 않는 최소폭 + 줄바꿈 안전장치

바로 위 "수정/삭제를 아이콘으로" 수정으로 공간을 넓혀줬지만, 사용자가 처음 보고했던
"제목이 아예 안 보인다"는 증상 자체의 원인을 "그냥 좁아서"로 단정한 건 틀렸다는 지적을
받았다 — 실제로 데스크톱 스크린샷에서는 글자가 말줄임(…)되는 정도가 아니라 **단 한
글자도 안 보이는** 완전한 공백이었는데, 그 폭에서 단순 계산으로는 말줄임표라도 남아야
정상이라 "좁아서"만으로는 다 설명이 안 됐다(이 환경엔 WebKit 엔진이 없어 실제 사파리에서
`flex`+`min-width:0`+`text-overflow:ellipsis` 조합이 종종 보이는, 글자가 줄어드는 대신
통째로 사라져버리는 알려진 렌더링 차이를 직접 재현·확정할 수는 없었다 — 크로미움만으로는
검증 불가능한 영역이라는 것도 사용자에게 투명하게 전달했다).

**원인을 완전히 확정하지 못한 상태에서도, 어떤 원인이든 상관없이 "제목이 0px까지 눌려
완전히 사라지는 것" 자체를 구조적으로 막는 방어 장치를 추가했다**:
- `.spot-item-title`의 `min-width:0` → `min-width:72px`(한글 4~5자 정도의 최소 보장
  폭)로 바꿨다 — `flex:1 1 auto`는 그대로라 공간이 넉넉하면 여전히 자유롭게 늘어나고
  줄어들지만, 아무리 좁아져도 이 72px 밑으로는 더 눌리지 않는다(브라우저별 ellipsis
  렌더링 차이와 무관하게, 애초에 0이나 그에 가까운 값까지 줄어들 수가 없으니 "글자가
  하나도 안 보이는" 현상 자체가 구조적으로 불가능해진다).
- `.spot-item-row1`의 `flex-wrap:nowrap` → `flex-wrap:wrap`으로 바꿔, 제목이 그 72px
  최소폭을 지키느라 버튼 묶음(`.spot-item-side`, 좋아요/별점/✏️/✕)이 같은 줄에 다 못
  들어가는 극단적으로 좁은 경우엔 버튼 묶음이 **다음 줄로 넘어가도록** 했다 — "제목이
  사라지는 것"보다 "버튼이 한 줄 아래로 내려가는 것"이 훨씬 덜 나쁜 결과라는 판단.
- 실제 모바일 기기가 쓸 수 있는 가장 좁은 축(320px, 구형 아이폰 SE/5급)에서는 72px
  최소폭을 적용해도 줄바꿈 없이 정상적으로 한 줄에 다 들어가는 것까지 확인했다
  (`test_foodmap_title_floor.js`) — 이보다 더 극단적으로 좁은(실제로는 거의 존재하지
  않는) 폭에서는 버튼 묶음이 둘째 줄로 넘어가는 선에서 그친다.
- `test_foodmap_title_floor.js`(새 테스트)로 (1) 320px 폭에서 제목이 72px 밑으로 눌리지
  않고 전체 텍스트가 그대로 다 보이는지, (2) 카드 자체가 가로로 넘치지(overflow) 않는지
  — 확인했다. 기존 `test_foodmap_icon_buttons.js`도 다시 돌려 회귀가 없음을 확인했다.

**이 수정은 "확실한 원인 제거"가 아니라 "원인이 뭐든 증상 자체를 못 일어나게 막는"
방어적 조치라는 점을 분명히 해둔다** — 실제로 사용자가 보고한 기기/브라우저를 특정하지
못했고(이 환경엔 Chromium만 있어 WebKit 특유의 렌더링을 직접 재현할 수 없음), 혹시 오래된
브라우저 캐시 때문이었을 가능성도 배제하지 못했다. 이 변경 + 바로 위 아이콘 버튼 변경이
실제로 효과가 있는지는 **main에 병합·배포된 뒤 사용자가 실제 기기에서 하드 리프레시
(캐시 무시 새로고침) 후 다시 확인해야** 확실해진다 — 그 전까지 실제 기기로 재확인해봐야
지금 보고 있는 화면은 여전히 오늘 변경 전의 배포본이다.

## `food-map.html` 목록 카드 — 바로 위 "최소폭+줄바꿈" 방어 장치를 되돌림(사용자 요청)

사용자가 명시적으로 "아이콘으로만 변경하고 배치는 수정하지 않아도 되겠어"라고 범위를
다시 좁혀줘서, 바로 위 섹션의 `min-width:72px`/`flex-wrap:wrap` 방어 장치를 전부
되돌렸다 — `.spot-item-row1`은 다시 `flex-wrap:nowrap`, `.spot-item-title`은 다시
`min-width:0`으로, 정확히 "수정/삭제를 아이콘으로" 커밋 직후의 상태로 복귀했다. 마크업
(`.spot-item-side`가 좋아요/별점/✏️/✕를 한 묶음으로 담고 `margin-left:auto`로 항상 카드
오른쪽 끝에 붙는 구조)은 애초에 전혀 안 바뀐 적이 없어서 — "아이콘 두 개는 카드 오른쪽에
붙여줘"라는 요청은 이미 그 구조로 충족돼 있었다.

**원인 불확실성 자체는 여전히 남아있다**(이 환경엔 WebKit이 없어 사파리 특유의 렌더링을
직접 검증할 방법이 없다는 한계는 바로 위 섹션에 적어둔 그대로) — 다만 사용자가 "그
정도까지 구조를 더 바꿀 필요는 없다"고 판단했으므로, 그 판단을 그대로 따랐다. 혹시
나중에 같은 증상(제목이 아예 안 보임)이 다시 보고되면, 바로 위 섹션에 적어둔 접근
(`min-width` 최소폭 + `flex-wrap` 줄바꿈 안전장치)을 다시 꺼내 쓸 수 있다는 것만
기록해둔다.

## `mock-interview.html` — 마커 없이 쭉 녹음해도 AI가 하나의 긴 전사를 여러 문항으로 자동 분리

사용자 질문: "모의 면접은 문항 구분을 하지 않고 전체 녹음을 해도 분석할때 문항을 나눠주려나?"
— 이전까지는 **아니었다**: "다음 문항 구분(마커)" 버튼이 "여기서부터 다음 문항"이라는
경계를 정하는 유일한 수단이었고, `interview-report` Edge Function은 입력받은 문항(녹음
구간) 개수와 **정확히 같은 길이**의 `detailed[]`만 돌려주도록 프롬프트가 강제돼 있었다
("detailed 배열은 입력된 문항 수와 같게 작성하세요") — 그래서 마커를 한 번도 안 누르고
면접 전체를 문항1 하나의 전사로 쭉 녹음하면, 그 안에 질문이 여러 개 섞여 있어도 AI는
문항 1개짜리 결과만 돌려줬다.

사용자가 "진행해줘"로 명시적으로 승인해 구현했다:

- **`interview-report` Edge Function을 버전 7로 재배포** — 프롬프트에 **5번 지시**를
  새로 추가했다: 한 녹음 구간(특히 마커를 거의/전혀 안 눌러 구간 수가 1~2개뿐인데 전사가
  유난히 긴 경우) 안에 서로 다른 질문에 대한 여러 번의 질문-답변 교환이 섞여 있을 수
  있다는 것, 면접관이 새 화제로 전환하는 지점("다음 질문은", "그럼 이번에는" 같은 문구나
  주제 전환)을 스스로 찾아 몇 개의 독립된 교환이 있는지 판단하라는 것, 교환이 하나뿐이면
  그대로 두고 여러 개면 그 구간 하나를 여러 개의 `detailed` 항목으로 쪼개 각각 따로
  분석하라는 것(반대로 이미 구간이 깔끔하게 문항 하나당 하나씩 나뉘어 있으면 억지로 쪼개거나
  합치지 말 것)을 지시한다.
- **"detailed 배열은 입력된 문항 수와 같게 작성하세요"라는 기존 강제 조건을 제거**하고,
  "detailed 배열의 길이는 입력된 녹음 구간 수와 같을 필요가 없습니다 — 5번 지시대로 쪼갠
  만큼 항목을 더 만드세요"로 바꿨다. `qNum`도 더 이상 입력 구간 번호를 그대로 쓰지 않고,
  **전체 면접에서 실제로 식별한 모든 질문-답변 교환을 시간 순서대로 1번부터 다시 번호
  매기도록** 지시했다(예: 구간이 1개인데 그 안에서 질문 3개를 찾았으면 qNum은 1,2,3).
  JSON 예시도 `detailed` 배열에 항목을 2개(서로 다른 구간처럼 보이지만 사실 같은 구간에서
  나온 것일 수도 있다는 걸 보여주는 예) 넣어서, "항목 수가 입력 개수와 달라도 된다"는 걸
  모델에게 구체적으로 보여줬다.
- **`qaText`(각 구간을 모델에게 보여줄 때 붙이는 라벨)를 "[문항 N]"에서 "[녹음 구간 N]"으로
  바꿨다** — 이 번호가 최종 출력의 `qNum`과 반드시 같지 않다는 걸 모델이 처음부터 헷갈리지
  않게 하려는 것. 이 라벨이 최종 "문항 번호"가 아니라 "선생님이 마커로 나눈 녹음 구간
  번호일 뿐"이라는 설명 문장도 새로 추가했다.
- **클라이언트(`mock-interview.html`)는 전혀 안 바꿨다** — `renderReportUI()`가 이미
  `(data.detailed || []).map(...)`로 배열 길이에 대한 어떤 가정도 없이 그대로 순회하며
  렌더링하고 있었고, `callInterviewReportApi()`도 그냥 현재 `questions` 배열(몇 개든)을
  그대로 보낼 뿐이라 — 서버가 입력보다 더 많은 `detailed` 항목을 돌려줘도 UI가 자동으로
  전부 표시한다. 즉 이 기능은 **순수 프롬프트 변경만으로 끝났다**, 클라이언트 쪽 "입력
  개수 == 출력 개수" 가정이 애초에 없었기 때문이다(단, `runLocalSimulation()` — AI 호출
  실패 시 로컬 샘플 폴백 — 은 여전히 `questions.map()`으로 1:1 매핑만 하는 단순 버전으로
  남겨뒀다, 이건 그냥 오프라인 대체 샘플일 뿐이라 분리 기능까지 흉내 낼 필요는 없다고
  판단했다).
- `test_mock_interview_autosplit.js`(새 테스트)로 (1) 기본 상태가 문항 탭 1개로
  시작하는지(마커를 한 번도 안 누른 상황 재현), (2) 긴 연속 전사를 그 문항 1개에 넣고
  분석을 돌리면 **클라이언트는 문항 1개만 서버로 보내는지**(분리는 전적으로 서버/AI
  책임이지 클라이언트가 미리 쪼개지 않음을 확인), (3) 서버가 `detailed` 3개짜리 응답을
  주면 UI가 입력 1개와 무관하게 **3개 전부**(qNum 1/2/3, 각각의 질문/답변 내용)를
  렌더링하는지, (4) 전체 종합 등급(문항 수와 무관한 필드)도 정상적으로 뜨는지 — 모두
  검증했다. 기존 `test_mock_interview_*.js` 스위트(11개) 전부 다시 돌려 회귀가 없음을
  확인했다.

**이 환경에서는 실제 Claude API 호출 성공 여부·분리 품질까지는 검증할 수 없다**
(`api.anthropic.com`으로의 아웃바운드가 이 샌드박스에서 막혀 있다는, 이 문서 다른 곳에도
반복되는 제약) — 모델이 실제로 하나의 긴 전사 안에서 화제 전환 지점을 얼마나 정확히
찾아내는지는 실사용해봐야 확인된다. 품질이 떨어지면("여러 질문이 뒤섞여 하나로
뭉뚱그려진다"거나 "엉뚱한 지점에서 쪼갠다") 5번 지시에 few-shot 예시를 더 구체적으로
추가하는 식으로 보강할 수 있다.

## `mock-interview.html` — 문항이 끝날 때마다 그 문항만 자동으로 실시간 미리 분석

사용자 질문: "모의 면접에서 질문 답변 내용을 실시간으로 전사하면서 그 분석내용도 실시간으로
작성해 나가는건 기술적으로 힘들어?" — 말하는 "도중에" 글자 단위로 계속 재분석하는 진짜
실시간은 AI 호출이 과도하게 늘어나고(비용), 아직 안 끝난 문장을 분석하다 보니 결과가 계속
뒤집히는(깜빡이는) 문제가 있어 권하지 않는다고 답했고, 대신 **"문항(녹음 구간)이 끝날
때마다 그 문항 하나만 자동으로 분석해서 바로 추가해주는"** 절충안을 제안해 "절충안으로
해줘"로 승인받아 구현했다.

- **트리거는 정확히 두 곳** — 둘 다 "이 문항의 녹음이 방금 끝났다"는 신호가 되는 지점이다:
  "다음 문항 구분(마커)" 버튼(`triggerQuestionMarker()`, 다음 문항으로 넘어가기 직전,
  방금 끝난 문항을 분석)과 "⏹ 정지" 버튼(`stopRecording()`, 지금 활성화돼 있던 문항을
  분석). 전사 칸에 직접 타이핑하는 중(`oninput`)이나 "+ 문항 추가"로 빈 문항을 새로
  만들 때는 트리거하지 않는다 — "문항이 끝났다"고 확신할 수 있는 시점이 아니기 때문이다.
- **`autoAnalyzeQuestionLive(q)`**(새 함수)가 그 문항 **하나만** `interview-report`에
  보낸다(전체 면접을 다시 보내지 않음 — 비용을 억제하는 핵심) — `teacherMemo`는 항상
  빈 문자열(실시간 미리보기는 1차 분석 단계에 해당, 선생님 의견 반영은 여전히 2단계에서만).
  문항 객체에 `q._liveAnalyzed = true`를 바로 찍어서(호출 성공/실패와 무관하게) 같은
  문항이 두 번 자동 분석되지 않게 막는다 — 전사를 나중에 손으로 고쳐도 자동으로 다시
  분석하지는 않는다(매 수정마다 호출하면 비용이 통제 불능이 되므로 — 정확한 최종 결과는
  여전히 "1단계" 버튼으로 수동 재분석하면 된다).
- **서버 응답의 `detailed[]`를 그대로 쓰지 않고 `qNum`을 클라이언트에서 다시 매긴다** —
  한 문항만 보내도 AI가 (바로 위 "자동 분리" 기능 덕분에) 그 안에서 여러 질문을 또 찾아낼
  수 있으므로, 응답마다 `qNum`이 다시 1부터 시작한다. 매번 누적 중인 `liveDetailed`
  배열 길이를 기준으로 전체 면접에서의 순번으로 다시 번호를 매기고, 그 항목이 어느 문항
  객체에서 나왔는지는 `_sourceQ`(id가 아니라 **객체 참조**)로 기록해둔다 — `deleteQuestion()`
  이 남은 문항들의 id를 1..N으로 다시 매기기 때문에(renumbering), 숫자 id로 추적하면
  삭제 후 엉뚱한 항목이 지워질 수 있어 객체 참조로 묶었다.
- **`detailedItemCardHtml(item)`**(새 함수) — 문항 하나의 피드백 카드 템플릿을
  `renderReportUI()`(정식 1/2단계 결과)와 `renderLiveDetailed()`(실시간 미리보기) 둘 다
  공유하도록 뽑아냈다 — 두 군데서 같은 마크업을 따로 유지하다 서서히 어긋나는 걸 막기
  위함. `renderLiveDetailed()`는 카드들 위에 "⏳ 실시간 미리보기예요 — ... 1단계를 누르면
  전체를 종합한 정식 분석으로 교체돼요"라는 안내 문구를 항상 덧붙여, 아직 전체를 함께
  보고 종합한 결과가 아니라는 걸 분명히 한다 — 특히 scoreLogic/scoreMajor/... 같은 전체
  점수는 의미가 없으므로(그 한 문항만 보고 매긴 점수라 왜곡될 수 있음) 실시간 미리보기는
  `detailed[]`만 쓰고 점수/강점·보완점 카드(`#score1Val` 등, `#repStrengths`/
  `#repWeaknesses`)는 전혀 건드리지 않는다 — 그 자리는 "1단계"가 실행되기 전까지 항상
  기존 placeholder("아직 분석 데이터가 없습니다...")로 남아있다.
- **`liveDisabled`**(모듈 변수, 기본 `false`) — `generateAnalysis()`("1단계: AI 답변
  분석하기") 맨 첫 줄에서 `true`로 바뀌고, 그 뒤로는 영구히 켜진 상태로 남는다("전체
  초기화"를 누르기 전까지). 이 플래그 하나로 두 가지를 동시에 막는다: (1)
  `autoAnalyzeQuestionLive()`가 더 이상 새 호출을 시작하지 않고, (2) 혹시 그 전에 이미
  날아간 호출이 뒤늦게 응답으로 돌아와도 `renderLiveDetailed()`가 `#detailedQAnalysis`를
  건드리지 않는다 — 그 영역은 이제 정식 분석(`renderReportUI`)이 유일한 주인이므로, 뒤늦은
  미리보기 응답이 정식 결과를 덮어쓰는 레이스를 막기 위함.
- **"전체 초기화"(`resetAll()`)**가 `liveDetailed = []`/`liveDisabled = false`로 되돌리고
  표시기(`#liveAnalyzeIndicator`)도 숨겨서, 다음 세션에서는 다시 실시간 미리보기가 동작한다
  (문항 객체 자체도 `defaultQuestions()`로 완전히 새로 만들어지므로 `_liveAnalyzed` 플래그도
  자연히 초기화된다).
- **UI 표시기**: "문항별 상세 피드백" 제목 옆에 `#liveAnalyzeIndicator`(작은 "⏳ 방금 끝난
  문항 실시간 분석 중…" 텍스트, 기본 숨김)가 호출이 진행 중일 때만 보였다 사라진다.
- `test_mock_interview_live_preview.js`(새 테스트, 실제 음성 인식 API 대신
  `test_mock_interview_mic_dedupe.js`가 이미 쓰던 `FakeRecognition` 스텁을 재사용해
  시작/마커/정지 버튼이 정상 동작하게 함)로 (1) 마커를 누르면 방금 끝난 문항 1개만 정확히
  서버로 보내고(`teacherMemo: ''` 포함) 그 결과가 "실시간 미리보기" 안내와 함께 바로
  렌더링되는지, (2) 정지 버튼으로 다음 문항을 끝내면 기존 카드를 지우지 않고 이어붙이며
  qNum이 1,2로 이어지는지, (3) 이미 분석된 문항은(내용 변경 없이 다시 시작/정지해도)
  중복 호출되지 않는지, (4) "1단계" 버튼을 누르면 미리보기 안내/카드가 전부 정식 분석
  결과로 완전히 교체되는지, (5) 정식 분석 이후에는 완전히 새로운 문항을 끝내도 더 이상
  미리보기 호출이 전혀 안 나가는지(단순 중복 방지가 아니라 `liveDisabled` 자체가 기능을
  영구히 끈다는 것까지 확인), (6) "전체 초기화" 후 placeholder와 표시기 숨김 상태로
  돌아오는지 — 모두 검증했다. `renderReportUI()`의 템플릿을 `detailedItemCardHtml()`로
  뽑아내는 리팩터링이 기존 동작을 깨지 않았는지도 기존 `test_mock_interview_*.js`
  스위트(12개) 전부 다시 돌려 확인했다.

**이 환경에서는 역시 실제 Claude API 호출의 성공 여부·체감 지연(문항 하나 분석에 몇 초나
걸리는지)까지는 검증할 수 없다** — `api.anthropic.com` 아웃바운드가 막혀 있다는 이 문서의
반복되는 제약. 문항 하나당 호출 자체는 `interview-report`가 이미 1개짜리 `questions`
배열도 정상 처리하도록 설계돼 있어(바로 위 "자동 분리" 기능 추가 때 이미 검증된 경로) 별도
서버 변경 없이 재사용했다 — Edge Function 재배포는 이번에 하지 않았다(버전 7 그대로).

## `mock-interview.html` — 데스크탑(1024px+)에서 2단 레이아웃: 왼쪽 작업 영역 / 오른쪽 sticky 보고서

사용자 요청: "데스크탑 버전에서는 2단 구성으로 기본정보와 녹음버튼, 문항 전사 등은
왼쪽에, 분석 결과는 오른쪽에 배치하면 어떨까." Artifact 목업으로 데스크탑/모바일 두
레이아웃을 먼저 보여주고 확인받은 뒤("근데 확인은 해야하니까 그럼 이미지로 보여줄래?" —
실제 적용 전 스크린샷으로 재확인), "일단 2단 레이아웃 적용해서 병합해봐" 요청으로
실제 파일에 반영했다.

기존 `<main>`은 폭이 `max-w-2xl`(640px 안팎)로 고정된 단일 칼럼이라, 모든 카드(지원자
정보/녹음 패널/문항 관리/1·2단계 버튼/선생님 메모/보고서)가 위에서 아래로 쭉 나열돼 있었다
— 보고서까지 보려면 화면을 한참 내려야 했고, 문항을 입력하며 동시에 분석 결과를 참고하는
것도 불가능했다.

- **`<main>` 자체를 데스크탑(`lg:` = 1024px 이상)에서만 2열 그리드로 바꿨다**
  (`lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start`, `max-w-2xl`을
  `lg:max-w-6xl`로 넓힘). 모바일/태블릿(1024px 미만)은 기존처럼 평범한 세로 흐름 —
  별도의 모바일 전용 분기 코드가 필요 없다(Tailwind의 `lg:` 접두사가 데스크탑에서만
  그리드 유틸리티를 켜고, 그 미만에서는 아무 효과가 없어 원래의 block 흐름 그대로
  유지된다).
- **왼쪽 칼럼(`#interviewLeftCol`)**: 지원자 정보 카드부터 "2단계: 최종 보고서로
  확정하기" 버튼까지, 원래 순서 그대로를 `space-y-5` div 하나로 감쌌다 — 이 안의 어떤
  엘리먼트 id/로직도 손대지 않았다(순수 래핑).
- **오른쪽 칼럼(`#interviewRightCol`)**: 기존 `#reportFrame`(인쇄 버튼이 달린 제목
  바 + `#reportContainer`)을 그대로 감쌌고, **데스크탑에서만 `lg:sticky lg:top-4`**를
  줬다 — 왼쪽에서 문항을 계속 채우며 스크롤해도 오른쪽 보고서가 화면에 계속 보인다.
  모바일에서는 `position:static`(일반 흐름)으로 왼쪽 칼럼 아래에 그대로 이어진다
  (`mt-5 lg:mt-0`으로, 원래 `space-y-5`가 주던 위쪽 간격을 모바일에서만 대체).
- **인쇄 시엔 그리드/스티키를 전부 무효화**해 보고서가 50% 폭 그리드 트랙에 갇히지
  않도록 했다 — 기존 `@media print` 블록에 `main{display:block}`,
  `#interviewLeftCol, #interviewRightCol{display:block; position:static}`을
  추가했다(왼쪽 칼럼 안의 모든 컨트롤은 이미 `no-print`로 숨겨지므로, 실제로 인쇄되는
  건 오른쪽 보고서뿐 — 그게 전체 폭을 쓰도록 하는 안전장치).
- **이 샌드박스는 `cdn.tailwindcss.com` 아웃바운드가 막혀 있어, 기존의 모든
  mock-interview.html 테스트는 실제 Tailwind CSS가 전혀 적용되지 않은 채로(기능/JS
  상태만) 통과해왔다** — 이번처럼 실제 그리드 레이아웃(나란히 배치되는지, sticky가
  적용되는지) 자체를 검증하려면 진짜 컴파일된 CSS가 필요했다. `npx tailwindcss
  --content mock-interview.html`로 이 페이지가 실제 쓰는 클래스만 스캔해 로컬에서
  CSS를 컴파일하고, 그 결과를 `<style>` 태그로 주입하는 작은 JS로 감싼 뒤
  `page.route('https://cdn.tailwindcss.com', ...)`로 막혀 있는 CDN 스크립트
  요청을 그 로컬 스탠드인으로 대체하는 방식(`test_mock_interview_2col_layout.js`)으로
  해결했다 — 실제 CDN이 서빙했을 결과와 기능적으로 동일한 CSS이므로, 이 환경의 네트워크
  제약과 무관하게 진짜 레이아웃을 검증할 수 있다. `test_mock_interview_2col_layout.js`로
  (1) 1280px(데스크탑)에서 두 칼럼이 같은 Y좌표에서 시작하고(나란히 배치) 오른쪽
  칼럼이 왼쪽 오른쪽 끝 이후에 위치하는지, 오른쪽 칼럼의 `position`이 실제로 `sticky`인지,
  (2) 390px(모바일)에서 오른쪽 칼럼이 왼쪽 칼럼 아래로 내려가고 `position`이 `static`인지,
  (3) 리팩터링이 순수 레이아웃 래핑일 뿐 기존 기능(학생 이름 입력, 분석 호출, 보고서
  렌더링)이 전부 그대로 동작하는지, (4) 인쇄 미디어에서 `main`/두 칼럼 모두
  `display:block`으로 되돌아가는지 — 네 가지 모두 확인했다. 기존 13개 테스트도 모두
  재실행해 회귀가 없음을 확인했다(이 테스트들은 CSS가 아니라 JS/DOM 상태만 검증하므로
  이번 레이아웃 변경과 무관하게 계속 통과한다).

## `mock-interview.html` — 분석 결과 저장/불러오기/목록 관리 (`interview_reports` 테이블, 이 페이지 최초의 Supabase 저장)

지금까지 `mock-interview.html`은 완전한 클라이언트 전용 도구였다 — Supabase는 AI 분석
한 번(`interview-report` Edge Function 호출)에만 쓰였을 뿐, 어떤 데이터도 저장되지
않았고 새로고침하면 전부 사라졌다. 사용자가 명시적으로 세 가지를 요청했다: "페이지 맨
위쪽 상단에 분석결과 불러오기 버튼을 만들어서 면접한 학생과 학번 지원학과 날짜를
드롭다운으로 보여주고 불러오게도 가능? 목록 관리 팝업도 만들어서 한번에 목록에서 보고
필요한거 불러오거나 삭제할 수 있어도 좋고 그럼 학생 모이면접을 진행하고 분석 결과를
만들었을 때 저장하는 버튼도 있어야겠지" — 저장(💾)/드롭다운 불러오기(📂)/목록 관리
팝업(📋) 세 기능이 함께 들어왔다.

**학번(`#studentNo`) 필드가 새로 생겼다.** "학생과 학번 지원학과 날짜를 드롭다운으로"
라는 요청 자체가 지금까지 이 페이지에 전혀 없던 필드를 새로 요구했다 — "지원자 및 면접
정보" 카드의 첫 줄을 이름/지원학과 2칸에서 이름/학번(선택)/지원학과 3칸으로 넓혔다.
저장할 때 그대로 실려 가고, 보고서 메타(`#repStudentNo`)에도 "성명: 김민수 (10203)"
식으로 성명 옆에 괄호로 붙어 나온다(값이 없으면 괄호 자체가 안 보임 — `updateReportMeta
Display(name, major, date, no)`가 세 기존 필드와 이 필드를 한 함수로 같이 갱신하도록
리팩터링됐다 — `generateAnalysis()`(새 분석)와 `applyLoadedReport()`(불러오기) 둘 다
이 함수를 거치므로 두 경로가 항상 같은 모양으로 렌더링된다).

**`interview_reports` 테이블 — 이 페이지가 처음으로 갖게 된 백엔드 저장소.** RLS는
`room-booking.html`의 익명 예약과 같은 신뢰 수준으로 `anon`/`authenticated` 둘 다에
select/insert/update/delete를 전부 열어뒀다 — 이 페이지는 로그인 자체가 없고
(`admin-tools.html`/`korean-inquiry.html`처럼 교무 업무 도구 허브를 거쳐서만 닿는
교사 내부 도구), 비밀번호 같은 소유권 증명 개념을 요구할 명분도 없어서(요청에도 없었고,
이 페이지엔 애초에 "사용자"라는 개념이 전혀 없다) 그냥 완전히 열어둔 테이블로
만들었다 — `room_bookings`의 익명 insert가 `password_hash` 보호를 받는 것과 달리,
이 테이블은 그 보호조차 없는 더 단순한 모델이다. 컬럼: `student_name`/`student_no`/
`target_major`/`interview_date`/`supervising_teacher`/`teacher_memo`(전부 nullable
text — 기존 필드들이 전부 빈 채로도 저장을 허용하던 것과 같은 느슨함), `questions`
(jsonb, `{id,title,questionText,transcript,startTime,endTime}` 배열 — `_liveAnalyzed`
같은 내부 플래그는 저장 시 걷어내고 저장), `report`(jsonb, `renderReportUI(data)`가
마지막으로 그린 원본 AI 결과 객체 그대로 — `scoreLogic`/`strengths`/`detailed` 등
모든 필드를 그대로 들고 있어 불러올 때 같은 함수에 그대로 다시 넘기면 똑같이
재현된다), `is_finalized`(boolean), `created_at`/`updated_at`.

**`sb`(Supabase client) 생성은 `try/catch`로 감싸져 있다.** `supabase-js`는 CDN
`<script>` 태그로 로드되므로, 그 요청이 느리거나 막히거나 CDN이 잠깐 다운되면
`window.supabase`가 이 인라인 스크립트가 실행되는 시점에 아직 `undefined`일 수 있다 —
감싸지 않으면 `.createClient()` 호출이 그대로 던져서 이 페이지의 **전체** 인라인
`<script>` 블록이 거기서 멈춰버린다(그 아래 `DOMContentLoaded`/`renderTabs()` 등
저장 기능과 전혀 무관한 녹음·분석 기능까지 전부 도미노로 죽는다 — 실제로 이 테스트
작성 중 "문항 탭이 아예 안 뜬다"는 완전히 무관해 보이는 증상으로 처음 발견했다).
`sb`가 `null`로 남는 경우를 대비해 `saveReport()`/`fetchSavedReports()`/
`deleteReport()`/`loadReportById()` 전부 맨 앞에서 `sb` 존재를 확인하고, 없으면
"네트워크 연결을 확인한 뒤 새로고침해주세요" 안내로 조용히 실패한다 — 저장/불러오기만
못 쓰게 될 뿐, 녹음·AI 분석·인쇄 등 이 페이지의 나머지 기능은 전혀 영향받지 않는다.

**`lastReportData`(모듈 변수) — `renderReportUI(data)` 맨 첫 줄에서 항상 캡처된다.**
이 페이지는 AI 결과를 화면에 그리자마자 버리는 구조였어서(`generateAnalysis()`/
`finalizeReport()`/`runLocalSimulation()`/`applyLoadedReport()`/실시간 미리보기 모두
결국 `renderReportUI()` 하나를 거쳐 DOM에 페인트할 뿐, 그 원본 객체를 들고 있는 변수가
없었다), 저장 기능을 만들려면 그 원본을 어딘가에 붙잡아둬야 했다 — `renderReportUI()`
자체에 `lastReportData = data;` 한 줄을 추가해, 이 함수를 거치는 모든 경로가 자동으로
"저장 가능한 최신 보고서"를 갖추게 했다(별도로 호출부마다 캡처 코드를 추가할 필요가
없었다).

**`currentReportId`(모듈 변수) — "이 세션이 이미 저장된 행과 연결돼 있는지"를 추적한다.**
`null`이면 아직 이번 세션에서 저장한 적이 없다는 뜻이고, 💾 저장을 누르면:
- `currentReportId`가 없으면 `insert` 후 돌아온 id를 저장해 연결을 새로 맺는다.
- 있으면 그 id로 `update` — 같은 세션에서 몇 번을 다시 눌러도(예: 선생님 의견을
  입력하고 2단계를 다시 확정한 뒤 또 저장) 행이 계속 쌓이지 않고 하나로 갱신된다.

이 연결은 세 지점에서 끊긴다(= `currentReportId = null`로 되돌림): "🔄 전체 초기화"
(완전히 새 세션), "⚡ 샘플 채우기"(아직 분석 전인 별개의 데모 데이터이므로 혹시
이전에 불러온/저장된 행이 있었다면 그 연결을 끊어, 샘플을 저장하려 할 때 실수로 옛
진짜 기록을 덮어쓰지 않게 함), 그리고 "📋 목록 관리"에서 지금 연결된 바로 그 행을
삭제한 경우(삭제된 행을 계속 가리키고 있으면 다음 저장이 존재하지 않는 행을 `update`
하려는 허공 쓰기가 되므로, 삭제 시 `currentReportId === id`면 바로 끊는다 — 다음
저장은 새 `insert`로 떨어진다).

**📂 불러오기 — 헤더의 작은 드롭다운 패널.** 헤더 우측 아이콘 버튼 묶음(샘플 채우기/
전체 초기화가 이미 있던 자리)에 💾/📂/📋 세 개를 더해 5개를 `grid grid-cols-3`로
2줄에 나눠 배치했다(5개를 세로로 쭉 쌓던 기존 `flex-col`은 너무 길어져서). 📂를
누르면 `#loadPanel`(헤더 버튼 묶음을 감싸는 `relative` 컨테이너 기준
`absolute right-0 top-full`)이 열리고, `fetchSavedReports()`(한 쿼리로 목록용
가벼운 컬럼만 — `student_name`/`student_no`/`target_major`/`interview_date`/
`is_finalized`/`updated_at`, `report`/`questions`/`teacher_memo` 같은 무거운 jsonb는
목록에선 안 읽음, `updated_at` 내림차순)가 돌려주는 행들로 `<select>`를 채운다 —
`reportRowLabel(row)`가 "이름 (학번) · 전공 · 날짜 · 최종" 형식의 한 줄 레이블을
만들고(어느 필드가 비어있든 그 부분만 조용히 빠짐), 📋 목록 관리 쪽에서도 같은 함수를
재사용한다. "불러오기"를 누르면 선택된 id로 `loadReportById()` → `applyLoadedReport()`
를 호출한다.

**📋 목록 관리 — `#manageModalOverlay` 모달.** `<main>` 바깥(body 최하단, 다른
고정 오버레이들과 같은 자리)에 둔 `fixed inset-0 bg-black/40` 오버레이 + 가운데
카드. 각 행에 이름(학번)/전공·날짜·최종표시 + "불러오기"/"삭제" 두 버튼. "삭제"는
`confirm()` 확인 후 바로 `delete` 요청을 보내고 같은 목록을 다시 그린다(목록 자체가
새로고침되므로 별도 "방금 지운 행 숨기기" 로직이 필요 없음). 바깥(오버레이 자신)을
클릭하면 닫힌다(`onclick="if(event.target===this) closeManageModal()"` — 이 저장소의
다른 모달들과 같은 패턴).

**`applyLoadedReport(row)` — 불러오기의 핵심.** 학생 정보 입력칸 5개 + 문항 배열
(`questions`, 각 필드를 기본값으로 방어적으로 채워 복원) + `currentTabId`/
`currentTextBuffer`를 전부 되돌리고, `liveDisabled = true`로 실시간 미리보기 기능을
영구히 꺼둔다(이미 끝난 분석을 불러온 세션이므로, 그 뒤 녹음을 더 하더라도 미리보기가
끼어들어 이미 로드된 정식 보고서를 건드리면 안 된다 — "1단계" 버튼을 누른 뒤와 똑같은
상태로 취급). `row.report`가 있으면 `renderReportUI(row.report)`를 그대로 호출해
보고서를 재현하고(이 한 호출이 `lastReportData`도 함께 갱신해줌), 없으면(이론상 거의
없는 경우 — 저장은 `hasDraftAnalysis`가 참일 때만 허용되고 그 시점엔 이미
`lastReportData`가 채워져 있어야 하지만, 혹시라도 비어있던 채로 저장된 행을 위한
안전망) 점수/강점/보완점/상세 피드백을 전부 placeholder로 되돌린다. 마지막에
`hasDraftAnalysis = true`, `isFinalized = !!row.is_finalized`, 저장 버튼 재활성화,
`currentReportId = row.id`로 연결을 맺는다.

**"저장" 버튼은 1단계 분석이 끝나기 전까지 비활성 상태다.** `setSaveButtonEnabled
(enabled)`가 `disabled`+`opacity-40`/`cursor-not-allowed`를 토글한다 — `generateAnalysis()`
가 1단계를 마친 직후, `applyLoadedReport()`가 불러오기를 마친 직후에 활성화되고,
`resetAll()`/`loadSampleData()`에서 다시 비활성화된다("분석 결과를 만들었을 때 저장
버튼이 있어야겠지"라는 요청 그대로 — 아직 아무 분석도 없는 빈 세션에서는 저장할 게
없으므로 버튼 자체가 눌리지 않는다).

**테스트는 이 샌드박스의 두 번째 CDN 차단을 새로 넘어야 했다.** `cdn.tailwindcss.com`
(이미 `test_mock_interview_2col_layout.js`에서 겪은 것)뿐 아니라, 이번에 새로 추가한
`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js`도
같은 터널 차단에 걸려 `window.supabase`가 `undefined`로 남고, 그 상태에서
`window.supabase.createClient(...)`를 호출하는 순간 전체 인라인 `<script>` 블록이
`TypeError`로 멈춰버린다(DOMContentLoaded 리스너를 포함해 그 뒤 모든 코드가 전혀
실행되지 않음 — "문항 탭이 안 뜬다"처럼 완전히 무관해 보이는 증상으로 나타났다).
`korean-inquiry.html` 테스트들이 이미 로컬에 받아둔 `@supabase/supabase-js`의 UMD
번들(`scratchpad/testlibs/node_modules/@supabase/supabase-js/dist/umd/supabase.js`)을
`page.route()`로 그 CDN URL 대신 서빙해 해결했다 — 앞으로 Supabase를 쓰는 페이지를
이 샌드박스에서 Playwright로 테스트할 때는 이 로컬 번들을 재사용할 것(매번 새로
`npm install`할 필요 없음). `test_mock_interview_save_load.js`로 (1) 저장 버튼이
분석 전엔 비활성, 1단계 직후 활성화되는지, (2) 보고서 메타에 학번이 "(10203)" 형식으로
붙는지, (3) 첫 저장은 insert(학생정보/학번/문항/원본 report 객체/is_finalized가
정확히 실림), (4) 같은 세션에서 다시 저장하면 update(행 1개 유지, 중복 insert 없음),
(5) 📂 드롭다운이 이름/학번/전공을 담은 레이블로 그 행을 보여주고 토글로 열고 닫히는지,
(6) 전체 초기화 후 학번 칸이 비워지고 저장 버튼이 다시 비활성화되는지, (7) 📂로 불러오면
입력칸/전사/보고서(종합 등급 포함)가 저장된 그대로 복원되고 저장 버튼이 재활성화되며
이후 저장은 그 행을 update하는지, (8) 📋 목록 관리에 그 행이 보이고 "삭제"를 누르면
실제로 지워지고 목록이 빈 상태로 바뀌며, 오버레이 자신을 클릭하면 닫히는지, (9) 현재
연결된 행이 목록 관리에서 삭제된 뒤 저장을 누르면 허공에 update하는 대신 새 insert가
나가는지, (10) 샘플 채우기가 이전 연결을 끊어 저장 버튼을 다시 비활성화하면서도 학번
칸은 채워주는지 — 모두 확인했다. 기존 `test_mock_interview_*.js`(2단 레이아웃 포함)도
전부 재실행해 회귀가 없음을 확인했다.

## `mock-interview.html` — Safari에서 마이크 권한 창이 계속 뜨는 버그 (onend 자동 재시작 루프 가드)

실사용 중 다른 선생님이 보고: "마이크 사용 권한을 묻는 창이 계속 나와." 바로 전에
사용자가 "모의면접 마이크는 사파리에서는 사용할 수 없어?"라고 물어서 Safari도
`webkitSpeechRecognition`을 지원한다고 답했던 직후 들어온 보고라, Safari 특유의
연속 인식(continuous) 동작 차이가 원인일 가능성이 높다고 보고 코드를 다시 읽었다.

**원인(가설, 이 환경에선 실제 Safari로 재현·확인 불가)**: `recognition.onend`에
이미 있던 자동 재시작 로직(브라우저가 `continuous:true`인데도 인식 세션을 스스로
끝내버리면, 300ms 뒤 `recognition.start()`를 다시 호출해 이어 붙이는 것 —
Chrome의 "가끔 혼자 끝내버림" 동작에 대응하려고 만들어둔 것)이 핵심 용의자다.
Safari는 Chrome보다 훨씬 자주, 적극적으로 연속 인식 세션을 스스로 끝내고, WebKit은
마이크를 쓰는 API를 "사용자 동작(user gesture)" 맥락에 강하게 묶는다 —
`setTimeout` 콜백 안에서 호출하는 `recognition.start()`는 진짜 클릭이 아니므로
사용자 동작으로 인정되지 않을 수 있고, 이 경우 Safari가 그 자동 재시작마다 네이티브
권한 창을 다시 띄울 수 있다. 선생님이 그 창을 못 보거나 결정을 안 내리면 세션이 거의
바로 다시 끝나면서 `onend`가 또 발생 → 또 재시작 → 또 권한 창... 이렇게 끝없이
반복되는 루프가 "창이 계속 나와"라는 증상과 정확히 일치한다.

**고쳐서**: 근본 원인이 정확히 Safari의 어떤 동작 때문인지 이 환경에서 직접 검증할
방법이 없으므로(실제 Safari 브라우저도, `webkitSpeechRecognition`이 뜨는 네이티브
권한 UI도 이 샌드박스에서는 재현 불가), 원인이 무엇이든 "같은 창이 끝없이 반복해서
뜨는" 증상 자체를 구조적으로 막는 방어적 가드를 추가했다 — `recentAutoRestartCount`/
`lastAutoRestartAt` 두 모듈 변수가 `onend`에서 자동 재시작이 일어날 때마다 직전
재시작과의 간격을 잰다: 6초 이내에 연속으로 일어나면 카운트를 올리고, 그보다
오래 걸렸으면(정상적인 긴 침묵/일시정지로 세션이 끝난 평범한 경우) 1로 리셋한다.
**이 카운트가 3을 넘으면**(6초 안에 4번째 재시작이 필요해진 순간) 더 이상 재시도하지
않고 `stopRecording()`을 직접 호출해 녹음을 완전히 멈추고, "마이크가 반복적으로
끊겨서 녹음을 멈췄어요. 권한 창이 계속 뜬다면 '허용'을 선택한 뒤 '면접 녹음 시작'을
다시 눌러주세요."라는 안내를 보여준다 — 그 뒤 선생님이 다시 누르는 "면접 녹음 시작"
클릭은 진짜 사용자 동작이므로, Safari에서도 권한이 다시 정상적으로 동작할 가능성이
높다. `recognition.onresult`가 실제 전사 텍스트를 받으면(=그 세션이 정상적으로
동작하고 있다는 증거) `recentAutoRestartCount`를 즉시 0으로 리셋한다 — 초반에 살짝
불안정했던 세션이 이후 멀쩡하게 동작하면 그 불안정했던 기록이 나중의 정상적인
긴 면접 진행에 불리하게 작용하지 않는다. `startRecording()`(선생님이 직접 "면접
녹음 시작"을 눌렀을 때)도 두 변수를 0으로 리셋해, 매번 새로 시작하는 세션은 항상
깨끗한 상태에서 출발한다.

**이 수정도 실제 Safari에서 효과가 있는지는 직접 검증하지 못했다** — 이 환경에는
Safari/WebKit도, 실제 마이크 권한 네이티브 UI도 없다. 다만 가드 자체는 브라우저나
원인과 무관하게 "짧은 시간 안에 반복적으로 재시작을 시도하는 상태"를 멈추고 사람에게
분명한 안내+수동 재시작 경로를 주는 범용적인 방어 장치라, Safari의 정확한 내부 동작을
몰라도 증상 자체는 해결될 것으로 판단했다. `test_mock_interview_restart_loop_guard.js`
(`FakeRecognition` 스텁으로 `onend()`를 수동으로 여러 번 발생시켜 재현)로 (1) 6초
이내에 4번째 재시작이 필요해지면 그 전까지 정확히 3번만 재시작하고 그 이후엔 멈춰서
"반복적으로 끊겨서"/"권한 창" 문구를 보여주는지, 멈춘 뒤엔 추가 재시작이 전혀
안 일어나는지, (2) 6초 이상 간격을 둔 재시작은(평범한 긴 침묵) 아무리 반복돼도
가드가 절대 작동하지 않는지, (3) 진짜 전사 텍스트가 들어오면 카운트가 리셋돼,
이후 다시 2번 연속 재시작해도(바로 전에 이미 2번 썼더라도) 가드가 작동하지 않는지
— 모두 확인했다. 기존 `test_mock_interview_*.js` 전체(2단 레이아웃/저장·불러오기
포함)를 다시 돌려 회귀가 없음을 확인했다 — `test_mock_interview_two_stage.js` 하나만
여전히 실패하는데, HEAD(이 수정 전 커밋)에서도 동일하게 실패함을 직접 대조 확인했다
— `test_mock_interview_edgecases.js`/`test_mock_interview_smoke.js`와 같은 기존
문서화된 한계(아이콘 전용 "샘플 채우기" 버튼이 `title` 속성에만 라벨을 갖고 있어
`button:has-text(...)` 셀렉터가 못 찾음)이지, 이번 수정이 만든 회귀가 아니다.

## `mock-interview.html` — 페이지 맨 위에 "불러오기 메뉴", 맨 아래에 "저장" 버튼 추가 + 분석 중 "AI 생성 중" 밝기 펄스 효과

사용자가 와이어프레임 스크린샷을 보여주며 "이렇게 배치하면 어떨까 싶고, 맨 아래
쪽에는 저장 버튼 추가, 맨 위쪽에는 불러오기 메뉴 추가"라고 요청했다. 이미지의
2단 레이아웃(왼쪽 기본정보·녹음·문항 전사, 오른쪽 보고서+1단계/2단계 버튼)은 바로
위 두 섹션에서 이미 구현한 구조와 거의 그대로 일치했으므로 손대지 않았고, 실제로
빠져 있던 건 저장/불러오기를 **헤더의 작은 아이콘 뒤에 숨기지 않고 페이지 맨
위/맨 아래에 눈에 잘 보이는 자리로도** 두는 것이었다.

**기존 💾/📂/📋 헤더 아이콘은 그대로 남겨뒀다** — 요청이 "추가"였을 뿐 "교체"가
아니었고, 이미 그 세 아이콘이 `saveReport()`/`fetchSavedReports()`/
`loadReportById()`/`openManageModal()` 전체 로직을 쥐고 있어서, 새 UI는 같은 함수를
재사용하는 **두 번째 입구**로만 추가했다:

- **맨 위 "불러오기 메뉴"**: `<header>`와 `<main>` 사이에 전체 폭 바(`#topLoadSelect`
  `<select>` + "불러오기"/"목록 관리" 버튼)를 새로 넣었다 — 헤더의 📂 아이콘처럼
  클릭해서 패널을 펼쳐야 하는 게 아니라, 페이지에 들어오는 순간부터 드롭다운+버튼이
  그대로 보인다. `refreshTopLoadSelect()`(새 함수, `openLoadPanel()`의 populate
  로직과 거의 같은 모양)가 `DOMContentLoaded`에서 한 번, 저장 성공 후
  (`saveReport()`)와 삭제 성공 후(`deleteReport()`) 다시 호출돼 항상 최신 목록을
  보여준다. "불러오기" 버튼(`confirmLoadFromTop()`)은 아무것도 안 고르면
  `alert()`로 선택을 요구하고, 고르면 기존 `loadReportById()`를 그대로 호출한다 —
  새로운 저장/조회 로직은 전혀 만들지 않았다. `applyLoadedReport()` 끝에서 이
  드롭다운의 선택값도 방금 불러온 행의 id로 맞춰준다(그 옵션이 아직 목록에 없으면
  조용히 건너뜀).
- **맨 아래 "저장" 버튼**: `</main>` 바로 다음, 양쪽 칼럼이 다 끝난 자리에 전체
  폭의 큰 버튼(`#btnSaveReportBottom`)을 추가했다 — 클릭하면 헤더 아이콘과 똑같이
  `saveReport()`를 호출한다. `setSaveButtonEnabled(enabled)`가 이제 헤더 아이콘과
  이 버튼 **둘 다** 같은 활성/비활성 상태로 묶어서 토글하므로, 1단계 분석 전에는
  둘 다 비활성, 분석이 끝나면 둘 다 눌릴 수 있게 된다. `saveReport()`도 저장
  진행/성공/실패 피드백을 `#saveBtnBottomText`에도 같이 반영한다(헤더 아이콘은
  체크마크로 1.5초간 바뀌는 기존 방식 그대로, 바텀 버튼은 "저장 중…"/"✓
  저장했어요" 텍스트로).

**추가로, 대화 중 사용자가 같은 메시지 안에 다른 요청을 끼워 넣었다**: "분석 중일
때 분석 결과가 나오는 부분에 ai 이미지 생성할 때 보면 약간 밝기가 변하면서 생성
중임을 보여주는 모양 있잖아. 그런 효과를 넣으면 어떨까 그럼 분석중이구나 하고
기다릴거 같은데" — 이미지 생성 AI가 흔히 보여주는 "밝기가 오르내리며 생성 중임을
알려주는" 느낌을, 결과가 그려지는 영역 자체에 입혀달라는 요청.

- `<style>`에 `@keyframes aiGenPulse`(opacity 1↔0.55, `filter: brightness(1↔1.3)`를
  1.3초 주기로 반복)와 `.ai-generating` 클래스를 추가했다 — 인쇄 시에는
  `@media print`에서 애니메이션/필터를 전부 무효화해 인쇄물에 깜빡이던 상태가
  얼어붙은 채로 찍히는 일이 없게 했다.
- "핵심 평가 영역별 분석"(`#scoreAnalysisBlock`), "주요 강점/보완할 점"
  (`#strengthsWeaknessesBlock`), "문항별 상세 피드백"(`#detailedSectionBlock`) 세
  블록에 각각 id를 새로 달고, `setReportGenerating(active, ids)`(새 함수, `ids`
  생략 시 세 블록 전부) 하나로 `.ai-generating` 클래스를 켜고 끈다.
- **정식 1·2단계 분석**(`generateAnalysis()`/`finalizeReport()`의 실제 AI 호출
  분기)은 `callInterviewReportApi()`를 `await`하는 동안 세 블록 전부를 펄스시킨다
  — 응답이 와서 `renderReportUI()`가 그리든, 실패해서 `runLocalSimulation()`으로
  대체되든 `finally`에서 항상 꺼진다. 2단계의 "의견 없이 바로 확정" 분기(네트워크
  호출 자체가 없는 경로)는 펄스를 켜지 않는다 — 기다릴 게 없는 즉시 처리이기
  때문이다.
- **문항이 끝날 때마다의 실시간 미리보기**(`autoAnalyzeQuestionLive()`)는
  "문항별 상세 피드백" 블록 하나만 펄스시킨다(`setReportGenerating(true,
  ['detailedSectionBlock'])`) — 이 미리보기는 점수/강점·보완점을 전혀 건드리지
  않으므로 그 두 블록까지 깜빡일 이유가 없다.
- `resetReportUI()`(전체 초기화 경로)에도 `setReportGenerating(false)`를 넣어,
  혹시 분석이 진행 중인 상태에서 "전체 초기화"를 눌러도 펄스가 영구히 켜진 채로
  남지 않게 하는 안전망을 뒀다.

**검증**: 이 환경은 `cdn.tailwindcss.com`/`cdn.jsdelivr.net`(실제 Claude API
호출을 거치는 `*.supabase.co`도 포함) 아웃바운드가 막혀 있다는 이 문서의 반복되는
제약이 이번에도 그대로 적용돼, `npx tailwindcss`로 이 페이지가 실제 쓰는 클래스
전부를 다시 스캔해 로컬에서 컴파일한 CSS를 `page.route()`로 CDN 요청 대신
주입하고, 기존에 로컬에 받아둔 `@supabase/supabase-js` UMD 번들을 재사용해
Supabase REST(`interview_reports`)와 `interview-report` Edge Function 호출을
모두 모킹하는 방식(`scratchpad/test_mock_interview_top_bottom_save_load.js`)으로
테스트했다. (1) 맨 위 불러오기 바가 `<header>`와 `<main>` 사이(DOM 순서상
`<main>`보다 앞)에 있고 로드 즉시 저장된 목록으로 채워지는지, (2) 맨 아래 저장
버튼이 `</main>` 뒤(DOM 순서상 `<main>`보다 뒤)에 있고 분석 전에는 비활성인지,
(3) 1단계 분석을 Edge Function 응답이 돌아오기 전까지 지연시켜 그 사이
세 블록 모두 `.ai-generating`이 걸려있는지, 응답이 오면 즉시 풀리는지, 헤더
아이콘과 바텀 버튼이 함께 활성화되는지, (4) 바텀 버튼으로 저장하면 헤더 아이콘과
똑같은 insert 호출이 나가고 버튼 텍스트에 저장 확인 문구가 뜨는지, (5) 맨 위
드롭다운에서 아무것도 안 고르고 "불러오기"를 누르면 선택을 요구하는 alert가
뜨는지, (6) 드롭다운에서 저장된 항목을 고르고 불러오면 학생 이름 등 필드가
실제로 채워지는지 — 모두 확인했다. 이 세션의 스크래치패드에는 이전 세션들이
작성했던 `test_mock_interview_*.js` 전체(2단 레이아웃, 저장/불러오기, 재시작 루프
가드 등)가 남아있지 않아 직접 재실행해 회귀를 확인하지는 못했다 — 다만 이번 변경은
기존 id/함수를 전부 그대로 둔 채 새 id(`topLoadSelect`/`btnSaveReportBottom`/
`scoreAnalysisBlock`/`strengthsWeaknessesBlock`/`detailedSectionBlock`)와 새
함수(`refreshTopLoadSelect`/`confirmLoadFromTop`/`setReportGenerating`)만
추가하고, 기존 함수는 호출 지점에 한두 줄을 끼워 넣는 선에서만 수정했으므로(중복
id 없음을 직접 확인) 기존 동작을 깨뜨릴 위험은 낮다고 판단했다.

## `mock-interview.html` — "최종 보고서로 확정하기" 버튼도 맨 아래로 + AI 생성 중 효과를 배경색 펄스로

사용자 요청: "최종 보고서로 확정하기 버튼도 맨 아래로. 그리고 분석중에 밝기 변하는 효과는
글씨에 말고 배경색에 주면 어떨까." 두 가지 모두 바로 앞 섹션에서 만든 기능을 다듭는
후속 조정이다.

**① "2단계: 최종 보고서로 확정하기"(`#btnFinalize`) 버튼을 왼쪽 칼럼(교사 메모 카드
바로 아래)에서 `</main>` 다음, "분석 결과 저장하기" 버튼 바로 위로 옮겼다.** id/
`onclick="finalizeReport()"`/스타일 클래스 전부 그대로 가져왔을 뿐 — 작업 흐름상
"확정 → 저장"이 자연스러운 순서라 확정 버튼을 저장 버튼 위에 두고,
`<div class="... space-y-3">` 하나로 두 버튼을 감싸 세로로 쌓았다. `btnFinalize`를
활성/비활성화하는 기존 로직(`setStageControlsEnabled()`, `generateAnalysis()` 완료 시
`disabled`를 푸는 코드)은 전부 `getElementById('btnFinalize')`로 id만 참조하므로,
위치가 바뀌어도 아무 JS 변경 없이 그대로 동작한다. 왼쪽 칼럼은 이제 지원자 정보 →
녹음 패널 → 문항 관리 → "1단계: AI 답변 분석하기" 버튼 → `#stageStatusMsg` → 교사
메모 카드로 끝나고, 확정/저장 두 버튼은 화면 가장 아래, 양쪽 칼럼이 다 끝난 자리에
나란히 모여있다.

**② AI 생성 중 펄스 효과를 opacity/filter(글씨까지 함께 흐려짐) 대신
background-color만 펄스하도록 바꿨다.** 바로 전 섹션에서 추가한 `@keyframes
aiGenPulse`는 `opacity: 1↔0.55`+`filter: brightness(1↔1.3)`로 블록 **전체**(안의
텍스트 포함)를 함께 흐리게 했는데, 사용자가 "글씨에 말고 배경색에" 효과를 달라고
정정했다 — 분석 결과 텍스트 자체는 항상 선명하게 유지하고, 그 뒤에 깔린 배경만
옅은 보라(`rgba(99,102,241,0.08)`)와 더 짙은 보라(`rgba(99,102,241,0.22)`) 사이를
오가도록 바꿨다. `.ai-generating`에 `border-radius:12px`와 `margin:-10px;
padding:10px`(서로 상쇄)를 추가해, 펄스가 꺼져 있을 때(마진/패딩 자체는 항상
적용돼 있지만 배경이 투명해 안 보일 때)와 비교해 켜졌을 때 주변 레이아웃이 밀리지
않으면서도 색칠된 영역이 내용보다 살짝 여유 있게 보이도록 했다. 인쇄 시엔
`background-color: transparent`와 `margin/padding: 0`으로 전부 되돌린다.

`test_mock_interview_bottom_finalize_bg_pulse.js`(스크래치패드 전용)로 (1)
`#btnFinalize`가 더 이상 `<main>` 안에 없고 `</main>` 뒤, `#btnSaveReportBottom`보다
앞에 오는지, `#interviewLeftCol`에도 더 이상 없는지, (2) 여전히 분석 전엔 비활성
상태로 시작하는지, (3) 1단계 진행 중 `#scoreAnalysisBlock`의 computed style이
`animation-name: aiGenPulse`이면서 `opacity:1`/`filter:none`을 유지하고
`background-color`가 투명이 아니며, 650ms 뒤 그 값이 실제로 바뀌는지(진짜로
펄스하는지, 고정된 틴트가 아님을 확인), 분석이 끝나면 `.ai-generating` 클래스가
사라지는지, (4) 1단계 완료 후 바닥의 확정 버튼이 활성화되고, 거기서 클릭하면
메모 없이 즉시 확정되는지 — 모두 확인했다. 기존
`test_mock_interview_top_bottom_save_load.js`도 다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — 녹음 패널과 "문항별 답변 및 전사 관리" 사이에 "예시 질문" 접이식 패널 + AI 생성 중 효과를 그라데이션 셔터 스윕으로

사용자가 "문항별 답변 및 전사 관리" 영역을 손으로 동그라미 친 스크린샷과 함께 "이 부분에
펼치고 접고 할 수 있는 기능으로 예시 질문을 넣을까하는데 질문 10개만 추천해줘"라고 요청했다
— 지원동기/전공적합성/인성/탐구경험을 고르게 섞은 대입 면접 일반 기출 10개를 먼저 추천하고
승인받은 뒤, "전사된 질문 답변 위에 접고 펼치게 넣어줘. '예시 질문' 하고 펼치기/접기 버튼
넣어주고 접었을때는 제목만 보이게"로 구체적인 배치를 지정받아 구현했다 — **처음엔 각 문항
패널(`renderQuestionContent(id)`) 안, 전사 텍스트 칸 바로 위에 넣었는데**, 실제로 배포된
화면을 다시 손으로 동그라미 쳐 보여주며 "예시 질문은 빨간색 네모친부분에 넣고 싶었어"라고
정정받았다 — 그 네모는 녹음 패널(짙은 남색, "면접 녹음 시작"/"다음 문항 구분") **바로
아래, "문항별 답변 및 전사 관리" 카드가 시작되기 전의 빈 공간**을 가리키고 있었다. 즉
문항마다 반복되는 패널이 아니라, 페이지에 한 번만 있는 독립 카드를 원한 것이었다.

- **`SAMPLE_QUESTIONS`**(새 상수, `escapeHtml()` 바로 아래) — 10개의 일반 대입 면접
  예시 질문을 담은 평문 배열. **최종 위치는 녹음 패널(`<!-- Recording & Marker Control
  Panel -->`)과 "문항별 답변 및 전사 관리" 카드 사이, 페이지에 단 하나만 있는 독립
  카드다** — `id="sampleQBody"`/`id="sampleQToggleIcon"`/`id="sampleQList"` 모두
  고정 id(문항별로 `q.id`를 붙이는 접미사 없음)이고, `toggleSampleQuestions()`도
  인자 없이 그 고정 id들만 토글한다. 목록 자체(`<ul id="sampleQList">`)는 비워둔
  채 마크업에 박혀 있다가, `DOMContentLoaded` 핸들러 맨 끝에서 `SAMPLE_QUESTIONS
  .map(s => `<li>${escapeHtml(s)}</li>`).join('')`로 딱 한 번 채워진다 — 문항 탭을
  전환하거나 "+ 문항 추가"를 눌러도 `renderQuestionContent()`가 다시 그리는 범위
  밖(그 함수는 `#questionContents`만 건드림)이라 전혀 영향받지 않는다. 기본 상태는
  **접힘**(`class="hidden"` — 버튼 제목만 보이고 목록은 전혀 렌더링되지 않음,
  `offsetParent === null`로 확인), 클릭하면 `hidden` 클래스가 빠지며 10개 질문이
  전부 펼쳐지고, 다시 클릭하면 다시 접힌다. `escapeHtml()`을 거치는 이유는 이
  리스트 항목들이 사용자가 타이핑하는 데이터가 아니라 고정 상수 문자열이라 실제로는
  불필요하지만, 이 페이지의 다른 모든 동적 리스트 렌더링(`keywordTagsHtml` 등)과
  같은 관행을 그대로 따른 것이다. "참고 질문" 입력칸 자체는 과거에 이미 완전히
  제거됐으므로(이 페이지는 질문+답변이 하나의 연속 전사로 함께 녹음되는 설계 — 위
  "참고 질문 입력칸 제거" 섹션 참고), 이 "예시 질문" 패널은 그 입력칸을 되살리는
  게 아니라 순수하게 교사가 면접 전 참고할 질문 아이디어를 보여주는 읽기 전용
  참고 자료다 — 클릭해서 무언가를 채워 넣는 기능은 없다.

- **AI 생성 중 효과를 "배경색이 단색으로 밝아졌다 어두워지는" 펄스에서, "비스듬한
  보랏빛 띠가 블록 전체를 좌우로 쓸고 지나가는" 그라데이션 셔터로 바꿨다.** 바로
  이전 세션에서 "분석중에 밝기 변하는 효과는 글씨에 말고 배경색에"라는 요청으로
  `@keyframes aiGenPulse`를 `background-color` 두 값 사이를 오가는 단색 토글로
  구현했었는데, 사용자가 이미지 생성 AI UI(스크린샷의 "이미지에 잘 어울리게 만드는
  중…" + 반짝이는 별 아이콘, 전체 영역이 옅게 흐려지며 빛나는 느낌)를 가리키며
  "분석중에 깜빡거리는건 이부분의 전체 색깔이 그라데이션처럼 밝기 변화가 있는 걸
  의미한거야"라고 정정해줬다 — 단색이 통째로 밝아졌다 어두워지는 것과, 그라데이션
  띠가 쓸고 지나가며 밝기가 오르내리는 것은 시각적으로 다르다는 지적이었다. **고쳐서**
  `.ai-generating`의 `background-color` 단색 펄스를 `background-image: linear-gradient
  (100deg, ...)`(옅은 보라 → 짙은 보라(0.42 알파) → 옅은 보라, 폭 260%)로 바꾸고,
  `@keyframes aiGenPulse`가 `background-color`가 아니라 `background-position`을
  `200% 0` → `-200% 0`으로 선형 애니메이션(`1.8s linear infinite`)시켜 그 그라데이션
  띠가 블록을 가로질러 반복적으로 쓸고 지나가게 했다 — 띠가 지나가는 자리만 순간
  밝고 나머지는 옅은 상태를 유지하는 전형적인 shimmer(스켈레톤 로딩) 질감이다.
  `background-color` 자체는 이제 전혀 설정하지 않는다(완전 투명, 색은 그라데이션
  하나가 전담). 글씨는 이전과 마찬가지로 `opacity:1`/`filter:none`을 항상 유지해
  읽기 불편한 깜빡임이 전혀 없다 — "배경에만, 글씨에는 말고"라는 그 전 요청의
  전제는 그대로 지켜졌고, 이번 수정은 그 배경 효과의 "모양"만 단색 토글에서
  그라데이션 스윕으로 바뀐 것이다. 인쇄 시엔 `background-image: none`으로 되돌린다
  (기존 `@media print` 블록의 `background-color: transparent` 자리를 교체).
- `test_mock_interview_shimmer_pulse.js`(스크래치패드 전용)로 (1) 블록이 여전히
  `aiGenPulse` 애니메이션을 타는지, (2) 글씨는 `opacity:1`/`filter:none`을 유지하는지,
  (3) 효과가 `background-image`(그라데이션)로 구현돼 있는지, (3b) `background-color`는
  설정돼 있지 않은지(완전 투명 — 그라데이션 하나가 색을 전담한다는 것 확인), (4) 900ms
  뒤 `background-position` 값이 실제로 달라지는지(고정된 틴트가 아니라 진짜로 쓸고
  지나가는지), (5) 분석이 끝나면 클래스가 빠지고 효과가 멈추는지 — 모두 확인했다.
  기존 `test_mock_interview_bottom_finalize_bg_pulse.js`의 배경색 기반 단언([2d]/[2e])도
  이 새 그라데이션 동작에 맞게 `background-image`/`background-position` 검사로
  고쳐 다시 통과시켰고, `test_mock_interview_top_bottom_save_load.js`도 재실행해
  회귀가 없음을 확인했다.

## `mock-interview.html` — 그라데이션 셔터 스윕이 끊기던 문제: `background-position` 애니메이션을 `transform` 기반 `::after` 오버레이로 교체

사용자 피드백: "그라데이션 애니메이션이 좀 끊기는거 같으면서 부자연스러운데." 바로
위 섹션에서 만든 `aiGenPulse` 스윕 효과가 `.ai-generating` 자신의
`background-position`을 직접 애니메이션시키는 방식이었는데, **`background-position`
애니메이션은 GPU 합성(compositor)만으로 처리되지 않고 매 프레임 그 배경을 다시
그려야(repaint) 한다** — `transform`/`opacity`만이 브라우저가 리페인트 없이
합성만으로 처리하도록 보장하는 속성이다. 이 효과가 한 번에 최대 3개 블록(핵심
평가 영역별 분석/주요 강점·보완점/문항별 상세 피드백)에 동시에 걸릴 수 있다는 점이
이 반복 리페인트 비용을 더 키워, 실제로 눈에 띄게 끊기는 애니메이션으로 체감됐다.

**고쳐서** 그라데이션 띠 자체를 `.ai-generating::after` 가상 엘리먼트로 분리하고,
그 가상 엘리먼트의 `transform: translateX(...)`만 애니메이션시키도록 바꿨다(새
`@keyframes aiGenSweep`, 기존 `aiGenPulse`를 대체) — 보이는 디자인(비스듬한 보랏빛
그라데이션이 블록을 가로질러 쓸고 지나가는 모양)은 그대로 유지한 채, 애니메이션되는
속성만 리페인트를 유발하지 않는 `transform`으로 바뀐 것이다. `::after`는
`top:0; bottom:0`(부모 `.ai-generating`의 콘텐츠 높이에 맞춰 늘어남)과
`left:-60%; right:-60%`(부모보다 좌우로 60%씩 더 넓게 그려, 띠가 스윕하는 동안 양
끝에 빈틈이 보이지 않게 함)로 크기를 잡는다 — `height:100%` 같은 퍼센트 높이
대신 `top`/`bottom` 오프셋으로 늘린 이유는, `.ai-generating` 자신의 높이가 명시적
값이 아니라 콘텐츠에 따라 `auto`로 정해지는 값이라 퍼센트 높이가 안정적으로
작동하지 않는 CSS 함정(퍼센트 높이는 그 containing block에 명시적 높이가 있어야만
해석됨)을 피하기 위함이다. `.ai-generating` 자신은 `position:relative;
overflow:hidden`으로 바뀌어, `::after`가 양옆으로 삐져나온 부분을 가려주는 역할만
한다. 글씨(`opacity:1`, `filter` 없음)는 이전과 마찬가지로 전혀 영향받지 않는다 —
바뀐 건 띠를 움직이는 메커니즘뿐이다. 인쇄 시엔 `.ai-generating::after{
display:none !important; }`로 오버레이 자체를 지우고, `.ai-generating`의
`overflow`/`margin`/`padding`도 평소 값으로 되돌린다.

`test_mock_interview_shimmer_pulse.js`를 이 새 구조에 맞게 다시 썼다 — (1)
`.ai-generating` 블록 자신은 더 이상 CSS 애니메이션을 돌리지 않고(`animation-name:
none`) `background-image`도 없는지(색은 전부 `::after`로 옮겨감), (2) 글씨가 여전히
`opacity:1`/`filter:none`을 유지하는지, (3) `::after`가 `aiGenSweep` 애니메이션과
그라데이션 `background-image`를 갖고 절대 위치(overlay)로 떠 있는지, (3b) 900ms
사이를 두고 `::after`의 computed `transform` 값이 실제로 달라지는지(진짜로
스윕하는지, 멈춰있는 오버레이가 아님을 확인), (3c) 그 사이 블록 자신의
`background-position`은 전혀 안 바뀌는지(애니메이션이 그 속성에서 완전히
떠났음을 확인), (4) 분석이 끝나면 클래스가 빠지고 스윕이 멈추는지 — 모두
검증했다. `test_mock_interview_bottom_finalize_bg_pulse.js`의 기존 [2]/[2d]/[2e]
단언도 같은 이유로 `::after`의 `animation-name`/`background-image`/`transform`을
보도록 고쳐 다시 통과시켰고, `test_mock_interview_sample_questions.js`/
`test_mock_interview_top_bottom_save_load.js`도 재실행해 회귀가 없음을 확인했다.

## `mock-interview.html` — 선생님 피드백 메모는 1단계 분석 전에도 언제든 입력 가능 + 저장된 면접은 원래부터 전체 공개

사용자 요청: "선생님 피드백은 AI 분석 생성 생성하기 전에도 입력할 수 있게 해줘. 그래서
언제든지 입력할 수 있게 그리고 종합보고서를 생성할 때 들어가게. 저장된 면접 내용은
누구든지 불러올 수 있게 해줘." 두 가지 요청 중 실제로 코드 변경이 필요했던 건 첫
번째뿐이다 — 두 번째("저장된 면접 내용은 누구든지 불러올 수 있게")는 이미 그렇게
동작하고 있었다(아래 참고).

**① 담당 선생님 종합 피드백 메모 입력칸이 1단계 분석 완료 전까지 `disabled`였다.**
`#teacherInputMemo`(textarea)와 그 옆의 두 프리셋 버튼(`#btnPresetGood`/
`#btnPresetImprove`, "우수 평가 템플릿"/"보완 필요 템플릿")은 HTML에 처음부터
`disabled` 속성이 박혀 있었고, `setStageControlsEnabled(enabled)`가 1단계 분석
(`generateAnalysis()`)이 끝나야 그 셋과 "최종 보고서로 확정하기" 버튼
(`#btnFinalize`)을 한꺼번에 활성화했다 — 선생님이 면접 전/중에 미리 메모를 적어두고
싶어도 1단계를 먼저 돌리기 전까지는 타이핑조차 할 수 없었다.

실제로 메모가 보고서에 반영되는 지점(`finalizeReport()`, 2단계)은 이미 클릭하는
그 순간의 `#teacherInputMemo` 값을 그대로 읽어서 AI에 보내도록 돼 있었으므로
(`callInterviewReportApi(name, major, teacherMemo)`), 입력칸을 언제 채우든 상관없이
2단계를 누를 때 최신 값이 반영된다 — 즉 "종합보고서를 생성할 때 들어가게"라는 요구는
이미 충족돼 있었고, 막혀 있던 건 "언제든지 입력"쪽뿐이었다.

**고쳐서** `#teacherInputMemo`/`#btnPresetGood`/`#btnPresetImprove` 세 엘리먼트에서
`disabled` 속성을 전부 빼서 페이지 로드 직후부터 항상 입력 가능하게 했고(placeholder도
"먼저 1단계 답변 분석을 실행하면..."에서 "면접 전이나 중간에도 미리 입력해둘 수
있어요. 여기 적은 내용은 '2단계: 최종 보고서로 확정하기'를 누를 때 반영돼요."로
바꿈), `setStageControlsEnabled(enabled)`는 이제 `#btnFinalize`만 토글한다 — 최종
보고서 확정은 여전히 1단계 분석이 먼저 끝나야(`hasDraftAnalysis`) 가능해야 하므로
(아직 존재하지 않는 분석 결과에 선생님 의견만 얹어 "최종 확정"할 수는 없다) 그
버튼의 게이트는 그대로 유지했다. `generateAnalysis()`는 여전히
`updateTeacherMemoDisplay('')`로 **보고서에 표시되는** 메모만 1단계 시작 시 비우고
(1단계는 답변 전사만으로 돌리는 초안이라, 아직 반영 전이라는 뜻) 입력칸 자신의
`.value`는 전혀 건드리지 않으므로, 분석 전에 적어둔 메모는 1단계를 거쳐도 그대로
남아있다가 2단계에서 정확히 반영된다. `resetAll()`은 기존처럼 `.value = ''`로 직접
비우고, `loadSampleData()`/`applyLoadedReport()`도 이전처럼 `.value`를 직접
채워 넣을 뿐이라 — 셋 다 `disabled` 여부와 무관하게 항상 동작했으므로 추가 변경이
필요 없었다.

**② "저장된 면접 내용은 누구든지 불러올 수 있게"는 이미 그랬다.** 이 페이지는
애초에 로그인 자체가 없고(이 문서의 해당 섹션 참고), `interview_reports` 테이블의
RLS 정책 네 개(`interview_reports_select_open`/`_insert_open`/`_update_open`/
`_delete_open`)가 전부 `anon`/`authenticated` 양쪽에 `qual: true`(무조건 허용)로
열려 있다 — `fetchSavedReports()`/`loadReportById()` 어디에도 `owner_id`/`user_id`
같은 필터가 전혀 없어, 저장한 사람이 누구든 다른 교사가 📂 불러오기나 📋 목록
관리에서 똑같이 찾아 불러올 수 있다(삭제도 마찬가지). Supabase에서 직접
`pg_policies`를 조회해 재확인했다 — 코드 변경은 필요 없었다.

`test_mock_interview_memo_anytime.js`(새 테스트)로 (1) 페이지 로드 직후(1단계 실행
전) 메모 입력칸과 두 프리셋 버튼이 전부 활성 상태인지, `#btnFinalize`는 여전히
비활성인지, (2) 1단계 전에 직접 타이핑한 값이 그대로 유지되는지, 프리셋 버튼도 1단계
전에 바로 동작하는지, (3) 샘플 채우기+1단계 분석을 거쳐도 미리 적어둔 메모 텍스트가
그대로 보존되는지, (4) 2단계(최종 확정)를 누르면 1단계 실행 **전에** 적어둔 그 메모가
정확히 AI 호출 payload의 `teacherMemo`로 실리는지 — 모두 확인했다. 기존
`test_mock_interview_bottom_finalize_bg_pulse.js`/`test_mock_interview_shimmer_pulse.js`/
`test_mock_interview_sample_questions.js`/`test_mock_interview_top_bottom_save_load.js`도
다시 돌려 회귀가 없음을 확인했다.

## `chatbot-builder.html`/`bot.html` — 교사가 설계하는 "활동 탭"(탭+하위항목) + 채점 기준

사용자 요청: "국어 문법 탐구 챗봇 보면 2단 구성으로 돼있고 오른쪽에 학생이 과제를
작성하고 메모하는 칸이 있잖아. 이것까지 수업용 챗봇 만들기에서 구현할 수 있으면
좋겠어. 탭1의 내용 탭1의 하위항목 탭2의 내용 탭2의 하위항목등을 교사가 챗봇을
만들면서 설계할 수 있게. 만약에 만들지 않는다면 비어 두면 되겠지. 메모장만 놔두고.
그리고 채점 기준을 올리는 부분도 있으면 좋을 것 같아." — `korean-inquiry.html`
(국어 현상 탐구 챗봇)의 2단 레이아웃(왼쪽 챗봇, 오른쪽 활동1/활동2/활동3 탭+메모장)
구조를 **일반화해서 `chatbot-builder.html`로 만드는 모든 수업용 챗봇(`custom_bots`/
`bot.html`)에도 쓸 수 있게** 한 것 — `korean-inquiry.html`은 그 자체로 완전히 별개의
서브시스템(자신만의 `inquiry_sessions`/`inquiry_settings`)이라 전혀 건드리지 않았고,
이번 작업은 `custom_bots`/`bot.html` 쪽에 같은 UX 패턴을 새로 구현한 것이다.

**메모장(오른쪽 패널)은 사실 이미 모든 수업용 챗봇에 있었다** — `bot.html`의
2단 구성(채팅 왼쪽, "📝 조사한 자료" 메모 패널 오른쪽, `custom_bot_notes` 테이블)은
처음부터 모든 `custom_bots`에 적용되는 범용 기능이었다. 이번에 새로 만든 건 그
메모장 **위에** 추가로 들어가는, 교사가 설계하는 "활동 탭" 뿐이다 — 탭을 하나도
설계하지 않으면 이 패널 자체가 안 보이고 메모장만 그대로 남는다("비어두면 메모장만").

- **`custom_bots.activity_schema`**(새 컬럼, `jsonb not null default '[]'`) — 탭
  배열: `[{id, title, fields: [{key, label, type: 'text'|'textarea'|'checklist',
  options?: string[]}]}]`. **`custom_bots.grading_criteria`**(새 컬럼, `text not
  null default ''`) — 채점 기준 원문(선택). 둘 다 `custom_bots`의 기존 RLS(소유
  교사만 쓰기, `chatbot-builder.html`이 이미 `sb.from('custom_bots')`로 직접
  읽고 쓰는 그 테이블)를 그대로 타므로 새 RLS 정책이 필요 없었다.
- **새 테이블 `custom_bot_activity_responses`**(`session_id uuid primary key
  references custom_bot_sessions(id) on delete cascade`, `responses jsonb not
  null default '{}'`, `updated_at`) — 한 학생 세션의 모든 탭 응답을 하나의 jsonb
  객체(`{fieldKey: value}`, 체크리스트는 체크된 옵션 문자열 배열)로 통째로
  담는다. `custom_bot_notes`/`custom_bot_messages`와 똑같은 패턴으로 RLS에
  클라이언트용 쓰기 정책이 전혀 없고(`student-bot-chat` Edge Function이
  service-role로만 쓴다), **읽기만** `custom_bot_activity_responses_select_owner`
  정책(세션→봇 조인으로 `owner_id = auth.uid()` 또는 관리자)으로 열어, 봇을 만든
  교사가 `chatbot-builder.html`에서 직접 `sb.from(...)`으로 조회할 수 있다.
- **`student-bot-chat` Edge Function 버전 28**(`verify_jwt:false`, 이전처럼 소스가
  git에 커밋되지 않는 함수라 — "Edge Function code has no backup outside Supabase
  itself" 섹션 참고 — 이 CLAUDE.md 글이 그 로직의 유일한 기록이다)에 네 가지를
  추가했다:
  - `start` 액션이 `bot.activity_schema`와 그 세션에 이미 저장된
    `custom_bot_activity_responses.responses`(재접속/새로고침 시 그대로 복원)를
    함께 돌려준다 — 탭이 없으면 빈 배열이라 `bot.html`은 메모장만 보여준다.
  - `info` 액션도 `activitySchema`를 함께 돌려주게 확장했다 — **같은 탭에서
    새로고침해 이미 저장된 sessionToken으로 재접속하는 경로**는 `start`를 다시
    호출하지 않으므로, `bot.html`이 활동 패널을 그리려면 스키마를 어디선가 다시
    가져와야 했다. `info`는 PIN 확인 전에도 호출되는 가벼운(비민감) 조회라 이
    용도에 적합했다.
  - `getActivityResponses`(sessionToken으로 현재 응답 재조회)/
    `saveActivityResponses`(sessionToken + 전체 `responses` 객체를 받아 그
    세션의 행을 `upsert`, `korean-inquiry.html`의 `inquiry_session_save`와
    동일한 "항상 전체를 통째로 덮어쓰기" 디바운스 자동저장 방식 — 60000자 상한
    검사 포함) 두 액션을 추가했다.
  - `chat` 액션의 시스템 프롬프트에 `bot.grading_criteria`가 있으면 "선생님이
    정해둔 채점 기준은 다음과 같다. 학생이 물으면 참고해 쉽게 설명해주되 직접
    점수/등급을 매겨 알려주지는 말라(최종 평가는 선생님이 한다)"는 문장과 함께
    원문을 덧붙인다 — 챗봇이 과제 안내 중 채점 기준을 참고할 수 있게 하면서도,
    학생에게 임의로 점수를 내려주는 건 명시적으로 금지했다.
- **`chatbot-builder.html`의 편집기(`renderEditor()`)에 두 가지를 추가했다**:
  - "추천 질문" 필드 바로 다음에 "채점 기준" textarea(`#fGradingCriteria`) — 타이핑
    또는 `.txt` 파일을 올리면(`#gradingCriteriaFile`, 순수 클라이언트
    `FileReader`, 서버 파싱 없음) 그 내용이 textarea에 그대로 채워진다. "채점
    기준을 올리는 부분"이라는 요청을 "타이핑도 되고 텍스트 파일 업로드도 되는"
    형태로 구현했다 — **PDF/이미지 업로드는 이 시점엔 범위 밖으로 남겨뒀지만,
    바로 아래 "PDF나 이미지로 업로드해도 분석해서 저장" 섹션에서 곧 추가됐다.**
  - "참고 자료" 섹션과 "학생 대화 기록" 섹션 사이에 새 "학생 활동지 설계 (선택)"
    섹션 — `currentActivitySchema`(배열, `openEditor()`에서 `currentBot
    .activity_schema`를 깊은 복사해 들고 있다가 "저장"을 눌러야만 실제
    반영됨) 하나를 화면에 그리는 `renderActivityEditor()`가 탭마다
    `.activity-tab-block`(제목 입력 + "탭 삭제" + 하위항목 목록 + "+ 하위항목
    추가")을 그린다. 각 하위항목(`renderActivityFieldRow()`)은 레이블
    입력 + 종류 `<select>`(텍스트(한 줄)/텍스트(여러 줄)/체크리스트) + 삭제
    버튼이고, 체크리스트를 고르면 옵션을 한 줄에 하나씩 적는 textarea가 추가로
    보인다. **구조가 바뀌는 동작(탭/항목 추가·삭제, 종류 변경)만
    `renderActivityEditor()`를 다시 부르고, 제목/레이블/옵션 텍스트 입력은 그
    입력칸의 `input`/`change` 이벤트가 배열을 직접 수정할 뿐 다시 그리지
    않는다** — 다시 그렸다면 매 키 입력마다 포커스가 끊겼을 것이다. "저장"을
    누르면 `sanitizeActivitySchema()`가 빈 탭 제목을 "활동N"으로 기본값
    채우고 타입을 화이트리스트로 검증한 뒤 `custom_bots.activity_schema`에
    함께 저장된다(다른 필드들과 같은 하나의 저장 버튼/페이로드).
- **`chatbot-builder.html`의 "학생 대화 기록" 섹션**: 세션 행마다 "대화 보기"/
  "메모 보기" 옆에 **현재 봇에 설계된 활동 탭이 있을 때만** "활동 보기" 버튼이
  추가로 보인다(`hasActivitySchema = currentBot.activity_schema.length > 0` —
  탭이 없으면 볼 게 없어 버튼 자체를 안 보여준다). 클릭하면
  `custom_bot_activity_responses`를 직접 `select`해(owner RLS) 그 세션의
  응답을 `formatActivityResponseLines(responses, schema)`로 "■ 탭 제목 /
  - 항목 레이블: 값"(체크리스트는 `[v]`/`[ ]`로) 줄 목록으로 보여준다 — 이
  함수는 "엑셀로 내려받기"(`exportSessionsToExcel()`)에 새로 추가된 "활동지
  내용" 열에도 그대로 재사용돼, 화면 보기와 엑셀 출력이 서로 다른 형식으로
  어긋나지 않는다(탭이 설계 안 된 봇은 그 열에 "(설계된 활동 탭 없음)"만 찍힌다 —
  굳이 그 경우 `custom_bot_activity_responses`를 조회하지 않는다).
- **`bot.html`**: 기존 `.chat-layout`(채팅 + 메모 패널 2단)의 오른쪽을
  `#rightCol`(새 flex 컨테이너)로 감싸고, 그 안에 `#activityPanel`(기본
  `display:none`)과 기존 `.notes-panel`을 세로로 함께 둔다 — 활동 탭이 없으면
  `activityPanel`이 숨겨진 채라 메모장(`flex:1`)이 칸 전체를 그대로 차지해서
  기존(이 기능 추가 이전) 레이아웃과 완전히 동일하게 보인다. 탭이 있으면
  `activityPanel`이 `flex:1.3`(메모장보다 조금 더 넓게 — 활동 하위항목이 보통
  메모보다 입력량이 많아서)으로 함께 나타난다. `initActivityPanel(schema,
  responses)`가 `start`(새 세션) 또는 `info`+`getActivityResponses`(기존
  sessionToken으로 재접속하는 경로, 바로 위 Edge Function 섹션 참고) 양쪽에서
  호출돼 탭+응답을 초기화하고, `renderActivityTabs()`/`renderActivityFields()`가
  탭 버튼 줄과 활성 탭의 입력칸을 그린다. 각 입력칸의 `input`(텍스트류)/
  `change`(체크박스) 이벤트가 `activityResponses` 객체를 직접 갱신하고
  `scheduleActivitySave()`(900ms 디바운스, `korean-inquiry.html`과 동일한
  패턴)가 전체 `responses`를 `saveActivityResponses`로 보낸다 — 저장 상태는
  `#activitySaveMsg`에 "✓ 자동 저장됨"/"⚠ 저장 실패"로 조용히 표시된다(메모장의
  기존 `#notesMsg`와 같은 수준의 조용한 피드백). 탭을 바꿔도 이미 메모리에 있는
  `activityResponses`를 그대로 다시 그릴 뿐 서버를 다시 조회하지 않는다.
  모바일(`@media max-width:760px`)에서는 `#rightCol` 전체가 `.chat-layout`의
  두 번째 flex 자식으로 세로로 쌓이고(`max-height:46vh`), 활동 패널+메모장이
  그 안에서 다시 비율대로 나눠 가진다 — `body.bot-chat-active`가 문서 전체를
  뷰포트 높이로 고정해 채팅이 길어져도 오른쪽 칸이 화면 밖으로 밀려나지 않는다는
  기존 설계(이 문서의 "bot.html's chat view is two columns" 섹션 참고)는 전혀
  안 바뀌었다 — `.notes-panel`이 하던 역할을 이제 `#rightCol`이 한다는 것만
  다르다.
- Playwright로 (1) `test_bot_activity_panel.js` — 스키마가 없으면 패널이 완전히
  숨겨지고 메모장이 기존처럼 동작하는지, 2개 탭(텍스트/여러 줄 텍스트/체크리스트
  필드 혼합)이 설계된 경우 탭 전환 시 보이는 필드가 바뀌고 입력/체크 시
  디바운스 자동저장이 정확한 payload로 나가는지(체크리스트는 체크된 옵션만
  배열로), 탭을 바꿔도 이전 탭에 입력해둔 값이 유지되는지, 기존 sessionToken으로
  재접속(새로고침)하는 경로도 `info`+`getActivityResponses`로 스키마·기존 응답을
  정확히 복원하고 `start`를 다시 호출하지 않는지 — 모두 확인했다. (2)
  `test_bot_notes_regression.js` — 메모장(추가/펼치기/삭제)이 이 레이아웃
  리팩터링 후에도 전혀 안 바뀌었는지 회귀 확인. (3)
  `test_chatbot_builder_activity_designer.js` — 탭 추가/하위항목 추가(텍스트+
  체크리스트)/옵션 입력 → 저장 시 payload의 `activity_schema`/
  `grading_criteria`가 정확한지, 저장 후 "활동 보기" 버튼이 나타나고 실제
  학생 응답을 필드 레이블로(원시 key가 아니라) 보여주는지, 필드/탭 삭제가
  에디터를 다시 빈 상태로 되돌리는지 — 모두 확인했다. (4)
  `test_chatbot_builder_regression.js` — 제목/소개/추천 질문/챗봇 유형 같은
  기존 필드들이 이 변경과 무관하게 여전히 정확히 프리필·저장되는지, 새 필드
  (`grading_criteria`/`activity_schema`)가 빈 상태에서도 저장 payload에 올바른
  기본값(빈 문자열/빈 배열)으로 실리는지 — 확인했다. 전부 로컬 UMD
  `@supabase/supabase-js` 번들(`page.route`로 jsdelivr 대신 서빙)과 localStorage에
  직접 심은 가짜 `sb-tmssupuskkajahpuswcj-auth-token` 세션으로 로그인을
  모킹했다(supabase-js v2의 `getSession()`은 그 키의 값을 먼저 보고, 아직
  만료 전이면 네트워크 호출 없이 그대로 써서 — 이 환경의 `*.supabase.co` 아웃바운드
  차단과 무관하게 테스트할 수 있다).
- **이 환경에서는 역시 실제 Claude/Gemini API 호출 성공 여부(채점 기준이
  실제 대화에 얼마나 잘 반영되는지)까지는 검증할 수 없다** — `api.anthropic
  .com`/`*.supabase.co`로의 아웃바운드가 막혀 있다는 이 문서의 반복되는 제약.
  Edge Function 자체는 Supabase에 정상 배포(버전 28)됐고 코드 리뷰(문법/로직
  검토)와 배포까지는 이 환경에서 끝냈지만, 실제 수업에서 교사가 활동 탭을
  설계하고 학생이 입력해보는 것으로 최종 확인이 필요하다.

## `chatbot-builder.html` — 채점 기준을 PDF나 이미지로 올려도 AI가 분석해서 저장

바로 위 섹션의 "채점 기준" 필드는 처음엔 `.txt` 파일만 받았다(순수 `FileReader`,
서버 호출 없음) — 사용자가 "채점 기준은 pdf나 이미지로 업로드 해도 분석해서
저장하게 해줘"라고 요청해서, PDF/이미지도 올릴 수 있게 확장했다. 핵심은 "분석해서"
— 단순히 원본 바이트를 그대로 집어넣는 게 아니라, 실제 내용을 텍스트로
추출·정리한 결과를 textarea에 채워야 한다는 뜻이라, 새 Edge Function
**`analyze-grading-criteria`**(Claude 우선/Gemini 폴백, `verify_jwt:false`에
`custom-bot-doc-ingest`와 같은 "바로 코드 안에서 로그인+`profiles.approved` 확인"
패턴)를 새로 만들었다.

- **PDF는 항상 클라이언트에서 먼저 읥는다** — 이 저장소의 기존 "PDF reference-
  material uploads are extracted in the browser, not the server" 관행(서버 Edge
  Function의 CPU 2초/응답 150초 제한을 피하기 위해 pdf.js로 브라우저에서 처리)을
  그대로 따랐다. `extractGradingCriteriaFromPdf(file, onStatus)`가
  `pdfjsLib.getDocument()`로 페이지별 텍스트를 뽑고(이미 있던 `extractPdfPages()`
  와 같은 방식이지만, 채점 기준용은 RAG 청크 분할이 필요 없어 별도의 더 단순한
  함수로 새로 짰다), 자료실 PDF 업로드가 쓰는 "스캔본 판별" 휴리스틱(총 글자수
  30자 미만, 또는 텍스트 있는 페이지 비율)과 같은 아이디어를 재사용한다 — 다만
  기준값은 더 느슨한 **30%**(자료실의 5%보다 큼)를 썼다: 채점 기준표는 보통
  한두 페이지짜리 짧은 문서라, 일부 페이지만 텍스트가 안 잡혀도 전체를 스캔본으로
  보고 이미지 분석으로 넘기는 쪽이 부분적으로만 성공한 텍스트를 그대로 저장하는
  것보다 안전하다고 판단했다.
  - **텍스트가 충분히 잡히면**: 페이지별 텍스트를 "[N페이지]\n..." 형태로
    이어붙여 `analyze-grading-criteria`에 `{mode:'text', text}`로 보낸다 — 서버는
    "PDF 추출 과정에서 줄바꿈·공백·표 구조가 깨져 있을 수 있으니, 항목·배점·세부
    기준을 하나도 빠뜨리거나 지어내지 말고 그대로 보존한 채 번호 목록 형태로
    정리해 달라"는 프롬프트로 Claude(실패 시 Gemini)를 호출한다.
  - **스캔본으로 보이면**: `renderPdfPageToImageBase64(pdf, pageNum, scale)`
    (pdf.js의 `page.getViewport()`+`page.render({canvasContext, viewport})`로
    오프스크린 `<canvas>`에 그린 뒤 `canvas.toDataURL('image/png')`) 로 최대
    `GRADING_PDF_MAX_IMAGE_PAGES = 8`페이지까지 PNG로 캡처해,
    `{mode:'image', images:[{data, mediaType:'image/png'}, ...]}`로 보낸다 — 서버는
    Claude의 비전 API(`content` 배열에 `{type:'image', source:{type:'base64',
    media_type, data}}` 블록, 모델 `claude-sonnet-5-5`)로 이미지에 적힌 내용을
    그대로 텍스트로 옮겨 적게 한다.
- **일반 이미지 파일(`image/*`)은 바로 비전 분석으로** —
  `extractGradingCriteriaFromImage(file, onStatus)`가 `fileToBase64()`
  (`FileReader.readAsDataURL` 뒤 `data:...;base64,` 접두사만 떼어냄)로 인코딩해
  `{mode:'image', images:[{data, mediaType: file.type}]}` 한 장짜리 요청을 보낸다.
- **`analyze-grading-criteria` Edge Function**은 이 저장소의 "AI provider
  strategy"(Claude 우선, 실패 시 Gemini 폴백)를 텍스트 모드/이미지 모드 양쪽에
  각각 적용했다 — `callClaudeText`/`callClaudeImages`(모델 `claude-sonnet-5-5`,
  `max_tokens: 8192` — `mock-interview.html`의 `interview-report`가 겪었던 "절삭
  상수가 너무 작아서 조용히 실패→로컬 폴백으로 빠지는" 사고를 교훈삼아 넉넉하게
  잡았다)와 `callGeminiText`/`callGeminiImages`(모델 `gemini-3.6-flash`, 이미지는
  `inline_data`로 전달) 네 함수가 있고, 도구(tool) 호출이 전혀 없는 단순 텍스트
  생성이라 `output_config`/`effort` 같은 필드는 아예 안 보낸다(이 역시
  `student-bot-chat`이 겪은 "도구 없는 호출에 effort를 실어 보내면 모델이
  멈추지 않고 반복하다 `max_tokens`에 걸리는" 사고를 피하기 위한 선제 조치).
  성공한 호출마다 `ai_usage_log`에 `function_name: 'analyze-grading-criteria'`로
  기록한다(이 사이트의 다른 모든 AI 호출 Edge Function과 같은 관행).
- **UI**: `#gradingCriteriaFile`의 `accept`를 `.txt`에서 `.txt,.pdf,image/*`로
  넓혔고, 그 바로 아래 새 `#gradingCriteriaMsg`(작은 `hint2` 텍스트)가
  "텍스트 추출 중 (N/M페이지)" → "AI로 내용 정리/분석 중..." → "✅ AI가 분석한
  내용을 아래 칸에 채웠어요. 필요하면 직접 고쳐도 돼요." 순으로 진행 상황을
  보여준다. 분석 중에는 파일 입력 자체를 `disabled`로 막아 중복 클릭을 방지하고,
  끝나면(성공이든 실패든) 다시 풀어서 재시도할 수 있게 한다. `.txt`는 여전히
  서버 호출 없이 그대로 읥어 채우고, `.txt`/`.pdf`/이미지가 아닌 형식(예:
  `.docx`)은 클라이언트에서 바로 "지원하지 않는 파일 형식이에요" 에러로 막아
  네트워크 호출 자체가 나가지 않는다. 서버가 `{ok:false, error}`를 돌려주면 그
  에러 문구를 그대로 보여주고 textarea는 건드리지 않는다(실패를 성공처럼
  덮어쓰지 않음).
- `test_grading_criteria_upload.js`(Playwright, 로컬 `pdf-lib`로 실제 PDF
  두 개를 즉석에서 만들어 검증 — 하나는 `drawText()`로 진짜 텍스트가 있는 PDF,
  다른 하나는 1×1 PNG만 두 페이지에 그려 넣어 `getTextContent()`가 빈 문자열을
  돌려주는 "스캔본"을 흉내낸 PDF)로 (1) `.txt`는 여전히 네트워크 호출 없이 직접
  채워지는지, (2) 텍스트 PDF는 추출된 실제 텍스트(`Alpha99`/`Beta77`)를 담아
  `mode:'text'` 요청 한 번만 보내는지, (3) 스캔본 PDF는 2페이지 전체를 PNG
  이미지로(각각 base64 데이터와 `image/png` mediaType 포함) `mode:'image'`로
  보내는지, (4) 일반 이미지 파일은 이미지 1장짜리 `mode:'image'` 요청을 바로
  보내는지(실제 파일의 MIME 타입이 그대로 반영되는지), (5) `.docx` 같은 지원
  안 하는 형식은 네트워크 호출 없이 바로 에러 메시지로 막히는지, (6) 서버가
  실패 응답을 주면 그 에러 문구가 그대로 보이고 textarea는 비워진 채 유지되며
  파일 입력이 다시 활성화돼 재시도할 수 있는지 — 21개 단언 모두 확인했다. 기존
  `test_chatbot_builder_regression.js`/`test_chatbot_builder_activity_designer.js`
  도 다시 돌려 회귀가 없음을 확인했다.
- **이 환경에서는 역시 실제 Claude/Gemini API 호출 성공 여부(비전 분석이 실제
  스캔 문서를 얼마나 정확히 읥어내는지)까지는 검증할 수 없다** — `api.anthropic
  .com`으로의 아웃바운드가 막혀 있다는 이 문서의 반복되는 제약. Edge Function
  자체는 Supabase에 정상 배포(버전 1)됐고 배포 직후 소스를 다시 읥어 한글
  주석·프롬프트·로직이 의도한 그대로 저장됐는지 확인까지는 했지만, 실제 수업
  준비 중 교사가 진짜 PDF/사진을 올려보는 것으로 최종 확인이 필요하다.

## `mock-interview.html` — "분석이 단순하다"/"중간에 멈춘다" 신고 — 실제 원인은
## `interview-report` Edge Function의 두 침묵 절삭 상수였다 (+화면 꺼짐 대응)

다른 선생님이 실제로 써보고 세 가지를 보고했다: "분석 내용이 좀 단순하다", "전체를
통으로 올렸을 때는 중간에 분석이 멈춰 버렸다", "텍스트 전사가 정확하지 않다" — 거기에
사용자 본인의 의심("내가 봤을땐 분석 결과가 그렇게 단순하진 않을거 같은데")과 두 가지
질문("화면이 꺼지면 전사가 끊길 수도 있나?", "화면이 꺼지지 않게 하는 방법이 있나?")이
함께 왔다. 배포된 `interview-report` 함수 소스를 직접 읽어서(추측이 아니라) 코드
리뷰로 원인을 찾았다.

**진짜 원인: `MAX_TRANSCRIPT_CHARS = 4000`과 `max_tokens: 4096` 두 상수가 함께
작용해, "분석이 단순하다"와 "분석이 중간에 멈춘다"는 서로 다른 두 신고가 실제로는
같은 하나의 실패였을 가능성이 크다.**
- **입력 쪽 절삭**: 선생님이 "다음 문항 구분(마커)"을 한 번도 안 누르고 면접 전체를
  하나의 긴 구간으로 녹음하면, 그 구간의 전사가 쉽게 4000자를 넘는다 — 그 이후
  내용은 AI에게 전달되기 전에 `.slice(0, MAX_TRANSCRIPT_CHARS)`로 조용히 잘려
  나갔다. "전체를 통으로 올렸을 때"라는 신고 문구가 정확히 이 경로(마커 없이 쭉
  녹음)를 가리킨다.
  - 그 사이 다른 세션에서 "마커를 거의/전혀 안 눌러도 한 구간 안의 여러 질문-답변을
    AI가 자동으로 찾아 분리하는" 기능(이 문서의 "`detailed[]` 자동 분리" 섹션)이
    이미 추가돼 있었는데, 그 기능이 긴 전사를 전제로 하면서 입력 절삭과 정면으로
    충돌하게 됐다 — 긴 전사일수록 잘릴 가능성이 높아지는데, 그 기능은 바로 그런
    긴 전사를 다루는 걸 전제로 만들어졌기 때문이다.
- **출력 쪽 절삭**: `max_tokens: 4096`은 애초에 문항 하나당 `detailed` 항목
  하나씩이던 시절의 값이었다 — 자동 분리 기능이 한 구간을 여러 `detailed` 항목으로
  쪼개면서 응답 JSON이 쉽게 더 길어졌고, 길어진 응답이 4096 토큰 한도에 걸려
  중간에서 잘리면 `extractJson()`의 `JSON.parse()`가 실패한다(절삭된 JSON은 닫는
  중괄호가 없거나 구조가 깨져 있어 `{`~`}` 슬라이스로도 복구가 안 된다).
- **두 절삭이 합쳐지는 지점**: `extractJson()`이 던지면 `Deno.serve`의 catch가
  그대로 `{ok:false, error:'AI 분석 중 문제가 발생했어요...'}`를 돌려주고,
  클라이언트(`generateAnalysis()`)는 이걸 받아 조용히 `runLocalSimulation(name,
  major)`(고정된 일반 샘플)로 대체한다 — 선생님에게는 실제 AI 분석이 실패한 게
  아니라 그냥 "AI가 분석한 결과가 단순하다"로만 보인다. 즉 사용자 본인의 의심
  ("분석 결과가 그렇게 단순하진 않을거 같은데")이 맞았다 — 선생님이 본 건 진짜
  AI 분석이 아니라 그 대체 샘플이었을 가능성이 크다.

**고쳐서** `interview-report`를 버전 9로 재배포(`claude-sonnet-5-5`, 그 외 프롬프트
텍스트는 한 글자도 안 바꿈 — 5번 자동 분리 지시, keyword+detail 형식 지시 등 전부
그대로 유지):
- `MAX_TRANSCRIPT_CHARS`: 4000 → **30000**(Claude Sonnet의 컨텍스트 창 안에서는
  전혀 부담 없는 크기 — 긴 면접을 끝까지 전부 AI에게 전달할 수 있게 했다).
- `max_tokens`: 4096 → **8192**(자동 분리로 늘어난 `detailed[]` 배열까지 끝까지
  받을 수 있게 했다).

**텍스트 전사 정확도**는 Web Speech API(`SpeechRecognition`) 설정 자체(`lang='ko-KR'`,
`continuous=true`, `interimResults=true`)를 코드로 다시 확인했고 이미 올바르게
설정돼 있었다 — 더 손댈 수 있는 자체 코드상의 버그는 없었다. 전사 품질 자체는
브라우저 내장 음성 인식 엔진의 고유한 한계이고, 이 저장소가 직접 통제할 수 있는
영역 밖이다(필요하다면 Whisper 같은 서버사이드 STT로 교체하는 게 유일한 근본
해결책이지만, 이번 요청 범위를 벗어나 별도로 논의가 필요하다).

**화면 꺼짐 — "화면이 꺼지면 전사가 끊길 수도 있나?"는 맞다, 실제로 그럴 수 있다
(화면이 꺼지면 OS가 탭을 백그라운드로 강하게 스로틀링하거나 마이크 스트림 자체를
일시정지할 수 있다는 것이 알려진 모바일/브라우저 동작이다). 지금까지
`mock-interview.html`엔 이를 막는 코드가 전혀 없었다 — Screen Wake Lock API
(`navigator.wakeLock`)를 새로 추가했다.**
- `requestWakeLock()`/`releaseWakeLock()`가 각각 `startRecording()`/
  `stopRecording()`에서 호출된다 — 이 페이지의 모든 "정지" 경로(마커 지연 후 정지
  버튼, 재시작 루프 가드가 스스로 멈추는 경우, 음성 인식 오류로 멈추는 경우 등)가
  전부 `stopRecording()`을 거치므로, 그 한 곳에만 `releaseWakeLock()`을 추가하는
  것으로 모든 경로가 커버된다.
- **`'wakeLock' in navigator`로 지원 여부를 먼저 확인**하고, 지원하지 않는
  브라우저(일부 구형 iOS Safari 등)에서는 조용히 아무 일도 하지 않는다 — Wake Lock
  이 없어도 녹음/전사 자체는 평소처럼 정상 동작한다(이 기능은 보조 안전장치일
  뿐, 전사의 필수 조건이 아니다).
- `request()`가 거부되거나(배터리 세이버 모드, 권한 정책 등) 예외를 던져도
  `try/catch`로 삼켜서 녹음 시작 자체를 절대 막지 않는다.
- **탭이 잠깐 가려졌다가(다른 앱으로 전환 등) 다시 보이면 lock이 자동으로 풀려있을
  수 있다**(브라우저 사양상 탭이 보이지 않는 동안 lock이 해제된다) — `document`의
  `visibilitychange` 리스너가 `isRecording && document.visibilityState ===
  'visible' && !wakeLockSentinel`일 때 자동으로 다시 요청한다.
- **알려진 한계, 사용자에게도 이렇게 전달함**: 이 API는 브라우저가 화면을 자동으로
  끄는 것만 막을 수 있다 — 사람이 직접 전원 버튼을 눌러 화면을 끄거나 잠그는
  것까지는 어떤 웹 API로도 막을 수 없다(OS/브라우저가 애초에 그 동작을 웹페이지에
  허용하지 않는다).

`test_mock_interview_wakelock.js`(Playwright, `navigator.wakeLock`을 가짜로 교체해
호출 횟수를 기록 — **헤드리스 크로미움은 Wake Lock API를 기본으로 이미 지원해서**,
평범한 `navigator.wakeLock = {...}` 대입은 getter-only 속성이라 조용히 무시되고
실제 네이티브 구현이 그대로 쓰인다; `Object.defineProperty(navigator, 'wakeLock',
{configurable:true, value:{...}})`로 교체해야 가짜가 실제로 쓰인다. "API 자체가 없는
브라우저"를 흉내낼 때도 `navigator.wakeLock = undefined`로는 `'wakeLock' in
navigator`가 여전히 참으로 남으므로, `delete Navigator.prototype.wakeLock`으로
프로토타입에서 실제로 지워야 한다 — 이 환경에서 Wake Lock API를 테스트할 다음
기회에도 이 두 가지 함정을 기억해둘 것)로 (1) 녹음 시작 시 정확히 한 번
`request()`가 호출되는지, (2) 녹음 중엔 release가 안 일어나는지, (3) 정지 시 정확히
한 번 `release()`가 호출되는지, (4) 탭이 가려져 lock이 풀렸다가 다시 보이면(아직
녹음 중) 자동으로 재요청되는지, (5) Wake Lock API 자체가 없는 환경에서도 녹음
시작/정지가 평소처럼 정상 동작하고 JS 에러가 전혀 없는지 — 모두 확인했다. 기존
`test_mock_interview_memo_anytime.js`/`test_mock_interview_sample_questions.js`/
`test_mock_interview_bottom_finalize_bg_pulse.js`/`test_mock_interview_shimmer_pulse.js`/
`test_mock_interview_top_bottom_save_load.js`도 다시 돌려 회귀가 없음을 확인했다.

**이 환경에서는 실제 Claude API 호출의 성공 여부나, 늘어난 30000자/8192토큰
한도가 실사용에서 충분한지까지는 검증할 수 없다**(`api.anthropic.com`으로의
아웃바운드가 이 샌드박스에서 막혀 있다는, 이 문서 다른 곳에도 반복되는 제약) —
실제 효과는 다음 번 긴 면접(마커 없이 쭉 녹음한 경우)을 분석해봐야 확인된다.

## 교실 배치도 — 구조화된 칸 데이터 대신 실제 배치도 이미지를 그대로 보여줌

처음엔 사용자 요청("학교 현황에 교실 배치도 탭을 따로 만들어서 누르면 교실 배치도를
볼 수 있게 해줘. 교실 사용 예약에도 교실 배치도 탭을 만들고... 관리는 학교 현황
페이지 한 군데서 해야 해")에 따라 `classroom_layouts` Supabase 테이블(건물별로
층·칸을 `{type, cells:[{label,sub,cat}], ...}` jsonb로 구조화해 저장)과
school-status.html의 전용 편집기(칸/행/건물 추가·삭제, 드롭다운으로 카테고리별
배경색 지정)를 만들었었다. 바로 이어서 사용자가 "교실배치도는 이미지를 그대로
넣어줘"라고 범위를 분명히 좁혀서, **구조화된 칸 편집기 전체를 걷어내고 실제 배치도
이미지 두 장(본관/진학관·남극회관)을 그대로 보여주는 방식으로 다시 만들었다** —
아래는 그 최종 상태다.

- **`classroom-layout-main.jpg`(본관)/`classroom-layout-annex.jpg`(진학관·남극회관)**
  — 사용자가 보내준 실제 배치도 이미지 두 장을 그대로 저장소 루트에 커밋해둔 정적
  파일이다. 이 저장소는 정적 사이트(빌드 스텝 없음)라 Netlify가 그냥 평범한 파일로
  서빙한다 — 별도 설정이 필요 없다.
- **Supabase 테이블이 전혀 없다.** 구조화 데이터를 저장하던 `classroom_layouts`
  테이블과 그 RLS 정책은 (파괴적 SQL 호출을 이 환경에서 안전하게 실행하기 어렵다는
  이유로) 삭제하지 않고 **그냥 쓰이지 않는 채로 남아있다** — 코드 어디에서도 더는
  참조하지 않는 고아 테이블이다. 나중에 이 테이블을 완전히 정리하고 싶다면 수동으로
  (Supabase 대시보드 또는 이 환경이 아닌 다른 경로에서) `drop table classroom_layouts`
  를 실행하면 된다.
- **`school-status.html`과 `room-booking.html` 둘 다 `#layoutViewArea` 안에 똑같은
  마크업(두 개의 `.layout-image-block`, 각각 `<h3>`제목 + `<a target="_blank"><img></a>`
  + "클릭하면 원본 크기로 열려요" 안내)을 그대로 복붙해 하드코딩하고 있다** — 이
  저장소의 공용 JS 모듈 없는 관행 그대로. 이미지를 클릭하면 `target="_blank"`로 그
  파일 자체가 새 탭에서 원본 해상도(794×1122)로 열린다(화면에 보이는 `<img>`는
  `max-width:560px`로 줄여서 보여줄 뿐). JS 코드가 전혀 없다 — 두 `<img>` 태그가 HTML
  소스에 고정으로 박혀있을 뿐이라, `loadClassroomLayouts()`/`renderClassroomLayouts()`
  같은 렌더 함수나 `LAYOUT_CATS`(9가지 카테고리→배경색 매핑) 같은 상수가 더 이상
  필요 없어져 둘 다 제거했다.
- **"관리는 학교 현황 페이지 한 군데서"라는 원래 요청은 이제 "이미지 파일을 교체하는
  것"으로 좁혀졌다** — 더 이상 브라우저 안에서 칸 하나하나를 고치는 게 아니라, 배치도가
  바뀌면 `classroom-layout-main.jpg`/`classroom-layout-annex.jpg` 파일 자체를 새
  이미지로 교체해 커밋하면 두 페이지 모두 다음 배포부터 자동으로 새 이미지를 보여준다
  (같은 파일을 두 페이지가 똑같이 참조하므로 "학교 현황에서 가져온 걸 교실 예약도
  보여준다"는 요구가 자연히 충족된다 — 별도의 fetch/동기화 로직이 필요 없다).
- 두 페이지 모두 `.rb-tab-btn`/`.tab-btn`의 "교실 배치도" 탭 자체는 그대로 있다
  (room-booking.html은 `RB_TABS` 화이트리스트에 `'layout'`이 이미 포함돼 있음 — 이
  부분은 구조화 데이터 버전을 만들 때 이미 겪은 "하드코딩된 화이트리스트에 새 탭
  추가를 깜빡하면 조용히 기본 탭으로 되돌아간다"는 교훈이 그대로 유지된다).

## `survey.html` (설문조사) — 비회원도 링크만으로 응답 가능한 설문·투표

사용자 요청: "비회원에게도 투표나 설문을 받을 수 있는 기능을 추가할 수는 없을까... 링크를
공유하면 거기서 처리할 수 있게." 이 사이트의 기존 설문/투표(`task_assignments`에 딸린
poll 응답 등)는 전부 `profiles`에 등록된 로그인 계정을 전제로 설계돼 있어, 비회원까지
받으려면 그 모델에 억지로 끼워 넣기보다 **완전히 독립된 새 서브시스템**을 만드는 쪽을
택했다 — `collect.html`의 "로그인 없이 이름만으로 제출"과 같은 신뢰 모델을 설문에 그대로
적용한 것.

- **`public_surveys`**(id, title, description, `questions` jsonb 배열, creator_id,
  creator_name, `require_respondent_name`, `closes_at`(nullable), `is_closed`,
  created_at)와 **`public_survey_responses`**(id, survey_id → `public_surveys.id`
  `on delete cascade`, `respondent_name`(nullable), `answers` jsonb, submitted_at)
  두 테이블. 문항 스키마는 `{key, label, type:'single'|'multi'|'text', options?:
  string[], required?: boolean}`, 응답 스키마는 `{ [question.key]: value }`(단일
  선택은 문자열, 복수 선택은 문자열 배열, 주관식은 문자열 — 선택 안 한/빈 문항은 키
  자체를 안 넣음).
- **RLS는 이 저장소에서 가장 개방적인 "완전 공개" 모델** — `public_surveys_select_open`
  (`anon`+`authenticated`, `using(true)`)이라 비회원도 설문 내용을 바로 읽을 수 있고,
  `public_survey_responses_insert_open`(`anon`+`authenticated`, `with check(true)`,
  **어떤 소유권 검사도 없음**)이라 누구나 어떤 설문에든 응답을 써넣을 수 있다 —
  `room_bookings`의 익명 예약 insert와 같은 신뢰 수준. 단 **응답을 읽는 건
  (`public_survey_responses_select_owner`) 그 설문을 만든 교사(`creator_id =
  auth.uid()`) 또는 관리자만** 할 수 있다 — 설문 자체는 공개지만 누가 뭐라고 답했는지는
  비공개라는, 실제 설문 서비스의 통상적인 기대와 일치하는 비대칭 공개 수준이다.
  `public_surveys`의 insert/update/delete는 `creator_id = auth.uid()`(또는 관리자)만
  가능해서, 설문을 만들려면 로그인이 필요하다.
- **페이지 하나가 `?id=` 유무로 완전히 다른 두 화면을 보여준다**(`collect.html?id=`
  패턴과 동일한 구조) — `?id=` 없음: 로그인+승인 게이트 뒤의 "관리 화면"(새 설문
  만들기 + 내가 만든 설문 목록), `?id=<uuid>`: **로그인 전혀 필요 없는** 공개 응답
  화면. 두 화면 모두 하나의 `<script>` 안에서 `initManageView()`/`initPublicView(id)`
  로 분기해서 처리한다.
  - **관리 화면**: "+ 새 설문 만들기"를 펼치면 제목/설명(선택)/마감일(선택, 비우면
    직접 닫을 때까지 계속 받음)/"응답자 이름 입력받기" 체크박스 + 문항 편집기(문항마다
    라벨/유형(단일 선택·복수 선택·주관식)/선택지(유형이 주관식이 아닐 때만, 한 줄에
    하나씩)/필수 응답 체크박스, "+ 문항 추가"로 늘림) — 타이핑마다 다시 그리지 않고
    구조가 바뀔 때(유형 변경·추가·삭제)만 `renderQuestionsEditor()`를 다시 부르는,
    이 저장소의 기존 델리게이트 편집기 관행(`classroom_layouts`/`chatbot-builder.html`
    활동 탭 설계기와 같은 원칙)을 그대로 따랐다. 목록의 각 설문 카드는 진행중/마감
    뱃지, 문항·응답 개수, "🔗 링크 복사"(`collect.html`의 `.btnCopyItemLink`와 같은
    "복사됨!" 1.5초 라벨 교체 패턴), "📊 결과 보기"(인라인 아코디언, 첫 클릭 때만
    `public_survey_responses`를 가져와 캐시 — 이미 가져온 설문은 재조회 없이 토글만),
    "엑셀로 다운로드"(`xlsx@0.18.5`, 제출시각/이름(수집 시)/문항별 답변 한 줄씩),
    "닫기"/"다시 열기"(`is_closed` 토글), "삭제"(`confirm()` 후 설문 row만 지우면
    `on delete cascade`로 응답도 함께 삭제됨)를 제공한다. "결과 보기"는 단일/복수
    선택 문항은 선택지별 응답 수 + 퍼센트 막대(순수 `<div>` width%, 차트 라이브러리
    없음), 주관식 문항은 답변을 그대로 나열, 이름을 수집한 설문이면 맨 아래에
    응답자 이름 목록을 보여준다.
  - **공개 응답 화면**: `public_surveys`를 `?id=`로 조회해(로그인 없이도 열린 select라
    바로 됨) 없으면 "설문을 찾을 수 없어요", `is_closed`이거나 `closes_at`이 지났으면
    "마감됐어요" 안내만 보여주고 폼 자체를 렌더링하지 않는다. 열려 있으면 이름(수집
    설정 시)+문항별 입력(단일=라디오, 복수=체크박스, 주관식=textarea, 필수는 라벨
    옆에 빨간 `*`)을 렌더링 — 제출 시 필수 항목 중 비어있는 게 있으면 그 문항 이름을
    콕 집어 에러 메시지를 보여주고 막는다. 제출 성공 시 `public_survey_responses`에
    insert하고, **`localStorage['ks_survey_responded_<id>']`로 소프트 가드**를
    남긴다(하드 유니크 제약 없음 — 이 저장소의 일반적인 "소프트 가드, 강제 보안
    아님" 원칙 그대로, `room-booking.html`의 여러 "이 브라우저에서만 기억하는 선호"
    들과 같은 수준). 같은 브라우저로 다시 열면 그 가드를 보고 "이미 응답하셨어요"
    화면으로 바로 넘어가고, "다시 응답하기" 버튼을 누르면 그 로컬 플래그만 지우고
    폼을 다시 보여준다(서버 쪽에는 중복 제출을 막는 어떤 제약도 없음 — 이 소프트
    가드가 유일한 저지선이라는 걸 분명히 해둔다).
- **다른 모든 ks-app 사이드바 페이지와 똑같은 머리말/사이드바를 그대로 복붙해 썼다**
  (`school-status.html`/`room-booking.html` 등이 이미 쓰고 있는, 2025년 말 "새
  사이드바/상단바 디자인 롤아웃"(커밋 `1a1e431` 등) 이후의 표준 레이아웃 —
  `.ks-app`/`.ks-sidebar`/`.ks-topbar`/`.ks-content-inner` + 맨 아래의 공용 wiring
  스크립트(검색창 클릭 시 `nav.js`의 실제 🔍 검색 모달을 대신 열어주기, 모바일
  햄버거 토글, 로그인 배지, 공지사항 티커) — **36개 페이지에 이미 똑같이 박혀있는
  마크업이라, 한 곳을 고치면 전부 따로 고쳐야 하는 복붙 관행이 여기도 그대로
  적용된다.** 공개 응답 화면도 예외 없이 이 사이드바를 그대로 보여준다 — `collect.
  html?id=`가 비회원 제출자에게도 똑같은 사이드바를 보여주는 것과 같은 선택이다
  (교사 전용 내부 도구 사이트라, 링크를 받는 사람도 대개 교사일 가능성이 높고,
  로그인 안 한 방문자는 그 사이드바의 로그인 배지가 그냥 "로그인" 링크로 보일 뿐
  내부 정보가 새는 건 아니다).
- **`DEFAULT_NAV_ITEMS`(햄버거 메뉴/`index.html` 타일)에는 넣지 않았다** — 새
  사이드바 디자인은 36개 페이지에 하드코딩으로 복붙돼 있어서, 거기 새 항목 하나를
  넣으려면 이론상 36개 파일의 사이드바를 전부 손으로 맞춰야 한다(지금 당장은 그렇게
  하지 않음). 대신 `grade-estimate.html`/`mock-interview.html`/`korean-inquiry.html`
  과 같은 최근 관행 — "교무 업무 도구"(`admin-tools.html`) 허브의 평범한(관리자
  전용 아님) `tool-card` 하나 + `nav.js`의 `EXTRA_SEARCH_ITEMS`(`adminOnly` 없음,
  `loginRequired: true`) — 로 노출해서, 승인된 교사라면 누구나 🔍 전체 검색이나
  교무 업무 도구 타일 그리드로 찾을 수 있게 했다. 사이드바에는 그 어떤 페이지에도
  "설문조사" 항목이 없는 대신, `korean-inquiry.html`/`grade-estimate.html`과 같은
  방식으로 `survey.html` 자신의 사이드바에서 "교무 업무 도구"(`admin-tools.html`)
  항목에 `active` 클래스를 줘서 가장 가까운 상위 허브를 표시해뒀다.
- Playwright로(`supabase-js`를 전부 자체 구현한 가짜 쿼리 빌더로 교체 — insert/
  update/delete가 실제로 메모리 테이블을 변형하는, `TABLES` 객체 기반의 범용
  스텁) 검증했다: 관리 화면에서 설문 생성(문항 2개, 단일선택+주관식) → 목록에
  뜸 → 닫기/열기 토글 → 결과 보기(선택지 막대 + 주관식 답변 + 응답자 이름 모두
  렌더링) → 삭제(응답도 cascade로 같이 지워짐); 비로그인은 gateView, 로그인했지만
  미승인이면 pendingView; 공개 응답 화면에서 필수 복수선택 문항을 비우고 제출하면
  에러로 막히는지, 정상 제출 시 정확한 `answers` payload로 insert되는지, 제출 후
  localStorage 가드가 걸리는지, 새로고침해도 "이미 응답" 화면이 바로 뜨는지,
  "다시 응답하기"로 가드가 풀리고 폼이 다시 뜨는지; 마감된 설문은 폼 없이 마감
  안내만 보이는지, 존재하지 않는 id는 "찾을 수 없어요"로 처리되는지 — 모두
  확인했다.

## `survey.html` — 기간을 "yyyy-mm-dd hh:mm ~ yyyy-mm-dd hh:mm"로, 만들자마자 링크+복사 버튼 표시

사용자 요청: "설문조사 기간은 yyyy-mm-dd hh:mm ~ yyyy-mm-dd hh:mm 양식으로. 설문조사에는
설문별 링크를 생성해주고 링크복사 버튼 만들어줘." 두 번째 요구(설문별 링크+복사 버튼)는
이미 목록의 각 설문 카드에 "🔗 링크 복사" 버튼으로 구현돼 있었지만, **설문을 막 만든
직후에는 그 링크가 바로 안 보이고 "아래 목록에서 복사하세요"라는 안내만 뜨는** 간접적인
흐름이었다 — `collect.html`이 제출함을 만들자마자 `.link-copy-box`로 링크를 바로
보여주는 것과 비교해 한 단계 더 거쳐야 했으므로, 그 패턴을 그대로 가져와 더 직접적으로
만들었다.

- **`public_surveys.opens_at`**(새 컬럼, `timestamptz not null default now()`) 추가 —
  기존엔 `closes_at`(마감, nullable)만 있어서 "기간"이 아니라 "마감일" 하나뿐이었다.
  이제 모든 설문이 시작 시각을 갖고, 마감은 여전히 선택(비우면 "직접 닫을 때까지
  계속 받음" — 이 동작은 그대로 유지).
- **생성 폼의 "마감일"(`<input type="date">`, 날짜만)을 "설문 기간"(`<input
  type="datetime-local">` 두 개, `~`로 연결) 한 줄로 바꿨다** — `#sOpens`(시작일시,
  폼을 열 때마다 `toDatetimeLocalValue(new Date())`로 "지금"이 기본값으로 채워짐 —
  관리자가 미래 시각으로 바꾸면 그 시각부터 열리는 "예약 발행"이 된다)와
  `#sCloses`(마감일시, 비워두면 그대로 `null`). 저장 시 `closes_at`이 있는데
  `opens_at`보다 빠르면 "마감일시는 시작일시보다 늦어야 해요"로 막는다.
- **"진행중"/"마감" 2단계였던 상태가 "예정"(아직 `opens_at` 전)/"진행중"/"마감"
  3단계로 늘었다** — 관리 목록의 뱃지(`.survey-badge.scheduled`, 스탬프색)와 공개
  응답 화면 둘 다 이 3단계를 똑같이 반영한다. 공개 응답 화면은 `opens_at`이 아직
  안 됐으면 **마감과는 별개의 안내**("이 설문은 아직 시작 전이에요. <시작 시각>부터
  응답을 받아요")를 보여주고 폼 자체를 그리지 않는다 — 마감 메시지 체크보다
  먼저 검사해서, 둘 다 해당하는 경우(이론상 없지만) "시작 전" 쪽이 우선한다.
  목록의 "닫기"/"다시 열기" 토글 버튼은 여전히 `is_closed`(관리자가 수동으로 끈
  플래그)만 기준으로 동작한다 — 시간 경과로 자동 마감된 경우와 구분해서, "닫기"를
  누른 적 없는 설문은 항상 "닫기" 라벨이 뜨도록 했다(`notYetOpen`/시간 기반
  `timeClosed`는 뱃지 표시에만 반영하고 버튼 상태에는 안 섞음 — 섞으면 "아직
  시작도 안 했는데 '다시 열기'가 뜨는" 혼란스러운 조합이 생길 수 있었다).
- **`fmtYmdHm(iso)`**(새 함수, `yyyy-mm-dd hh:mm` — 24시간제, 0 패딩)와
  **`fmtPeriod(opensIso, closesIso)`**(`"<시작> ~ <마감>"`, 마감이 없으면
  `"<시작> ~ (상시)"`)를 추가했다 — 기존 `fmtDateTime()`(점 구분, 다른 곳에
  이미 쓰이던 포맷)은 그대로 두고 건드리지 않았다. 목록의 메타 줄이
  `· 기간 ${fmtPeriod(...)}`로 이 정확한 포맷을 보여준다.
- **설문을 만들면 바로 링크+복사 버튼이 뜬다.** `collect.html`의 `.link-copy-box`
  스타일을 그대로 가져온 `#createdLinkBox`(readonly 입력칸 + "🔗 링크 복사" 버튼)가
  입력 폼 바로 아래, **폼을 접어도(= `#createForm`이 `display:none`이 돼도) 같이
  사라지지 않는 자리**에 있다 — 저장 성공 시 `insert().select('id').maybeSingle()`
  로 돌려받은 새 id로 `shareUrl(id)`를 채워 보여준다. "+ 새 설문 만들기"를 다시
  눌러 폼을 여는 순간(`resetCreateForm()`이 호출될 때) 이 박스를 다시 숨긴다 —
  다음 설문을 만드는 동안 직전 설문의 링크가 헷갈리게 남아있지 않도록. 복사
  버튼은 `collect.html`의 "복사됨!" 1.5초 라벨 교체 패턴을 그대로 썼다.
- `test_survey.js`에 새 검증을 추가했다 — (1) 시작일시 입력칸이 "지금"으로
  미리 채워지는지, (2) 시작(과거)/마감(미래) 날짜로 저장하면 `opens_at`/
  `closes_at`이 타이핑한 값 그대로 ISO로 저장되는지, (3) 저장 직후
  `#createdLinkBox`가 바로 보이고 그 안의 링크가 방금 만든 설문의 `?id=`와
  일치하는지, (4) "링크 복사" 버튼을 누르면 실제 클립보드에 같은 링크가 써지는지,
  (5) 목록 메타 줄이 정확히 `yyyy-mm-dd hh:mm ~ yyyy-mm-dd hh:mm` 포맷으로
  나오는지, (6) "+ 새 설문 만들기"를 다시 누르면 직전 링크 박스가 사라지고
  시작일시도 새로 리셋되는지, (7) 아직 시작 전(`opens_at`이 먼 미래)인 설문은
  공개 화면에서 "시작 전" 안내만 뜨고 폼이 없는지, 관리 목록에서는 "예정" 뱃지가
  뜨는지 — 모두 확인했다. 기존 테스트(생성/목록/닫기·열기/결과 보기/삭제/게이트
  3종/응답 제출·소프트 가드/마감·존재하지 않는 id)도 전부 다시 돌려 회귀가
  없음을 확인했다.

## `staff-edit.html` — "전체 교사 시간표 일괄 업데이트"에도 양식 다운로드 버튼 추가

사용자 요청: "전체교사 시간표 업로드도 양식 파일 만들어서 다운받을 수 있게 해줘." 같은
카드의 위쪽에 있는 "교직원 명렬" 업로드는 이미 "엑셀 양식 다운로드"(기존 명렬을 미리
채워서 내려주는, `room-booking.html`에서 시작된 관행)가 있었는데, 바로 아래의 "전체
교사 시간표 일괄 업데이트"(교실×요일·교시 그리드 파일 업로드, `parseScheduleGridSheet()`)
에는 그 짝이 없어서 매번 교무실에서 받은 파일의 정확한 칸 구조(1행=요일, 2행=교시,
1열=순번, 2열=교실, 칸마다 "과목\n교사")를 처음부터 손으로 맞춰 만들어야 했다.

- **`buildScheduleGridTemplateRows()`**(새 함수) — `parseScheduleGridSheet()`가
  읽는 모양을 그대로 거꾸로 만든다. 이미 화면에 로드돼 있는 `scheduleTeachers`
  (교사별 시간표 편집 섹션이 페이지 진입 시 `public_staff`에서 불러와 둔 `{name,
  schedule}` 배열 — 별도 재조회 없이 그대로 재사용)를 훑어 등장하는 모든 교실을
  모으고(숫자 교실 먼저 오름차순, 그다음 문자 교실 가나다순 — `room-booking.html`의
  엑셀 양식이 교실을 정렬하는 방식과 같은 원칙), 교실×요일×교시 조합마다
  `"과목\n교사명"`으로 역색인해서 채운다. 교실이 하나도 없으면(막 만든 사이트라
  아무 시간표도 없는 경우) `['201', '컴퓨터실']` 예시 두 줄만 내려준다 — 교직원
  명렬 양식이 데이터가 없을 때 예시 한 줄을 내려주는 것과 같은 관행.
- **`public_staff`는 누구나 읽을 수 있는 공개 뷰라 별도 RPC 없이 바로 읽을 수
  있다** — 교직원 명렬(이름/부서/연락처 등 개인정보 포함)이 `staff` 테이블 자체를
  admin만 직접 읽을 수 있어 `staff_roster_list_for_edit` RPC(공용 비밀번호 검증)를
  거쳐야 했던 것과 다르다. 시간표 데이터만 보면 개인정보 민감도가 낮아, 이 테이블은
  처음부터 `teacher.html`/`teachers.html` 등 여러 페이지가 로그인 없이도 바로
  조회하는 공개 뷰로 설계돼 있었다 — 그래서 이 양식 다운로드 버튼도 그 열린 뷰를
  그대로 쓸 뿐, 새 RPC나 새 권한 체크가 전혀 필요 없었다.
- "전체 교사 시간표 일괄 업데이트" 카드의 파일 입력(`#bulkSchedInput`) 바로 왼쪽에
  "엑셀 양식 다운로드"(`#btnDownloadSchedGridTemplate`) 버튼을 추가했고, 카드
  안내문에도 "이 양식 그대로 없으면 아래 '엑셀 양식 다운로드'로 내려받아 채워서
  올리세요" 한 문장을 덧붙였다.
- Playwright로 `XLSX.writeFile`을 가로채 실제로 내려받으려던 워크북을 캡처한 뒤,
  그 내용을 `parseScheduleGridSheet()`와 똑같은 로직(테스트 쪽에 복제)으로 다시
  읽어 **왕복 검증**했다 — (1) 두 교사·세 칸짜리 샘플 시간표로 양식을 만들면
  등장한 교실 3개(201, 305, 컴퓨터실)가 숫자 먼저 정렬돼 행으로 나오는지,
  (2) 그 양식을 다시 파싱하면 충돌 없이 원본과 정확히 같은 과목/교실/교사가
  복원되는지(5칸 전부, 유령 데이터 없이), (3) 등록된 시간표가 전혀 없을 때는
  `201`/`컴퓨터실` 예시 두 줄만 내려주는지 — 모두 확인했다.

## `survey.html` — "파일 첨부" 문항, 비회원도 로그인 없이 파일을 올릴 수 있는 설문 응답

사용자 요청: "파일 제출도 그렇게 만들 수 있나? 설문이랑 같은 페이지내에?" + "이건
비회원용"(로그인하지 않은 응답자도 파일을 첨부할 수 있어야 한다는 뜻). `collect.html`
(제출함)로 따로 보내는 대신, 기존 설문의 `questions` 스키마에 `type: 'file'`을 네
번째 문항 유형(단일 선택/복수 선택/주관식/**파일 첨부**)으로 추가해, 같은 설문 응답
흐름 안에서 "이 문항에는 파일을 첨부해주세요"가 자연스럽게 섞일 수 있게 했다 — 별도
페이지/별도 응답 테이블 없이, 파일 첨부 문항도 다른 문항과 똑같이 `public_surveys.
questions`/`public_survey_responses.answers`에 그대로 들어간다(값의 모양만 문자열/
문자열배열이 아니라 `[{id,name,url}]` 객체 배열이라는 점이 다를 뿐).

- **파일 실물은 Supabase가 아니라 구글 드라이브에 저장한다** — `collect.html`/
  `file-library.html`/`room-booking.html`이 이미 공유하는 그 Apps Script 배포
  (`SCRIPT_URL`, 동일한 값을 `survey.html`에도 그대로 복붙)에 새 액션
  `surveyUploadFiles`를 추가했다. "경성고 설문조사 첨부파일"이라는 루트 폴더를 최초
  1회 lazy 생성(`getOrCreateSurveyRootFolder_`, `SURVEY_ROOT_FOLDER_ID` 스크립트
  속성)하고, 그 아래 설문 id(`public_surveys.id`, uuid 문자열)별로 하위 폴더를 하나씩
  자동으로 만든다(`getOrCreateSurveyFolder_`) — Supabase 쪽에 folder id를 저장할
  컬럼이 필요 없다(폴더 이름 자체가 설문 id). `saveFilesToFolder`를 그대로 재사용해
  파일명 앞에 `"[문항 라벨] "`을 붙여서(예: "[포트폴리오 파일] report.pdf"), 한 설문에
  파일 첨부 문항이 여러 개여도 드라이브 폴더만 열어봐도 어느 문항 것인지 구분된다.
  **이 액션은 매니저 비밀번호/로그인 토큰 확인이 전혀 없다** — 설문 자체가 비회원
  응답을 전제로 설계됐으므로, `verifyManager`/`verifySubmitter`를 거치는 다른
  uploadFiles류 액션들과 다르게 `surveyId`만 받으면 그대로 저장한다.
- **클라이언트(`survey.html`)**: `fileToBase64`/`filesToPayload`/`uploadSurveyFiles`
  (collect.html의 `driveApi`/`fileToBase64`/`filesToPayload`와 거의 동일한 모양 —
  `{action:'surveyUploadFiles', surveyId, questionKey, questionLabel, files:[{name,
  mime,data(base64)}]}`로 POST, `{ok:true, files:[{id,name,url}]}`를 돌려받음)를 새로
  추가했다. 응답 제출 핸들러는 **먼저 모든 문항을 검증(필수 여부, 파일 개수/크기)한
  뒤에만** 파일 첨부 문항마다 순서대로 업로드를 호출하고, 그 결과 배열을 그대로
  `answers[문항 key]`에 담아 `public_survey_responses`에 저장한다 — 업로드가 끝나기
  전에는 네트워크 요청이 전혀 나가지 않으므로, 필수 입력이 빠졌거나 파일이 너무 크면
  업로드 자체가 시도되지 않는다. `MAX_FILES_PER_Q = 5`(문항당 파일 개수), `MAX_FILE_
  SIZE = 15MB`(파일당 크기) — 비회원이 아무 제한 없이 올릴 수 있게 두면 공유 Apps
  Script 배포(다른 모든 페이지가 함께 쓰는 것) 자체에 부담을 줄 수 있어 둔 안전장치다.
  한도를 넘으면 그 문항 이름을 콕 집어 에러로 알려주고 업로드를 전혀 시도하지 않는다.
- **문항 편집기**(관리 화면): "파일 첨부" 유형을 고르면 선택지 textarea가 사라지고
  "응답자가 파일을 첨부하는 문항이에요 — 선택지는 필요 없어요" 안내만 보인다 — 저장
  시 선택지 필수 검증(`badOpt`)도 단일/복수 선택 유형에만 적용되도록 좁혔고, 저장되는
  `options`도 파일/주관식 유형이면 항상 빈 배열로 비운다.
- **공개 응답 화면**: 파일 첨부 문항은 `<input type="file" multiple>` + "파일당 15MB
  이하, 문항당 최대 5개까지 첨부할 수 있어요" 안내로 렌더링된다. 제출 중 파일을 올리는
  동안 "파일 올리는 중… (\"문항 라벨\")"으로 진행 상태를 보여준다.
- **결과 보기**(관리 화면 "📊 결과 보기"): 단일/복수/주관식과 나란히, 파일 첨부 문항은
  응답마다(이름 수집 시 응답자 이름, 아니면 제출 시각) 첨부된 파일명을 클릭 가능한
  드라이브 링크로 나열한다(`target="_blank"`) — 아무도 파일을 안 첨부했으면 "제출된
  파일 없음".
- **엑셀로 다운로드**: 파일 첨부 문항 칸은 "파일명 (드라이브URL)"을 파일마다 한 줄씩
  줄바꿈으로 이어붙인다(korean-inquiry.html의 메모/대화 내용 칸과 같은 "여러 항목은
  줄바꿈으로" 관행) — 다른 문항 칸(쉼표로 합치는 복수 선택 등)과는 별도 분기.
- `collect-setup.md`에 "## 10. survey.html의 '파일 첨부' 문항" 섹션을 추가해 위
  Apps Script 변경을 문서화했다 — **다른 모든 신규 액션과 같은 이유로, 이 코드는 6번
  Code.gs 안에 이미 포함되어 있을 뿐 실제로 동작하려면 스크립트 편집기에 반영한 뒤
  배포 → 배포 관리 → 수정 → 새 버전으로 재배포해야 한다.** 이 환경은
  `script.google.com`/`drive.google.com`으로의 아웃바운드가 막혀 있어 실제 업로드
  성공 여부(재배포 후 실제로 드라이브 폴더가 생기는지 등)까지는 이 환경에서 직접
  확인할 수 없다.
- Playwright(Apps Script 엔드포인트를 `page.route()`로 가짜 응답하는 방식 — 실제
  `script.google.com` 호출 없이 클라이언트 쪽 로직만 검증)로 (1) 필수 파일 문항을
  비운 채 제출하면 막히는지, (2) 파일 1개를 첨부해 제출하면 정확한 `surveyId`/
  `questionKey`/`questionLabel`/base64 페이로드로 업로드가 호출되고, 선택 문항(파일
  없음)은 업로드 자체가 안 일어나는지, (3) 저장된 응답의 파일 답은 `[{name,url}]`
  객체 배열이고 단일 선택 답은 평범한 문자열인지, 파일을 안 첨부한 선택 문항은 answers
  에 그 key 자체가 없는지, (4) 편집기에서 유형을 "파일 첨부"로 바꾸면 선택지 입력이
  사라지고, 라벨만 입력해도(선택지 없이) 저장이 성공하는지, (5) 결과 보기에서 파일
  응답이 실제 드라이브 링크(`<a href>`)로 렌더링되는지, (6) 15MB를 넘는 파일이나 5개를
  초과하는 첨부는 업로드 호출 자체 없이 에러로 막히고, 정확히 5개(한도)는 정상
  제출되는지, (7) 엑셀 내보내기의 파일 칸이 "파일명 (URL)"을 줄바꿈으로 이어붙여
  보여주고 다른 문항 칸(단일 선택)은 그대로 평문으로 나오는지 — 모두 확인했다. 기존
  `test_survey.js`의 32개 기존 단언도 다시 돌려 회귀가 없음을 확인했다.

## 메시지함 — 메뉴/검색에서 완전히 숨김 + `my-page.html`의 메시지함 블록 제거 + 관리자 비밀번호(제출함 마스터 비밀번호)를 `admin-tools.html`로

사용자 요청: "메시 기능은 메뉴에서는 지우고 숨겨두자. 그러면 나의 페이지에 있는 메시지함
기능도 빼줘." ("메시"는 "메시지(함)"의 축약). `messages.html` 자체는 지우지 않았다 —
직접 URL로는 여전히 열리지만, 그 어떤 메뉴/검색 경로로도 더 이상 찾을 수 없게 했다.

- **`nav.js`**: `EXTRA_SEARCH_ITEMS`에서 `messages.html` 항목(`label: '메시지함'`)을
  완전히 제거했다 — 🔍 전체 검색에서도 더 이상 찾을 수 없다. `admin-tools.html`
  자신의 `DEFAULT_NAV_ITEMS` 항목(`desc`)과 `admin-tools.html`/`index.html`의 소개
  문구에서도 "메시지함"이라는 단어를 빼서, 더 이상 노출되지 않는 기능을 설명에
  나열하는 일이 없게 했다.
- **`admin-tools.html`**: "메시지함" `tool-card` 자체를 지웠다 — 이 페이지가
  messages.html의 유일한 top-level 진입점이었으므로(이 저장소의 최근 관행 — 관리자
  전용 아닌 평범한 도구는 top-level 메뉴 대신 이 허브의 타일 하나로만 노출), 이 타일을
  지우는 것만으로 메뉴 경로가 완전히 사라진다.
- **`my-page.html`**: "메시지함" 블록(`#blockMsgInbox` — 분류된 메시지 최근 순 미리보기
  + AI 요약 카드) 전체를 지웠다 — HTML(`#blockInfoGroup` 안의 하위섹션), 전용 CSS
  (`.mi-*`/`.mi-sum-*`, 36줄), JS(섹션 "1.5) 메시지함", `loadMsgInboxWidget()` 정의+초기
  로드 호출) 모두 제거. "나의 정보" 블록(`#blockInfo`, 같은 `#blockInfoGroup` 안의 다른
  하위섹션)은 전혀 손대지 않았다 — 그 둘이 한 `dash-frame` 안에 같이 들어있었을 뿐,
  서로 독립된 섹션이다. `my-custom-page.html`(대시보드)의 "메시지함"/"메시지함 요약"
  위젯 타입은 **이번 요청 범위 밖**이라 그대로 남겨뒀다 — 사용자가 명시적으로 "나의
  페이지"만 짚었고, 대시보드는 사용자가 직접 위젯을 골라 배치하는 페이지라 메뉴에서
  숨긴 것과는 다른 성격이다.
- **`admin-tools.html`에 "🔑 관리자 비밀번호 (제출함 마스터 비밀번호)" 관리 카드를
  새로 추가**했다 — 사용자 요청: "관리자 비밀번호 변경 기능을 교무 업무 도구 하위에
  두면 좋겠는데". `collect.html`의 매니저 로그인 힌트("관리자 비밀번호를 알고
  계시면...")가 가리키는 바로 그 설정(`collect_settings` 테이블, `set_collect_master_
  password`/`clear_collect_master_password`/`collect_master_password_is_set` RPC —
  이 문서 위쪽의 "마스터 비밀번호" 섹션 참고)을 **collect.html을 거치지 않고도** 교무
  업무 도구 허브에서 바로 바꿀 수 있게 한 것 — collect.html 쪽의 기존 "🔑 마스터
  비밀번호 관리" 토글/카드는 그대로 남겨뒀다(같은 RPC/테이블을 공유하므로 어느 쪽에서
  바꿔도 즉시 서로 반영된다 — 이 저장소의 "중복 경로를 허용하고 위험한 공유-게이트
  리팩터링은 피한다" 원칙 그대로). 이 카드는 **진짜 `is_admin` 로그인 계정에게만**
  보인다(`setVisible(admin)`과 같은 async 확인 타이밍에 같이 드러남) — staff-edit.html
  타일을 여는 "공용 편집 비밀번호"(`shared_edit_settings`)로는 열리지 않는다 — 제출함
  전체를 열 수 있는 비밀번호라 그보다 더 민감한 권한으로 취급했다.
- `test_admintools_pwcard_and_messages_removed.js`(Playwright, 관리자/비관리자 두
  케이스)로 (1) messages.html 타일이 관리자 여부와 무관하게 완전히 사라졌는지, (2)
  헤더 소개 문구에 "메시지함"이 더 이상 없는지, (3) 관리자 비밀번호 카드가 `is_admin`
  여부와 정확히 일치하게 보이는지, (4) 관리자 계정에서 저장/상태 갱신/입력칸 초기화가
  올바른 RPC 호출로 이어지는지, (5) 4자 미만 비밀번호는 RPC 호출 없이 바로 막히는지,
  (6) "끄기"가 확인 후 정상 동작하고 상태가 다시 "설정 안 됨"으로 바뀌는지 — 모두
  확인했다. `test_mypage_messages_removed.js`로 (7) `#blockMsgInbox`와 그 안의 모든
  id(`#miMsg`/`#miArea`/`#miList`/`#miSumBtn`/`#miSumSaved`)가 DOM에서 완전히
  사라졌는지, (8) "나의 정보"/"나의 시간표" 블록은 영향 없이 그대로 렌더링되는지,
  (9) 이 제거로 인한 새 JS 예외가 없는지(막힌 CDN으로 인한 기존 `msal` 오류는 수정
  전 코드에서도 동일하게 발생함을 직접 대조 확인 — 이번 변경과 무관) — 모두 확인했다.
  기존 `test_survey.js`의 40개 단언도 다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` 상단 헤더 — 4줄 레이아웃(제목/설명/아이콘/마지막 설명)으로 재배치

사용자가 와이어프레임 이미지와 함께 "첫번째줄 제목, 두번째줄 설명, 세번째줄 각종 아이콘,
네번째줄 마지막 설명으로 배치"를 요청했다 — 대상은 "AI 모의면접 분석 맨 상단부분"
(`mock-interview.html`의 `<header>`)이라고 확인받았다. 기존 헤더는 왼쪽에 아이콘+제목+
설명+배지를 한 묶음으로, 오른쪽에 5개 액션 아이콘(저장/불러오기/목록 관리/샘플 채우기/
전체 초기화)을 `grid grid-cols-3`로 배치한 **가로 2단 구성**이었는데, 이를 **세로 4줄**
(`flex flex-col items-center text-center`)로 재배치했다:
1. **제목** — `<h1>`(마이크 아이콘 + "AI 모의 면접 분석").
2. **설명** — "끊김 없는 전체 녹음 + 실시간 타임스탬프 분할 방식".
3. **아이콘들** — 기존 5개 액션 버튼(저장/불러오기/목록 관리/샘플 채우기/전체 초기화)을
   `flex items-center justify-center gap-2.5`로 한 줄에 가로로 나열(기존 `grid-cols-3`
   대신).
4. **마지막 설명** — "⚡ 질문+답변 함께 녹음 → AI가 자동 분리" 배지.

`onclick`/`id` 전부 그대로 유지했으므로(`btnSaveReport`/`btnLoadReport`/
`loadSampleData()`/`resetAll()`/`openManageModal()`), `saveReport()`/
`setSaveButtonEnabled()` 등 기존 JS는 전혀 손대지 않았다 — 순수 레이아웃(마크업+
Tailwind 클래스) 변경뿐이다. 📂 불러오기 드롭다운(`#loadPanel`)은 이제 아이콘 줄이
가운데 정렬되므로 `absolute right-0`(기존, 오른쪽 끝 기준) 대신 `absolute left-1/2
-translate-x-1/2`(아이콘 줄 중앙 기준)로 위치를 맞췄다 — `toggleLoadPanel()`/
`closeLoadPanel()`은 `id`로만 찾으므로 이 위치 변경과 무관하게 그대로 동작한다.
`test_header_4row.js`(스크래치패드 전용)로 JS 예외가 없는지, 네 줄의 텍스트/버튼
개수가 정확한지, 그리고 네 줄의 실제 화면상 Y좌표가 제목<설명<아이콘<마지막 설명
순서로 쌓여 있는지(진짜로 위→아래 4줄인지)를 확인했다.


## `chatbot-builder.html`/`bot.html` 활동 필드 — 글자수 조건(최소/최대) + 학생 화면 실시간
## 카운터(조건 위반 시 빨간색)

사용자 요청: "수업용 챗봇 만들 때 학생 활동을 추가할 수 있잖아. 학생들이 입력하는 부분을
설계할 때 선생님이 글자 수 제한이나 글자 수 조건을 줄 수 있게 해주면 어떤가 싶고,
학생들이 작성할 때도 몇 글자인지 밑에 숫자로 나오게 해주면 좋을 것 같아. 그리고
선생님이 제시한 조건에 맞지 않은 글자수가 나오면 글자수를 빨간색으로 보여주고" — 이미
있던 "학생 활동지 설계(활동 탭+하위항목)" 기능(이 문서 위쪽 참고)에 글자수 조건을
얹었다. Artifact 목업(좌: 선생님 설계 화면에 최소/최대 입력칸, 우: 학생 화면의 정상/
위반 두 상태)으로 먼저 확인받은 뒤 그대로 구현했다.

- **데이터**: 새 컬럼 없이 `custom_bots.activity_schema`의 각 필드 객체에
  `minLength`/`maxLength`(둘 다 선택, 정수)를 추가했을 뿐이다 — 이 컬럼은 이미 jsonb라
  스키마 변경이 필요 없었고, `student-bot-chat` Edge Function의 `start`/`info` 액션
  (`normalizeActivitySchema()`)이 필드 객체를 키 화이트리스트 없이 통째로 돌려주고
  있어서 서버 쪽도 전혀 손대지 않아도 그대로 전달된다. **체크리스트 유형에는 이
  옵션이 없다** — 글자수라는 개념 자체가 텍스트/서술형에만 의미가 있어서다.
- **`chatbot-builder.html` 설계 화면**: `renderActivityFieldRow()`가 체크리스트가
  아닌 필드에는(기존에 옵션 textarea를 보여주던 그 `${f.type === 'checklist' ? ... :
  ...}` 분기의 else 쪽) "최소 글자수"/"최대 글자수" 숫자 입력칸 두 개(`actFieldMinLen`/
  `actFieldMaxLen`, 비워두면 그 쪽은 제한 없음)를 보여준다. `input` 이벤트 핸들러가
  값을 바로 `currentActivitySchema[ti].fields[fi].minLength`/`maxLength`에 쓰고(빈
  문자열이면 `null`), `sanitizeActivitySchema()`는 저장 시 `Number.isFinite()`인
  값만 실어 보낸다 — 비워두면 그 필드 객체에 `minLength`/`maxLength` 키 자체가 안
  생긴다(기본값 비교가 아니라 키 존재 여부로 "제한 없음"을 표현).
- **`bot.html` 학생 화면**: `activityLenInfo(f, value)`가 현재 글자 수와
  `f.minLength`/`f.maxLength`를 비교해 표시 문구("N자 / 최대자", 최대만 없고 최소만
  있으면 "N자 (최소 M자)", 둘 다 없으면 그냥 "N자")와 위반 여부를 계산한다.
  `renderActivityFields()`가 텍스트/서술형 필드마다 입력칸 바로 아래
  `.activity-char-row`(글자수 + 위반 시 사유 한 줄)를 함께 그리고, 타이핑할 때마다
  (`input` 이벤트) **전체를 다시 그리지 않고** `updateActivityCharCountUI()`가 그
  입력칸의 글자수 행만 갈아치운다 — `renderActivityFields()`를 통째로 다시 부르면
  커서 위치가 날아가기 때문(이 저장소의 "구조가 안 바뀌는 입력은 다시 그리지 않는다"
  기존 관행, `chatbot-builder.html`의 활동 설계 에디터 자체가 이미 쓰던 원칙과 동일).
  조건을 벗어나면(`invalid`) `.activity-char-row`와 입력칸(`<input>`/`<textarea>`)
  양쪽 모두에 `invalid` 클래스가 붙어 글자수 숫자·입력칸 테두리가 함께
  `var(--crest-red)`로 바뀐다 — 조건을 만족하면 평소처럼 회색.
- `test_chatbot_builder_charlimit.js`(새 테스트)로 (1) 기존에 저장된 min/max가
  편집기에 그대로 다시 채워지는지(왕복), (2) 체크리스트 유형에는 글자수 행이 전혀
  안 보이는지, (3) 저장 시 변경한 값이 정확히 반영되는지, (4) 값을 비우면 그 필드
  객체에서 키 자체가 빠지는지 — 모두 확인했다. `test_bot_charlimit_and_download.js`
  (아래 다운로드 테스트와 공유)로 (1) 빈 값일 때 초기 표시 문구 3종(최소+최대/최대만/
  제한없음)이 정확한지, (2) 범위 안으로 타이핑하면 즉시 회색으로 바뀌는지(자동저장과
  별개로 매 입력마다 즉시 반영), (3) 범위를 벗어나면 즉시 빨간색(행+입력칸 둘 다)으로
  바뀌고 사유 문구가 뜨는지, (4) 이 글자수 UI 갱신이 기존 디바운스 자동저장
  (`scheduleActivitySave`)을 전혀 방해하지 않는지 — 모두 확인했고, 기존
  `test_bot_activity_panel.js`/`test_chatbot_builder_activity_designer.js`/
  `test_chatbot_builder_regression.js`도 다시 돌려 회귀가 없음을 확인했다.

## `bot.html` 활동지 — "PDF로 저장"/"Word로 저장" 다운로드

사용자 요청: "학생용 챗봇에서 학생이 작성한 활동지 내용을 word나 pdf로 다운받을 수
있게 하는 기능도 가능?" — 가능하다고 답하고(PDF는 기존 `@media print` 관행 재사용,
Word는 `application/msword` MIME의 HTML 블롭을 `.doc`로 내려받는 흔한 트릭, 둘 다
새 외부 라이브러리 없음) Artifact 목업(좌: 활동지 패널 머리줄에 버튼 2개, 우: 다운로드
결과 미리보기)으로 먼저 확인받은 뒤 구현했다.

- **`activityExportBodyHtml()`**(공용 빌더, PDF/Word 둘 다 이 함수 하나를 재사용) —
  지금 메모리에 있는 `activitySchema`/`activityResponses`(자동저장 완료를 기다리지
  않음 — "작성 중에도 다운로드 가능"이라는 요청 그대로)로, 챗봇 제목+"활동지" 제목,
  학생 이름(학번)·오늘 날짜 메타 줄, 탭마다 제목+하위항목(텍스트/서술형은
  줄바꿈 보존, 체크리스트는 `✓`/`☐`)을 담은 인라인-스타일 HTML 문자열을 만든다.
  빈 서술형 필드는 "(작성하지 않음)"으로 보여준다(빈 문자열을 그대로 내려보내지
  않음). **학생 이름/학번**은 이번 방문에서 시작 화면(`#nameInput`/`#noInput`)에
  직접 입력했을 때만 `currentStudentName`/`currentStudentNo`에 채워진다 — 새로고침
  재접속(기존 sessionToken) 경로는 다시 묻지 않으므로 그 경우 메타 줄에서 조용히
  생략된다(알려진, 받아들인 공백 — 실제로 치명적이지 않다).
- **PDF**: `#activityPrintView`(평소 `display:none`, `.wrap`의 형제로 body 바로
  아래 둠)에 "PDF로 저장" 클릭 시 `activityExportBodyHtml()` 결과를 채우고
  `window.print()`를 호출한다. `@media print{ body > *:not(#activityPrintView){
  display:none !important; } #activityPrintView{ display:block !important; } }`가
  인쇄 시 채팅/메모 레이아웃 전체를 가리고 이 뷰만 보여준다 — `mock-interview.html`/
  `grade-estimate.html`이 이미 쓰는 "`@media print`로 화면 UI를 지우고 인쇄용
  콘텐츠만 남긴다"는 이 저장소의 관행을 그대로 따른 것(새 라이브러리 없음).
- **Word**: `downloadActivityWord()`가 `activityExportBodyHtml()`을 MS Office
  XML 네임스페이스(`xmlns:o="urn:schemas-microsoft-com:office:office"`,
  `xmlns:w="urn:schemas-microsoft-com:office:word"`)를 가진 완전한 HTML 문서로
  감싸, `Blob([...], {type:'application/msword'})`로 만들고 `<a download="...doc">`
  을 눌러 내려받게 한다 — Word는 이 MIME+HTML 조합을 그대로 `.doc`로 열어준다는
  잘 알려진 트릭이라, `docx` 같은 OOXML 생성 라이브러리를 새로 들여올 필요가
  없었다(활동지 내용이 단순 텍스트/체크리스트뿐이라 이 수준의 정확도면 충분하다고
  판단).
- 두 버튼(`#btnActivityDlPdf`/`#btnActivityDlWord`, `.activity-dl-btn.pdf`/`.word`
  — PDF는 장미색, Word는 파란색, 목업에서 미리 보여준 색 코딩 그대로)은 활동지
  패널 머리줄(`.activity-panel-head`)에 "학생 활동지" 제목과 나란히 놓인다 — 패널
  전체가 `activitySchema`가 비어있을 때 `display:none`이라(이 문서 위쪽 "학생 활동지
  설계" 섹션 참고) 탭이 하나도 설계 안 된 챗봇에서는 이 버튼들도 자연히 안 보인다.
- `test_bot_charlimit_and_download.js`로 (1) PDF 버튼이 `window.print()`를 정확히
  한 번 호출하는지, (2) 인쇄 뷰에 챗봇 제목·학생 이름/학번·탭 제목·현재 입력값(아직
  저장 전인 값 포함)·빈 필드의 "(작성하지 않음)" 문구가 모두 들어있는지, (3) Word
  버튼을 누르면 실제 다운로드 이벤트가 발생하고(Playwright의 `page.waitForEvent
  ('download')`로 포착) 그 파일 내용이 Word XML 네임스페이스를 포함한 HTML이며
  같은 제목/학생정보/현재 입력값을 담고 있는지 — 모두 확인했다. **파일명 검증에는
  이 샌드박스 환경만의 제약이 있다**: `a.download`에 한글이 들어가면 이 환경의
  헤드리스 Chromium이 `suggestedFilename()`을 "download"로 뭉개버린다는 걸
  직접 재현해 확인했다(같은 코드에 영문 파일명을 쓰면 정상적으로 ".doc" 그대로
  돌아옴) — 실제 브라우저에서는 한글 파일명이 문제없이 동작하는, 이 테스트 환경
  고유의 한계라 판단해 테스트는 ".doc로 끝남" 또는 "이 환경의 폴백인 'download'"
  둘 중 하나를 허용하도록 작성했다.


## `chatbot-builder.html` — "학생 활동지 설계" 탭 제목/레이블 입력칸이 모바일에서 카드 밖으로
## 삐져나오던 버그 (+ QR 로딩 재시도, "학생 대화 기록" 엑셀에 활동지 내용 포함 여부 확인)

사용자가 모바일 화면 스크린샷을 보내며 "수업용챗봇 만들기에서 이렇게 칸이 깨져서 나와"
라고 보고했다 — "활동1" 탭 제목 입력칸이 카드 테두리 밖으로 길게 삐져나온 모습.

**원인**: `.activity-tab-head input[type=text]`(탭 제목)와 `.activity-field-row-top
input[type=text]`(하위항목 레이블)가 둘 다 `flex:1`만 주고 `min-width:0`을 안 줬다 —
flex 아이템의 기본 `min-width`는 `auto`(= 콘텐츠가 요구하는 최소 너비)라서, 부모
플렉스 컨테이너가 그 콘텐츠 최소 너비보다 좁아지면(모바일 화면) `flex:1`이 있어도
줄어들지 못하고 그대로 넘쳐버리는, 잘 알려진 flexbox 함정이다. **고쳐서**
`min-width:0`과 `box-sizing:border-box`(패딩·테두리가 너비 계산에 포함되게)를 둘 다
추가했다 — 탭 제목 칸은 그대로 `flex:1`, 하위항목 레이블 칸은 `flex:1 1 140px`로
바꾸고 그 줄(`.activity-field-row-top`)에 `flex-wrap:wrap`도 추가해, 아주 좁은
화면에서는 유형 선택/삭제 버튼이 다음 줄로 자연스럽게 넘어갈 수 있게 했다(강제로
한 줄에 욱여넣지 않음).

**QR 코드 — 이미 만들어진 챗봇도 당연히 공유 링크+QR이 똑같이 뜬다.** 사용자가 "이미
만들어진 챗봇도 교사모드로 들어가면 링크랑 QR 만들수 있게 해줘"라고 요청했는데, 코드를
확인해보니 `renderEditor()`는 새 챗봇이든 기존 챗봇이든 `openEditor(botId)`를 거쳐
**똑같이** 호출되는 하나의 함수라, 공유 링크+QR 박스(`.share-box`)는 챗봇 목록에서
어떤 챗봇을 클릭해 열어도 편집기 맨 위에 이미 항상 떠 있었다 — 사용자가 스크린샷에서
보여준 "학생 활동지 설계"/"학생 대화 기록" 영역은 그 공유 링크+QR 박스보다 한참
아래라, 아마 스크롤해서 못 보셨을 가능성이 크다. 다만 코드를 다시 읽다가 QR 렌더링
자체의 실제 약점 하나는 발견해서 함께 고쳤다: `if(window.QRCode){ new QRCode(...) }`
가 **단 한 번만** 확인하고 그 순간 라이브러리가 아직 없으면 그냥 조용히 포기했다 —
`qrcodejs` CDN 스크립트가 느리거나 실패하면 QR 칸이 영영 빈 채로 남는다. `index.html`
의 `waitForSupabase()`와 같은 폴링 재시도 패턴(`renderShareQr(shareUrl, forBotId,
attemptsLeft)`, 200ms 간격 최대 25번=5초)으로 바꿔서, 라이브러리가 조금 늦게
로드되더라도 따라잡아 그려지게 했다 — `forBotId`로 그 사이 다른 챗봇으로 전환됐는지
확인해, 늦게 도착한 QR이 엉뚱한 챗봇의 `shareQrBox`에 그려지는 걸 막는다. CDN 자체가
완전히 실패(404 등)하는 경우는 여전히 조용히 포기한다(QR만 안 뜰 뿐 나머지 편집기는
정상 동작 — 이전과 동일한 성격의 성능 저하, 더 나빠지지 않음).

**"학생 대화 기록"의 "엑셀로 내려받기"는 이미 활동지 내용도 포함한다.** 사용자 질문:
"수업용 챗봇 만들기에서 학생 대화 다운받기가 있는데 그걸 다운받으면 학생의 활동지
내용 다운도 되는거야?" — 코드로 직접 확인: `exportSessionsToExcel()`의 열 머리글이
`['이름','학번','대화 시작','마지막 대화','메시지 수','대화 내용','메모 수','메모
내용','활동지 내용']`이고, 마지막 "활동지 내용" 열은 `formatActivityResponseLines()`
(활동 탭 응답을 탭 제목·레이블로 사람이 읽을 수 있게 풀어주는, "활동 보기" 모달과
공유하는 바로 그 함수)로 채워진다 — 즉 **이미 포함돼 있다.** 챗봇에 활동 탭을 설계해둔
경우에만 실제 내용이 들어가고(설계 자체가 없으면 "(설계된 활동 탭 없음)"), 설계된
챗봇이라면 대화 내용·메모·활동지 응답이 학생별 한 줄에 전부 한 번에 내려받아진다.

`test_chatbot_builder_qr_overflow.js`로 (1) 이미 만들어진(새로 만든 게 아닌) 챗봇을
열어도 공유 링크+QR이 정상적으로 뜨는지, (2) 다른 챗봇으로 전환해도 각자 자기 QR만
정확히 뜨고 이전 챗봇의 QR이 남아있지 않는지(캔버스가 쌓이지 않고 정확히 1개), (3)
QR CDN이 완전히 실패(404)해도 JS 에러 없이 나머지 편집기(공유 링크 등)는 정상
동작하고 QR 칸만 조용히 비어있는지, (4) 모바일 폭(390px)에서 탭 제목/하위항목
레이블 입력칸이 카드 경계를 넘지 않고, 페이지 전체에 가로 스크롤도 전혀 생기지
않는지 — 모두 확인했다. 기존 `test_chatbot_builder_activity_designer.js`/
`test_chatbot_builder_regression.js`/`test_chatbot_builder_charlimit.js`도 다시
돌려 회귀가 없음을 확인했다.


## `my-page.html`의 "나에게 배당된 할 일" 블록(`#blockAssignedBody`) — `task-assign.html`에서만
## 중복되는 안내문 숨김, 두 섹션 제목에 배경색 + 이름 변경("내가 요청한 업무"/"나에게 온 요청")

사용자가 `task-assign.html`(할 일 요청) 모바일 스크린샷을 보여주며 세 가지를 요청했다:
"네모 박스안 설명은 중복이니까 삭제. 내가 배정한 업무/나에게 온 업무 제목은 뒤에 행
배경색 넣어줘. 그리고 내가 요청한 업무/나에게 온 요청 이라고 제목 바꿔줘."

- **중복 안내문 삭제는 `task-assign.html`(위젯 모드)에서만** — `#blockAssignedBody` 맨
  위의 `<p class="hint">다른 사람에게 배정하거나, 나에게 온 업무를 확인해요. ...</p>`는
  `task-assign.html`이 iframe으로 그대로 보여주는 바로 그 블록인데, `task-assign.html`
  자신의 페이지 설명("다른 사람에게 업무를 배정하거나, 나에게 배정된 업무를 확인해요.
  나의 페이지의 '나에게 배당된 할 일' 블록과 완전히 같은 화면이라...")과 거의 같은
  내용이라 중복으로 보였다. `my-page.html`의 원래 대시보드 화면에서는 이 문구가 중복이
  아니므로(그 페이지엔 이런 바깥 설명문이 따로 없음) 양쪽 다 지우지 않고,
  `body.widget-mode #blockAssignedBody > .hint{ display:none !important; }`로
  **위젯 모드(=task-assign.html)에서만** 숨겼다 — 자식 결합자(`>`)를 써서, 훨씬 아래
  `#assignFileWrap` 안에 있는 또 다른 `.hint`(`#assignNcTargetHint`, 완전히 다른
  용도)는 건드리지 않는다. 이 `<p>`에는 이미 `body.widget-mode`에서 숨겨지던
  "전체 화면으로 보기 →" 링크도 같이 들어있어서(기존 `.assigned-fullpage-link` 규칙),
  위젯 모드에서는 결국 이 문단 전체가 비게 된다.
- **두 섹션 제목 행에 틴트 배경**: "내가 배정한 업무"/"나에게 온 업무" 제목을 감싸는
  `<div style="display:flex; ...">` 두 개에 `background:var(--stamp-soft);
  border-radius:6px; padding:5px 9px;`를 추가했다 — 이 페이지의 다른 곳(`table.tt th`,
  `.wp-summary`, `.ai-brief-block` 등)이 이미 구역을 구분할 때 쓰는 바로 그 톤이라
  새 색을 만들지 않고 재사용했다. 글자색도 `--ink-soft`에서 `--stamp`로 바꿔 배경과
  어울리게 했다.
- **제목 변경**: "내가 배정한 업무" → "내가 요청한 업무", "나에게 온 업무" →
  "나에게 온 요청" — 이 저장소의 "표시 텍스트만 바꾸고 내부 식별자는 그대로 둔다"
  관행 그대로, `id="assignedOwnedList"`/`id="assignedToMeList"`/
  `hiddenOwnedToggleWrap`/`hiddenToMeToggleWrap`과 그 아래 JS 변수·주석·함수명은
  전혀 손대지 않았다 — 이 두 제목은 정적 HTML 텍스트일 뿐 JS가 렌더링하는 문자열이
  아니라, `<span>` 안의 텍스트만 바꾸면 끝이었다. "완료된 항목 숨기기 (나에게 온
  업무만 해당)" 체크박스 라벨은 사용자가 명시적으로 "제목"만 짚어 요청한 범위 밖이라
  그대로 뒀다.

Playwright로 (1) `my-page.html`을 평소대로(위젯 아님) 열면 안내문이 그대로 보이고
새 제목 두 개가 모두 렌더링되며 옛 제목이 전혀 안 남아있는지, (2)
`?widget=blockAssignedBody`(= task-assign.html이 실제로 여는 URL)로 열면 안내문과
"전체 화면으로 보기" 링크가 둘 다 숨겨지는지, (3) 위젯 모드에서도 두 제목 행 모두
투명하지 않은 틴트 배경을 갖고 두 행의 배경색이 서로 일치하는지 — 모두 확인했다.


## 아이콘 리디자인 — `index.html`/`admin-tools.html`의 사이드바·타일·`nav.js` 햄버거 메뉴를
## "옅은 배경+이모지"에서 "단색 배경+흰색 선 아이콘"으로

사용자가 모바일 목업 스크린샷(단색 둥근사각 배지 + 흰색 선 아이콘 스타일)을 보여주며
"아이콘들을 이렇게 단색 배경에 흰색 그림으로 깔끔하게 해주는데 우선 레이아웃부터
보여줘"라고 요청했다 — 실제 파일을 건드리기 전에, Playwright로 `index.html`을 그대로
불러와 `page.evaluate()`로 아이콘만 메모리상에서 바꿔치기한 전/후 스크린샷을 먼저
보내 방향을 확인받았다. 승인 후 "아이콘 메인메뉴와 내비 메뉴, 하위 메뉴들까지 모두
적용"으로 범위를 넓혀 요청받았는데, "하위 메뉴"가 36개 페이지 전체(각 페이지에
복붙된 `.ks-sidebar`)를 가리키는지 확인이 필요해 `AskUserQuestion`으로 범위를
좁혔다 — 답변: **"위 둘 + 교무 업무 도구(admin-tools.html)까지"**. 즉 최종 범위는
`index.html` + `nav.js` + `admin-tools.html` 세 파일뿐, 나머지 ~34개 ks-app
사이드바 페이지(my-page.html, room-booking.html 등)는 건드리지 않는다.

**"내비 메뉴"가 실제로 가리키는 게 무엇인지부터 다시 확인해야 했다.** `nav.js`가
그리는 햄버거 드롭다운(`.gsnav-burger`+`.gsnav-list`)은 **37개 페이지(index.html,
admin-tools.html 포함)에서 `.gsnav-burger, .gsnav-home-btn, ...{ display:none
!important; }`로 이미 숨겨져 있다** — 이 37개 페이지는 각자 자기 `.ks-sidebar`를
들고 있어서, nav.js의 옛 플로팅 햄버거 메뉴 자체가 그 페이지들에서는 죽은 코드나
마찬가지다(실제로 쓰이는 건 모바일에서 `.ks-mobile-topbar`의 ☰ 버튼을 눌러 여는
`.ks-sidebar.ks-mobile-open` 드로어). 사용자가 보낸 모바일 목업도 index.html의
딱 그 구조(피처 카드+타일 그리드)를 보여준 것이었고, `.ks-sidebar`는 모바일에서
기본적으로 숨겨져 있다가 ☰로 열리는 바로 그 드로어다 — 그래서 **"내비 메뉴"는
nav.js의 옛 햄버거가 아니라 index.html/admin-tools.html 자신의 `.ks-sidebar`를
가리키는 것으로 해석했다.** nav.js의 `navItemHtml()`도 `.gsnav-burger`가 여전히
보이는 나머지 ~9개 미전환 페이지(bot.html, login.html, exam-generator.html,
mock-interview.html, exams.html 등)를 위해 함께 손봤다 — 비용이 적고 일관성에
도움이 되며, 이 요청의 원래 취지("내비 메뉴")와도 맞닿아 있다고 판단했다.

- **아이콘 라이브러리**: 외부 아이콘 폰트/라이브러리 없이, 24×24 viewBox의 인라인
  흰색-stroke SVG(`stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap=
  "round" stroke-linejoin="round"`)를 href로 키를 매겨 손으로 그렸다 — 이모지
  글자는 CSS `color`로 재색칠이 안 되므로("단색 배경+흰색 그림" 요구를 충족하려면
  이모지 자체를 SVG로 바꿔야 함), `<span class="icon">📅</span>` 같은 기존 정적
  HTML을 `<span class="icon"><svg>...</svg></span>`로 직접 치환했다(런타임 JS
  patch 없음 — "정적 HTML, 빌드 없음"이라는 이 저장소의 기조를 그대로 따름).
  `index.html`/`admin-tools.html`은 둘 다 **완전히 동일한 21개 항목짜리
  `.ks-sidebar`**(나의 페이지/대시보드/학교 현황 + 일정 그룹 5개 + 업무 도구
  그룹 15개)를 복붙해서 쓰고 있어서, 똑같은 href→SVG 매핑을 그대로 재사용할 수
  있었다 — Python 스크립트(`/tmp/.../scratchpad/apply_icons.py`, 커밋 대상
  아님)로 href를 기준 삼은 정확한 리터럴 문자열 치환을 자동화해, 손으로 50개
  이상의 Edit를 반복하는 대신 한 번에 정확하게 적용했다.
- **색상 — 기존에 이미 있던 하나의 톤을 "옅은 배경+진한 글자"에서 "진한 배경+흰
  글자"로 뒤집었을 뿐, 새 색을 더 만들지 않았다**: index.html의 4개 피처 카드
  (나의 페이지/날짜·교사로 보기/대시보드/학교 현황)는 원래부터 파랑/보라/초록/
  주황 네 가지(`--ks-primary`/`--ks-purple`/`--ks-green`/`--ks-orange`)로
  나뉘어 있었으므로 그 네 색 그대로 유지했고, 그 외(사이드바 21개 항목, 타일
  카드 17개)는 원래부터 전부 같은 톤(연한 인디고)을 공유하고 있었으므로 그대로
  단일 톤(`--ks-primary`, 진한 인디고+흰 아이콘)으로 뒤집었다. `admin-tools.html`
  의 타일 아이콘은 원래 그 페이지 고유의 구(舊) 팔레트(`--stamp`, 네이비 #264085)
  를 쓰고 있었는데, 이미 그 페이지의 `.ks-sidebar`/`.ks-topbar` 자체는 index.html
  과 똑같은 신규 인디고 토큰(`--ks-primary`)을 쓰고 있어서(사이드바 스킨만 새
  디자인이 먼저 적용돼 있던 상태) — 사이드바와 콘텐츠 영역의 색이 서로 다르게
  보이던 기존의 불일치를 없애기 위해 타일 아이콘도 같은 `--ks-primary` 인디고로
  맞췄다.
- **사이드바 배지 크기**: `.ks-nav-ico`를 `width:20px; font-size:16.3px;`(이모지
  글자 하나)에서 `width:22px; height:22px; border-radius:7px;
  background:var(--ks-primary); display:inline-flex;`로 바꿔, 13px 크기의
  SVG가 들어가는 작은 둥근 배지가 되도록 했다 — 타일/피처카드(38px/36px 배지,
  19px 아이콘)보다는 작지만 같은 "둥근 사각 배지" 모양 언어를 공유한다.
- **nav.js**: `navItemHtml()`이 이제 `NAV_ICONS[item.href]`가 있으면
  `<span class="gsnav-ico">`로 아이콘 배지를 라벨 앞에 붙인다(없으면 조용히
  생략 — 이 저장소의 "방어적 폴백" 관행) — `DEFAULT_NAV_ITEMS`의 모든 href가
  이미 매핑에 있어서(index.html/admin-tools.html과 같은 SVG 데이터를 재사용,
  `date.html`/`teacher.html`만 이 파일에만 있는 새 아이콘으로 추가 — index.html
  에서는 두 페이지가 "날짜·교사로 보기" 피처카드 하나로 합쳐져 있어 개별 아이콘이
  없었음) 빠지는 항목이 없다. `.gsnav-list li a`를 `display:block`에서
  `display:flex; align-items:center; gap:10px;`로 바꾸고 `.gsnav-ico`(22px,
  `var(--stamp, #264085)` — 이 파일이 쓰이는 옛 팔레트 페이지들과 어울리는 기존
  네이비 토큰, `.gsnav-group-head`가 이미 쓰던 것과 같은 fallback)를 추가했다.
  햄버거가 실제로 보이는 페이지(로그인·시험 생성기 등 아직 ks-app으로 전환 안 된
  ~9개)에서 Playwright로 직접 확인했다.
- `index.html`(데스크톱 전체 화면/모바일 ☰ 드로어), `admin-tools.html`(데스크톱),
  `nav.js`의 햄버거(`login.html`에서 재현) 네 가지 스크린샷으로 실제 렌더링을
  육안 확인했고, Playwright로 (1) 두 파일 다 이모지 텍스트가 `.icon`/`.ks-nav-ico`/
  `.ks-feature-icon` 안에 전혀 안 남아있는지(전부 `<svg>`로 치환됐는지), (2)
  `<svg`/`</svg>` 개수가 정확히 일치(균형)하는지, (3) index.html의 일정/업무
  도구 그룹 헤더와 17개 타일이 여전히 정상 렌더링되는지(nav.js의 HREF 기반
  타일 그룹핑 로직이 아이콘 내용 변경에 영향받지 않았는지), (4) admin-tools.html
  의 관리자 모드 버튼이 여전히 정상적으로 보이는지(JS 에러 없이), (5) nav.js
  햄버거의 모든 항목에 아이콘 배지+흰 svg가 붙어있고 라벨 텍스트도 그대로인지 —
  모두 확인했다.


## `my-page.html`의 "나에게 배당된 할 일" 블록 — 제목과 "업무가 없습니다" 빈 상태 문구의
## 글자 크기가 뒤바뀌어 보이던 버그

사용자 보고: "제목이 글씨가 작고 밑에 업무가 없습니다 라는 설명의 글씨가 더 커서 좀
이상해. 2개를 글씨 크기를 바꿔 줘." 바로 위 섹션에서 "내가 요청한 업무"/"나에게 온
요청"으로 이름만 바꿨던 두 제목(`<span style="font-size:13.3px; ...">`)이 명시적으로
13.3px로 고정돼 있었던 반면, 그 아래 빈 상태일 때 보이는 "배정한/배정된 업무가
없습니다."/"표시할 업무가 없습니다."(`<div class="hint" style="padding:0;">`)는 이
저장소의 `.hint` CSS 규칙 중 어느 것도 매치하지 않았다 — `.dash-block p.hint`/
`.card p.hint`는 `<p>` 태그를 요구하고 `#infoView .hint`는 다른 조상을 요구하는데,
이 네 곳은 전부 `<div class="hint">`라 어느 쪽에도 안 걸렸다. 그 결과 명시적 크기가
전혀 없어 `body`(이 페이지가 `font-size`를 따로 지정하지 않은, 브라우저 기본값
16px)의 글자 크기를 그대로 물려받았고, 공교롭게도 그 16px가 제목의 13.3px보다 커서
"제목보다 그 밑의 빈 상태 안내문이 더 크게" 보였다.

**고쳐서** 요청대로 둘의 크기를 맞바꿨다 — 제목(`내가 요청한 업무`/`나에게 온 요청`
`<span>` 두 개)은 13.3px → 15.3px로 올리고, 네 개의 빈 상태 `<div class="hint">`
(`renderAssignedOwned()`/`renderAssignedToMe()` 안의 "배정한/배정된 업무가
없습니다."와 "표시할 업무가 없습니다." 각 2곳)는 전부 `font-size:13.3px;`를 인라인
스타일에 명시적으로 추가해, 제목의 옛 크기를 그대로 물려받게 했다 — 이제 제목이
항상 그 아래 빈 상태 안내문보다 크게 보인다. 두 섹션 제목 행의 틴트 배경(`--stamp-
soft`)이나 `#assignedOwnedList`/`#assignedToMeList` id, JS 변수/함수명은 전혀
손대지 않았다 — 순수 인라인 `font-size` 숫자만 바꾼 변경이다.

Playwright로 (1) 두 제목 `<span>`의 computed font-size가 정확히 15.3px인지, (2) 네
빈 상태 `<div class="hint">` 템플릿 모두에 명시적 `font-size:13.3px;`가 박혀있는지
(소스 텍스트 직접 대조) — 확인했다.


## `chatbot-builder.html` — "미리 만들어진 과목별 챗봇"(국어 현상 탐구 챗봇)에도
## 공유 링크 + QR 코드 보기 추가

사용자 요청: "미리 만들어진 챗봇 국어 현상 탐구 발표 챗봇에 링크와 큐알 만들기가
있었으면 하는거야." 교사가 직접 만드는 커스텀 챗봇(`custom_bots`)의 편집기는 이미
챗봇마다 다른 slug로 공유 링크+QR(`qrcodejs`)을 보여주는데, `korean-inquiry.html`
("국어 현상 탐구 챗봇")은 그 서브시스템과 완전히 별개인 고정된 한 페이지라(자신만의
`inquiry_sessions`/`inquiry_settings` 테이블과 `inquiry-chat` Edge Function을 쓰고,
`custom_bots`의 slug/PIN 개념이 전혀 없음 — 학생은 그냥 그 페이지를 열고 학번+이름만
입력) 애초에 "공유할 링크"라는 개념 자체가 없었다 — 있는 거라곤 이 페이지를 가리키는
단 하나의 고정 URL뿐이었다.

- **표시 장소**: `chatbot-builder.html`의 "📚 미리 만들어진 과목별 챗봇" 카드 —
  "국어 현상 탐구 챗봇" 행(`<a class="builtin-bot-row" href="./korean-inquiry.html">`)
  바로 아래, 그 `<a>`와는 별개의 형제 엘리먼트로 "🔗 링크·QR 코드 보기" 토글 버튼
  (`#btnBuiltinShare`)을 추가했다 — 버튼을 `<a>` **안에** 넣으면 클릭 시 앵커의
  네비게이션과 겹쳐버리므로, 일부러 그 바깥에 뒀다. 누르면 기존 커스텀 챗봇 편집기의
  `.share-box` 모양(링크 코드 상자 + QR 칸 + 복사/다운로드 버튼)을 그대로 재사용한
  `#builtinShareBox`가 펼쳐진다(기본은 접힘, `display:none`).
- **공유 URL은 `STUDENT_BOT_BASE_URL`(커스텀 챗봇이 쓰는, bot.html 전용 두 번째
  Netlify 도메인)이 아니라 지금 이 페이지 자신의 주소를 그대로 쓴다** —
  `korean-inquiry.html`은 그 학생 전용 도메인에 따로 배포돼 있지 않고, 교사용 사이트와
  같은 도메인의 로그인 없는 일반 페이지이기 때문이다. `new URL('./korean-inquiry.html',
  location.href).href`로 상대경로를 절대 URL로 해석해, chatbot-builder.html이 어느
  경로 깊이에서 열렸든(현재는 루트뿐이지만) 항상 정확한 절대 주소가 나온다.
- **`renderStaticQr(boxId, shareUrl, attemptsLeft)`**(새 함수) — 기존
  `renderShareQr(shareUrl, forBotId, attemptsLeft)`와 같은 "QR 라이브러리가 defer로
  늦게 로드될 수 있어 폴링 재시도"(최대 25회, 200ms 간격) 패턴을 그대로 따르지만,
  `currentBot`을 추적할 필요가 없는 고정 페이지라 그 가드 없이 더 단순하게 뗐다 — 박스
  id를 매개변수로 받아, 어느 `<div>`에든 QR을 그릴 수 있는 범용 버전이다.
- **`wireBuiltinShareBox()`**(새 함수, 로그인+승인 게이트를 통과해 `#mainView`가
  보이는 시점에 한 번만 호출 — `renderEditor()`처럼 매번 다시 그려지는 영역이 아니라
  정적 HTML이라 한 번만 와이어링하면 된다) — 토글 클릭 시 박스를 펼치고
  (처음 펼칠 때만, `qrRendered` 플래그로 한 번만) QR을 그리고, 다시 누르면 접는다.
  "링크 복사"(`navigator.clipboard.writeText`), "QR 이미지 복사"(`ClipboardItem`+
  `canvas.toBlob()`을 Promise로 감싸 사용자 동작 중 동기 호출로 인정받는, 기존 커스텀
  챗봇 QR 복사와 같은 트릭), "QR 이미지 다운로드"(`canvas.toDataURL` → `<a download>`)
  세 버튼 모두 커스텀 챗봇 편집기의 QR 버튼들과 동일한 구현을 그대로 복붙했다 — 둘
  다 서버 호출이 전혀 필요 없는, 공유 URL 하나를 그대로 인코딩/복사할 뿐인 순수
  클라이언트 동작이라 복붙이 안전했다.

Playwright(로그인 세션/Supabase REST를 모킹)로 (1) 박스가 처음엔 접혀 있는지, (2)
토글을 누르면 펼쳐지고 버튼 라벨이 "닫기"로 바뀌는지, (3) 보여주는 URL이
`http://<현재 origin>/korean-inquiry.html`이고 **`STUDENT_BOT_BASE_URL`(학생 전용
도메인)이 전혀 아닌지**, (4) QR 캔버스가 그 URL을 정확히 인코딩해 렌더링되는지,
(5) 다시 누르면 접히고 라벨이 "보기"로 되돌아가는지, (6) 다시 펼쳤을 때 캔버스가
중복으로 쌓이지 않는지(`qrRendered` 가드 확인), (7) "링크 복사"가 정확한 URL을
클립보드에 담는지, (8) "QR 이미지 다운로드"가 실제 다운로드 이벤트를 발생시키는지 —
모두 확인했고, 기존 `test_chatbot_builder_qr_overflow.js`/
`test_chatbot_builder_activity_designer.js`/`test_chatbot_builder_regression.js`/
`test_chatbot_builder_charlimit.js`도 다시 돌려 회귀가 없음을 확인했다.

## `absence-report.html` (결석신고서) — 학교 원본 양식 이미지 위에 서명을 얹는 공개 링크 서명 시스템

사용자 요청: "학교의 결석 신고서 양식이 있는데 거기에 학생 서명이랑 학부모 서명이
필요하거든. 근데 파일 링크를 학생과 학부모에게 보내면 학생과 학부모가 내용을 확인하고
휴대폰으로 서명을 하면은 그 서명이 링크에 입력이 되게. 그러고 담임 선생님은 그걸
다운받을 수 있게 PDF." 이어서 실제 "결석신고서(질병)" PDF 원본(경성고등학교, HWP→PDF
변환, 1페이지 A4)을 받은 뒤, "결석 신고서는 학년 반 번호 이름 사유 날짜 기간을
입력하면 결석신고서에 입력된 이미지와 서명 기능이 포함된 링크가 만들어지고, 링크 안에
학생 이름 + 서명 쓰기 버튼, 학부모 성명 + 서명 버튼이 있어서 서명하게. 서명 완료되면
서명완료된 pdf를 교사가 확인하고 나머지부분 채워서 pdf저장하거나 출력할 수 있게.
**결석신고서 양식은 그대로 유지해야돼**"라는 최종 스펙으로 구체화됐다 — 마지막 문장이
설계를 결정지었다: 이 페이지는 양식을 HTML로 다시 그리는 게 아니라, **원본 PDF를
이미지로 그대로 써서 그 위에 입력값만 정확한 좌표로 얹는다.**

- **`absence-report-form.png`**(저장소 루트, 1653×2337px, 원본 PDF를 `pdftoppm -r 200`
  으로 200dpi 래스터화) — `classroom-layout-main.jpg`가 이미 확립한 "실제 이미지를
  정적 파일로 커밋해 그대로 보여준다" 관행을 그대로 따른다. 이 이미지 자체는 어떤
  코드로도 다시 그리거나 수정하지 않는다 — "양식은 그대로 유지"라는 요청을 가장
  직접적으로 지키는 방법이기도 하다.
- **좌표 매핑은 추측이 아니라 `pdftotext -bbox -r 200`으로 뽑은 실제 텍스트 bbox를
  그대로 옮긴 것이다.** 원본 PDF에서 "제 __학년 __반 __번", "성명:", "위 학생은
  __으로 20__년 __월 __일부터...", "학생:___(인)", "보호자:___(인)", 그리고
  "담임확인서" 섹션(증빙서류 체크박스 4종, 확인대상/확인방법 체크박스, 확인일자,
  담임교사:___(인))까지 라벨들의 실제 픽셀 위치를 읽고, 그 라벨들 **사이의 빈 칸**을
  빈칸의 bbox로 역산해 `FIELD_BOXES`(픽셀 좌표, 1653×2337 기준) 상수에 전부
  하드코딩했다. `pctBox(box)`가 이를 `left/top/width/height` 퍼센트로 변환하므로,
  오버레이 컨테이너(`.form-overlay-wrap`, `aspect-ratio:1653/2337`)가 어떤 폭으로
  렌더링되든 — 데스크톱이든 모바일 390px든 — 항상 같은 칸 위에 정확히 얹힌다
  (Playwright 스크린샷으로 데스크톱/모바일 양쪽 다 글자가 정확히 그 칸 안에 들어가는
  것을 직접 확인했다).
- **글자 크기는 컨테이너의 실제 렌더링 폭을 기준으로 JS가 계산한다** —
  `observeOverlayFonts()`가 `.form-overlay-wrap`마다 `ResizeObserver`를 걸어
  `--ov-fs`(CSS 커스텀 속성)를 `containerWidth * 0.0112`px로 계속 갱신한다 — 퍼센트
  위치 좌표와 별개로, 글자 크기도 컨테이너가 커지거나 작아질 때 함께 비례해서 커지고
  작아진다.
- **`absence_reports`**(새 테이블) — 학년/반/번호/이름/사유/시작일/종료일/일수/제출일
  (담임교사가 생성 시점에 입력), 학생/보호자 각각의 `*_name_signed`/`*_signature`
  (PNG data URL)/`*_signed_at`, 그리고 담임확인서 섹션(`evidence_types` jsonb 배열 +
  기타 텍스트, `confirm_target`/`confirm_target_name`/`confirm_target_other`,
  `confirm_method`/`confirm_method_other`, `confirm_date`, `teacher_name_signed`/
  `teacher_signature`)까지 한 행에 전부 담는다. RLS는 `public_surveys`와 같은
  "링크(추측 불가능한 uuid) = 권한" 모델 — `select`는 `anon`+`authenticated` 모두에게
  완전히 열려 있어(`using(true)`) 로그인 없이도 학생/보호자가 그 링크로 바로 내용을
  확인할 수 있다. `insert`/`update`/`delete`는 `created_by = auth.uid()`(또는
  관리자)만 — 결석신고서를 만들고 담임확인서를 채우는 건 로그인한 승인된 교사만
  가능하다.
- **서명 자체는 일반 update RLS로 커버되지 않는다** — 비로그인 공개 링크에서 일어나는
  쓰기이기 때문이다. `room_booking_create_anon` 등과 같은 패턴으로,
  `absence_report_sign(p_id, p_role, p_name, p_signature_data_url)`
  `SECURITY DEFINER` RPC 하나만 `anon`/`authenticated`에 열어서, 그 함수가 딱
  서명 관련 컬럼(`student_name_signed`/`student_signature`/`student_signed_at` 또는
  `guardian_...` 셋 중 하나)만 정확히 건드리도록 좁혔다 — `p_role`이
  `'student'`/`'guardian'`이 아니거나, 이름이 비어있거나, 서명 이미지가
  `data:image/png`로 시작하지 않거나 400000자를 넘으면 예외를 던진다. 비밀번호
  보호는 전혀 없다 — `public_survey_responses_insert_open`과 같은 "링크 자체가 권한"
  신뢰 수준을 그대로 따른 것이고, 다시 그려서 덮어쓰는 것도 항상 허용한다
  (`room_bookings`의 "정정 친화적, 항상 덮어쓰기 허용" 원칙과 동일).
- **공개 서명 화면(`?id=`)**: 로그인 전혀 불필요. 담임교사가 입력한 내용(학년/반/
  번호/이름/사유/기간/제출일)을 양식 이미지 위에 그대로 얹어 보여주고(읽기 전용),
  그 아래 **이미지와는 별개의, 화면에 크게 보이는** "🧑‍🎓 학생 서명"/"👪 보호자 서명"
  카드 두 개가 있다 — 처음엔 양식 안의 "학생:"/"보호자:" 빈칸 자체를 누를 수 있는
  버튼으로 만들려 했지만, 그 빈칸이 원본 좌표 그대로라 세로 33px(1653px 기준)밖에
  안 돼 버튼+라벨을 욱여넣기엔 너무 작다고 판단해, 이미지 안의 그 칸은 (서명 완료
  후) 이름+서명 이미지를 합성해 보여주는 용도로만 쓰고, 실제 "서명하기" 동작은 이미지
  아래 별도의 넉넉한 카드에서 하도록 분리했다. 카드를 누르면 서명 모달이 뜬다.
  둘 다 서명하면 "✅ 서명이 모두 완료됐어요" 배너가 뜬다.
- **서명 패드**: 이 저장소에 전자서명 컴포넌트가 지금까지 없었다 — 레포의 기존
  드래그앤드롭 관행(`pointerdown`/`pointermove`/`pointerup` + `setPointerCapture`,
  iOS Safari가 네이티브 `draggable`을 지원하지 않아서 이 방식을 쓰는 관행)을 그대로
  따라 캔버스에 직접 그리는 서명 패드를 만들었다. 중요한 디테일: 저장 직전에
  **잉크가 그려진 부분만 bounding box로 크롭**한다(`trimCanvasToContent()`, 캔버스
  픽셀의 alpha 채널을 스캔해 먹칠된 최소/최대 x/y를 찾고 여백 6px만 남겨 재크롭) —
  학생:/보호자: 빈칸이 가로 233px·세로 33px로 매우 좁아서, 트리밍 없이 넉넉한
  드로잉 캔버스(700×200) 전체를 그대로 저장하면 서명이 그 작은 칸 안에서 터무니없이
  작게 보였을 것이다. 합성 시(`fieldSign()`) 그 칸 안에 "이름(왼쪽, 텍스트) + 서명
  이미지(오른쪽, `object-fit:contain`)"를 나란히 배치해, 원본 종이 양식의 "성명을
  적고 그 옆에 도장/서명"이라는 관례와 비슷한 모양으로 들어간다.
- **학생 이름 입력칸은 결석신고서를 만들 때 담임이 이미 적어둔 이름으로 미리
  채워지지만(`r.student_name`), 보호자 이름 입력칸은 항상 빈 채로 시작한다** — 담임이
  애초에 입력하는 식별 정보에는 학생 정보만 있고 보호자 이름은 없기 때문에, 보호자
  스스로 서명하면서 자기 이름을 처음 입력하게 된다(원본 종이 양식도 "보호자:" 옆에
  빈칸이 있을 뿐, 그 이름이 어디서도 미리 적혀있지 않다는 것과 같은 구조).
- **관리 화면(`?id` 없음)**: `survey.html`과 거의 같은 3단 게이트
  (`#gateView`/`#pendingView`/`#mainView`) + "+ 새 결석신고서 만들기" 폼(학년/반/
  번호/이름/사유/시작일·종료일(일수는 자동 계산되지만 직접 고칠 수 있음)/제출일) +
  "내가 만든 결석신고서" 목록(학생 서명/보호자 서명 배지, 🔗 링크 복사, 📝 확인/
  담임확인서, 삭제) 구조를 그대로 재사용했다. 목록 행을 펼치면(survey.html의
  "📊 결과 보기" 인라인 패널과 같은 토글 패턴) 그 신고서의 양식 오버레이
  전체(담임확인서 섹션 포함, `includeConfirm:true`)를 보여주고, 그 아래 담임확인서
  작성 폼(증빙서류 체크박스+기타, 확인대상/확인방법 라디오+기타, 확인일자, 담임교사
  이름)과 "저장"/"✍️ 담임교사 서명(선택)"/"🖨 인쇄 / PDF로 저장" 버튼이 있다.
  담임교사 서명도 같은 서명 패드 컴포넌트를 재사용하지만(`role:'teacher'`), 공개
  RPC가 아니라 로그인한 교사 자신의 owner RLS로 직접 `update`한다(이미 `auth.uid()`
  가 `created_by`와 일치하므로 RPC가 필요 없다) — 사용자 스펙에 명시적 요구가 없어
  "선택"으로 남겨, 서명 없이 이름만 적고 인쇄 후 손으로 서명해도 되게 했다.
- **"🖨 인쇄 / PDF로 저장"**: 이 저장소의 기존 "진짜 서버 PDF 생성 없이
  `@media print`+`window.print()`로 '인쇄/PDF로 저장'을 대신한다"는 관행
  (`grade-estimate.html`/`mock-interview.html`)을 그대로 따른다. `#printArea`(평소
  `display:none`)에 그 순간의(아직 저장 전이라도, 화면에 입력된 값 그대로) 전체
  오버레이를 채워 넣고 `window.print()`를 호출하며, `@media print`는 `.wrap`
  (평소 보이는 모든 관리 화면 UI)을 숨기고 `#printArea`만 보여준다 — 인쇄물에는
  원본 양식 이미지 + 입력된 모든 내용만 남는다.
- 상단 결재란(계/부장/교감/교장)은 의도적으로 디지털 입력 대상에서 뺐다 — 사용자
  스펙에 언급이 없었고, 원본 양식에도 그 네 칸은 교내 결재(종이) 절차용 빈 칸으로
  남아있을 뿐이라, 양식 이미지 그대로 빈 칸으로 출력되고 그 이후는 종이로 결재하는
  절차로 남겨뒀다.
- `admin-tools.html`에 평범한(관리자 전용 아님) `tool-card`로, `nav.js`의
  `EXTRA_SEARCH_ITEMS`(`loginRequired:true`, `adminOnly` 없음)로 — 최근 추가된
  `grade-estimate.html`/`mock-interview.html`/`korean-inquiry.html`/`survey.html`과
  같은 "교무 업무 도구 허브 + 🔍 검색으로만 노출, top-level 메뉴 없음" 패턴을
  그대로 따랐다.
- `test_absence_report.js`(Playwright, `@supabase/supabase-js` UMD 로컬 번들로
  jsdelivr 요청을 가로채는 이 저장소의 표준 모킹 방식)로 (1) 비로그인 관리 화면은
  게이트만 보이는지, (2) 로그인+승인 교사의 생성 폼이 기간으로부터 일수를 자동
  계산하고 insert payload가 정확한지(학년/반/번호/이름/사유/날짜/소유자), (3) 생성
  직후 링크가 바로 뜨는지, (4) 목록에 미서명 배지가 뜨는지, (5) 상세 패널의 오버레이가
  이름/학년/반/번호/사유를 정확한 칸에 렌더링하는지, (6) 담임확인서 저장 PATCH
  payload가 정확한지, (7) 인쇄 버튼이 `window.print()`를 호출하고 그 전에
  `#printArea`가 채워지는지, (8) 공개 서명 화면이 로그인 없이 열리고 학생/보호자
  버튼이 둘 다 보이는지, (9) 서명 모달이 학생 이름은 미리 채우고 보호자 이름은
  비워두는지, (10) 캔버스에 직접 그린 서명이 `data:image/png`로 시작하는 RPC
  payload로 정확한 role/name과 함께 전송되는지, (11) 서명 후 그 섹션이 "서명 완료"
  상태로 바뀌고 둘 다 서명하면 완료 배너가 뜨는지 — 모두 확인했다. 좌표 정확도는
  테스트 단언뿐 아니라 가짜 서명 이미지를 채운 실제 스크린샷으로 공개 화면(위쪽
  식별정보+서명 두 칸)과 관리자 상세 화면(담임확인서 체크박스·확인일자·담임교사
  서명 포함 전체)을 둘 다 육안으로 직접 확인했다 — 모든 체크박스·텍스트·서명
  이미지가 원본 양식의 정확한 칸 안에 들어맞았다.

## `absence-report.html` 후속 — 서명 품질 저하 방지(HiDPI 서명 캔버스 + 300dpi 원본)

사용자 요청: "일단 결석신고서 작업을 해보자. 서명 하는 과정을 거쳐도 이미지 품질? 흐려지거나
깨지면 안 돡" — 서명을 거친 뒤에도 화질이 떨어지면 안 된다는 우려였다. 실제로 두 군데에
잠재적 화질 저하 요인이 있었다.

**① 서명 캔버스가 디바이스 해상도(devicePixelRatio)를 전혀 고려하지 않고 있었다.**
`<canvas id="signCanvas">`가 고정 `width="700" height="200"` 백킹 버퍼를 쓰고 있었는데,
HiDPI 화면(요즘 거의 모든 휴대폰)에서는 브라우저가 그 저해상도 비트맵을 실제 CSS 박스
크기까지 확대해서 그려야 하므로, 서명을 그리는 그 순간부터 이미 흐릿하게 보이고 그 흐림이
그대로 내보낸 PNG에(따라서 최종 합성 문서와 인쇄/PDF 출력에도) 영구히 박제된다.
**고쳐서** `setupSignatureCanvas(canvas)`가 매번 모달을 열 때 캔버스 노드를
`cloneNode(false)`로 완전히 새로 교체한 뒤(이전 스케일/리스너가 남아있지 않도록),
`canvas.clientWidth`/`clientHeight`(CSS 픽셀 크기, border 제외 content-box 기준)에
`window.devicePixelRatio`를 곱해 실제 백킹 버퍼 해상도(`canvas.width`/`canvas.height`)를
설정하고 `ctx.scale(dpr, dpr)`로 이후의 모든 그리기 명령이 CSS 픽셀 좌표를 그대로 쓰도록
맞춘다 — 이제 캔버스는 항상 그 디바이스의 실제 화면 해상도로 서명을 받는다.
`trimCanvasToContent(canvas, padding)`(잉크가 실제로 닿은 영역만 알파 채널을 스캔해
찾아내 잘라내는 기존 함수)의 패딩값도 `dpr`에 비례해(`Math.round(6 * dpr)`) 스케일하도록
바꿨다 — 그래야 HiDPI 캔버스에서 저장 전 여백을 잘라내는 비율이 일정하게 유지된다.

**② 원본 서식 이미지도 200dpi → 300dpi로 다시 래스터화했다.** `pdftoppm -r 300 -png`로
원본 PDF를 다시 렌더링해 `absence-report-form.png`를 1653×2337(200dpi) → 2480×3505
(300dpi)로 교체했다 — 인쇄 출력 품질을 더 선명하게 하기 위함. 기존 `FIELD_BOXES`(200dpi
기준으로 `pdftotext -bbox`에서 직접 뽑아 스크린샷으로 픽셀 정확도까지 검증해뒀던 좌표
테이블)는 모든 x/y/w/h 값을 정확히 1.5배(200dpi→300dpi 비율)해서 재사용했다 — 200dpi
버전이 이미 시각적으로 검증된 정확한 좌표였으므로, 처음부터 다시 추출하지 않고 수학적으로
스케일만 해도 정확도가 그대로 보존된다(퍼센트 기반 절대위치 오버레이 방식이라 `IMG_W`/
`IMG_H`도 같이 2480/3505로 바뀌면서 비율 자체는 변하지 않는다).

**③ Supabase RPC의 서명 데이터 URL 길이 제한도 함께 늘렸다** — `absence_report_sign`
RPC의 `if length(p_signature_data_url) > 400000 then raise exception...`를 `900000`으로
올렸다(HiDPI로 캡처한 서명 PNG가 기존 700×200 저해상도 버전보다 base64 인코딩 길이가
커지므로). 마이그레이션으로 라이브 Supabase에 이미 반영됐다.

`test_absence_report_hidpi.js`로 (1) 서식 배경 이미지가 실제로 2480×3505(300dpi)로
로드되는지, (2) devicePixelRatio 1/2/3 각각에서 캔버스 백킹 버퍼 해상도가
`clientWidth(또는 clientHeight)×dpr`와 정확히 일치하는지(고정된 저해상도 버퍼가 아님),
(3) 실제로 서명을 그려 저장했을 때 RPC로 전송되는 트림된 PNG의 실제 픽셀 폭이 dpr에
비례해서 커지는지(131→260→389, 거의 정확히 2배/3배), (4) 모달을 닫았다 다시 열어도
캔버스가 매번 올바른 크기로 새로 초기화되고 재생성 후에도 정상적으로 그려지는지 — 모두
확인했다. 기존 `test_absence_report.js`(33개 단언, 로그인 게이트/생성 폼/목록/오버레이
렌더링/담임확인서 저장/인쇄/공개 서명 화면/서명 모달→RPC 흐름 전부)도 좌표 1.5배
스케일링과 캔버스 로직 전면 재작성 후 다시 돌려 전부 그대로 통과함을 재확인했다.

## `admin-tools.html`/`index.html` 모바일 상단바 — 홈/나의 페이지 아이콘을 사이드바와
## 같은 SVG 배지 스타일로, 로그인 영역에 실제 이름+로그아웃 버튼 추가

사용자가 배포된 사이트(모바일 화면 스크린샷)를 보여주며 "맨 윗줄에 홈과 나의 페이지
아이콘도 아이콘 스타일 통일시켜주고, 오른쪽에는 000 이름 나오게 하고 로그아웃 버튼도
있어야돼"라고 요청했다 — `.ks-mobile-topbar`(`admin-tools.html`/`index.html` 둘 다
동일하게 복붙된 모바일 전용 상단바)의 🏠/👤 아이콘이 이전 세션에서 사이드바/타일에
적용했던 "단색 배경+흰색 선 아이콘" SVG 배지 리디자인(이 문서 위쪽 "아이콘 리디자인"
섹션 참고) 적용 범위 밖이라 여전히 평범한 이모지 그대로였고, 로그인 영역(`#ksMobileAuth`)
은 이니셜 원 하나뿐 이름 텍스트도 로그아웃 버튼도 전혀 없었다(데스크톱 `#ksUser`도
마찬가지였다 — 둘 다 이름/로그아웃이 아예 없었음).

- **`.ks-mobile-icon`의 🏠/👤을 사이드바와 정확히 같은 SVG path 데이터를 재사용하는
  `.ks-mobile-ico-badge`(22px 원형 배지, `background:var(--ks-primary)`, 안에 13px
  흰색 선 아이콘)로 교체**했다 — 새 아이콘을 그리지 않고 사이드바 리디자인 때 이미
  만들어둔 홈(지붕+문)/사람(카드 안 아바타+어깨선) SVG를 그대로 복붙했다.
- **`#ksUser`(데스크톱)/`#ksMobileAuth`(모바일) 둘 다에 이름 텍스트 + 로그아웃
  버튼을 추가**했다 — `waitForSupabase(...)` 콜백이 `profiles.select('name')`로
  실제 이름을 가져와(`'선생님'` 폴백) `.ks-user-avatar`(이니셜 원) 옆에
  `.ks-user-name`("OOO님")과 `.ks-logout-btn`("로그아웃")을 함께 렌더링한다 —
  모바일은 같은 패턴을 더 작은 크기(`26px` 아바타)로 쓴 `.ks-mobile-user-name`/
  `.ks-mobile-logout-btn`. `doLogout()`이 `sb.auth.signOut()` 후 `location.reload()`
  — 두 버튼(`#ksLogout`/`#ksMobileLogout`) 모두 같은 함수에 연결된다.
- **`index.html`/`admin-tools.html` 양쪽에 완전히 동일한 변경을 적용**했다 — 두 파일
  모두 자기 자신의 CSS 토큰 이름(`admin-tools.html`은 `--ks-ink`/`--ks-line` 계열,
  `index.html`은 `--ink`/`--rule` 계열)과 코드 스타일(`admin-tools.html`은
  `var`/`function`, `index.html`은 `const`/화살표 함수)을 그대로 따라 각자의 기존
  컨벤션과 자연스럽게 맞췄다.
- `test_topbar_name_logout.js`로 두 파일 × 모바일/데스크톱 두 뷰포트 각각에서 (1)
  홈/나의 페이지 아이콘이 더 이상 평문 이모지가 아니라 SVG 배지 2개로 렌더링되는지,
  (2) 로그인 영역에 이니셜만이 아니라 실제 전체 이름("김선생님")이 보이는지, (3)
  로그아웃 버튼이 보이고 클릭하면 실제로 GoTrue의 `/auth/v1/logout` 엔드포인트를
  호출하는지, (4) JS 에러가 전혀 없는지 — 20개 단언 모두 확인했다.

## `food-map.html` — "장소 검색" 입력칸이 모바일에서 카드째 화면 오른쪽 밖으로
## 넘치던 버그

사용자가 모바일 실사용 스크린샷(검색 카드의 오른쪽 테두리가 화면 밖으로 넘어가 있고,
입력칸 placeholder 끝 글자도 잘려 보이는 모습)과 함께 "맛집 공유지도 장소검색 입력
칸이 깨졌어"라고 보고했다. 원인은 `.search-add-row{ display:flex; }` 안의
`#placeSearchInput`가 `flex:1`만 있고 `min-width:0`이 없었던 것 — flex 아이템의 기본
`min-width:auto`는 콘텐츠 기준 최소폭으로 계산되는데, 일부 모바일 브라우저는 이 자동
최소폭을 `placeholder`("가게 이름으로 검색 (예: 교문분식)", 꽤 긴 문자열) 기준으로
계산해버려서, 그 긴 placeholder 폭이 `flex:1`인 input을 실제 카드 폭보다 넓게 밀어내고
카드(`.fm-search-col .card`) 전체가 통째로 화면 오른쪽 밖으로 넘쳐버렸다.

**고쳐서** `.search-add-row input`에 `min-width:0`을 추가해(이 flex-overflow 문제의
표준적인 해법 — 콘텐츠 기준 자동 최소폭 계산 자체를 꺼버림) `flex:1 1 140px`로
명시적인 flex-basis도 함께 줬고, 혹시 정말 좁은 화면에서도 안전하도록
`.search-add-row`에 `flex-wrap:wrap`(버튼이 정 안 들어가면 다음 줄로 자연스럽게
넘어가게)과 검색 버튼에 `flex-shrink:0`(버튼 자체가 눌려 찌그러지지 않게)을 추가했다.

`test_foodmap_search_overflow.js`로 모바일 폭 세 가지(360/390/412px)에서 (1) 문서
전체 스크롤 폭이 뷰포트를 넘지 않는지(가로 스크롤 자체가 생기지 않는지), (2) 검색
입력칸의 오른쪽 끝이 뷰포트 안에 들어오는지, (3) 검색 카드 전체의 오른쪽 끝도 뷰포트
안에 들어오는지 — 세 폭 모두에서 확인했다. 기존 `.fm-search-col`/`.fm-list-col`의
최소폭 보장(이 문서 위쪽 "fm-search-col의 min-width를..." 참고)이나 다른 레이아웃
요소는 전혀 손대지 않은, 이 input 하나에 국한된 수정이다.

## `mock-interview.html` 헤더 — 3번째 줄(아이콘)과 4번째 줄(마지막 설명 배지) 순서 교체

사용자 요청: "AI 모의면접 분석 페이지 상단 세번째 아이콘 줄과 네번째 설명줄의 위치를
바꾸자." 이전 세션에서 헤더를 "①제목 ②설명 ③아이콘들 ④마지막 설명(배지)" 4줄로
재배치했던 것을, 이번엔 "①제목 ②설명 ③마지막 설명(배지) ④아이콘들"로 — 뒤 두 줄의
순서만 맞바꿨다. 두 블록을 그대로 위치만 바꿔 옮겼을 뿐(`id`/`onclick`/내부 구조는
전혀 안 바꿈 — 저장/불러오기/목록 관리/샘플 채우기/전체 초기화 다섯 아이콘과 📂
드롭다운 패널 로직 모두 그대로), 헤더 맨 위 주석(`<!-- Header — 4줄 레이아웃: ... -->`)
의 순서 설명도 실제 순서에 맞게 같이 고쳤다.

`test_mi_header_order.js`로 각 블록의 화면상 세로 위치(`getBoundingClientRect().top`)
를 직접 비교해 제목 < 설명 < 배지 < 아이콘 순서로 정확히 위에서 아래로 쌓이는지, JS
에러가 없는지 확인했다.

## `absence-report.html` — 입력 내용 글씨 크기를 양식 자신의 글씨 크기에 맞춰 다시 계산(칸별 높이 기반)

사용자 요청: "입력받은 내용을 넣을때 글씨 크기는 최대한 양식의 글씨 크기와 동일하거나
조금 더 크거 병합해봐." 기존 `--ov-fs` 공식(`컨테이너 폭 × 0.0112`, 전체 오버레이에
단일 값 — 이 문서의 결석신고서 섹션에 이미 적혀 있던 그대로)은 실제로 매우 작아서,
원본 양식 자체의 인쇄된 글씨("제 학년 반 번", "성명:" 등)보다 눈에 띄게 작아 보였다.

**근본 원인을 추측이 아니라 실측으로 확인했다.** `pip install pillow numpy`로 이
이미지를 직접 픽셀 단위로 분석했다 — 원본 양식 이미지(`absence-report-form.png`,
2480×3505px, 300dpi)에서 "제 학년 반 번", "성명:", "위 학생은" 세 군데의 인쇄된
라벨 텍스트 ink(실제 잉크가 있는 픽셀) 높이를 각각 측정하니 전부 정확히 **47px**로
일치했다. 그리고 그 옆 `FIELD_BOXES`의 빈칸 높이(`h`, 대부분 49.9px — 이 빈칸
좌표 자체가 원래 `pdftotext -bbox`로 그 위치의 실제 텍스트 bbox를 뽑아 옮긴
것임이 이미 이 문서에 문서화돼 있음)가 그 47px 실측값과 매우 근접(49.9 × 실측
ink/em 비율 ≈ 47)한 것을 확인해 — **`FIELD_BOXES`의 각 칸 높이(`box.h`) 자체가
바로 그 위치의 원본 양식 자체의 실제 줄 높이(원본 폰트의 em 크기)를 거의 정확히
나타낸다**는 걸 실측으로 검증했다. 즉 입력 글씨의 font-size를 그 칸 자신의 높이와
같게 맞추면, 별도의 "원본 폰트는 몇 pt였을까" 추측 없이도 자동으로 "원본 양식의
그 위치 글씨 크기와 거의 같은 크기"가 된다.

이 결론에 이르기까지 Noto Sans KR(`font-weight:600`, 이 페이지가 쓰는 바로 그
웹폰트) 글자의 "ink 높이 ÷ font-size" 비율도 직접 렌더링해 측정했다 — 한글 음절
(학/년/반/번 등)은 약 0.925~0.93, 숫자(0~9)는 약 0.745로 서로 다르다(숫자가
한글 음절보다 em 박스 안에서 차지하는 비율이 작다). 체크마크(✓, `font-weight:800`)
는 ink 비율이 약 0.545로 더 작은데, 원본 양식에서 그 체크 칸(`evHospital` 등,
h≈58.5)은 실제로는 □(빈 체크박스) 사각형 글자 자체의 bbox임을 크롭해서 직접
확인했다 — 즉 ✓ 체크 칸은 "줄 높이"가 아니라 "체크박스 사각형 크기"를 나타내므로,
일반 텍스트와는 다른(더 큰) 배율을 써야 체크 표시가 그 사각형 안을 자연스럽게
채운다.

**구현**: 기존의 "컨테이너 폭 전체에 단일 font-size"(`--ov-fs`) 방식을 버리고,
**칸마다 자기 자신의 원본 높이(`box.h`)를 기준으로 각자 다른 font-size를 매기는**
방식으로 바꿨다. `--ov-scale`(단위 없는 배율 = 컨테이너 실제 렌더링 폭 ÷ 원본
이미지 폭 2480, `ResizeObserver`로 갱신 — 기존 `observeOverlayFonts()`가 하던
것과 같은 자리, 값의 의미만 "절대 px"에서 "배율"로 바뀜)와, 각 필드가 자기
`box.h`(px)에 배율과 보정 계수(factor)를 곱한 `calc(var(--ov-scale) * (box.h *
factor)px * var(--ov-shrink, 1))`을 인라인 `font-size`로 직접 받는 새 헬퍼
`ovFontSize(box, factor)`로 구성된다. `factor`는 텍스트/서명 이름은 1.08(실측
em 크기 그대로 쓰면 거의 "같은 크기"이므로, "같거나 조금 더 크게"라는 요구에
맞춰 8% 더 크게), 체크 표시는 1.5(체크박스 사각형 안을 자연스럽게 채우도록, 위
실측 결과 반영). `fieldText()`/`fieldCheck()`/`fieldSign()`(이 셋이 `renderOverlay()`
의 모든 오버레이 요소를 만드는 지점) 각각이 이 헬퍼로 자기 칸의 font-size를
인라인으로 받도록 고쳤다. `.ov-text`/`.ov-check`/`.ov-sign-name`의 CSS는
`font-size:var(--ov-fs,13px)` 선언을 지우고 아주 작은 고정 fallback(13px/15px,
인라인 스타일이 어떤 이유로든 없을 때만 쓰이는 방어값)만 남겼다.

**이 과정에서 실제로 새로 생긴 회귀를 발견해 같이 고쳤다.** 글씨가 커지면 같은
텍스트가 더 넓게 렌더링되므로, 원본 양식에서 원래 좁았던 빈칸(예: "확인 대상"
섹션의 "보호자(　　)" 괄호 안, `targetGuardianName` 칸은 원본 229px로 매우 좁음)
에 긴 이름/메모를 적으면 `overflow:hidden` 때문에 글자가 칸 중간에서 잘려 보이는
문제가 실제로 재현됐다(스크린샷으로 "김보호자이름" → "김보호지|"처럼 글자가
잘려 보이는 걸 직접 확인). 예전의 더 작던 글씨 크기에서는 여유가 훨씬 많아 거의
드러나지 않던 위험이, 이번 변경으로 커진 것. **고쳐서** `fitOverlayText(wrap)`
(새 함수, `observeOverlayFonts()`의 `update()` 안에서, 그리고 `document.fonts.ready`
이후 한 번 더 호출 — 웹폰트가 늦게 로드돼 폭이 달라지는 경우까지 커버)가 렌더링
직후 모든 `.ov-text` 요소의 실제 `scrollWidth`/`clientWidth`를 재서, 넘치는 칸만
골라 `--ov-shrink`(기본 1, CSS 커스텀 속성으로 `ovFontSize()`의 calc 안에 이미
곱해져 있음)를 줄여 그 칸 하나만 글씨를 줄인다 — 대부분의 짧은 입력(실제 이름
대부분 2~4글자)은 전혀 영향받지 않고, 유독 긴 입력이 들어간 칸만 자동으로 딱
들어맞는 크기로 줄어든다. 한 번의 비율 보정만으로는 커닝/반올림 때문에 1~수px
잔여 overflow가 남을 수 있어 두 번째 보정 패스를 추가해 거의 0px까지 줄였다(바닥값
0.5 — 지나치게 작아 안 읽히는 글씨보다는, 현실적으로 거의 없을 극단적으로 긴
입력에 한해 약간의 여백 초과를 허용하는 쪽을 택함).

Playwright로 직접 스크린샷을 찍어 데스크톱(900px)·모바일(390px) 폭 모두에서 글씨
크기가 원본 양식의 인쇄된 라벨과 자연스럽게 어울리는지(이전보다 뚜렷이 커짐,
동시에 어색하게 과하지도 않음) 육안으로 확인했고, 체크된 체크박스(병원진단서/
기타/보호자/전화)에서 ✓가 사각형 안을 적절히 채우는 것도 확인했다. 새
`test_absence_report_fontsize.js`로 (1) `--ov-scale`이 실제 컨테이너 폭/2480과
정확히 일치하는지(데스크톱·모바일 두 폭 모두), (2) 이름 칸의 font-size가
`scale × box.h × 1.08` 공식과 정확히 일치하는지(두 폭 모두), (3) 평범한 길이의
이름은 `--ov-shrink`가 거의 1로 유지되고 칸을 넘치지 않는지, (4) 좁은
`targetGuardianName` 칸에 일부러 긴 이름("김보호자이름", 6글자)을 넣으면 글자가
잘리지 않고 전체가 다 보이면서(`scrollWidth <= clientWidth`) `--ov-shrink`가
실제로 1 미만으로 줄어드는지, (5) 체크 표시가 렌더링되고 보이는 크기를 갖는지,
(6) 어떤 경우에도 JS 에러가 없는지 — 모두 검증했다(15개 단언). 기존
`test_absence_report.js`(33개, 로그인 게이트/생성 폼/목록/오버레이 렌더링/담임확인서
저장/인쇄/공개 서명 흐름)와 `test_absence_report_hidpi.js`(17개, 서명 캔버스
HiDPI 해상도)도 다시 돌려 이번 변경과 무관하게 전부 그대로 통과함을 확인했다 —
서명 캔버스/HiDPI 관련 코드는 전혀 손대지 않았다.

## `absence-report.html` 후속 미세조정 — 연도 잘림/체크 크기/서명란 이름 위치/보호자 괄호 정렬/제출일 위치

바로 위 섹션(칸별 높이 기반 font-size 보정)을 적용한 뒤, 실사용 피드백으로 여러
미세조정이 한 번에 들어왔다: "연도가 짤려서 글씨가 좀 더 작아야 될거 같고
체크표시도 더 작아야 해", "서명 앞에 이름도 오른쪽으로 더 이동해야돼"(두 번 더
반복: "이름 서명 쓰는 부분 이름이 오른쪽으로 두자 분량만큼 더 이동",
"서명란에 이름 위치 오른쪽으로 더 이동"), "보호자 옆 괄호 안도 텍스트가
가운데정렬로 들어가야하니", "제출 연월일부분 글씨는 조금더 아래로. 연월일 크기는
연도 크기에 맞춰줘", "위에 있는 26이랑 밑에 있는 26 크기가 달라 숫자크기
통일시켜줘"(두 번 반복).

**근본 원인 하나가 세 가지 증상(연도 잘림/두 "26"의 크기 차이/제출 연월일이
연도와 다른 크기)을 동시에 설명했다.** 결석 기간(시작연도)·제출 연월일·확인일자
(담임확인서)의 연·월·일 숫자 칸들은 `FIELD_BOXES`에서 전부 `h:49.9`로 높이가
같아, 기존 공통 factor(1.08)를 그대로 쓰면 `font-size = h*1.08`로 **셋 다 폭 이전
단계에서는 정확히 같은 크기**였다 — 그런데 이 칸들의 **폭(w)**은 49.9~81px로
제각각이고(연도 칸이 가장 좁음, 49.9~53.8px), "26" 같은 두 자리 숫자의 실제 렌더
폭이 가장 좁은 연도 칸의 폭을 넘어서면서 `fitOverlayText()`의 자동 축소
(`--ov-shrink`)가 **칸마다 다른 비율로** 걸렸다 — 그 결과 (1) 연도가 자동 축소되며
한 프레임 잘려 보이거나 축소 자체가 눈에 띄게 작아 보였고, (2) 같은 "26"이라도
칸 폭이 조금 더 넓은 시작연도(53.8px)와 더 좁은 제출연도/확인연도(49.9px)가 서로
다른 축소 비율을 받아 최종 크기가 달라 보였고, (3) 월/일 칸(폭 75~81px, 상대적으로
넓어 축소가 거의 안 걸림)은 연도보다 상대적으로 커 보였다.

**고쳐서** `fieldText(box, text, align, factor)`에 선택적 4번째 인자(explicit
factor override)를 추가하고, 결석 기간/제출일/확인일자의 모든 연·월·일 숫자 칸
(시작연도·월·일, 종료월·일, 기간일수, 제출연도·월·일, 확인연도·월·일)에
`DATE_NUM_FACTOR = 0.74`라는 공통의, 가장 좁은 칸에서도 자동 축소 없이 꼭 맞도록
미리 계산한 더 작은 factor를 명시로 줬다 — 자동 축소에 기대지 않고 처음부터
통일된 작은 크기로 렌더링되므로, 세 가지 증상이 한 번에 해결됐다(`--ov-shrink`에
전혀 안 걸림, 세 "26" 모두 완전히 동일한 font-size, 제출 연월일의 월/일도 연도와
정확히 같은 크기 — "연월일 크기는 연도 크기에 맞춰줘" 요구 그대로). 학년/반/번호/
사유(`grade`/`classNo`/`no`/`reason`) 칸은 폭이 충분히 넓어(99.9~244px) 잘림
위험이 없어 기존 1.08을 그대로 유지했다.

**체크 표시**: `fieldCheck()`의 factor를 1.5 → 1.15로 줄였다 — "체크박스 사각형
안에 꽉 차 보이도록"이라는 원래 의도가 과했다는 피드백을 반영.

**서명란 이름 위치**: `.ov-sign-name`에 `margin-left:1.4em`을 추가해 "학생:"/
"보호자:"/"담임교사:" 뒤 빈칸의 왼쪽 가장자리에 바짝 붙던 이름을 오른쪽으로 옮겼다
— em 단위라 font-size에 비례해 반응형으로 따라간다. 세 서명란(학생/보호자/
담임교사) 모두 같은 `fieldSign()` 함수를 거치므로 한 군데 수정으로 전부 적용된다.

**보호자( ) 괄호 안 정렬**: `fieldText(FIELD_BOXES.targetGuardianName, r.confirm_target_name, 'left')`
를 `'center'`로 바꿨다 — 괄호 안 자유 입력 이름이 왼쪽 정렬돼 괄호 왼쪽에 붙어
보이던 것을 가운데로.

**제출 연월일 위치**: `submitYear`/`submitMonth`/`submitDay`의 `y` 좌표를
1451.8 → 1465.8(네이티브 2480×3505 좌표계 기준 +14px)로 내려, 인쇄된 괄호/안내
문구 줄과 좀 더 자연스럽게 겹치도록 아래로 옮겼다.

Playwright로 실제 렌더링을 캡처해(전체 양식 스크린샷 + 결석기간/제출연월일/
서명란/보호자 괄호/체크박스/확인일자 부분 크롭) 세 "26"이 육안으로도 동일한
크기로 보이고 잘리지 않는 것, 체크 표시가 사각형에 적당히 맞는 것, 이름이 콜론
뒤에서 눈에 띄게 오른쪽으로 떨어져 보이는 것, 보호자 괄호 안 텍스트가 가운데
있는 것을 확인했다. 수치로도 `getComputedStyle`을 직접 읽어 세 "26" 필드의
font-size가 소수점 단위까지 완전히 일치하고(`--ov-shrink`가 셋 다 정확히 1,
즉 자동 축소가 전혀 안 걸림) 제출 연월일의 월/일 font-size도 연도와 정확히
같다는 것을 검증했다. 새 테스트(13개 단언, Playwright)로 (1) 세 연도 칸이
동일한 font-size·overflow 없음·shrink=1인지, (2) 제출 연월일의 월/일이 연도와
같은 크기인지, (3) 체크 표시의 실제 factor가 1.15로 복원되는지(기존 1.5 대비),
(4) 서명란 이름에 0보다 큰 오른쪽 이동 margin이 걸려있는지, (5) 보호자 괄호
필드가 `ov-center` 클래스를 갖는지(`ov-left` 아님), (6) 제출 연월일 행이 기대한
+14px만큼 아래로 이동한 위치에 있는지 — 모두 확인했다. 기존
`test_absence_report.js`(33개)/`test_absence_report_fontsize.js`(15개)/
`test_absence_report_hidpi.js`(17개)도 다시 돌려 이번 변경과 무관하게 전부 그대로
통과함을 확인했다.

## `absence-report.html` 후속 미세조정 2회차 — 제출일 위치 되돌림(픽셀 실측), 날짜 숫자 확대, 체크 위치·크기, 서명란 이름 더 오른쪽

바로 위 1회차 조정 이후 또 한 번 실사용 피드백이 들어왔다: "서명란에 이름 위치
오른쪽으로 더 이동", "날짜 숫자 0.5 포인트 더 크게. 제출 날짜는 양식과 같은
높이에 오도록 위로 이동", "체크표시도 살짝만 더 위로 이동하고 살짝만 크기
줄이기". **제출 연월일 위치는 1회차에서 내렸던 방향(+14px)을 정확히 되돌리는
요청**이라, 추측 대신 원본 양식 이미지(`absence-report-form.png`, 2480×3505)를
Pillow/numpy로 직접 픽셀 분석해 근거를 확인한 뒤 적용했다 — `absence_report_fontsize`/
`absence_report_hidpi` 섹션들이 이미 세워둔 "추측보다 실측" 원칙을 그대로 따른
것이다.

**제출 연월일 — 픽셀 실측으로 확인한 뒤 원래 위치로 되돌림.** 원본 이미지에서
"20\_\_년 \_\_월 \_\_일" 인쇄 문구가 있는 행(네이티브 y 1380~1540 구간)을 잘라
`scan < 200`(어두운 픽셀) 기준으로 잉크 범위를 측정하니 y 1454~1499(센터 ≈
1476.5)였다. 1회차에서 내렸던 현재 `submitYear.y:1465.8`(h:49.9)은 센터가
1490.75로, 실제 인쇄 문구보다 14px 가까이 아래다 — 반면 1회차 조정 **전**의
원래 값이었던 `y:1451.8`은 센터가 1476.75로 측정된 잉크 센터(1476.5)와 거의
완벽히 일치한다. 즉 1회차의 "+14px 아래로" 조정은 실제로는 잘못된 방향이었고,
이번 요청("양식과 같은 높이")이 정확히 그 오류를 바로잡는 것이었다 — `submitYear`/
`submitMonth`/`submitDay`의 `y`를 `1465.8` → `1451.8`로 되돌렸다.

**날짜 숫자 0.5pt 확대.** 기존 `DATE_NUM_FACTOR = 0.74`에서 렌더링되는 실제
font-size를 측정(기본 640px 컨테이너 폭에서 9.53px)한 뒤, 0.5pt(=0.5×96/72 ≈
0.667px) 증가분을 반영한 비율로 역산해 `0.79`로 올렸다(9.53px → 약 10.17px,
+0.48pt에 해당 — 반올림 오차 내에서 요청과 일치). 가장 좁은 연도 칸(폭 49.9px)
에서도 `fitOverlayText()`의 자동 축소(`--ov-shrink`)가 전혀 안 걸리는 것을
다시 확인했다 — 1회차에서 이 factor를 도입한 이유(가장 좁은 칸에서도 잘리지
않는 고정값) 자체가 깨지지 않았다.

**체크 표시 — 위치(네이티브 -4px)와 크기(1.15 → 1.08) 둘 다 조정.** 체크박스
글자가 아니라 **인쇄된 사각형 테두리** 자체의 실제 위치를 먼저 측정했다 —
`evHospital`(x:621.6, y:2224.5, w:56.8, h:58.5) 주변을 여유 있게 잘라 잉크
범위를 재니 y 2229~2274(센터 2251.5)였는데, 기존 박스(y:2224.5~2283)의 센터는
2253.75 — 인쇄된 사각형보다 약 2.25px 아래였다("살짝" 어긋나 있다는 사용자
체감과 정확히 일치하는 크기의 오차). 체크박스 역할을 하는 10개 `FIELD_BOXES`
항목(`evHospital`/`evOpinion`/`evTreatment`/`evOther`, `targetGuardian`/
`targetSelf`/`targetOther`, `methodPhone`/`methodVisit`/`methodOther`)의
`y`를 전부 네이티브 4px씩 올렸다(예: `evHospital.y:2224.5` → `2220.5`) — 실측
오차(2.25px)보다 살짝 더 올려, "살짝만 더 위로"라는 요청대로 측정된 인쇄
사각형 센터를 살짝 지나치는 선에서 멈췄다. 옆에 붙는 자유 입력 텍스트 칸
(`evOtherText`/`targetGuardianName`/`targetOtherText`/`methodOtherText`)은
체크박스와 별개의 `FIELD_BOXES` 항목이라 전혀 건드리지 않았다 — 이미 올바른
위치에 있었다. 크기는 `fieldCheck()`의 factor를 `1.15` → `1.08`로 낮췄다 —
이 값은 임의의 숫자가 아니라 `fieldText()`의 기본 factor(1.08)와 정확히
같은, 이미 이 코드베이스에서 "칸 높이에 맞춘 적정 크기"로 검증된 값을 그대로
재사용한 것이다.

**서명란 이름 더 오른쪽.** `.ov-sign-name`의 `margin-left`를 `1.4em` →
`2.1em`으로 더 키웠다 — 1회차에서 이미 한 번 늘렸던 값이 여전히 부족하다는
반복 피드백. 세 서명란(학생/보호자/담임교사)이 공유하는 `fieldSign()` 하나의
CSS 규칙이라 한 곳만 고치면 셋 다 반영된다. 스크린샷으로 이름이 "학 생:"/
"보 호 자:" 라벨에서 눈에 띄게 더 떨어지면서도 서명 이미지(`.ov-sign-img`,
`max-width:58%`)나 "(인)" 표기가 밀려나거나 잘리지 않는 것을 확인했다.

Playwright로 전체 양식과 결석기간/제출연월일/서명란/체크박스/확인일자 부분을
다시 크롭 캡처해 육안으로 확인했다 — 제출 연월일이 그 위 인쇄 문구와 같은
높이로 보이고, 체크 표시가 사각형 안에 더 작고 정확히 들어맞으며, 서명란
이름이 라벨에서 충분히 떨어져 있는 것을 확인했다. 기존
`test_absence_report_tweaks.js`(1회차 테스트)를 이번 변경에 맞게 갱신했다 —
체크마크 factor 기대값을 1.15→1.08로, 제출 연월일 위치 기대값을 1465.8/3505→
1451.8/3505로 고치고, 체크박스 위치가 실제로 4px 위로 이동했는지 검증하는
단언을 새로 추가했다(14개 단언). 기존 `test_absence_report.js`(33개)/
`test_absence_report_fontsize.js`(15개)/`test_absence_report_hidpi.js`(17개)도
다시 돌려 이번 변경과 무관하게 전부 그대로 통과함을 확인했다 — 총 65개 단언,
회귀 없음.

## `absence-report.html` 후속 미세조정 3회차 — 서명을 이름 옆이 아니라 "(인)" 글자 위에 겹쳐 찍기, 이름은 다시 왼쪽으로, 서명 확대·강조

실제 배포된 공개 서명 화면 스크린샷을 보고 다섯 가지를 한 번에 요청받았다: "글씨들이
커서 그런지 좀 짤리고, 서명에 이름은 왼쪽으로 좀 더 옮겨야겠고, 서명칸 더 크게
보여주고, 서명은 (인)이라는 글자 위에 정가운데 기준으로 들어가게 하고 크기를 조금
더 키우고 더 진하게 해야겠어." 이름 위치는 2회차에서 두 번에 걸쳐 오른쪽으로
밀었던(1.4em → 2.1em) 바로 그 방향을 정확히 되돌리는 요청이었고, 서명을 "(인)"
위에 겹치는 건 기존 구조(`fieldSign()` 하나가 이름+서명을 한 flex 박스 안에 묶어
`FIELD_BOXES.studentSign` 등 빈칸 하나에만 배치하던 방식)로는 애초에 표현할 수
없는 요구라 — "(인)"은 그 빈칸 바깥, 오른쪽에 별도로 인쇄돼 있다 — 구조 자체를
손봐야 했다.

**작업 전에 레이아웃만 먼저 빠르게 그려서 보고 조정하자는 요청**("이건 글씨
크기나 배치가 중요하니까 작업전에 미리 레이아웃만 빠르게 작성해서 보고 조정해야
될거 같애")으로, 코드를 고치기 전에 Claude Artifact로 조정 가능한 미리보기를 먼저
만들었다 — 실제 `absence-report-form.png`에서 서명란 두 줄과 날짜 숫자칸 한 줄을
그대로 크롭해 배경으로 쓰고, 그 위에 지금(배포됨) vs 조정(슬라이더 4개: 이름
위치/서명 크기/서명 굵기/서명 좌우 미세위치, + 날짜 숫자 크기 슬라이더 1개)을
나란히 겹쳐 보여주는 페이지였다. 이 미리보기 작업 전에 "(인)" 글자의 실제 인쇄
위치부터 짐작하지 않고 직접 측정했다 — `absence-report-form.png`(2480×3505,
300dpi)에서 `scan < 150`(어두운 픽셀) 기준으로 학생/보호자/담임교사 세 줄
각각의 "(인)" 글자 bbox를 스캔해, 세 줄 모두 거의 같은 폭(73px)에 중심 x좌표가
2083.5(학생/보호자)·2080.5(담임교사)로 모여 있는 것을 확인했다. 미리보기를
보여주고 "바꿔보자"는 승인을 받은 뒤, 그 기본값을 그대로 실제 코드에 반영했다.

- **이름과 서명을 완전히 분리된 두 요소로 바꿨다.** `fieldSign(box, name, sigUrl)`
  하나가 `<div class="ov-sign-box">`(flex, `gap:5%`) 안에 이름(`span.ov-sign-name`,
  `margin-left:2.1em`)과 서명(`img.ov-sign-img`, `height:92%; max-width:58%`)을
  같이 넣던 구조를 버리고, `fieldSign(nameBox, imgBox, name, sigUrl)`로 시그니처를
  바꿔 — 이름은 기존 `FIELD_BOXES.studentSign`/`guardianSign`/`teacherSign`(빈칸
  전체) 위에 `position:absolute`로 독립 배치하고(`margin-left`만 `2.1em` →
  `0.2em`로 줄여, 빈칸 왼쪽 가장자리인 콜론 바로 다음에 붙게 했다 — 콜론과 완전히
  붙지는 않도록 최소한의 여백만 남김), 서명은 새로 추가한
  `studentSignImg`/`guardianSignImg`/`teacherSignImg`(아래) 위에 역시
  `position:absolute`로 독립 배치했다. 둘 다 있던 `name && sigUrl ? ... : ''`
  조건부 렌더링은 각자 따로 유지된다 — 둘 중 하나만 있어도(이론상 없는 경우지만)
  그 요소만 보인다.
- **서명 전용 박스 세 개를 `FIELD_BOXES`에 추가했다** — 위에서 측정한 "(인)" 글자
  중심 좌표에, 줄 높이(49.9, 기존 모든 빈칸이 공유하는 h값)의 **1.8배** 크기(세로
  89.8, 가로는 서명 획이 자연스러운 비율인 2.2:1로 197.6)로 중심이 정확히 맞도록
  역산했다: `studentSignImg:{x:1984.7,y:1592.1,w:197.6,h:89.8}`,
  `guardianSignImg:{x:1984.7,y:1692.1,w:197.6,h:89.8}`,
  `teacherSignImg:{x:1981.7,y:2977.1,w:197.6,h:89.8}`. 1.8배를 고른 건 임의의
  수가 아니라 — 학생 서명란과 보호자 서명란 사이 간격(두 "(인)" 중심 간 거리
  100px)에서 이 크기가 위아래 두 서명 이미지끼리도, 그 위아래 인쇄된 줄과도
  겹치지 않는 가장 큰 값이라는 걸 먼저 픽셀로 계산해 확인한 뒤 정했다(담임교사
  줄도 위아래 여유가 더 넉넉해 같은 배수를 그대로 썼다). CSS도 `.ov-sign-box`
  (flex 래퍼)를 지우고 `.ov-sign-img-box`(`position:absolute`, 그 자체가 pctBox로
  배치됨) + `.ov-sign-img`(`width:100%; height:100%; object-fit:contain;
  filter:contrast(1.35)`)로 바꿨다 — 더 이상 "이름 옆 남은 공간"이 아니라
  "(인)" 자리에 정확히, 훨씬 크게 찍힌다.
- **날짜 숫자 크기도 한 단계 줄였다** — `DATE_NUM_FACTOR`를 `0.79` → `0.70`으로
  (2회차에서 "0.5pt 더 크게"로 올렸던 값을 다시 눈에 띄게 줄이는 방향). 화면
  전체가 "글씨가 커서 잘린다"는 느낌을 준다는 포괄적인 피드백이라, 가장 잘릴
  위험이 큰(칸 폭이 제일 좁은) 날짜 숫자칸부터 손봤다 — 이름/사유 등 자유 입력
  칸은 이미 `fitOverlayText()`가 넘치는 경우에만 자동으로 줄여주는 안전장치가
  있어 따로 건드리지 않았다.
- **서명을 "더 진하게"는 화면 표시(CSS `filter:contrast`)와 저장되는 이미지
  자체(캔버스 펜 굵기) 양쪢에 적용했다.** `setupSignatureCanvas()`의
  `ctx.lineWidth`를 `2.6` → `3.6`으로 올렸다 — 이건 화면 미리보기만의 트릭이
  아니라 학생/보호자/담임교사가 서명할 때 **실제로 저장되는 PNG 자체**가 더
  굵게 그려지므로, 작게 렌더링돼도 흐려 보이지 않고 인쇄/PDF 품질에도 그대로
  반영된다. `.ov-sign-img`의 `filter:contrast(1.35)`는 그 위에 화면 표시용으로
  한 번 더 얹는 보정이다.
- Claude Artifact 미리보기 자체는 코드와 완전히 분리된 별도 페이지(슬라이더로
  값만 빠르게 확인하는 용도)라 저장소에는 포함되지 않는다 — 실제 코드 반영은
  위 네 가지 변경뿐이다.

`test_absence_report_signlayout.js`(새 테스트, 21개 단언)로 (1) `.ov-sign-name`의
`margin-left`가 글꼴 크기 대비 0.3em 이하로 줄었는지(기존 2.1em에서 뒤집힘), (2)
`.ov-sign-box`(옛 flex 래퍼) 클래스가 더 이상 전혀 안 쓰이고 이름·서명이 각각
독립된 `position:absolute` 요소로 렌더링되는지, (3) 학생/보호자 두 줄 모두 서명
이미지의 실제 화면 중심 좌표가 측정해둔 "(인)" 글자 중심과 3px 이내로 일치하는지
(픽셀 단위로 직접 검증), (4) 서명 박스 높이가 기존 줄 높이의 최소 1.5배 이상으로
커졌는지, (5) 담임확인서(상세) 화면에서 날짜 "26"의 실제 font-size가 옛
factor(0.79)가 아니라 새 factor(0.70)와 일치하는지, (6) 서명 캔버스의
`ctx.lineWidth`가 3.0 이상(기존 2.6에서 늘어남)인지, (7) 아직 아무도 서명하지
않은 상태에서는 이름 span·서명 이미지 박스 없이 점선 빈칸(`.ov-sign-empty`)
2개만 뜨는지(새 구조에서도 빈 상태가 깨지지 않는지) — 모두 확인했다. 기존
`test_absence_report.js`(33개)/`test_absence_report_fontsize.js`(15개)/
`test_absence_report_hidpi.js`(17개)/`test_absence_report_tweaks.js`(14개)도
전부 다시 돌려 회귀가 없음을 확인했다 — 총 100개 단언.

## `absence-report.html` 후속 미세조정 4회차 — 글자가 잘리는 진짜 원인(세로 clip), 서명 위치/모달 스크롤 고정, 인쇄 미리보기 버그 두 건

3회차 배포 후 "계속 글씨가 잘려"라는 보고가 또 들어왔다 — 처음엔 캐시 문제로 추정해
새로고침을 안내했지만 틀렸다. 뒤이은 "사유 글씨도 잘려... 글씨 배경을 투명으로 할
수는 없어? 그러면 덜짤릴거 같은데"라는 단서로 다시 코드를 들여다봐서, 그동안 여러
라운드에 걸쳐 가로 넘침(`fitOverlayText()`의 `scrollWidth`/`clientWidth` 비교)만
고치고 있었을 뿐 **세로 방향 잘림은 애초에 검사한 적이 없다**는 걸 발견했다.

**진짜 원인**: `.ov-text{ line-height:1; ... overflow:hidden; display:flex;
align-items:center; }`인 요소에서, factor(그 칸의 높이에 곱하는 배수)가 `1.0`을
넘으면 **항상, 필연적으로** 세로로 잘린다 — `line-height:1`이면 줄 높이가 곧
font-size이고, factor>1.0이면 font-size가 그 칸 자신의 CSS 높이(`box.h × scale`)
보다 커지므로, `overflow:hidden`+`align-items:center`가 위아래를 똑같이
깎아낸다. 이건 폰트가 로드됐는지, 어떤 글자인지, 화면이 뭔지와 전혀 무관한 순수
기하학적 버그라 — 그동안 "캐시", "폰트 로딩 지연" 등으로 짐작했던 게 전부
틀렸었다. 당시 공용 factor가 `1.08`(세 군데: `fieldText`/`fieldCheck`/
`fieldSign`의 이름 칸 기본값)이라 매번 잘렸던 것. **고쳐서** `OV_TEXT_FACTOR =
0.94`(1.0 이하로 안전하게)라는 새 공용 상수를 만들어 세 군데의 하드코딩된
`1.08`을 전부 교체했다.

**두 번째로 발견한 숨은 버그**: 같은 원리로 다시 검증하다가, `.ov-check`/
`.ov-sign-name` 두 CSS 규칙에 `.ov-text`와 달리 `line-height:1`이 빠져있는 걸
발견했다 — `body`의 기본값(1.5)을 그대로 물려받아, 실제 잘림 비율이
`factor×1.5`였다(`0.94×1.5=1.41`, 여전히 한참 잘림). 체크 표시/서명 이름 칸에
명시적으로 `line-height:1;`을 추가해 고쳤다.

**서명 위치**: 3회차에서 "(인)" 글자 위에 수학적으로 정확히 중심을 맞췄는데도
"서명이 너무 아래로 들어가서" 보인다는 재보고 — 확대된(줄 높이의 1.8배) 서명
박스의 아랫부분이 보호자 줄 바로 아래의 각주 줄과 너무 가까워 보이는 게 원인이라
판단해, `studentSignImg`/`guardianSignImg`/`teacherSignImg`의 `y`를 각각 네이티브
20px씩 위로 옮겼다(기존 간격 계산상 위 줄/서로 다른 서명끼리 겹치지 않는 여유
안에서).

**서명 모달이 모바일에서 뒤쪽 화면과 같이 흔들리던 버그**: `#signModalOverlay`는
`position:fixed`였지만, 뒤쪽 `document.body`는 평소처럼 스크롤 가능한 채로
남아있었다 — iOS Safari에서 `position:fixed` 오버레이 뒤로 배경이 스크롤되면
화면 전체가 떠는 것처럼 보이는 잘 알려진 문제다. `lockBodyScroll()`/
`unlockBodyScroll()`(현재 `scrollY`를 저장해두고 `body`를 `position:fixed; top:
-그값px`로 통째로 고정했다가, 모달을 닫을 때 원래 스크롤 위치로 되돌리는 표준
패턴)을 추가해 `openSignModal()`/`closeSignModal()`에 각각 연결했다 — 모달이
열려있는 동안은 배경 자체가 스크롤할 대상이 없어져 완전히 고정된다.

**인쇄/PDF 미리보기에서 글자가 거의 안 보일 만큼 작게 나오고, nav.js의 떠다니는
UI(홈/사람/검색/로그아웃 아이콘)까지 같이 찍히던 버그 — 둘 다 이번 회차에서
함께 고쳤다.**
- **글자가 작아지는 진짜 원인**: `printReport()`가 `#printArea.innerHTML`을
  채운 직후 곧바로 `observeOverlayFonts(area)`를 호출하는데, 그 시점의
  `#printArea`는 아직 화면 쪽 CSS(`display:none`)가 그대로 적용된 상태다 —
  `getBoundingClientRect()`는 `display:none` 요소(와 그 자손 전부)에 대해
  항상 **폭 0**을 돌려주므로, `--ov-scale`이 그 함수의 바닥값(`0.05`)으로
  떨어져 전체 양식 글자가 거의 안 보일 만큼 작게 계산됐다 — 사용자가 짚은
  "이름 글씨가 너무 작고"는 사실 모든 글자에 공통된 증상이었다(이름이 가장
  먼저 눈에 띄었을 뿐). `window.print()` 앞의 80ms `setTimeout`도 이 문제를
  전혀 못 고쳤던 이유는, 실제 인쇄 레이아웃(폭이 실제로 640px로 잡히는 그
  순간)은 브라우저의 별도 인쇄 렌더링 패스에서 일어나고, 그 전까지 스크립트가
  볼 수 있는 DOM은 여전히 화면 쪽 `display:none` 상태라서다. **고쳐서**
  `#printArea`를 `display:none` 대신 `position:fixed; left:-99999px;
  visibility:hidden; width:700px;`로 바꿨다 — 화면에는 전혀 안 보이고
  페이지 레이아웃에도 영향이 없지만(고정 위치로 화면 밖에 치워둠), 요소
  자체는 항상 실제로 배치돼 있어 `getBoundingClientRect()`가 언제든 올바른
  치수를 돌려준다. `.form-overlay-wrap{width:100%; max-width:640px}`이므로
  `#printArea`의 너비를 680px보다 넉넉하게(700px) 주면, 그 안의 wrap은 늘
  640px로 캡핑된다 — 이게 바로 실제 인쇄 시(A4/Letter 등 표준 용지 폭 모두
  680px보다 넓음)에도 그대로 적용될 값과 정확히 같다. 덕분에 `printReport()`
  는 어떤 특수 처리도 없이 화면의 상세보기 패널과 똑같은
  `observeOverlayFonts()` 경로만으로 올바른 글자 크기를 계산하고, 긴 보호자
  이름 등에 대한 `fitOverlayText()`의 자동 축소 안전장치도(그 요소들이 더
  이상 `display:none`에 가려 있지 않으므로) 인쇄 시에도 정상적으로 동작한다.
  `@media print`의 `#printArea` 규칙도 `position:static; visibility:visible;
  width:auto;`로 되돌려, 실제 인쇄될 때는 평범한 블록으로 페이지를 채운다.
- **nav.js UI 숨김**: `mock-interview.html`/`grade-estimate.html`이 이미 쓰는
  패턴(`[class^="gsnav-"], [class*=" gsnav-"]{ display:none !important; }`)을
  이 페이지의 `@media print` 블록에도 추가했다 — 이 저장소의 거의 모든
  페이지가 로드하는 `nav.js`는 홈/나의 페이지/검색/로그인 배지를
  `position:fixed`로 띄우는데, `absence-report.html`의 기존 인쇄 CSS는
  `.wrap`(앱 자신의 본문)만 숨기고 이 떠다니는 요소들은 전혀 고려하지
  않아서, 인쇄 미리보기 상단에 그 아이콘들이 그대로 찍혔다.

`test_absence_report_print_fix.js`(새 테스트, 13개 단언)로 (1) `#printArea`가
인쇄 전에도 `display:none`이 아니라 화면 밖에 치워진 채 항상 레이아웃돼 있는지,
(2) 실제로 "🖨 인쇄 / PDF로 저장"을 눌렀을 때 `.form-overlay-wrap`의 실측
폭이 0이 아니라 정확히 640px로 캡핑되는지, (3) `--ov-scale`이 옛 버그값
(0.05)이 아니라 `640/2480`과 정확히 일치하는지, (4) 그 결과 이름 칸의
font-size가 읅을 수 있는 정상 크기(공식과 일치, 5px 초과)로 계산되는지, (5)
`window.print()`가 실제로 호출되는지, (6) print 미디어로 전환하면 모든
`gsnav-*` 요소가 `display:none`으로 계산되고 `#printArea`는 보이고 `.wrap`은
숨겨지는지, (7) 전체 흐름에 JS 에러가 없는지 — 모두 확인했다. 기존
`test_absence_report.js`(33개)/`test_absence_report_fontsize.js`(15개)/
`test_absence_report_hidpi.js`(17개)/`test_absence_report_tweaks.js`(14개)/
`test_absence_report_signlayout.js`(21개)/
`test_absence_report_vclip_scrolllock.js`(12개)도 전부 다시 돌려 회귀가
없음을 확인했다 — 총 125개 단언.

## `absence-report.html` 후속 미세조정 5회차 — 인쇄 시 실제 물리 크기를 원본 PDF(A4)와 정확히 일치시킴, 담임확인서 화면에 학생·보호자 즉석 서명 버튼 추가

사용자 요청 둘: "인쇄했을때의 크기도 양식 pdf와 동일해야 해. 양식 pdf와 동일하게
인쇄되면서 내용만 채워지는걸 원한거야" / "담임교사 확인서 작성에서도 학생 서명
학부모 서명을 누르면 이름 서명 창이 뜨게 해줘. 선생님이 직접 서명시키는것도 가능하거".

**① 인쇄 물리 크기를 A4로 고정.** 지금까지 `@media print`는 `#printArea`의
`position`/`visibility`만 되돌릴 뿐, 실제 용지 크기(`@page`)나
`.form-overlay-wrap`의 폭을 전혀 지정하지 않았다 — 화면용 CSS
(`max-width:640px`)가 인쇄 시에도 그대로 적용돼, 브라우저가 알아서 어떤 용지
크기로 스케일하든 실제 종이 위 물리 크기가 `absence-report-form.png`의 원본
A4(2480×3505px @300dpi ≈ 210mm×297mm) 페이지와 정확히 같다는 보장이 없었다.
**고쳐서** `@media print` 안에 `@page{ size:A4; margin:0; }`를 추가해 용지
자체를 여백 없는 A4로 고정하고, `.form-overlay-wrap`도 화면용 `max-width:
640px` 대신 `width:210mm; height:297mm; max-width:none;`으로 덮어써서 양식
이미지가 용지 전체를 꽉 채우도록 했다(`object-fit:contain`이 이미지 자체
비율을 지켜주므로, `aspect-ratio:1653/2337`과 실제 A4 비율의 0.05% 미만
차이는 눈에 띄지 않는다). `#printArea`의 인쇄 시 `padding`도 `20px`→`0`으로
낮춰, 양식 밖에 불필요한 여백이 더해지지 않게 했다.

**"출력일: ..." 타임스탬프도 제거했다** — `printReport()`가 양식 이미지 위에
그 한 줄을 추가로 인쇄하고 있었는데, 원본 양식에 없는 내용이 한 줄 늘어나면
전체 인쇄 콘텐츠 높이가 A4 한 장을 넘기거나(2쪽으로 넘어감) 적어도 시작
위치가 밀려서, "양식 pdf와 동일하게 인쇄되면서 내용만 채워지는" 요구와
어긋난다 — `printReport()`는 이제 `renderOverlay(r, true)` 결과만 `#printArea`
에 넣는다, 그 외 어떤 것도 더하지 않는다.

**② 담임확인서 작성(`renderDetail`) 화면에도 학생/보호자 즉석 서명 버튼.**
기존엔 학생/보호자가 서명하려면 반드시 공개 링크(`?id=...`)를 별도로 받아서
열어야 했고, 담임교사 서명(`.d-sign-teacher`)만 관리 화면 안에서 바로 가능했다
— 선생님이 학생/보호자를 교무실·상담실 등에서 직접 마주하고 있을 때도 매번
링크를 따로 공유해야 했다. `renderDetail()`에 "🧑‍🎓 학생 서명"/"👪 보호자 서명"
두 섹션(공개 서명 화면과 같은 `signLine()` 완료 표시 + 미서명 시 "✍️ 서명하기"/
서명됨 시 "다시 서명하기" 버튼)을 양식 미리보기와 "담임확인서 작성" 폼 사이에
추가했다. 클릭하면 공개 화면이 쓰는 것과 **완전히 같은** `openSignModal(reportId,
'student'|'guardian', prefillName, onDone)` 경로를 그대로 재사용한다 — 이
role들의 실제 쓰기는 `absence_report_sign` RPC를 거치는데, 그 RPC는
`anon`/`authenticated` 둘 다에 열려 있는(공개 링크를 전제로 설계된) 함수라
로그인한 교사 세션에서 호출해도 그대로 동작하고, 비밀번호 같은 별도 인증도
필요 없다 — 새 RPC/권한 변경이 전혀 필요 없었다.

`signLine(label, name, signedAt)` 헬퍼(기존엔 `initPublicView()` 안에만 있던
지역 함수)는 `escapeHtml`/`fmtDateTime`만 참조하는 순수 함수라, 두 화면이
공유할 수 있게 모듈 최상위(`openSignModal`/`closeSignModal` 등록 바로 다음)로
옮기고 `initPublicView()` 안의 중복 정의는 지웠다.

`test_absence_report_printsize_quicksign.js`(새 테스트, 22개 단언)로 (1)
`@page{size:A4; margin:0}`가 실제로 스타일시트에 들어있는지, (2)
`.form-overlay-wrap`의 인쇄 전용 override가 `width:210mm`/`height:297mm`/
`max-width:none`을 갖는지, (3) "🖨 인쇄"를 눌러도 `#printArea`에 "출력일"
문구가 더 이상 없는지, (4) print 미디어로 전환하면 `#printArea`의 패딩이
0이고 `.form-overlay-wrap`의 실제 computed 폭이 210mm(≈793.7px @96dpi)와
일치하며 `max-width`가 `none`으로 풀려있는지, (5) 담임확인서 패널에 학생/
보호자 서명 버튼이 (기존 담임교사 서명 버튼과 함께) 모두 있는지, (6) 학생
서명 버튼을 누르면 학생 이름이 미리 채워진 서명 모달이 뜨고, 실제로 캔버스에
그려 확인하면 `absence_report_sign` RPC가 `p_role:'student'`로 정확히 한 번
호출되며, 서명 후 패널이 "학생 서명 완료"+재서명 버튼으로 다시 그려지는지,
(7) 보호자 서명 버튼도 같은 방식으로 동작하는지, (8) 전체 흐름에 JS 에러가
없는지 — 모두 확인했다. 기존 `test_absence_report.js`(33개)/
`test_absence_report_hidpi.js`(17개)/`test_absence_report_tweaks.js`(14개)/
`test_absence_report_fontsize.js`(15개)/`test_absence_report_signlayout.js`
(21개)/`test_absence_report_print_fix.js`(12개)/
`test_absence_report_vclip_scrolllock.js`(12개)도 전부 다시 돌려 회귀가 없음을
확인했다 — 총 147개 단언.

## `absence-report.html` 5회차 — 서명 입력칸 확대, 양식 배경 이미지를 사용자가
## 직접 만든 두 번째 PDF(날짜 칸 간격 넓힘)로 전면 교체, 손글씨 예시를 참고한
## 굵기·크기 재조정

사용자가 세 가지를 순서대로 요청했다: "서명 입력칸 높이 두배로 해줘", "내가
만든 예시 양식인데, 글씨 크기, 위치, 굵기 등 참고해서 정리해봐"(실제로 손으로
작성한 결석신고서 사진을 함께 보냄), 마지막으로 "양식 파일 이걸로 교체. 날짜
쓰는 곳 간격을 좀 넓혔어"(새 PDF 파일 첨부).

- **서명 입력칸**: `#signCanvas`의 CSS `aspect-ratio`를 `700/200`(3.5:1)에서
  `700/400`(1.75:1)로 바꿔 세로 높이를 정확히 2배로 키웠다 — 캔버스 `width`/
  `height` 속성(`700×200`→`700×400`)과 `setupSignatureCanvas()`의 clientHeight
  폴백 비율도 함께 맞췄다. `clientWidth`/`clientHeight` 기반으로 HiDPI 백킹
  버퍼를 다시 잡는 로직(이미 있던 것) 자체는 손대지 않았다 — CSS 종횡비만
  바꾸면 그 로직이 자동으로 2배 큰 비트맵을 잡는다.

- **양식 배경 이미지 전면 교체**: 사용자가 보내준 새 PDF(한글 2022로 만든,
  첫 PDF와 똑같은 A4/595×841pt 구조지만 모든 날짜 빈칸의 가로 간격을 넓힌
  버전)를 `pdftoppm -r 300 -png`로 래스터화하니 기존과 정확히 같은
  2480×3505px가 나와서 — `absence-report-form.png`를 그대로 덮어썼다(파일명
  변경 없음, HTML 쪽 `<img src>` 수정 불필요). `FIELD_BOXES`의 모든 좌표를
  **처음부터 다시** 뽑았다 — `pdftotext -bbox -r 300`으로 이 새 PDF의 모든
  단어 bbox를 추출해, 단어와 단어 사이 빈칸(예: "20"과 "년" 사이)을 그
  칸의 좌표로 역산하는 기존 방식(이 문서 위쪽 "Google 시트는 일회성 시드
  소스였을 뿐"류 섹션들과 같은 "추측 대신 실측" 원칙)을 그대로 따랐다. 실제로
  달라진 폭: `submitYear` 49.9→88.9px, `submitMonth` 75.0→93.9px, `confirmYear`
  49.9→69.0px 등 날짜 칸들이 눈에 띄게 넓어졌고(사용자 말대로), `reason`
  (사유) 칸은 오히려 244.0→176.4px로 약간 좁아졌다 — 날짜 칸만 넓힌 것이지
  전체를 균등하게 넓힌 게 아니라는 뜻이라, 섣불리 old FIELD_BOXES에 오프셋만
  더하는 식으로 패치하지 않고 전부 새로 뽑은 이유이기도 하다. 줄 높이
  (~49.9~50.0px)는 두 PDF가 거의 동일해, 세로 위치는 기존과 크게 다르지
  않았다.

- **글씨 크기 재조정 — "1포인트만 더 크게"를 수학적 안전 한계까지 다시
  검증.** 이전 세션(압축 전)에서 학번(`grade`/`classNo`/`no`)·이름(`name`)
  칸의 `h`를 49.9→55.4(+5.5 native px)로 키워 "+1pt"를 정확히 맞췄다고
  판단했었는데, 이번에 Playwright로 `scrollHeight`/`clientHeight`를 직접
  스윕해보니 그 크기에서 일부 글자(박도영, 2 등 실제 들어가는 값)가 기존
  `reason` 필드 등 다른 칸들이 보이는 "정수 px 반올림 노이즈"(최대 1px 차이,
  `OV_TEXT_FACTOR=0.94`가 원래부터 안고 있던 것으로 이미 문서화됨)를 넘어
  2px 차이를 보이는 걸 확인했다 — `factor`(1.0 이하여야 한다는 기존 하드
  룰)는 그대로 0.94를 유지한 채였는데도, 절대 폰트 크기가 커질수록 이 반올림
  충돌이 더 자주 발생한다는 뜻이었다. `h`를 49.9~90 사이로 스윕하며 안전한
  "구간"(diff가 다른 필드들과 같은 ≤1 수준으로 돌아오는 h 값)을 찾아보니
  h≈52.5~53.3에서 다시 diff=1로 돌아오는 좁은 창이 있어, 그 중간값인
  **h=52.9**(Δh=+3.0, 기존 55.4보다 보수적)로 낮췄다 — "1포인트만"이라는
  요청 자체가 "그 이상 넘기지 말라"는 취지였으므로, 수학적으로 더 안전한
  작은 증가분을 선택한 것은 요청과 모순되지 않는다. **다만 이 DOM
  스크린샷 없이 `scrollHeight`/`clientHeight` 수치만으로 안전 여부를 판단하는
  건 신뢰할 수 없다는 것도 이번에 직접 확인했다** — 체크박스 요소(`.ov-check`)
  세 개는 여전히 diff=2를 보이는데(기존부터 있던 값, 이번에 건드리지 않음),
  실제 2배 DPI 스크린샷을 찍어 크롭해서 보니 체크마크(✓)는 전혀 잘리지 않고
  깨끗하게 박스 안에 들어가 있었다 — `scrollHeight`/`clientHeight` 차이는
  CJK 폰트의 flex 레이아웃에서 발생하는 서브픽셀 반올림 아티팩트일 뿐, 실제
  시각적 클리핑과 직접 대응하지 않는다는 뜻이다. 앞으로 이 페이지의 글자
  크기를 또 조정할 일이 있으면, `scrollHeight`/`clientHeight` 비교는
  "참고용 1차 신호"로만 쓰고 **반드시 실제 스크린샷으로 육안 확인**할 것 —
  이번 세션에서 가장 크게 바뀐 검증 방법론이다.

- **학번/사유/날짜를 굵게 — 사용자가 보내준 손글씨 예시를 참고.** 손으로
  작성한 결석신고서 사진을 보면 "제 1학년 3반 5번"의 숫자, "독감"(사유),
  결석 기간/제출일 날짜들이 또렷하게 굵은 글씨(마커펜 느낌)로 강조돼 있는
  반면, 담임확인서의 확인일자(2026년 10월 24일)와 서명란의 이름(학생/보호자/
  담임교사)은 상대적으로 평범한 굵기로 적혀 있었다 — 이 구분을 그대로
  디지털 오버레이에 반영했다. 새 CSS 클래스 `.ov-text.ov-emphasis{
  font-weight:800; }`(기존 `.ov-text`의 기본 `font-weight:600`보다 굵게)를
  `fieldText()`의 기존 `extraClass` 파라미터(이름 칸 자간을 위해 이미 있던
  메커니즘, `.ov-name-field`와 같은 구조)로 `grade`/`classNo`/`no`/`reason`/
  `startYear`~`days`(결석 기간)/`submitYear`~`submitDay`(제출일) 전부에
  적용했다. **`confirmYear`~`confirmDay`(확인일자)와 서명 이름들
  (`.ov-sign-name`, 학생/보호자/담임교사 전부)은 의도적으로 건드리지
  않았다** — 손글씨 예시에서도 이 두 영역은 평범한 굵기였기 때문. 크기(h)는
  날짜/사유 필드 모두 건드리지 않았다(이미 새 양식의 넓어진 칸 폭 덕분에
  여유가 있어, 폰트 크기까지 키울 필요 없이 굵기만으로도 예시의 "강조된
  느낌"을 충분히 재현할 수 있었다 — 실제 스크린샷으로 비교 확인).

- **검증**: `/opt/pw-browsers/chromium`으로 (1) 전체 폼 오버레이 스크린샷을
  2배 DPI로 찍어 손글씨 예시와 나란히 비교(학번/성명/사유/기간 모두 또렷하게
  굵고, 확인일자/서명란은 차분한 굵기로 대비되는 것을 육안 확인), (2) 모든
  `.ov-text`/`.ov-check`/`.ov-sign-name` 요소의 `scrollHeight - clientHeight`
  를 스윕해 1px를 넘는 필드가 없는지(체크박스 3개 제외 — 위에서 설명한
  기존부터 있던, 스크린샷으로 무해함을 확인한 서브픽셀 노이즈), (3) 가로
  `scrollWidth`/`clientWidth` 역시 1px 이내인지(새로 넓어진 날짜 칸들
  덕분에 `fitOverlayText()`의 자동 축소가 거의 발동하지 않음), (4)
  `grade`/`reason`이 실제로 `font-weight:800`, `confirmDay`는 `600`으로
  정확히 구분 렌더링되는지, (5) 서명 캔버스가 여전히 2배 높이(종횡비
  1.75)로 유지되는지, (6) JS 에러 없음 — 모두 확인했다. 이번 라운드는
  배경 이미지 자체가 바뀌어 과거 라운드들의 정확한 네이티브 좌표 단언을
  그대로 재사용할 수 없으므로, 기존 `test_absence_report*.js` 스위트
  (147개 단언)는 이번 세션에서 재실행하지 않았다 — 다음에 이 페이지를
  다시 만질 때는 좌표 관련 하드코딩 단언들을 이 새 `FIELD_BOXES` 값
  기준으로 다시 써야 한다는 것을 기억해둘 것.

## `absence-report.html` 후속 미세조정 6회차 — 실제 인쇄 글씨 전반 확대 + 인쇄 중 로그인 배지 노출 버그

실제 인쇄로 뽑아본 결과("PDF 파일로 저장" 네이티브 공유 시트) 스크린샷과 함께 피드백을 받았다:
"실제 인쇄에서 서명은 잘 들어가는거 같고 글씨 크기는 전반적으로 조금 크게. 인쇄할때 로그아웃
버튼이 나와" — 바로 전 라운드(5회차)의 서명 위치 미세조정(이름 더 오른쪽/체크 표시 위·오른쪽)
요청은 실제 인쇄 결과를 보고 "서명은 잘 들어간다"로 확인되면서 자연히 보류됐고, 이번엔 (1)
전체 글씨 크기를 좀 더 키우고, (2) 인쇄물 매 페이지 상단에 찍히는 "OOO님 로그아웃" 배지를
없애는 두 가지만 처리했다.

**① 전체 글씨 크기 확대** — `OV_TEXT_FACTOR`(일반 텍스트/체크 표시/서명 이름) `0.94`→`0.98`,
`DATE_NUM_FACTOR`(날짜 숫자) `0.85`→`0.92`로 올렸다. 둘 다 여전히 "factor는 반드시 1.0 이하"라는
기존 세로-잘림 방지 불변식 아래에 있어 안전하다. 반영 후 `scrollHeight - clientHeight`가 일부
칸(특히 `.ov-check`)에서 최대 +2px로 측정됐는데 — **옛 0.94/0.85 기준에서도 체크 표시 요소만큼은
이미 +2px가 나오고 있었음을 직접 되돌려 재측정해 확인했다**(Noto Sans KR 폰트의 줄 상자 자체가
`scrollHeight`/`clientHeight` 계산에서 서로 다르게 반올림되는, 폰트 자체의 고유한 아티팩트 —
글꼴/뷰포트와 무관한 순수 기하학적 잘림이라는 기존 "factor>1.0은 항상 잘린다"는 불변식과는
별개의, 훨씬 작은 반올림 노이즈) — 그래서 이 ±2px는 "잘림"의 지표로 보지 않고,
`deviceScaleFactor:2~3` 스크린샷으로 학번/이름/사유/날짜/체크 표시/좁은 "보호자( )" 자유입력
칸까지 전부 직접 눈으로 확인해 실제로는 어떤 글자·체크 잉크도 잘리지 않음을 검증했다(기존
문서의 "scrollHeight-clientHeight>1만으로는 실제 시각적 잘림을 판단할 근거가 못 된다 — 반드시
스크린샷으로 확인해야 한다"는 원칙을 그대로 따른 것).

**② 인쇄 시 로그인 배지 노출 버그.** 사용자가 보낸 네이티브 PDF 공유 시트 스크린샷에, 결석신고서
본문 위에 "김흥석님 로그아웃" 코너 배지가 매 페이지(1/2, 2/2 모두)에 찍혀 있었다 — 기존
`@media print`는 `nav.js`가 띄우는 `gsnav-*` 클래스 묶음(햄버거/검색/로그인 배지)만 숨기고
있었는데, 실제로 화면 우상단에 떠 있던 "OOO님 로그아웃" 배지는 **`nav.js`가 아니라 완전히
별개의 스크립트인 `site-login-badge.js`**(id=`site-login-badge`, `gsnav-` 접두사 전혀 없음 —
이 저장소 CLAUDE.md 상단의 "Two small shared scripts... nav.js(햄버거+챗봇)와
site-login-badge.js(코너 로그인 배지)" 설명 그대로 서로 다른 두 스크립트)가 그리는 것이었다 —
그래서 기존 `[class^="gsnav-"], [class*=" gsnav-"]{ display:none !important; }` 규칙이 전혀
걸러내지 못했다. `@media print` 블록에 `#site-login-badge{ display:none !important; }`를
추가해 고쳤다 — 화면에서는 평소처럼 보이고, 인쇄/PDF 저장 시에만 숨겨진다.

`test_absence_report_fontsize2_loginbadge.js`(새 테스트)로 (1) 이름 칸 factor가 실제로
0.98(옛 0.94에서 상승)로 측정되는지, (2) 날짜 숫자 factor가 0.92(옛 0.85)로 측정되는지, (3) 어떤
칸도 알려진 ~2px 반올림 아티팩트를 넘는 수준으로 넘치지 않는지(= 진짜 잘림 없음), (4)
`#site-login-badge`가 화면에선 정상적으로 존재하는지(배지 자체가 로드됐는지 sanity 확인), (5)
print 미디어로 전환하면 그 배지가 `display:none`으로 계산되는지, (6) 화면 미디어로 되돌리면
다시 보이는지(회귀 없음) — 모두 확인했다. 기존 `test_absence_report*.js` 9개 파일(147개+ 단언,
단일/최종 서명 흐름·HiDPI 서명 캔버스·인쇄 A4 물리 크기·빠른 서명 버튼·서명 레이아웃·날짜/체크
위치·세로 잘림 방지·배경 스크롤 잠금 등)도 전부 다시 돌려 확인했다 — 그 중 몇 개는 이번 factor
상승으로 하드코딩돼 있던 옛 0.94/0.85 기댓값, 그리고 "이름 칸 높이는 49.9"라는 더 오래된(실제론
학번·이름 칸만 52.9로 커진 뒤의) 전제가 깨져 있었던 걸 발견해 전부 최신 값으로 맞춰
갱신했다(실제 코드 변경과 무관한, 테스트 자신의 기댓값만 최신화) — 그 과정에서 `test_absence_
report_signlayout.js`의 서명 이미지 중심 좌표 단언과 `test_absence_report_tweaks.js`의 "세
연도 칸이 완전히 같은 폰트 크기"라는 단언 두 가지는, 이번 세션의 변경과 무관하게 **이미 그 전
라운드(날짜 칸 간격을 넓힌 새 PDF 양식 교체 라운드)부터 조용히 깨져 있던 전제**였다는 것도 함께
확인했다 — 전자(서명 이미지 좌표)는 그 라운드에서 `FIELD_BOXES.*SignImg`가 재조정됐지만 이
스크래치패드 테스트 파일에는 반영이 안 됐던 것이었고, 후자(연도 칸 폰트 크기 완전 일치)는 같은
라운드에서 날짜 칸들의 네이티브 높이가 전부 49.9로 통일돼 있지 않고(사유/결석기간 행은
h:50.0, 제출일/확인일자 행은 h:49.9) 처음부터 미세하게 달랐던 것이 원인 — 둘 다 이번 세션이
만든 회귀가 아니라 발견 당시 이미 존재하던 테스트 자신의 낡은 기댓값이라, 코드는 그대로 두고
테스트의 허용 오차·기댓값만 현재 상태에 맞게 고쳐 전부 그대로 통과시켰다.

## `absence-report.html` 후속 미세조정 7회차 — 모바일 화면이 인쇄 미리보기보다 훨씬 작게 보이던
## 진짜 원인(카드 3겹 중첩 패딩) + 서명 이름/사유·기간/제출·확인 날짜 위치 미세조정

사용자가 "웹페이지에서 볼때랑 인쇄 미리보기가 모양이 달라 글씨 크기도 그렇고"라고 보고하며
실제 폰 스크린샷(관리자 상세보기 — 서명 두 줄이 거의 붙어 보일 만큼 작게 렌더링됨)과 인쇄
미리보기 스크린샷(훨씬 크고 선명하게 분리돼 보임)을 함께 보내왔다. Playwright로 실제 가짜
서명 이미지(학생/보호자 구분되는 색의 더미 PNG)를 넣고 414px 모바일 뷰포트에서 양쪽을 직접
측정해 원인을 확정했다 — `fieldSign()`의 서명 이미지 박스 좌표 자체(학생/보호자 칸 사이 간격
99.9 네이티브px, 박스 높이 89.8px)는 화면·인쇄 양쪽에서 완전히 같은 비율이라 로직 버그가
아니었다. 진짜 원인은 `.form-overlay-wrap`을 감싸는 컨테이너가 관리자 화면에서는
`.wrap`(패딩 36px 20px)→`.card`(패딩 18px 20px)→`.report-detail`(패딩 14px) **세 겹**
중첩 패딩을 거치는데, 인쇄는 `@media print`가 `.form-overlay-wrap`을 항상 A4 물리 폭
(210mm≈794px)으로 강제 override해 그런 중첩 패딩의 영향을 전혀 안 받는다는 것 — 그 결과
414px 폰 화면에서 실측한 오버레이 실제 렌더링 폭이 겨우 **298px**(뷰포트의 72%)까지
줄어들어, 글자·서명·체크 표시가 전부 `--ov-scale` 기반 반응형이라 비율 자체는 인쇄와
똑같은데도 절대 크기가 훨씬 작아 학생/보호자 서명(네이티브 간격이 원래도 빠듯함)이 거의
붙어 보일 만큼 두드러지게 작게 보였다.

**고쳐서** `.form-overlay-wrap`에 school-status.html의 "roster-wide-card"와 같은 풀블리드
트릭을 `@media (max-width:560px)`(기존 `.confirm-grid` 미디어쿼리와 같은 브레이크포인트)
안에만 적용했다 — `max-width:none; width:calc(100vw - 24px); margin-left/right:calc(50% -
50vw + 12px);`로 몇 겹이 중첩됐든 그 패딩들을 전부 벗어나 뷰포트 폭에 거의 가깝게 쓴다.
414px 뷰포트에서 실측 재확인: 298px → **390px**(뷰포트-24px, 딱 맞음), 이름 칸 글자
크기도 5.88px → 7.69px로 약 31% 커졌다. 데스크톱(>560px)은 이 미디어쿼리 밖이라 기존처럼
`max-width:640px` 그대로 유지된다(회귀 없음, 테스트로 확인). `.wrap`/`.card` 등 다른
요소의 패딩은 건드리지 않았다 — `.form-overlay-wrap` 하나만 벗어나게 하는 게 가장 작은
변경 범위였다.

같은 메시지 전에 받았던 네 가지 요청도 함께 반영했다 — 전부 좌표/스타일 숫자 조정뿐이라
구조 변경은 없다:
- **"서명 옆에 이름 조금 더 오른쪽으로"**: `.ov-sign-name`의 `margin-left`를 0.2em(이름/서명을
  완전히 분리된 좌표로 재설계했던 지난 라운드에서 "학 생:"/"보 호 자:" 라벨에 너무 바짝
  붙어있던 걸 처음 떼어낸 값)에서 **0.6em**으로 더 올렸다.
- **"사유랑 기간 살짝만 더 아래로"**: `reason`/`startYear`~`days`(결석 기간) 행의 네이티브
  `y`를 1191.2 → **1197.2**(+6px)로 내렸다. 한 라운드 전 "조금 더 위로"로 8px 올렸던
  걸(1199.2→1191.2) 이번엔 "살짝만"이라는 표현에 맞춰 그 절반 정도인 6px만 다시 내렸다.
- **"학생 제출 날짜도 살짝 더 위로"**: 결석신고서 자신의 "20__년 __월 __일" 제출 연월일
  (`submitYear`/`submitMonth`/`submitDay`)의 `y`를 1478.9 → **1472.9**(-6px)로 올렸다.
- **"담임 제출 날짜... 살짝 더 위로"**: 담임확인서의 확인일자(`confirmYear`/`confirmMonth`/
  `confirmDay`)의 `y`를 2873.9 → **2867.9**(-6px)로 올렸다 — "담임 제출 날짜"는 담임확인서
  섹션 자신의 날짜 줄(확인일자)을 가리키는 것으로 해석했다(결석신고서 쪽 제출일은 바로 위
  "학생 제출 날짜"가 이미 가리키므로).

**"글씨크기 버전 다르게 해서 예시보여줘 그중에 고를게. 각각 몇포인트인지 알려주고"**는 코드를
먼저 바꾸지 않고, 실제 파일을 복사해 `OV_TEXT_FACTOR`/`DATE_NUM_FACTOR`만 세 가지로 바꾼
임시 사본 세 개를 만들어 각각 인쇄 물리 크기(A4, 실제 pt 환산이 의미 있는 유일한 기준) 기준
스크린샷을 떠서 사용자에게 보여주고 고르게 했다 — A(작게, 0.80/0.75, 이름 9.6pt/날짜
9.0pt), B(현재 배포된 값 그대로, 0.98/0.92, 이름 11.7pt/날짜 11.0pt), C(세로 잘림이
생기지 않는 수학적 상한인 factor=1.0에 거의 닿은 최대치, 1.00/0.98, 이름 12.0pt/날짜
11.8pt). pt 환산은 `fontSize(px) ÷ (96/72)`로 계산했다 — 96dpi CSS 기준 1pt=1.333px.
**B와 C의 차이가 미미한 이유**: 지난 라운드에서 이미 "글씨 크기는 전반적으로 조금 크게"
요청으로 0.94→0.98/0.85→0.92까지 올려둔 상태라, 세로 잘림을 막는 절대 상한(factor≤1.0 —
`.ov-text`가 `line-height:1`+`overflow:hidden`이라 factor가 1.0을 넘기면 반드시 잘리는,
이 글 다른 곳에 이미 기록된 순수 기하학적 제약) 바로 아래까지 거의 다 와 있어서, 지금보다
더 키울 수 있는 여지 자체가 거의 안 남아있다 — C는 그 "거의 다 쓴 여지"의 전부다. 사용자가
실제 인쇄 미리보기(iOS 공유 시트의 PDF 미리보기) 스크린샷을 보내며 "딱 이정도면 좋겠어"로
**B(현재 배포된 값, 0.98/0.92)를 그대로 유지**하는 쪽으로 확정했다 — `OV_TEXT_FACTOR`/
`DATE_NUM_FACTOR`는 전혀 손대지 않았다. 비교용 임시 사본 두 개(A/C)와 스크린샷은 작업 후
삭제했다.

`test_absence_report_round7.js`(새 테스트)로 (1) 414px 모바일에서 오버레이 폭이 실제로
~390px(풀블리드)로 넓어지는지, (2) 1200px 데스크톱에서는 여전히 640px로 캡되는지(회귀
없음), (3) 사유/결석 기간 행이 새 y(1197.2/3505)에 있는지, (4) 학생 제출 날짜가 새
y(1472.9/3505)에 있는지, (5) 담임 확인일자가 새 y(2867.9/3505)에 있는지, (6) 서명 이름의
margin-left가 실제로 ~0.6em인지 — 모두 확인했다. 기존
`test_absence_report_tweaks.js`/`test_absence_report_latest_tweaks.js`/
`test_absence_report_vclip_scrolllock.js`/`test_absence_report_print_fix.js`도 전부
다시 돌려(이 라운드의 변경이 다른 모든 수치를 손대지 않았음을 재확인) 회귀가 없음을
확인했다.

## `absence-report.html` 7회차 — 데스크탑 화면 폭을 인쇄 물리폭(210mm)과 정확히
## 일치시킴 + 담임교사 서명 저장/재사용 기능

사용자 피드백: "웹페이지랑 인쇄 미리보기 글씨 크기가 너무 달라 웹페이지 기준으로
맞추고, 서명은 인쇄 미리보기의 위치가 더 나은거 같애" — 모바일 공개 서명 화면(폰
스크린샷, "학생 서명 완료" 배지가 보이는 그 화면)과 관리자 상세보기의 "PDF로 저장"
인쇄 미리보기(Android 공유 시트 스크린샷, 서명이 "(인)" 글자 위에 깔끔하게 올라간
모습)를 나란히 비교하며 보낸 메시지였다.

**코드/수식 자체에는 버그가 없었다 — 직접 Playwright로 증명했다.** `.form-overlay-
wrap`의 모든 좌표(FIELD_BOXES)는 전부 퍼센트 기반이고, 글자 크기(`ovFontSize()`)도
`--ov-scale`(컨테이너 실제 렌더링 폭 ÷ 2480, 단위 없는 배율) 하나를 이미지와 함께
공유해서 계산한다 — 즉 "글씨가 이미지에서 차지하는 비중"은 컨테이너 폭이 얼마든
수학적으로 항상 똑같이 유지된다. 그리고 `printReport()`가 `window.print()`를 호출하기
직전 `--ov-scale`이 실제로 새 인쇄 폭(210mm ≈ 793.7px)으로 재계산되는지도
`page.emulateMedia({media:'print'})`로 직접 측정해 확인했다(`--ov-scale`이 즉시
0.258→0.320으로 정확히 갱신됨, ResizeObserver가 늦게 따라잡는 버그는 없었다). **진짜
원인은 순전히 절대 크기 차이였다**: 인쇄는 round 5의 "양식 PDF와 동일한 물리 크기로
인쇄되어야" 요구사항 때문에 `.form-overlay-wrap`이 항상 실제 A4 물리폭(210mm ≈
793.7px)으로 렌더링되는 반면, 화면은 `.form-overlay-wrap{ max-width:640px }`에 막혀
있어(모바일은 round 7 "풀블리드" 수정 이후에도 뷰포트 폭 자체가 더 좁음) 같은 비율의
내용이 훨씬 더 작은 절대 크기로 보였다 — 게다가 폰의 PDF 미리보기 앱은 보통 그 A4
페이지를 화면을 거의 꽉 채우도록 확대해서 보여주므로, 체감 차이가 실제 비율 차이보다
훨씬 더 크게 느껴진다.

**고쳐서** `.form-overlay-wrap`의 데스크탑 `max-width`를 `640px` → `210mm`로 올려,
인쇄가 쓰는 것과 **정확히 같은 CSS 단위값**을 쓰도록 했다 — 반올림 오차 없이, 화면이
이만큼 넓을 수 있는 환경(데스크탑/태블릷)에서는 `--ov-scale`이 인쇄와 완전히
동일해지고, 따라서 글씨 크기·서명 크기·서명이 "(인)" 글자 위에 자리잡는 모습까지
전부 인쇄와 픽셀 단위로 똑같아진다 — 좌표 자체를 옮긴 게 아니라, 화면의 "보이는
크기"를 인쇄와 같은 기준으로 맞춘 것뿐이라 "서명 위치가 다르다"는 느낌도 같은
수정으로 함께 해소된다(좁은 화면에서 작게 렌더링되다 보니 이름과 서명이 더 붙어
보였을 뿐, 실제 좌표가 어긋나 있던 게 아니었다). 이 변경이 실제로 먹히려면
`.form-overlay-wrap`의 조상 요소들(`.wrap`→`.card`→`.report-item`→`.report-detail`,
관리자 상세보기가 가장 깊이 중첩된 경우)이 좌우로 빼가는 패딩 합(40+40+4+28=112px)을
빼고도 793.7px가 남아야 해서, `.wrap{ max-width:860px }`도 `960px`로 함께 올렸다
(860-112=748 < 793.7이라 모자랐음, 960-112=848로 여유 있게 담김). 모바일
(`@media max-width:560px`)의 풀블리드 규칙은 더 구체적인(specific) 미디어쿼리라
이 변경과 무관하게 그대로 동작한다 — 폰 화면 자체가 210mm보다 훨씬 좁아서, 핀치줌/
확대보기 UI 없이는 이 범위에서도 인쇄와 완전히 같은 절대 크기까지는 어차피 못
만든다는 구조적 한계는 그대로 남아있다(이번 수정으로 혜택을 보는 건 데스크탑/태블릿
화면 — 가장 깊이 중첩된 관리자 상세보기 기준으로도 1200px 뷰포트에서 793.7px 정확히
도달하는 것을 Playwright로 실측 확인했다).

**담임교사 서명 저장/재사용** — "그리고 교사 서명은 저장하고 불러와서 쓰는기능 있으면
좋겠어"라는 요청. 새 테이블 `teacher_signatures`(`owner_id uuid primary key references
auth.users(id)`, `teacher_name`, `signature_data_url`, `updated_at`) — 로그인 계정당
딱 1행, 이 저장소의 "본인 소유 데이터만" 패턴 그대로 select/insert/update/delete 전부
`auth.uid() = owner_id`로 막았다(학생/보호자 서명은 애초에 로그인 계정이 없는
"링크=권한" 모델이라 이 기능 대상이 아니다 — 담임교사 역할(`role==='teacher'`)에만
적용). `openSignModal()`이 `role==='teacher'`일 때만 비동기로 `teacher_signatures`를
조회해, 저장된 서명이 있으면 모달 안에 "📥 저장된 서명 불러오기" 버튼
(`#signUseSavedRow`)을 보여준다 — 없으면 그 자리가 숨겨져 기존 "직접 그리기" 흐름과
완전히 동일하다. 클릭하면 저장된 PNG를 `object-fit:contain`과 같은 방식으로(종횡비
유지, 캔버스 중앙에) `ctx.drawImage()`로 바로 그려 넣고, `signPad.markInk()`(새로
추가한 메서드 — 포인터로 직접 그린 게 아니라 "서명을 그려주세요" 에러 가드가 자동으로
안 켜지므로 외부에서 명시적으로 ink 플래그를 켜줘야 함)를 호출해 곧바로 "서명 완료"를
누를 수 있게 한다. **별도의 "저장" 체크박스나 버튼은 없다** — 담임교사 역할로 서명을
확정할 때마다(`btnConfirmSign`의 `currentSignRole === 'teacher'` 분기) 항상 그
이름+서명을 `teacher_signatures`에 upsert해서, 조용히 "항상 최신 서명을 캐시해둔다"는
이 저장소의 단순함 우선 원칙을 따랐다(이 upsert 실패는 조용히 무시 — 이미
`absence_reports` 쪽 서명 저장은 끝난 뒤라 전체 서명 확정 흐름을 막을 이유가 없는
순수 편의 캐시다).

Playwright(`verify_fix.js`, 로컬 UMD `@supabase/supabase-js` 번들 + 가짜 로그인
세션으로 모킹 — 이 환경의 `*.supabase.co`/CDN 아웃바운드 차단은 여전한 제약)로 (1)
1200px 데스크탑 뷰포트에서 관리자 상세보기(가장 깊이 중첩된 경우)의
`.form-overlay-wrap` 실제 렌더링 폭이 793.7px에 정확히 도달하는지(기존 640px 상한에서
확실히 늘어났는지), (2) 저장된 서명이 없으면 "불러오기" 버튼이 안 보이는지, (3)
저장된 서명이 있으면 보이고, 클릭 시 "서명을 그려주세요" 에러 없이 바로 "서명 완료"가
통과하는지, (4) 서명 확정 후 `teacher_signatures`에 정확한 payload(이름/owner_id
포함)로 upsert가 정확히 한 번 호출되는지 — 모두 확인했다. 기존
`test_absence_report*.js` 전체(11개 파일)도 다시 돌려 회귀가 없음을 확인했다 — 데스크탑
폭이 640→793.7px로 커지면서 Noto Sans KR 줄 높이 반올림 노이즈(이미 이 문서에 기록된
"scrollHeight-clientHeight 몇 px 차이는 실제 잘림이 아니다"는 교훈)도 그 비율만큼
(~2px→~3px) 커졌을 뿐이라는 걸 스크린샷으로 재확인하고, `test_absence_report_latest_
tweaks.js`의 관련 허용 오차 두 곳만 2px→3px로 맞춰 갱신했다(코드 자체의 회귀 아님) —
`test_absence_report_round7.js`의 "데스크탑은 640px로 고정된다"는 옛 단언도 이번
변경의 의도된 결과이므로 793.7px 기준으로 함께 고쳤다.

**바로 이어진 후속 요청 — "서명 옆에 이름 2em 더 왼쪽으로 보내고, 이름은 자간 조금
넓혀줘 30% 정도"는 절반만 그대로 적용할 수 있었다.** 자간(`letter-spacing`)은
요청대로 0.04em×1.3=0.052em으로 바로 올렸지만, `margin-left`를 요청 그대로
0.6em-2em=**-1.4em**으로 바꾸고 직접 스크린샷을 찍어보니 인쇄된 "학 생:"/"보 호
자:" 라벨 글자 자체와 겹쳐서 "쨍민찬"/"짐흥석"처럼 글자가 뭉개져 전혀 못 읽는
상태가 됐다 — 추측이 아니라 PIL로 `absence-report-form.png`의 실제 잉크 위치를
직접 재서 원인을 확인했다: `FIELD_BOXES.studentSign`/`guardianSign` 박스의 왼쪽
끝(x:1735.1, 네이티브) 바로 앞까지 라벨 잉크가 와 있어(라벨 끝 x≈1721), 박스가
시작되기 전에 남는 여백이 네이티브 **14.1px**(데스크탑 793.7px 렌더 기준 약
**4.5 화면px**)뿐이었다 — 글자 한 칸(1em)만 당겨도 이미 그 여백의 3~4배를
넘어서므로, 2em(그 훨씬 이상)은 이 양식 자체의 인쇄 여백상 애초에 불가능한
요청이었다. **고쳐서** `margin-left`를 박스 자신의 왼쪽 끝(라벨 뒤에 남은 여백을
전부 쓰는, 겹치지 않는 한도 내 최대로 왼쪽인 값)인 **0em**으로 되돌렸다 — 기존
0.6em보다는 왼쪽으로 옮겼지만 요청한 2em만큼은 아니다. 다시 스크린샷으로 확인해
"학　생:강민찬"/"보　호　자:김흥석"이 콜론 바로 뒤에 붙어 읽을 수 있게(겹침 없이)
나오는 것을 확인했다.

`test_absence_report_signlayout.js`의 `[1b]`/`[1c]`를 0em 기준으로(음수 아님을
확인하는 쪽으로) 고치고 자간 확인 `[1d]`를 새로 추가했으며,
`test_absence_report_round7.js`의 `[7]`과 `test_absence_report_tweaks.js`의
`[4]`도 같은 이유로 "0.6em"/"항상 양수" 기대값을 "0em"/"음수만 아니면 됨"으로
갱신했다 — 전부 이번 라운드의 의도된 변경이지 회귀가 아니다. `test_absence_
report*.js` 전체(12개 파일, verify_fix.js 포함)를 다시 돌려 모두 통과함을
확인했다.

## `absence-report.html` — 인쇄 글씨가 화면보다 작게 찍히던 버그 (`--ov-scale` 인쇄 고정)

사용자 요청: "인쇄할 때 글씨 웹페이지에서 볼 때랑 크기 같게." 오버레이 글씨는 전부
`calc(var(--ov-scale) * ...)`로 크기가 정해지고, `--ov-scale`은
`observeOverlayFonts()`의 ResizeObserver가 "양식 실제 폭 ÷ 2480"으로 넣는다.
`printReport()`는 화면 밖 `#printArea`(폭 700px - 패딩 = 660px)에 먼저 그려서 그 폭
기준으로 배율을 재 두는데, **Chrome은 인쇄용 레이아웃을 잡을 때 ResizeObserver를 다시
돌리지 않는다** — 인쇄 시 양식만 210mm(793.7px)로 커지고 배율은 660px 기준 그대로 남아,
실제 인쇄물에서 글씨가 양식에 비해 작게 찍혔다. `page.emulateMedia({media:'print'})`는
화면 렌더링이라 ResizeObserver가 정상 동작해서 이 버그가 재현되지 않는다 — 반드시
`page.pdf()`(실제 인쇄 엔진)로 재야 한다. 실측: 수정 전 글자 폭 비율이 화면보다 데스크탑
18%, 휴대폰에서 연 경우 54% 작았다(휴대폰은 사전 측정 시점의 배율이 더 작게 남음).

**고쳐서** `@media print`의 `.form-overlay-wrap`에 `--ov-scale:0.32004 !important`
(210mm ≈ 793.7px ÷ 2480)를 고정했다 — `!important` 스타일시트 값이 JS의 인라인 값보다
우선한다. 데스크탑 화면에서도 양식 폭이 210mm라 배율이 같은 0.32004가 되므로 화면과
인쇄의 글씨 크기가 일치하고, 인쇄 결과가 어느 기기에서 눌렀든 똑같아졌다(수정 후 비율 차이
1.2% = PDF 텍스트 추출 오차 수준). 같은 측정에서 **빈 두 번째 장이 함께 인쇄되던 기존
문제**도 발견했다 — 297mm(≈1122.5px)가 1123px로 반올림돼 1px 미만이 넘친 것이라,
인쇄 시 `html, body{ height:297mm; overflow:hidden; }`으로 A4 한 장에 맞췄다.

## `absence-report.html` — 서명 이름 1em 오른쪽, 날짜 숫자 1px 아래로

사용자 요청: "서명에 이름 1em 오른쪽으로. 날짜들은 모두 1px 아래로." `.ov-sign-name`의
`margin-left`를 `0em` → `1em`으로 올렸다(학생/보호자/담임교사 세 서명란 공통). 날짜 숫자 칸
(결석 기간 `startYear`~`days`, 제출일 `submit*`, 확인일자 `confirm*`)의 `y`를 모두 네이티브
3.1px씩 내렸다 — 인쇄/데스크탑 화면 폭(210mm ≈ 793.7px) 기준 1px = 2480÷793.7 ≈ 3.1 네이티브
px이다. 같은 줄의 `reason`(사유)은 날짜가 아니라 그대로 뒀다.

## `absence-report.html` — 모든 이름 자간 30% 확대

"모든 이름 자간 30% 더 넓게" 요청으로, 성명 칸·보호자( ) 칸(`.ov-name-field`)을 0.04em → 0.052em,
서명란 이름(`.ov-sign-name`)을 0.052em → 0.068em으로 각각 1.3배 올렸다. 넘치는 칸은 기존
`fitOverlayText()`가 자동으로 줄여준다.

## `absence-report.html` — 사유도 날짜와 같이 1px 아래로

"사유도 같이 내려" 요청으로 `reason`의 `y`를 1197.2 → 1200.3(네이티브 +3.1 = 화면 1px)으로
내려, 같은 줄의 결석 기간 날짜 숫자와 다시 같은 높이로 맞췄다.

## `absence-report.html` — 보호자( ) 괄호 안 이름 1px 위로

"보호자 괄호 안은 그대로 두는데 1px 위로" — 다른 칸은 건드리지 않고 `targetGuardianName`의 `y`만
2463.9 → 2460.8(네이티브 -3.1 = 화면 1px)로 올렸다. 자간 등 다른 설정은 그대로다.

## `absence-report.html` — 전체 글씨 1pt 확대 + 이름 자간 30% 추가 확대

"전체적인 글씨크기 1포인트 크게. 이름 자간 30% 더 넓게" 요청. factor를 올리면 1.0을 넘어
세로로 잘리므로(`.ov-text`가 `line-height:1`+`overflow:hidden`), 대신 `ovFontSize()`가 글자 크기에
`OV_PT_BOOST`(4.17 네이티브 px = 인쇄 배율 0.32004 기준 1pt)를 더하고, `growBox()`가 텍스트 칸을
위아래로 반씩 같은 만큼 키워 중심은 그대로 둔 채 잘림을 막는다(`fieldText`/`fieldSign` 이름에
적용). 체크 표시(✓)는 글씨가 아니라 예전 크기를 그대로 쓰도록 `ovFontSize()`를 거치지 않는다.
자간: 성명/보호자 괄호(`.ov-name-field`) 0.052em→0.068em, 서명란 이름(`.ov-sign-name`)
0.068em→0.088em. `page.pdf()`로 실측해 1장 인쇄, 모든 칸 세로/가로 잘림 없음(±1px 반올림 노이즈만)을 확인했다.

## `absence-report.html` — 서명 화면 3px 위/인쇄 2px 아래, 체크 2px 위, 서명 더 진하게

"웹페이지에서는 서명 세 개 모두 3px씩 위로, 인쇄에서 2px씩 아래로. 체크표시 2px 위로. 서명 굵기 조금 더
진하게" 요청. 서명 박스 좌표는 그대로 두고 `.ov-sign-img-box`에 화면 `transform:translateY(-3px)`, `@media print`
에서 `translateY(2px)`(원래 위치 기준 아래로)를 줬다. 체크박스 10개의 `y`를 네이티브 6.2px(= 화면 2px) 올렸다.
서명은 새로 그리는 펜 굵기 `lineWidth` 3.6→4.4, 이미 저장된 서명도 진해지도록 `.ov-sign-img` 필터를
`contrast(1.35)`→`contrast(1.8) brightness(0.85)`로 바꿨다. 인쇄는 여전히 1장.

## `absence-report.html` — 서명을 "(인)" 정가운데에 더 크고 진하게

"서명 더 크게 + (인) 위 정가운데 + 진하게" 요청. 현재 양식 이미지에서 "(인)" 잉크를 다시 실측(학생/보호자
중심 x≈2106, y≈1667/1767, 담임 x≈2060.5, y≈3037)하고 `*SignImg` 박스를 그 중심에 맞춰 197.6×89.8 →
300×140(네이티브)으로 키웠다(가로 300은 이름 끝 글자와 겹치지 않는 한도). `.ov-sign-img` 필터를
`brightness(0) drop-shadow(0 0 0.5px #000)`로 바꿔 잉크를 완전한 검정+살짝 굵게 표시한다(투명 배경은 유지).
참고: 사용자가 보낸 인쇄 미리보기에 "출력일"/nav 아이콘/로그인 배지와 아주 작은 글씨가 보였는데, 이건 이미
고친 예전 코드(Netlify `main`이나 브라우저 캐시)다 — `work`(Vercel)의 최신 코드에서는 나오지 않는다.

## `absence-report.html` — 서명 80%, 담임 이름 잘림, 인쇄 위치, 사유·기간 2px/제출일 1px 위로

- 서명 박스를 "(인)" 중심 그대로 두고 80%로(300×140 → 240×112).
- 서명란 이름(`.ov-sign-name`)을 `overflow:visible`로 — 실제 Noto Sans KR 폰트에서 글자 아랫부분이
  `line-height:1`+`overflow:hidden`에 잘려 보였다(담임교사 이름). 이 칸은 `fitOverlayText()` 대상이 아니라
  가로 넘침 걱정이 없다.
- 인쇄 시 양식이 원본보다 약 15mm 아래로 찍혔다 — nav.js가 상단바 자리로 `body`에 `padding-top:56px`을
  넣기 때문. `@media print`에서 `html, body{ padding:0 !important; margin:0 !important; }`로 없앴다.
- 사유·결석기간 줄 y 1200.3 → 1194.1(화면 2px 위), 학생 제출 날짜 1476.0 → 1472.9(1px 위).

## `absence-report.html` — 양식 이미지의 "담임확인서" 제목만 5px 위로

"담임확인서" 제목은 오버레이가 아니라 양식 이미지(`absence-report-form.png`) 자체에 인쇄된 글자라, PIL로
그 영역(네이티브 x 1100–1395, y 2062–2126)만 잘라 흰색으로 지우고 16px(≈화면 5px) 위에 다시 붙였다 —
표 윗선(y≈2128)과 제목 사이 여백을 되살리기 위함. 이미지의 다른 부분과 FIELD_BOXES는 그대로다.

## `absence-report.html` — 서명란 이름 자간: 학생·보호자 30%, 담임교사 50% 확대

`.ov-sign-name` letter-spacing 0.088em → 0.1144em(×1.3, 학생·보호자). 담임교사만 `fieldSign()`의 새 5번째
인자로 `ov-sign-teacher` 클래스를 붙여 0.132em(원래 0.088em의 ×1.5)으로 따로 준다.

## `absence-report.html` — 담임교사 도장 이미지 불러오기/저장, 기타( ) 가운데·자간, 월·일 1.5px 오른쪽

- **도장**: 담임교사 서명 모달에만 "🔴 도장 이미지 불러오기"(파일)와, 저장된 도장이 있으면 "📥 저장된 도장
  불러오기" 버튼이 보인다. `processStampImage()`가 이미지를 최대 600px로 줄이고, 투명 픽셀이 2% 미만(=불투명
  배경)이면 네 모서리 평균색을 배경으로 보고 그 색과의 RGB 거리 40 이하는 투명, 110 이상은 불투명, 사이는
  부드럽게 투명도를 매긴 뒤 내용만 잘라낸다. 결과는 `data:image/png;stamp=1;base64,...` — 이 `;stamp=1` 표식으로
  렌더링 때 `.ov-stamp-img`(필터 없음)를 붙여 손서명용 `brightness(0)` 검정 필터를 빼고 원래 색(빨강)을 살린다.
  도장은 캔버스를 거치지 않고 그 PNG 그대로 `teacher_signature`에 저장된다(캔버스에 손으로 그리기 시작하면
  도장 모드가 풀린다). `teacher_signatures`에 `stamp_data_url` 컬럼을 추가하고 `signature_data_url`을 nullable로
  바꿨다 — 도장으로 확정하면 도장만, 손서명이면 서명만 upsert해서 서로 덮어쓰지 않는다.
- **확인자료 기타( )**: 박스를 인쇄된 "("(x≈1649)~")"(x≈2031) 사이(x 1652, w 378)로 맞추고 가운데 정렬,
  `.ov-ev-other{ letter-spacing:0.5em; padding-left:0.5em }`(마지막 글자 뒤 자간만큼 왼쪽 padding으로 상쇄).
  "자간 50%"는 한글 워드프로세서식(글자 크기의 50%)으로 해석했다.
- 결석 기간·제출일·확인일자의 월/일 숫자 x를 네이티브 +4.65(화면 1.5px) 오른쪽으로. 괄호 안 일수(`days`)는 그대로.

## `absence-report.html` — 결석 기간·학생 제출 날짜 숫자 1px 오른쪽+1px 아래

결석 기간의 연·월·일(`startYear`~`endDay`)과 제출일(`submit*`)의 x·y를 각각 네이티브 +3.1(화면 1px).
괄호 안 일수(`days`), 사유, 담임 확인일자(`confirm*`)는 그대로.

## `absence-report.html` — 성명 칸 1px 아래로

학년·반·번호 아래 성명(`name`) 칸 y 1005.9 → 1009.0(네이티브 +3.1 = 화면 1px).

## `absence-report.html` — 서명 번짐 제거(drop-shadow 삭제)

"(인)" 위치·크기는 그대로 두고, `.ov-sign-img` 필터에서 `drop-shadow(0 0 0.5px #000)`를 빼 `brightness(0)`만 남겼다 —
그림자 번짐이 크기와 무관하게 고정이라 작은 화면에서 획이 뭉개져 보였다. 서명은 여전히 완전 검정으로 표시된다.

## `absence-report.html` — 서명 더 진하게, 담임 서명 20% 확대, 인쇄 시 학생 제출일 1px 위로

펜 굵기 4.4→5.2, `.ov-sign-img`에 번짐 없는(blur 0) `drop-shadow(0.35px 0 0)`/`(0 0.35px 0)`을 더해 기존 서명도 조금 굵게.
`teacherSignImg`를 같은 "(인)" 중심 그대로 240×112 → 288×134.4. 학생 제출 날짜(`submit*`)에 `ov-submit-date` 클래스를
붙여 `@media print`에서만 `translateY(-1px)`(화면 위치는 그대로).

## `absence-report.html` — 인쇄 글씨 "그림자" = 가짜 굵게(faux bold)

강조 칸(`.ov-emphasis`)과 체크 표시는 `font-weight:800`인데 Google Fonts에서 Noto Sans KR을 400~700만 불러와서,
브라우저가 700 글꼴을 살짝 어긋나게 겹쳐 그리는 가짜 굵게로 800을 만들고 있었다 — 인쇄하면 그 겹침이 그림자처럼
보였다. 폰트 URL에 800을 추가해 진짜 ExtraBold 글꼴을 쓰게 했다.

## `absence-report.html` — 종이 인쇄 글씨 번짐(그림자) + 서명란 이름 1px 위로

종이 인쇄 시 모든 입력 글씨가 그림자진 듯 보였다 — 글씨색이 순수 검정이 아니라 남색(#15202e, 체크는 파랑)이라 컬러
프린터가 여러 색 잉크를 겹쳐 찍으면서 어긋나 번진 것. `@media print`에서 `.ov-text`/`.ov-sign-name`/`.ov-check`를
`#000`으로 바꿨다(서명은 이미 `brightness(0)` 검정). 학생·보호자·담임교사 서명란 이름(`studentSign`/`guardianSign`/
`teacherSign`) y를 네이티브 -3.1(화면/인쇄 1px) 위로.

## `absence-report.html` — 기타( ) 칸 1px 위로

확인자료·확인대상·확인방법의 기타( ) 칸(`evOtherText`/`targetOtherText`/`methodOtherText`) y를 네이티브 -3.1(1px) 위로.

## `absence-report.html` — 입력 글씨 1pt 더 크게(누적 +2pt)

`OV_PT_BOOST` 4.17 → 8.34 네이티브 px(인쇄 배율 기준 +2pt, 이번에 +1pt). `growBox()`가 같은 양만큼 칸을 위아래로
키워 세로 잘림을 막고, 좁은 칸은 `fitOverlayText()`가 자동으로 줄인다. 체크 표시(✓)는 글씨가 아니라 그대로. `page.pdf()`로 1장 인쇄 확인.

## `absence-report.html` — 사유 글씨 1pt 더 크게

`reason` 칸 h 50.0 → 54.3(글씨 = h×0.98이라 약 +4.2 네이티브 = 인쇄 1pt), y 1194.1 → 1192.0으로 세로 중심은 그대로.

## `absence-report.html` — 입력 글씨 1pt 되돌림 + 긴 사유는 칸 안에서 두 줄

`OV_PT_BOOST` 8.34 → 4.17(직전 "모든 글씨 1pt 크게"를 되돌림), 사유 칸도 h 54.3 → 50.0(원래 크기)으로 되돌렸다.
사유(`.ov-reason`)는 `fitOverlayText()`에서 따로 `fitReasonTwoLines()`로 처리 — 한 줄에 들어가면 그대로, 넘치면
`.ov-wrap2`(줄바꿈·`word-break:keep-all`·`overflow:visible`, line-height 1.1)로 칸 너비 안에서 두 줄로 바꾸고, 두 줄에
들어갈 때까지 `--ov-shrink`를 0.92배씩 줄인다(바닥 0.35). 세로는 칸 중심 그대로. 사유 칸은 폭이 약 15mm뿐이라
"독감 및 고열로 인한 병원 입원 치료"처럼 아주 긴 사유는 글씨가 많이 작아진다.
글씨·체크 색도 화면에서까지 모두 순수 검정(`#000`)으로 바꿨다(`.ov-text`/`.ov-sign-name`/`.ov-check`, 예전 남색·파랑).

## `absence-report.html` — 사유는 5자 이상이면 무조건 두 줄

"5글자 이상이면 두줄로" 요청으로 `fitReasonTwoLines()`를 바꿨다: 공백 뺀 글자 수가 5자 이상이면 넘치는지와 상관없이
가운데에 가장 가까운 공백(없으면 글자 수 절반)에서 잘라 `<br>`로 두 줄 표시(`.ov-wrap2`, nowrap+overflow visible, 세로 중앙).
각 줄이 칸 폭을 넘으면 들어갈 때까지 `--ov-shrink`를 줄인다(바닥 0.35). 4자 이하는 한 줄(넘치면 축소). 원문은
`data-full`에 보관해 다시 맞출 때(리사이즈·폰트 로드) 재사용한다.

## `absence-report.html` — 제출일 늦음 경고(평일 5일)

새 결석신고서 폼에서 마지막 결석일(`cEndDate`) 다음날부터 제출일(`cSubmitDate`)까지 평일(월~금) 수가 5일을 넘으면
제출일 칸 아래 `#submitLateWarn`에 빨간 경고("평일 기준 5일 이내에 제출해야 해요. 제출 날짜를 확인해 주세요")를
띄운다(`weekdaysAfter()`/`checkSubmitLate()`, 날짜 change/input 때마다). 공휴일은 빼지 않는다. 경고일 뿐 저장은 막지 않는다.

## `absence-report.html` — 결석 일수 자동 계산 제거

기간에서 결석 일수를 달력 날짜로 자동 계산하던 `computeDays()`를 없앴다 — 주말·공휴일·재량휴업일·방학을 빼야 해서
자동값이 오히려 틀렸다. 일수 칸은 빈칸으로 시작하고 직접 입력해야 하며(안내 문구도 바꿈), 비워두면 저장 시
"결석 일수를 입력해주세요." 에러(예전엔 1로 채워 저장).

## `absence-report.html` — 한 줄 사유 아랫부분 잘림

두 줄일 때는 `overflow:visible`이라 안 잘렸지만 한 줄일 때는 `.ov-text`의 `overflow:hidden` 때문에 굵은(800) 글자
아랫부분이 칸 경계에서 잘렸다("장염"). `.ov-text.ov-reason{ overflow:visible; }`로 항상 풀었다 — 가로 넘침은
`fitReasonTwoLines()`가 글씨를 줄여 처리한다.

## `absence-report.html` — 날짜 입력칸 옆 요일 표시

모든 `input[type="date"]`(결석 기간 시작/끝, 제출일, 담임확인서 확인일자) 옆에 `(월)` 같은 요일을 `.date-dow`로 표시한다
(양식 오버레이에는 안 들어감) — 토·일요일 빨강, 평일 남색. `decorateDateInput()`이 period-row 안이면 바로 뒤에,
아니면 `.date-dow-row`로 감싸 붙이고, input/change 위임 리스너가 갱신한다. 상세 패널처럼 나중에 그려지는 입력칸은
MutationObserver가 꾸민다(값이 같으면 textContent를 다시 쓰지 않아 무한 루프 방지). JS로 값을 넣은 뒤(`resetCreateForm`)는 `refreshDateDows()`.

## `absence-report.html` — 만들기 폼 입력칸 폭을 필요한 만큼으로

학년·반·번호는 84px, 이름은 170px 고정(모바일 ≤560px는 56px/110px로 한 줄), 날짜 입력칸(결석 기간·제출일·확인일자)은
170px 고정으로 줄였다(전엔 남는 폭을 다 채움). 결석 일수 "( __ 일간)"은 `.days-group`(nowrap)으로 묶어 모바일에서
"일간)"만 따로 줄바꿈되지 않게 했다.

## `absence-report.html` — 결석 일수가 기간 안 평일 수보다 많으면 오류

`weekdaysInclusive(start, end)`(기간 안 월~금 수 = 입력 가능한 최대 결석 일수, 공휴일 등은 알 수 없어 주말만 뺌)보다
결석 일수가 크면 일수 칸 아래 `#daysOverWarn`에 빨간 오류를 바로 띄우고(`checkDaysOver()`, 날짜·일수 input/change),
"만들기"도 같은 메시지로 막는다.

## `absence-report.html` — 페이지/메뉴 이름 "결석신고서 만들기"

`<title>`/`<h1>`, `admin-tools.html` 타일, `nav.js` 검색 항목 이름을 "결석신고서 만들기"로 바꿨다. 학생·보호자가 여는
서명 링크(`?id=`)에서는 `<h1>` 바로 뒤 인라인 스크립트가 제목을 다시 "결석신고서"로 둔다(만들기 화면이 아니므로).

## `absence-report.html` — "내가 만든 결석신고서" 목록을 두 줄로

목록 항목을 제목 한 줄 + `.report-item-row2`(flex, wrap) 한 줄로 바꿨다: 사유·기간 → 학생/보호자 서명 배지 → 링크 복사 →
확인/담임확인서 → 삭제(`margin-left:auto`로 맨 끝). 좁은 화면에서는 자연스럽게 줄바꿈된다.

## `absence-report.html` — 내가 만든 결석신고서 검색

목록 위 `.report-search`에 학생 이름(부분 일치)·날짜 입력과 "초기화" 버튼. 날짜는 그 날이 결석 기간 안이거나 제출일과
같은 신고서를 찾는다. 이미 불러온 `allReports`를 `applyReportSearch()`가 클라이언트에서 거를 뿐(재조회 없음), 결과가
없으면 "검색 결과가 없어요." 날짜칸에도 요일 표시가 붙는다.

## `absence-report.html` — 체크해서 여러 개 삭제/PDF 저장

목록 항목 제목 앞에 체크박스(`.report-chk`), 검색 줄 아래 `.report-bulk`(전체 선택 / 🖨 선택 PDF 저장·인쇄 / 선택 삭제 /
"N개 선택됨"). 선택은 `selectedIds`(Set)로 검색 필터를 바꿔도 유지되고, "전체 선택"은 지금 보이는 항목만 대상이다.
선택 삭제는 확인 후 `.delete().in('id', ids)` 한 번. 선택 PDF는 `printReports(rows)`가 `#printArea`에 신고서마다
`.print-page`를 쌓고 `body.print-multi`를 켠 뒤 `window.print()` — 인쇄 CSS가 이때만 한 장 높이 고정(`html,body{height:297mm}`)을
풀고 `.print-page`를 296.5mm(반올림 빈 장 방지)+`break-after:page`로 한 장씩 나눈다. 단일 인쇄(`printReport`)도 같은
함수를 거치며 그때는 `print-multi`를 끈다. `page.pdf()`로 2개 선택→2장, 단일→1장 확인.

## `absence-report.html` — "새 결석신고서 만들기"는 상자 없이 파란 버튼만

폼이 닫혀 있고 안내 메시지·생성 링크도 없으면 `#createCard`에 `.create-bare`(배경·테두리·패딩·제목 숨김)를 붙여 파란
`.btn.blue` 버튼만 보인다. 폼을 열거나 저장 후 링크/메시지가 뜨면 `syncCreateCard()`가 다시 상자로 되돌리고 버튼을 회색 "접기"로 바꾼다.

## `absence-report.html` — 이름을 다시 "결석신고서"로

"결석신고서 만들기"로 바꿨던 `<title>`/`<h1>`, `admin-tools.html` 타일, `nav.js` 검색 항목을 요청에 따라 다시 "결석신고서"로
되돌렸다(서명 링크용 제목 되돌리기 인라인 스크립트도 더는 필요 없어 삭제).

## `absence-report.html` — 서명 링크는 독립 페이지 + 학생용 도메인

학생·보호자가 여는 `?id=` 화면은 사이트 일부처럼 보이면 안 된다는 요청: `nav.js`/`site-login-badge.js`를 정적 `<script>` 대신
`?id=`가 없을 때만 동적으로 붙여서, 서명 화면에는 홈·나의 페이지·검색·챗봇·로그인 배지가 아예 로드되지 않는다.
`body.public-sign`이 "← 교무 업무 도구로"와 교사용 안내문도 숨긴다. 공유 링크(`shareUrl`)는 `chatbot-builder.html`의
학생 챗봇과 같은 학생용 도메인 `STUDENT_BASE_URL = 'https://inspiring-macaron-9aabd8.netlify.app/'`(같은 저장소를 배포하는
두 번째 Netlify 사이트)으로 만든다 — 그 사이트는 `main`에서 배포되므로 변경이 `main`에 병합돼야 반영된다. 예전에 교사용
주소로 공유한 링크도 그대로 작동한다(같은 코드·같은 Supabase).

## `absence-report.html` — 증빙서류 첨부 기능 철회 → 안내 한 줄

바로 위 "증빙서류 첨부" 기능은 요청에 따라 되돌리고(코드 revert), 서명 화면 서명란 아래에 빨간 안내 한 줄
"📎 증빙서류(진단서·소견서·진료확인서 등)는 담임 선생님께 직접 제출해 주세요."(`.ev-notice`)만 둔다.
그때 만든 Supabase 쪽 `absence_reports.evidence_files` 컬럼, `absence-evidence` 버킷과 스토리지 정책 3개,
`absence_report_set_evidence` RPC는 지우지 않고 쓰이지 않은 채 남아 있다(빈 버킷, 무해) — 정리하려면 대시보드에서 직접.
