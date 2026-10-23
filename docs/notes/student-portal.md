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
