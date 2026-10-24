# 메신저·메모 AI 분석 (실험실, `msg-triage.html`, 옛 이름 메신저 정리)

## 처음 만듦
- 메신저 글 붙여넣기 + 스크린샷(최대 4장, 파일·끌어놓기·Ctrl+V, 긴 변 1600px JPEG로 줄여 base64 전송 — 저장 안 함) → Edge Function `msg-triage`.
- `msg-triage`(verify_jwt false, 함수 안에서 승인 회원 확인): Claude `output_config.format` json_schema → 실패 시 Gemini. `logAiUsage`, 1인 하루 60회(`ai_usage_log` 기준). 오늘 날짜(KST·요일)를 넣어 "내일/다음 주 금요일"을 날짜로 바꾸게 함. 기존 할 일 분류(로컬 `tasks.category` + MS 목록 이름)와 메모 라벨을 함께 보내 그중에서 고르게 함.
- 결과 항목 `{type todo|memo, title, detail, due, due_time, category, labels, from, quote, confidence}` — 카드마다 할 일/메모 전환, 제목·내용·기한 수정, 추가/버리기, "남은 것 모두 추가/버리기".
- 할 일 저장: 교무 도구(`tasks` insert + `task_assignments` 본인 1줄, `category`·`notes`·`due_at`) 또는 MS To Do(분류 = 목록 이름, 없으면 만들고, 비우면 기본 목록; my-todo와 같은 MSAL 설정·`ms-auth-callback.html`). 기본 저장 위치는 localStorage `ks_msg_triage_prefs`.
- 메모 저장: `memos {owner_id,title,content,labels}` — 날짜·보낸 곳은 내용 끝에 덧붙임.
- 학생 민감 사정은 AI가 "학생 개인 사정"처럼 줄여 쓰도록 프롬프트에 넣음.

## 이름 바꿈 + 파일 올리기 + 서식·양식 제안
- 이름 "메신저·메모 AI 분석". 파일 올리기: 그림은 스크린샷처럼, PDF(글 없으면 앞 4쪽을 그림으로)·.hwpx·.docx·텍스트는 글을 뽑아 `[파일: 이름]`으로 붙여 보냄(40,000자까지). form-board 자동 입력과 같은 방식.
- `msg-triage` v2: type에 `form`(되풀이되는 업무 절차·기안 문안·공통 안내) 추가, `secret`(잠글 값) 칸, `formCategories`(서식 카테고리 목록)를 받음.
- 서식 승인 → `form_templates` insert(본문은 "- " 줄을 목록으로 바꾼 HTML) + 잠금이면 `form_secret_set`.

## 결과 촘촘하게 + 체크 선택 + 할 일 분류 기억
- 카드: 1줄(체크·할 일/메모/서식·제목·근거(마우스 올리면 보낸 곳·원문)·버리기·추가) + 2줄(내용(field-sizing, 최대 3줄)·칸들). 처리된 항목은 한 줄로. 모바일은 제목을 둘째 줄 전체로.
- 체크 선택: "전체 선택", "선택 승인(추가) n", "선택 버리기 n"(`SEL` = ITEMS 번호).
- 할 일 분류는 저장 위치별로 마지막 값을 기억(localStorage `ks_msg_triage_prefs.todoCat = {local, ms}`) → 다음 분석의 할 일에 자동으로 넣음(기억이 없으면 AI 제안). 한 카드에서 분류를 바꾸면 아직 손대지 않은 같은 위치의 다른 할 일에도 넣음. 할 일 분류(`tcat`)와 서식 카테고리(`fcat`)는 따로 들고 있음.
- 붙여넣기·끌어놓기를 페이지 전체로: `document` paste(파일이 있을 때만 가로챔)·dragenter/over/drop(파일일 때만, 넣는 칸 강조). "📋 붙여넣기" 버튼은 `navigator.clipboard.read()`(그림·글) — 안 되는 브라우저는 Ctrl+V 안내.

## AI 업무 도우미로 합침 (2026-10)
- 메뉴에서 뺌(KS_MENU `hidden: true` — 🔍 검색·주소는 그대로), index 타일 삭제, 페이지 맨 위에 "AI 업무 도우미로 가기" 안내. 설명서는 ai-inbox 쪽 FAQ로만.
- Edge Function `msg-triage`는 그대로 둠(페이지가 남아 있어서). 완전히 지우려면 페이지·함수·설명서를 같이.
