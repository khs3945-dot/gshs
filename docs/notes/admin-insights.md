# 관리자: 테스트 보기 · 기능별 사용 현황 · 드라이브 백업

## 테스트 보기 (2026-10, 처음 이름 "일반 교사로 보기")
- 관리 도구 카드 "테스트 보기" → localStorage `ks_view_as_teacher=1` → 처음 화면으로. 화면 아래 띠 "끄기"로 해제.
- `ks-menu.js` 맨 앞 IIFE가 `window.supabase`에 setter를 걸어 `createClient`를 감싸고, `from('profiles')` 결과의
  `is_admin`을 false로 바꿔요(Proxy로 builder 체인·then 감쌈). supabase-js보다 ks-menu.js가 먼저 실려야 함 —
  사이드바 페이지·head에 넣은 페이지 모두 해당. 서버 RLS는 그대로라 자료 양은 관리자 기준일 수 있음(화면만 미리 보기).
- 꺼져 있으면 아무것도 감싸지 않음. 켜져 있는 동안 방문 기록은 남기지 않음.

## 기능별 사용 현황 (`feature-usage.html`, 관리)
- nav.js `loadSiteNavState`가 로그인 확인 뒤 `log_page_visit(페이지키)` — `page_visit_daily(day, page, user_id, n)`에 하루·페이지·사람 한 줄.
  iframe 안·테스트 계정·미리 보기 중은 안 남김. 표에 select 정책 없음 — 관리자 RPC `page_usage_summary(days)`/`page_usage_daily(days)`가
  숫자만 돌려줌(누가 썼는지는 화면에 안 보임).
- 메뉴 이름은 KS_MENU, 실험실 페이지는 화면의 EXTRA 표. "아무도 안 연 메뉴"는 KS_MENU 기준.

## 드라이브 백업 (`BACKUP-SETUP.md`, `backup-apps-script.gs`)
- Edge Function `db-backup`(verify_jwt:false, 비밀값 `BACKUP_TOKEN` 일치할 때만): list(표·Storage·auth 계정) / table(ctid 순 200줄씩,
  응답 4MB까지 + next) / file(10분 서명 URL) / done(`backup_runs`에 결과).
- SQL 도우미 `backup_table_list`·`backup_table_page`·`backup_storage_list`는 service_role만 실행.
- 사용자 개인 Apps Script가 매주 zip(표마다 JSON) + Storage 파일 증분 복사, zip 8개 유지, 실패 시 메일. 서비스 사용량 Supabase 칸에 마지막 백업 표시(8일 지나면 주황).
- 테스트 계정("테스트…" 이름, `is_test`)은 만들지 않기로 — 시험은 테스트 보기로. `is_test` 처리 코드는 그대로 둠(해가 없음).
- 첫 실행(2026-10-24): 표 83개 9,317줄 33MB + 파일 27개, 약 3분 반. 한 번 실행 6분 제한에 가까워 표는 10개씩·파일은 5개씩 `UrlFetchApp.fetchAll`로 동시에 받게 바꿈.

## 관리자 대시보드 (`admin-dashboard.html`, 관리, 2026-10-24)
- 탭 7개: 처리할 일 · 서비스 한도(지금) · AI 사용량 · 사용 현황 · 백업 · 콘텐츠 흐름 · 시기별 점검(지금). 위에 "지금 확인할 것" 칩(승인 대기·요청·한도 70%↑·백업 8일·점검 실패).
- 기간: 최근 7/30/90일·이번 달·지난달·올해 학년도(3/1~) · 월 고르기 · 직접 날짜. 묶는 단위 일·주·월(자동: 45일 이하 일, 200일 이하 주, 그 이상 월). localStorage `ks_admin_dash_v1`, 탭은 `#ai` 같은 해시.
- 데이터: RPC `admin_dashboard(p_from, p_to)` 한 번(관리자만, 최대 800일) + `admin_usage_stats` + `app_settings.ai_model_pricing/netlify_credit` + `platform-usage` 함수(늦게 와도 한도 탭만 다시 그림).
  AI 비용은 ai_usage_log 토큰 × 단가(ai-usage와 같은 식)를 페이지에서 계산.
- 그래프는 라이브러리 없이 SVG(막대 ≤24px·윗모서리 4px·쌓기 2px 틈·가로 눈금선·마우스 올리면 툴팁·"표로 보기"), 숫자 올라가기·막대 차오르기 애니메이션(reduce-motion이면 끔).
  2계열 색 #4c5ff0/#eb6834(색약 검사 통과). 숨은 탭은 폭이 0이라 탭을 열 때 그림.
- 학년도 달력은 세로 목록(3월→2월, 한 달 한 줄 + 할 일 칩, 지난달 흐리게·이번 달 강조·다음 달 점).

## 엑셀 백업 (2026-10)
- `backup-apps-script.gs`에 `backupExcel_`: zip용으로 받은 표 자료로 구글 시트(시트마다 자료 하나, `EXCEL_SHEETS`)를 만들고 xlsx로 내보내 `엑셀` 폴더에 저장, 임시 시트는 휴지통. 교사·학생 시간표는 월1~금7 칸으로 펼침. 시험용 함수 `testExcelBackup`. 사용자가 스크립트를 바꿔 붙여넣고 한 번 실행해 스프레드시트 권한을 줘야 함.
- (고침) 한 파일 시트 묶음 → **페이지별 "엑셀로 받기"와 똑같은 파일들**(`엑셀/날짜_시각/`): 통합자료(data-hub `D[].export`와 같은 탭·머리글, 민감 비고 합침)·예산·학생시간표·수강배정·교실예약(예약ID)·회원명단·설문별 응답·기타. 글자 칸은 시트 서식 "@"로(2-6·날짜가 바뀌지 않게). 사이트 양식을 바꾸면 스크립트도 같이 고칠 것. 예산 가져오기는 이제 "담당" 열도 읽음.
- (고침) 학생시간표 백업: 페이지 엔진(`sttStudentGrid` 등)을 스크립트에 그대로 복사해, 저장 안 된 학생은 페이지처럼 "미리 보기" 계산 + "반 공통(참고)" 시트. **student-timetable.html 엔진을 고치면 스크립트 복사본도.**
- 확인 방법(2026-10): 같은 가짜 자료로 페이지 "엑셀로 받기" 결과와 스크립트 함수 결과를 칸마다 비교(통합자료 9탭·교사 시간표 양식·예산 2시트·학생시간표 2시트·수강배정 모두 일치), 백업 파일을 다시 올리면 "바뀐 것 없음", 자료를 망가뜨린 뒤 올리면 망가진 탭만 반영 대상으로 뜸.

## 광고 차단에 숨겨지던 문제 (2026-10)
- 삼성 인터넷(광고 차단)에서 제목·월 고르기·일별/주별·탭·패널이 안 보임 — 클래스가 `ad-head`·`ad-tabs`·`ad-panel` 등이라 광고로 보고 숨김. 클래스 `ad-*`→`dsh-*`, id `adX`→`dshX`, 바깥 `.ad`→`.dsh`로 바꿈.

## 서비스·AI·기능별 사용 현황을 대시보드 안으로 (2026-10)
- 서비스 한도·AI 사용량·사용 현황 탭 아래에 예전 페이지(service-usage·ai-usage·feature-usage)를 iframe으로 통째로 넣음(탭을 처음 열 때만 불러옴, 같은 사이트라 불러온 뒤 사이드바·위 막대·뒤로·h1 숨김 style을 넣고 ResizeObserver로 높이 맞춤, 안의 링크는 큰 창으로). 세 페이지는 KS_MENU에서 빼고 관리 도구 카드는 대시보드 탭(#limits·#ai·#usage)으로. nav.js는 iframe 안(`window.top !== window`)에선 방문 기록 안 남김.

## 설정 탭: 비밀번호 관리·테스트 보기 (2026-10)
- 옛 관리 도구(admin-tools.html)의 편집·열람·제출함 마스터 비밀번호 카드와 테스트 보기를 대시보드 `#settings` 탭으로 옮김(RENDER.settings, `pn.dataset.wired`로 두 번 걸림 방지, 대시보드 자료 없이도 열림, 기간 막대 숨김).
- admin-tools.html은 `#settings`로 넘겨주는 빈 페이지, KS_MENU에서 뺌. 비밀번호 바꾸는 곳은 이제 여기 하나.

## 이름 "관리자 메뉴" + 회원·그룹·자료 탭 (2026-10)
- 탭 줄 `flex-wrap`(많으면 두 줄). 탭: 처리할 일·회원 관리·교사 그룹·자료 한번에 관리·서비스 한도·AI 사용량·사용 현황·백업·콘텐츠 흐름·시기별 점검·설정.
- 회원·그룹·자료 탭은 페이지를 통째로 넣은 iframe(`.dsh-embed.fixed`, `data-fixed`): 높이 = 화면 높이(안에서 스크롤) — 자동 높이로 하면 position:fixed 창(모달)이 iframe 맨 위에 떠서 안 보임. "새 창으로 열기 ↗".
- KS_MENU에서 세 페이지는 `hidden: true`로 남김(사이드바엔 안 보이고 🔍 검색·관리자만 막기(adminOnly)·사용 현황 이름표는 그대로). 대시보드 안 "회원 관리 →" 등은 `#members`·`#datahub` 탭 링크.
