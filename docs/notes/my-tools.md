# 내가 만든 도구 (my-tools.html)

## 처음 만듦 (2026-10-23)
- 선생님이 챗봇에게 말로 설명 → AI가 단일 HTML 미니 도구를 만들어 미리보기 → 저장. 메뉴 "내 업무 › 내가 만든 도구" 한 곳에서 만들기·쓰기·말로 고치기·삭제·공유·"내 도구로 복사".
- 테이블: `diy_tools`(owner_id, owner_name, title, html, chat jsonb(최근 30개), shared) — RLS: 본인 전부, shared면 승인 회원 select, 삭제는 본인·관리자.
  `diy_tool_data`(tool_id, user_id, data jsonb) — 도구×사용자별 저장 한 칸, 본인만.
- Edge Function `diy-tool-builder`(verify_jwt:false+토큰·승인 확인, 기본 claude-sonnet-5-5·ai_models 슬러그, Gemini 폴백, logAiUsage, max_tokens 16000). 입력 {messages(최근 12), currentHtml}, 출력 {ok, reply, title, html}(```html 블록에서 추출). 소스 사본: 스크래치패드 diy-tool-builder/index.ts(세션 끝나면 사라짐 — Supabase가 원본).
- 실행은 `<iframe sandbox="allow-scripts allow-modals allow-downloads allow-forms">`(allow-same-origin 없음 → 출처 null, 부모·쿠키·localStorage 접근 불가). 저장은 srcdoc 앞에 넣는 다리 스크립트 `ksStore.load()/save(obj)` → postMessage → 부모가 diy_tool_data upsert(200KB 제한, e.source가 그 iframe일 때만). 미리보기의 저장은 메모리에만.
- 학생 개인정보를 도구 예시로 만들지 말라고 시스템 프롬프트에 명시. 외부 네트워크·CDN 금지(어차피 sandbox에서 막힘은 아니지만 도구는 자체 완결로).

## 파일 올리기·학교 DB 읽기 (2026-10-23)
- 다리에 `ksFile.pick({accept})`(iframe 안에서 input 클릭 → File을 부모로 postMessage → 부모가 SheetJS로 파싱: `{type:'sheet', sheets:[{name, rows}]}` / `{type:'text', text}`), `ksFile.saveXlsx(파일명, sheets)`(부모가 xlsx 만들어 내려받기), `ksDB.get(이름)` 추가.
- `ksDB` 이름: students(올해, 공개 비고만)·classes·staff(public_staff, 휴대폰 없음)·timetable(금 5→6 복사)·duty·events·school. 부모가 로그인 세션으로 읽고 페이지 안에서 캐시. 쓰기 없음. 민감 비고는 `school_private_notes`라 여기로 안 나감 — 새 이름을 추가할 때도 이 원칙 유지.
- 만들기 화면 "📎 자료": 붙인 파일의 구조(시트·앞 8행, 6000자 이내)를 사용자 메시지에 덧붙여 AI에 보냄(화면엔 파일명만). diy-tool-builder v2: 프롬프트에 API·자료 모양 추가, 메시지 길이 한도 8000자.
- CSV는 `raw:true`로 읽어야 "10/27" 같은 값이 날짜로 바뀌지 않음.
