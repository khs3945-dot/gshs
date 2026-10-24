# timetable-staff — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

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

## 학기별 전체 교사 시간표 갱신은 사이트 기능이 아니라, 학기당 1회 Claude에게 맡기는 수작업 처리

`staff.schedule`을 학기 전체 단위로 갈아끼우는 일(새 학기 시간표 반영)은 한 학기에 한
번뿐이고, 그 원본 파일(교무실에서 받는 엑셀)의 형식도 학교/담당자 사정에 따라 매번
달라질 수 있어 — 사용자가 직접 "그 파일이 내가 담당자가 아니라서 파일 형식을 미리
정하기는 어려운거 같고, 한학기에 한번이니까 그 때마다 양식이 바뀔 수 있어. 그럼 양식을
만들어두기보다는 한학기에 한번 시간표가 바뀔 때 너한테 처리를 맡겨서 업데이트하는
방향은 어때?"라고 제안한 대로, **범용 업로드/파싱 UI 기능을 만들지 않기로 했다** — 매
학기 그 시점에 실제 파일을 Claude에게 건네 그때그때 구조를 파악해 1회성으로 파싱하고
DB를 갱신하는 방식으로 처리한다 (staff-edit.html의 엑셀 양식 다운로드/업로드 기능은
한 번에 한두 명만 손보는 평소 편집용으로 그대로 남고, 이 학기 전체 갱신과는 별개).

**2026학년도 2학기 갱신 때 실제로 겪은 일** (다음 학기에도 같은 흐름을 따르면 됨):
사용자가 처음엔 교사별로 블록이 나뉜 텍스트형 시간표 파일을 보여줬는데, 바로 뒤이어
"더 구조화된 시간표 파일이 있었어"라며 **교실(행) × 요일·교시(열)** 형태의 깔끔한
그리드 파일(시트명 `주간시간표(YYYY-MM-DD)`, 1행에 요일 병합 헤더, 2행에 교시 번호,
각 셀이 `"과목명\n교사명"` 형식)을 추가로 건넸다 — 이쪽을 실제 갱신 소스로 썼다.
처리 순서:
1. 그리드를 교실별로 훑으며 (요일,교시) 열 위치 → 과목/교사로 역색인해서, **교사
   이름 기준으로 뒤집어** `{teacher: {day: {period: {subject, room}}}}` 형태로
   재구성한다 — `room`은 숫자로만 된 문자열이면 JSON number로, `컴퓨터실`/`AI교실`/
   `진학관2층이동교실`/`직업반(진학관3층이동교실)` 같은 특수실 이름은 문자열 그대로
   유지해, 이미 DB에 저장돼 있던 기존 `schedule` 값들의 타입 관례와 맞춘다.
2. 이렇게 역색인하는 과정에서 "같은 교사가 같은 요일·교시에 서로 다른 두 교실에서
   수업하는" 충돌이 하나도 없는지 확인해 — 있었다면 그리드 자체가 내부적으로
   모순된다는 뜻이라 원본을 다시 확인해야 했을 것(이번엔 0건, 깨끗했다).
3. **쓰기 전에 반드시 안전망을 먼저 만든다**: 이번에 갱신 대상이 될 교사 이름 전원의
   현재 `schedule` 값을 `execute_sql`로 통째로 조회해 그대로 백업해둔다(롤백용) —
   실제로 이번엔 이 백업 조회 자체가 뜻밖의 발견으로 이어졌다: 여러 교사(김혜숙,
   배하늬, 유두선, 윤은혜, 이슬아, 이종용, 정민재)의 기존 `schedule`이 이미
   `{"room":null,"subject":205}`처럼 room/subject 필드가 서로 뒤섞인 상태로
   깨져 있었고, 이상진은 아예 `schedule: null`이었고, 추희정은 본인 수업이 아닌
   다른 교사(화법과작문 담당 이상진)의 수업이 섞여 들어가 있었다 — 이런 선행 오염을
   먼저 눈으로 확인해두면, 새 파일로 갈아끼운 뒤 "숫자가 줄어든 것 같은데 맞나"
   싶은 교사를 일일이 의심하지 않고도 "이건 원래 깨져 있던 걸 고친 것"이라고
   확신할 수 있다.
4. 새로 뒤집은 JSON으로 46~47명 분을 한 번의 `update ... from (values (...), ...)
   as v(name, schedule) where s.name = v.name` 쿼리로 일괄 반영한다(개인별 UPDATE
   수십 번이 아니라 단일 트랜잭션) — 이름은 정확히 `staff.name`과 일치해야 하므로,
   실행 전 반드시 파일에서 뽑은 교사 이름 목록을 `select name from staff`와
   대조해 오타/미등록 이름이 없는지 전수 확인한다(이번엔 47명 전원이 정확히
   일치, 오타 0건).
5. 실행 후 몇 명을 다시 조회해서 반영이 제대로 됐는지(특히 3번에서 발견한 오염
   사례들이 깨끗해졌는지) 확인한다.

이 파일 하나가 학교 전체(1~3학년 공통/선택과목 교실)를 담지 못하는 경우도 있을 수
있다 — 이번엔 58명의 `staff` 중 47명만 이 파일에 등장했고, 나머지 11명(행정/비교과
등으로 추정)은 애초에 `schedule`이 `null`인 채 그대로 남았다(건드리지 않음, 해당 파일이
다루는 범위 밖이라 임의로 추측해 채우지 않았다). 다음 학기에 다른 형식의 파일을
받더라도, 이 섹션에 적은 "교사 이름 기준 역색인 → 충돌 검사 → 백업 → 일괄 UPDATE →
반영 확인"이라는 절차 자체는 그대로 재사용하면 된다 — 매번 바뀌는 건 1번 단계의 구체적인
파싱 로직(그 학기 파일의 실제 셀 구조에 맞춰 매번 새로 작성)뿐이다.

**정정: 위 "학기당 1회 Claude에게 맡기는 수작업 처리"는 사용자의 의도를 잘못 읽은
것이었다 — 실제로는 사이트 기능을 만들어달라는 요청이었다.** 사용자가 "이 양식대로
올릴 수도 있어. 이건 좀 정형화된 양식이라"며 두 번째(더 구조화된) 파일을 보여준 건
그 특정 파일 하나를 처리해달라는 뜻이 아니라, **그 구조 자체가 매 학기 재사용 가능한
정형화된 양식이니, 그 구조를 읽어서 시간표를 갱신하는 기능 자체를 만들어달라는
의미**였다("양식만 보내준거고 변경까지 하라는 말은 아니었는데... 그런 구조니까 구조를
읽어서 시간표 업데이트가 가능하게 기능만 만들어달라는거였어"). 바로 위에서 실행한
"한 번은 Claude가 직접 SQL로 처리"는 결과적으로 유효한 작업(실제로 기존 데이터 오염
몇 건을 바로잡는 효과까지 있었다)이었지만, 그건 이번 학기 1회분 처리였을 뿐 — 다음
학기부터는 **`staff-edit.html`의 "전체 교사 시간표 일괄 업데이트" 카드**(아래 설명)를
써야 한다. 이 섹션 제목 자체("학기별 전체 교사 시간표 갱신은 사이트 기능이 아니라...")가
이제는 틀린 전제이니, 향후 이 주제를 다시 참고할 땐 바로 아래 `staff-edit.html` 섹션을
기준으로 삼을 것 — 위 1~5번 절차는 "그 기능이 없던 시절, 1회성으로 어떻게 처리했는지"의
기록으로만 남겨둔다.

## `staff-edit.html` — 전체 교사 시간표 일괄 업데이트 (교실×요일·교시 그리드 엑셀 파싱)

바로 위 정정 사항에 따라 실제로 만든 기능. 교무실에서 받는 "교실별 주간 시간표" 엑셀
파일(교실이 행, 요일·교시가 열인 그리드 — 2026학년도 2학기 갱신 때 실제로 받은 파일의
구조를 그대로 재사용 가능한 형식으로 일반화했다: 시트 1행은 요일 병합 헤더, 2행은 교시
번호, 1열은 순번, 2열은 교실명, 그 뒤 각 칸은 `"과목명"` 다음 줄에 `"교사명"`)을 그대로
업로드하면, 사이트가 알아서 교사 이름 기준으로 뒤집어 전체 교사의 `staff.schedule`을
한 번에 갱신한다 — 더 이상 매 학기 Claude에게 파일을 맡길 필요가 없다.

`staff-edit.html`의 기존 "교사 시간표 편집"(선생님 한 명씩 고르는 폼) 카드 바로 아래
새 카드 "전체 교사 시간표 일괄 업데이트"를 추가했다. 로직:
- **`parseScheduleGridSheet(rows)`** — 2026-2학기 처리 때 검증했던 파싱 로직을
  그대로 클라이언트 JS로 옮겼다: 1행에서 요일(괄호 날짜 부분은 정규식으로 제거)을
  병합 칸 기준으로 캐리포워드하고, 2행에서 교시 번호를 읽어 열 인덱스 → `{day,
  period}` 맵을 만든 뒤, 3행부터 각 행(교실)의 각 칸을 훑어 `"과목\n교사"`를
  파싱한다 — `room`은 숫자로만 된 문자열이면 JSON number로, 특수실 이름(컴퓨터실
  등)은 문자열 그대로 유지해 기존 DB 타입 관례와 맞춘다. 같은 교사가 같은
  요일·교시에 두 번 나오면(그리드 자체의 모순) **먼저 읽은 값을 유지하고** 목록에
  충돌로 기록한다 — 조용히 덮어쓰지 않고 업로드한 사람이 원본 파일을 확인하도록
  경고로 보여준다.
- 업로드 직후 **미리보기**(`renderBulkSchedPreview()`)가 (1) 반영 대상 선생님 수와
  이름 목록, (2) `public_staff`에 이미 등록된 이름과 대조해 **명렬에 없어서 반영되지
  않는 이름**(오타이거나 아직 등록 안 된 교사 — "교직원 명렬에 먼저 등록해주세요"
  안내와 함께), (3) 위에서 설명한 같은 시간 충돌 경고를 모두 보여주고, 반영 대상이
  1명이라도 있으면 "N명 반영하기" 버튼을 띄운다 — `staff_roster_upsert`/엑셀
  업로드 미리보기와 같은 "파싱 → 미리보기 → 확인 버튼" 흐름.
- **`staff_schedule_bulk_upsert(p_password, p_updates)`** RPC(새로 추가, `shared_edit_
  settings` 비밀번호 패턴 재사용 — `verify_shared_edit_password`로 게이트) —
  `p_updates`는 `[{name, schedule}, ...]` jsonb 배열을 받아 이름이 일치하는
  `staff` 행만 `schedule` 컬럼을 덮어쓰고, 매칭된 수와 매칭 안 된 이름 목록을
  `{updated, not_found}`로 돌려준다. 기존 `staff_schedule_upsert`(선생님 한 명)를
  대체하지 않고 나란히 둔다 — 한 명씩 고쳐 쓰는 기존 폼은 그대로 쓸모가 있다.
  여러 교사를 한 번에 반영하지만 한 쿼리 안에서 이름별로 개별 `update`를 돌리는
  PL/pgSQL 루프라, 2026-2학기 때처럼 SQL 텍스트에 자바스크립트 문자열을 직접
  끼워 넣어 이스케이프를 신경 쓸 필요가 전혀 없다 — supabase-js가 JSON을 그대로
  RPC 파라미터로 보내므로 작은따옴표 이스케이프 문제 자체가 사라진다.
- 반영 확정 전 `confirm()`으로 "되돌릴 수 없다"는 경고를 한 번 더 보여준다(공유
  비밀번호만 알면 누구나 전체 교사의 시간표를 한 번에 덮어쓸 수 있는, 파급력이 큰
  동작이라서) — `room-booking.html`의 엑셀 일괄 예약 업로드가 다루는 위험도와는
  다른 급으로, 이 경고 단계는 생략하지 않는다.
- 파일에 이름이 없는 선생님의 기존 `schedule`은 전혀 건드리지 않는다 — RPC 자체가
  `p_updates`에 들어있는 이름만 순회하므로, 2026-2학기 때처럼 파일 범위 밖(행정/
  비교과 등) 교사는 자동으로 안전하게 제외된다.
- `test_staff_edit_bulk_schedule.js`로 (1) 명렬에 있는 이름만 반영 대상으로
  잡히는지, (2) 명렬에 없는 이름이 "반영되지 않는 선생님"으로 분리돼 보고되는지,
  (3) 같은 시간 충돌이 경고로 뜨는지(충돌 시 먼저 읽은 값이 유지되는지), (4) 확인
  버튼을 누르면 RPC가 정확한 payload로 호출되는지(room 타입 변환 포함) 검증했다.

## `staff-edit.html` — "전체 교사 시간표 일괄 업데이트"에도 양식 다운로드 버튼 추가

사용자 요청: "전체교사 시간표 업로드도 양식 파일 만들어서 다운받을 수 있게 해줘." 같은
카드의 위쪽에 있는 "교직원 명렬" 업로드는 이미 "엑셀 양식 다운로드"(기존 명렬을 미리
채워서 내려주는, `room-booking.html`에서 시작된 관행)가 있었는데, 바로 아래의 "전체
교사 시간표 일괄 업데이트"(교실×요일·교시 그리드 파일 업로드, `parseScheduleGridSheet()`)
에는 그 짝이 없어서 매번 교무실에서 받은 파일의 정확한 칸 구조(1행=요일, 2행=교시,
1열=순번, 2열=교실, 칸마다 "과목\n교사")를 처음부터 손으로 맞춰 만들어야 했다.

- **`buildScheduleGridTemplateRows()`**(새 함수) — `parseScheduleGridSheet()`가
  읽는 모양을 그대로 거꾸로 만든다. 이미 화면에 로드돼 있는 `scheduleTeachers`
  (교사별 시간표 편집 섹션이 페이지 진입 시 `public_staff`에서 불러와 둔 `{name,
  schedule}` 배열 — 별도 재조회 없이 그대로 재사용)를 훑어 등장하는 모든 교실을
  모으고(숫자 교실 먼저 오름차순, 그다음 문자 교실 가나다순 — `room-booking.html`의
  엑셀 양식이 교실을 정렬하는 방식과 같은 원칙), 교실×요일×교시 조합마다
  `"과목\n교사명"`으로 역색인해서 채운다. 교실이 하나도 없으면(막 만든 사이트라
  아무 시간표도 없는 경우) `['201', '컴퓨터실']` 예시 두 줄만 내려준다 — 교직원
  명렬 양식이 데이터가 없을 때 예시 한 줄을 내려주는 것과 같은 관행.
- **`public_staff`는 누구나 읽을 수 있는 공개 뷰라 별도 RPC 없이 바로 읽을 수
  있다** — 교직원 명렬(이름/부서/연락처 등 개인정보 포함)이 `staff` 테이블 자체를
  admin만 직접 읽을 수 있어 `staff_roster_list_for_edit` RPC(공용 비밀번호 검증)를
  거쳐야 했던 것과 다르다. 시간표 데이터만 보면 개인정보 민감도가 낮아, 이 테이블은
  처음부터 `teacher.html`/`teachers.html` 등 여러 페이지가 로그인 없이도 바로
  조회하는 공개 뷰로 설계돼 있었다 — 그래서 이 양식 다운로드 버튼도 그 열린 뷰를
  그대로 쓸 뿐, 새 RPC나 새 권한 체크가 전혀 필요 없었다.
- "전체 교사 시간표 일괄 업데이트" 카드의 파일 입력(`#bulkSchedInput`) 바로 왼쪽에
  "엑셀 양식 다운로드"(`#btnDownloadSchedGridTemplate`) 버튼을 추가했고, 카드
  안내문에도 "이 양식 그대로 없으면 아래 '엑셀 양식 다운로드'로 내려받아 채워서
  올리세요" 한 문장을 덧붙였다.
- Playwright로 `XLSX.writeFile`을 가로채 실제로 내려받으려던 워크북을 캡처한 뒤,
  그 내용을 `parseScheduleGridSheet()`와 똑같은 로직(테스트 쪽에 복제)으로 다시
  읽어 **왕복 검증**했다 — (1) 두 교사·세 칸짜리 샘플 시간표로 양식을 만들면
  등장한 교실 3개(201, 305, 컴퓨터실)가 숫자 먼저 정렬돼 행으로 나오는지,
  (2) 그 양식을 다시 파싱하면 충돌 없이 원본과 정확히 같은 과목/교실/교사가
  복원되는지(5칸 전부, 유령 데이터 없이), (3) 등록된 시간표가 전혀 없을 때는
  `201`/`컴퓨터실` 예시 두 줄만 내려주는지 — 모두 확인했다.

## `staff-edit.html` → "교사 시간표 편집"만 남김

교직원 명렬은 `staff-roster.html`(교직원 명렬 페이지)과 겹쳐서, staff-edit.html의 "교직원 명렬 관리" 카드(붙여넣기·엑셀
양식/업로드·명렬에 없는 회원 비활성 질문)와 그 JS를 지웠다. 페이지 이름은 "교사 시간표 편집"(title/h1, admin-tools 타일,
nav.js 검색 항목). 남은 것: 교사 시간표 편집, 전체 교사 시간표 일괄 업데이트, 공용 편집 비밀번호 잠금 해제.

## 교사 시간표: 그룹 검색
- teachers.html 검색에 그룹 추가: public_staff 부서·교과 + public_profiles(부서·교과·"N학년 담임"·groups). 2명 이상 그룹만. 제안 목록 상단 👥 항목 클릭 또는 그룹명 정확히 입력 후 Enter → 소속 전원 추가.
- 2명 이상 선택 시 "칸별로 비는 인원" 표(비는 수/전체, 1~2명만 수업이면 이름 표시), "모두 지우기" 칩.

## 빈 교시로 선생님 찾기 (teachers.html, 2026-10-23)
- "월1", "월1, 화3", "수2~4", "목요일 3교시" 입력 → 교시별 빈 선생님 + (2개 이상이면) 모두 비는 선생님. 그룹 선택으로 좁히기. 이름 누르면 아래 시간표 비교에 추가. `parseSlots`/`runFreeFinder`, 판정은 기존 `isFree`(금 5→6 복사 반영).

## 설명 접기 (2026-10-23)
- 교사 선택·빈 교시 찾기 카드의 설명(p.hint)을 처음엔 접고(.fold) 제목 옆 삼각형 버튼(.hint-toggle, SVG — ▸ 글자는 글꼴 따라 너무 작게 나와서)으로 펼침.

## 교사 시간표 조회 표시·검색 정리 (2026-10-24)
- 칸: 수업 = 푸른 음영(`td.lesson` #E6ECFF), 공강 = 빈 칸(글자 없음), 두 명 이상 공통 공강 = 흰 바탕 + 빨간 안쪽 테두리 3.5px(`box-shadow inset #E5484D`, title "공통 공강"). 표 위 범례.
- 검색 = 선생님 이름 + 교사 그룹(명렬의 부서·교과·N학년 담임·그룹 열, 2명 이상)만. `profiles.groups`는 이제 명렬에서 자동으로 맞춰져서 읽지 않음. 제안 목록에 그룹 종류(부서·교과·담임·그룹) 배지.
