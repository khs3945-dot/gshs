# 학생부 점검 (실험실, record-check.html)

## 첫 버전 (2026-10-23)
- 흐름: ① 점검 규칙(저장된 규칙 고르기 또는 지침 파일로 새로 만들기) → ② 학생부 엑셀/CSV → ③ 규칙 점검(무료, 브라우저) / AI 점검(문맥 규칙만).
- 지침 파일 글 추출(브라우저): PDF(pdf.js, 줄 단위+쪽 표시), .hwpx(JSZip `Contents/section*.xml`의 태그 제거), .docx(`word/document.xml`), txt/md. .hwp는 못 읽음 → PDF/.hwpx로 저장 안내. 4만 자씩 나눠 AI에.
- Edge Function `record-check`(v1, verify_jwt:false): mode `rules`(기본 sonnet, 로그 이름 `record-check-rules`, 하루 40회) → 규칙 JSON(type words/regex/length/ai, area, severity, message, source), mode `check`(기본 haiku 4.5, 로그 `record-check`, 하루 150회) → 항목별 issues. json_schema 구조화 출력, 400이면 형식 없이 재시도, Gemini 폴백. ai_models 슬러그도 두 이름.
- 규칙 병합: 같은 영역·설명의 words는 낱말 합침, 잘못된 정규식·빈 규칙 버림. 표에서 켜기/끄기·종류·영역·내용·설명·금지/주의 수정, 추가·삭제.
- 테이블 `record_check_rulesets`(승인 회원 모두 읽기, 만든 사람·관리자만 수정/삭제 — 남의 규칙을 고치면 내 이름으로 새로 저장), `record_check_cache`(owner+hash(규칙 서명|영역|글) → issues, 본인만) — 같은 글은 AI 다시 안 부름.
- 학생부 엑셀: 머리글로 번호·성명·영역·과목·내용(긴 형식) 또는 자율/동아리/진로/행동특성/세특 열(넓은 형식). AI에는 이름 빼고 key·영역·과목·글만. 나이스 실제 학생부 파일 형식은 아직 못 봄 — 예시 받으면 맞출 것.
- 비용 어림(전교 580명×약 7천 자): sonnet 한 번 전체 1.5~2만 원, haiku 약 1만 원. 규칙 점검은 무료.

## 기재요령 질문하기 (2026-10-23)
- 페이지 맨 위 카드. 지침 글 원문은 `record_guide_docs`(title, content, chars, created_by, created_by_name — 승인 회원 읽기·등록, 만든 사람·관리자 수정/삭제)에. "지침 관리"에서 파일 등록, 또는 규칙 만들기에서 읽은 파일을 "질문 상자에도 등록".
- 검색은 브라우저에서: 글을 약 1,200자 조각으로(PDF는 `[n쪽]` 표시로 쪽 계산, 쪽이 바뀌면 600자 넘은 조각을 끊음) → 질문 낱말(조사 떼고 2자 이상)의 두 글자 묶음 TF-IDF + 3자 이상 낱말 일치 가산 → 상위 최대 10조각·2.4만 자.
- Edge `record-check` v2에 mode `qa`(sonnet 5.5, 로그 이름 `record-guide-qa`, 하루 80회, 발췌 ≤3만 자): 발췌만 근거로 답, [번호] 인용, `{answer, used, found}`. 못 찾으면 found=false + "찾지 못했어요".
- 화면: 답의 [n] 누르면 해당 근거 원문 펼침, 질문 낱말 노랑 표시 후 첫 표시 위치로 스크롤. 쓰지 않은 발췌는 "(참고만)".
