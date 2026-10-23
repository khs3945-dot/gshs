# my-page-dashboard — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

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

## 할 일 목록: MS To Do·Google Tasks 기본 꺼짐
- my-todo.html 상단 "다른 할 일 앱 연결" 스위치(extMsOn/extGtOn, ks_todo_list_prefs). 정한 적 없으면 꺼짐, 단 이미 연결해 쓰던 사람(MSAL 계정 있음/구글 연결 이력)은 켜짐. 꺼져 있으면 카드 숨김 + 자동 재연결 안 함(연결 해제는 안 함).

## 나의 페이지: "지난 주간 계획" 칸 제거
- my-page.html blockWeekPlanArchive·wpList·wpFmtDate 삭제. 이번주 칸은 원래대로 AI 요약(summary 없을 때만 iframe 원문).

## 주간계획 요약 줄바꿈 정리(tidyWeekPlanText)
- my-page.html·weekplan.html: 요약 글을 보여주기 전에 "부서 | ■ a ■ b" → 부서 줄 + "  ■ a" 줄들, " · "로 이어진 항목도 줄 나눔, 표 머리줄(부서|추진업무) 제거, 그룹 사이 빈 줄. (원인: 표가 글로 펴지면서 한 칸의 항목이 한 줄로 이어짐 — Apps Script는 그대로)

## 주간계획 요약 정리 보강 (2026-10-23)
- 원문 글머리가 반각 ￭(U+FFED)라 줄이 안 나뉘던 문제 → tidyWeekPlanText가 ■▪◆●•￭◼◾□ 모두 처리.
- 내용이 ￭뿐인 부서(1~3학년부·행정실 등)와 내용 없는 제목은 통째로 뺌. 주간일정 표 줄 "10/20 | 화 | 학력평가" → "10/20(화) 학력평가" 한 줄, 일정 없는 날은 뺌. (my-page.html·weekplan.html 같은 함수)

## 주간계획 요약 탭: 날짜별(기본)·부서별 (2026-10-23)
- 옛 탭(줄글/날짜별 표/부서별 표)은 AI 요약이 "·" 형식일 때만 떠서 지금 원문 형식에선 사라져 있었음 → 항상 두 탭.
- 날짜별: `wpDateViewHtml` — 정리된 요약의 항목마다 첫 날짜(10/22, 10.27., 2026.10.13.)로 날짜순 묶음, 제목은 "10/22(목)", 항목 앞 날짜는 지움(기간 "~"은 유지), 부서 이름 없음, 날짜 없는 항목은 "기타". 부서별: tidyWeekPlanText 결과 그대로.
- my-page.html·weekplan.html 같은 코드.

## 주간계획: 진짜 AI 요약 탭 (2026-10-23)
- Apps Script의 Gemini 요약(ks_summarizeWeekPlan_)이 실패해 원문(표 텍스트)이 "AI 요약" 자리에 나오고 있었음 → 새 Edge Function `weekplan-summarize`(Claude 하이쿠 기본·Gemini 폴백, ai_models 슬러그, logAiUsage, verify_jwt:false+토큰 확인)가 날짜순 요약("10/22(목)" + "  · 내용", 부서 없음, 기타)을 만들고 `weekplan_cache` id=`ai:<fileId>:<modifiedTime>`에 저장 — 문서가 바뀔 때만 AI 호출.
- 탭: 요약(기본, AI) · 날짜별(wpDateViewHtml) · 부서별(정리된 원문). AI가 오기 전·실패 시 요약 탭에 안내 + 날짜별 정리. Apps Script가 이미 "·" 형식 AI 요약을 주면 그걸 그대로 씀.
- my-page.html·weekplan.html 같은 코드. ai-usage.html 기능별 모델 목록에 추가.

## AI 요약 요일 오류 보정 (2026-10-23)
- weekplan-summarize(haiku) 요약이 '10/20(토)', '10/27(토)'처럼 **요일을 틀리게** 붙인 일이 있었음(날짜·묶음은 원본과 일치). 화면에 쓰기 전에 `fixWeekdays(text)`로 'M/D(요일)'의 요일을 날짜로 다시 계산(연도는 오늘과 가까운 해) — index.html(이번 주 일정)·weekplan.html·my-page.html. 캐시된 요약도 그대로 고쳐 보임.

## 날짜 보기에 주간계획 항목 (2026-10-23)
- date.html(메인 검색의 "날짜로 보기"가 여는 페이지)에 "주간계획" 칸: weekplan_cache `latest`의 각 파일 원문(summary)에서 그날 날짜가 적힌 항목만 `wpItemsForDate(text, iso)`로 뽑아 부서와 함께 표시. 로그인(승인) 필요(weekplan_cache RLS).
- 날짜 형식: `10/27(화)`, `10.27.(화)`, 범위 `10/26(월)~28(수)`·`9.28.(월)-10.2.(금)`·`10/12~10/16`(범위 안 모든 날), 마감 `~10.2.(금)`, 표 줄 `10/13 | 화 | 교직원회의`. 부서는 "교무기획부 | ￭…" 표의 첫 칸 또는 들여쓰지 않은 짧은 줄. 같은 글은 한 번만.
