# room-booking — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

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

## 예약 현황 표 — 두 손가락 핀치로 표만 확대/축소

`.grid-scroll`이 `touch-action:none`이라 휴대폰 핀치가 아무 동작도 안 했다. 패닝 코드 뒤에 핀치 처리를 추가: 표 안에
터치 포인터가 두 개 닿으면 패닝/칩 드래그를 취소하고 `pinchState`를 잡아, 두 손가락 거리 비율만큼 기존 `setGridZoom()`
(버튼·Ctrl+휠과 같은 CSS `zoom`, 50~200%)을 바꾼다. 두 손가락 가운데가 가리키던 표 위치가 그대로 남도록 스크롤도 보정.
핀치 중엔 패닝 pointermove가 `if(pinchState) return`으로 멈추고, 끝난 뒤 400ms 동안만 칸 클릭(날짜 팝업)을 막는다.

## 버튼 아이콘 (2026-10-23)
- 달력형태 다운로드 영역의 👀 보기·↺ 전체보기·📅 달력형태로 다운로드, 예약 후 '📅 학교 공용 캘린더에도 추가'를 선 SVG(`.btn-ic`)로.

## 교실 배치도 이미지 교체
- `app_settings.layout_images`([{title,url}], 없으면 저장소 기본 jpg 2장). 학교 현황 › 교실 배치도 탭의 `#layoutAdminCard`(🔑 관리자 모드)에서 이미지 올리기(긴 변 1600px JPEG → 공개 버킷 `site-images/layouts/`, insert는 승인 회원만)·이름·순서·빼기 → `layout_images_save(p_password, p_items)`(편집 비밀번호, url은 기본 jpg 또는 site-images/layouts만 허용). 교실 예약은 보기만. 예전 이미지 파일은 Storage에서 지우지 않음.
