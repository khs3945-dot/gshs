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
  for login) and `GCAL-SETUP.md` (Google Calendar API key for `date.html`) — read
  these before touching login or calendar-embed code.

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
groups for visual separation. **This edit lives only in `collect-setup.md` —
it has not been pushed to the live Apps Script deployment**, since that
requires the manual script.google.com 배포 관리 → 새 버전 flow documented in
this file's install instructions, which no tool in this environment can drive
(no Apps Script API access here). Paste the updated `ks_summarizeWithGemini_`
from `collect-setup.md` into the existing script project and redeploy a new
version to actually see the formatting change.

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
  업무"/"나에게 온 업무") filters out completed items from each — "완료" means
  different things per list (every assignment's `completed` true for a task I
  own, vs. just my own `task_assignments.completed` for a task assigned to me),
  so `renderAssignedOwned`/`renderAssignedToMe` each apply their own definition.
  State persists in `localStorage` only (`ks_assigned_hide_completed`, not
  `ui_prefs` — this is a lighter-weight, single-page preference, unlike the
  cross-device "admin default, user override wins" settings elsewhere in this
  file) and both render functions cache their last-fetched `rows` array
  (`lastAssignedOwnedRows`/`lastAssignedToMeRows`) so toggling the checkbox
  re-filters instantly without a Supabase refetch.
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
**챗봇별 세부 내역** table keyed by the full `actor_label` (one row per
bot+student combination, same as before this was added). An "이름 또는
학번으로 검색" text input (`studentSearchFilter`, substring match against
the parsed `name`/`studentNo`, re-filtering client-side on every keystroke
— no refetch) narrows both tables at once, so an admin can look up one
student by name or 학번 directly instead of scanning the full list. All
tables and the stat tiles above them re-render from the already-fetched
`allRows` array whenever the function filter or the student search changes;
only the period filter triggers a real
Supabase query.

**로그인 사용자별 집계** and **학생별 합계** are paginated (the other two
tables, 기능별 집계/챗봇별 세부 내역, are not — those stay small in practice).
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
세부 내역) and the stat grid — `기능별 집계`'s breakdown by
`function_name|provider|model` is specifically what answers "비용이 모델에
따라 얼마씩인지" ( cost broken out per model), since that's the one table
already keyed by model. `fmtCost(n)` shows 4 decimal places below $1 (token
costs are routinely sub-cent) and 2 decimals at or above $1, always prefixed
`$` — there's no ₩ conversion, since Claude/Gemini billing itself is in USD.
Gemini rows always have `cache_creation_input_tokens`/`cache_read_input_tokens`
at `0`/`null` already (prompt caching is a Claude-only concept in this
codebase's usage), so leaving a Gemini model's 캐시 생성/읽기 price fields
blank has no effect on its cost regardless.

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

## `task-assign.html` — standalone page for `my-page.html`'s 할 일 배당 block

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
  `getOrCreateRootFolder()`), plus five new `action`s in the shared `handle()`
  dispatcher: `libraryList`, `libraryCreateFolder`, `libraryUploadFiles`,
  `libraryDeleteFile`, `libraryDeleteFolder`. `libraryUploadFiles` calls the
  *existing* `saveFilesToFolder()` helper unchanged (same `[{name,mime,data}]`
  shape `collect.html`'s own uploads already use, same `uc?export=download`
  direct-link format) — no new file-saving logic needed, just a new folder to
  point it at.
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