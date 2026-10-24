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

## 복사·QR·도구 안 AI (2026-10-23)
- 다리에 `ksUtil.copy(text)`(부모가 clipboard → 실패 시 execCommand, true/false), `ksUtil.qr(text,{size})`(부모가 qrcodejs로 PNG data URL), `ksAI.ask(지시, 자료, {maxTokens})` 추가. 응답 대기 한도: ai 120초·file 60초·나머지 20초.
- `ksAI`는 새 Edge Function `diy-tool-ai`(v1, verify_jwt:false, 기본 haiku·`ai_models` slug, Gemini 폴백, logAiUsage). 지시 4000자·자료 3만 자, 1인 하루 60회(ai_usage_log 한국시간 오늘 개수로 판정).
- diy-tool-builder v3 프롬프트: 복사·QR·AI·PDF 버튼은 **선생님이 요청할 때만** 넣도록 명시. 템플릿 문자열 안 백틱은 반드시 `\``로.
- 학생 링크(학생이 로그인 없이 도구 쓰기)는 아직 없음 — 다음 작업.

## 학생 링크·학생 응답 (2026-10-23)
- `diy_tools`에 `public_token`(18자 무작위, unique)·`public_on`·`collect` 추가. 쓰기 화면의 "학생 링크"(주인만) 패널: 켜기(처음 켤 때 토큰 생성)·링크 복사·QR·새 링크(옛 링크 무효)·"학생 응답 받기"·받은 응답 표/엑셀/모두 지우기.
- 학생 페이지 `tool.html?t=토큰`(링크는 STUDENT_BASE_URL 도메인 → main 병합 후 동작). RPC `diy_tool_public(token)`(anon, 켜진 것만 title/html/collect). 같은 다리(BRIDGE·파일·엑셀·QR 함수 복사 — 바꾸면 my-tools와 두 곳 다). ksStore는 학생 기기 localStorage(`kstool:토큰`), ksDB·ksAI는 "학생 링크에서는 쓸 수 없는 기능" 오류.
- 응답: 다리 `ksSubmit.send(obj)` → `diy_tool_submit(token, data)`(SECURITY DEFINER, collect 켜진 것만, 20KB·도구당 5000개) → `diy_tool_responses`(주인만 select/delete, insert 정책 없음). 선생님 화면(쓰기·미리보기)에서는 저장 없이 통과만.
- diy-tool-builder v4: 프롬프트에 ksSubmit(요청할 때만, 이름 입력칸 필수, 두 번 누르기 방지)·학생 링크에서 ksDB/ksAI 불가 안내.

## 메뉴 위치 (2026-10)
- 내가 만든 도구를 KS_MENU "내 업무"에서 "관리" 그룹(실험실 바로 위, 관리자 전용 아님)으로 옮기고 처음 화면 타일은 뺌.
