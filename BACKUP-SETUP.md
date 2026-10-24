# Supabase → 구글 드라이브 정기 백업 설정

Supabase 무료 프로젝트는 **7일 동안 아무도 안 쓰면 일시 정지**되고, 정지된 채 오래(90일 안팎) 두면 복구가 어려워질 수 있어요.
이 백업은 매주 한 번 Supabase 자료를 내 구글 드라이브에 zip으로 받아 두고, 그 자체로 Supabase를 "사용 중"으로 만들어 줘요.

- 무엇이 들어가나: 데이터베이스 public 표 전부(표마다 JSON), 가입 계정 목록(이메일·가입일 — 비밀번호는 빠짐),
  Storage 파일(드라이브 `파일` 폴더에 바뀐 것만 복사).
- 어디에: 이 스크립트를 만든 구글 계정의 드라이브 `교무도구 Supabase 백업` 폴더. zip은 최근 8개만 남겨요.
- 확인: 관리 › 서비스 사용량 Supabase 칸의 **💾 드라이브 백업** 줄(8일 넘게 없으면 주황색). 실패하면 메일이 와요.
- ⚠️ 학생 민감 비고·계정 정보도 들어가요. **백업 폴더는 공유하지 마세요.** 학교 Workspace 말고 관리자 개인 계정 드라이브도 괜찮아요.

## 1. 비밀값(토큰) 정하기 — 한 번만
1. 20자 이상 아무도 모를 긴 문자열을 하나 정해요(예: 비밀번호 생성기로 만든 영문·숫자 32자). **어디에도 올리지 마세요.**
2. [Supabase → Edge Functions → Secrets](https://supabase.com/dashboard/project/tmssupuskkajahpuswcj/functions/secrets)에
   이름 `BACKUP_TOKEN`, 값에 그 문자열 → Save.

## 2. Apps Script 만들기 — 한 번만
1. [script.google.com](https://script.google.com) → **새 프로젝트**, 이름 `교무도구 백업`.
2. `Code.gs` 내용을 모두 지우고 저장소의 `backup-apps-script.gs` 내용을 그대로 붙여넣기 → 저장.
3. 왼쪽 ⚙️ **프로젝트 설정 → 스크립트 속성 → 속성 추가**: 이름 `BACKUP_TOKEN`, 값은 1번의 같은 문자열 → 저장.
4. 편집기 위쪽 함수 고르기에서 `backupSupabase` → **실행** → 권한 허용(드라이브·외부 연결·메일).
   몇 분 뒤 드라이브에 `교무도구 Supabase 백업/supabase-날짜.zip`이 생기면 성공.
5. 함수 `setupWeeklyTrigger`를 한 번 **실행** → 이제 매주 일요일 새벽 3~4시에 자동으로 돌아요
   (왼쪽 ⏰ 트리거 메뉴에서 확인·삭제. 매일로 바꾸려면 트리거를 지우고 "시간 기반 → 일 단위"로 새로 만들기).

## 되살릴 때(필요할 때만)
- zip을 풀면 `표이름.json`(행 배열)이 있어요. 새 Supabase 프로젝트에 스키마(표 구조)를 먼저 만든 뒤 표마다 넣어요 —
  Claude Code에 "백업 zip으로 복구해 줘"라고 맡기면 돼요. 스키마는 Supabase 대시보드 Database → Backups 또는 마이그레이션 기록에도 있어요.
- `_manifest.json`에 백업 시각·표 목록·파일 목록이, `_auth_users.json`에 계정 id↔이메일이 있어요(로그인 계정은 다시 초대해야 해요).
- Edge Function 소스는 git에 없으니(CLAUDE.md), 함수가 사라지면 대시보드의 함수 목록을 보고 다시 만들어야 해요.
