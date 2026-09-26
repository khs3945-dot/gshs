# CLAUDE.md — 경성고 교무 도구

정적 HTML/JS 사이트(빌드 과정 없음). 각 페이지는 독립적인 `.html` 파일로, `<style>`과
`<script>`가 그 안에 인라인으로 들어있음. 공용 JS 모듈/번들러 없이, 같은 패턴(Supabase
클라이언트 초기화, 헬퍼 함수 등)을 파일마다 의도적으로 반복해서 씀 — 새 페이지를 만들 때도
이 관례를 따를 것.

## 배포/인프라

- **GitHub**: `khs3945-dot/gshs`. 작업 브랜치 `claude/happy-hopper-gmxauj`와 `main`
  둘 다에 직접 커밋·푸시(PR 없이). 푸시 전에 `git fetch origin main`으로 main이 현재
  커밋의 부모와 일치하는지 확인 후 fast-forward.
- **Netlify**: 사이트 `jocular-panda-50501a`(siteId `5f04c516-c642-491c-9810-ee5e655f91d5`),
  운영 브랜치는 `main`. 배포 후 `mcp__Netlify__netlify-project-services-reader`
  (`get-project`)로 `currentDeploy.state === "ready"`이고 새 deploy id인지 확인.
- **Supabase**: 프로젝트 `tmssupuskkajahpuswcj`. Edge Function은
  `mcp__Supabase__deploy_edge_function`으로 별도 배포(깃/Netlify 흐름과 무관, 버전이
  올라감). Publishable key(`sb_publishable_...`)는 코드에 그대로 노출해도 되는 키 —
  보안은 RLS로 함. Service role key는 Edge Function 환경변수로만 존재.
- 로컬 정적 서버로 테스트: `python3 -m http.server 8801 --directory /home/user/gshs`.
  연결이 끊기면 `(nohup python3 -m http.server 8801 --directory /home/user/gshs >
  /tmp/http8801.log 2>&1 &)`로 재시작.
- Playwright 테스트: 세션 스크래치패드의 `sbtest/`에 vendored supabase-js UMD를 두고
  Supabase REST/RPC 호출을 정확한 path+method+Accept 헤더(`vnd.pgrst.object` 유무로
  단일/배열 응답 구분)로 route mock. Playwright 자체는 vendored node_modules 밖에 있어서
  `NODE_PATH=/opt/node22/lib/node_modules node test.js`로 실행. 샌드박스는 실제
  Supabase/Netlify에 직접 접속 불가 — Edge Function 로직 검증은 `mcp__Supabase__execute_sql`
  로 직접 SQL 시뮬레이션하거나 배포 후 코드 리뷰로 확인(진짜 E2E는 불가능).
  - **알려진 무해 오류**: my-page.html의 두 번째 `<script>`(내 할 일/MS·Google Tasks)는
    테스트 샌드박스에 실제 MSAL 라이브러리가 없어서 `msal is not defined`,
    `Cannot access 'msLists' before initialization` 에러가 항상 뜸 — 실제 버그 아님,
    "JS 예외 없음" 체크 시 이 두 개는 무시.

## 공통 프런트엔드 관례

- CSS 변수(거의 모든 페이지 공통): `--paper, --paper-card, --ink, --ink-soft, --rule,
  --rule-soft, --stamp, --stamp-soft, --crest-red, --brass, --brass-soft`.
- Supabase 클라이언트: `const SUPABASE_URL = 'https://tmssupuskkajahpuswcj.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_...'; const sb = supabase.createClient(...)`.
- `nav.js`(모든 페이지에 `<script src="./nav.js" defer>`로 로드): 플로팅 햄버거 메뉴 +
  교사용 챗봇 플로팅 버튼(`buildTeacherChatFab`, chatbot-teacher.html을 `?widget=1`
  iframe으로 계속 마운트해둠). `DEFAULT_NAV_ITEMS` 배열이 메뉴 순서와 index.html의
  `.tool-card` 그룹핑(`groupToolCardTiles`, href로 매칭)을 동시에 결정함 — 메인페이지
  카드 그룹은 `NAV_ITEMS` 배열 순서가 아니라 index.html의 **DOM 순서**를 따르므로,
  순서를 맞추려면 index.html의 카드 블록 자체를 재배열해야 함.
- `site-login-badge.js`: 공용 로그인 배지, `<script defer>`로 로드.
- 관리자 확인 패턴: `const { data: profile } = await sb.from('profiles').select
  ('is_admin').eq('id', session.user.id).maybeSingle(); const isAdmin = !!(profile
  && profile.is_admin);`
- 드래그 앤 드롭은 **항상 Pointer Events**로 직접 구현(`pointerdown/move/up/cancel` +
  `setPointerCapture`). 네이티브 `draggable="true"`는 쓰지 않음 — iOS Safari가
  아예 지원 안 하고 안드로이드도 브라우저마다 다름. 드래그 중엔 실제 DOM 흐름에
  삽입선(`.dash-drop-indicator`/`.cat-drop-indicator` 같은 얇은 바)을 끼워 넣어서
  "어디와 어디 사이"에 들어갈지 정확히 보여줌(단순 테두리 강조보다 우선).

## 데이터베이스 핵심 테이블

- `profiles`: id, name, role, phone, email, is_admin, approved, department, subject,
  extension, is_homeroom, homeroom_class, ui_prefs(jsonb), created_at, updated_at.
  `ui_prefs`는 사용자별 화면 설정(예: `dash_collapse`, `dash_block_order`)을 담는
  범용 jsonb.
- `staff`: 교직원 명렬(58명 안팎), name/department/subject/extension/homeroom/
  homeroom_room/hours/schedule(jsonb)/phone(비어있음, 안 씀). `public_staff` 뷰는
  민감하지 않은 컬럼만 노출.
- `app_settings`(단일 행, `id = 'site'`): 사이트 전체 설정. RLS는 **조회는 누구나,
  수정은 `profiles.is_admin = true`인 사람만** — 새 사이트 전체 설정을 추가할 땐 이
  테이블에 컬럼을 얹고 같은 RLS를 재사용하는 게 기본 패턴. 현재 컬럼:
  - `require_approval` (bool): 가입 승인 정책, member-admin.html에서 토글.
  - `collapse_defaults` (jsonb): 페이지별 접기/펼치기 기본값. 키:
    `blockInfoBody, blockMsgInboxBody, blockTimetableBody, blockWeekPlanCurrentBody,
    blockWeekPlanArchiveBody, blockAssignedBody, cardTasks`(이상 my-page.html),
    `cardLocal, cardMs, cardGt`(my-todo.html), `mpControls`(my-custom-page.html),
    `chatSuggest`(chatbot-teacher.html), `linkHubCategories`(link-hub.html, 카테고리
    이름이 동적이라 전체 공통 기본값 하나만 존재).
  - `default_dash_block_order` (jsonb): my-page.html 칸 배치 기본값(`dash_block_order`
    와 같은 형식, 열 인덱스 → id 배열).
  - `link_hub_category_order` (jsonb): 업무 링크 모음 카테고리 표시 순서(이름 배열).

### "관리자 기본값" 패턴 (접기/펼치기, 배치)

각 페이지는 회원관리 페이지의 원격 체크리스트가 아니라 **그 페이지 안에 관리자만 보이는
"🔧 기본으로 설정" 버튼**을 둠. 관리자가 그 페이지에서 원하는 상태로 직접 맞춘 뒤 버튼을
누르면 지금 화면 그대로가 기본값으로 저장됨(다른 페이지 키는 read-modify-write로 보존).
적용 우선순위는 항상: **① 그 선생님이 이미 스스로 설정한 값(로그인 상태면
`profiles.ui_prefs`, 아니면 localStorage) → ② 관리자 기본값(`app_settings.
collapse_defaults`/`default_dash_block_order`) → ③ HTML에 원래 적힌 기본 상태**.
새로운 접기/펼치기나 배치 기능을 추가할 때 이 3단 우선순위를 그대로 따를 것.

### 자가 가입(self-register) 시 명렬 자동 채우기

`self-register` Edge Function은 가입 시점에 `staff` 테이블에서 이름이 일치하는 행을
찾아 department/subject/extension/homeroom(→is_homeroom+homeroom_class)을 프로필에
복사함(신규 계정 생성 시 1회성 — 기존에 이미 가입된 계정은 소급 적용 안 됨. 이 로직이
생기기 전에 가입한 계정은 수동으로 한 번 SQL 백필이 필요했음).

## 교사용 챗봇 (`chat-teacher` Edge Function + chatbot-teacher.html)

- 모델: 대화는 `gemini-3.6-flash`, 임베딩은 `gemini-embedding-001`
  (`text-embedding-004`는 지원 종료됨 — 절대 되돌리지 말 것).
- RAG: `match_chat_chunks` RPC가 `similarity`(코사인 유사도) 컬럼을 반환함.
  `RAG_SIMILARITY_THRESHOLD = 0.5` 미만인 조각은 컨텍스트/출처 목록에서 제외(벡터
  검색은 상위 K개를 무조건 반환하므로 이 기준이 없으면 관련 없는 자료까지 참고했다고 나옴).
- 캘린더: 기본으로 항상 주입하는 범위는 오늘 기준 **-10일 ~ +21일**(3주 전부터
  질문해도 이번 주 월요일이 빠지지 않도록 넉넉히 잡음). 이 범위를 벗어난 질문(특정 월,
  지난 학기, 올해 전체 등)은 `search_calendar_events`라는 별도 Gemini 함수 호출
  도구로 그때그때 원하는 기간(최대 400일)을 조회하게 함 — 매번 1년치를 통째로 주입하지
  않음.
- 출처 표시: 모델이 답변 마지막 줄에 `[[참고자료: 항목1, 항목2]]` 형식으로 **실제로
  사용한 자료만** 적도록 시스템 프롬프트에 지시하고, 이 줄을 파싱해서 화면 답변에서는
  잘라내며, 후보 목록(실제 제공됐던 자료 전체)과 교집합을 취해 모델이 지어낸 이름은
  자동으로 걸러짐. "제공은 됐지만 실제로 안 쓴 자료"가 출처에 뜨는 걸 막기 위함 —
  이 마커 형식을 시스템 프롬프트에서 절대 빼지 말 것.
- 추천 질문: `top_asked_questions(p_limit, p_min_count)` RPC, 현재 `p_min_count=5`
  (5회 이상 물어본 질문만), `p_limit=5`. 화면은 기본 2개만 보여주고 "더보기"로 최대
  5개까지 펼침(localStorage로 펼침 상태 기억, 관리자 기본값도 적용됨).
- 마이크(음성 인식): 브라우저 SpeechRecognition이 "같은 확정(final) 구간을 점점
  길어지는 내용으로 반복 전송"하는 경우가 실제로 있어서(인덱스/isFinal만 믿으면 안 됨),
  `collapseGrowth`라는 텍스트 레벨 비교 방식을 씀 — 새 조각이 이전 조각을 포함하며
  길어진 것이면 교체, 이미 포함된(짧은) 것이면 버림. 같은 원리를 세션 재시작 시
  `committedTranscript`에도 적용.
- 교사용 챗봇 플로팅 패널(`nav.js`의 `buildTeacherChatFab`)은 iframe을 계속
  마운트해두는 방식이라, 패널을 "열 때"마다 postMessage(`{source:'gs-host-page',
  type:'panel-opened'}`)로 iframe에 알려서 다시 맨 아래로 스크롤시켜야 함(로드 시
  1회만 스크롤하면 패널이 숨겨진 상태였어서 소용없음).

## 작업 시 유의사항

- 시크릿(서비스 롤 키 등)을 절대 git에 커밋하지 말 것. Publishable key는 예외.
- 새 관리자 전용 사이트 설정은 `app_settings` 테이블에 컬럼을 추가하고 기존
  select-all/update-admin RLS를 재사용하는 게 기본.
- 접기/펼치기, 배치 등 "사용자 설정 vs 관리자 기본값" 성격의 기능은 3단 우선순위
  패턴(위 참고)과 페이지 내 버튼 UX를 그대로 따를 것 — 회원관리 페이지에 원격
  체크리스트를 다시 만들지 말 것(한 번 시도했다가 사용자가 페이지 내 버튼 방식으로
  바꿔달라고 요청함).
