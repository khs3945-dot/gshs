# survey — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

## `survey.html` (설문조사) — 비회원도 링크만으로 응답 가능한 설문·투표

사용자 요청: "비회원에게도 투표나 설문을 받을 수 있는 기능을 추가할 수는 없을까... 링크를
공유하면 거기서 처리할 수 있게." 이 사이트의 기존 설문/투표(`task_assignments`에 딸린
poll 응답 등)는 전부 `profiles`에 등록된 로그인 계정을 전제로 설계돼 있어, 비회원까지
받으려면 그 모델에 억지로 끼워 넣기보다 **완전히 독립된 새 서브시스템**을 만드는 쪽을
택했다 — `collect.html`의 "로그인 없이 이름만으로 제출"과 같은 신뢰 모델을 설문에 그대로
적용한 것.

- **`public_surveys`**(id, title, description, `questions` jsonb 배열, creator_id,
  creator_name, `require_respondent_name`, `closes_at`(nullable), `is_closed`,
  created_at)와 **`public_survey_responses`**(id, survey_id → `public_surveys.id`
  `on delete cascade`, `respondent_name`(nullable), `answers` jsonb, submitted_at)
  두 테이블. 문항 스키마는 `{key, label, type:'single'|'multi'|'text', options?:
  string[], required?: boolean}`, 응답 스키마는 `{ [question.key]: value }`(단일
  선택은 문자열, 복수 선택은 문자열 배열, 주관식은 문자열 — 선택 안 한/빈 문항은 키
  자체를 안 넣음).
- **RLS는 이 저장소에서 가장 개방적인 "완전 공개" 모델** — `public_surveys_select_open`
  (`anon`+`authenticated`, `using(true)`)이라 비회원도 설문 내용을 바로 읽을 수 있고,
  `public_survey_responses_insert_open`(`anon`+`authenticated`, `with check(true)`,
  **어떤 소유권 검사도 없음**)이라 누구나 어떤 설문에든 응답을 써넣을 수 있다 —
  `room_bookings`의 익명 예약 insert와 같은 신뢰 수준. 단 **응답을 읽는 건
  (`public_survey_responses_select_owner`) 그 설문을 만든 교사(`creator_id =
  auth.uid()`) 또는 관리자만** 할 수 있다 — 설문 자체는 공개지만 누가 뭐라고 답했는지는
  비공개라는, 실제 설문 서비스의 통상적인 기대와 일치하는 비대칭 공개 수준이다.
  `public_surveys`의 insert/update/delete는 `creator_id = auth.uid()`(또는 관리자)만
  가능해서, 설문을 만들려면 로그인이 필요하다.
- **페이지 하나가 `?id=` 유무로 완전히 다른 두 화면을 보여준다**(`collect.html?id=`
  패턴과 동일한 구조) — `?id=` 없음: 로그인+승인 게이트 뒤의 "관리 화면"(새 설문
  만들기 + 내가 만든 설문 목록), `?id=<uuid>`: **로그인 전혀 필요 없는** 공개 응답
  화면. 두 화면 모두 하나의 `<script>` 안에서 `initManageView()`/`initPublicView(id)`
  로 분기해서 처리한다.
  - **관리 화면**: "+ 새 설문 만들기"를 펼치면 제목/설명(선택)/마감일(선택, 비우면
    직접 닫을 때까지 계속 받음)/"응답자 이름 입력받기" 체크박스 + 문항 편집기(문항마다
    라벨/유형(단일 선택·복수 선택·주관식)/선택지(유형이 주관식이 아닐 때만, 한 줄에
    하나씩)/필수 응답 체크박스, "+ 문항 추가"로 늘림) — 타이핑마다 다시 그리지 않고
    구조가 바뀔 때(유형 변경·추가·삭제)만 `renderQuestionsEditor()`를 다시 부르는,
    이 저장소의 기존 델리게이트 편집기 관행(`classroom_layouts`/`chatbot-builder.html`
    활동 탭 설계기와 같은 원칙)을 그대로 따랐다. 목록의 각 설문 카드는 진행중/마감
    뱃지, 문항·응답 개수, "🔗 링크 복사"(`collect.html`의 `.btnCopyItemLink`와 같은
    "복사됨!" 1.5초 라벨 교체 패턴), "📊 결과 보기"(인라인 아코디언, 첫 클릭 때만
    `public_survey_responses`를 가져와 캐시 — 이미 가져온 설문은 재조회 없이 토글만),
    "엑셀로 다운로드"(`xlsx@0.18.5`, 제출시각/이름(수집 시)/문항별 답변 한 줄씩),
    "닫기"/"다시 열기"(`is_closed` 토글), "삭제"(`confirm()` 후 설문 row만 지우면
    `on delete cascade`로 응답도 함께 삭제됨)를 제공한다. "결과 보기"는 단일/복수
    선택 문항은 선택지별 응답 수 + 퍼센트 막대(순수 `<div>` width%, 차트 라이브러리
    없음), 주관식 문항은 답변을 그대로 나열, 이름을 수집한 설문이면 맨 아래에
    응답자 이름 목록을 보여준다.
  - **공개 응답 화면**: `public_surveys`를 `?id=`로 조회해(로그인 없이도 열린 select라
    바로 됨) 없으면 "설문을 찾을 수 없어요", `is_closed`이거나 `closes_at`이 지났으면
    "마감됐어요" 안내만 보여주고 폼 자체를 렌더링하지 않는다. 열려 있으면 이름(수집
    설정 시)+문항별 입력(단일=라디오, 복수=체크박스, 주관식=textarea, 필수는 라벨
    옆에 빨간 `*`)을 렌더링 — 제출 시 필수 항목 중 비어있는 게 있으면 그 문항 이름을
    콕 집어 에러 메시지를 보여주고 막는다. 제출 성공 시 `public_survey_responses`에
    insert하고, **`localStorage['ks_survey_responded_<id>']`로 소프트 가드**를
    남긴다(하드 유니크 제약 없음 — 이 저장소의 일반적인 "소프트 가드, 강제 보안
    아님" 원칙 그대로, `room-booking.html`의 여러 "이 브라우저에서만 기억하는 선호"
    들과 같은 수준). 같은 브라우저로 다시 열면 그 가드를 보고 "이미 응답하셨어요"
    화면으로 바로 넘어가고, "다시 응답하기" 버튼을 누르면 그 로컬 플래그만 지우고
    폼을 다시 보여준다(서버 쪽에는 중복 제출을 막는 어떤 제약도 없음 — 이 소프트
    가드가 유일한 저지선이라는 걸 분명히 해둔다).
- **다른 모든 ks-app 사이드바 페이지와 똑같은 머리말/사이드바를 그대로 복붙해 썼다**
  (`school-status.html`/`room-booking.html` 등이 이미 쓰고 있는, 2025년 말 "새
  사이드바/상단바 디자인 롤아웃"(커밋 `1a1e431` 등) 이후의 표준 레이아웃 —
  `.ks-app`/`.ks-sidebar`/`.ks-topbar`/`.ks-content-inner` + 맨 아래의 공용 wiring
  스크립트(검색창 클릭 시 `nav.js`의 실제 🔍 검색 모달을 대신 열어주기, 모바일
  햄버거 토글, 로그인 배지, 공지사항 티커) — **36개 페이지에 이미 똑같이 박혀있는
  마크업이라, 한 곳을 고치면 전부 따로 고쳐야 하는 복붙 관행이 여기도 그대로
  적용된다.** 공개 응답 화면도 예외 없이 이 사이드바를 그대로 보여준다 — `collect.
  html?id=`가 비회원 제출자에게도 똑같은 사이드바를 보여주는 것과 같은 선택이다
  (교사 전용 내부 도구 사이트라, 링크를 받는 사람도 대개 교사일 가능성이 높고,
  로그인 안 한 방문자는 그 사이드바의 로그인 배지가 그냥 "로그인" 링크로 보일 뿐
  내부 정보가 새는 건 아니다).
- **`DEFAULT_NAV_ITEMS`(햄버거 메뉴/`index.html` 타일)에는 넣지 않았다** — 새
  사이드바 디자인은 36개 페이지에 하드코딩으로 복붙돼 있어서, 거기 새 항목 하나를
  넣으려면 이론상 36개 파일의 사이드바를 전부 손으로 맞춰야 한다(지금 당장은 그렇게
  하지 않음). 대신 `grade-estimate.html`/`mock-interview.html`/`korean-inquiry.html`
  과 같은 최근 관행 — "교무 업무 도구"(`admin-tools.html`) 허브의 평범한(관리자
  전용 아님) `tool-card` 하나 + `nav.js`의 `EXTRA_SEARCH_ITEMS`(`adminOnly` 없음,
  `loginRequired: true`) — 로 노출해서, 승인된 교사라면 누구나 🔍 전체 검색이나
  교무 업무 도구 타일 그리드로 찾을 수 있게 했다. 사이드바에는 그 어떤 페이지에도
  "설문조사" 항목이 없는 대신, `korean-inquiry.html`/`grade-estimate.html`과 같은
  방식으로 `survey.html` 자신의 사이드바에서 "교무 업무 도구"(`admin-tools.html`)
  항목에 `active` 클래스를 줘서 가장 가까운 상위 허브를 표시해뒀다.
- Playwright로(`supabase-js`를 전부 자체 구현한 가짜 쿼리 빌더로 교체 — insert/
  update/delete가 실제로 메모리 테이블을 변형하는, `TABLES` 객체 기반의 범용
  스텁) 검증했다: 관리 화면에서 설문 생성(문항 2개, 단일선택+주관식) → 목록에
  뜸 → 닫기/열기 토글 → 결과 보기(선택지 막대 + 주관식 답변 + 응답자 이름 모두
  렌더링) → 삭제(응답도 cascade로 같이 지워짐); 비로그인은 gateView, 로그인했지만
  미승인이면 pendingView; 공개 응답 화면에서 필수 복수선택 문항을 비우고 제출하면
  에러로 막히는지, 정상 제출 시 정확한 `answers` payload로 insert되는지, 제출 후
  localStorage 가드가 걸리는지, 새로고침해도 "이미 응답" 화면이 바로 뜨는지,
  "다시 응답하기"로 가드가 풀리고 폼이 다시 뜨는지; 마감된 설문은 폼 없이 마감
  안내만 보이는지, 존재하지 않는 id는 "찾을 수 없어요"로 처리되는지 — 모두
  확인했다.

## `survey.html` — 기간을 "yyyy-mm-dd hh:mm ~ yyyy-mm-dd hh:mm"로, 만들자마자 링크+복사 버튼 표시

사용자 요청: "설문조사 기간은 yyyy-mm-dd hh:mm ~ yyyy-mm-dd hh:mm 양식으로. 설문조사에는
설문별 링크를 생성해주고 링크복사 버튼 만들어줘." 두 번째 요구(설문별 링크+복사 버튼)는
이미 목록의 각 설문 카드에 "🔗 링크 복사" 버튼으로 구현돼 있었지만, **설문을 막 만든
직후에는 그 링크가 바로 안 보이고 "아래 목록에서 복사하세요"라는 안내만 뜨는** 간접적인
흐름이었다 — `collect.html`이 제출함을 만들자마자 `.link-copy-box`로 링크를 바로
보여주는 것과 비교해 한 단계 더 거쳐야 했으므로, 그 패턴을 그대로 가져와 더 직접적으로
만들었다.

- **`public_surveys.opens_at`**(새 컬럼, `timestamptz not null default now()`) 추가 —
  기존엔 `closes_at`(마감, nullable)만 있어서 "기간"이 아니라 "마감일" 하나뿐이었다.
  이제 모든 설문이 시작 시각을 갖고, 마감은 여전히 선택(비우면 "직접 닫을 때까지
  계속 받음" — 이 동작은 그대로 유지).
- **생성 폼의 "마감일"(`<input type="date">`, 날짜만)을 "설문 기간"(`<input
  type="datetime-local">` 두 개, `~`로 연결) 한 줄로 바꿨다** — `#sOpens`(시작일시,
  폼을 열 때마다 `toDatetimeLocalValue(new Date())`로 "지금"이 기본값으로 채워짐 —
  관리자가 미래 시각으로 바꾸면 그 시각부터 열리는 "예약 발행"이 된다)와
  `#sCloses`(마감일시, 비워두면 그대로 `null`). 저장 시 `closes_at`이 있는데
  `opens_at`보다 빠르면 "마감일시는 시작일시보다 늦어야 해요"로 막는다.
- **"진행중"/"마감" 2단계였던 상태가 "예정"(아직 `opens_at` 전)/"진행중"/"마감"
  3단계로 늘었다** — 관리 목록의 뱃지(`.survey-badge.scheduled`, 스탬프색)와 공개
  응답 화면 둘 다 이 3단계를 똑같이 반영한다. 공개 응답 화면은 `opens_at`이 아직
  안 됐으면 **마감과는 별개의 안내**("이 설문은 아직 시작 전이에요. <시작 시각>부터
  응답을 받아요")를 보여주고 폼 자체를 그리지 않는다 — 마감 메시지 체크보다
  먼저 검사해서, 둘 다 해당하는 경우(이론상 없지만) "시작 전" 쪽이 우선한다.
  목록의 "닫기"/"다시 열기" 토글 버튼은 여전히 `is_closed`(관리자가 수동으로 끈
  플래그)만 기준으로 동작한다 — 시간 경과로 자동 마감된 경우와 구분해서, "닫기"를
  누른 적 없는 설문은 항상 "닫기" 라벨이 뜨도록 했다(`notYetOpen`/시간 기반
  `timeClosed`는 뱃지 표시에만 반영하고 버튼 상태에는 안 섞음 — 섞으면 "아직
  시작도 안 했는데 '다시 열기'가 뜨는" 혼란스러운 조합이 생길 수 있었다).
- **`fmtYmdHm(iso)`**(새 함수, `yyyy-mm-dd hh:mm` — 24시간제, 0 패딩)와
  **`fmtPeriod(opensIso, closesIso)`**(`"<시작> ~ <마감>"`, 마감이 없으면
  `"<시작> ~ (상시)"`)를 추가했다 — 기존 `fmtDateTime()`(점 구분, 다른 곳에
  이미 쓰이던 포맷)은 그대로 두고 건드리지 않았다. 목록의 메타 줄이
  `· 기간 ${fmtPeriod(...)}`로 이 정확한 포맷을 보여준다.
- **설문을 만들면 바로 링크+복사 버튼이 뜬다.** `collect.html`의 `.link-copy-box`
  스타일을 그대로 가져온 `#createdLinkBox`(readonly 입력칸 + "🔗 링크 복사" 버튼)가
  입력 폼 바로 아래, **폼을 접어도(= `#createForm`이 `display:none`이 돼도) 같이
  사라지지 않는 자리**에 있다 — 저장 성공 시 `insert().select('id').maybeSingle()`
  로 돌려받은 새 id로 `shareUrl(id)`를 채워 보여준다. "+ 새 설문 만들기"를 다시
  눌러 폼을 여는 순간(`resetCreateForm()`이 호출될 때) 이 박스를 다시 숨긴다 —
  다음 설문을 만드는 동안 직전 설문의 링크가 헷갈리게 남아있지 않도록. 복사
  버튼은 `collect.html`의 "복사됨!" 1.5초 라벨 교체 패턴을 그대로 썼다.
- `test_survey.js`에 새 검증을 추가했다 — (1) 시작일시 입력칸이 "지금"으로
  미리 채워지는지, (2) 시작(과거)/마감(미래) 날짜로 저장하면 `opens_at`/
  `closes_at`이 타이핑한 값 그대로 ISO로 저장되는지, (3) 저장 직후
  `#createdLinkBox`가 바로 보이고 그 안의 링크가 방금 만든 설문의 `?id=`와
  일치하는지, (4) "링크 복사" 버튼을 누르면 실제 클립보드에 같은 링크가 써지는지,
  (5) 목록 메타 줄이 정확히 `yyyy-mm-dd hh:mm ~ yyyy-mm-dd hh:mm` 포맷으로
  나오는지, (6) "+ 새 설문 만들기"를 다시 누르면 직전 링크 박스가 사라지고
  시작일시도 새로 리셋되는지, (7) 아직 시작 전(`opens_at`이 먼 미래)인 설문은
  공개 화면에서 "시작 전" 안내만 뜨고 폼이 없는지, 관리 목록에서는 "예정" 뱃지가
  뜨는지 — 모두 확인했다. 기존 테스트(생성/목록/닫기·열기/결과 보기/삭제/게이트
  3종/응답 제출·소프트 가드/마감·존재하지 않는 id)도 전부 다시 돌려 회귀가
  없음을 확인했다.

## `survey.html` — "파일 첨부" 문항, 비회원도 로그인 없이 파일을 올릴 수 있는 설문 응답

사용자 요청: "파일 제출도 그렇게 만들 수 있나? 설문이랑 같은 페이지내에?" + "이건
비회원용"(로그인하지 않은 응답자도 파일을 첨부할 수 있어야 한다는 뜻). `collect.html`
(제출함)로 따로 보내는 대신, 기존 설문의 `questions` 스키마에 `type: 'file'`을 네
번째 문항 유형(단일 선택/복수 선택/주관식/**파일 첨부**)으로 추가해, 같은 설문 응답
흐름 안에서 "이 문항에는 파일을 첨부해주세요"가 자연스럽게 섞일 수 있게 했다 — 별도
페이지/별도 응답 테이블 없이, 파일 첨부 문항도 다른 문항과 똑같이 `public_surveys.
questions`/`public_survey_responses.answers`에 그대로 들어간다(값의 모양만 문자열/
문자열배열이 아니라 `[{id,name,url}]` 객체 배열이라는 점이 다를 뿐).

- **파일 실물은 Supabase가 아니라 구글 드라이브에 저장한다** — `collect.html`/
  `file-library.html`/`room-booking.html`이 이미 공유하는 그 Apps Script 배포
  (`SCRIPT_URL`, 동일한 값을 `survey.html`에도 그대로 복붙)에 새 액션
  `surveyUploadFiles`를 추가했다. "경성고 설문조사 첨부파일"이라는 루트 폴더를 최초
  1회 lazy 생성(`getOrCreateSurveyRootFolder_`, `SURVEY_ROOT_FOLDER_ID` 스크립트
  속성)하고, 그 아래 설문 id(`public_surveys.id`, uuid 문자열)별로 하위 폴더를 하나씩
  자동으로 만든다(`getOrCreateSurveyFolder_`) — Supabase 쪽에 folder id를 저장할
  컬럼이 필요 없다(폴더 이름 자체가 설문 id). `saveFilesToFolder`를 그대로 재사용해
  파일명 앞에 `"[문항 라벨] "`을 붙여서(예: "[포트폴리오 파일] report.pdf"), 한 설문에
  파일 첨부 문항이 여러 개여도 드라이브 폴더만 열어봐도 어느 문항 것인지 구분된다.
  **이 액션은 매니저 비밀번호/로그인 토큰 확인이 전혀 없다** — 설문 자체가 비회원
  응답을 전제로 설계됐으므로, `verifyManager`/`verifySubmitter`를 거치는 다른
  uploadFiles류 액션들과 다르게 `surveyId`만 받으면 그대로 저장한다.
- **클라이언트(`survey.html`)**: `fileToBase64`/`filesToPayload`/`uploadSurveyFiles`
  (collect.html의 `driveApi`/`fileToBase64`/`filesToPayload`와 거의 동일한 모양 —
  `{action:'surveyUploadFiles', surveyId, questionKey, questionLabel, files:[{name,
  mime,data(base64)}]}`로 POST, `{ok:true, files:[{id,name,url}]}`를 돌려받음)를 새로
  추가했다. 응답 제출 핸들러는 **먼저 모든 문항을 검증(필수 여부, 파일 개수/크기)한
  뒤에만** 파일 첨부 문항마다 순서대로 업로드를 호출하고, 그 결과 배열을 그대로
  `answers[문항 key]`에 담아 `public_survey_responses`에 저장한다 — 업로드가 끝나기
  전에는 네트워크 요청이 전혀 나가지 않으므로, 필수 입력이 빠졌거나 파일이 너무 크면
  업로드 자체가 시도되지 않는다. `MAX_FILES_PER_Q = 5`(문항당 파일 개수), `MAX_FILE_
  SIZE = 15MB`(파일당 크기) — 비회원이 아무 제한 없이 올릴 수 있게 두면 공유 Apps
  Script 배포(다른 모든 페이지가 함께 쓰는 것) 자체에 부담을 줄 수 있어 둔 안전장치다.
  한도를 넘으면 그 문항 이름을 콕 집어 에러로 알려주고 업로드를 전혀 시도하지 않는다.
- **문항 편집기**(관리 화면): "파일 첨부" 유형을 고르면 선택지 textarea가 사라지고
  "응답자가 파일을 첨부하는 문항이에요 — 선택지는 필요 없어요" 안내만 보인다 — 저장
  시 선택지 필수 검증(`badOpt`)도 단일/복수 선택 유형에만 적용되도록 좁혔고, 저장되는
  `options`도 파일/주관식 유형이면 항상 빈 배열로 비운다.
- **공개 응답 화면**: 파일 첨부 문항은 `<input type="file" multiple>` + "파일당 15MB
  이하, 문항당 최대 5개까지 첨부할 수 있어요" 안내로 렌더링된다. 제출 중 파일을 올리는
  동안 "파일 올리는 중… (\"문항 라벨\")"으로 진행 상태를 보여준다.
- **결과 보기**(관리 화면 "📊 결과 보기"): 단일/복수/주관식과 나란히, 파일 첨부 문항은
  응답마다(이름 수집 시 응답자 이름, 아니면 제출 시각) 첨부된 파일명을 클릭 가능한
  드라이브 링크로 나열한다(`target="_blank"`) — 아무도 파일을 안 첨부했으면 "제출된
  파일 없음".
- **엑셀로 다운로드**: 파일 첨부 문항 칸은 "파일명 (드라이브URL)"을 파일마다 한 줄씩
  줄바꿈으로 이어붙인다(korean-inquiry.html의 메모/대화 내용 칸과 같은 "여러 항목은
  줄바꿈으로" 관행) — 다른 문항 칸(쉼표로 합치는 복수 선택 등)과는 별도 분기.
- `collect-setup.md`에 "## 10. survey.html의 '파일 첨부' 문항" 섹션을 추가해 위
  Apps Script 변경을 문서화했다 — **다른 모든 신규 액션과 같은 이유로, 이 코드는 6번
  Code.gs 안에 이미 포함되어 있을 뿐 실제로 동작하려면 스크립트 편집기에 반영한 뒤
  배포 → 배포 관리 → 수정 → 새 버전으로 재배포해야 한다.** 이 환경은
  `script.google.com`/`drive.google.com`으로의 아웃바운드가 막혀 있어 실제 업로드
  성공 여부(재배포 후 실제로 드라이브 폴더가 생기는지 등)까지는 이 환경에서 직접
  확인할 수 없다.
- Playwright(Apps Script 엔드포인트를 `page.route()`로 가짜 응답하는 방식 — 실제
  `script.google.com` 호출 없이 클라이언트 쪽 로직만 검증)로 (1) 필수 파일 문항을
  비운 채 제출하면 막히는지, (2) 파일 1개를 첨부해 제출하면 정확한 `surveyId`/
  `questionKey`/`questionLabel`/base64 페이로드로 업로드가 호출되고, 선택 문항(파일
  없음)은 업로드 자체가 안 일어나는지, (3) 저장된 응답의 파일 답은 `[{name,url}]`
  객체 배열이고 단일 선택 답은 평범한 문자열인지, 파일을 안 첨부한 선택 문항은 answers
  에 그 key 자체가 없는지, (4) 편집기에서 유형을 "파일 첨부"로 바꾸면 선택지 입력이
  사라지고, 라벨만 입력해도(선택지 없이) 저장이 성공하는지, (5) 결과 보기에서 파일
  응답이 실제 드라이브 링크(`<a href>`)로 렌더링되는지, (6) 15MB를 넘는 파일이나 5개를
  초과하는 첨부는 업로드 호출 자체 없이 에러로 막히고, 정확히 5개(한도)는 정상
  제출되는지, (7) 엑셀 내보내기의 파일 칸이 "파일명 (URL)"을 줄바꿈으로 이어붙여
  보여주고 다른 문항 칸(단일 선택)은 그대로 평문으로 나오는지 — 모두 확인했다. 기존
  `test_survey.js`의 32개 기존 단언도 다시 돌려 회귀가 없음을 확인했다.

## 설문 응답 대상 명단 + 학생 공유 QR 미리보기

- **`survey.html` 응답 대상 명단(선택)**: `public_surveys.target_names`(jsonb 배열, 기본 `[]`). 만들기 폼의 `#sTargets`에
  쉼표(또는 줄바꿈)로 적으면 중복 제거해 저장하고 `require_respondent_name`도 자동으로 켠다. 대상이 있으면 공개 응답
  화면의 이름 칸이 그 명단 `<select>`가 되어(오타로 미응답 처리되는 일 방지), 목록 메타에 "대상 n/m명 응답", 결과
  보기에 응답(✓ 초록)/미응답(빨강) 칩과 "미응답 명단 복사", 엑셀에 "응답현황" 시트가 추가된다. 매칭은 이름 문자열 일치.
- **QR 미리보기**: `exam-view.html`의 학생 링크·QR 팝업(`#btnQrPreview` → `#pvOverlay`)과 `mock-interview.html`의
  "학생에게 보내기" 팝업(`openSharePreview()` → `#sharePreviewOverlay`)에 "👀 미리보기" — 학생 링크에서
  `STUDENT_BASE_URL`을 떼고 **지금 열린 사이트 주소**로 바꿔 휴대폰 크기 iframe에 띄운다(학생 도메인은 main 배포라
  work 미리보기에서도 새 화면을 확인할 수 있게).

**회원 관리 — 펼친 상세 패널에만 "계정 삭제"**: 목록 행·일괄 바에는 여전히 비활성/다시 활성만 있고, 회원을 펼친
`renderDetail()` 맨 아래(본인 계정 제외)에 "계정 삭제"(`.dDelete`, 경고 문구 + 두 번 confirm, `delete-member` Edge
Function)를 둔다. 문서 양식·설문·결석신고서 등 FK(no action)로 막히는 계정은 실패 사유와 함께 "비활성을 쓰라"고 안내한다.

**교직원 명렬 저장 → 회원 정보 즉시 반영**: `staff-roster.html`에서 "변경 내용 저장"이나 엑셀 업로드 반영이 끝나면
`askSyncProfiles(names)`가 바뀐 이름 목록을 보여주며 회원 정보에도 반영할지 confirm하고, 확인하면
`sync_profiles_from_staff(p_password, p_names)`(새 RPC, 공용 편집 비밀번호 검증, `p_names` null이면 전체)가
이름이 같은 회원의 부서·교과·내선번호·담임(`is_homeroom`/`homeroom_class`)을 명렬 값으로 덮어쓴다 — member-admin.html
"다시 불러오기"(`profileFieldsFromStaff`)와 같은 규칙. 반영 인원보다 이름이 많으면 미가입 이름은 건너뛴 것으로 안내.
업로드의 경우 이 질문 다음에 기존 "명렬에 없는 회원 일괄 비활성" 질문이 이어진다.

## `survey.html` — 이름은 직접 입력+드롭다운, 응답자에게 제출 현황·결과 공개(만들 때 옵션)

응답 대상 명단이 있으면 이름 칸이 `<select>`가 아니라 `<input list="fRespondentNameList">`(+`<datalist>`)라, 기본은
타이핑이고 명단이 드롭다운 제안으로 뜬다(명단에 없는 이름도 제출은 된다 — 결과의 응답 현황은 이름 문자열 일치로 계산).
만들기 폼에 "응답자에게 공개" 체크 두 개 → `public_surveys.show_status`/`show_results`(boolean, 기본 false). 켜면
공개 응답 화면(작성 폼·제출 완료·"이미 응답" 화면 모두)에 "📋 제출 현황 보기"/"📊 결과 보기" 버튼이 생긴다.
응답 select RLS는 만든 교사 전용이라, `survey_public_summary(p_id)`(`SECURITY DEFINER`, anon 허용) RPC가 옵션이 켜진
것만 돌려준다 — 현황은 제출자 이름 목록, 결과는 이름 없이 `answers`만(파일 문항 키는 서버에서 제거). 결과 렌더링은
`renderResultsSummary(surv, responses, pub)`를 모듈 최상위로 옮겨 관리 화면과 공유하고, `pub`이면 파일 링크와
응답 현황 꼬리를 빼고 그린다.
