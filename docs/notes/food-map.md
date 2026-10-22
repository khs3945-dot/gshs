# food-map — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

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
