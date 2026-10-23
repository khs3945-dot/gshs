# 학기 업무 흐름 체크리스트 (`work-flow.html`, 실험실)

## 처음 만듦 (2026-10-23)
- 원본: 사용자의 학교 메신저(2021~2026) 정리본 "월별 업무" → 달별 항목 107개(담임 41)로 큐레이션해 DB에 넣음. **내용은 DB에만**(공개 저장소라 HTML에 넣지 않음).
- 테이블 `work_flow_items`(yorder 0=새 학년 준비(2월)·1=3월…10=12월·11=1월·12=학년말(2월), month, phase, sort, title, detail, homeroom, who, monthly, form_hint) — 승인 회원 select, 관리자만 쓰기.
  `work_flow_checks`(user_id, item_id, school_year) — 본인 것만. 학년도는 3월 시작(2월 15일부터 새 학년 준비로 봄).
- 화면: 달 칩(진행 n/m, 지금 달 강조·자동 스크롤) → 달 카드(단계 배지·진행 막대·항목). 담임 업무는 제목 앞 분홍 점, 매월 하는 일은 "매월" 태그(3월에 한 번만 둠), `form_hint`가 있으면 "서식 보기 →"(form-board ?q=).
  "담임 업무 숨기기"·"끝낸 일 숨기기"는 localStorage(`ks_workflow_prefs`). 관리자는 "항목 편집"으로 추가·수정·삭제(모달).
