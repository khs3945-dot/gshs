# link-hub — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

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
