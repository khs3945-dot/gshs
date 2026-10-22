# mock-interview — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

## `mock-interview.html` (AI 모의면접 분석 및 종합 보고서 시스템)

사용자가 완성된 HTML 파일 전체를 붙여넣어 그대로 레포에 새 페이지로 추가해달라고
요청했다 — `exam-generator.html`/`score-generator.html`/`grade-estimate.html`과 같은
"완전한 클라이언트 전용 도구" 계열에 합류하는 페이지다. 학생의 모의면접을 브라우저
내장 `SpeechRecognition`으로 실시간 전사하고, 문항이 바뀔 때마다 "다음 문항 마커"
버튼으로 녹음 전체를 문항별로 나눈 뒤, AI가 먼저 답변 전사만으로 1차 분석을 하고,
그 다음 담당 교사가 직접 관찰한 의견을 선택적으로 더해 최종 보고서(영역별 점수,
강점/보완점, 문항별 피드백)를 만들어 인쇄할 수 있는 도구다.

- **이 저장소의 다른 어떤 페이지와도 다른 CSS 스택**: 손으로 짠 CSS 대신 Tailwind CDN
  (`cdn.tailwindcss.com`) + Font Awesome CDN(`cdnjs.cloudflare.com`)을 그대로 썼다 —
  이 파일 하나가 완전히 독립된 단일 HTML이라 다른 페이지의 스타일과 전혀 충돌하지
  않으므로, 사용자가 통째로 넘겨준 코드를 재작성해 이 저장소의 손-CSS 관행에 맞추기보다
  그대로 두는 쪽을 택했다 — `xlsx@0.18.5`처럼 페이지별로 외부 CDN 라이브러리를 가져다
  쓰는 기존 관행의 연장으로 봐도 무리가 없다. 추가한 건 `<script src="./nav.js"
  defer></script>` 한 줄뿐 — 이 사이트 거의 모든 페이지가 공유하는 떠다니는 햄버거
  메뉴/🔍 검색을 이 페이지에도 띄우기 위함이다(이 스크립트가 자신의 `<style>` 태그를
  주입하는 방식이라 Tailwind와 충돌하지 않는다).
- **로그인 게이트 없음, Supabase 테이블 없음** — `exam-generator.html`/
  `score-generator.html`과 똑같이 `auth.js` 스크립트 태그조차 없다. 학생 정보·전사
  내용·보고서는 전부 그 브라우저 세션에서만 존재한다(새로고침하면 사라짐).
- **처음엔 교사가 직접 Gemini API 키를 입력하는 방식(`localStorage['gemini_api_key']`,
  브라우저에서 Google Gemini API를 바로 호출)으로 받아들였으나, 사용자가 명시적으로
  "Api 키 입력 받는 부분은 없애고 클로드 소넷 5.5 api 쓰도록해줘"라고 요청해 이
  사이트의 표준 "AI provider strategy"(Claude, Supabase Edge Function 경유 — API 키를
  브라우저에 절대 노출하지 않음) 패턴으로 다시 만들었다.** API 키 입력 모달
  (`#settingsModal`, `openSettingsModal()`/`saveApiKey()` 등)과 `localStorage` 읽기를
  전부 제거하고, 새 Supabase Edge Function **`interview-report`**(project
  `tmssupuskkajahpuswcj`, `verify_jwt:false` — 이 페이지가 로그인 자체를 안 쓰므로)를
  만들었다. 이 함수는 `week-brief-summarize` 등 기존 함수들의 관행(`json()`/
  `corsHeaders()` 헬퍼, `logAiUsage()`로 `ai_usage_log`에 비동기 insert, 느슨한
  `extractJson()`)을 그대로 따르되, `student-bot-chat`이 한 번 겪은 사고(도구가 전혀
  없는 호출에 `output_config.effort`를 실어 보내면 모델이 `<invoke name="think">`를
  무한 반복하다 `max_tokens`에 걸려버린 사건, 이 문서 다른 곳에 이미 기록돼 있음)의
  교훈을 선제적으로 적용해 **`output_config` 자체를 아예 안 보낸다**(이 함수도 도구가
  없으므로). 이 사이트의 평소 Claude-우선/Gemini-폴백 체인은 의도적으로 안 썼다 —
  사용자가 "클로드 소넷 5.5"를 명시적으로 지정했으므로 `claude-sonnet-5-5` 단일
  모델만 호출하고, 실패 시엔(바로 아래) 기존 `runLocalSimulation()`으로 폴백한다.
  `interview-report`는 `{studentName, major, teacherMemo, questions:[{id,
  questionText, transcript}]}`를 받아 Claude에 프롬프트를 보내고,
  `{scoreLogic/scoreMajor/scoreDelivery/scoreAttitude/overallGrade/strengths/
  weaknesses/detailed[]}` 형태의 JSON을 돌려준다 — `teacherMemo`가 비어있으면
  "아직 선생님 의견이 입력되기 전, 답변 전사만을 바탕으로 한 1차 분석"이라는 지시를,
  채워져 있으면 "이 보고서는 최종 보고서이므로 선생님 의견을 강점/보완점/종합 평가에
  반드시 반영하라"는 지시를 프롬프트에 분기해 넣는다 — **별도의 두 번째 함수를 만들지
  않고 하나의 함수가 `teacherMemo` 유무로 1차/최종 두 단계를 모두 처리한다.** 다른
  모든 Edge Function과 마찬가지로 이 함수의 소스는 git에 커밋돼 있지 않다("Edge
  Function code has no backup outside Supabase itself" — 이 문서 다른 곳에 이미
  기록된 이 저장소의 한계).
- **"교사 의견은 면접 답변 분석을 먼저하고 그 후 교사 분석을 입력하면(선택사항)
  최종 보고서가 만들어지게"라는 요청대로, 화면 흐름을 1단계/2단계 두 단계로
  재구성했다.** 기존의 단일 "AI 종합 보고서 생성하기" 버튼과 교사 메모 입력칸을
  하나로 묶어 "교사 메모 → AI 호출" 한 번에 끝내던 흐름을 버리고:
  - **1단계 "AI 답변 분석하기"**(`generateAnalysis()`, 교사 메모 카드보다 먼저
    렌더링되는 위치로 옮김) — `teacherMemo: ''`로 `interview-report`를 호출해 전사
    내용만으로 1차 분석을 받는다. 실패하면(네트워크 오류, 함수 500 등) 기존
    `runLocalSimulation()`(고정 샘플 평가)으로 조용히 폴백하고, 두 경로 모두
    `hasDraftAnalysis = true`로 세팅한 뒤 교사 메모 입력칸/프리셋 버튼/"최종 보고서로
    확정하기" 버튼을 전부 활성화한다(`setStageControlsEnabled(true)`) — 이 세 컨트롤은
    1단계가 끝나기 전까진 전부 `disabled` 상태(Tailwind `disabled:opacity-40` 등)다.
  - **2단계 "최종 보고서로 확정하기"**(`finalizeReport()`, `#btnFinalize`) — 교사 메모
    textarea가 비어있으면 **네트워크 호출을 전혀 하지 않고** 그 자리에서 바로
    "✅ 최종 보고서로 확정했어요 (선생님 의견 없음)."로 확정 상태(`isFinalized=true`,
    뱃지 색이 인디고→에메랄드로 전환)만 표시한다. 메모가 입력돼 있으면 그 메모를
    실어 `interview-report`를 **두 번째로** 호출해(1단계와 같은 엔드포인트, `teacherMemo`
    필드만 채워짐) 선생님 의견이 반영된 최종 결과로 화면을 다시 그린다. 이 호출이
    실패하면 1단계 결과를 그대로 최종 보고서로 확정한 것으로 처리한다(완전히 막다른
    길로 만들지 않음).
  - `#stageStatusMsg`(작은 안내 문구)가 매 단계 전환마다 다음에 뭘 할 수 있는지를
    알려준다 — "1단계 분석이 끝났어요. 선생님 의견을 입력하거나(선택), 바로 '최종
    보고서로 확정하기'를 눌러주세요." 등.
- `nav.js`의 `EXTRA_SEARCH_ITEMS`(adminOnly 없음 — 승인 여부와 무관하게 🔍 검색으로
  누구나 찾을 수 있음, `grade-estimate.html` 항목 바로 다음)와 `admin-tools.html`의
  "예상 등급 산출" 타일 바로 다음 자리에 평범한(관리자 전용 아님) `tool-card`로
  추가했다 — `DEFAULT_NAV_ITEMS`/`index.html` 최상위 타일은 없음, `exam-generator.html`/
  `score-generator.html`/`grade-estimate.html`과 동일한 노출 방식. 타일 설명 문구에
  한때 있던 "(Gemini API 키 직접 입력 필요)"는 API 키 UI를 없애면서 더 이상 사실이
  아니게 돼 지웠다.
- Playwright로 두 라운드 검증했다 — 처음엔 (1) 문항 탭 3개 렌더링, (2) "샘플 채우기"로
  학생 정보/문항 데이터 채움, (3) API 키 없이도(당시엔 키 입력 UI가 있었음)
  `runLocalSimulation()` 폴백으로 등급 뱃지가 채워짐, (4) JS 예외 없음을 확인했다.
  Claude Edge Function 전환 후 다시, `test_mock_interview_two_stage.js`로 (1) "API
  설정" 버튼/모달이 완전히 사라졌는지, (2) 초기 상태에서 메모·프리셋·확정 버튼이
  전부 비활성인지, (3) 1단계 호출의 `teacherMemo`가 빈 문자열인지, (4) 1단계 완료 후
  컨트롤이 활성화되는지, (5) 메모를 채운 뒤 확정하면 그 메모를 실은 별개의 2번째
  호출이 나가는지, (6) 뱃지/상태 문구가 올바르게 바뀌는지를 확인했고,
  `test_mock_interview_edgecases.js`로 (7) 1단계 API 실패 시 로컬 시뮬레이션으로
  폴백하면서도 2단계는 정상적으로 열리는지, (8) 메모 없이 확정하면 **네트워크 호출이
  전혀 없이** 바로 확정 메시지·초록 뱃지가 뜨는지를 확인했다 — 전부 통과했다.

## `mock-interview.html` 재설계 — "질문+답변 함께 녹음 → AI가 분리해서 평가" + 화면 전체 다크/인디고 테마로 리디자인

사용자가 모바일 목업 스크린샷 두 장을 보여주며 두 가지를 함께 요청했다: (1) "디자인
이런 느낌으로 해주고", (2) "지금은 질문이 아예 추천돼서 나오는데 녹음 시작을 누르면
질문+답변 녹음받고 다음을 누르면 그다음 질문+답변 녹음 받는식으로 하고, 분석할땐
질문 답변 분리시켜서 분석하는거 가능해?"

**기존 아키텍처를 거의 그대로 살릴 수 있었다.** 연속 녹음 + "다음 문항 마커"로 구간을
나누는 기존 모델(`isRecording` 하나로 `SpeechRecognition.start()`를 한 번만 부르고,
마커를 누르면 버퍼만 리셋하고 활성 탭을 바꾸는 방식) 자체가 이미 "면접관이 그 구간에서
소리 내어 질문을 읽고, 이어서 학생이 답하면 그 둘이 통째로 그 문항의 전사문에 들어간다"
는 요청과 정확히 맞아떨어진다 — 브라우저 음성 인식에는 화자 구분이 없어서, 애초에 그
구간에서 들린 말은 전부(질문이든 답변이든) `transcript`에 함께 쌓인다. 진짜 바뀌어야
했던 건 두 가지뿐이었다: (1) AI 분석 프롬프트가 그동안 `questionText`(교사가 미리
타이핑한 참고 질문)와 `transcript`(답변만 들어있다고 가정)를 서로 다른 것으로 취급하고
있었던 것을 고쳐, `transcript`가 사실 질문+답변이 섞인 구간 전사일 수 있다는 걸 전제로
분리부터 하도록 바꾸는 것, (2) 화면 디자인.

- **녹음 버튼이 토글 하나에서 시작/마커/정지 세 개의 독립 버튼으로 바뀌었다.**
  기존 `toggleMasterRecording()` 하나가 `startRecording()`/`stopRecording()` 두
  함수로 쪼개졌고, 스크린샷처럼 초록색 "🎤 면접 녹음 시작"(`#startRecBtn`)·
  어두운 "🔖 다음 문항 구분 (마커)"(`#markerBtn`, 기존과 동일 로직)·정사각형
  "⏹"(`#stopRecBtn`, 새로 추가) 세 버튼이 나란히 놓인다. `setRecStatus(recording)`
  이 세 버튼의 활성/비활성과 상태 텍스트(`#recStatusText`: "면접 녹음 대기 중" ↔
  "🔴 면접 녹음 중")·점 색(`#recStatusDot`)을 한 번에 맞춘다 — 녹음 중이 아닐 땐
  시작만 눌릴 수 있고, 녹음 중엔 마커/정지만 눌릴 수 있다. 정지를 누르면(새 동작)
  현재 활성 문항의 `endTime`도 그 순간의 타이머 값으로 기록해둔다 — 예전엔 마커를
  누를 때만 `endTime`이 갱신되고 "정지"는 그냥 토글의 반대쪽이라 별도 기록이
  없었다.
- **"면접 질문 내용" 입력칸은 그대로 남아있지만 역할이 "참고용"으로 명확해졌다.**
  라벨에 "(참고용 — 실제로 말한 내용과 조금 달라도 괜찮아요)"를 덧붙였다 — 교사가
  미리 적어두는 예상 질문일 뿐, 실제 그 구간에서 면접관이 입으로 뭐라고 물었는지는
  "전사된 질문+답변 텍스트"(`transcript_${id}`, 기존 "실시간 전사 및 답변 텍스트"
  에서 라벨 변경) 쪽에 녹음된 그대로 들어간다는 걸 분명히 했다. 플레이스홀더 문구도
  "면접관의 질문과 학생의 답변이 함께 녹음되고, [다음 문항 구분 (마커)] 버튼을
  누르면 다음 문항으로 자동 전환됩니다"로 바꿔 이 동작을 설명한다.
- **AI 분석(Edge Function `interview-report`, Claude Sonnet 5.5)이 질문/답변을
  실제로 분리해서 평가하도록 프롬프트를 다시 썼다(버전 2로 재배포).** 문항별로
  보내는 텍스트를 "참고 질문: ...\n이 문항 구간의 전체 녹음 전사: ..."로 바꾸고,
  프롬프트에 세 단계 지시를 명시적으로 추가했다 — ① 전사 텍스트 안에서 "면접관이
  실제로 질문한 부분"과 "학생이 실제로 답변한 부분"을 문맥(질문형 문장/지시문 vs.
  1인칭 경험 서술)으로 스스로 구분해 분리할 것, ② 참고 질문은 예상 질문일 뿐이니
  실제로 무엇이 질문·답변인지는 전사 내용 자체로 판단하고, 전사에 질문을 읽은
  부분이 아예 없으면(학생 답변만 녹음된 경우) 분리된 질문은 참고 질문을 그대로 쓸
  것, ③ 점수·강점·보완점은 반드시 "분리해낸 학생 답변"만 근거로 삼을 것(질문
  문장을 답변으로 착각해 평가하지 말 것). `detailed[]` 응답 스키마에
  `question`/`answer` 두 필드를 추가해, AI가 실제로 분리해낸 질문/답변을 그대로
  돌려주도록 했다 — 이게 바로 "분석할 때 질문 답변 분리시켜서 분석"을 눈으로 확인할
  수 있는 지점이다. 클라이언트의 요청 payload 모양(`{id, questionText,
  transcript}`)은 전혀 안 바뀌었다 — 분리는 전적으로 서버(프롬프트) 쪽 변경이다.
- **보고서의 "문항별 상세 피드백" 카드가 이제 분리된 질문/답변을 함께 보여준다.**
  `renderReportUI()`가 `item.summary` 한 줄 평가 아래에 "질문(분리됨): ..."/
  "답변(분리됨): ..." 두 줄을 추가로 렌더링한다(필드가 없으면 그 줄 자체를
  생략 — 구버전 캐시 응답이나 로컬 시뮬레이션 폴백에서도 안전하게 동작). 이
  과정에서 **AI가 돌려주는 텍스트(질문/답변/강점/보완점/총평)를 `innerHTML`에
  그대로 꽂고 있던 기존 코드에 `escapeHtml()` 헬퍼를 새로 추가해 전부 거치도록
  고쳤다** — 전사 내용은 교사가 직접 타이핑하거나 수정할 수 있는 텍스트라, 이스케
  이프 없이 그대로 삽입하면 이론상 HTML/스크립트 삽입이 가능했던 지점이다.
  `runLocalSimulation()`(AI 호출 실패 시 폴백)도 같은 스키마에 맞춰 `question:
  q.questionText, answer: q.transcript || '(답변 전사 없음...)'`를 채운다 — 로컬
  폴백은 실제 AI 분리를 할 수 없으므로 참고 질문을 그대로 "질문"으로, 구간 전사를
  그대로 "답변"으로 보여주는 정직한 근사치다.
- **문항 삭제 버튼이 새로 생겼다** (스크린샷의 각 문항 패널 우측 상단 "🗑 삭제").
  `deleteQuestion(id)`는 `confirm()` 확인 후 그 문항을 배열에서 제거하고, **남은
  문항들의 `id`를 1..N으로 다시 매긴다** — 삭제 후에도 탭 번호가 항상 1번부터
  순서대로 이어지게 하기 위한 선택이다(안 그러면, 예를 들어 2번을 지운 뒤 "+ 문항
  추가"를 누르면 `questions.length+1`로 새 id를 매기는 기존 로직이 이미 존재하는
  id와 충돌할 수 있었다). 문항이 1개만 남았을 때는 삭제를 막는다("문항은 최소 1개
  이상이어야 해요"). 삭제된 탭이 활성 탭이었으면 그 자리(또는 마지막 탭)로 자동
  전환한다.
- **"전체 초기화" 버튼이 헤더에 새로 생겼다**(원형 새로고침 아이콘, 스크린샷의
  우상단 버튼과 같은 위치). `resetAll()`은 `confirm()` 확인 후: 녹음 중이면 먼저
  정지하고, 학생 정보/교사 메모/타이머를 비우고, `questions`를 기본 추천 질문
  3개로 되돌리고(`defaultQuestions()`로 뽑아낸 헬퍼 — 초기 로드 시에도 같은 함수를
  재사용), 1·2단계 상태(`hasDraftAnalysis`/`isFinalized`/`stageStatusMsg`)와
  보고서 전체(`resetReportUI()` — 점수바/강점·약점/문항별 상세/선생님 소견을 전부
  빈 placeholder 상태로)를 초기화한다.
- **레이아웃을 2단(좌: 입력, 우: 보고서) 그리드에서 위→아래 한 줄 흐름(싱글 컬럼,
  `max-w-2xl`)으로 재설계**하고, 전체 톤을 스크린샷처럼 인디고/퍼플 그라데이션
  헤더 + 짙은 네이비 녹음 패널 + 흰색 카드들로 바꿨다 — 헤더(마이크 아이콘,
  "녹음 & 구간 마커 평가 시스템" 타이틀, "⚡ 질문+답변 함께 녹음 → AI가 자동 분리"
  배지, 우상단 샘플 채우기/초기화 원형 버튼), 지원자 정보 카드, 녹음 패널(상태
  점+텍스트+타이머, 시작/마커/정지 버튼, 안내 문구), 문항 관리 카드(탭이 알약
  모양 토글로 바뀌고 전사 여부를 작은 점으로 표시), 1단계/2단계 버튼, 교사 메모
  카드, 그리고 보고서 영역은 짙은 헤더 바("학생 모의면접 평가 보고서" + 인쇄
  버튼) 아래 기존 `reportContainer`가 그대로 이어지는 구조다. 기존에 쓰이던
  모든 엘리먼트 `id`(studentName/targetMajor/interviewDate/recordingTimer/
  markerBtn/questionTabs/questionContents/btnAnalyze/aiBtnText/stageStatusMsg/
  teacherInputMemo/btnPresetGood/btnPresetImprove/btnFinalize/finalizeBtnText/
  reportContainer/repName/repMajor/repDate/totalScoreBadge/score1~4Val/bar1~4/
  repStrengths/repWeaknesses/detailedQAnalysis/repTeacherMemo)는 전부 그대로
  유지해 JS 로직을 다시 짤 필요가 없게 했다 — 바뀐 건 마크업/클래스와, 녹음
  버튼 구조·삭제/초기화 기능·질문-답변 표시뿐이다.
- 재배포된 Edge Function도 다른 모든 Edge Function과 마찬가지로 소스가 git에
  커밋돼 있지 않다("Edge Function code has no backup outside Supabase itself" —
  이 문서 위쪽에 이미 기록된 이 저장소의 한계) — 버전 2로 배포 완료.
- Playwright(`test_mock_interview_redesign.js`, 스크래치패드 전용)로 (1) 초기
  상태에서 시작 버튼만 활성인지, (2) 녹음 시작 시 시작이 비활성화되고 마커·정지가
  활성화되는지, (3) 마커를 누르면 2번 문항으로 넘어가는지, (4) 정지를 누르면 다시
  초기 버튼 상태로 돌아가는지, (5) 문항 삭제가 실제로 탭 개수를 줄이는지, (6)
  샘플 채우기 → 1단계 분석 → 보고서의 "문항별 상세 피드백"에 AI가 돌려준 분리된
  질문/답변 텍스트가 실제로 렌더링되는지, (7) 2단계 확정 시 교사 메모를 실은 두
  번째 API 호출이 나가는지(기존 두 단계 흐름 회귀 없음), (8) 전체 초기화가 학생
  정보/보고서/문항 탭 개수(3개로 복귀)를 전부 되돌리는지 — 모두 확인했다.

**음성 인식 오류 처리 — `SpeechRecognition`에 `onerror`/`onend` 핸들러가 전혀
없어서, 마이크 권한 거부·마이크 없음·네트워크 문제·Safari/Firefox(이 API 자체를
지원 안 함)에서 "녹음 중"이라고 화면엔 계속 뜨지만 전사는 전혀 안 되는 채로
조용히 멈추는 버그가 있었다.** "음성 입력은 잘 작동해?"라는 질문에 Playwright로
실제 `webkitSpeechRecognition`을 직접 띄워 확인하는 과정에서 발견했다 — 이
샌드박스 자체는 진짜 마이크도 없고 Google 음성 인식 백엔드로의 아웃바운드
네트워크도 막혀 있어(`net::ERR_TUNNEL_CONNECTION_FAILED`) 실제 전사 자체를 끝까지
검증할 수는 없었지만, 그 과정에서 코드에 오류/종료 핸들러가 아예 없다는 구조적
결함 자체는 명확히 확인됐다.

- **브라우저 미지원 배너**: 페이지 로드 시 `SpeechRecognition`/
  `webkitSpeechRecognition`이 둘 다 없으면(Safari·Firefox) `#recUnsupportedMsg`
  (호박색 경고 박스, "Chrome 또는 Edge 브라우저에서 이용해주세요")가 드러난다 —
  이 API 자체가 없는 브라우저에서는 녹음 버튼을 눌러도 아무 일도 안 일어나던
  기존 동작 대신, 처음부터 왜 안 되는지와 그래도 전사 칸에 직접 타이핑할 수
  있다는 안내를 보여준다.
- **`recognitionErrorMessage(code)`**가 `onerror`의 코드를 한국어 메시지로
  매핑한다 — `not-allowed`/`permission-denied`(마이크 권한 거부),
  `audio-capture`(마이크 없음), `network`(네트워크 문제),
  `service-not-allowed`(브라우저가 음성 인식 서비스 자체를 지원 안 함), 그 외는
  코드값을 그대로 보여주는 범용 메시지. **`no-speech`(단순히 잠깐 조용했을
  뿐 — 치명적 오류 아님)와 `aborted`(페이지 자신이 `.stop()`을 호출해서 발생 —
  역시 정상)는 둘 다 무시한다** — 녹음을 멈추지도, 에러 메시지를 띄우지도
  않는다. 그 외 모든 코드는 치명적 오류로 취급해 즉시 `stopRecording()`을 호출하고
  `#recErrorMsg`(붉은 경고 박스)에 매핑된 메시지 + "전사 칸에는 그래도 직접
  타이핑할 수 있어요"를 보여준다.
- **예상치 못한 `onend`(녹음 중인데 사용자가 멈추지 않았는데도 녹음이 끝난
  경우) 자동 재시작** — Chrome은 `continuous:true`로 설정해도 내부적으로 긴
  세션을 스스로 끊어버릴 수 있다는 것이 잘 알려진 동작이라, 이걸 감지하지 못하면
  긴 면접 중간에 전사가 조용히 멈춰버려도 교사는 알 방법이 없다. `recognition.
  onend`가 `isRecording`이 아직 `true`인 채로(=사용자가 직접 멈춘 게 아니라
  브라우저가 스스로 끝낸 경우) 발생하면, 300ms 뒤 `recognition.start()`를 다시
  호출해 세션을 이어 붙인다 — `restartPending` 플래그로 재시작 타이머가 겹쳐
  걸리는 것을 막는다.
- `startRecording()`은 시작할 때, `resetAll()`은 전체 초기화할 때 각각
  `clearRecError()`를 호출해 이전에 떠 있던 에러 메시지를 지운다.
- `test_mock_interview_speech_errors.js`(Playwright, `window.__fakeRec`을 노출하는
  `FakeRecognition` 스텁으로 `onerror`/`onend`를 수동으로 발생시켜 재현)로 (1)
  API 자체가 없으면 미지원 배너가 드러나는지, (2) `not-allowed` 같은 치명적
  오류는 녹음을 멈추고 "마이크 권한"을 언급하는 한국어 메시지를 보여주는지,
  (3) `no-speech`는 녹음을 멈추지도 메시지를 띄우지도 않는지, (4) 녹음 중
  예상치 못한 `onend`가 발생하면 `recognition.start()`가 자동으로 다시 호출되는지
  — 네 가지를 모두 검증했다. **이 샌드박스는 Tailwind CDN(`cdn.tailwindcss.com`)
  으로의 아웃바운드도 막혀 있어, 페이지의 `.hidden` 유틸리티 클래스가 실제로는
  아무 CSS 효과도 내지 못한다(`display`가 항상 `block`으로 남음)** — 그래서 이
  테스트들은 `page.isVisible()`(렌더링된 가시성) 대신 `classList.contains
  ('hidden')`(코드가 실제로 그 클래스를 추가/제거하는지)로 검증한다. 실제
  배포된 사이트에서는 Tailwind CDN이 정상 로드되므로 이 구분이 필요 없지만, 이
  샌드박스에서 같은 종류의 테스트를 또 작성할 때 `isVisible()`이 항상 `true`로
  나와 당황하지 않도록 기록해둔다.

**Incident: 마이크로 녹음할 때 같은 구절이 전사 칸에 무한히 반복되며 쌓이는 버그.**
교사 스크린샷 제보: "면접 질문 내용" 칸은 이미 채워진 채였고, 마이크를 눌러 녹음을
시작했더니 "우리 학교에 지원하게 된 개교와 고등학교" 같은 거의 동일한 구절이
`#transcript_1` 칸에 줄마다 계속 반복돼 쌓였다(말할수록 한 줄씩 늘어나는 모양). 원인은
`recognition.onresult`가 `event.resultIndex`/`isFinal`만 믿고 그 구간의 `final` 텍스트를
무조건 `currentTextBuffer`에 이어붙였던 것 — Chrome의 연속(`continuous:true`) 음성 인식은
내부적으로 이미 한 번 확정(`isFinal`)한 구간을 **똑같이, 또는 그 구간을 포함하는 더 긴
구절로 다시 한 번 "확정"된 결과로 재전송**하는 경우가 있다(특히
`recognition.onend`의 자동 재시작 직후에 두드러짐 — 매번 `resultIndex`가 0부터 다시
시작하는 새 세션이라, 직전 세션에서 이미 붙인 구절이 새 결과로 다시 들어와도
막을 방법이 없었다). 정확히 같은 원인으로 `chatbot-teacher.html`의 마이크 입력도 한 번
고친 적이 있다(이 문서의 chat-teacher 섹션 "Speech-to-text input dedupes on the text"
참고) — `resultIndex`/`isFinal`만으로는 막을 수 없고, 텍스트 자체를 비교해야 한다는
같은 교훈이다. **고쳐서** `lastFinalSegment`(직전에 실제로 이어붙인 구절) 변수를 추가해,
새로 들어온 `final`이 (1) 직전과 완전히 같으면 통째로 버리고, (2) 직전 구절로
시작하는 더 긴 문자열이면 겹치는 접두어를 뺀 나머지만 이어붙이고, (3) 완전히 새로운
구절이면 그대로 이어붙인다 — `startRecording()`이 녹음을 새로 시작할 때마다
`lastFinalSegment`를 비워서(완전히 새 세션이니 이전 문항의 잔여값에 막히지 않게),
`onend`의 자동 재시작처럼 세션 "안에서" 벌어지는 중복만 걸러낸다.
`test_mock_interview_mic_dedupe.js`(가짜 `FakeRecognition`에 `onresult`를 직접 호출해
재현 — 매번 `resultIndex:0`부터 시작하는 새 결과를 흉내냄)로 (1) 같은 구절이 그대로
다시 들어오면 중복 추가되지 않는지, (2) 직전 구절을 포함하는 더 긴 구절이 들어오면
겹치는 부분을 뺀 나머지만 이어붙는지, (3) 그 이후 완전히 새로운 구절은 정상적으로
이어붙는지 — 확인했고, 기존 `test_mock_interview_redesign.js`/
`test_mock_interview_speech_errors.js`도 다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — 음성 인식 미지원 브라우저에서 "녹음은 됐는데 전사가 전혀 안 된다"로 보이던 함정

교사 보고: "음성 입력이 안 되는 것 같다." 코드를 다시 읽어보니, `recUnsupportedMsg`
경고 배너(지원하지 않는 브라우저에서 보여주는 안내 — iOS Safari/Chrome-iOS, Firefox는
`window.SpeechRecognition`/`window.webkitSpeechRecognition` 자체가 없음)는 페이지 로드
시 제대로 나타났지만, **그 아래 큰 초록색 "면접 녹음 시작" 버튼은 지원 여부와 무관하게
항상 눌을 수 있는 상태로 남아있었다.** `startRecording()`은 `recognition` 객체가
`null`이어도 `isRecording = true`로 바꾸고 타이머를 돌리고 상태 텍스트를 "🔴 면접 녹음
중"으로 바꿔버려서, 지원하지 않는 브라우저에서는 **화면상으로는 정상적으로 녹음
중인 것처럼 보이지만 실제로는 아무 것도 전사되지 않는** 상태가 됐다 — 정확히
"음성 입력이 안 되는 것 같다"는 증상과 일치한다.

**고쳐서** 두 가지를 더했다: (1) `startRecording()` 맨 앞에
`if(!recognitionSupported)` 가드를 추가해, 지원하지 않는 브라우저에서는 타이머/녹음
상태를 전혀 켜지 않고 즉시 `recErrorMsg`로 "Chrome 또는 Edge 브라우저에서 이용해주세요"
안내를 보여주고 리턴한다, (2) 페이지 로드 시 `recognitionSupported`가 거짓이면
`#startRecBtn` 자체를 `disabled`로 바꾸고(`opacity-40`/`cursor-not-allowed`,
`markerBtn`/`stopRecBtn`이 이미 쓰는 것과 같은 비활성 스타일), `title`에도 이유를
달아 애초에 혼동의 여지를 없앴다. 지원하는 브라우저에서 마이크 권한 거부/네트워크
오류 등으로 실패하는 경우는 기존 `recognition.onerror` 핸들러가 이미 올바르게
`stopRecording()`을 호출하고 에러 메시지를 보여주고 있었다(이번 변경과 무관,
회귀 없음 — Playwright로 실제 `webkitSpeechRecognition` API가 있는 헤드리스
크로미움에서 마이크 권한을 거부시켜 직접 확인함: 바로 "마이크 권한이 거부됐어요"
메시지와 함께 대기 상태로 정상 복귀).

Playwright(스크래치패드 전용, `test_mock_interview_unsupported.js`)로 (1)
`SpeechRecognition`/`webkitSpeechRecognition`을 둘 다 지운 상태에서 배너가 뜨고
시작 버튼이 비활성화되는지, (2) 버튼을 강제로 다시 활성화해(스테일/레이스 클릭을
흉내냄) 클릭해도 `startRecording()` 자신이 "면접 녹음 대기 중" 상태를 유지하고
에러 메시지를 보여주는지(절대 가짜로 "녹음 중"이 되지 않는지), (3) API가 있는
정상 환경에서는 시작 버튼이 활성 상태인지 — 검증했고, 기존
`test_mock_interview_redesign.js`/`test_mock_interview_speech_errors.js`/
`test_mock_interview_mic_dedupe.js`도 다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — 마이크 중복 전사 재발: "직전 구절"만 비교해서는 부족했다

위 섹션에서 고친 `lastFinalSegment` 비교(새 `final`을 오직 **바로 직전에 추가한
final 하나**와만 비교)는, 교사가 실제로 쓰면서 보내준 스크린샷에서 여전히 재발했다
— 전사 칸에 "안녕하십니까 소개를 소개를 해 소개를 해 보세요 소개를 해 보세요"처럼
단어가 중복됐다. 재현해보니 원인은: Chrome의 연속 음성 인식이 **직전 chunk를
연장**하는 게 아니라, **그보다 조금 전에 이미 말한 독립된 단어를 다시 "확정"
결과로 재전송**하는 경우가 있다는 것 — 예를 들어 버퍼가 이미 "...소개를 해"로
끝난 상태에서, 다음 `onresult`가 "소개를"(직전에 이미 합쳐져 들어간 단어) 하나만
독립적으로 다시 보낸다. `lastFinalSegment`는 그 직전 호출의 **원본** final 문자열
("소개를 해")만 기억하므로, "소개를"은 그것과 같지도 않고 그것으로 시작하지도
않아 전혀 새로운 내용으로 취급돼 그대로 또 이어붙었다.

**고쳐서** 비교 대상을 "마지막 final 문자열 하나"에서 "**지금까지 누적된 버퍼의
최근 120자(`DEDUPE_LOOKBACK_CHARS`)**"로 넓혔다 — `mergeFinalIntoBuffer(buffer,
final)`가 (1) 새 `final`이 그 최근 구간에 이미 그대로 들어있으면 통째로 버리고,
(2) 아니면 버퍼의 꼬리와 `final`의 머리 사이에서 가장 긴 겹침(overlap)을 찾아 그
겹치지 않는 나머지만 이어붙이고, (3) 겹치는 부분이 전혀 없으면 완전히 새로운
내용으로 그대로 이어붙인다. 이 방식은 "직전 chunk의 연장"(기존에 잡던 패턴)과
"조금 전에 말한 단어의 독립 재전송"(이번에 새로 발견된 패턴) 둘 다 하나의 로직으로
잡아낸다 — 버퍼 꼬리 전체를 보므로 바로 직전 호출이 아니어도 최근 몇 번의 호출에
걸친 재전송까지 커버한다. `lastFinalSegment` 변수와 그 리셋 로직은 완전히
제거했다(더 이상 필요 없음 — 비교 기준이 변수 하나가 아니라 버퍼 자체이므로).

`test_mock_interview_mic_dedupe2.js`(스크래치패드 전용)로 실제 스크린샷에 나온
정확한 재현 시나리오("안녕하십니까" → "소개를" → "소개를 해" → "소개를"(재전송)
→ "소개를 해 보세요" → "소개를 해 보세요"(재전송))를 그대로 입력해, 최종 전사가
중복 없이 정확히 "안녕하십니까 소개를 해 보세요"가 되는지 확인했다 — 이 테스트는
이전 코드(직전 구절만 비교)로 돌리면 실제로 재현 실패함을 먼저 확인한 뒤 작성했다.
기존 `test_mock_interview_mic_dedupe.js`/`test_mock_interview_redesign.js`/
`test_mock_interview_speech_errors.js`/`test_mock_interview_unsupported.js`도 다시
돌려 회귀가 없음을 확인했다.

## `mock-interview.html` 분석 결과 — 강점/보완점을 키워드 칩으로, 서술 문장이 아니라 한눈에 훑어보게

사용자 요청: "분석내용이 너무 상세한데 키워드 중심으로 눈에 잘 보이게 해줘." 보고서의
"주요 강점"/"보완할 점 및 약점" 카드와 문항별 상세 피드백의 강점/보완점 줄이 전부 Claude가
생성한 긴 서술 문장(예: "전공에 대한 뚜렷한 목표 의식과 구체적인 동아리 활동 경험이
돋보입니다. 논리적인 기승전결로 답변 구성이 우수함.")을 `.innerText`로 그대로 꽂아 보여주고
있어서, 한 번에 읽어 들어오지 않고 줄글을 다 읽어야만 요점을 알 수 있었다.

- **`keywordTagsHtml(items, variant)`**(새 헬퍼, `escapeHtml` 바로 아래)이 짧은 키워드/구
  문자열의 배열을 작은 알약 모양 칩(`rounded-full`, `variant:'pos'`는 에메랄드,
  `'neg'`는 로즈 — 기존 강점/보완점 카드 색과 동일)으로 렌더링한다. 입력이 배열이 아니라
  문자열(오래된 캐시 응답이나 이전 버전 Edge Function이 여전히 프로즈를 돌려주는 경우에
  대한 방어적 폴백)이면 `,`/`·`/줄바꿈으로 나눠 배열처럼 다룬다. 빈 배열/빈 문자열이면
  "분석 결과가 없습니다"라는 평범한 텍스트를 보여준다(칩 없음).
- **HTML**: `#repStrengths`/`#repWeaknesses` 컨테이너 div가 `text-xs ... leading-relaxed`
  (줄글 전용 스타일)에서 `flex flex-wrap gap-1.5`(칩이 여러 개면 자동으로 줄바꿈되며
  나란히 흐름)로 바뀌었다. 초기 placeholder 텍스트도 그 안의 `<span>`으로 감싸서, 분석
  전/초기화 직후에도 같은 레이아웃 컨테이너를 그대로 쓴다(`resetReportUI()`도 같은 모양의
  `<span>` 하나짜리 `innerHTML`로 통일).
- **`renderReportUI(data)`**: `data.strengths`/`data.weaknesses`를 `.innerText =` 대신
  `keywordTagsHtml(..., 'pos'|'neg')`로 렌더링하고, 문항별 상세 피드백의 강점/보완점 줄도
  `${escapeHtml(item.strength)}`(단일 문자열 가정) 대신
  `${keywordTagsHtml(item.strength, 'pos')}`/`${keywordTagsHtml(item.improvement, 'neg')}`
  로 바꿔 각 줄을 `flex flex-wrap items-center gap-1`로 감쌌다 — "강점:"/"보완점:" 레이블
  뒤에 칩이 여러 개 나란히(또는 줄바꿈되어) 붙는다. `question`/`answer`(전사에서 분리한
  실제 질문/답변 — "분석 내용"이 아니라 사실 그대로의 전사 발췌)는 요청의 대상이 아니므로
  건드리지 않았다.
- **`runLocalSimulation()`**(AI 호출 실패 시 폴백)의 샘플 데이터도 같은 형식(문자열 →
  짧은 키워드 배열, 예: `["뚜렷한 목표 의식", "구체적 활동 경험", "논리적 답변 구성"]`)
  으로 바꿔, AI 경로와 로컬 폴백 경로가 시각적으로 일관되게 보인다.
- **Edge Function `interview-report`**(버전 2 → 3으로 재배포)의 프롬프트도 함께
  고쳤다 — JSON 스키마 설명에 "strengths/weaknesses/detailed[].strength/
  detailed[].improvement는 절대 완전한 문장으로 쓰지 말고, 짧은 키워드·구(각 2~8글자
  안팎)의 배열로만 작성하라"는 지시와, "~함"/"~입니다" 같은 서술형으로 끝나는 긴 항목은
  금지한다는 문장을 추가했다. 예시 JSON도 `"strengths": "..."` 단일 문자열에서
  `"strengths": ["짧은 강점 키워드1", "짧은 강점 키워드2", ...]` 배열 형태로 바꿨다 —
  `question`/`answer`(전사 분리 결과, 사실 그대로의 문장이어도 괜찮음을 명시)는 기존
  지시를 그대로 유지했다. 이 함수를 또 건드릴 때는 `question`/`answer`와
  `strength`/`improvement`/`strengths`/`weaknesses`의 형식 요구가 서로 다르다는 걸
  혼동하지 말 것 — 전자는 사실 발췌, 후자만 짧은 키워드 배열이다.
- `test_mock_interview_keyword_tags.js`(Playwright, `interview-report` 엔드포인트를
  배열 스키마 응답으로 모킹)로 (1) AI 경로에서 강점/보완점이 각각 독립된 `<span>` 칩으로
  렌더링되고 그 내용이 정확히 일치하는지, (2) 칩에 실제로 `rounded-full` 알약 스타일이
  적용돼 있는지, (3) 문항별 상세의 강점/보완점도 칩으로(보완점이 여러 개면 둘 다) 렌더링
  되는지, (4) AI 호출이 실패해 `runLocalSimulation()` 폴백으로 넘어가도 강점이 여러 개의
  짧은 키워드 칩(문장 종결 부호로 끝나지 않는)으로 나오는지 — 두 경로 모두 확인했다.
  `keywordTagsHtml()`은 `escapeHtml()`을 그대로 거치므로, 칩 텍스트에 대한 기존 XSS
  방지(이전 세션에서 이미 추가된 `escapeHtml` 적용)도 그대로 유지된다. 기존
  `test_mock_interview_redesign.js`/`test_mock_interview_speech_errors.js`/
  `test_mock_interview_mic_dedupe.js`/`test_mock_interview_mic_dedupe2.js`/
  `test_mock_interview_unsupported.js`도 다시 돌려 회귀가 없음을 확인했다
  (`test_mock_interview_two_stage.js`/`test_mock_interview_edgecases.js`/
  `test_mock_interview_smoke.js`는 이 변경과 무관한, 이전부터 있던 `button:has-text(
  "샘플 채우기")` 셀렉터 한계로 여전히 실패한다 — 그 버튼이 아이콘 전용이라 보이는 텍스트가
  없고 `title` 속성에만 라벨이 있어서다; `button[title="샘플 채우기"]`로는 정상 동작함을
  재확인했다).

## `mock-interview.html` 평가 등급 — 0~100 세부 점수/문자 등급 대신 상/중/하 3단계로 단순화

사용자 요청: "그리고 면접에 대한 평가는 상중하 정도로만 하는 게 좋을 것 같아." 기존엔 네 평가
영역(논리력 및 구성력/전공적합성 및 이해도/표현력 및 전달력/태도 및 진정성) 각각이 0~100 사이
정수 점수로, 종합 등급은 `"A (우수)"` 같은 문자+수식어 조합으로 나왔는데 — 실제 면접 평가는
그 정도의 세밀한 구분이 의미가 없고, 상/중/하 세 단계면 충분하다는 판단.

- **`interview-report` Edge Function의 프롬프트**가 `scoreLogic`/`scoreMajor`/
  `scoreDelivery`/`scoreAttitude`/`overallGrade` 다섯 필드를 전부 "상"/"중"/"하" 세 글자
  문자열 중 하나로만 답하도록 바뀌었다(0~100 정수 지시를 지우고, few-shot 예시 JSON도
  `"scoreLogic": "상"` 식으로 교체) — 세부 점수 차이를 억지로 구분하지 말고 그 영역이
  전반적으로 우수/보통/부족한지만 판단하라는 문장을 추가했다. `strengths`/`weaknesses`/
  `detailed[].strength`/`detailed[].improvement`를 짧은 키워드 배열로 쓰라는 기존 지시는
  그대로 유지했다(이 변경과 무관). 버전 4로 재배포(`verify_jwt:false` 명시).
- **클라이언트 쪽 정규화 — `normalizeLevel(v)`/`normalizeOverallLevel(v, levels)`**(새
  헬퍼, `escapeHtml()` 바로 뒤)가 AI 응답/로컬 시뮬레이션 양쪽을 거친다. `normalizeLevel`은
  값이 이미 '상'/'중'/'하'면 그대로 쓰고, 아니면(캐시된 구버전 응답이 숫자를 돌려주는 경우에
  대한 방어적 폴백 — 이 저장소의 "레거시/이상 데이터에 대한 방어적 처리" 관행) 숫자로 해석해
  80 이상→상, 60 이상→중, 그 외→하로 버킷팅한다. `normalizeOverallLevel`은 `overallGrade`가
  이미 상/중/하면 그대로, 아니면(예: 캐시된 `"A (우수)"` 같은 구버전 문자 등급) 네 영역의
  정규화된 레벨에 대해 다수결로 종합 등급을 역산한다 — 동점이면 상→중→하 순으로 먼저
  매칭된 값을 쓴다.
- **`renderReportUI(data)`**가 각 `scoreNVal`의 `innerText`를 숫자+"점" 대신 레벨 단어
  그대로 보여주고, `barN`의 width를 `LEVEL_BAR_WIDTH`(상=100%/중=66%/하=33%, 세 단계
  고정값) 테이블에서 가져온다. `totalScoreBadge`도 `"종합 등급: " + overallLevel` 형식으로
  바뀌었다(기존엔 등급 문자열을 그대로 붙여 보여줬을 뿐). HTML의 네 점수 placeholder와
  `resetReportUI()`의 초기화 값도 `-점`에서 `-`로 바꿔서, 숫자+단위라는 전제를 없앴다.
- **`runLocalSimulation()`**(AI 호출 실패 시 폴백)의 목 데이터도 `scoreLogic`~
  `scoreAttitude`/`overallGrade`를 전부 `'상'`으로 바꿨다 — 숫자 점수와 `"A (최우수)"` 문자
  등급 조합을 완전히 제거했다.
- `test_mock_interview_level_grading.js`(새 테스트)로 (1) AI가 상/중/하를 직접 돌려주면
  네 영역 모두 그 글자 그대로 렌더링되고 막대 폭도 정확히 100%/66%/33%인지, 종합 등급도
  그 글자 그대로 보이는지, (2) 캐시된 구버전 숫자 점수(88/65/40/90)+문자 등급(`"A (우수)"`)
  응답이 각각 상/중/하/상으로 버킷팅되고, 종합 등급도 다수결로 "상"(2표, 중/하는 1표씩)으로
  역산되는지, (3) 로컬 시뮬레이션 폴백도 네 영역+종합 모두 "상"으로 뜨는지 — 모두
  확인했다. 기존 `test_mock_interview_redesign.js`/`test_mock_interview_speech_errors.js`/
  `test_mock_interview_mic_dedupe.js`/`test_mock_interview_mic_dedupe2.js`/
  `test_mock_interview_unsupported.js`/`test_mock_interview_keyword_tags.js`도 다시 돌려
  회귀가 없음을 확인했다.

## `mock-interview.html` — 참고 질문 입력칸 제거 + 강점/보완점을 "키워드만"에서 "키워드 + 한 줄 설명"으로

사용자가 실제로 써보고 두 가지를 요청했다: "모의 면접 전사 분석이 잘 되는 걸 확인했어.
질문과 답변을 모두 전사하는 것이기 때문에 질문+답변 전사 칸만 필요하고 그 위에 질문 칸은
굳이 필요 없을 거 같애. 그리고 키워드 중심으로 잘 나오는데 너무 간결해. 키워드를
제시하되 강점과 보완 내용을 조금 더 설명해주면 좋겠어."

**① "면접 질문 내용"(참고 질문) 입력칸 완전 제거.** 각 문항은 이미 면접관의 질문과
학생의 답변을 **하나의 연속 녹음 구간**으로 함께 전사하므로(위 "모의면접 분석 및
종합 보고서 시스템" 섹션의 "교사가 미리 적어두는 예상 질문" 설계 자체가, 질문도 결국
같은 전사 칸에 그대로 들어가 있다는 걸 생각하면 중복이었다), 교사가 따로 참고 질문을
타이핑해 넣는 `renderQuestionContent()`의 "면접 질문 내용" `<textarea>`/라벨 블록을
통째로 지웠다 — 이제 문항 패널은 번호/구간 헤더 다음 곧바로 "전사된 질문+답변
텍스트" 칸으로 이어진다. `questionText` 데이터 필드 자체(와 `updateQData(id,
'questionText', ...)` 호출 지점)는 남아있지만 더 이상 어떤 UI에서도 쓰이지 않고,
`loadSampleData()`의 세 샘플 문항도 전부 `questionText: ""`로 비워뒀다 — 질문 내용은
전사 텍스트 안에 이미 들어있으므로, UI에서 입력받던 값이 사라져도 데이터 손실이 아니다.

**② 강점/보완점이 "키워드 칩만"에서 "키워드 + 그걸 뒷받침하는 1문장 설명"으로.**
바로 전 라운드에서 만든 키워드 칩(짧은 명사형 구절만, 설명 없음)이 "너무 간결하다"는
피드백 — 한눈에 훑어보는 장점은 유지하되, 그 키워드가 왜 그런지 바로 알 수 있는 설명을
덧붙이기로 했다.
- **스키마 변경**: `strengths`/`weaknesses`/`detailed[].strength`/
  `detailed[].improvement`가 전부 짧은 키워드 문자열 배열에서 `{keyword, detail}`
  객체 배열로 바뀌었다 — `keyword`는 그대로 2~8글자 안팎의 짧은 구(한눈에 훑어보는
  용도), `detail`은 그 키워드를 뒷받침하는 구체적인 설명 1문장(대략 20~60자, 전사
  내용의 어떤 부분이 근거인지 담음).
- **`keywordTagsHtml(items, variant)`**(클라이언트, 바로 전 라운드에서 만든 함수)를
  다시 썼다 — 평평한 칩 목록(`<span>` 여러 개를 나란히 흘려보냄) 대신, 각 항목을
  `<div class="flex items-start gap-2">` 한 줄로 만들어 왼쪽에 키워드 알약(기존과 같은
  `rounded-full` pill, 에메랄드/로즈 색)을, 그 옆에 설명 텍스트(`text-slate-600`)를
  나란히 보여준다. **이전 데이터 형태와의 하위 호환은 그대로 유지**했다 — 입력이
  평범한 문자열 배열(옛 키워드-전용 캐시 응답)이면 키워드만 있고 `detail`은 비워서
  보여주고(설명 줄 자체를 생략), 입력이 아예 한 줄짜리 줄글(그보다 더 예전의 프로즈
  캐시)이면 기존처럼 쉼표/가운뎃점/줄바꿈으로 쪼개 키워드만 보여준다 — 두 경우 모두
  새 객체 스키마가 아니라는 것만으로 화면이 깨지지 않는다.
- **HTML**: `#repStrengths`/`#repWeaknesses` 컨테이너를 `flex flex-wrap gap-1.5`(칩이
  옆으로 흐르는 레이아웃)에서 `flex flex-col gap-1.5`(설명이 붙어 폭이 넓어진 줄들이
  위아래로 쌓이는 레이아웃)로 바꿨다. 문항별 상세 피드백 블록의 강점/보완점도 같은
  이유로 인라인 한 줄(`<strong>` 라벨 + 칩들이 같은 줄)에서, 라벨을 자기 줄에 두고 그
  아래 `flex flex-col gap-1`로 키워드+설명 줄들을 쌓는 2단 구조로 바꿨다.
- **`runLocalSimulation()`**(AI 호출 실패 시 로컬 폴백)의 목 데이터도 전부 같은
  `{keyword, detail}` 형식의 실제 한국어 예시로 다시 썼다 — AI 경로와 로컬 폴백 경로가
  시각적으로 계속 일관되게 보인다.
- **Edge Function `interview-report`**(버전 4 → 5로 재배포)의 프롬프트를 두 군데
  고쳤다 — (1) `qaText` 템플릿에서 "참고 질문: ..." 줄을 완전히 뺐다(UI가 더 이상
  `questionText`를 수집하지 않으므로 보낼 값이 없다). 대신 프롬프트 지시사항 2번을
  "전사에 질문을 소리 내어 읽은 부분이 전혀 없으면, 분리된 질문 항목은 답변 내용으로
  미루어 짐작할 수 있는 간단한 질문 형태로 재구성하라(빈 값으로 두지 말라)"로
  바꿨다(이전엔 "참고 질문을 그대로 쓰라"였는데, 그 참고 질문 자체가 더 이상
  없으므로). (2) JSON 스키마 설명과 few-shot 예시를 `{keyword, detail}` 객체 배열
  형식으로 바꾸고, keyword(2~8글자)/detail(20~60자, 전사 근거 포함) 각각의 길이·내용
  기준을 명시했다 — `question`/`answer`(질문/답변 분리 자체는 이전 그대로, 사실
  발췌라 문장 형태 유지)와 `strength`/`improvement`/`strengths`/`weaknesses`(이번에
  객체로 바뀐 필드)의 형식 요구가 다르다는 걸 프롬프트 안에서 분명히 구분해뒀다.
- `test_mock_interview_no_question_field.js`(새 테스트)로 (1) 초기 상태/샘플 데이터
  로드 후/다른 탭으로 전환한 뒤 모두 "면접 질문 내용" 라벨이 전혀 없는지, (2) 전사
  텍스트 칸은 그대로 있고 정상적으로 값을 읽고 수정할 수 있는지 — 확인했다.
  `test_mock_interview_keyword_tags.js`를 새 `{keyword, detail}` 스키마와 DOM 구조에
  맞게 다시 썼다 — (A) AI 경로에서 강점/보완점/문항별 상세 모두 키워드+설명이 각각의
  줄로 올바르게 렌더링되는지(키워드 알약 스타일 유지 확인 포함), (B) 로컬 시뮬레이션
  폴백도 모든 줄에 설명까지 포함돼 있는지, (C) 하위 호환 — 옛 "키워드 문자열 배열"과
  그보다 더 옛 "쉼표로 묶인 줄글 문자열" 두 형태 모두 설명 없이 키워드만 깨지지 않고
  보이는지 — 모두 검증했다. 기존 `test_mock_interview_redesign.js`/
  `test_mock_interview_speech_errors.js`/`test_mock_interview_mic_dedupe.js`/
  `test_mock_interview_mic_dedupe2.js`/`test_mock_interview_unsupported.js`/
  `test_mock_interview_level_grading.js`도 다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — 기본 문항은 1개만 + 지도 교사(선택) 입력 → 보고서 이름/서명칸

사용자가 두 가지를 요청했다: "학생의 이름과 학번을 입력 받을 때 지도 교사도 입력
받고(선택 사항), 만약 지도 교사가 입력됐다면 보고서에도 지도 교사 이름과 서명칸이
나오도록. 지금은 질문 1, 질문 2, 질문3 이 기본 세팅되어 있고 질문2까지만 녹음하면
질문3을 대답하지 않았다고 나와. 기본적으로는 질문1만 보여주고, 문항 추가를 하면
질문2, 질문3 순서대로 생성하는 것으로 해줘."

**① 기본 문항 개수를 3개에서 1개로.** `defaultQuestions()`가 질문1/질문2/질문3을
전사 빈 채로 미리 깔아두던 게 실제 버그의 원인이었다 — 교사가 질문2까지만 마커를
눌러 녹음해도, 애초에 깔려있던 "질문3"이 전사가 비어있는 채로 AI 분석에 그대로
넘어가서 "대답하지 않음"으로 평가됐다. 사용자가 요청한 그대로 `defaultQuestions()`가
이제 1번 문항 하나만 돌려준다 — `addNewQuestion()`("+ 문항 추가" 버튼)과
`triggerQuestionMarker()`("다음 문항 구분 (마커)" 버튼, 녹음 중 다음 문항으로 넘어갈
때)는 이미 둘 다 그 시점의 `questions.length + 1`/`currentTabId + 1`로 다음 순번
문항을 그때그때 만드는 구조라 손댈 필요가 없었다 — 문항 2, 3, ...은 이제 교사가
실제로 "+ 문항 추가"를 누르거나 마커로 넘어갈 때만, 순서대로 생성된다. `resetAll()`도
`defaultQuestions()`를 그대로 재사용하므로 초기화 후에도 1개 탭으로 돌아간다 —
`loadSampleData()`(샘플 채우기)는 여러 문항 기능을 보여주는 데모라 그대로 3개 샘플
문항(전사 내용이 전부 채워진 채)을 유지한다.

**② 지도 교사(선택 사항) 입력 + 보고서 이름/서명칸.** "지원자 및 면접 정보" 카드의
"면접 일시" 입력칸과 같은 줄에 "지도 교사 (선택 사항)" 텍스트 입력칸
(`#supervisingTeacher`)을 추가했다 — 학생 이름/지원 학과처럼 필수가 아니라, 비워두면
아무 영향이 없다. 보고서(`reportContainer`) 맨 아래, "담당 선생님 종합 소견" 블록
바로 다음에 `#teacherSignatureBlock`(기본 `hidden`)을 새로 추가했다 —
"지도교사: <이름> 서명: ____"(밑줄만 그려진 빈 서명칸, 인쇄해서 직접 서명하는 용도)
형태로, **지도 교사 이름이 입력됐을 때만** 보인다. `updateTeacherSignatureDisplay()`
가 그 입력칸 값의 유무로 블록을 보이기/숨기기 하고 이름을 채워 넣는다 — 입력칸
자신의 `oninput`에도 바로 연결돼 있어서, 분석을 돌리기 전에 미리 입력해둬도 즉시
반영되고(분석/최종 확정을 거쳐야만 나타나는 게 아님), `generateAnalysis()`/
`finalizeReport()`에서도 한 번씩 더 호출해 안전망을 둔다. `resetAll()`은 그 입력칸을
비우고 `resetReportUI()`가 블록을 다시 숨긴다. `loadSampleData()`도 샘플 지도교사
이름("이지은")을 채워 넣어서, "샘플 채우기" 한 번으로 이 기능까지 바로 볼 수 있게
했다 — 학번 입력 자체는 애초에 이 페이지에 없는 필드라(학생 이름만 받음) 손대지
않았다.

`test_mock_interview_default_q_and_signature.js`(새 테스트)로 (A) 새 세션이 정확히
1개 탭으로 시작하고 "+ 문항 추가"를 두 번 누르면 2번, 3번이 순서대로 생성되는지,
(B) 질문1만 전사를 채운 뒤 분석을 돌리면 API에 실제로 문항 1개만 전송되는지(예전
버그의 "유령 미답변 문항 3" 재현 방지 확인), (C) 지도 교사 입력칸이 비어있으면
서명칸이 숨겨지고, 타이핑하면(분석 전에도) 즉시 나타나고, 지우면 다시 숨겨지고,
분석을 돌린 뒤에도 이름이 그대로 유지되고, 전체 초기화 후 다시 숨겨지는지, (D) 샘플
채우기가 지도 교사 이름과 서명칸을 함께 보여주는지 — 모두 확인했다. 기존
`test_mock_interview_redesign.js`의 탭 개수 관련 단언 세 곳(마커 직후 2개 탭으로
시작, 삭제 후 1개로 줄어듦, 초기화 후 1개로 복귀 — 전부 "3개 기본값" 전제가
바뀌었으므로)을 새 기본값에 맞게 고쳤고, `test_mock_interview_smoke.js`의 구식
"문항 탭 3개" 로그 문구도 "1개로 시작"으로 맞췄다(이 스모크 테스트는 이전부터
있던 버튼-셀렉터 한계로 여전히 예외 없이 완전하게는 안 돌지만, 문구 자체는
고쳐서 혼동을 줄였다). `test_mock_interview_speech_errors.js`/
`test_mock_interview_mic_dedupe.js`/`test_mock_interview_mic_dedupe2.js`/
`test_mock_interview_unsupported.js`/`test_mock_interview_level_grading.js`/
`test_mock_interview_keyword_tags.js`/`test_mock_interview_no_question_field.js`도
다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — 담당 선생님 소견이 없으면 인쇄할 때 그 카드 자체를 생략

사용자 요청: "담당 선생님 소견이 없는 경우 인쇄할 때 담당선생님 소견 칸은 아예 생략해
버리자. 있을 때만 나오게 하고." 기존엔 `#repTeacherMemo`가 비어있어도 "입력된 선생님
소견이 없습니다."라는 placeholder 문구와 함께 "담당 선생님 종합 소견" 카드 자체는
화면/인쇄 양쪽에 항상 그대로 떴다 — 실제로 아무 의견도 안 적혀 있는데 인쇄물에 그
카드 한 칸이 그대로 남는 게 어색하다는 요청.

- **화면에서는 placeholder를 그대로 유지하고, 인쇄할 때만 카드를 숨긴다** — 화면에서
  빈 카드를 완전히 없애면 "소견을 적을 수 있는 자리가 있다"는 걸 교사가 알기 어려워지므로,
  빈 상태의 placeholder 문구는 화면 작업 중엔 여전히 유용한 안내다. 숨기는 건 오직
  "인쇄/PDF" 시점 — 기존 `@media print{...}` 블록(`.no-print`/`.print-only`/
  `.print-shadow`와 같은 자리)에 새 `.print-hide-empty{ display:none !important; }`
  규칙을 추가했다.
- **`<div id="teacherMemoBlock">`**(기존엔 id가 없던, "담당 선생님 종합 소견" 제목+
  `#repTeacherMemo`를 감싸는 바깥 카드)에 id를 붙이고, **`updateTeacherMemoDisplay
  (teacherMemo)`**(새 함수, `updateTeacherSignatureDisplay()` 바로 앞) 하나가
  `repTeacherMemo`의 텍스트를 채우는 것과 `teacherMemoBlock`에 `print-hide-empty`
  클래스를 토글하는 것을 함께 처리한다 — `repTeacherMemo.innerText = ...`를 직접
  쓰던 기존 세 곳(`resetReportUI()`, `generateAnalysis()`의 1차 분석 직후,
  `finalizeReport()`의 최종 확정 직후) 모두 이 함수 호출로 교체했으므로, 어느 경로로
  보고서가 갱신되든 인쇄 숨김 여부가 항상 최신 소견 유무와 일치한다.
- `test_mock_interview_print_hide_memo.js`(새 테스트, Playwright `page.emulateMedia
  ({media:'print'})`로 실제 print 미디어 쿼리 하에서의 `computed display`를 직접
  확인)로 (1) 소견 없이 1단계 분석만 끝낸 상태에서 화면에는 카드가 여전히 보이지만
  print 미디어에서는 `display:none`으로 계산되는지, (2) 선생님 메모를 입력하고
  2단계로 확정하면 그 카드가 print 미디어에서도 숨겨지지 않는지, (3) "전체 초기화"
  후에는 다시 숨김 상태(+placeholder 문구)로 돌아가는지 — 모두 확인했다. 기존
  `test_mock_interview_redesign.js`/`test_mock_interview_speech_errors.js`/
  `test_mock_interview_mic_dedupe.js`/`test_mock_interview_mic_dedupe2.js`/
  `test_mock_interview_unsupported.js`/`test_mock_interview_level_grading.js`/
  `test_mock_interview_keyword_tags.js`/`test_mock_interview_no_question_field.js`/
  `test_mock_interview_default_q_and_signature.js`도 다시 돌려 회귀가 없음을
  확인했다.

## `mock-interview.html` — "다음 문항 마커" 지연으로 전사 앞부분이 잘릴 수 있다는 걸 AI 분석이 감안하도록

사용자 요청: "다음 문항 마커 구분을 누르는 걸 깜빡할 경우 앞부분 질문이나 답변이
짤릴 수 있는데 그건 분석에서 감안해 줬으면 좋겠어. 질문이 짤렸을 경우에는 학생의
답변을 바탕으로 질문을 추측해서 채워줘도 되고." 이 페이지의 "다음 문항 구분 (마커)"
버튼을 교사가 늦게 누르면, 그 문항의 전사 구간이 실제 질문/답변 경계보다 늦게
시작하게 돼 — 면접관의 질문 전체(또는 학생 답변의 도입부)가 그 문항의 전사에
전혀 안 들어가고 통째로 이전 문항의 전사 뒤쪽에 섞여 들어가거나, 아예 녹음 자체에
안 잡혀 사라질 수 있다. 이미 프롬프트에는 "전사에 질문이 전혀 없으면 답변으로
질문을 재구성하라"는 지시(2번 규칙)가 있었지만, "왜 질문이 없을 수 있는지"(마커
지연으로 인한 누락)와 "문장이 중간에서 끊긴 채 시작하는 경우"(완전히 없는 게
아니라 일부만 잘린 경우)는 다루지 않았다.

- **Edge Function `interview-report`의 프롬프트에 4번 규칙을 추가**(버전 5 →
  6으로 재배포) — "선생님이 마커 버튼을 누르는 시점이 늦어지면 전사가 질문/답변
  경계보다 늦게 끊기거나 시작될 수 있다"는 전제를 명시하고, 전사가 질문 없이
  답변 중간부터 시작하는 것처럼 보이거나 문장이 끊긴 채 시작하면 이를 "마커
  지연으로 인한 녹음 누락"으로 이해하라고 지시했다. 결정적으로 **"절대로 전사가
  불완전하다는 이유로 감점하거나 질문을 알 수 없음으로 처리하지 말고, 남아있는
  답변 내용만으로 질문을 자연스럽게 추측해 재구성하고, 남아있는 답변 내용을
  최대한 근거로 공정하게 평가하라"**는 문장을 함께 넣었다 — 이 지시는 기존 2번
  규칙(질문이 전혀 없을 때의 재구성)과 겹치지만, "완전히 없는 경우"뿐 아니라
  "일부만 잘린 경우"까지 명시적으로 커버하고, "불완전한 전사라서 감점하지
  말라"는 공정성 지시를 추가로 분명히 했다는 점이 다르다.
- 이 변경은 순수 프롬프트 수정이라 요청/응답 스키마, 클라이언트 코드 모두
  바뀌지 않았다 — 테스트는 기존 `test_mock_interview_redesign.js`(API 페이로드
  모양 검증)로 요청 스키마가 그대로임을 재확인했을 뿐, 이 환경에서는 실제
  Claude 호출 성공 여부/품질까지는 검증할 수 없다(이 문서 다른 곳에도 반복되는
  `api.anthropic.com` 아웃바운드 차단 제약). 실제 효과는 교사가 마커를 늦게
  누른 실제 면접에서 확인해야 한다.

## `mock-interview.html` — 인쇄 시 nav.js 플로팅 아이콘(홈/나의 페이지 등)과 중복된 앱 UI 제목 바를 모두 숨겨, 한 장짜리 보고서처럼 보이게

사용자 요청: "보고서 인쇄 페이지에 위에 홈 버튼 나의 페이지 아이콘 등이 나오는데
나오지 않게 하고 문서 한장이 하나의 보고서 형태처럼 보이게 정리해줘." 이 페이지도
다른 거의 모든 페이지처럼 `<script src="./nav.js" defer>`를 로드하므로, 그 스크립트가
주입하는 떠다니는 햄버거/🏠/👤 아이콘 묶음(클래스가 전부 `gsnav-`로 시작 — `nav.js`
섹션의 기존 설명 그대로)이 화면뿐 아니라 인쇄 시에도(`position:fixed` 요소는 크롬
인쇄에서 페이지마다 다시 그려질 수 있음) 그대로 찍혀 나왔다. `grade-estimate.html`이
이미 같은 문제를 겪고 똑같은 방식으로 고친 전례(이 문서의 "Bug: 3단 레이아웃..."
항목 — nav.js 자체를 건드리지 않고, 그 페이지 자신의 `@media print` 블록에
`[class^="gsnav-"], [class*=" gsnav-"]{ display:none !important; }`를 추가하는
방식)를 그대로 가져왔다.

- **`[class^="gsnav-"], [class*=" gsnav-"]{ display:none !important; }`**를 기존
  `@media print{...}` 블록에 추가 — nav.js 자신은 전혀 안 건드렸으므로 다른 모든
  페이지의 nav.js 동작에는 영향이 없고, 이 페이지의 인쇄 CSS에만 적용된다.
- **보고서 카드를 감싸던 바깥 앱 UI 프레임도 함께 정리했다.** 기존엔 보고서
  (`#reportContainer`, 실제 보고서 제목 "모의면접 역량 진단 및 종합 평가 보고서"를
  자체적으로 갖고 있음)를 둘러싼 바깥 카드(`#reportFrame`, 새로 id 추가)가 그 위에
  또 다른 짙은 남색 그라데이션 제목 바("학생 모의면접 평가 보고서" + 인쇄 버튼)를
  갖고 있어서 — 인쇄했을 때 제목이 두 번(앱 UI 제목 바 + 보고서 자체 제목) 겹쳐
  나오는 모양이었다. 그 제목 바 `<div>`에 `no-print`를 추가해 인쇄 시 완전히
  숨기고, `#reportFrame`에는 `border:none; box-shadow:none; border-radius:0`을
  줘서 "카드 안에 또 카드가 떠 있는" 느낌 없이 보고서 하나가 바로 종이 위에 놓인
  모양이 되게 했다(`#reportContainer`가 이미 갖고 있던 `print-shadow` 클래스가
  그 안쪽에 옅은 테두리를 그대로 유지한다).
- **`main`의 중앙 정렬·좌우 패딩도 인쇄 시엔 제거**(`padding:0; max-width:100%`)해서
  보고서가 화면에서처럼 좁은 한 칼럼(최대 `max-w-2xl`)에 갇히지 않고 인쇄 페이지
  너비를 그대로 채우도록 했다 — 종이 한 장에 들어찬 문서처럼 보이는 효과.
- `test_mock_interview_print_chrome_hidden.js`(새 테스트)로 (1) 화면에서는 nav.js의
  gsnav 아이콘이 실제로 존재/보이는지(사라진 걸 확인하려면 먼저 있다는 걸 확인해야
  하므로), (2) print 미디어 쿼리 하에서 그 아이콘들이 전부 `display:none`으로
  계산되는지, (3) 보고서 바깥의 중복 제목 바가 인쇄 시 숨겨지는지, (4) `#reportFrame`의
  테두리/그림자/모서리가 인쇄 시 전부 제거되는지, (5) `#reportContainer`의 실제
  보고서 제목은 인쇄 시에도 그대로 보이는지, (6) `main`이 인쇄 시 전체 폭으로 펼쳐지는지,
  (7) 화면(screen 미디어)으로 되돌리면 제목 바/아이콘 모두 다시 정상적으로 보이는지
  (회귀 없음) — 모두 확인했다. 기존 `test_mock_interview_redesign.js`/
  `test_mock_interview_speech_errors.js`/`test_mock_interview_mic_dedupe.js`/
  `test_mock_interview_mic_dedupe2.js`/`test_mock_interview_unsupported.js`/
  `test_mock_interview_level_grading.js`/`test_mock_interview_keyword_tags.js`/
  `test_mock_interview_no_question_field.js`/`test_mock_interview_default_q_and_signature.js`/
  `test_mock_interview_print_hide_memo.js`도 다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — 마커 없이 쭉 녹음해도 AI가 하나의 긴 전사를 여러 문항으로 자동 분리

사용자 질문: "모의 면접은 문항 구분을 하지 않고 전체 녹음을 해도 분석할때 문항을 나눠주려나?"
— 이전까지는 **아니었다**: "다음 문항 구분(마커)" 버튼이 "여기서부터 다음 문항"이라는
경계를 정하는 유일한 수단이었고, `interview-report` Edge Function은 입력받은 문항(녹음
구간) 개수와 **정확히 같은 길이**의 `detailed[]`만 돌려주도록 프롬프트가 강제돼 있었다
("detailed 배열은 입력된 문항 수와 같게 작성하세요") — 그래서 마커를 한 번도 안 누르고
면접 전체를 문항1 하나의 전사로 쭉 녹음하면, 그 안에 질문이 여러 개 섞여 있어도 AI는
문항 1개짜리 결과만 돌려줬다.

사용자가 "진행해줘"로 명시적으로 승인해 구현했다:

- **`interview-report` Edge Function을 버전 7로 재배포** — 프롬프트에 **5번 지시**를
  새로 추가했다: 한 녹음 구간(특히 마커를 거의/전혀 안 눌러 구간 수가 1~2개뿐인데 전사가
  유난히 긴 경우) 안에 서로 다른 질문에 대한 여러 번의 질문-답변 교환이 섞여 있을 수
  있다는 것, 면접관이 새 화제로 전환하는 지점("다음 질문은", "그럼 이번에는" 같은 문구나
  주제 전환)을 스스로 찾아 몇 개의 독립된 교환이 있는지 판단하라는 것, 교환이 하나뿐이면
  그대로 두고 여러 개면 그 구간 하나를 여러 개의 `detailed` 항목으로 쪼개 각각 따로
  분석하라는 것(반대로 이미 구간이 깔끔하게 문항 하나당 하나씩 나뉘어 있으면 억지로 쪼개거나
  합치지 말 것)을 지시한다.
- **"detailed 배열은 입력된 문항 수와 같게 작성하세요"라는 기존 강제 조건을 제거**하고,
  "detailed 배열의 길이는 입력된 녹음 구간 수와 같을 필요가 없습니다 — 5번 지시대로 쪼갠
  만큼 항목을 더 만드세요"로 바꿨다. `qNum`도 더 이상 입력 구간 번호를 그대로 쓰지 않고,
  **전체 면접에서 실제로 식별한 모든 질문-답변 교환을 시간 순서대로 1번부터 다시 번호
  매기도록** 지시했다(예: 구간이 1개인데 그 안에서 질문 3개를 찾았으면 qNum은 1,2,3).
  JSON 예시도 `detailed` 배열에 항목을 2개(서로 다른 구간처럼 보이지만 사실 같은 구간에서
  나온 것일 수도 있다는 걸 보여주는 예) 넣어서, "항목 수가 입력 개수와 달라도 된다"는 걸
  모델에게 구체적으로 보여줬다.
- **`qaText`(각 구간을 모델에게 보여줄 때 붙이는 라벨)를 "[문항 N]"에서 "[녹음 구간 N]"으로
  바꿨다** — 이 번호가 최종 출력의 `qNum`과 반드시 같지 않다는 걸 모델이 처음부터 헷갈리지
  않게 하려는 것. 이 라벨이 최종 "문항 번호"가 아니라 "선생님이 마커로 나눈 녹음 구간
  번호일 뿐"이라는 설명 문장도 새로 추가했다.
- **클라이언트(`mock-interview.html`)는 전혀 안 바꿨다** — `renderReportUI()`가 이미
  `(data.detailed || []).map(...)`로 배열 길이에 대한 어떤 가정도 없이 그대로 순회하며
  렌더링하고 있었고, `callInterviewReportApi()`도 그냥 현재 `questions` 배열(몇 개든)을
  그대로 보낼 뿐이라 — 서버가 입력보다 더 많은 `detailed` 항목을 돌려줘도 UI가 자동으로
  전부 표시한다. 즉 이 기능은 **순수 프롬프트 변경만으로 끝났다**, 클라이언트 쪽 "입력
  개수 == 출력 개수" 가정이 애초에 없었기 때문이다(단, `runLocalSimulation()` — AI 호출
  실패 시 로컬 샘플 폴백 — 은 여전히 `questions.map()`으로 1:1 매핑만 하는 단순 버전으로
  남겨뒀다, 이건 그냥 오프라인 대체 샘플일 뿐이라 분리 기능까지 흉내 낼 필요는 없다고
  판단했다).
- `test_mock_interview_autosplit.js`(새 테스트)로 (1) 기본 상태가 문항 탭 1개로
  시작하는지(마커를 한 번도 안 누른 상황 재현), (2) 긴 연속 전사를 그 문항 1개에 넣고
  분석을 돌리면 **클라이언트는 문항 1개만 서버로 보내는지**(분리는 전적으로 서버/AI
  책임이지 클라이언트가 미리 쪼개지 않음을 확인), (3) 서버가 `detailed` 3개짜리 응답을
  주면 UI가 입력 1개와 무관하게 **3개 전부**(qNum 1/2/3, 각각의 질문/답변 내용)를
  렌더링하는지, (4) 전체 종합 등급(문항 수와 무관한 필드)도 정상적으로 뜨는지 — 모두
  검증했다. 기존 `test_mock_interview_*.js` 스위트(11개) 전부 다시 돌려 회귀가 없음을
  확인했다.

**이 환경에서는 실제 Claude API 호출 성공 여부·분리 품질까지는 검증할 수 없다**
(`api.anthropic.com`으로의 아웃바운드가 이 샌드박스에서 막혀 있다는, 이 문서 다른 곳에도
반복되는 제약) — 모델이 실제로 하나의 긴 전사 안에서 화제 전환 지점을 얼마나 정확히
찾아내는지는 실사용해봐야 확인된다. 품질이 떨어지면("여러 질문이 뒤섞여 하나로
뭉뚱그려진다"거나 "엉뚱한 지점에서 쪼갠다") 5번 지시에 few-shot 예시를 더 구체적으로
추가하는 식으로 보강할 수 있다.

## `mock-interview.html` — 문항이 끝날 때마다 그 문항만 자동으로 실시간 미리 분석

사용자 질문: "모의 면접에서 질문 답변 내용을 실시간으로 전사하면서 그 분석내용도 실시간으로
작성해 나가는건 기술적으로 힘들어?" — 말하는 "도중에" 글자 단위로 계속 재분석하는 진짜
실시간은 AI 호출이 과도하게 늘어나고(비용), 아직 안 끝난 문장을 분석하다 보니 결과가 계속
뒤집히는(깜빡이는) 문제가 있어 권하지 않는다고 답했고, 대신 **"문항(녹음 구간)이 끝날
때마다 그 문항 하나만 자동으로 분석해서 바로 추가해주는"** 절충안을 제안해 "절충안으로
해줘"로 승인받아 구현했다.

- **트리거는 정확히 두 곳** — 둘 다 "이 문항의 녹음이 방금 끝났다"는 신호가 되는 지점이다:
  "다음 문항 구분(마커)" 버튼(`triggerQuestionMarker()`, 다음 문항으로 넘어가기 직전,
  방금 끝난 문항을 분석)과 "⏹ 정지" 버튼(`stopRecording()`, 지금 활성화돼 있던 문항을
  분석). 전사 칸에 직접 타이핑하는 중(`oninput`)이나 "+ 문항 추가"로 빈 문항을 새로
  만들 때는 트리거하지 않는다 — "문항이 끝났다"고 확신할 수 있는 시점이 아니기 때문이다.
- **`autoAnalyzeQuestionLive(q)`**(새 함수)가 그 문항 **하나만** `interview-report`에
  보낸다(전체 면접을 다시 보내지 않음 — 비용을 억제하는 핵심) — `teacherMemo`는 항상
  빈 문자열(실시간 미리보기는 1차 분석 단계에 해당, 선생님 의견 반영은 여전히 2단계에서만).
  문항 객체에 `q._liveAnalyzed = true`를 바로 찍어서(호출 성공/실패와 무관하게) 같은
  문항이 두 번 자동 분석되지 않게 막는다 — 전사를 나중에 손으로 고쳐도 자동으로 다시
  분석하지는 않는다(매 수정마다 호출하면 비용이 통제 불능이 되므로 — 정확한 최종 결과는
  여전히 "1단계" 버튼으로 수동 재분석하면 된다).
- **서버 응답의 `detailed[]`를 그대로 쓰지 않고 `qNum`을 클라이언트에서 다시 매긴다** —
  한 문항만 보내도 AI가 (바로 위 "자동 분리" 기능 덕분에) 그 안에서 여러 질문을 또 찾아낼
  수 있으므로, 응답마다 `qNum`이 다시 1부터 시작한다. 매번 누적 중인 `liveDetailed`
  배열 길이를 기준으로 전체 면접에서의 순번으로 다시 번호를 매기고, 그 항목이 어느 문항
  객체에서 나왔는지는 `_sourceQ`(id가 아니라 **객체 참조**)로 기록해둔다 — `deleteQuestion()`
  이 남은 문항들의 id를 1..N으로 다시 매기기 때문에(renumbering), 숫자 id로 추적하면
  삭제 후 엉뚱한 항목이 지워질 수 있어 객체 참조로 묶었다.
- **`detailedItemCardHtml(item)`**(새 함수) — 문항 하나의 피드백 카드 템플릿을
  `renderReportUI()`(정식 1/2단계 결과)와 `renderLiveDetailed()`(실시간 미리보기) 둘 다
  공유하도록 뽑아냈다 — 두 군데서 같은 마크업을 따로 유지하다 서서히 어긋나는 걸 막기
  위함. `renderLiveDetailed()`는 카드들 위에 "⏳ 실시간 미리보기예요 — ... 1단계를 누르면
  전체를 종합한 정식 분석으로 교체돼요"라는 안내 문구를 항상 덧붙여, 아직 전체를 함께
  보고 종합한 결과가 아니라는 걸 분명히 한다 — 특히 scoreLogic/scoreMajor/... 같은 전체
  점수는 의미가 없으므로(그 한 문항만 보고 매긴 점수라 왜곡될 수 있음) 실시간 미리보기는
  `detailed[]`만 쓰고 점수/강점·보완점 카드(`#score1Val` 등, `#repStrengths`/
  `#repWeaknesses`)는 전혀 건드리지 않는다 — 그 자리는 "1단계"가 실행되기 전까지 항상
  기존 placeholder("아직 분석 데이터가 없습니다...")로 남아있다.
- **`liveDisabled`**(모듈 변수, 기본 `false`) — `generateAnalysis()`("1단계: AI 답변
  분석하기") 맨 첫 줄에서 `true`로 바뀌고, 그 뒤로는 영구히 켜진 상태로 남는다("전체
  초기화"를 누르기 전까지). 이 플래그 하나로 두 가지를 동시에 막는다: (1)
  `autoAnalyzeQuestionLive()`가 더 이상 새 호출을 시작하지 않고, (2) 혹시 그 전에 이미
  날아간 호출이 뒤늦게 응답으로 돌아와도 `renderLiveDetailed()`가 `#detailedQAnalysis`를
  건드리지 않는다 — 그 영역은 이제 정식 분석(`renderReportUI`)이 유일한 주인이므로, 뒤늦은
  미리보기 응답이 정식 결과를 덮어쓰는 레이스를 막기 위함.
- **"전체 초기화"(`resetAll()`)**가 `liveDetailed = []`/`liveDisabled = false`로 되돌리고
  표시기(`#liveAnalyzeIndicator`)도 숨겨서, 다음 세션에서는 다시 실시간 미리보기가 동작한다
  (문항 객체 자체도 `defaultQuestions()`로 완전히 새로 만들어지므로 `_liveAnalyzed` 플래그도
  자연히 초기화된다).
- **UI 표시기**: "문항별 상세 피드백" 제목 옆에 `#liveAnalyzeIndicator`(작은 "⏳ 방금 끝난
  문항 실시간 분석 중…" 텍스트, 기본 숨김)가 호출이 진행 중일 때만 보였다 사라진다.
- `test_mock_interview_live_preview.js`(새 테스트, 실제 음성 인식 API 대신
  `test_mock_interview_mic_dedupe.js`가 이미 쓰던 `FakeRecognition` 스텁을 재사용해
  시작/마커/정지 버튼이 정상 동작하게 함)로 (1) 마커를 누르면 방금 끝난 문항 1개만 정확히
  서버로 보내고(`teacherMemo: ''` 포함) 그 결과가 "실시간 미리보기" 안내와 함께 바로
  렌더링되는지, (2) 정지 버튼으로 다음 문항을 끝내면 기존 카드를 지우지 않고 이어붙이며
  qNum이 1,2로 이어지는지, (3) 이미 분석된 문항은(내용 변경 없이 다시 시작/정지해도)
  중복 호출되지 않는지, (4) "1단계" 버튼을 누르면 미리보기 안내/카드가 전부 정식 분석
  결과로 완전히 교체되는지, (5) 정식 분석 이후에는 완전히 새로운 문항을 끝내도 더 이상
  미리보기 호출이 전혀 안 나가는지(단순 중복 방지가 아니라 `liveDisabled` 자체가 기능을
  영구히 끈다는 것까지 확인), (6) "전체 초기화" 후 placeholder와 표시기 숨김 상태로
  돌아오는지 — 모두 검증했다. `renderReportUI()`의 템플릿을 `detailedItemCardHtml()`로
  뽑아내는 리팩터링이 기존 동작을 깨지 않았는지도 기존 `test_mock_interview_*.js`
  스위트(12개) 전부 다시 돌려 확인했다.

**이 환경에서는 역시 실제 Claude API 호출의 성공 여부·체감 지연(문항 하나 분석에 몇 초나
걸리는지)까지는 검증할 수 없다** — `api.anthropic.com` 아웃바운드가 막혀 있다는 이 문서의
반복되는 제약. 문항 하나당 호출 자체는 `interview-report`가 이미 1개짜리 `questions`
배열도 정상 처리하도록 설계돼 있어(바로 위 "자동 분리" 기능 추가 때 이미 검증된 경로) 별도
서버 변경 없이 재사용했다 — Edge Function 재배포는 이번에 하지 않았다(버전 7 그대로).

## `mock-interview.html` — 데스크탑(1024px+)에서 2단 레이아웃: 왼쪽 작업 영역 / 오른쪽 sticky 보고서

사용자 요청: "데스크탑 버전에서는 2단 구성으로 기본정보와 녹음버튼, 문항 전사 등은
왼쪽에, 분석 결과는 오른쪽에 배치하면 어떨까." Artifact 목업으로 데스크탑/모바일 두
레이아웃을 먼저 보여주고 확인받은 뒤("근데 확인은 해야하니까 그럼 이미지로 보여줄래?" —
실제 적용 전 스크린샷으로 재확인), "일단 2단 레이아웃 적용해서 병합해봐" 요청으로
실제 파일에 반영했다.

기존 `<main>`은 폭이 `max-w-2xl`(640px 안팎)로 고정된 단일 칼럼이라, 모든 카드(지원자
정보/녹음 패널/문항 관리/1·2단계 버튼/선생님 메모/보고서)가 위에서 아래로 쭉 나열돼 있었다
— 보고서까지 보려면 화면을 한참 내려야 했고, 문항을 입력하며 동시에 분석 결과를 참고하는
것도 불가능했다.

- **`<main>` 자체를 데스크탑(`lg:` = 1024px 이상)에서만 2열 그리드로 바꿨다**
  (`lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start`, `max-w-2xl`을
  `lg:max-w-6xl`로 넓힘). 모바일/태블릿(1024px 미만)은 기존처럼 평범한 세로 흐름 —
  별도의 모바일 전용 분기 코드가 필요 없다(Tailwind의 `lg:` 접두사가 데스크탑에서만
  그리드 유틸리티를 켜고, 그 미만에서는 아무 효과가 없어 원래의 block 흐름 그대로
  유지된다).
- **왼쪽 칼럼(`#interviewLeftCol`)**: 지원자 정보 카드부터 "2단계: 최종 보고서로
  확정하기" 버튼까지, 원래 순서 그대로를 `space-y-5` div 하나로 감쌌다 — 이 안의 어떤
  엘리먼트 id/로직도 손대지 않았다(순수 래핑).
- **오른쪽 칼럼(`#interviewRightCol`)**: 기존 `#reportFrame`(인쇄 버튼이 달린 제목
  바 + `#reportContainer`)을 그대로 감쌌고, **데스크탑에서만 `lg:sticky lg:top-4`**를
  줬다 — 왼쪽에서 문항을 계속 채우며 스크롤해도 오른쪽 보고서가 화면에 계속 보인다.
  모바일에서는 `position:static`(일반 흐름)으로 왼쪽 칼럼 아래에 그대로 이어진다
  (`mt-5 lg:mt-0`으로, 원래 `space-y-5`가 주던 위쪽 간격을 모바일에서만 대체).
- **인쇄 시엔 그리드/스티키를 전부 무효화**해 보고서가 50% 폭 그리드 트랙에 갇히지
  않도록 했다 — 기존 `@media print` 블록에 `main{display:block}`,
  `#interviewLeftCol, #interviewRightCol{display:block; position:static}`을
  추가했다(왼쪽 칼럼 안의 모든 컨트롤은 이미 `no-print`로 숨겨지므로, 실제로 인쇄되는
  건 오른쪽 보고서뿐 — 그게 전체 폭을 쓰도록 하는 안전장치).
- **이 샌드박스는 `cdn.tailwindcss.com` 아웃바운드가 막혀 있어, 기존의 모든
  mock-interview.html 테스트는 실제 Tailwind CSS가 전혀 적용되지 않은 채로(기능/JS
  상태만) 통과해왔다** — 이번처럼 실제 그리드 레이아웃(나란히 배치되는지, sticky가
  적용되는지) 자체를 검증하려면 진짜 컴파일된 CSS가 필요했다. `npx tailwindcss
  --content mock-interview.html`로 이 페이지가 실제 쓰는 클래스만 스캔해 로컬에서
  CSS를 컴파일하고, 그 결과를 `<style>` 태그로 주입하는 작은 JS로 감싼 뒤
  `page.route('https://cdn.tailwindcss.com', ...)`로 막혀 있는 CDN 스크립트
  요청을 그 로컬 스탠드인으로 대체하는 방식(`test_mock_interview_2col_layout.js`)으로
  해결했다 — 실제 CDN이 서빙했을 결과와 기능적으로 동일한 CSS이므로, 이 환경의 네트워크
  제약과 무관하게 진짜 레이아웃을 검증할 수 있다. `test_mock_interview_2col_layout.js`로
  (1) 1280px(데스크탑)에서 두 칼럼이 같은 Y좌표에서 시작하고(나란히 배치) 오른쪽
  칼럼이 왼쪽 오른쪽 끝 이후에 위치하는지, 오른쪽 칼럼의 `position`이 실제로 `sticky`인지,
  (2) 390px(모바일)에서 오른쪽 칼럼이 왼쪽 칼럼 아래로 내려가고 `position`이 `static`인지,
  (3) 리팩터링이 순수 레이아웃 래핑일 뿐 기존 기능(학생 이름 입력, 분석 호출, 보고서
  렌더링)이 전부 그대로 동작하는지, (4) 인쇄 미디어에서 `main`/두 칼럼 모두
  `display:block`으로 되돌아가는지 — 네 가지 모두 확인했다. 기존 13개 테스트도 모두
  재실행해 회귀가 없음을 확인했다(이 테스트들은 CSS가 아니라 JS/DOM 상태만 검증하므로
  이번 레이아웃 변경과 무관하게 계속 통과한다).

## `mock-interview.html` — 분석 결과 저장/불러오기/목록 관리 (`interview_reports` 테이블, 이 페이지 최초의 Supabase 저장)

지금까지 `mock-interview.html`은 완전한 클라이언트 전용 도구였다 — Supabase는 AI 분석
한 번(`interview-report` Edge Function 호출)에만 쓰였을 뿐, 어떤 데이터도 저장되지
않았고 새로고침하면 전부 사라졌다. 사용자가 명시적으로 세 가지를 요청했다: "페이지 맨
위쪽 상단에 분석결과 불러오기 버튼을 만들어서 면접한 학생과 학번 지원학과 날짜를
드롭다운으로 보여주고 불러오게도 가능? 목록 관리 팝업도 만들어서 한번에 목록에서 보고
필요한거 불러오거나 삭제할 수 있어도 좋고 그럼 학생 모이면접을 진행하고 분석 결과를
만들었을 때 저장하는 버튼도 있어야겠지" — 저장(💾)/드롭다운 불러오기(📂)/목록 관리
팝업(📋) 세 기능이 함께 들어왔다.

**학번(`#studentNo`) 필드가 새로 생겼다.** "학생과 학번 지원학과 날짜를 드롭다운으로"
라는 요청 자체가 지금까지 이 페이지에 전혀 없던 필드를 새로 요구했다 — "지원자 및 면접
정보" 카드의 첫 줄을 이름/지원학과 2칸에서 이름/학번(선택)/지원학과 3칸으로 넓혔다.
저장할 때 그대로 실려 가고, 보고서 메타(`#repStudentNo`)에도 "성명: 김민수 (10203)"
식으로 성명 옆에 괄호로 붙어 나온다(값이 없으면 괄호 자체가 안 보임 — `updateReportMeta
Display(name, major, date, no)`가 세 기존 필드와 이 필드를 한 함수로 같이 갱신하도록
리팩터링됐다 — `generateAnalysis()`(새 분석)와 `applyLoadedReport()`(불러오기) 둘 다
이 함수를 거치므로 두 경로가 항상 같은 모양으로 렌더링된다).

**`interview_reports` 테이블 — 이 페이지가 처음으로 갖게 된 백엔드 저장소.** RLS는
`room-booking.html`의 익명 예약과 같은 신뢰 수준으로 `anon`/`authenticated` 둘 다에
select/insert/update/delete를 전부 열어뒀다 — 이 페이지는 로그인 자체가 없고
(`admin-tools.html`/`korean-inquiry.html`처럼 교무 업무 도구 허브를 거쳐서만 닿는
교사 내부 도구), 비밀번호 같은 소유권 증명 개념을 요구할 명분도 없어서(요청에도 없었고,
이 페이지엔 애초에 "사용자"라는 개념이 전혀 없다) 그냥 완전히 열어둔 테이블로
만들었다 — `room_bookings`의 익명 insert가 `password_hash` 보호를 받는 것과 달리,
이 테이블은 그 보호조차 없는 더 단순한 모델이다. 컬럼: `student_name`/`student_no`/
`target_major`/`interview_date`/`supervising_teacher`/`teacher_memo`(전부 nullable
text — 기존 필드들이 전부 빈 채로도 저장을 허용하던 것과 같은 느슨함), `questions`
(jsonb, `{id,title,questionText,transcript,startTime,endTime}` 배열 — `_liveAnalyzed`
같은 내부 플래그는 저장 시 걷어내고 저장), `report`(jsonb, `renderReportUI(data)`가
마지막으로 그린 원본 AI 결과 객체 그대로 — `scoreLogic`/`strengths`/`detailed` 등
모든 필드를 그대로 들고 있어 불러올 때 같은 함수에 그대로 다시 넘기면 똑같이
재현된다), `is_finalized`(boolean), `created_at`/`updated_at`.

**`sb`(Supabase client) 생성은 `try/catch`로 감싸져 있다.** `supabase-js`는 CDN
`<script>` 태그로 로드되므로, 그 요청이 느리거나 막히거나 CDN이 잠깐 다운되면
`window.supabase`가 이 인라인 스크립트가 실행되는 시점에 아직 `undefined`일 수 있다 —
감싸지 않으면 `.createClient()` 호출이 그대로 던져서 이 페이지의 **전체** 인라인
`<script>` 블록이 거기서 멈춰버린다(그 아래 `DOMContentLoaded`/`renderTabs()` 등
저장 기능과 전혀 무관한 녹음·분석 기능까지 전부 도미노로 죽는다 — 실제로 이 테스트
작성 중 "문항 탭이 아예 안 뜬다"는 완전히 무관해 보이는 증상으로 처음 발견했다).
`sb`가 `null`로 남는 경우를 대비해 `saveReport()`/`fetchSavedReports()`/
`deleteReport()`/`loadReportById()` 전부 맨 앞에서 `sb` 존재를 확인하고, 없으면
"네트워크 연결을 확인한 뒤 새로고침해주세요" 안내로 조용히 실패한다 — 저장/불러오기만
못 쓰게 될 뿐, 녹음·AI 분석·인쇄 등 이 페이지의 나머지 기능은 전혀 영향받지 않는다.

**`lastReportData`(모듈 변수) — `renderReportUI(data)` 맨 첫 줄에서 항상 캡처된다.**
이 페이지는 AI 결과를 화면에 그리자마자 버리는 구조였어서(`generateAnalysis()`/
`finalizeReport()`/`runLocalSimulation()`/`applyLoadedReport()`/실시간 미리보기 모두
결국 `renderReportUI()` 하나를 거쳐 DOM에 페인트할 뿐, 그 원본 객체를 들고 있는 변수가
없었다), 저장 기능을 만들려면 그 원본을 어딘가에 붙잡아둬야 했다 — `renderReportUI()`
자체에 `lastReportData = data;` 한 줄을 추가해, 이 함수를 거치는 모든 경로가 자동으로
"저장 가능한 최신 보고서"를 갖추게 했다(별도로 호출부마다 캡처 코드를 추가할 필요가
없었다).

**`currentReportId`(모듈 변수) — "이 세션이 이미 저장된 행과 연결돼 있는지"를 추적한다.**
`null`이면 아직 이번 세션에서 저장한 적이 없다는 뜻이고, 💾 저장을 누르면:
- `currentReportId`가 없으면 `insert` 후 돌아온 id를 저장해 연결을 새로 맺는다.
- 있으면 그 id로 `update` — 같은 세션에서 몇 번을 다시 눌러도(예: 선생님 의견을
  입력하고 2단계를 다시 확정한 뒤 또 저장) 행이 계속 쌓이지 않고 하나로 갱신된다.

이 연결은 세 지점에서 끊긴다(= `currentReportId = null`로 되돌림): "🔄 전체 초기화"
(완전히 새 세션), "⚡ 샘플 채우기"(아직 분석 전인 별개의 데모 데이터이므로 혹시
이전에 불러온/저장된 행이 있었다면 그 연결을 끊어, 샘플을 저장하려 할 때 실수로 옛
진짜 기록을 덮어쓰지 않게 함), 그리고 "📋 목록 관리"에서 지금 연결된 바로 그 행을
삭제한 경우(삭제된 행을 계속 가리키고 있으면 다음 저장이 존재하지 않는 행을 `update`
하려는 허공 쓰기가 되므로, 삭제 시 `currentReportId === id`면 바로 끊는다 — 다음
저장은 새 `insert`로 떨어진다).

**📂 불러오기 — 헤더의 작은 드롭다운 패널.** 헤더 우측 아이콘 버튼 묶음(샘플 채우기/
전체 초기화가 이미 있던 자리)에 💾/📂/📋 세 개를 더해 5개를 `grid grid-cols-3`로
2줄에 나눠 배치했다(5개를 세로로 쭉 쌓던 기존 `flex-col`은 너무 길어져서). 📂를
누르면 `#loadPanel`(헤더 버튼 묶음을 감싸는 `relative` 컨테이너 기준
`absolute right-0 top-full`)이 열리고, `fetchSavedReports()`(한 쿼리로 목록용
가벼운 컬럼만 — `student_name`/`student_no`/`target_major`/`interview_date`/
`is_finalized`/`updated_at`, `report`/`questions`/`teacher_memo` 같은 무거운 jsonb는
목록에선 안 읽음, `updated_at` 내림차순)가 돌려주는 행들로 `<select>`를 채운다 —
`reportRowLabel(row)`가 "이름 (학번) · 전공 · 날짜 · 최종" 형식의 한 줄 레이블을
만들고(어느 필드가 비어있든 그 부분만 조용히 빠짐), 📋 목록 관리 쪽에서도 같은 함수를
재사용한다. "불러오기"를 누르면 선택된 id로 `loadReportById()` → `applyLoadedReport()`
를 호출한다.

**📋 목록 관리 — `#manageModalOverlay` 모달.** `<main>` 바깥(body 최하단, 다른
고정 오버레이들과 같은 자리)에 둔 `fixed inset-0 bg-black/40` 오버레이 + 가운데
카드. 각 행에 이름(학번)/전공·날짜·최종표시 + "불러오기"/"삭제" 두 버튼. "삭제"는
`confirm()` 확인 후 바로 `delete` 요청을 보내고 같은 목록을 다시 그린다(목록 자체가
새로고침되므로 별도 "방금 지운 행 숨기기" 로직이 필요 없음). 바깥(오버레이 자신)을
클릭하면 닫힌다(`onclick="if(event.target===this) closeManageModal()"` — 이 저장소의
다른 모달들과 같은 패턴).

**`applyLoadedReport(row)` — 불러오기의 핵심.** 학생 정보 입력칸 5개 + 문항 배열
(`questions`, 각 필드를 기본값으로 방어적으로 채워 복원) + `currentTabId`/
`currentTextBuffer`를 전부 되돌리고, `liveDisabled = true`로 실시간 미리보기 기능을
영구히 꺼둔다(이미 끝난 분석을 불러온 세션이므로, 그 뒤 녹음을 더 하더라도 미리보기가
끼어들어 이미 로드된 정식 보고서를 건드리면 안 된다 — "1단계" 버튼을 누른 뒤와 똑같은
상태로 취급). `row.report`가 있으면 `renderReportUI(row.report)`를 그대로 호출해
보고서를 재현하고(이 한 호출이 `lastReportData`도 함께 갱신해줌), 없으면(이론상 거의
없는 경우 — 저장은 `hasDraftAnalysis`가 참일 때만 허용되고 그 시점엔 이미
`lastReportData`가 채워져 있어야 하지만, 혹시라도 비어있던 채로 저장된 행을 위한
안전망) 점수/강점/보완점/상세 피드백을 전부 placeholder로 되돌린다. 마지막에
`hasDraftAnalysis = true`, `isFinalized = !!row.is_finalized`, 저장 버튼 재활성화,
`currentReportId = row.id`로 연결을 맺는다.

**"저장" 버튼은 1단계 분석이 끝나기 전까지 비활성 상태다.** `setSaveButtonEnabled
(enabled)`가 `disabled`+`opacity-40`/`cursor-not-allowed`를 토글한다 — `generateAnalysis()`
가 1단계를 마친 직후, `applyLoadedReport()`가 불러오기를 마친 직후에 활성화되고,
`resetAll()`/`loadSampleData()`에서 다시 비활성화된다("분석 결과를 만들었을 때 저장
버튼이 있어야겠지"라는 요청 그대로 — 아직 아무 분석도 없는 빈 세션에서는 저장할 게
없으므로 버튼 자체가 눌리지 않는다).

**테스트는 이 샌드박스의 두 번째 CDN 차단을 새로 넘어야 했다.** `cdn.tailwindcss.com`
(이미 `test_mock_interview_2col_layout.js`에서 겪은 것)뿐 아니라, 이번에 새로 추가한
`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js`도
같은 터널 차단에 걸려 `window.supabase`가 `undefined`로 남고, 그 상태에서
`window.supabase.createClient(...)`를 호출하는 순간 전체 인라인 `<script>` 블록이
`TypeError`로 멈춰버린다(DOMContentLoaded 리스너를 포함해 그 뒤 모든 코드가 전혀
실행되지 않음 — "문항 탭이 안 뜬다"처럼 완전히 무관해 보이는 증상으로 나타났다).
`korean-inquiry.html` 테스트들이 이미 로컬에 받아둔 `@supabase/supabase-js`의 UMD
번들(`scratchpad/testlibs/node_modules/@supabase/supabase-js/dist/umd/supabase.js`)을
`page.route()`로 그 CDN URL 대신 서빙해 해결했다 — 앞으로 Supabase를 쓰는 페이지를
이 샌드박스에서 Playwright로 테스트할 때는 이 로컬 번들을 재사용할 것(매번 새로
`npm install`할 필요 없음). `test_mock_interview_save_load.js`로 (1) 저장 버튼이
분석 전엔 비활성, 1단계 직후 활성화되는지, (2) 보고서 메타에 학번이 "(10203)" 형식으로
붙는지, (3) 첫 저장은 insert(학생정보/학번/문항/원본 report 객체/is_finalized가
정확히 실림), (4) 같은 세션에서 다시 저장하면 update(행 1개 유지, 중복 insert 없음),
(5) 📂 드롭다운이 이름/학번/전공을 담은 레이블로 그 행을 보여주고 토글로 열고 닫히는지,
(6) 전체 초기화 후 학번 칸이 비워지고 저장 버튼이 다시 비활성화되는지, (7) 📂로 불러오면
입력칸/전사/보고서(종합 등급 포함)가 저장된 그대로 복원되고 저장 버튼이 재활성화되며
이후 저장은 그 행을 update하는지, (8) 📋 목록 관리에 그 행이 보이고 "삭제"를 누르면
실제로 지워지고 목록이 빈 상태로 바뀌며, 오버레이 자신을 클릭하면 닫히는지, (9) 현재
연결된 행이 목록 관리에서 삭제된 뒤 저장을 누르면 허공에 update하는 대신 새 insert가
나가는지, (10) 샘플 채우기가 이전 연결을 끊어 저장 버튼을 다시 비활성화하면서도 학번
칸은 채워주는지 — 모두 확인했다. 기존 `test_mock_interview_*.js`(2단 레이아웃 포함)도
전부 재실행해 회귀가 없음을 확인했다.

## `mock-interview.html` — Safari에서 마이크 권한 창이 계속 뜨는 버그 (onend 자동 재시작 루프 가드)

실사용 중 다른 선생님이 보고: "마이크 사용 권한을 묻는 창이 계속 나와." 바로 전에
사용자가 "모의면접 마이크는 사파리에서는 사용할 수 없어?"라고 물어서 Safari도
`webkitSpeechRecognition`을 지원한다고 답했던 직후 들어온 보고라, Safari 특유의
연속 인식(continuous) 동작 차이가 원인일 가능성이 높다고 보고 코드를 다시 읽었다.

**원인(가설, 이 환경에선 실제 Safari로 재현·확인 불가)**: `recognition.onend`에
이미 있던 자동 재시작 로직(브라우저가 `continuous:true`인데도 인식 세션을 스스로
끝내버리면, 300ms 뒤 `recognition.start()`를 다시 호출해 이어 붙이는 것 —
Chrome의 "가끔 혼자 끝내버림" 동작에 대응하려고 만들어둔 것)이 핵심 용의자다.
Safari는 Chrome보다 훨씬 자주, 적극적으로 연속 인식 세션을 스스로 끝내고, WebKit은
마이크를 쓰는 API를 "사용자 동작(user gesture)" 맥락에 강하게 묶는다 —
`setTimeout` 콜백 안에서 호출하는 `recognition.start()`는 진짜 클릭이 아니므로
사용자 동작으로 인정되지 않을 수 있고, 이 경우 Safari가 그 자동 재시작마다 네이티브
권한 창을 다시 띄울 수 있다. 선생님이 그 창을 못 보거나 결정을 안 내리면 세션이 거의
바로 다시 끝나면서 `onend`가 또 발생 → 또 재시작 → 또 권한 창... 이렇게 끝없이
반복되는 루프가 "창이 계속 나와"라는 증상과 정확히 일치한다.

**고쳐서**: 근본 원인이 정확히 Safari의 어떤 동작 때문인지 이 환경에서 직접 검증할
방법이 없으므로(실제 Safari 브라우저도, `webkitSpeechRecognition`이 뜨는 네이티브
권한 UI도 이 샌드박스에서는 재현 불가), 원인이 무엇이든 "같은 창이 끝없이 반복해서
뜨는" 증상 자체를 구조적으로 막는 방어적 가드를 추가했다 — `recentAutoRestartCount`/
`lastAutoRestartAt` 두 모듈 변수가 `onend`에서 자동 재시작이 일어날 때마다 직전
재시작과의 간격을 잰다: 6초 이내에 연속으로 일어나면 카운트를 올리고, 그보다
오래 걸렸으면(정상적인 긴 침묵/일시정지로 세션이 끝난 평범한 경우) 1로 리셋한다.
**이 카운트가 3을 넘으면**(6초 안에 4번째 재시작이 필요해진 순간) 더 이상 재시도하지
않고 `stopRecording()`을 직접 호출해 녹음을 완전히 멈추고, "마이크가 반복적으로
끊겨서 녹음을 멈췄어요. 권한 창이 계속 뜬다면 '허용'을 선택한 뒤 '면접 녹음 시작'을
다시 눌러주세요."라는 안내를 보여준다 — 그 뒤 선생님이 다시 누르는 "면접 녹음 시작"
클릭은 진짜 사용자 동작이므로, Safari에서도 권한이 다시 정상적으로 동작할 가능성이
높다. `recognition.onresult`가 실제 전사 텍스트를 받으면(=그 세션이 정상적으로
동작하고 있다는 증거) `recentAutoRestartCount`를 즉시 0으로 리셋한다 — 초반에 살짝
불안정했던 세션이 이후 멀쩡하게 동작하면 그 불안정했던 기록이 나중의 정상적인
긴 면접 진행에 불리하게 작용하지 않는다. `startRecording()`(선생님이 직접 "면접
녹음 시작"을 눌렀을 때)도 두 변수를 0으로 리셋해, 매번 새로 시작하는 세션은 항상
깨끗한 상태에서 출발한다.

**이 수정도 실제 Safari에서 효과가 있는지는 직접 검증하지 못했다** — 이 환경에는
Safari/WebKit도, 실제 마이크 권한 네이티브 UI도 없다. 다만 가드 자체는 브라우저나
원인과 무관하게 "짧은 시간 안에 반복적으로 재시작을 시도하는 상태"를 멈추고 사람에게
분명한 안내+수동 재시작 경로를 주는 범용적인 방어 장치라, Safari의 정확한 내부 동작을
몰라도 증상 자체는 해결될 것으로 판단했다. `test_mock_interview_restart_loop_guard.js`
(`FakeRecognition` 스텁으로 `onend()`를 수동으로 여러 번 발생시켜 재현)로 (1) 6초
이내에 4번째 재시작이 필요해지면 그 전까지 정확히 3번만 재시작하고 그 이후엔 멈춰서
"반복적으로 끊겨서"/"권한 창" 문구를 보여주는지, 멈춘 뒤엔 추가 재시작이 전혀
안 일어나는지, (2) 6초 이상 간격을 둔 재시작은(평범한 긴 침묵) 아무리 반복돼도
가드가 절대 작동하지 않는지, (3) 진짜 전사 텍스트가 들어오면 카운트가 리셋돼,
이후 다시 2번 연속 재시작해도(바로 전에 이미 2번 썼더라도) 가드가 작동하지 않는지
— 모두 확인했다. 기존 `test_mock_interview_*.js` 전체(2단 레이아웃/저장·불러오기
포함)를 다시 돌려 회귀가 없음을 확인했다 — `test_mock_interview_two_stage.js` 하나만
여전히 실패하는데, HEAD(이 수정 전 커밋)에서도 동일하게 실패함을 직접 대조 확인했다
— `test_mock_interview_edgecases.js`/`test_mock_interview_smoke.js`와 같은 기존
문서화된 한계(아이콘 전용 "샘플 채우기" 버튼이 `title` 속성에만 라벨을 갖고 있어
`button:has-text(...)` 셀렉터가 못 찾음)이지, 이번 수정이 만든 회귀가 아니다.

## `mock-interview.html` — 페이지 맨 위에 "불러오기 메뉴", 맨 아래에 "저장" 버튼 추가 + 분석 중 "AI 생성 중" 밝기 펄스 효과

사용자가 와이어프레임 스크린샷을 보여주며 "이렇게 배치하면 어떨까 싶고, 맨 아래
쪽에는 저장 버튼 추가, 맨 위쪽에는 불러오기 메뉴 추가"라고 요청했다. 이미지의
2단 레이아웃(왼쪽 기본정보·녹음·문항 전사, 오른쪽 보고서+1단계/2단계 버튼)은 바로
위 두 섹션에서 이미 구현한 구조와 거의 그대로 일치했으므로 손대지 않았고, 실제로
빠져 있던 건 저장/불러오기를 **헤더의 작은 아이콘 뒤에 숨기지 않고 페이지 맨
위/맨 아래에 눈에 잘 보이는 자리로도** 두는 것이었다.

**기존 💾/📂/📋 헤더 아이콘은 그대로 남겨뒀다** — 요청이 "추가"였을 뿐 "교체"가
아니었고, 이미 그 세 아이콘이 `saveReport()`/`fetchSavedReports()`/
`loadReportById()`/`openManageModal()` 전체 로직을 쥐고 있어서, 새 UI는 같은 함수를
재사용하는 **두 번째 입구**로만 추가했다:

- **맨 위 "불러오기 메뉴"**: `<header>`와 `<main>` 사이에 전체 폭 바(`#topLoadSelect`
  `<select>` + "불러오기"/"목록 관리" 버튼)를 새로 넣었다 — 헤더의 📂 아이콘처럼
  클릭해서 패널을 펼쳐야 하는 게 아니라, 페이지에 들어오는 순간부터 드롭다운+버튼이
  그대로 보인다. `refreshTopLoadSelect()`(새 함수, `openLoadPanel()`의 populate
  로직과 거의 같은 모양)가 `DOMContentLoaded`에서 한 번, 저장 성공 후
  (`saveReport()`)와 삭제 성공 후(`deleteReport()`) 다시 호출돼 항상 최신 목록을
  보여준다. "불러오기" 버튼(`confirmLoadFromTop()`)은 아무것도 안 고르면
  `alert()`로 선택을 요구하고, 고르면 기존 `loadReportById()`를 그대로 호출한다 —
  새로운 저장/조회 로직은 전혀 만들지 않았다. `applyLoadedReport()` 끝에서 이
  드롭다운의 선택값도 방금 불러온 행의 id로 맞춰준다(그 옵션이 아직 목록에 없으면
  조용히 건너뜀).
- **맨 아래 "저장" 버튼**: `</main>` 바로 다음, 양쪽 칼럼이 다 끝난 자리에 전체
  폭의 큰 버튼(`#btnSaveReportBottom`)을 추가했다 — 클릭하면 헤더 아이콘과 똑같이
  `saveReport()`를 호출한다. `setSaveButtonEnabled(enabled)`가 이제 헤더 아이콘과
  이 버튼 **둘 다** 같은 활성/비활성 상태로 묶어서 토글하므로, 1단계 분석 전에는
  둘 다 비활성, 분석이 끝나면 둘 다 눌릴 수 있게 된다. `saveReport()`도 저장
  진행/성공/실패 피드백을 `#saveBtnBottomText`에도 같이 반영한다(헤더 아이콘은
  체크마크로 1.5초간 바뀌는 기존 방식 그대로, 바텀 버튼은 "저장 중…"/"✓
  저장했어요" 텍스트로).

**추가로, 대화 중 사용자가 같은 메시지 안에 다른 요청을 끼워 넣었다**: "분석 중일
때 분석 결과가 나오는 부분에 ai 이미지 생성할 때 보면 약간 밝기가 변하면서 생성
중임을 보여주는 모양 있잖아. 그런 효과를 넣으면 어떨까 그럼 분석중이구나 하고
기다릴거 같은데" — 이미지 생성 AI가 흔히 보여주는 "밝기가 오르내리며 생성 중임을
알려주는" 느낌을, 결과가 그려지는 영역 자체에 입혀달라는 요청.

- `<style>`에 `@keyframes aiGenPulse`(opacity 1↔0.55, `filter: brightness(1↔1.3)`를
  1.3초 주기로 반복)와 `.ai-generating` 클래스를 추가했다 — 인쇄 시에는
  `@media print`에서 애니메이션/필터를 전부 무효화해 인쇄물에 깜빡이던 상태가
  얼어붙은 채로 찍히는 일이 없게 했다.
- "핵심 평가 영역별 분석"(`#scoreAnalysisBlock`), "주요 강점/보완할 점"
  (`#strengthsWeaknessesBlock`), "문항별 상세 피드백"(`#detailedSectionBlock`) 세
  블록에 각각 id를 새로 달고, `setReportGenerating(active, ids)`(새 함수, `ids`
  생략 시 세 블록 전부) 하나로 `.ai-generating` 클래스를 켜고 끈다.
- **정식 1·2단계 분석**(`generateAnalysis()`/`finalizeReport()`의 실제 AI 호출
  분기)은 `callInterviewReportApi()`를 `await`하는 동안 세 블록 전부를 펄스시킨다
  — 응답이 와서 `renderReportUI()`가 그리든, 실패해서 `runLocalSimulation()`으로
  대체되든 `finally`에서 항상 꺼진다. 2단계의 "의견 없이 바로 확정" 분기(네트워크
  호출 자체가 없는 경로)는 펄스를 켜지 않는다 — 기다릴 게 없는 즉시 처리이기
  때문이다.
- **문항이 끝날 때마다의 실시간 미리보기**(`autoAnalyzeQuestionLive()`)는
  "문항별 상세 피드백" 블록 하나만 펄스시킨다(`setReportGenerating(true,
  ['detailedSectionBlock'])`) — 이 미리보기는 점수/강점·보완점을 전혀 건드리지
  않으므로 그 두 블록까지 깜빡일 이유가 없다.
- `resetReportUI()`(전체 초기화 경로)에도 `setReportGenerating(false)`를 넣어,
  혹시 분석이 진행 중인 상태에서 "전체 초기화"를 눌러도 펄스가 영구히 켜진 채로
  남지 않게 하는 안전망을 뒀다.

**검증**: 이 환경은 `cdn.tailwindcss.com`/`cdn.jsdelivr.net`(실제 Claude API
호출을 거치는 `*.supabase.co`도 포함) 아웃바운드가 막혀 있다는 이 문서의 반복되는
제약이 이번에도 그대로 적용돼, `npx tailwindcss`로 이 페이지가 실제 쓰는 클래스
전부를 다시 스캔해 로컬에서 컴파일한 CSS를 `page.route()`로 CDN 요청 대신
주입하고, 기존에 로컬에 받아둔 `@supabase/supabase-js` UMD 번들을 재사용해
Supabase REST(`interview_reports`)와 `interview-report` Edge Function 호출을
모두 모킹하는 방식(`scratchpad/test_mock_interview_top_bottom_save_load.js`)으로
테스트했다. (1) 맨 위 불러오기 바가 `<header>`와 `<main>` 사이(DOM 순서상
`<main>`보다 앞)에 있고 로드 즉시 저장된 목록으로 채워지는지, (2) 맨 아래 저장
버튼이 `</main>` 뒤(DOM 순서상 `<main>`보다 뒤)에 있고 분석 전에는 비활성인지,
(3) 1단계 분석을 Edge Function 응답이 돌아오기 전까지 지연시켜 그 사이
세 블록 모두 `.ai-generating`이 걸려있는지, 응답이 오면 즉시 풀리는지, 헤더
아이콘과 바텀 버튼이 함께 활성화되는지, (4) 바텀 버튼으로 저장하면 헤더 아이콘과
똑같은 insert 호출이 나가고 버튼 텍스트에 저장 확인 문구가 뜨는지, (5) 맨 위
드롭다운에서 아무것도 안 고르고 "불러오기"를 누르면 선택을 요구하는 alert가
뜨는지, (6) 드롭다운에서 저장된 항목을 고르고 불러오면 학생 이름 등 필드가
실제로 채워지는지 — 모두 확인했다. 이 세션의 스크래치패드에는 이전 세션들이
작성했던 `test_mock_interview_*.js` 전체(2단 레이아웃, 저장/불러오기, 재시작 루프
가드 등)가 남아있지 않아 직접 재실행해 회귀를 확인하지는 못했다 — 다만 이번 변경은
기존 id/함수를 전부 그대로 둔 채 새 id(`topLoadSelect`/`btnSaveReportBottom`/
`scoreAnalysisBlock`/`strengthsWeaknessesBlock`/`detailedSectionBlock`)와 새
함수(`refreshTopLoadSelect`/`confirmLoadFromTop`/`setReportGenerating`)만
추가하고, 기존 함수는 호출 지점에 한두 줄을 끼워 넣는 선에서만 수정했으므로(중복
id 없음을 직접 확인) 기존 동작을 깨뜨릴 위험은 낮다고 판단했다.

## `mock-interview.html` — "최종 보고서로 확정하기" 버튼도 맨 아래로 + AI 생성 중 효과를 배경색 펄스로

사용자 요청: "최종 보고서로 확정하기 버튼도 맨 아래로. 그리고 분석중에 밝기 변하는 효과는
글씨에 말고 배경색에 주면 어떨까." 두 가지 모두 바로 앞 섹션에서 만든 기능을 다듭는
후속 조정이다.

**① "2단계: 최종 보고서로 확정하기"(`#btnFinalize`) 버튼을 왼쪽 칼럼(교사 메모 카드
바로 아래)에서 `</main>` 다음, "분석 결과 저장하기" 버튼 바로 위로 옮겼다.** id/
`onclick="finalizeReport()"`/스타일 클래스 전부 그대로 가져왔을 뿐 — 작업 흐름상
"확정 → 저장"이 자연스러운 순서라 확정 버튼을 저장 버튼 위에 두고,
`<div class="... space-y-3">` 하나로 두 버튼을 감싸 세로로 쌓았다. `btnFinalize`를
활성/비활성화하는 기존 로직(`setStageControlsEnabled()`, `generateAnalysis()` 완료 시
`disabled`를 푸는 코드)은 전부 `getElementById('btnFinalize')`로 id만 참조하므로,
위치가 바뀌어도 아무 JS 변경 없이 그대로 동작한다. 왼쪽 칼럼은 이제 지원자 정보 →
녹음 패널 → 문항 관리 → "1단계: AI 답변 분석하기" 버튼 → `#stageStatusMsg` → 교사
메모 카드로 끝나고, 확정/저장 두 버튼은 화면 가장 아래, 양쪽 칼럼이 다 끝난 자리에
나란히 모여있다.

**② AI 생성 중 펄스 효과를 opacity/filter(글씨까지 함께 흐려짐) 대신
background-color만 펄스하도록 바꿨다.** 바로 전 섹션에서 추가한 `@keyframes
aiGenPulse`는 `opacity: 1↔0.55`+`filter: brightness(1↔1.3)`로 블록 **전체**(안의
텍스트 포함)를 함께 흐리게 했는데, 사용자가 "글씨에 말고 배경색에" 효과를 달라고
정정했다 — 분석 결과 텍스트 자체는 항상 선명하게 유지하고, 그 뒤에 깔린 배경만
옅은 보라(`rgba(99,102,241,0.08)`)와 더 짙은 보라(`rgba(99,102,241,0.22)`) 사이를
오가도록 바꿨다. `.ai-generating`에 `border-radius:12px`와 `margin:-10px;
padding:10px`(서로 상쇄)를 추가해, 펄스가 꺼져 있을 때(마진/패딩 자체는 항상
적용돼 있지만 배경이 투명해 안 보일 때)와 비교해 켜졌을 때 주변 레이아웃이 밀리지
않으면서도 색칠된 영역이 내용보다 살짝 여유 있게 보이도록 했다. 인쇄 시엔
`background-color: transparent`와 `margin/padding: 0`으로 전부 되돌린다.

`test_mock_interview_bottom_finalize_bg_pulse.js`(스크래치패드 전용)로 (1)
`#btnFinalize`가 더 이상 `<main>` 안에 없고 `</main>` 뒤, `#btnSaveReportBottom`보다
앞에 오는지, `#interviewLeftCol`에도 더 이상 없는지, (2) 여전히 분석 전엔 비활성
상태로 시작하는지, (3) 1단계 진행 중 `#scoreAnalysisBlock`의 computed style이
`animation-name: aiGenPulse`이면서 `opacity:1`/`filter:none`을 유지하고
`background-color`가 투명이 아니며, 650ms 뒤 그 값이 실제로 바뀌는지(진짜로
펄스하는지, 고정된 틴트가 아님을 확인), 분석이 끝나면 `.ai-generating` 클래스가
사라지는지, (4) 1단계 완료 후 바닥의 확정 버튼이 활성화되고, 거기서 클릭하면
메모 없이 즉시 확정되는지 — 모두 확인했다. 기존
`test_mock_interview_top_bottom_save_load.js`도 다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — 녹음 패널과 "문항별 답변 및 전사 관리" 사이에 "예시 질문" 접이식 패널 + AI 생성 중 효과를 그라데이션 셔터 스윕으로

사용자가 "문항별 답변 및 전사 관리" 영역을 손으로 동그라미 친 스크린샷과 함께 "이 부분에
펼치고 접고 할 수 있는 기능으로 예시 질문을 넣을까하는데 질문 10개만 추천해줘"라고 요청했다
— 지원동기/전공적합성/인성/탐구경험을 고르게 섞은 대입 면접 일반 기출 10개를 먼저 추천하고
승인받은 뒤, "전사된 질문 답변 위에 접고 펼치게 넣어줘. '예시 질문' 하고 펼치기/접기 버튼
넣어주고 접었을때는 제목만 보이게"로 구체적인 배치를 지정받아 구현했다 — **처음엔 각 문항
패널(`renderQuestionContent(id)`) 안, 전사 텍스트 칸 바로 위에 넣었는데**, 실제로 배포된
화면을 다시 손으로 동그라미 쳐 보여주며 "예시 질문은 빨간색 네모친부분에 넣고 싶었어"라고
정정받았다 — 그 네모는 녹음 패널(짙은 남색, "면접 녹음 시작"/"다음 문항 구분") **바로
아래, "문항별 답변 및 전사 관리" 카드가 시작되기 전의 빈 공간**을 가리키고 있었다. 즉
문항마다 반복되는 패널이 아니라, 페이지에 한 번만 있는 독립 카드를 원한 것이었다.

- **`SAMPLE_QUESTIONS`**(새 상수, `escapeHtml()` 바로 아래) — 10개의 일반 대입 면접
  예시 질문을 담은 평문 배열. **최종 위치는 녹음 패널(`<!-- Recording & Marker Control
  Panel -->`)과 "문항별 답변 및 전사 관리" 카드 사이, 페이지에 단 하나만 있는 독립
  카드다** — `id="sampleQBody"`/`id="sampleQToggleIcon"`/`id="sampleQList"` 모두
  고정 id(문항별로 `q.id`를 붙이는 접미사 없음)이고, `toggleSampleQuestions()`도
  인자 없이 그 고정 id들만 토글한다. 목록 자체(`<ul id="sampleQList">`)는 비워둔
  채 마크업에 박혀 있다가, `DOMContentLoaded` 핸들러 맨 끝에서 `SAMPLE_QUESTIONS
  .map(s => `<li>${escapeHtml(s)}</li>`).join('')`로 딱 한 번 채워진다 — 문항 탭을
  전환하거나 "+ 문항 추가"를 눌러도 `renderQuestionContent()`가 다시 그리는 범위
  밖(그 함수는 `#questionContents`만 건드림)이라 전혀 영향받지 않는다. 기본 상태는
  **접힘**(`class="hidden"` — 버튼 제목만 보이고 목록은 전혀 렌더링되지 않음,
  `offsetParent === null`로 확인), 클릭하면 `hidden` 클래스가 빠지며 10개 질문이
  전부 펼쳐지고, 다시 클릭하면 다시 접힌다. `escapeHtml()`을 거치는 이유는 이
  리스트 항목들이 사용자가 타이핑하는 데이터가 아니라 고정 상수 문자열이라 실제로는
  불필요하지만, 이 페이지의 다른 모든 동적 리스트 렌더링(`keywordTagsHtml` 등)과
  같은 관행을 그대로 따른 것이다. "참고 질문" 입력칸 자체는 과거에 이미 완전히
  제거됐으므로(이 페이지는 질문+답변이 하나의 연속 전사로 함께 녹음되는 설계 — 위
  "참고 질문 입력칸 제거" 섹션 참고), 이 "예시 질문" 패널은 그 입력칸을 되살리는
  게 아니라 순수하게 교사가 면접 전 참고할 질문 아이디어를 보여주는 읽기 전용
  참고 자료다 — 클릭해서 무언가를 채워 넣는 기능은 없다.

- **AI 생성 중 효과를 "배경색이 단색으로 밝아졌다 어두워지는" 펄스에서, "비스듬한
  보랏빛 띠가 블록 전체를 좌우로 쓸고 지나가는" 그라데이션 셔터로 바꿨다.** 바로
  이전 세션에서 "분석중에 밝기 변하는 효과는 글씨에 말고 배경색에"라는 요청으로
  `@keyframes aiGenPulse`를 `background-color` 두 값 사이를 오가는 단색 토글로
  구현했었는데, 사용자가 이미지 생성 AI UI(스크린샷의 "이미지에 잘 어울리게 만드는
  중…" + 반짝이는 별 아이콘, 전체 영역이 옅게 흐려지며 빛나는 느낌)를 가리키며
  "분석중에 깜빡거리는건 이부분의 전체 색깔이 그라데이션처럼 밝기 변화가 있는 걸
  의미한거야"라고 정정해줬다 — 단색이 통째로 밝아졌다 어두워지는 것과, 그라데이션
  띠가 쓸고 지나가며 밝기가 오르내리는 것은 시각적으로 다르다는 지적이었다. **고쳐서**
  `.ai-generating`의 `background-color` 단색 펄스를 `background-image: linear-gradient
  (100deg, ...)`(옅은 보라 → 짙은 보라(0.42 알파) → 옅은 보라, 폭 260%)로 바꾸고,
  `@keyframes aiGenPulse`가 `background-color`가 아니라 `background-position`을
  `200% 0` → `-200% 0`으로 선형 애니메이션(`1.8s linear infinite`)시켜 그 그라데이션
  띠가 블록을 가로질러 반복적으로 쓸고 지나가게 했다 — 띠가 지나가는 자리만 순간
  밝고 나머지는 옅은 상태를 유지하는 전형적인 shimmer(스켈레톤 로딩) 질감이다.
  `background-color` 자체는 이제 전혀 설정하지 않는다(완전 투명, 색은 그라데이션
  하나가 전담). 글씨는 이전과 마찬가지로 `opacity:1`/`filter:none`을 항상 유지해
  읽기 불편한 깜빡임이 전혀 없다 — "배경에만, 글씨에는 말고"라는 그 전 요청의
  전제는 그대로 지켜졌고, 이번 수정은 그 배경 효과의 "모양"만 단색 토글에서
  그라데이션 스윕으로 바뀐 것이다. 인쇄 시엔 `background-image: none`으로 되돌린다
  (기존 `@media print` 블록의 `background-color: transparent` 자리를 교체).
- `test_mock_interview_shimmer_pulse.js`(스크래치패드 전용)로 (1) 블록이 여전히
  `aiGenPulse` 애니메이션을 타는지, (2) 글씨는 `opacity:1`/`filter:none`을 유지하는지,
  (3) 효과가 `background-image`(그라데이션)로 구현돼 있는지, (3b) `background-color`는
  설정돼 있지 않은지(완전 투명 — 그라데이션 하나가 색을 전담한다는 것 확인), (4) 900ms
  뒤 `background-position` 값이 실제로 달라지는지(고정된 틴트가 아니라 진짜로 쓸고
  지나가는지), (5) 분석이 끝나면 클래스가 빠지고 효과가 멈추는지 — 모두 확인했다.
  기존 `test_mock_interview_bottom_finalize_bg_pulse.js`의 배경색 기반 단언([2d]/[2e])도
  이 새 그라데이션 동작에 맞게 `background-image`/`background-position` 검사로
  고쳐 다시 통과시켰고, `test_mock_interview_top_bottom_save_load.js`도 재실행해
  회귀가 없음을 확인했다.

## `mock-interview.html` — 그라데이션 셔터 스윕이 끊기던 문제: `background-position` 애니메이션을 `transform` 기반 `::after` 오버레이로 교체

사용자 피드백: "그라데이션 애니메이션이 좀 끊기는거 같으면서 부자연스러운데." 바로
위 섹션에서 만든 `aiGenPulse` 스윕 효과가 `.ai-generating` 자신의
`background-position`을 직접 애니메이션시키는 방식이었는데, **`background-position`
애니메이션은 GPU 합성(compositor)만으로 처리되지 않고 매 프레임 그 배경을 다시
그려야(repaint) 한다** — `transform`/`opacity`만이 브라우저가 리페인트 없이
합성만으로 처리하도록 보장하는 속성이다. 이 효과가 한 번에 최대 3개 블록(핵심
평가 영역별 분석/주요 강점·보완점/문항별 상세 피드백)에 동시에 걸릴 수 있다는 점이
이 반복 리페인트 비용을 더 키워, 실제로 눈에 띄게 끊기는 애니메이션으로 체감됐다.

**고쳐서** 그라데이션 띠 자체를 `.ai-generating::after` 가상 엘리먼트로 분리하고,
그 가상 엘리먼트의 `transform: translateX(...)`만 애니메이션시키도록 바꿨다(새
`@keyframes aiGenSweep`, 기존 `aiGenPulse`를 대체) — 보이는 디자인(비스듬한 보랏빛
그라데이션이 블록을 가로질러 쓸고 지나가는 모양)은 그대로 유지한 채, 애니메이션되는
속성만 리페인트를 유발하지 않는 `transform`으로 바뀐 것이다. `::after`는
`top:0; bottom:0`(부모 `.ai-generating`의 콘텐츠 높이에 맞춰 늘어남)과
`left:-60%; right:-60%`(부모보다 좌우로 60%씩 더 넓게 그려, 띠가 스윕하는 동안 양
끝에 빈틈이 보이지 않게 함)로 크기를 잡는다 — `height:100%` 같은 퍼센트 높이
대신 `top`/`bottom` 오프셋으로 늘린 이유는, `.ai-generating` 자신의 높이가 명시적
값이 아니라 콘텐츠에 따라 `auto`로 정해지는 값이라 퍼센트 높이가 안정적으로
작동하지 않는 CSS 함정(퍼센트 높이는 그 containing block에 명시적 높이가 있어야만
해석됨)을 피하기 위함이다. `.ai-generating` 자신은 `position:relative;
overflow:hidden`으로 바뀌어, `::after`가 양옆으로 삐져나온 부분을 가려주는 역할만
한다. 글씨(`opacity:1`, `filter` 없음)는 이전과 마찬가지로 전혀 영향받지 않는다 —
바뀐 건 띠를 움직이는 메커니즘뿐이다. 인쇄 시엔 `.ai-generating::after{
display:none !important; }`로 오버레이 자체를 지우고, `.ai-generating`의
`overflow`/`margin`/`padding`도 평소 값으로 되돌린다.

`test_mock_interview_shimmer_pulse.js`를 이 새 구조에 맞게 다시 썼다 — (1)
`.ai-generating` 블록 자신은 더 이상 CSS 애니메이션을 돌리지 않고(`animation-name:
none`) `background-image`도 없는지(색은 전부 `::after`로 옮겨감), (2) 글씨가 여전히
`opacity:1`/`filter:none`을 유지하는지, (3) `::after`가 `aiGenSweep` 애니메이션과
그라데이션 `background-image`를 갖고 절대 위치(overlay)로 떠 있는지, (3b) 900ms
사이를 두고 `::after`의 computed `transform` 값이 실제로 달라지는지(진짜로
스윕하는지, 멈춰있는 오버레이가 아님을 확인), (3c) 그 사이 블록 자신의
`background-position`은 전혀 안 바뀌는지(애니메이션이 그 속성에서 완전히
떠났음을 확인), (4) 분석이 끝나면 클래스가 빠지고 스윕이 멈추는지 — 모두
검증했다. `test_mock_interview_bottom_finalize_bg_pulse.js`의 기존 [2]/[2d]/[2e]
단언도 같은 이유로 `::after`의 `animation-name`/`background-image`/`transform`을
보도록 고쳐 다시 통과시켰고, `test_mock_interview_sample_questions.js`/
`test_mock_interview_top_bottom_save_load.js`도 재실행해 회귀가 없음을 확인했다.

## `mock-interview.html` — 선생님 피드백 메모는 1단계 분석 전에도 언제든 입력 가능 + 저장된 면접은 원래부터 전체 공개

사용자 요청: "선생님 피드백은 AI 분석 생성 생성하기 전에도 입력할 수 있게 해줘. 그래서
언제든지 입력할 수 있게 그리고 종합보고서를 생성할 때 들어가게. 저장된 면접 내용은
누구든지 불러올 수 있게 해줘." 두 가지 요청 중 실제로 코드 변경이 필요했던 건 첫
번째뿐이다 — 두 번째("저장된 면접 내용은 누구든지 불러올 수 있게")는 이미 그렇게
동작하고 있었다(아래 참고).

**① 담당 선생님 종합 피드백 메모 입력칸이 1단계 분석 완료 전까지 `disabled`였다.**
`#teacherInputMemo`(textarea)와 그 옆의 두 프리셋 버튼(`#btnPresetGood`/
`#btnPresetImprove`, "우수 평가 템플릿"/"보완 필요 템플릿")은 HTML에 처음부터
`disabled` 속성이 박혀 있었고, `setStageControlsEnabled(enabled)`가 1단계 분석
(`generateAnalysis()`)이 끝나야 그 셋과 "최종 보고서로 확정하기" 버튼
(`#btnFinalize`)을 한꺼번에 활성화했다 — 선생님이 면접 전/중에 미리 메모를 적어두고
싶어도 1단계를 먼저 돌리기 전까지는 타이핑조차 할 수 없었다.

실제로 메모가 보고서에 반영되는 지점(`finalizeReport()`, 2단계)은 이미 클릭하는
그 순간의 `#teacherInputMemo` 값을 그대로 읽어서 AI에 보내도록 돼 있었으므로
(`callInterviewReportApi(name, major, teacherMemo)`), 입력칸을 언제 채우든 상관없이
2단계를 누를 때 최신 값이 반영된다 — 즉 "종합보고서를 생성할 때 들어가게"라는 요구는
이미 충족돼 있었고, 막혀 있던 건 "언제든지 입력"쪽뿐이었다.

**고쳐서** `#teacherInputMemo`/`#btnPresetGood`/`#btnPresetImprove` 세 엘리먼트에서
`disabled` 속성을 전부 빼서 페이지 로드 직후부터 항상 입력 가능하게 했고(placeholder도
"먼저 1단계 답변 분석을 실행하면..."에서 "면접 전이나 중간에도 미리 입력해둘 수
있어요. 여기 적은 내용은 '2단계: 최종 보고서로 확정하기'를 누를 때 반영돼요."로
바꿈), `setStageControlsEnabled(enabled)`는 이제 `#btnFinalize`만 토글한다 — 최종
보고서 확정은 여전히 1단계 분석이 먼저 끝나야(`hasDraftAnalysis`) 가능해야 하므로
(아직 존재하지 않는 분석 결과에 선생님 의견만 얹어 "최종 확정"할 수는 없다) 그
버튼의 게이트는 그대로 유지했다. `generateAnalysis()`는 여전히
`updateTeacherMemoDisplay('')`로 **보고서에 표시되는** 메모만 1단계 시작 시 비우고
(1단계는 답변 전사만으로 돌리는 초안이라, 아직 반영 전이라는 뜻) 입력칸 자신의
`.value`는 전혀 건드리지 않으므로, 분석 전에 적어둔 메모는 1단계를 거쳐도 그대로
남아있다가 2단계에서 정확히 반영된다. `resetAll()`은 기존처럼 `.value = ''`로 직접
비우고, `loadSampleData()`/`applyLoadedReport()`도 이전처럼 `.value`를 직접
채워 넣을 뿐이라 — 셋 다 `disabled` 여부와 무관하게 항상 동작했으므로 추가 변경이
필요 없었다.

**② "저장된 면접 내용은 누구든지 불러올 수 있게"는 이미 그랬다.** 이 페이지는
애초에 로그인 자체가 없고(이 문서의 해당 섹션 참고), `interview_reports` 테이블의
RLS 정책 네 개(`interview_reports_select_open`/`_insert_open`/`_update_open`/
`_delete_open`)가 전부 `anon`/`authenticated` 양쪽에 `qual: true`(무조건 허용)로
열려 있다 — `fetchSavedReports()`/`loadReportById()` 어디에도 `owner_id`/`user_id`
같은 필터가 전혀 없어, 저장한 사람이 누구든 다른 교사가 📂 불러오기나 📋 목록
관리에서 똑같이 찾아 불러올 수 있다(삭제도 마찬가지). Supabase에서 직접
`pg_policies`를 조회해 재확인했다 — 코드 변경은 필요 없었다.

`test_mock_interview_memo_anytime.js`(새 테스트)로 (1) 페이지 로드 직후(1단계 실행
전) 메모 입력칸과 두 프리셋 버튼이 전부 활성 상태인지, `#btnFinalize`는 여전히
비활성인지, (2) 1단계 전에 직접 타이핑한 값이 그대로 유지되는지, 프리셋 버튼도 1단계
전에 바로 동작하는지, (3) 샘플 채우기+1단계 분석을 거쳐도 미리 적어둔 메모 텍스트가
그대로 보존되는지, (4) 2단계(최종 확정)를 누르면 1단계 실행 **전에** 적어둔 그 메모가
정확히 AI 호출 payload의 `teacherMemo`로 실리는지 — 모두 확인했다. 기존
`test_mock_interview_bottom_finalize_bg_pulse.js`/`test_mock_interview_shimmer_pulse.js`/
`test_mock_interview_sample_questions.js`/`test_mock_interview_top_bottom_save_load.js`도
다시 돌려 회귀가 없음을 확인했다.

## `mock-interview.html` — "분석이 단순하다"/"중간에 멈춘다" 신고 — 실제 원인은
## `interview-report` Edge Function의 두 침묵 절삭 상수였다 (+화면 꺼짐 대응)

다른 선생님이 실제로 써보고 세 가지를 보고했다: "분석 내용이 좀 단순하다", "전체를
통으로 올렸을 때는 중간에 분석이 멈춰 버렸다", "텍스트 전사가 정확하지 않다" — 거기에
사용자 본인의 의심("내가 봤을땐 분석 결과가 그렇게 단순하진 않을거 같은데")과 두 가지
질문("화면이 꺼지면 전사가 끊길 수도 있나?", "화면이 꺼지지 않게 하는 방법이 있나?")이
함께 왔다. 배포된 `interview-report` 함수 소스를 직접 읽어서(추측이 아니라) 코드
리뷰로 원인을 찾았다.

**진짜 원인: `MAX_TRANSCRIPT_CHARS = 4000`과 `max_tokens: 4096` 두 상수가 함께
작용해, "분석이 단순하다"와 "분석이 중간에 멈춘다"는 서로 다른 두 신고가 실제로는
같은 하나의 실패였을 가능성이 크다.**
- **입력 쪽 절삭**: 선생님이 "다음 문항 구분(마커)"을 한 번도 안 누르고 면접 전체를
  하나의 긴 구간으로 녹음하면, 그 구간의 전사가 쉽게 4000자를 넘는다 — 그 이후
  내용은 AI에게 전달되기 전에 `.slice(0, MAX_TRANSCRIPT_CHARS)`로 조용히 잘려
  나갔다. "전체를 통으로 올렸을 때"라는 신고 문구가 정확히 이 경로(마커 없이 쭉
  녹음)를 가리킨다.
  - 그 사이 다른 세션에서 "마커를 거의/전혀 안 눌러도 한 구간 안의 여러 질문-답변을
    AI가 자동으로 찾아 분리하는" 기능(이 문서의 "`detailed[]` 자동 분리" 섹션)이
    이미 추가돼 있었는데, 그 기능이 긴 전사를 전제로 하면서 입력 절삭과 정면으로
    충돌하게 됐다 — 긴 전사일수록 잘릴 가능성이 높아지는데, 그 기능은 바로 그런
    긴 전사를 다루는 걸 전제로 만들어졌기 때문이다.
- **출력 쪽 절삭**: `max_tokens: 4096`은 애초에 문항 하나당 `detailed` 항목
  하나씩이던 시절의 값이었다 — 자동 분리 기능이 한 구간을 여러 `detailed` 항목으로
  쪼개면서 응답 JSON이 쉽게 더 길어졌고, 길어진 응답이 4096 토큰 한도에 걸려
  중간에서 잘리면 `extractJson()`의 `JSON.parse()`가 실패한다(절삭된 JSON은 닫는
  중괄호가 없거나 구조가 깨져 있어 `{`~`}` 슬라이스로도 복구가 안 된다).
- **두 절삭이 합쳐지는 지점**: `extractJson()`이 던지면 `Deno.serve`의 catch가
  그대로 `{ok:false, error:'AI 분석 중 문제가 발생했어요...'}`를 돌려주고,
  클라이언트(`generateAnalysis()`)는 이걸 받아 조용히 `runLocalSimulation(name,
  major)`(고정된 일반 샘플)로 대체한다 — 선생님에게는 실제 AI 분석이 실패한 게
  아니라 그냥 "AI가 분석한 결과가 단순하다"로만 보인다. 즉 사용자 본인의 의심
  ("분석 결과가 그렇게 단순하진 않을거 같은데")이 맞았다 — 선생님이 본 건 진짜
  AI 분석이 아니라 그 대체 샘플이었을 가능성이 크다.

**고쳐서** `interview-report`를 버전 9로 재배포(`claude-sonnet-5-5`, 그 외 프롬프트
텍스트는 한 글자도 안 바꿈 — 5번 자동 분리 지시, keyword+detail 형식 지시 등 전부
그대로 유지):
- `MAX_TRANSCRIPT_CHARS`: 4000 → **30000**(Claude Sonnet의 컨텍스트 창 안에서는
  전혀 부담 없는 크기 — 긴 면접을 끝까지 전부 AI에게 전달할 수 있게 했다).
- `max_tokens`: 4096 → **8192**(자동 분리로 늘어난 `detailed[]` 배열까지 끝까지
  받을 수 있게 했다).

**텍스트 전사 정확도**는 Web Speech API(`SpeechRecognition`) 설정 자체(`lang='ko-KR'`,
`continuous=true`, `interimResults=true`)를 코드로 다시 확인했고 이미 올바르게
설정돼 있었다 — 더 손댈 수 있는 자체 코드상의 버그는 없었다. 전사 품질 자체는
브라우저 내장 음성 인식 엔진의 고유한 한계이고, 이 저장소가 직접 통제할 수 있는
영역 밖이다(필요하다면 Whisper 같은 서버사이드 STT로 교체하는 게 유일한 근본
해결책이지만, 이번 요청 범위를 벗어나 별도로 논의가 필요하다).

**화면 꺼짐 — "화면이 꺼지면 전사가 끊길 수도 있나?"는 맞다, 실제로 그럴 수 있다
(화면이 꺼지면 OS가 탭을 백그라운드로 강하게 스로틀링하거나 마이크 스트림 자체를
일시정지할 수 있다는 것이 알려진 모바일/브라우저 동작이다). 지금까지
`mock-interview.html`엔 이를 막는 코드가 전혀 없었다 — Screen Wake Lock API
(`navigator.wakeLock`)를 새로 추가했다.**
- `requestWakeLock()`/`releaseWakeLock()`가 각각 `startRecording()`/
  `stopRecording()`에서 호출된다 — 이 페이지의 모든 "정지" 경로(마커 지연 후 정지
  버튼, 재시작 루프 가드가 스스로 멈추는 경우, 음성 인식 오류로 멈추는 경우 등)가
  전부 `stopRecording()`을 거치므로, 그 한 곳에만 `releaseWakeLock()`을 추가하는
  것으로 모든 경로가 커버된다.
- **`'wakeLock' in navigator`로 지원 여부를 먼저 확인**하고, 지원하지 않는
  브라우저(일부 구형 iOS Safari 등)에서는 조용히 아무 일도 하지 않는다 — Wake Lock
  이 없어도 녹음/전사 자체는 평소처럼 정상 동작한다(이 기능은 보조 안전장치일
  뿐, 전사의 필수 조건이 아니다).
- `request()`가 거부되거나(배터리 세이버 모드, 권한 정책 등) 예외를 던져도
  `try/catch`로 삼켜서 녹음 시작 자체를 절대 막지 않는다.
- **탭이 잠깐 가려졌다가(다른 앱으로 전환 등) 다시 보이면 lock이 자동으로 풀려있을
  수 있다**(브라우저 사양상 탭이 보이지 않는 동안 lock이 해제된다) — `document`의
  `visibilitychange` 리스너가 `isRecording && document.visibilityState ===
  'visible' && !wakeLockSentinel`일 때 자동으로 다시 요청한다.
- **알려진 한계, 사용자에게도 이렇게 전달함**: 이 API는 브라우저가 화면을 자동으로
  끄는 것만 막을 수 있다 — 사람이 직접 전원 버튼을 눌러 화면을 끄거나 잠그는
  것까지는 어떤 웹 API로도 막을 수 없다(OS/브라우저가 애초에 그 동작을 웹페이지에
  허용하지 않는다).

`test_mock_interview_wakelock.js`(Playwright, `navigator.wakeLock`을 가짜로 교체해
호출 횟수를 기록 — **헤드리스 크로미움은 Wake Lock API를 기본으로 이미 지원해서**,
평범한 `navigator.wakeLock = {...}` 대입은 getter-only 속성이라 조용히 무시되고
실제 네이티브 구현이 그대로 쓰인다; `Object.defineProperty(navigator, 'wakeLock',
{configurable:true, value:{...}})`로 교체해야 가짜가 실제로 쓰인다. "API 자체가 없는
브라우저"를 흉내낼 때도 `navigator.wakeLock = undefined`로는 `'wakeLock' in
navigator`가 여전히 참으로 남으므로, `delete Navigator.prototype.wakeLock`으로
프로토타입에서 실제로 지워야 한다 — 이 환경에서 Wake Lock API를 테스트할 다음
기회에도 이 두 가지 함정을 기억해둘 것)로 (1) 녹음 시작 시 정확히 한 번
`request()`가 호출되는지, (2) 녹음 중엔 release가 안 일어나는지, (3) 정지 시 정확히
한 번 `release()`가 호출되는지, (4) 탭이 가려져 lock이 풀렸다가 다시 보이면(아직
녹음 중) 자동으로 재요청되는지, (5) Wake Lock API 자체가 없는 환경에서도 녹음
시작/정지가 평소처럼 정상 동작하고 JS 에러가 전혀 없는지 — 모두 확인했다. 기존
`test_mock_interview_memo_anytime.js`/`test_mock_interview_sample_questions.js`/
`test_mock_interview_bottom_finalize_bg_pulse.js`/`test_mock_interview_shimmer_pulse.js`/
`test_mock_interview_top_bottom_save_load.js`도 다시 돌려 회귀가 없음을 확인했다.

**이 환경에서는 실제 Claude API 호출의 성공 여부나, 늘어난 30000자/8192토큰
한도가 실사용에서 충분한지까지는 검증할 수 없다**(`api.anthropic.com`으로의
아웃바운드가 이 샌드박스에서 막혀 있다는, 이 문서 다른 곳에도 반복되는 제약) —
실제 효과는 다음 번 긴 면접(마커 없이 쭉 녹음한 경우)을 분석해봐야 확인된다.

## `mock-interview.html` 상단 헤더 — 4줄 레이아웃(제목/설명/아이콘/마지막 설명)으로 재배치

사용자가 와이어프레임 이미지와 함께 "첫번째줄 제목, 두번째줄 설명, 세번째줄 각종 아이콘,
네번째줄 마지막 설명으로 배치"를 요청했다 — 대상은 "AI 모의면접 분석 맨 상단부분"
(`mock-interview.html`의 `<header>`)이라고 확인받았다. 기존 헤더는 왼쪽에 아이콘+제목+
설명+배지를 한 묶음으로, 오른쪽에 5개 액션 아이콘(저장/불러오기/목록 관리/샘플 채우기/
전체 초기화)을 `grid grid-cols-3`로 배치한 **가로 2단 구성**이었는데, 이를 **세로 4줄**
(`flex flex-col items-center text-center`)로 재배치했다:
1. **제목** — `<h1>`(마이크 아이콘 + "AI 모의 면접 분석").
2. **설명** — "끊김 없는 전체 녹음 + 실시간 타임스탬프 분할 방식".
3. **아이콘들** — 기존 5개 액션 버튼(저장/불러오기/목록 관리/샘플 채우기/전체 초기화)을
   `flex items-center justify-center gap-2.5`로 한 줄에 가로로 나열(기존 `grid-cols-3`
   대신).
4. **마지막 설명** — "⚡ 질문+답변 함께 녹음 → AI가 자동 분리" 배지.

`onclick`/`id` 전부 그대로 유지했으므로(`btnSaveReport`/`btnLoadReport`/
`loadSampleData()`/`resetAll()`/`openManageModal()`), `saveReport()`/
`setSaveButtonEnabled()` 등 기존 JS는 전혀 손대지 않았다 — 순수 레이아웃(마크업+
Tailwind 클래스) 변경뿐이다. 📂 불러오기 드롭다운(`#loadPanel`)은 이제 아이콘 줄이
가운데 정렬되므로 `absolute right-0`(기존, 오른쪽 끝 기준) 대신 `absolute left-1/2
-translate-x-1/2`(아이콘 줄 중앙 기준)로 위치를 맞췄다 — `toggleLoadPanel()`/
`closeLoadPanel()`은 `id`로만 찾으므로 이 위치 변경과 무관하게 그대로 동작한다.
`test_header_4row.js`(스크래치패드 전용)로 JS 예외가 없는지, 네 줄의 텍스트/버튼
개수가 정확한지, 그리고 네 줄의 실제 화면상 Y좌표가 제목<설명<아이콘<마지막 설명
순서로 쌓여 있는지(진짜로 위→아래 4줄인지)를 확인했다.


## `mock-interview.html` 헤더 — 3번째 줄(아이콘)과 4번째 줄(마지막 설명 배지) 순서 교체

사용자 요청: "AI 모의면접 분석 페이지 상단 세번째 아이콘 줄과 네번째 설명줄의 위치를
바꾸자." 이전 세션에서 헤더를 "①제목 ②설명 ③아이콘들 ④마지막 설명(배지)" 4줄로
재배치했던 것을, 이번엔 "①제목 ②설명 ③마지막 설명(배지) ④아이콘들"로 — 뒤 두 줄의
순서만 맞바꿨다. 두 블록을 그대로 위치만 바꿔 옮겼을 뿐(`id`/`onclick`/내부 구조는
전혀 안 바꿈 — 저장/불러오기/목록 관리/샘플 채우기/전체 초기화 다섯 아이콘과 📂
드롭다운 패널 로직 모두 그대로), 헤더 맨 위 주석(`<!-- Header — 4줄 레이아웃: ... -->`)
의 순서 설명도 실제 순서에 맞게 같이 고쳤다.

`test_mi_header_order.js`로 각 블록의 화면상 세로 위치(`getBoundingClientRect().top`)
를 직접 비교해 제목 < 설명 < 배지 < 아이콘 순서로 정확히 위에서 아래로 쌓이는지, JS
에러가 없는지 확인했다.

## 학생용 보기(`?view=`): "PDF로 저장"만, 지도 교사 서명란 숨김

학생 화면의 공유하기·인쇄 버튼을 `#btnSvPdf`("PDF로 저장") 하나로 바꿨다. `saveStudentPdf()`가 html2canvas·jsPDF(cdnjs,
누를 때만 로드)로 `#reportContainer`를 캡처해 A4 PDF로 바로 내려받는다 — `onclone`에서 폭을 760px로 고정해 휴대폰에서
눌러도 A4 비율로 그리고, 길면 여러 장으로 자른다. `html.student-view #teacherSignatureBlock`은 숨겨서 학생에게 지도 교사
이름·서명란이 안 보인다(교사 화면·교사 인쇄에는 그대로).

## 저장된 분석 결과: 드롭다운에서 고르면 바로 "불러올까요?"

맨 위 불러오기 바(`#topLoadSelect`)와 헤더 📂 패널(`#loadSelect`)의 "불러오기" 버튼을 없애고, 드롭다운 `onchange`에서
`askLoad()`가 `confirm("…분석 결과를 불러올까요?")`를 띄운다. 확인하면 `loadReportById()`, 취소하면 선택을 직전 값
(`topLoadedId`, 패널은 빈 값)으로 되돌린다. 패널 목록에도 "선택해주세요…" 첫 항목을 넣어 첫 항목도 change가 나게 했다.
