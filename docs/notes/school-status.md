# school-status — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

## `school-status.html` (학교 현황) — 학교 기본정보·학년별 명렬표·학사일정

사용자가 학교 자체의 "학교 현황" Google Sheet 링크를 공유하며, 나이스 "전체 학급"
일람표에 이름이 없어 매번 반별 파일을 다 모아 올려야 하는 번거로움을 해결하고 싶다고
설명했다 — 그 시트에 이미 학년별 명렬표/반 편성/학교 기본정보가 다 정리돼 있으니,
그 내용을 사이트 안으로 가져와서 `student_name_roster`(위 섹션)의 이름 출처로 직접
쓰자는 것. 네 가지를 명시적으로 확인받았다: (1) 반영 방식은 **지금 세션에서 한 번
가져와 담아두고(일회성), 이후엔 관리자가 엑셀로 다시 업로드하는 방식** — Google
시트에 매번 실시간으로 접속하는 라이브 연동이 아니다(관리자용 "다시 가져오기"
버튼으로 재반영 가능해야 한다는 요건), (2) 이번 주 작업 범위는 반 편성(담임/부담임/
인원)과 수업일수/학사일정까지 전부, (3) 페이지 위치는 자유, (4) 탭 구조는 "학교
현황 탭 + 1~3학년 명렬표 탭 + 학사일정 탭"(사용자가 직접 음성으로 지정).

**Google 시트는 일회성 시드 소스였을 뿐, 라이브 의존성이 아니다.** 이 환경에
Google Sheets API를 직접 호출하는 MCP 도구가 없어서(`download_file_content`는
`exportMimeType`을 줘도 "구현되지 않음" 에러), `get_file_metadata`를
`snippetVerbosity: 'MAX_ALLOWED'`로 호출해 시트 전체 내용을 텍스트로 받은 뒤,
Node.js로 직접 작성한 토크나이저/검증 스크립트(`/tmp/.../scratchpad/roster_raw/
parse.js`)로 파싱해 Supabase에 한 번 밀어넣었다 — 584명(1학년 195+2학년 181+3학년
208, `select grade, count(*) from students group by grade`로 정확히 일치 확인)의
학생 행, 학교 기본정보 1행, 반 편성 21행, 학사일정(주요 행사만 요약, 전체 수업일수
그리드는 의도적으로 생략 — 이미 Google Calendar 기반 학사일정 기능과 중복되고,
병합 셀이 빽빽한 그리드를 손으로 옮기면 오류 위험이 컸다) 21행. 파싱 과정에서
실제 데이터 버그 하나를 잡았다(아래 참고) — 줄 경계가 깨지는 문제였고, 수정 후
3학년 8반이 26번을 건너뛰는 것 등 남은 불규칙은 전부 원본 데이터 자체의 특징으로
직접 확인했다. **3학년 반 편성의 `note`(비고) 컬럼만 의도적으로 비워뒀다** — 원본
CSV에서 3학년만 콤마로 묶인 복합 비고 문자열이 모호해서 안전하게 옮길 수 없었고
(1~2학년은 깔끔한 파이프 구분 표라 정확히 옮겼다), 틀린 추측보다는 빈 값이 낫다고
판단했다.

**(정정: 위 "3학년 비고는 의도적으로 비워뒀다"는 더 이상 사실이 아니다 — 사용자가
원본 "2026학년도 학교 현황" 시트의 실제 캡처 이미지를 보내줘서, 그 이미지에 보이는
3학년 8개 반의 비고 값을 Supabase에 직접 채워 넣었다.** 1반=`빙1, 직5, 특수학급1`,
2반=`빙1, 특수학급1`, 3반=`빙1, 특수1`, 4반=`직3`, 5반=`직2, 특수학급1`,
6반=`직1, 특수학급1`, 7반=`빙2, 지1, 특수학급1`, 8반=`빙2` — `class_sections`의
해당 8개 행을 `UPDATE`로 채우고 재조회해 확인했다. 이미지로 직접 원본 표를
받았으므로 콤마로 묶인 문자열을 추측해서 나눌 필요가 없었다(이미지의 각 반 칸이
이미 그 반 하나의 비고로 분리돼 있었다). 이 수정도 순수 데이터 교정이라 어떤
파일도 바뀌지 않는다(git 커밋 대상 아님) — 이 문단 자체가 그 변경을 기록해두기
위한 CLAUDE.md 수정이다.

이렇게 일회성으로 들여온 뒤, **그 이후의 유지보수는 사이트 안에서 직접 수정/
재업로드하는 것**이 설계상 기본 경로다 — Google 시트를 다시 열어 고치고 또 가져오는
흐름이 아니라, `school-status.html`의 관리자 모드가 이미 "학교 현황 자료 업로드나
수정 자체를 사이트 내에서" 하는 바로 그 기능이다(엑셀 재업로드 + 인라인 수정 폼
둘 다). 사용자가 나중에 "지금은 Google 시트에서 내용을 불러오지만... 나중에 그런
구조 그대로 사이트에... 수정 편집 사이트 내에서 하게 바꾸는 거는 어렵지 않지?"라고
물었을 때도 같은 답 — **이미 그렇게 만들어져 있다.** Google 시트는 최초 1회의
데이터 소스였을 뿐, 이후 한 번도 다시 읽지 않고 그럴 계획도 없다.

- **4개 테이블**: `school_overview`(연도별 1행 — 학교명/학교번호/전화/주소 등
  기본정보), `class_sections`(학년+반 단위 — 담임/부담임/인원/비고), `students`
  (학년+반+번호+이름 — `student_name_roster`가 쓰는 것과 같은 5자리 `buildStudentNo`
  키 체계를 그대로 공유), `academic_events`(날짜+제목+설명, 주요 행사 요약). RLS는
  네 테이블 모두 같은 모양 — `select`는 승인된 교사 전체(`exists(select 1 from
  profiles where id=auth.uid() and approved=true)`), `insert`/`update`/`delete`는
  관리자만(`current_user_is_admin()`). `student_name_roster`가 "승인된 교사 누구나
  쓸 수 있는" 더 열린 RLS였던 것과 의도적으로 다르다 — 이쪽은 학교 전체의 공식
  현황 데이터라 쓰기는 관리자로 좁혔다(읽기는 둘 다 승인된 교사 전체).
- **탭 구조**: `#tabOverview`/`#tabGrade1`/`#tabGrade2`/`#tabGrade3`/`#tabEvents`
  (사용자가 지정한 순서 그대로), 다른 탭 UI(room-booking.html의 `.rb-tabs` 등)와
  같은 "하나만 보이게 토글" 패턴. 로그인+승인 게이트는 이 저장소의 표준 3단
  (`#gateView`/`#pendingView`/`#protected-content`) 패턴을 그대로 썼다.
- **학년별 명렬표 탭**: 이름/학번/반/번호 검색 필터(클라이언트 사이드), 그리고
  "📋 공유 명단에 반영" 버튼(`onSyncRoster`) — 그 학년 전체 학생을
  `student_name_roster`에 upsert해서, `grade-estimate.html`의 학번↔이름 매칭이
  바로 이 데이터를 쓸 수 있게 한다. 이게 이 페이지가 만들어진 근본 이유다: 나이스
  반별 파일을 매번 모아 올리는 대신, 학교 현황에 이미 있는 명렬표를 한 번
  동기화해두면 모든 과목의 모든 선생님이 그 매칭을 재사용한다.
- **관리자 전용 재업로드**: 학년별 탭마다 "엑셀 양식 다운로드"(현재 그 학년 데이터로
  미리 채워진 템플릿, `room-booking.html`/`staff-edit.html`과 같은 "현재 값을
  선반영한 템플릿" 관행) → 수정 → "엑셀 올리기" → 파싱 미리보기("N명으로 OO학년
  전체 명렬표를 덮어씁니다 — 기존 M명은 전부 지워지고...") → 확인 버튼을 누르면
  그 학년 범위에서 `delete` 후 `insert`(전체 교체, 부분 병합 아님 — 명렬표는
  "현재 상태의 정확한 스냅샷"이어야 하므로 merge보다 replace가 맞다고 판단).
  `school_overview`도 같은 관리자 모드 안에 인라인 수정 폼이 있다(`onSaveOverview`,
  단순 `update`). **"🔑 관리자 모드" 버튼**(`#btnAdminMode`)이 `staff-edit.html`/
  `duty.html`과 같은 패턴으로 이 모든 관리자 전용 카드(`#overviewAdminCard`,
  학년별 `#gradeAdminCard${g}` 세 개)를 한 번에 드러낸다 — `is_admin` 확인 후에만
  버튼 자체가 보인다.
- **버그 하나 발견·수정**(테스트로 잡힘): 엑셀 업로드 확인 핸들러가 성공/실패
  메시지를 `await loadGradeRoster(grade)` **이전에** DOM에 써넣고 있었는데,
  `loadGradeRoster`가 곧바로 `renderGradeTab`으로 그 탭 전체를 다시 그리면서
  (빈 `uploadMsg` div 포함) 방금 쓴 메시지를 조용히 지워버렸다 — 메시지를
  `loadGradeRoster` **완료 후**, 다시 쿼리한 `el('uploadMsg'+grade)`에 쓰도록
  순서를 바꿔 고쳤다.
- `nav.js`에 `room-booking.html` 다음 항목으로 추가(`group: '업무 도구'`,
  `loginRequired: true`), `index.html`에도 `link-hub.html` 타일 바로 앞에 짝이
  되는 타일을 추가했다(nav.js의 href-group DOM 순서 일치 관행).
- `test_school_status.js`로 비로그인/미승인/승인 세 게이트 상태, 학교 기본정보·
  반 편성 렌더링, 학년 탭 전환, 명렬표 검색 필터, "공유 명단에 반영" 호출, 학사일정
  탭, 그리고 관리자 모드의 기본정보 수정 저장/엑셀 재업로드(미리보기 문구, delete→
  insert 호출, 업로드 후 성공 메시지)까지 끝에서 끝으로 검증했다.

## `school-status.html` — Google 시트 연동 UI(주소 저장/변경) + 반 편성·학사일정 엑셀 재업로드

사용자가 데이터 갱신 방법으로 세 가지를 명시적으로 요청했다: "① Google 시트 주소를
저장하고 그 저장된 주소에서 불러오는 방법, ② 시트 주소가 바뀌면 바뀐 주소를 넣으면
그 새 주소에서 불러오는 방법, ③ 시트에서 불러오지 않고 페이지 내에서 자체적으로
수정하거나 엑셀을 업로드하는 방법." 이어서 두 가지를 확인받았다 — (1) 저장된 주소를
"다시 불러올" 때 기대하는 시트 형식은 **원래 학교가 쓰던 복잡한 형식이 아니라, 지금
이미 만들어둔 엑셀 업로드 양식과 똑같은 간단한 표 형식**(권장) — 그래야 파싱 로직을
새로 안 만들고 그대로 재사용할 수 있고, 시트 레이아웃이 조금만 바뀌어도 깨지는 위험이
없다. (2) Google 시트는 브라우저가 CORS 때문에 직접 읽을 수 없어 Apps Script를
거쳐야 하는데, 그 배포는 지금 당장은 하지 않고 **UI(주소 저장·변경, 엑셀 업로드·
직접 수정)부터 먼저** 완성한다 — `room-booking.html`의 `CALENDAR_SCRIPT_URL`/
`food-map.html`의 `KAKAO_JS_KEY`와 같은 "아직 설정 안 됨" 플레이스홀더 관행 그대로.

- **`school_overview.source_sheet_url`**(새 nullable `text` 컬럼) — 연도별로 저장되는
  Google 시트 주소. 기존 `school_overview_write_admin`(관리자만 쓰기)/
  `school_overview_select_approved`(승인된 교사 전체 읽기) RLS를 그대로 타므로 새
  정책이 필요 없었다.
- **"🔑 관리자 모드" → 학교 기본정보 수정 카드 하단에 "Google 시트 연동" 섹션**이
  새로 생겼다 — `#editSheetUrl` 입력칸 + "주소 저장"(`onSaveSheetUrl`, `source_
  sheet_url`만 upsert — 학교 기본정보 저장(`onSaveOverview`)과는 별개 버튼이라 섞여
  덮어쓰지 않는다) + "🔄 저장된 주소에서 다시 불러오기"(`onSyncFromSheet`).
  `onSyncFromSheet()`는 입력칸의 현재 값이 저장된 값과 다르면 **먼저 그 새 주소로
  저장**(②)한 뒤 불러오기를 시도한다 — 바뀌지 않았으면 그대로 저장된 주소에서(①).
  둘을 하나의 버튼으로 합친 이유: "저장된 주소에서 불러오기"와 "바뀐 주소로
  저장 후 불러오기"는 사용자 입장에서 "그냥 지금 입력칸에 있는 주소로 다시
  불러와줘"라는 같은 동작이라, 버튼을 둘로 나누면 오히려 더 헷갈린다.
- **`SCHOOL_STATUS_SCRIPT_URL`**(플레이스홀더 상수, `'YOUR_SCHOOL_STATUS_SHEET_
  SCRIPT_URL'`) — `schoolStatusScriptMissing`이 `true`인 동안 `onSyncFromSheet()`은
  실제 네트워크 요청을 전혀 보내지 않고 "주소는 저장했어요. 다만 시트를 실제로
  읽어오는 연동(Apps Script)이 아직 설정되지 않았어요 — 그 전까지는 아래 엑셀 양식
  다운로드/올리기나 이 페이지의 직접 수정으로 갱신해주세요"라는 안내만 보여준다
  (③으로 안내). 나중에 전용 Apps Script를 배포해 이 상수만 채우면, 이미 짜여 있는
  `fetch(SCHOOL_STATUS_SCRIPT_URL, {method:'POST', body:{action:'fetchSchoolStatus
  Sheet', url}})` 경로가 그대로 살아난다 — UI/주소 저장 로직은 이미 완성돼 있어서
  추가 작업 없이 연동만 끼워 넣으면 된다.
- **반 편성(`class_sections`)과 학사일정(`academic_events`)에도 학생 명렬표와 똑같은
  "엑셀 양식 다운로드(현재 값 포함) → 올리기 → 미리보기 → 확인 → 전체
  delete-then-insert" 패턴을 추가했다** — 이 두 테이블은 이전까지 조회만 가능하고
  관리자가 사이트 안에서 고칠 방법이 전혀 없었다(③ 요구사항의 빈틈이었다). 반 편성은
  1~3학년 전체를 한 번에(학년/반/담임/부담임/인원/비고 여섯 열), 학사일정도 전체를
  한 번에(시작일/종료일/대상학년/내용 네 열, `parseDateCell()`이 `YYYY-MM-DD` 문자열과
  엑셀 Date 객체 둘 다 받아들인다) 덮어쓴다 — 학생 명렬표처럼 학년별로 쪼개지 않은
  것은, 두 테이블 모두 전체 규모가 작아서(21개 반, 사용자가 쓴 주요 행사 수십 건)
  학년별로 나눠봐야 관리 이점이 없기 때문이다. `wireAdminMode()`의 "🔑 관리자 모드"
  토글이 `sectionsAdminCard`/`eventsAdminCard`도 기존 `overviewAdminCard`/
  `gradeAdminCard1~3`과 함께 한 번에 보이게 한다.
- `test_school_status.js`에 [E] 섹션을 추가해 (1) 주소 저장 성공 메시지와 실제
  upsert payload, (2) Apps Script 미설정 상태에서 "다시 불러오기"가 실제 fetch 없이
  안내만 보여주는지, (3) 빈 주소로 누르면 에러, (4) 반 편성 엑셀 업로드 미리보기·
  반영·delete/insert 호출, (5) 학사일정 엑셀 업로드(종료일 없는 1일짜리 일정 포함)
  미리보기·반영·delete/insert 호출까지 검증했다 — 기존 [A]~[D] 섹션도 다시 돌려
  회귀가 없음을 확인했다.

## `school-status.html` — 반 편성(학년별 반 편성) 데스크탑 레이아웃: 학년당 1행(가로 한 줄)

사용자 요청: "데스크탑 모드에서 반편성은 한 학년이 한 줄에 모두 나오게 해줘. 1,2,3학년
총 3개의 행으로 배열." 기존 `.sections-grid`는 `display:grid; grid-template-columns:
repeat(auto-fit, minmax(160px,1fr))`라, 반 수가 많은 학년(예: 8~9개 반)은 카드 폭이
160px 밑으로 안 줄어드는 한 한 줄에 다 못 들어가고 2줄 이상으로 흘러내렸다.

`@media (min-width:821px)`(이 저장소의 모바일-스택 기준 breakpoint와 동일한 폭) 안에서만
`.sections-grid`를 `display:flex; flex-wrap:nowrap; overflow-x:auto`로 바꾸고, 각
`.section-card`를 `flex:1 1 0; min-width:120px`로 설정했다 — 반이 몇 개든 한 줄(가로)에
배치되고, 카드 수가 적으면 `flex-grow`로 균등하게 늘어나 빈 공간을 채우고, 카드 수가
많아 `min-width:120px`보다 더 줄어들어야 하는 경우에만 가로 스크롤이 생긴다(완전히
안 보이는 것보다 스크롤로라도 한 줄 안에 유지하는 쪽을 선택). 모바일(821px 이하)은
기존 `grid`/`auto-fit` 그대로 둬서 좁은 화면에서는 여전히 자연스럽게 줄바꿈된다 — 이
요청이 "데스크탑 모드에서"로 명시했으므로 모바일 동작은 건드리지 않았다. 학년별로
별도의 `h3`+`.sections-grid` 블록이 이미 존재했으므로(`renderOverview()`), 이 CSS
변경만으로 "1,2,3학년 총 3개의 행"이 자연스럽게 만들어진다 — 별도의 JS 변경은
필요 없었다. `test_school_status_sections_row.js`(새 테스트)로 반 수가 각기 다른
(9/7/8개) 1~3학년을 데스크탑 폭(1280px)에서 렌더링해 세 학년 모두 카드들의
`top` 좌표가 전부 동일한(=한 줄) 것을 확인했고, 모바일 폭(390px)에서도 에러 없이
정상 렌더됨을 확인했다.

## `school-status.html` — 명렬표: 전출·자퇴 학생 취소선 + 데스크탑에서 학년당 한 줄

사용자가 원본 Google 시트 스크린샷(전출/자퇴 학생의 번호·이름에 취소선이 그어져 있는
"1학년 전체 명렬표" 시트, 반마다 열로 나란히 배치된 "2026학년도 학교 현황" 시트)을
보여주며 두 가지를 요청: "명렬표도 기존 전출 자퇴에는 취소선 그어주고, 명렬도 학년의
모든 반을 행바꾸지 않고 한번에 나오게." 바로 앞 세션에서 반 편성(`class_sections`)에만
적용했던 "데스크탑에서 학년당 한 줄" 레이아웃을 명렬표(`students`)에도 그대로 적용하고,
전출/자퇴 등 비고가 있는 학생의 취소선 표시를 새로 추가했다.

- **취소선**: `renderGradeTab()`의 학생 행 템플릿에서 이름 칸에 `class="name"`을 새로
  붙이고(기존엔 클래스 없는 plain `<td>`), `tr.departed td.no, tr.departed td.name{
  text-decoration:line-through; }`를 추가했다 — **비고(`td.note`) 칸 자체는 취소선을
  긋지 않는다**, 전출 사유 텍스트는 그대로 읽혀야 하기 때문(스크린샷의 대부분 행도
  번호·이름만 취소선이고 비고는 일반 텍스트). `tr.departed`의 기존 `opacity:0.55`는
  유지했다(0.6으로 아주 살짝만 조정) — 취소선과 옅은 명도를 함께 써서 "이 학생은 더 이상
  재학 중이 아니다"를 두 가지 시각 신호로 보여준다.
- **명렬표도 데스크탑 한 줄 배치**: `.roster-grid`(학년 하나의 반 카드들을 담는 컨테이너)
  에 반 편성과 같은 `@media (min-width:821px)` 패턴을 적용했다 — 다만 반 편성 카드와는
  달리 **폭을 줄이지 않는다**(`flex:0 0 230px`, 반 편성의 `flex:1 1 0; min-width:120px`와
  차이) — 반 편성 카드는 담임/부담임/인원 몇 줄뿐이라 좁아져도 읽히지만, 명렬표 카드는
  학생 이름이 쭉 나열된 표 전체가 들어있어 폭이 줄면 바로 안 읽히게 된다. 그래서 카드
  폭은 고정하고, 반 수가 많아 한 화면에 다 안 들어가면 `overflow-x:auto`로 가로
  스크롤되게 했다(반 편성처럼 "줄어들다가 필요하면 스크롤"이 아니라 "항상 고정폭 +
  필요하면 바로 스크롤"). `align-items:flex-start`도 추가해, 반마다 학생 수가 달라
  카드 높이가 제각각이어도 모든 카드가 위쪽 기준으로 나란히 정렬된다(flex 기본값인
  `stretch`였으면 가장 긴 카드 높이에 맞춰 짧은 카드들까지 억지로 늘어나 보였을 것).
  모바일(821px 이하)은 기존 `grid`/`auto-fit` 줄바꿈 그대로 유지.
- `test_school_status_roster_row.js`(새 테스트)로 1학년 7개 반(반마다 전출 학생 1명
  포함) 데스크탑 렌더링에서 (1) 카드 7개가 모두 같은 `top` 좌표(한 줄)에 있는지,
  (2) 전출 학생의 번호·이름 칸에 `text-decoration-line: line-through`가 실제
  computed style로 적용되는지, (3) 비고 칸은 취소선이 없는지, (4) 재학 중인 학생은
  취소선이 전혀 없는지(회귀 없음), (5) 모바일 폭에서도 카드 7개가 에러 없이 정상
  렌더되는지 — 모두 확인했고, 기존 `test_school_status.js`/
  `test_school_status_sections_row.js`도 다시 돌려 회귀가 없음을 확인했다.

## `school-status.html` — 명렬표 다운로드 버튼(비관리자도 사용 가능) + 메인 메뉴 그룹 없는 상단 고정

사용자가 한 메시지로 세 가지를 요청: "그리고 그 학년별 명렬표 탭에서 명렬표 다운 받기
버튼도 있어야겠어. 학교 현황은 그룹 아래에 넣지 말고 그 메인 메뉴에서 맨 위에 있는
그룹 없는 곳에다가 넣어 줘. 그리고 시트 다시 불러오기 기능이 없는 거 같아. 엑셀로
업로드하기 기능도 없는 거 같아."

- **학년별 명렬표 탭에 "📥 명렬표 다운로드" 버튼 추가** — 기존에 관리자 전용 엑셀
  업로드/재업로드 기능(`onDownloadTemplate(grade)`)은 있었지만, 그냥 지금 명렬표를
  훑어보기용으로 받아가는 버튼은 승인된 교사 누구에게도 없었다. `renderGradeTab(grade)`
  의 명렬표 카드 안, 검색 입력칸 위에 `#btnDownloadRoster${grade}` 버튼을 새로 추가하고,
  **관리자 게이트(`if(myIsAdmin){...}`) 바깥에서** 무조건 리스너를 건다 —
  기존 `onDownloadTemplate(grade)`(반/번호/이름/비고 열을 가진 xlsx를
  `XLSX.writeFile(wb, \`\${grade}학년_명렬표.xlsx\`)`로 바로 저장)를 그대로 재사용했다 —
  이 함수는 원래 관리자의 "재업로드용 양식 다운로드"와 똑같은 모양의 파일을 만들기
  때문에, 별도의 "조회용" 포맷을 새로 만들 필요가 없었다. 관리자에게는 기존처럼
  "엑셀 양식 다운로드"(관리자 카드 안)도 그대로 남아있어 둘이 공존한다 — 하나는 모두가
  보는 "다운로드"고, 다른 하나는 관리자 전용 "재업로드용 양식"이라는 차이만 있을 뿐,
  내용은 같다.
- **`nav.js`/`index.html`: 그룹 없이 맨 위에 고정** — 기존엔 `DEFAULT_NAV_ITEMS`에서
  `group: '업무 도구'`가 붙어 있어 햄버거 메뉴·`index.html` 타일 그리드 양쪽에서
  그 그룹 안에 묻혀 있었다. `group` 속성을 제거하고, `my-custom-page.html`("대시보드")
  항목 바로 다음 자리로 옮겼다 — 이 저장소의 기존 "ungrouped = 핀으로 맨 위에 고정"
  관행(대시보드 타일이 그렇게 만들어진 것과 동일, `## nav.js` 섹션의 "그룹 없는 항목은
  `tile-pinned-grid`로 모든 그룹보다 먼저 렌더링된다" 규칙)을 그대로 따른 것. `index.html`
  의 `<a class="tool-card" href="./school-status.html">` 블록도 **DOM 순서를 그
  순서와 맞춰** `my-custom-page.html` 타일 바로 다음으로 옮겨야 했다 — 그룹 없는
  타일은 `.card-list`의 실제 DOM 위치가 렌더링 순서를 결정하는 그 gotcha(이미
  `## nav.js`에 문서화된 "대시보드" 사건과 같은 원리) 그대로라, nav.js만 고치고
  index.html 쪽 위치를 안 맞추면 두 UI의 순서가 서로 어긋났을 것이다. 옮기는 김에
  `<h2>학교 현황</h2>`에 빠져 있던 `<sup class="login-mark">*</sup>`도 추가했다 —
  `loginRequired: true`인 다른 모든 타일(나의 페이지/대시보드/메모장/교사용 챗봇 등)은
  이미 이 표식을 달고 있었는데 학교 현황만 빠져 있던 기존의 작은 불일치였다(이번
  이동 작업 중 발견해 같이 고쳤다).
- **"시트 다시 불러오기"/"엑셀로 업로드" 기능이 안 보인다는 세 번째 보고는 실제
  버그가 아니었다** — 코드를 다시 읽고 기존 Playwright 회귀 테스트
  (`test_school_status.js`의 [D]/[E] 섹션: 반 편성/학사일정/학년별 명렬표 엑셀
  재업로드, Google 시트 주소 저장·"다시 불러오기"의 플레이스홀더 안내 메시지)를 그대로
  재실행해 전부 정상 동작함을 재확인했다. 이 기능들은 모두 **"🔑 관리자 모드" 버튼**
  (페이지 맨 위, `profiles.is_admin === true`일 때만 비동기로 드러나는 — `staff-
  edit.html`/`duty.html`/`admin-tools.html`과 같은 "관리자 모드 버튼 → 편집 메뉴 노출"
  패턴) 뒤에 숨어있을 뿐이다. 관리자가 아닌 계정으로 보거나, 관리자 계정이라도 그
  작은 보조 버튼을 아직 눌러보지 않았다면 이 기능들의 존재 자체가 안 보인다 — 코드
  차원의 결함이 아니라 이 UX 설계(의도적으로 관리자 전용 기능을 숨겨둠)가 그대로
  반영된 결과라고 판단해, 기존 로직은 전혀 건드리지 않았다.
- `test_school_status_nav_and_download.js`(새 테스트)로 (1) `index.html` 타일 순서상
  대시보드 바로 다음에 학교 현황이 오는지, (2) 로그인 표식(`login-mark`)이 달려있는지,
  (3) 햄버거 메뉴에서 그룹(`gsnav-group`) 블록보다 앞에("ungrouped") 나오는지,
  (4) 비관리자 계정에는 "관리자 모드" 버튼이 전혀 안 보이는지, (5) 그런데도 "명렬표
  다운로드" 버튼은 보이는지, (6) 그 버튼을 클릭하면 실제 파일 다운로드 이벤트가
  발생하는지 — 모두 검증했고, 기존 `test_school_status.js`/
  `test_school_status_sections_row.js`/`test_school_status_roster_row.js`도 다시 돌려
  회귀가 없음을 확인했다.

## `school-status.html` 명렬표 — 관리자 모드에서 바로 텍스트 입력 수정 + 타이핑 즉시 취소선

사용자 요청: "명렬표에서 관리자 모드 누르면 바로 텍스트 입력해서 수정하는것도 가능하게
해줘. 자퇴 전출이 포함되면 취소선 자동으로 생기게 하고." 기존엔 명렬표를 고치는 유일한
방법이 "엑셀 양식 다운로드(현재 명단 포함) → 수정 → 올리기 → 미리보기 → 확인 → 그
학년 전체 delete-then-insert" 왕복뿐이었다 — 이름 하나, 비고 한 줄만 고치려 해도 매번
엑셀을 내려받아 열어야 했다. 이번 요청은 그 왕복 없이 표 안에서 바로 타이핑해 고칠 수
있게 해달라는 것.

- **"🔑 관리자 모드" 버튼을 눌러야만 인라인 입력칸이 나타난다 — `profiles.is_admin`이
  참이어도 버튼을 누르기 전엔 비관리자와 똑같은 줄글 표만 보인다.** 이 페이지(그리고
  `staff-edit.html`/`duty.html`/`admin-tools.html`)의 기존 "관리자 모드 버튼 → 편집
  메뉴 노출" 패턴(관리자 계정이어도 버튼을 누르기 전까진 아무 편집 UI도 안 보임)을
  그대로 따른 것 — `renderGradeTab()`의 행 템플릿이 `myIsAdmin`만이 아니라 새
  모듈 변수 `rosterEditMode`(기본 `false`)까지 함께 확인해서 `(myIsAdmin &&
  rosterEditMode)`일 때만 각 학생 행을 `<input>` 두 개(이름/비고)짜리로 그린다.
  `wireAdminMode()`의 `#btnAdminMode` 클릭 핸들러가 기존 관리자 카드들
  (`overviewAdminCard`/`gradeAdminCard${g}` 등)을 토글하던 바로 그 자리에서
  `rosterEditMode`도 같이 뒤집고, 이미 로드돼 캐시된(`rosterByGrade`) 1~3학년 탭을
  다시 그려(네트워크 요청 없음) 줄글↔입력칸을 전환한다.
- **번호(no)는 인라인 수정 대상에서 뺐다** — `students`의 기본키가
  `(year, grade, class_no, no)` 네 컬럼의 복합키라서(Supabase에서 직접 조회해 확인),
  번호를 고치는 건 "이 행을 수정"이 아니라 "다른 행으로 바꿔치기"가 돼버린다. 이름/
  비고만 인라인 입력칸(`input.roster-edit-name`/`input.roster-edit-note`)으로 바꾸고,
  번호를 바꾸고 싶으면 기존 엑셀 재업로드 경로를 쓰도록 남겨뒀다.
- **저장은 입력칸의 `change`(블러 또는 Enter) 시점에 한 번씩, 그 행의 네 기본키 값
  (`data-grade`/`data-class`/`data-no` + 고정된 `YEAR`)으로 정확히 그 학생 한 명만
  `update`한다** — 타이핑 중(`input`)마다 저장하면 너무 잦은 요청이 나가므로, 이
  저장소의 다른 "자동 저장" 기능들과 마찬가지로 blur/Enter 커밋 시점에만 서버에
  보낸다. 성공하면 입력칸에 `save-ok`(파란 배경이 1초간 옅게 깜빡임), 실패하면
  `save-err`(붉은 배경) + `alert`로 에러 메시지를 보여준다. 이름을 빈 값으로 저장하려
  하면 서버 호출 없이 그 자리에서 거부한다(`alert('이름은 비워둘 수 없어요.')`) —
  `name`이 `not null` 컬럼이라 빈 값으로 보내면 어차피 실패할 걸 미리 막은 것.
  저장이 성공하면 `rosterByGrade[grade]`의 해당 학생 객체도 같이 갱신해서(캐시
  동기화), "명렬표 다운로드"/엑셀 재업로드 양식이 새로고침 없이도 방금 고친 값을
  그대로 반영한다.
- **"자동으로 취소선"은 저장을 기다리지 않는다 — 비고 입력칸의 `input` 이벤트마다
  `isDepartedNote(value)`(기존 `/전출|자퇴/` 정규식 헬퍼, 그대로 재사용)를 다시
  판정해서 그 행의 `tr.departed` 클래스를 즉시 토글한다.** "자동으로 취소선이 생기게"
  라는 요청을 "저장 완료 후 재렌더링돼야 보인다"가 아니라 "타이핑하는 순간 바로
  보인다"로 해석한 것 — 서버 응답을 기다리는 저장과 완전히 분리된, 순수 클라이언트
  쪽 반응이다. 이름 칸도 같은 방식으로 `tr.dataset.name`을 즉시 갱신해서(검색 필터가
  읽는 값), 이름을 고치는 도중에도 검색이 최신 값을 기준으로 동작한다. 기존 CSS
  `tr.departed td.no, tr.departed td.name{ text-decoration:line-through; }`는 `<td>`
  자체에 거는 규칙이라, 이름 칸이 `<input>`으로 바뀐 관리자 모드에서는 그 규칙이
  입력칸 안의 텍스트에는 적용되지 않는다 — `tr.departed td.name input.roster-edit-name{
  text-decoration:line-through; }`를 별도로 추가해 입력칸 자체에도 취소선이 그려지게
  했다(`<input>` 엘리먼트도 자신의 값 텍스트에 `text-decoration`이 정상적으로 렌더링됨
  — Playwright로 직접 computed style을 찍어 확인).
- Playwright(`test_school_status_roster_inline_edit.js`, 스크래치패드 전용)로 (1)
  비관리자는 인라인 입력칸이 전혀 없이 기존처럼 줄글로만 보이는지, (2) 관리자 계정이어도
  "관리자 모드" 버튼을 누르기 전엔 역시 입력칸이 없는지, (3) 버튼을 누르면 그 학년의
  모든 학생 행에 입력칸이 생기는지, (4) 이름을 고치고 블러하면 `year/grade/class_no/no`
  네 조건이 정확히 실린 PATCH가 나가고 `save-ok` 클래스가 붙는지, (5) 비고에 "전출"을
  타이핑하는 즉시(저장 전) 그 행에 취소선이 반응하고, 입력칸 자신에도 실제
  `text-decoration-line: line-through`가 그려지는지, (6) 비고를 다시 지우면 취소선도
  즉시 풀리는지, (7) "하키" 같은 단순 태그(전출/자퇴 아님)는 관리자 모드에서도 취소선이
  안 붙는지(회귀 없음), (8) 이름을 빈 값으로 저장 시도하면 경고만 뜨고 PATCH는 아예
  안 나가는지, (9) "관리자 모드"를 다시 꺼면 입력칸이 사라지고 줄글로 돌아가되 방금
  저장한 값은 그대로 반영돼 있는지 — 모두 확인했고, 기존 `test_school_status.js`/
  `test_school_status_sections_row.js`/`test_school_status_roster_row.js`/
  `test_school_status_nav_and_download.js`도 다시 돌려 회귀가 없음을 확인했다.

## `school-status.html` — 반 편성 카드의 "인원"을 명렬표 기준 실시간 인원(전출·자퇴 자동 제외)으로 전환

사용자 요청: "학교 현황의 반 인원은 명렬표의 반별 학생수를 불러오되 전출과 자퇴는
자동으로 빼야 해." 기존엔 `class_sections.student_count`(관리자가 엑셀 업로드/직접
수정으로 손으로 넣어둔 값)를 그대로 보여줬는데 — 학년이 바뀌거나 전출·자퇴가 생겨도
그 수동 값을 누가 다시 고쳐주지 않으면 금방 실제 인원과 어긋났다. 이 페이지엔 이미
학년별 명렬표(`students` 테이블, `rosterByGrade`)가 있고 전출/자퇴 판정
(`isDepartedNote`)도 이미 존재하므로, 반 인원을 그 명렬표에서 직접 세는 쪽으로
바꿨다 — 더 이상 손으로 맞춰줄 필요가 없는, 항상 최신인 값이 된다.

- **`liveClassCount(grade, classNo)`**(새 헬퍼, `isDepartedNote` 바로 아래) —
  `rosterByGrade[grade]`를 그 반 번호로 필터링하고 `isDepartedNote(note)`인 학생을
  빼고 센다. `rosterByGrade[grade]`가 아직 로드되지 않았으면(`undefined`) `null`을
  돌려줘서, 호출하는 쪽이 옛 수동값(`student_count`)으로 안전하게 폴백할 수 있게 했다.
- **`renderOverview()`의 반 편성 카드 템플릿**이 각 반을 그릴 때 `liveClassCount()`를
  먼저 시도하고, `null`일 때만(명렬표를 못 불러온 예외 상황) `r.student_count`로
  폴백한다 — 평소에는 항상 명렬표 기준 실시간 값이 보인다.
- **`loadAll()`의 호출 순서를 바꿨다** — 기존엔 `renderOverview()`를 먼저 호출하고
  그 다음에 학년별 명렬표(`loadGradeRoster`)를 불러왔는데, 그러면 `renderOverview()`
  시점엔 `rosterByGrade`가 아직 비어있어서 매번 "폴백(수동값)" 경로만 타게 된다.
  세 학년의 명렬표를 전부 불러온 **뒤에** `renderOverview()`를 호출하도록 순서를
  바꿔서, 정상적인 경우엔 항상 명렬표 기준 값이 보이게 했다.
- `class_sections.student_count` 컬럼 자체, 그리고 반 편성 엑셀 양식(다운로드/업로드)
  의 "인원" 열은 전혀 건드리지 않았다 — 이번 변경은 **화면에 보여주는 값의 출처**만
  바꾼 것이고, 관리자가 그 컬럼에 참고용으로 뭔가 적어두는 것 자체를 막을 이유는
  없었다(평소엔 그 값이 그냥 화면에 안 쓰일 뿐).
- `test_school_status_live_section_count.js`(새 테스트)로 `class_sections`에 일부러
  틀린(오래된) 수동 인원값(99명/50명)을 넣어두고, 명렬표에는 1반 4명 중 전출·자퇴
  2명이 섞인 상태로 (1) 1반 인원이 수동값(99명)이 아니라 실제 재학생 수(2명)로
  표시되는지, (2) 2반 인원도 수동값(50명)이 아니라 실제 재학생 수(1명)로 표시되는지 —
  확인했다. 기존 `test_school_status.js`/`test_school_status_nav_and_download.js`/
  `test_school_status_roster_inline_edit.js`/`test_school_status_roster_row.js`/
  `test_school_status_sections_row.js`도 다시 돌려(특히 `loadAll()`의 호출 순서
  변경이 다른 기능을 깨뜨리지 않는지) 회귀가 없음을 확인했다.

## `school-status.html` 명렬표 — 화면 좌우로 꽉 차게 + 스크롤해도 "몇 반인지" 고정 + 전입생 데이터 오류 3건 수정

사용자가 네 가지를 연달아 요청했다: (1) "명렬표 아래로 스크롤 했을 때 위에 있는
몇반인지는 고정돼서 나와야 할 것 같은데", (2) "명렬표는 화면 좌우 넓이 화면에 꽉 차게
해줘. 부족하면 어차피 스크롤하니까... 좌우 여백이 거의 남지 않게", (3) "2학년 6반
26번은 나건후 이고, 2학년 7반 26번이 이지후인데 잘못 입력이 된 거 같애", (4) "4반
전입생으로 들어가 있는 김승언도 사실 5반 전입생이야."

**명렬표 카드를 `.wrap`(1100px) 폭 제약에서 벗어나 화면 좌우로 거의 꽉 차게** — 학년별
명렬표 탭의 바깥 카드(`<div class="card">학년 전체 명렬표...</div>`)에만
`roster-wide-card` 클래스를 추가하고, 표준 "가운데 정렬된 컨테이너를 벗어나 전체 폭을
쓰는" CSS 트릭(`max-width:none; width:calc(100vw - 32px); margin-left/right:calc(50% -
50vw + 16px)`)을 적용했다 — 다른 탭(학교 현황 개요/반 편성/학사일정)은 그대로
`.wrap`의 1100px 폭을 유지한다(사용자가 "명렬표는"이라고 특정했으므로 그 카드만 좁힘).

**명렬표 스크롤 시 "몇 반인지"(h3) 고정 — 처음 시도(단순 `position:sticky`)가 실제로는
전혀 동작하지 않는 걸 Playwright로 직접 재현·진단해서 알아냈다.** `.class-card h3`에
그냥 `position:sticky; top:0;`만 주고 테스트했더니, 800px를 스크롤해도 h3가 스크롤량과
똑같이(-800px) 같이 밀려나 전혀 고정되지 않았다 — 원인은 데스크탑 전용 CSS
(`.roster-grid{ display:flex; flex-wrap:nowrap; overflow-x:auto; }`, "학년의 모든 반이
한 줄에 나오게" 하려고 이미 있던 규칙)에 있었다: **CSS 스펙상 `overflow-x`를
`visible`이 아닌 값으로 주면 `overflow-y`도 암묵적으로 `auto`로 강제 승격된다** — 즉
세로로는 전혀 쓸 생각이 없었는데도 `.roster-grid`가 "가장 가까운 스크롤 컨테이너"로
등록돼버렸다. 문제는 이 div의 세로 높이가 `auto`(내용에 맞춰 늘어남)라 실제로는 절대
내부 스크롤이 일어나지 않는다는 것 — `position:sticky`는 "가장 가까운 스크롤
컨테이너"를 기준으로 고정되는데, 그 기준 자체가 페이지 스크롤과 무관하게 멈춰있는
(움직이지 않는) 엉뚱한 틀이 돼버려서 고정 효과가 완전히 사라졌다. `addStyleTag`로
`overflow-x:visible !important`를 임시로 덮어써서 "그 CSS 하나만 없으면 0px에 정확히
고정됨"을 직접 확인해 원인을 특정했다.

고쳐서, **room-booking.html의 `.grid-scroll`(세로 높이 제한 + `overflow:auto` + sticky
th)과 같은 해법**을 그대로 가져왔다 — `.roster-grid`(데스크탑 전용 규칙) 자체에
`max-height:640px`를 주고 `overflow-x:auto` 대신 `overflow:auto`(가로·세로 모두)로
바꿨다. 이러면 `.roster-grid`가 "진짜로" 내부 스크롤되는 영역이 돼서(반이 많으면
가로로, 한 반의 학생 수가 많으면 세로로), 그 안에서 `.class-card h3`의
`position:sticky; top:0`이 정상 동작한다 — 학생 목록을 마우스 휠로 내려도(그 영역
안에서) "몇 반인지" 제목이 위에 그대로 고정된 채 아래 학생들만 스크롤된다. h3에는
`background:var(--paper-card); z-index:2; padding:2px 0;`도 함께 줘서 아래 학생 행이
제목 밑으로 비쳐 보이지 않게 했다. 모바일(`max-width:820px`, 플레인 `display:grid`로
반마다 줄바꿈 — 원래부터 overflow가 없었음)은 이 문제 자체가 없어서 손대지 않았다.
`test_school_status_roster_sticky_width.js`(스크래치패드 전용)로 (1) 명렬표 카드의
좌우 여백이 20px 이하이고 1100px보다 훨씬 넓게 렌더링되는지, (2) `.roster-grid`의
내부 scrollTop을 400px 옮기면 35번째 학생 행이 실제로 400px 가까이 위로 이동하는지
(= 내부 스크롤이 진짜로 동작), (3) 그런데도 h3의 화면상 절대 위치는 거의 그대로인지
(비고정이었다면 역시 400px 가까이 움직였어야 함 — 실측 11px 이내로 고정 확인),
(4) 실제로 `position:sticky`가 computed style로 적용돼 있는지, (5) 배경색이 투명이
아닌지 — 모두 확인했고, 기존 `test_school_status*.js` 6개 전부 재실행해 회귀가 없음을
확인했다(특히 `test_school_status_roster_row.js`의 "반 카드 7개가 전부 같은 줄"
단언과 `test_school_status_sections_row.js`도 그대로 통과).

**전입생 데이터 오입력 3건(2학년 4~7반 26번) — 연쇄적으로 한 반씩 밀려 들어가 있었다.**
사용자가 두 번에 걸쳐 보고한 걸 Supabase에서 직접 조회해 교차 확인했다: 실제 저장된
값은 `4반26번=김승언(8.18.편입)`, `5반26번=나건후(3.3.편입 하키)`,
`6반26번=이지후(8.6.전입)`, `7반26번=없음` — 사용자가 말한 올바른 값(`6반26번=나건후`,
`7반26번=이지후`, `김승언은 5반 전입생`)과 대조하니 정확히 "각 전입생이 자기 반보다 한
반 낮게(4→5→6→7 방향으로 한 칸씩 밀려) 잘못 입력돼 있었다"는 패턴이 드러났다(1~3반의
26번은 전출/전입 표시 없는 정상 재학생이거나 다른 전입생이라 이 연쇄와 무관함을 확인).
`UPDATE students SET class_no = class_no + 1 WHERE ...`를 가장 높은 반(6→7)부터
역순으로 세 번 실행해(기본키가 `year+grade+class_no+no`라 순서를 거꾸로 하지 않으면
자리가 겹쳐 충돌한다) 교정했다 — `이지후`는 6반→7반, `나건후`는 5반→6반, `김승언`은
4반→5반으로 각각 이동. 이름까지 조건에 포함해(`AND name = '...'`) 혹시 모를 다른 행이
잘못 바뀌지 않도록 했다. 실행 후 재조회로 세 명 모두 올바른 반(7/6/5반)의 26번에
정확히 자리잡았고 원래 비고(전입/편입 날짜·사유)도 그대로 보존됐음을 확인했다 — 이
수정은 순수 데이터 교정이라 어떤 파일도 바뀌지 않는다(git 커밋 대상 아님).

**3학년 반 편성(class_sections) 비고가 비어 보이는 것은 버그가 아니라, 이 저장소에
이미 적혀 있던 처음부터의 의도적 공백이다** — 사용자가 "학교 현황의 3학년 반 현황
비고가 안 불러와 진 거 같아"라고 물어서 Supabase를 직접 조회해 확인했다: 1~2학년은
`class_sections.note`에 실제 값("빙1, 지1" 등)이 들어있는데 3학년 8개 반은 전부
`note: null`이다 — 렌더링/쿼리 쪽 버그가 아니라, 이 문서의 "학교 현황은 Google
시트에서 가져온 일회성 시드 데이터" 섹션에 이미 적힌 그대로("3학년 반 편성의
note(비고) 컬럼만 의도적으로 비워뒀다 — 원본 CSV에서 3학년만 콤마로 묶인 복합 비고
문자열이 모호해서 안전하게 옮길 수 없었고... 틀린 추측보다는 빈 값이 낫다고 판단했다")
처음부터 데이터 자체가 비어 있는 상태다. 고치려면 실제 3학년 비고 값을 알려주거나,
관리자 모드의 "반 편성 다시 올리기" 엑셀 양식(현재 값이 미리 채워져 내려오므로 비고
칸만 채워 다시 올리면 됨)으로 직접 채우면 된다 — 틀릴 수 있는 값을 추측해서 채우지
않는다는 원칙은 이번에도 그대로 지켰다.

## `school-status.html` 명렬표 — sticky 헤더/내부 스크롤 설계를 걷어내고 각 행에 "반/번호" 학번을 직접 표시

바로 위 섹션에서 구현한 "`.class-card h3`를 `position:sticky`로 고정 + `.roster-grid`에
`max-height:640px`+`overflow:auto`로 내부 세로 스크롤을 만드는" 설계를 사용자가 직접
더 단순한 대안으로 뒤집었다: "명렬표에 학번을 1반 11번(1/11) 이렇게 표시할까? 그럼
반 이름이 첫 행이 고정되지 않아도 될 거 같은데. 학생을 세로로 끝까지 보이게 해버리고.
내부에 스크롤이 되게 할 필요도 없을 거 같애." — h3가 스크롤 중에도 "몇 반인지"를
계속 보여줘야 했던 이유 자체가, 각 학생 행이 자기 반·번호를 스스로 말하게 하면
사라진다는 통찰이었다.

- **`table.roster-table`의 "번호" 열을 "학번"으로 바꾸고, 내용을 `${cno}/${s.no}`**
  (예: `1/11`)로 표시한다 — 관리자 편집 모드/일반 보기 두 템플릿 분기 모두 동일하게
  적용했다. 번호(`no`)는 여전히 `students`의 기본키 구성요소라 인라인 수정 대상이
  아니므로(바로 위 "인라인 수정" 섹션 참고), 이 칸은 어느 모드에서나 plain text만
  보여준다 — `td.no`에는 입력칸을 넣지 않는다.
- **`.class-card h3`에서 `position:sticky`/`top:0`/`background`/`z-index`/`padding`을
  전부 제거**하고 평범한 제목으로 되돌렸다 — 각 행이 이미 "1/11"로 자기 소속을
  보여주므로, h3가 스크롤 중에도 화면에 붙어있어야 할 이유가 없어졌다.
- **`.roster-grid`(데스크탑 전용 `@media (min-width:821px)` 규칙)에서
  `max-height:640px`와 세로 `overflow:auto`를 제거**하고 `overflow-x:auto`만 남겼다
  (반이 많아 가로로 다 안 들어갈 때의 가로 스크롤은 그대로 유지) — `.roster-grid`가
  더 이상 "가장 가까운 스크롤 컨테이너"로 등록될 이유가 없으므로, 바로 위 섹션에서
  겪은 "overflow-x:auto만 줘도 overflow-y가 암묵적으로 auto가 되면서 sticky 기준틀이
  어긋나는" 버그 자체가 애초에 성립하지 않는다(sticky를 아예 안 쓰므로). 카드들은
  이제 내용 높이만큼 자연스럽게 늘어나고, 페이지 자체가 세로로 스크롤된다 — 학생이
  많은 반이어도 끝까지 전부 한 화면 흐름 안에 보인다.
- `test_school_status_roster_inline_id.js`(스크래치패드 전용)로 (1) 테이블 헤더가
  "번호"가 아니라 "학번"으로 바뀌었는지, (2) 1반 1번/11번 행이 각각 "1/1"/"1/11"
  형식으로 표시되는지, (3) h3의 `position`이 더 이상 `sticky`가 아닌지(`static`),
  (4) `.roster-grid`에 `max-height` 제한이 없는지(`none`), (5) 반 2개×학생 40명(총
  80명, 뷰포트 900px보다 훨씬 긴 콘텐츠)을 렌더링했을 때 `.roster-grid` 자신의 실제
  높이와 문서 전체 스크롤 높이가 뷰포트보다 커서 내부 스크롤이 아니라 페이지 자체가
  길어지는지, (6) 페이지 맨 아래까지 스크롤하면 1반 40번째 학생 행이 실제로 화면에
  보이는지 — 모두 확인했다. 기존 `test_school_status.js`/
  `test_school_status_sections_row.js`/`test_school_status_roster_row.js`/
  `test_school_status_nav_and_download.js`/`test_school_status_roster_inline_edit.js`/
  `test_school_status_live_section_count.js`도 전부 다시 돌려 회귀가 없음을 확인했다
  (`test_school_status_roster_sticky_width.js`는 이 설계 변경으로 더 이상 유효한
  기대값이 아니다 — sticky/내부 스크롤이라는 기능 자체가 사라졌으므로, 그 테스트가
  검증하던 "스크롤해도 h3가 고정된다"는 동작은 이제 애초에 존재하지 않는다).

## `school-status.html` 명렬표 — sticky 헤더/내부 스크롤 설계를 걷어내고 각 행에 "반/번호" 학번을 직접 표시

바로 위 섹션에서 구현한 "`.class-card h3`를 `position:sticky`로 고정 + `.roster-grid`에
`max-height:640px`+`overflow:auto`로 내부 세로 스크롤을 만드는" 설계를 사용자가 직접
더 단순한 대안으로 뒤집었다: "명렬표에 학번을 1반 11번(1/11) 이렇게 표시할까? 그럼
반 이름이 첫 행이 고정되지 않아도 될 거 같은데. 학생을 세로로 끝까지 보이게 해버리고.
내부에 스크롤이 되게 할 필요도 없을 거 같애." — h3가 스크롤 중에도 "몇 반인지"를
계속 보여줘야 했던 이유 자체가, 각 학생 행이 자기 반·번호를 스스로 말하게 하면
사라진다는 통찰이었다.

- **`table.roster-table`의 "번호" 열을 "학번"으로 바꾸고, 내용을 `${cno}/${s.no}`**
  (예: `1/11`)로 표시한다 — 관리자 편집 모드/일반 보기 두 템플릿 분기 모두 동일하게
  적용했다. 번호(`no`)는 여전히 `students`의 기본키 구성요소라 인라인 수정 대상이
  아니므로(바로 위 "인라인 수정" 섹션 참고), 이 칸은 어느 모드에서나 plain text만
  보여준다 — `td.no`에는 입력칸을 넣지 않는다.
- **`.class-card h3`에서 `position:sticky`/`top:0`/`background`/`z-index`/`padding`을
  전부 제거**하고 평범한 제목으로 되돌렸다 — 각 행이 이미 "1/11"로 자기 소속을
  보여주므로, h3가 스크롤 중에도 화면에 붙어있어야 할 이유가 없어졌다.
- **`.roster-grid`(데스크탑 전용 `@media (min-width:821px)` 규칙)에서
  `max-height:640px`와 세로 `overflow:auto`를 제거**하고 `overflow-x:auto`만 남겼다
  (반이 많아 가로로 다 안 들어갈 때의 가로 스크롤은 그대로 유지) — `.roster-grid`가
  더 이상 "가장 가까운 스크롤 컨테이너"로 등록될 이유가 없으므로, 바로 위 섹션에서
  겪은 "overflow-x:auto만 줘도 overflow-y가 암묵적으로 auto가 되면서 sticky 기준틀이
  어긋나는" 버그 자체가 애초에 성립하지 않는다(sticky를 아예 안 쓰므로). 카드들은
  이제 내용 높이만큼 자연스럽게 늘어나고, 페이지 자체가 세로로 스크롤된다 — 학생이
  많은 반이어도 끝까지 전부 한 화면 흐름 안에 보인다.
- `test_school_status_roster_inline_id.js`(스크래치패드 전용)로 (1) 테이블 헤더가
  "번호"가 아니라 "학번"으로 바뀌었는지, (2) 1반 1번/11번 행이 각각 "1/1"/"1/11"
  형식으로 표시되는지, (3) h3의 `position`이 더 이상 `sticky`가 아닌지(`static`),
  (4) `.roster-grid`에 `max-height` 제한이 없는지(`none`), (5) 반 2개×학생 40명(총
  80명, 뷰포트 900px보다 훨씬 긴 콘텐츠)을 렌더링했을 때 `.roster-grid` 자신의 실제
  높이와 문서 전체 스크롤 높이가 뷰포트보다 커서 내부 스크롤이 아니라 페이지 자체가
  길어지는지, (6) 페이지 맨 아래까지 스크롤하면 1반 40번째 학생 행이 실제로 화면에
  보이는지 — 모두 확인했다. 기존 `test_school_status.js`/
  `test_school_status_sections_row.js`/`test_school_status_roster_row.js`/
  `test_school_status_nav_and_download.js`/`test_school_status_roster_inline_edit.js`/
  `test_school_status_live_section_count.js`도 전부 다시 돌려 회귀가 없음을 확인했다
  (`test_school_status_roster_sticky_width.js`는 이 설계 변경으로 더 이상 유효한
  기대값이 아니다 — sticky/내부 스크롤이라는 기능 자체가 사라졌으므로, 그 테스트가
  검증하던 "스크롤해도 h3가 고정된다"는 동작은 이제 애초에 존재하지 않는다).

## `school-status.html` — 공용 편집 비밀번호로도 편집 가능 + `admin-tools.html` 비밀번호 관리 카드 접기

"🔑 관리자 모드" 버튼이 이제 승인된 교사 모두에게 보인다. 관리자는 바로 편집 모드로, 비관리자는 `#adminModePrompt`에
공용 편집 비밀번호(`verify_shared_edit_password`)를 넣으면 편집 모드가 열린다(`canEdit`; 비밀번호는 메모리의
`sharedEditPassword`에만, 새로고침하면 다시 입력). 테이블 RLS 쓰기는 여전히 관리자 전용이라, 모든 쓰기를 비밀번호를
먼저 검증하는 `SECURITY DEFINER` RPC로 옮겼다(관리자는 `p_password: null`): `school_overview_save(p_password, p_year, p_row)`
(기존 행에 p_row를 덮어 upsert — 기본정보 저장·시트 주소 저장 둘 다), `school_student_update`(명렬표 인라인 수정, 이름+비고
둘 다 넘김), `school_students_replace`/`school_sections_replace`/`school_events_replace`(엑셀 재업로드, 범위 삭제 후 삽입).
앞의 두 개는 마이그레이션으로 반영됐지만, `delete`가 들어간 replace 세 개는 이 환경의 MCP에서 계속 타임아웃돼 사용자가
Supabase SQL Editor에 직접 붙여넣어야 한다 — 반영 전엔 엑셀 재업로드만 "function not found"로 실패한다.

`admin-tools.html`의 "관리자 모드 비밀번호 관리" 카드는 기본으로 접혀 있고 제목 줄(`#adminPwToggle`)을 누르면
`.open` 클래스로 펼쳐진다.

## 명렬표 관리자 모드 — 바로 저장 대신 "저장하고 나가기/저장하지 않고 나가기", 전편입 추가, 인원 자동 계산

엔터·블러로 바로 저장하던 `saveRosterField()`를 없애고, 변경은 `pendingEdits`(`grade|class|no` 키)에 모아둔다.
관리자 모드에서는 "🔑 관리자 모드" 버튼 대신 상단 고정 `#editBar`("💾 저장하고 나가기"/"저장하지 않고 나가기", 미저장 건수
표시)가 뜬다. 저장은 새 `school_students_upsert(p_password, p_year, p_rows)` RPC(공용 편집 비밀번호 검증, PK 충돌 시 update,
DELETE 없음) 한 번. 변경이 남은 채 링크를 누르면 `#unsavedOverlay`("변경내용이 저장되지 않았습니다. 저장하시겠습니까?" —
저장/저장 안 함/취소), 새로고침·창 닫기는 `beforeunload` 기본 확인창. 반마다 "+ 전편입 추가"(다음 번호, 비고 기본 "전입",
저장 전엔 ✕로 취소). 반 편성 카드 인원·명렬표 반 제목 인원·학교 기본정보의 학년별 학생수는 모두 `mergedRoster()`(저장 전
변경 포함)에서 전출/자퇴를 뺀 수로 즉시 다시 계산된다(`renderSections()` — `renderOverview()`는 편집 입력칸을 덮어쓰므로
편집 중엔 부르지 않는다).

## 반 편성 학년별 접기(모바일), 학년별 학생수 줄바꿈

`renderSections()`가 학년마다 `<details class="sec-grade">`(요약: "N개 반 · M명")로 감싼다 — 모바일(≤880px)은 처음에
접힘, 데스크탑은 펼침. 열림 상태는 `sectionsOpen`에 기억해 편집 중 다시 그려도 유지. 학교 기본정보의 학년별 학생수는
학년마다 `<br>`로 줄바꿈, 표 머리글은 `word-break:keep-all`(글자 하나씩 세로로 끊기지 않게).

## 학교 기본정보 세로 표시·접기, 기본정보·반 편성(담임/부담임/비고)도 관리자 모드에서 바로 수정

학교 기본정보 카드를 `<details id="ovDetails">`로 감쌌다(모바일은 처음에 접힘). `renderOverview()`가 표 두 개를 그린다 —
`.info-wide`(데스크탑, 2쌍씩 가로)와 `.info-narrow`(모바일 ≤880px, 항목마다 한 줄). 학년별 학생수 칸은 둘 다
`.grade-count-cell`. 관리자 모드에서는 기본정보 값 칸과 반 편성 카드의 담임·부담임·비고가 입력칸이 되고(인원은
자동 계산이라 입력칸 아님), 변경은 `pendingOverview`/`pendingSections`에 모였다가 명렬표 변경과 함께
"💾 저장하고 나가기"로 저장된다 — 기본정보는 기존 `school_overview_save`(부분 필드 병합), 반 편성은 새
`school_sections_update(p_password, p_year, p_rows)` RPC(update만, DELETE 없음). 예전 관리자 카드의 기본정보 입력칸·
저장 버튼(`onSaveOverview`)은 없앴고, 그 카드는 Google 시트 연동만 남았다.

## 학사일정도 관리자 모드에서 바로 편집(행 추가·삭제·수정)

관리자 모드에서 학사일정 표가 시작일/종료일/대상학년/내용 입력칸 + ✕(행 삭제)로 바뀌고, 표 아래 "+ 행 추가"(오늘 날짜로
한 줄). 변경은 `pendingEvents`(올해 일정 전체 사본)에 모였다가 "💾 저장하고 나가기"에서 기존 `school_events_replace`
(올해 일정 전체 삭제 후 삽입)로 통째로 저장 — 시작일·내용이 빈 줄이나 종료일<시작일이면 저장을 막는다. 저장 후
`academic_events`를 다시 읽어 표를 갱신. 미저장 건수에는 학사일정 변경이 1건으로 잡힌다.
