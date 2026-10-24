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
