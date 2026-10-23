# 학생 페이지 (실험실, student-portal.html · student.html)

## 첫 버전 (2026-10-23)
- 결정(사용자): 개인 링크·QR + 비밀번호 / 비밀번호 자동 생성 + 엑셀 / **보낸 선생님만 자기 자료를 봄**(관리자는 전부) / 수업 시간표는 처음엔 뺌.
- 테이블: `student_portal_accounts`(year·grade·class_no·no PK, token, pw_hash(bcrypt), pw_set_by(_name/_at), failed, locked_until — **정책 없음, RPC로만**), `student_portal_class_links`(반 QR 토큰, 정책 없음), `student_portal_items`(kind notice/account/exam/link, title, body, url, exam_id, starts_at, ends_at — 본인·관리자만), `student_portal_targets`(item×학생, payload jsonb — 계정은 `{cols:[[열이름,값],...]}` 순서 유지).
- RPC(선생님, 승인 회원): `portal_class_accounts`(없는 학생 계정·토큰 자동 생성), `portal_class_link`, `portal_set_passwords([{no,pw}])`(4~30자, bcrypt), `portal_reset_token`, `portal_preview`(내 자료만, 관리자는 전부).
- RPC(학생, anon): `portal_view(token,pw)`, `portal_class_numbers(ctoken)`(비밀번호 있는 번호만), `portal_view_class(ctoken,no,pw)`. 5번 틀리면 10분 잠금(`portal_check`). 기간(starts~ends) 안의 자료만. 시험은 `exam_timetable_data.student_link_secret`로 exam-view 학생 토큰을 서버에서 계산해 링크(`exam-view.html?id&s=학년-반-번호&t`).
- 선생님 화면: ① 반 명단·비밀번호(새 비밀번호는 그 화면에서만 보이고 엑셀로 받기 — 서버엔 해시만)·개인 링크 복사/QR·미리보기·반 QR ② 보내기(공지/계정 안내 엑셀(학번 5자리 또는 학년·반·번호 열, 이름 열은 학생에게 안 보냄)/시험/링크, 기간, 반 체크 또는 ① 표 체크 학생) ③ 내가 보낸 자료(지금 내리기·다시 7일·삭제).
- 학생 화면 `student.html`(학생 도메인, nav.js 없음): ?k=개인 토큰 또는 ?c=반 토큰(번호 고르기) + 비밀번호. sessionStorage(로그인 유지 체크 시 localStorage)에 {no,pw}. 내 링크 공유·QR·나가기. 자료 그리기 `spItemHtml`은 두 페이지 복사본.
- MCP에서 DELETE가 타임아웃이라 테스트 행 1개(`[테스트 — 지워도 됨]`, 이미 기간 지남)와 2099년 테스트 계정 1개가 남아 있음 — 관리자 화면 ③에서 삭제 가능.
- 다음 할 일: 다른 페이지(시험 시간표·내가 만든 도구·설문)에 "학생 페이지에 전송" 버튼, 수업 시간표.

## 파일 배포는 드라이브로 (2026-10-23)
- Supabase 저장공간을 아끼려고 kind `file` 추가(`student_portal_items.files` jsonb [{id,name,size}], kind check에 file). 선생님이 고른 파일(최대 10개·각 25MB)을 제출함과 같은 Apps Script로 하나씩 올림: 새 action `portalUploadFiles`(드라이브 "경성고 학생 배포 자료/<자료 제목>", 링크 공유 보기) — **사용자가 Apps Script 재배포해야 동작**, 그 전에는 '알 수 없는 요청'이면 기존 `taskUploadFile`("경성고 업무 첨부파일" 폴더)로 대신 올림.
- 학생 화면: 파일마다 보기(drive file/d/ID/view)·내려받기(uc?export=download&id=ID). `portal_items_json`이 files를 넘김.

## 이름·탭 정리 (2026-10-23)
- 실험실 메뉴 이름 "학생 개인 페이지 관리"(로그인·승인된 선생님 누구나). 페이지는 탭 3개: 학생에게 자료 보내기(기본) / 보낸 자료·기간(시작·끝 날짜 직접 고쳐 "기간 저장", 지금 내리기·다시 7일·삭제) / 학생 링크·비밀번호. 마지막 탭은 sessionStorage `spPage`로 기억.

## 미리보기에 다른 선생님 자료 자리 표시
- `portal_preview`가 `others`도 돌려준다: 같은 학생에게 지금 보이는 다른 선생님 자료의 종류·보낸 사람·기간만(제목·본문·링크·파일·계정값은 서버에서 아예 안 보냄). 관리자는 `items`에 전부 오므로 `others`는 빈 배열.
- 화면은 `maskedItemHtml` — 점선 회색 카드 "다른 선생님 자료" + 회색 줄 자리표시, 학생 화면과 같은 순서(starts_at 내림차순)로 섞어 보여 준다.

## 새 학년 진급 반영(관리자)
- 학생 링크·비밀번호 탭 아래 `#promoteBox`(관리자만). 나이스 진급 엑셀(이전 학번→새 학번·성명)을 올리면 `portal_promote(p_from, p_to=p_from+1, p_rows, p_apply)`로 먼저 미리 확인 → "이대로 반영하기".
- 계정 행의 키(year/grade/class_no/no)만 바꿔서 **token·pw_hash 그대로** → 학생 링크·비밀번호가 이어진다. 잠금·실패 횟수는 초기화.
- 건너뜀: 파일 이름이 이전/새 명렬 이름과 다르면(오매칭 방지), 새 학번에 이미 비밀번호가 있으면. 새 학번에 비밀번호 없는 빈 계정만 있으면 지우고 옮김.
- 새 학년도 `students`에 그 학번이 없으면 (학년도·학번·이름)만 추가(비고는 안 옮김 — 민감 비고 규칙). 반 QR(`student_portal_class_links`)과 이전 학번으로 보낸 자료는 옮기지 않음.
- 머리글 읽기 `parsePromote`: "이전학번/학번", "진급전학번/진급후학번", "이전 학년·이전 반·이전 번호", 두 줄 병합 머리글("이전"·"진급 후" 아래 학년/반/번호) 모두 처리. 나이스 실제 파일 양식은 아직 확인 못 함.

## 학생 진급 페이지(`student-promote.html`, 관리 메뉴·관리자만)
- 학생 개인 페이지 관리에 있던 진급 상자를 독립 페이지로 옮김(그 자리에는 관리자에게만 링크 안내). 서버는 그대로 `portal_promote`.
- ① 양식 받기: 이전 학년·반·번호·이름 | 신규 학년·반·번호·이름. "이전 학년도 명렬 채워서 받기"(students를 1000행씩 나눠 읽음, 3학년 빼기 기본) / 빈 양식.
- ② 파일 여러 개 한꺼번에: 이 양식 또는 나이스 **학교생활기록부 학년이력**(반별). 학년이력은 머리글 "학 년 이 력" 아래 학년/반/번호, 학생마다 학년별로 한 줄(번호·성명은 첫 줄만) → 마지막 줄=신규, 그 위=이전.
  인쇄 쪽마다 머리글이 다시 나오고 쪽을 넘긴 학생은 번호·이름이 다시 찍힘 → 머리글 줄은 건너뛰고 같은 번호+이름은 이어 붙임. 이력 한 줄뿐(전입)은 건너뜀. 완전히 같은 줄은 하나로.
- 확인 열: 신규/이전 학번 겹침(신규 겹치면 반영 버튼 숨김), 학년이 +1이 아님, 이전·신규 이름 다름.
- 신입·전입: 이전 칸이 빈 줄(양식)·이력이 한 줄뿐인 학생(학년이력)은 og/oc/on=null로 보내 새 명렬에만 추가(`portal_promote`가 `new_only`로 셈, 계정 옮기기 없음). 표에 "신입·전입" 배지.

## 보내기 점검·학번 붙여넣기·학생별 파일·내려받기·보호 모드 (2026-10-23)
- 명렬 캐시 `loadAllStudents()`(이 학년도 students 1000행씩) + `codeToKey`(10101 / 1-1-1) + `parseCodes`.
- 계정 엑셀: 읽은 줄 수·보낼 학생 수, 학번 못 읽은 줄, **명렬에 없는 학번(안 보냄)**, 같은 학번 여러 줄(마지막 줄), 이름 다름(학번 기준), 앞 3명 미리보기 표(`.sp-check`).
- 받는 학생: `#tCodes`에 학번을 쉼표·공백·줄바꿈으로 붙여넣으면 반 선택·체크보다 우선. 입력 즉시 몇 명·명렬에 없는 학번 표시.
- 파일: "학생마다 다른 파일" 모드(`fMode=each`) — 파일 이름 속 학번으로 학생을 찾아 각자 `payload.files`에(최대 400개). 학번 없는/명렬에 없는 파일은 빼고 알려 줌. 렌더러는 `it.files + payload.files`.
- `student_portal_items.allow_download`(기본 true)·`protect`(기본 false) 추가, `portal_items_json`이 `dl`·`protect`를 돌려줌.
  내려받기 끄면 학생 화면은 '보기'만 + Apps Script `portalUploadFiles`에 `noDownload` → `copyRequiresWriterPermission`(고급 서비스 Drive API 필요, 없으면 `lockFailed`로 알려 줌).
- 보호 모드: 학번·이름·날짜 워터마크(`spWatermark`, SVG 배경), 복사·오른쪽 클릭·선택·끌기 막기, 창을 벗어나거나 PrintScreen·인쇄 때 흐리게(`body.sp-veil`). **스크린샷 자체는 웹에서 막을 수 없음**(특히 휴대폰) — 화면에도 그렇게 안내.
- 미리보기: 휴대폰에서 버튼이 표 오른쪽 밖(가로 스크롤)에 있어 안 보이던 문제 → 좁은 화면은 명단을 카드형으로 쌓고, 학생 이름을 눌러도 미리보기. 미리보기 맨 위에 학생 페이지 머리(학년·반·번호·이름) + 워터마크.
