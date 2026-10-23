# form-board-file-library — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

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

## 이름 변경: 문서 양식 공유 → 서식·양식·공용 메모 (2026-10-23)
- form-board.html 제목·h1, index 타일, KS_MENU label, nav.js 검색 결과 표시("서식·양식 메모 · 카테고리")·검색창 안내 문구.

## 목록 촘촘하게 (2026-10-23)
- 서식 목록 `.tpl-item-head` padding 14→8px, 제목 16.3→15.3px, 카테고리 배지·메타 작게, 카테고리 탭 padding 5px 12px→3px 10px·13px.
- "새 서식 올리기" 카드는 평소 숨김(`#formCard`), 버튼은 서식 목록 제목 옆으로. 누르거나 수정하면 목록 위에 쓰기 카드가 펼쳐지고 버튼은 '접기'.

## 자료로 자동 입력 (2026-10-23)
- 서식 쓰기 칸 맨 위 "✨ 자료로 자동 입력"(메모장 `memo.html`에도 같은 코드 — 고치면 두 곳 다): 캡처 붙여넣기(Ctrl+V)·끌어놓기·파일(이미지·PDF·.hwpx·.docx·txt), 복사한 글. 이미지는 긴 변 1800px JPEG, PDF는 글자 추출(글자 거의 없으면 스캔으로 보고 앞 4쪽을 그림으로), .hwp는 안내.
- Edge `doc-autofill`(v1, sonnet 5.5, 하루 60회, 그림 4장·글 4만 자): target `form` → {title, category(기존 카테고리 우선), html(p/br/b/u/ul/ol/li/table만), note}, `memo` → {title, content(줄글), labels(기존 라벨 우선), note}. "날짜·금액·이름은 빈칸으로"(blank) 기본 켬 — 끄면 원문 유지(학생 개인정보만 ○○○).
- 칸만 채우고 저장은 사람이. 이미 쓴 내용이 있으면 덮어쓰기 확인. 서식 sanitizer에 TABLE/TR/TH/TD 허용 + SCRIPT·STYLE 등은 내용째 버림.
- 편집기 도구줄에 진하게(B)·밑줄(U)·형광펜(노랑 #ffe66d, 다시 누르면 transparent로 지움) 버튼. 선택 영역 유지를 위해 mousedown preventDefault, selectionchange로 버튼 켜짐 표시. sanitizer가 style의 background-color도 허용.

## 기안·품의 칸 나누기 (2026-10-23)
- `form_templates`에 `doc_title`·`approval_line`(한 줄)·`notes` 추가. 카테고리 이름에 "기안"·"품의"가 들어가면(`isDraftCat`) 쓰기 칸에 제목·결재선·유의사항이 나타나고(`#tplForm.draft .draft-only`), 목록 펼치면 제목[복사]·본문·결재선·⚠유의사항(노랑) 칸으로. 버튼은 "본문 복사"·"전체 복사"(제목+본문+결재선, 유의사항 제외)·수정·삭제. 칸 정보가 하나도 없는 예전 품의 서식은 예전처럼 본문만.
- `stripHtmlToText`가 문단·줄·목록·표 경계를 줄바꿈/탭으로 살리게 바뀜(글만 복사할 때 문단이 붙던 문제).
- `doc-autofill` v2: form 결과에 doc_title·approval_line·notes(기안·품의일 때만 채움, 본문엔 제목줄·결재선 빼고).
- 카테고리 라벨 색: 8색 팔레트(`CAT_PALETTE`), 자주 쓰는 이름은 고정(`CAT_FIXED`: 기안 남색·품의 주황·업무 안내 하늘·출결 공문 초록·계획서 보라·기타 청록), 나머지는 카테고리 목록 순서로 안 쓴 색(`buildCatMap`). 목록 라벨 배경·글자색 + 카테고리 탭 앞 색 점(`.cat-dot`).
- 넓은 화면(1000px 이상): 서식 목록 왼쪽(38%, 스크롤) + 고른 서식 내용 오른쪽(`#tplDetail`, sticky). 처음엔 첫 서식이 선택됨. 좁은 화면은 그대로 목록 안에서 펼치기. 복사·수정·삭제 버튼은 `#tplSplit` 위임 한 곳에서 처리.
- 복사(본문·전체·제목)는 글자만(text/plain) — 진하게·밑줄·형광펜·글자색은 빼고 줄바꿈만 살림(요청).
- 카테고리 탭은 색 점 대신 풍선 자체에 카테고리 색(`catTabStyle`: 연한 바탕·진한 글자, 고른 탭은 진한 바탕·흰 글자).
- 자동 입력의 '파일·사진 고르기' 글자 링크 → 테두리 있는 버튼 '파일·사진에서 추출하기'(사진 아이콘). 서식·메모장 둘 다.
- 넓은 화면 2단을 검색창부터: `.tpl-left`(검색·카테고리·목록) | `#tplDetail`. 오른쪽 내용이 검색창 높이에서 시작.
