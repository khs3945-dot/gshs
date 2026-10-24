# accounts-admin — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

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

## 관리자 모드 비밀번호 관리는 `admin-tools.html` 한 곳에서만

"관리자 모드 비밀번호 관리는 교무 업무 도구에서 모두 변경·확인, 다른 곳에서는 변경 불가" 요청. `admin-tools.html`의
관리자 전용 카드(`#adminPwCard`, 제목 "관리자 모드 비밀번호 관리")에 ① 공용 편집 비밀번호(`shared_edit_settings` —
`shared_edit_password_is_set`/`set_`/`clear_shared_edit_password`, `#sharedPw*`)와 ② 제출함 마스터 비밀번호(기존
`collect_settings`, `#adminPw*`)를 두 섹션으로 모았다. `staff-edit.html`의 "🔑 공용 편집 비밀번호 관리" 카드와
`collect.html` 목록의 "🔑 마스터 비밀번호 관리" 토글/카드(`initMasterPasswordUi`)는 삭제 — 두 페이지는 비밀번호로
잠금 해제(검증)만 하고 바꿀 수는 없다. 비밀번호는 해시로만 저장돼 누구도 볼 수 없어 "확인"은 켜짐/꺼짐 상태만 보여준다.

## 회원 삭제 대신 "비활성"(`profiles.is_active`) + "명단에 없는 선생님"

학기마다 떠난 선생님을 지우면 그 계정에 묶인 자료(할 일·메모·예약·챗봇 등, FK cascade)가 같이 사라지고,
문서 양식·설문·결석신고서를 쓴 계정은 FK(no action) 때문에 아예 삭제가 막혀서, 회원 관리의 삭제를
비활성으로 바꿨다. `profiles.is_active boolean not null default true` 추가, `profiles_update_self`의
WITH CHECK에 `is_active`도 고정(본인이 스스로 되살릴 수 없음), `public_profiles` 뷰에 `is_active` 칼럼 추가.
비활성 선생님은 **고르는 목록에서만** 빠진다 — my-page.html(두 IIFE)/my-todo.html의 `loadProfilesMap()`은
`profilesMap`(이름 표시용)은 전원으로, `allProfiles`(배정 대상 피커)는 활성만으로 채우고, collect.html의
`cTargetProfiles`, teacher-groups.html의 `teachers`도 활성만. 그래서 예전 업무의 배정자 이름 등은 그대로
보인다. 로그인과 자료 접근은 막지 않는다. teacher-groups에서 그룹을 다시 저장하면 비활성 구성원은 그
그룹에서 빠진다(그룹 RPC가 멤버 목록을 통째로 교체하므로).

member-admin.html: 행/일괄 "삭제" 버튼을 "비활성"/"다시 활성"으로 교체(`setActive(ids, active)`), 비활성은
기본 숨김("비활성 회원도 보기" 체크로 표시, 이름 취소선+배지, 목록 맨 뒤). 계정 연결 요청의 중복 구글 계정
삭제(`delete-member`)는 그대로 둠. **"명단에 없는 선생님" 카드**(`loadMissing()`): 명렬 업로드는 이름 기준
덮어쓰기라 떠난 사람 행이 옛 `updated_at`으로 남는 점을 이용해, staff의 최신 `updated_at`보다 1시간 넘게
오래된 행(또는 명렬에 없는 이름)에 해당하는 활성·승인·비관리자 회원을 보여주고 개별/일괄 비활성 처리한다.
member-admin.html 자체의 붙여넣기 업서트도 이제 `updated_at`을 찍는다(staff_roster_upsert RPC는 원래 찍음).

## 교사 그룹 관리·회원 일괄 등록을 회원 관리의 탭으로

`member-admin.html`/`teacher-groups.html`/`bulk-register.html` 세 페이지 제목 바로 아래에 같은 탭 줄
(`.ma-tabs`, 세 파일에 복붙 — 회원 관리 / 교사 그룹 관리 / 회원 일괄 등록, 현재 페이지에 `.active`)을 두고
서로 링크로 오간다(각 페이지는 그대로 독립 파일, 로그인·관리자 게이트도 각자). `admin-tools.html`에서는
교사 그룹 관리·회원 일괄 등록 타일을 지우고 회원 관리 타일 하나만 남겼다. nav.js의 🔍 검색 항목은 그대로.

## 학생 공유(시험 시간표·면접 보고서), 같은 이름 계정 합치기, 명렬 업로드 시 일괄 비활성

- **시험 시간표 학생 개인 링크** (`exam-view.html`): `exam_timetable_data.student_link_secret`(랜덤, 시험마다)
  을 추가하고, 링크 토큰 = `sha256(secret|학년|반|번호)` 앞 20자(교사 브라우저가 `crypto.subtle`로 계산).
  `?id=&s=학년-반-번호&t=토큰`으로 열면 로그인 없이 `exam_student_view` RPC(`SECURITY DEFINER`, anon 허용)가
  토큰을 검증하고 그 학생 행만 담은 CSV를 돌려준다 — 기존 렌더링 파이프라인을 그대로 탄다. 학생 모드는
  `body.student-mode`로 `.teacher-only`를 숨기고 nav.js를 아예 안 불러오며 "공유하기"(`navigator.share` —
  휴대폰 공유 창: 퀵쉐어·블루투스·카톡 등, 미지원이면 링크 복사)/"인쇄·PDF" 버튼만 보인다. 교사 화면엔
  "📱 학생 링크·QR"(선택 학생 QR 팝업)과 "🖨 이 반 QR 한 장 인쇄"(반 학생 QR을 4열로 한 장에) 추가.
  CSV는 쉼표 split으로 4~6번째 칸(학년·반·번호)을 비교하므로 앞 칸(일차·교시·시간)에 쉼표가 들어가면 안 된다.
- **면접 보고서 학생 보기** (`mock-interview.html?view=<보고서 id>`): 저장된 보고서를 읽기 전용으로만
  보여준다(`html.student-view`가 `.no-print`·왼쪽 칼럼을 숨기고 `.sv-keep` 공유 바만 표시, nav.js 미로드).
  보고서 머리줄 "학생에게 보내기"가 링크·QR·공유 팝업을 연다(먼저 저장해야 함). `interview_reports`는
  원래부터 RLS가 완전 공개라 별도 토큰이 없다(uuid가 곧 링크).
- 두 학생 링크 모두 결석신고서와 같은 학생용 도메인 `STUDENT_BASE_URL`(main에서 배포되는 두 번째 Netlify)을
  쓰므로 main에 병합해야 실제로 열린다.
- **같은 이름 계정 합치기** (member-admin.html "같은 이름 계정" 카드): 활성 회원 중 이름이 같은 묶음을 보여주고
  최근 로그인한 계정을 기본으로 "남길 계정"에 선택. `merge_accounts(p_keep, p_remove)`(관리자 전용
  `SECURITY DEFINER`)가 사용자 소유 칼럼이 있는 테이블들을 남길 계정으로 UPDATE하고(유일 제약이 걸린
  테이블은 충돌 없는 행만 옮김 — DELETE를 쓰지 않아 겹치는 행은 없앨 계정에 남음), 프로필 빈 칸 채우기·그룹
  합치기·승인/관리자 OR 후 없앨 계정을 비활성으로. 개인 챗봇 문서의 스토리지 파일 경로는 옛 계정 폴더 그대로다.
- **명렬 업로드 후 일괄 비활성**: member-admin.html 붙여넣기, staff-edit.html 붙여넣기·엑셀 업로드 모두 반영 직후
  "이번 명렬에 이름이 없는 활성 회원 N명"을 confirm으로 보여주고, 확인하면 한 번에 비활성. staff-edit는 공용
  편집 비밀번호 사용자도 쓰므로 `deactivate_profiles(p_password, p_ids)` RPC(관리자 계정은 건너뜀)를 쓴다.

## 회원 관리 탭 재구성 — 회원 명단 다운로드·일괄 등록을 회원 관리 안으로, "교직원 명렬" 탭 신설

탭은 이제 **회원 관리 / 교사 그룹 관리 / 교직원 명렬**(`staff-roster.html`, 새 파일). `bulk-register.html`은
탭에서 빠졌지만 파일·🔍 검색 항목은 남아 있다(탭 줄은 새 3개로 갱신).
- `member-admin.html` 도구 줄에 **📥 회원 명단 다운로드**(현재 불러온 `members` + `authInfoMap`으로 이름·승인·
  활성·관리자·부서·교과·연락처·담임·그룹·구글·가입일·최근 로그인 xlsx)와 **👥 회원 일괄 등록**(`#bulkCard`,
  bulk-register.html과 같은 양식·같은 `bulk-register-users` 함수, 이미 가입된 이름을 미리보기에 표시, 등록 후
  계정 연결 요청 목록도 새로고침)을 추가. 기존 "교직원 명렬 관리" 붙여넣기 카드는 교직원 명렬 탭으로 옮기며 삭제.
- `staff-roster.html`(관리자 전용, admin RLS로 `staff` 직접 읽기/쓰기): 표에서 바로 수정(입력칸, 바뀐 행 표시,
  "변경 내용 저장"이 기존 행은 원래 이름 기준 update — 이름 변경도 가능 — 새 행은 insert, 이름 중복·빈 이름 거부),
  "+ 행 추가", 행 ✕ 삭제(명렬 행만, 회원 계정은 그대로), 📥 엑셀 다운로드(현재 명렬), 📤 엑셀 업로드(머리글 이름으로
  읽고 미리보기 → `updated_at` 찍어 upsert → 이번 파일에 없는 활성·비관리자 회원을 모두 비활성할지 confirm).
  칼럼은 staff-edit.html의 8개(이름·부서·교과·내선번호·휴대폰·담임반·담임교실·수업시수)와 같다 — 시간표 편집과
  공용 편집 비밀번호 경로는 여전히 staff-edit.html.

**정정 (바로 위 두 탭 섹션)**: 탭 구성은 되돌렸다. 회원 관리·교사 그룹 관리·교직원 명렬(`staff-roster.html`)은 다시
각각 `admin-tools.html`(교무 업무 도구)의 관리자 전용 타일로 들어가는 독립 페이지이고, `.ma-tabs` 탭 줄과 그 CSS는
네 파일 모두에서 지웠다. 회원 명단 다운로드·회원 일괄 등록은 그대로 회원 관리 페이지 안에 남는다.

## `staff-roster.html` — 로그인 필수 보기 + "🔑 관리자 모드"로 수정

관리자 전용이던 교직원 명렬 페이지를, **승인된 로그인 교사 누구나 보기**(`public_staff` 뷰, 휴대폰 칼럼 없음,
표는 읽기 전용 텍스트)로 바꾸고, 수정은 "🔑 관리자 모드"를 켜야 가능하게 했다 — 관리자는 바로, 아니면 공용 편집
비밀번호(`verify_shared_edit_password`, 메모리의 `sharedEditPassword`에만). 관리자 모드에서는 `staff_roster_list_for_edit`
로 휴대폰까지 불러와 입력칸 표·행 추가·✕ 삭제·엑셀 업로드(`.edit-only`, `body.roster-edit`)가 보인다. 모든 쓰기는
비밀번호를 검증하는 RPC: `staff_roster_save(p_password, p_rows)`(새 RPC — 행마다 `orig`가 있으면 그 이름 행을 update
(이름 변경 가능), 없으면 insert), `staff_roster_remove(p_password, p_name)`(DELETE가 들어 있어 이 환경 MCP에서
타임아웃 — SQL Editor에서 직접 만들어야 함), 업로드는 기존 `staff_roster_upsert`, 업로드 후 일괄 비활성은
`deactivate_profiles`. 엑셀 다운로드는 보기 모드에서도 되지만 휴대폰 칼럼은 관리자 모드에서만 포함된다.
admin-tools.html 타일은 관리자 전용에서 일반 타일로, nav.js 검색 항목은 `adminOnly` → `loginRequired`로.

## `member-admin.html` — 회원 행 한 줄 배치 + 활성/비활성 스위치

회원 목록 행(`.member-head`)을 `flex-wrap:nowrap`으로 바꾸고 이름은 넘치면 말줄임(`min-width:0`)해서 배지가 한 줄에 다 들어오게 했다.
배지 순서는 관리자 → 승인됨(승인 대기) → 구글 연동. 예전 "비활성" 버튼(행동 버튼인데 상태처럼 읽힘)과 `.badge.inactive`를 없애고,
지금 상태를 보여주는 `.act-switch` 스위치로 바꿨다 — 활성이면 초록 스위치+"활성"(`.on`, 누르면 확인 후 비활성), 비활성이면 회색+"비활성"
(누르면 다시 활성). 클래스는 그대로 `quickDeactivate`/`quickActivate`라 기존 핸들러를 쓰고, 안쪽 span을 눌러도 되도록 `e.target` 대신
`btn.dataset.id`를 읽는다.

## `member-admin.html` — 활성/비활성 스위치 폭 고정

`.act-switch`에 `width:76px; justify-content:flex-start`를 줘서 "활성"/"비활성" 글자 길이와 상관없이 스위치(track)가
모든 행에서 같은 위치에 오게 했다. 활성 글자색은 검은색(`#111`).

## 교사 그룹을 명렬 기준으로 (회원 아닌 선생님 포함)
- `staff.groups` 칼럼 추가(public_staff 뷰에도). RPC `upsert_staff_group(p_name, p_member_names text[], p_old_name)`·`delete_staff_group(p_name)`(관리자): staff.groups를 이름으로 고치고, 같은 이름 회원은 기존 `upsert_custom_group`/`delete_custom_group`을 불러 profiles.groups도 맞춤(할 일 요청 등 회원 id 기반 기능 유지).
- teacher-groups.html: 명단 = 명렬 전원 + 명렬에 없는 회원, 이름이 식별자. 상태 점/칩 색 초록=회원, 노랑=회원 아님, 회색=비활성. 자동 그룹도 명렬 기준.
- teachers.html 그룹 검색은 staff.groups(+profiles.groups 합침)·명렬 담임 학년 사용.

## 구글 로그인 끔 (2026-10-23)
- login.html의 "Google로 로그인/시작하기" 버튼과 "또는" 구분선을 style="display:none"으로 숨김, my-page의 "구글 계정 연결하기"도 GOOGLE_LOGIN_ON=false로 숨김. 콜백 처리 코드는 그대로(다시 켜기 쉽게).
- 당시 구글로만 로그인하던 계정: 김현진 → 관리자가 회원 관리에서 비밀번호를 설정해 줘야 로그인 가능.

## 테스트 계정(관리자 아닌 화면 확인용)
- `profiles.is_test`: 이름이 "테스트"로 시작하면 트리거 `profiles_mark_test`가 켬. `public_profiles` 뷰는 테스트 계정을 본인·관리자에게만 보여 줌(다른 선생님의 고르기 목록·AI 이름 목록에서 빠짐). 관리자는 할 일 요청 등에서 테스트 계정을 고를 수 있음.
- `staff`(명렬)에는 넣지 않음 → 가입하면 승인 대기 → 관리자가 승인. member-admin "명단에 없는 선생님", staff-roster 업로드 후 일괄 비활성, teacher-groups 명단에서 "테스트…" 이름은 뺌.
- SQL은 MCP에서 DROP 때문에 멈춰 사용자에게 SQL Editor로 안내(`create or replace trigger`로 DROP 없이).

## 업무 역할(교무·교육과정·평가·학생지도·시설) — 비밀번호 없이 편집 (2026-10-24)
- `staff.roles`(쉼표로 여러 개, 교직원 명렬 "역할" 열, public_staff 뷰에도). **관리자만 바꿈**(`staff_roster_save`의 roles는 관리자일 때만, 업로드 `staff_roster_upsert`는 roles를 안 건드림).
- `has_edit_role(role)`(관리자 또는 이름이 같은 승인·활동 회원의 staff.roles에 그 역할), `verify_edit_role(pw, role)` = 편집 비밀번호 or 역할, `my_edit_roles()`(화면용).
- 편집 RPC 21개의 `verify_shared_edit_password(p_password)`를 `verify_edit_role(p_password, '역할')`로 바꿈(DO 블록으로 정의문 치환):
  교무 = 학교 기본 정보·학생 명렬·반 편성·학생 한 명 고치기·교직원 명렬(목록·저장·올리기)·회원 비활성·명렬→회원·학생 진급 /
  교육과정 = 학사일정·교사 시간표(한 명·일괄) / 학생지도 = 학생 지도 일정 / 시설 = 교실 목록·배치도. `verify_view_password`(민감 비고 열람)는 그대로.
  평가 = 시험 시간표 숨기기·삭제(exam_schedules·exam_timetable_data update/delete 정책을 `has_edit_role('평가')`로 ALTER POLICY).
- 화면: staff-roster(교무)·school-status(교무 또는 교육과정 — 다른 역할 자료는 저장 때 서버가 거절)·staff-edit(교육과정)·duty(학생지도)·room-booking(시설)·
  student-promote(교무)·exams(평가)에서 `my_edit_roles()`에 그 역할이 있으면 관리자처럼 바로 편집 모드(비밀번호 null). 편집 비밀번호 방식도 그대로 됨.
- 자료 허브 교직원 카드에 "역할" 열(파일에 열이 있을 때만 바꿈, 모르는 역할 이름 경고). 역할은 계정이 아니라 명렬 이름으로 이어짐 → 새 학년도 명렬만 올리면 역할도 바뀜.
- (2026-10-24) 화면 이름 "관리자 모드" → **"편집 모드"**(모든 페이지).
- (2026-10-24) 역할 안내·관리: 편집 페이지 7곳(교직원 명렬·학교 현황·교사 시간표 편집·학생 지도 일정·교실 예약·학생 진급·시험 시간표)의 편집 모드 버튼 옆에
  `.role-note`("○○ 역할이신 선생님은 비밀번호 없이 편집할 수 있어요"). 학교 현황은 시설(배치도) 역할도 편집 모드 허용. 교직원 명렬의 역할 칸은 관리자 아니면 읽기 전용.
  자료 한번에 관리에 **업무 역할 카드**(접힘): 역할마다 페이지·정보 설명(`ROLE_INFO`) + 맡은 선생님 칩(가입·승인 안 된 사람은 ⚠) + 이름 입력(명렬 datalist)으로 더하기·✕로 빼기 → `staff.roles` 바로 update(관리자 RLS).

## 역할 v2 (2026-10-24, 사용자 확정)
- **교무**(학교 기본 정보·학사일정·교직원 명렬·회원 비활성) / **학적**(학생 명렬·반 편성·학생 비고·학생 진급) / **교육과정**(교사 시간표) / **평가**(시험 숨기기·삭제) /
  **등교지도**(정문·후문) · **중식지도**(중식) · **자기주도학습**(야자) / **시설**(교실 목록·배치도). "학생지도"는 없어짐(셋으로 나눔).
- 학생 지도 일정은 칸별: `duty_zone_role(zone)`·`can_edit_duty_zone(pw, zone)`(편집 비밀번호 또는 그 칸 역할, 기타 구역은 세 역할 중 하나). `duty_roster_save`는 행마다(고치는 행은 원래 구역도) 확인,
  `duty_roster_delete_row`는 그 행 구역 확인. 화면은 내 역할 아닌 칸을 잠그고(`DUTY_EDIT`, `td.zone-cell.locked`), 역할로 들어오면 기존 줄의 날짜·시간·🗑 날짜 지우기를 막음.
  엑셀 받기는 모든 칸, 올리기는 맡은 칸만(파일의 다른 칸 무시 + 확인 창에 안내). `duty_roster_replace_range`는 칸별 버전을 사용자가 SQL Editor에서 실행해야 함 — 그 전엔 역할 사용자는 칸마다 지우기+넣기로.
