# 할 일 요청 — AI로 만들기 (`task-assign.html`)

## 처음 만듦
- 할 일 요청 페이지 위 "✨ AI로 할 일 요청 만들기"(늘 펼침): 글 붙여넣기·스크린샷(Ctrl+V·끌어놓기, 4장)·파일(PDF·hwpx·docx·txt) → Edge Function `task-request-ai`(Claude json_schema → Gemini, 하루 60회, verify_jwt false + 승인 회원 확인). 선생님 이름 목록·부서 목록·내 이름을 함께 보내 이름을 그대로 고르게 함.
- 결과 `{requester, assignees[], assignee_groups[], title, detail, due, due_time, quote, confidence}` → 페이지에서 `public_profiles`로 이름→id(같은 이름이면 부서 표시), 무리("전체"·"담임 전체"·"N학년 담임"·부서명)는 is_homeroom·homeroom_class·department로 풀어 받는 사람에 넣음. 명단에 없는 이름은 경고(가입 전).
- 만들기: RPC `task_proxy_create(p_owner, p_title, p_notes, p_due, p_assignees)` — 승인 회원만, 요청자·받는 사람은 승인·활성 회원만, **같은 요청자·같은 제목(공백 무시) 60일 안이면 만들지 않음(dup)** → 여러 선생님이 같은 메시지를 넣어도 한 번만. `tasks.created_by`·`proxy_by_name`에 실제로 만든 사람, 내용 끝에 "○○○ 선생님이 … 대신 등록했어요". 요청자에겐 "요청한 일", 받는 사람에겐 "받은 일"로 보임(owner_id = 요청자).
- 되돌리기: `task_proxy_undo(p_id)` — 만든 사람이 하루 안에만. 만든 뒤 아래 목록(iframe my-page blockAssignedBody)을 새로 고침.
- 카드: 체크·제목·근거·버리기·만들기 / 요청한 사람 고르기 → 받는 사람 칩(✕)·더하기(무리·사람)·기한 / 내용. "전체 선택·선택 만들기·선택 버리기".
