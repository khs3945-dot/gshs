# CLAUDE.md

경성고 교무 도구 — Claude Code용 핵심 안내. **이 파일은 짧게 유지한다**(매 세션 모든 메시지에
통째로 실려 가므로, 1MB까지 커졌을 때 "Prompt is too long"으로 세션이 멈췄다).
기능별 상세 이력·사고 기록·설계 결정은 `docs/notes/<주제>.md`에 있다 — 해당 페이지를 손대기 전에
그 파일을 grep/Read해서 필요한 부분만 읽을 것.

## 작업 기록 규칙 (중요)
- 새 작업 기록은 **이 파일이 아니라** `docs/notes/<주제>.md` 끝에 `## 제목` + 몇 줄로 짧게 추가한다.
- 이 파일에는 앞으로도 꼭 알아야 하는 전역 규칙·함정만, 한두 줄로 추가한다. 200~250줄을 넘기지 말 것.

## 구조
- 빌드 없는 정적 사이트(package.json·번들러 없음). 페이지마다 `.html` 하나에 `<style>`/`<script>` 인라인.
  공통 로직(Supabase 클라이언트, escapeHtml 등)은 **모듈로 빼지 않고 페이지마다 복사**한다 — 새 기능도 이 관례를 따른다.
- 공용 스크립트(`<script defer>`): `nav.js`(햄버거 메뉴·🔍 검색·교사 챗봇 버튼·사이트 공통 움직임 효과 `initMotion`: "불러오는 중" 반짝이, 복사 알림 `window.ksToast`, 눌림 반응, details 펼치기), `site-login-badge.js`(코너 로그인 배지 —
  `#site-login-badge`, `gsnav-` 클래스 아님). `auth.js`는 꺼져 있다(`AUTH_ENABLED=false`).
- **메뉴는 `ks-menu.js`의 `KS_MENU` 한 곳에서 관리**한다(그룹: 내 업무·학교 정보·예약·공유·평가·학생·AI 챗봇·생활·관리).
  사이드바(`<nav class="ks-nav" id="ksNav">` 바로 뒤 `<script src="./ks-menu.js">`), nav.js 햄버거·검색·메인 타일 그룹이
  모두 이 목록을 읽는다. 새 페이지는 KS_MENU에 항목 추가 + index.html 타일(같은 그룹 순서) 추가. 사이드바 없는 페이지는
  `<head>`에서 nav.js보다 먼저 ks-menu.js를 넣는다. `admin: true` 항목은 관리자에게만 보인다. 사이드바 껍데기
  (`.ks-app`/`.ks-sidebar`/`.ks-topbar`)는 여전히 ~38개 파일에 복붙돼 있다. `admin-tools.html`은 이제 "관리 도구" 페이지.
- 모든 사이드바 페이지(index 포함)는 `</head>` 직전 `<style id="ks-theme">`로 공통 디자인(연회색 배경·진한 글씨·남색 강조·유형별 색 아이콘 `ic-*`)을 맞춘다 — 새 페이지도 복사해 넣고, 사이드바 아이콘은 index.html의 SVG 배지를 쓴다.
- 시험 중인 기능은 관리 메뉴 `lab.html`(실험실, 승인된 회원 누구나)의 `LAB_ITEMS`에 먼저 두고, 완성되면 정식 메뉴로 옮긴다.
- `index.html` 타일 그룹은 KS_MENU의 group과 href로 매칭되고(nav.js, index에서만), 순서는 `index.html` DOM 순서.
  group 없는 타일은 항상 맨 앞에 고정된다. href 비교는 반드시 `pageKeyOf()`로 정규화(Netlify Pretty URLs가
  `./x.html`→`/x`로 바꿈).

## 배포 / 브랜치
- `main` → Netlify(실제 서비스). `work` → Vercel 미리보기. **새 작업은 `work`에 푸시**하고, 검토 후 `work`→`main` 병합.
- **푸시는 모아서 한다**: Vercel 무료 플랜은 하루 배포(빌드) 100회 한도 — 푸시 한 번이 배포 한 번. 바로 확인이 꼭 필요한
  경우가 아니면 여러 수정을 로컬 커밋으로 모아 두었다가 한 번에 푸시한다. `main` 병합은 사용자가 미리보기 확인 후 요청할 때만.
- 학생용 공개 링크(학생 챗봇 `bot.html`, 결석신고서 서명, 시험 시간표 학생 링크, 면접 보고서 보기, 내가 만든 도구 `tool.html`, 학생 페이지 `student.html`)는
  두 번째 Netlify 사이트 `https://inspiring-macaron-9aabd8.netlify.app/`(`STUDENT_BASE_URL`, `main`에서 배포)를 쓴다 →
  `main` 병합 전에는 그 도메인에 반영되지 않는다.
- **Netlify는 크레딧제(무료 월 300)**: 운영 배포 1번 15크레딧, `main` 병합 1번에 두 사이트가 배포돼 약 30 → 월 10번 안팎. `main` 병합도 모아서. 사용량은 관리 › 서비스 사용량(`service-usage.html`).
- `_headers`가 공용 스크립트(nav.js 등)에 `Cache-Control: no-cache`를 건다. 새 공용 스크립트도 여기 추가.
- 외부 설정 문서: `AUTH-SETUP.md`(구글 OAuth), `GCAL-SETUP.md`, `KAKAO-MAP-SETUP.md`, `CALENDAR-SETUP.md`, `collect-setup.md`, `BACKUP-SETUP.md`(매주 Supabase → 구글 드라이브 백업, `db-backup` 함수).

## 백엔드
- **Supabase** 프로젝트 `tmssupuskkajahpuswcj`. publishable 키가 페이지에 하드코딩된 건 의도(보안은 RLS로).
  MCP의 `apply_migration`/`execute_sql`로 스키마 변경 가능. `DELETE`/`DROP`이 든 SQL은 이 환경 MCP에서
  자주 타임아웃·취소된다 → 사용자에게 SQL Editor에 붙여넣도록 안내(`ALTER POLICY`로 우회 가능한 경우도 있음).
- **Supabase Storage(무료 1GB) 아끼기**: 새 업로드는 크기 제한(챗봇 자료 PDF 20MB·그 밖 10MB, 버킷 file_size_limit 20MB). 이미지를 Storage에 올리는 기능을 만들면 반드시 긴 변 ~1600px JPEG로 줄여서. 드라이브(Apps Script) 업로드는 예외.
- 비밀번호 해시 RPC는 `search_path = public, extensions`(pgcrypto가 extensions 스키마에 있음).
- 비로그인 쓰기·관리자 아닌 쓰기는 `SECURITY DEFINER` RPC로 좁혀서 연다(직접 RLS를 넓히지 않음).
- **Edge Function 소스는 git에 없다**(Supabase에만 있음 — 한 번 소스가 `SEE_FILE`로 망가진 적 있음). 재배포는
  항상 같은 함수의 새 버전으로, `verify_jwt:false`였던 함수는 명시적으로 다시 `false`.
- Edge Function은 `sb.functions.invoke()`로 부르므로 실패도 **HTTP 200 + `{ok:false, error}`**로 돌려줄 것
  (non-2xx면 클라이언트가 일반 문구만 받음).
- **AI**: Claude 우선(`claude-sonnet-5-5` 고급, `claude-haiku-4-5-20251001` 단순), 실패 시 Gemini 폴백.
  임베딩은 Gemini(`gemini-embedding-001`)만. 도구 없는 호출에 `output_config.effort`/`speed`를 넣지 말 것
  (반복 출력·400 사고). 성공 호출은 `ai_usage_log`에 기록(`logAiUsage`). 모델은 요청 없이 바꾸지 않는다.
- **Google Apps Script**(드라이브/시트가 원본인 기능: 제출함, 자료실, 주간계획 요약, 설문 첨부, 업무링크는 별도 배포):
  소스는 `collect-setup.md`(업무링크는 `link-hub-apps-script.gs`). 이 환경에서 배포 불가 — 사용자가
  "배포 관리 → 수정 → 새 버전"으로 재배포(새 배포 금지, URL 바뀜).

## 인증·권한
- 실제 로그인은 Supabase Auth + `profiles`(approved/is_admin/is_active/must_change_password). 페이지마다
  `getSession()` → `profiles.approved` 확인 → gateView/pendingView/mainView 3단 게이트 패턴.
- `profiles_update_self`는 is_admin/approved/must_change_password/is_active를 본인이 못 바꾸게 고정 — 권한 관련
  칼럼을 추가하면 여기에도 추가.
- 관리자 아닌 교사의 편집은 **편집 비밀번호**(화면 이름. 예전 "공용 편집 비밀번호", `shared_edit_settings`, `verify_shared_edit_password`)
  "🔑 관리자 모드" 패턴. 비밀번호 설정/변경은 `admin-tools.html` 한 곳에서만.
- 회원은 삭제 대신 비활성(`is_active=false`) — 고르는 목록에서만 빠지고 이름 표시는 유지.
- 사이트 전역 설정은 `app_settings`(단일 행 `id='site'`, 누구나 select·관리자 update). 비밀값은 여기 두지 말 것
  (`collect_settings`/`shared_edit_settings`처럼 select 정책 없는 테이블 + RPC).
- 담임·부담임 원본은 교직원 명렬(`staff.homeroom`/`co_homeroom`) — `class_sections`의 담임 칸은 트리거가 맞춘다(직접 고치지 말 것).
- 학생 민감 비고(특수·대안·지체·건강)는 `school_private_notes`에만(트리거가 자동 분리) — 열람 비밀번호 RPC로만 읽는다. 학생 비고를 AI·공개 화면에 보낼 때 이 규칙을 지킬 것.
- UI 상태 우선순위: 사용자 설정(`profiles.ui_prefs` 또는 localStorage) > 관리자 기본값(`app_settings`) > HTML 기본값.

## 자주 걸린 함정
- 드래그앤드롭은 Pointer Events + `setPointerCapture`로(네이티브 draggable은 iOS 미지원). 영역에 `touch-action:none`.
- flex 안 input이 넘치면 `min-width:0`. `style.display=''`는 스타일시트 규칙으로 숨긴 요소를 못 되살린다(인라인으로 숨길 것).
- HTML 속성 값의 `\r\n`은 파싱 시 `\n`으로 바뀐다 — DB 키를 `data-*`로 왕복시키지 말고 배열 인덱스로.
- `display:none` 안의 요소는 `getBoundingClientRect()` 폭이 0. 인쇄 전 측정이 필요하면 화면 밖에 배치.
- 인쇄 CSS에서는 `[class^="gsnav-"], [class*=" gsnav-"]`와 `#site-login-badge`를 숨긴다. Chrome 인쇄 중엔
  ResizeObserver가 안 돌아서 인쇄용 값은 CSS로 고정.
- `my-page.html`은 `<script>` IIFE가 둘이라 서로의 함수를 못 본다 — 공유할 것은 `window.*`로.
- 모바일 음성 인식(`SpeechRecognition`)은 같은 구절을 다시 보낼 수 있다 — 텍스트로 중복 제거.
- JSZip `generateAsync` 결과 Blob은 기본 MIME이 zip — xlsx 등은 `type` 명시.

## 검증 방법
- 테스트/CI 없음. `python3 -m http.server`로 서빙 후 Playwright(`/opt/node-tools/node_modules/playwright`,
  Chromium `/opt/pw-browsers`)로 확인. 테스트 스크립트는 스크래치패드에 두고 커밋하지 않는다.
- 이 샌드박스는 `*.supabase.co`, `api.anthropic.com`, script.google.com, 일부 CDN(jsdelivr·tailwind) 아웃바운드가
  막혀 있다 → `page.route()`로 Supabase 클라이언트를 가짜 객체(스텁)로 대체. **route는 나중에 등록한 것이 먼저
  적용**되므로 "외부 차단" route를 먼저, 스텁 route를 나중에 등록.
- `scrollHeight - clientHeight` 1~3px 차이는 한글 폰트 반올림 노이즈일 수 있음 — 글자 잘림은 스크린샷으로 확인.
- Playwright `setInputFiles`는 한글 파일명을 못 다룰 때가 있음 — 테스트 파일은 영문 이름으로.

## 주제별 상세 기록 (`docs/notes/`)
| 파일 | 내용 |
|---|---|
| `core.md` | 원래 개요·명령·배포/인프라 전문(Pretty URLs·`pageKeyOf` 사건 포함) |
| `accounts-admin.md` | 인증 2종, 이름 충돌·계정 연결 요청, 비밀번호 재설정, 주요 테이블, 회원 관리·비활성·계정 합치기, 교직원 명렬 |
| `nav-and-home.md` | `nav.js`(검색·타일 숨김·adminOnly), index 빠른 이동, 아이콘 리디자인, admin-tools, 메시지함 숨김 |
| `my-page-dashboard.md` | 나의 페이지·대시보드 위젯·드래그·브리핑·공지·할 일 요청·메시지 요약 |
| `ai-chatbots.md` | AI 공급자 전략, 사용량 로그, 교사 챗봇(`chat-teacher`) 도구, PDF 업로드 |
| `student-chatbots.md` | 학생 챗봇(`bot.html`/빌더/활동 탭/채점 기준), 개인 비서 봇, 국어 탐구 챗봇 |
| `collect.md` | 제출함(비밀번호·마스터 비밀번호·파일명 규칙) + 주간계획 요약(같은 Apps Script) |
| `room-booking.md` | 교실 예약(익명 비밀번호, 엑셀, 드래그, 빈 교실 찾기, 캘린더 등록), 교실 배치도 |
| `timetable-staff.md` | 시간표 데이터 형태, 수업 교체 찾기, 시간표 일괄 업데이트 |
| `exams.md` / `duty.md` | 시험 시간표 목록·생성, 학생 지도 일정(duty, 옛 이름 지도 당번표) |
| `form-board-file-library.md` / `link-hub.md` | 문서 양식, 자료실, 업무링크 |
| `food-map.md` | 맛집 지도(카카오맵) |
| `grade-estimate.md` | 예상 등급 산출(동점자 규정, NEIS 양식, 가중합산·절대평가) |
| `school-status.md` | 학교 현황(명렬표·반 편성·학사일정·관리자 모드) |
| `mock-interview.md` | 모의면접 분석(녹음·전사·`interview-report`·저장) |
| `survey.md` | 설문조사(비회원 응답, 파일 첨부, 대상 명단, 응답자 공개 옵션) |
| `absence-report.md` | 결석신고서(양식 이미지 오버레이 좌표, 서명, 인쇄) |
| `attendance-check.md` | 실험실 출석부 점검(나이스 PDF 좌표 판독, 출석부 사진 AI 판독·대조) |
| `record-check.md` | 실험실 학생부 점검(지침 파일→규칙 AI 추출·저장, 규칙 점검·AI 점검 캐시) |
| `student-portal.md` | 실험실 학생 페이지(학생별 링크·비밀번호, 선생님이 보내는 공지·계정·시험·링크) |
| `data-hub.md` | 관리 › 자료 한번에 관리(학년도 자료 엑셀 받기·올리기, 관리자 사용 설명서) |
| `work-flow.md` | 실험실 학기 업무 흐름 체크리스트(달별 항목 DB·내 체크·담임 점) |
| `my-tools.md` | 내가 만든 도구(챗봇이 만드는 sandbox 미니 도구, diy_tools·ksStore 다리) |
| `msg-triage.md` | 실험실 메신저·메모 AI 분석(글·파일·스크린샷 → AI가 할 일·메모·서식으로 제안, 승인하면 추가) |
| `task-request-ai.md` | 할 일 요청 AI로 만들기(메시지 → 요청한 사람·받는 사람 분석, 요청자 이름으로 대신 등록 `task_proxy_create`, 중복 방지) |
| `ai-inbox.md` | 실험실 만능창(한 칸 입력 → 할 일·요청·메모·서식(같은 글 고치기)·일정·교실(겹침 확인)·찾기, `ai-inbox` 함수) |
| `admin-insights.md` | 관리자 일반 교사로 보기(ks-menu.js가 createClient 감쌈), 기능별 사용 현황(`page_visit_daily`), 드라이브 백업(`db-backup`) |
