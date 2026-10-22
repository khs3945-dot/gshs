# duty — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

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
