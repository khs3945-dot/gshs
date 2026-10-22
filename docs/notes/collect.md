# collect — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

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
