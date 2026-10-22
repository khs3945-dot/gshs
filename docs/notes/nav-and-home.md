# nav-and-home — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

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

## 하위 페이지 전체를 메인 화면 디자인으로 — 아이콘·상단바·로그아웃·`#ks-theme`

메인(`index.html`)에만 적용됐던 아이콘/상단바 변경을 사이드바를 쓰는 하위 페이지 37개에 일괄 적용했다(스크립트로
치환): 사이드바 `.ks-nav-ico`의 이모지 → index.html과 같은 흰 선 SVG 배지(href 기준으로 그대로 복사), 모바일 상단바
🏠/👤 → SVG 배지, 로그인 영역에 "OOO님" + 로그아웃 버튼(데스크탑 `#ksLogout`, 모바일 `#ksMobileLogout`, 같은
`waitForSupabase` 콜백 안에서 `sb.auth.signOut()` 후 새로고침). 본문 디자인은 각 페이지 `</head>` 직전의
`<style id="ks-theme">`가 옛 색상 변수(`--paper`/`--stamp`/`--rule`/`--ink` 등 — 모든 하위 페이지가 같은 이름을 씀)를
메인 팔레트(인디고 `#4C5FF0`, 연보라 선)로 덮어쓰고, `.ks-content-inner` 안의 `header.page-head`(흰 카드, 둥근 22px),
`.card`(둥근 18px+옅은 그림자), 버튼·입력칸 모서리를 메인처럼 바꾼다. 메인과 달리 `--stamp`는 그라데이션이 아니라
단색(글자색으로도 쓰이므로). 새 하위 페이지를 만들 때도 이 `ks-theme` 블록을 복사해 넣을 것.

## 연회색 배경 + 진한 글씨 + 남색 강조 (사용자가 A/B/C 미리보기 중 B 선택)

화면 전체가 너무 파랗다는 요청으로 `#ks-theme`(하위 페이지 37개)와 `index.html`의 새 `#ks-theme`을 함께 바꿨다:
배경 `#F4F5F7` 단색(`.ks-app`의 파란 radial 그라데이션 제거), 선 `#E3E5EA`, 글씨 `--ink`/`--ks-ink` `#05070D`·
흐린 글씨 `#2F3545`, 파란 글씨(`--stamp`, `--ks-primary-dark`) 남색 `#1A2453`, `--brass-soft`(표 머리글 등) 옅은 회색.
아이콘 배지·버튼의 `--ks-primary`(인디고)는 그대로. 메인만: "열기" 버튼 `#2B3A7E`, 그룹 바(일정/업무 도구) 남색
그라데이션, `--stamp`는 메인에선 그라데이션이라 건드리지 않음. 모바일 상단 홈·나의 페이지 배지 22→30px(svg 18px).

## 메뉴 아이콘을 유형별 색으로 + 같은 색끼리 연속 배치

아이콘 배지 색을 6가지 유형으로 나눴다: 기본(홈·나의 페이지·대시보드·학교 현황) #4C5FF0, 일정 #0E9384,
예약·제출·공유(교실 예약·링크 모음·제출함·문서 양식·자료실) #E07A1F, AI 챗봇 #8B5CF6, 개인 업무(메모장·할 일 요청·
교무 업무 도구) #D9467A, 생활·기타(맛집 지도·분실물) #2F9E55. 각 페이지 `#ks-theme`에 `.ic-<유형>` 규칙을 넣고,
사이드바 `.ks-nav-ico`, index 타일 `.icon`, index 기능 카드 `.ks-feature-icon`에 `ic-*` 클래스를 붙였다(날짜·교사로
보기 카드는 일정색). 업무 도구 순서를 같은 색끼리 이어지게 nav.js `DEFAULT_NAV_ITEMS`, index.html 타일 DOM 순서,
모든 페이지 사이드바에서 똑같이 바꿨다: 교실 예약 → 링크 모음 → 제출함 → 문서 양식 → 자료실 → 교사용 챗봇 →
수업용 챗봇 → 메모장 → 할 일 요청 → 교무 업무 도구 → 맛집 지도 → 분실물. 새 메뉴를 추가할 때는 세 곳 순서와
`ic-*` 클래스를 함께 맞출 것.
- 수정: 아이콘을 "연한 배경 + 같은 계열 색 아이콘"으로 바꿨다(B안) — `ic-*` 배경은 유형 색을 흰색과 84% 섞은 파스텔,
  SVG 선(`svg, svg *`의 stroke)은 유형 원래 색. 사이드바·index 타일·기능 카드 모두 같은 규칙(38개 파일의 `#ks-theme`).
- 모바일 상단바 홈·나의 페이지 배지(`.ks-mobile-ico-badge`)도 같은 연한 배경 + 파란 선 아이콘으로(`#ks-theme`).
- `nav.js` 떠 있는 메뉴(사이드바 없는 옛 페이지 — 시험 시간표·생성기·로그인·학생 챗봇 등)도 같은 톤으로: 메뉴 아이콘
  `.gsnav-ico.ic-*`(`NAV_ICON_CAT`로 href→유형), 홈·나의 페이지 버튼 연한 인디고, 테두리 #E3E5EA, 그룹 바 남색 그라데이션.

## 메뉴 구조 재편 — 목적별 7그룹 + `ks-menu.js` 한 곳에서 관리

만든 순서대로 쌓인 메뉴(일정/업무 도구 12개/"교무 업무 도구" 허브)를 목적별로 다시 묶었다: 내 업무(나의 페이지·대시보드·
할 일 요청·메모장·나만의 챗봇 비서), 학교 정보(학교 현황·캘린더·주간계획·교사 시간표·당번표·급식), 예약·공유(교실 예약·
제출함·설문조사·문서 양식·자료실·업무 링크), 평가·학생(시험 시간표·문항 배점·예상 등급·모의면접·결석신고서), AI 챗봇
(교사용·수업용·국어 탐구), 생활(맛집·분실물), 관리(공지사항 작성·교직원 명렬·교사 시간표 편집*·회원 관리*·교사 그룹*·
AI 사용량*·기능 개선 의견·관리 도구, *는 관리자만). 아이콘 색 유형에 `eval`(#0369A1)·`admin`(#475569) 추가.
- 새 공용 스크립트 `ks-menu.js`(`_headers` no-cache): `KS_MENU` 데이터 + 사이드바 렌더. 페이지의 정적 `<nav class="ks-nav">`
  내용을 지우고 `<nav ... id="ksNav"></nav><script src="./ks-menu.js">`로 바꿨다(동기 실행이라 깜빡임 없음). 관리자 전용
  항목은 `localStorage.ks_is_admin`으로 먼저 그리고, nav.js의 관리자 확인 뒤 `window.ksMenuSetAdmin()`으로 맞춘다.
- `nav.js`: `DEFAULT_NAV_ITEMS`·`NAV_ICONS`·`NAV_ICON_CAT`을 KS_MENU에서 만든다. 메뉴로 옮긴 항목은 `EXTRA_SEARCH_ITEMS`에서
  뺐다(남은 것: 날짜로 보기·교사별 보기·시험 시간표 생성기·회원 일괄 등록·내 할 일). 타일 그룹핑/숨기기 버튼은 index에서만.
- `index.html` 타일을 새 그룹 순서로 다시 만들었다(관리 그룹은 메인에 없음). 학교 현황 기능 카드는 학교 정보 색.
- `admin-tools.html`은 "관리 도구"로: 공지사항 작성·기능 개선 의견·교직원 명렬 + 관리자 타일·비밀번호 관리만 남김.
  시험·평가·설문·결석신고서·나만의 챗봇 비서 타일은 메뉴로 옮겨 지웠다. 그 페이지들의 "← 교무 업무 도구로"는 "← 메인으로".
- 시험 시간표는 메뉴 항목 하나(`exams.html`)이고, 생성기는 그 페이지의 "+ 시험 추가하기"로 들어간다(페이지 병합은 안 함).

## 기능 개선 의견 메뉴 숨김
- KS_MENU 항목에 `hidden: true` 지원: 사이드바·햄버거에서 빠지고 🔍 검색(nav.js HIDDEN_NAV_ITEMS)과 관리 도구 타일로만 접근. feedback.html에 적용.
