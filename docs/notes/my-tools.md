# 내가 만든 도구 (my-tools.html)

## 처음 만듦 (2026-10-23)
- 선생님이 챗봇에게 말로 설명 → AI가 단일 HTML 미니 도구를 만들어 미리보기 → 저장. 메뉴 "내 업무 › 내가 만든 도구" 한 곳에서 만들기·쓰기·말로 고치기·삭제·공유·"내 도구로 복사".
- 테이블: `diy_tools`(owner_id, owner_name, title, html, chat jsonb(최근 30개), shared) — RLS: 본인 전부, shared면 승인 회원 select, 삭제는 본인·관리자.
  `diy_tool_data`(tool_id, user_id, data jsonb) — 도구×사용자별 저장 한 칸, 본인만.
- Edge Function `diy-tool-builder`(verify_jwt:false+토큰·승인 확인, 기본 claude-sonnet-5-5·ai_models 슬러그, Gemini 폴백, logAiUsage, max_tokens 16000). 입력 {messages(최근 12), currentHtml}, 출력 {ok, reply, title, html}(```html 블록에서 추출). 소스 사본: 스크래치패드 diy-tool-builder/index.ts(세션 끝나면 사라짐 — Supabase가 원본).
- 실행은 `<iframe sandbox="allow-scripts allow-modals allow-downloads allow-forms">`(allow-same-origin 없음 → 출처 null, 부모·쿠키·localStorage 접근 불가). 저장은 srcdoc 앞에 넣는 다리 스크립트 `ksStore.load()/save(obj)` → postMessage → 부모가 diy_tool_data upsert(200KB 제한, e.source가 그 iframe일 때만). 미리보기의 저장은 메모리에만.
- 학생 개인정보를 도구 예시로 만들지 말라고 시스템 프롬프트에 명시. 외부 네트워크·CDN 금지(어차피 sandbox에서 막힘은 아니지만 도구는 자체 완결로).
