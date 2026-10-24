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
