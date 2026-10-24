# student-chatbots — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

## Student-facing chatbot links use a separate, fixed domain

The main site is one Netlify deploy of this whole repo (teacher tools, admin
pages, everything). Student-facing `bot.html` pages (created via
`chatbot-builder.html`, PIN/slug-protected — see below) are additionally served
from `https://inspiring-macaron-9aabd8.netlify.app/`, a **second** Netlify site
deployed from this same repo/branch — same code and same Supabase backend, just a
separate domain so students never see or stumble into the teacher-only pages'
URLs. `chatbot-builder.html`'s `renderEditor()` builds the "학생 공유 링크"
(`shareUrl`) from a hardcoded `STUDENT_BOT_BASE_URL` constant rather than
`location.origin` — it used to be `location.origin`-based, which meant the
generated link's domain depended on which domain the teacher happened to have
`chatbot-builder.html` open on. Since this is a plain constant (not derived from
`app_settings` or any other per-request state), changing the student domain later
means editing that one constant and redeploying — no migration needed.

**학생 공유 링크 옆에 QR 코드도 함께 보여준다** (`chatbot-builder.html`'s
share-box, 링크+암호 복사 버튼들 바로 아래). 교실에서 학생들에게 링크를 타이핑
시키는 대신 QR 한 번 찍고 들어오게 하기 위한 순수 클라이언트 기능 — `shareUrl`
문자열을 그대로 인코딩할 뿐이라 서버 호출이나 새 테이블이 전혀 필요 없다.
`qrcodejs`(davidshimjs, npm 미러 패키지명 `qrcodejs`, jsdelivr:
`https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js`)를 쓴다 — **이
저장소에서 더 널리 알려진 `qrcode`(soldair/node-qrcode) 패키지를 쓰지 않은 이유**:
그 패키지는 `package.json`의 `files`가 `build`를 포함한다고 적어두고 있지만
실제로 npm에 배포된 tarball에는 `build/` 폴더가 들어있지 않아서(패키지 자체의
알려진 결함), `cdn.jsdelivr.net/npm/qrcode@.../build/qrcode.min.js` 같은 흔히
보이는 CDN 경로가 실제로는 404난다 — 직접 `npm pack`으로 받아서 확인하고 나서
dropped. `qrcodejs`는 `new QRCode(엘리먼트, {text, width, height,
correctLevel})` 호출 한 번으로 그 엘리먼트 안에 `<canvas>`를 직접 그려 넣는 구식
(생성자 기반) API라 `renderEditor()`가 다시 그릴 때마다(다른 챗봇으로 전환하거나
편집기를 다시 열 때) `#shareQrBox.innerHTML = ''`로 먼저 비워야 한다 — 안 비우면
같은 엘리먼트에 캔버스가 계속 누적돼서 겹쳐 그려진다. "QR 이미지 다운로드"
버튼은 그 안의 `<canvas>`를 찾아 `toDataURL('image/png')`로 변환해 임시
`<a download>` 링크를 클릭해주는 흔한 패턴 — 파일명은 `${챗봇 제목}_QR.png`.

**"QR 이미지 복사" 버튼도 있다** (다운로드 버튼 바로 옆, 먼저) — 파일로 내려받았다가
다시 첨부하는 과정 없이 한글/문서/메신저 등에 바로 Ctrl+V로 붙여넣을 수 있게 하기
위해서다. `navigator.clipboard.write([new ClipboardItem({'image/png': <Promise>})])`를
쓰는데, `canvas.toBlob()`의 콜백을 `ClipboardItem`에 **Promise로 감싸서** 넘기는
게 핵심이다 — 이렇게 하면 blob 생성이 비동기로 끝나더라도 `clipboard.write()` 호출
자체는 클릭 핸들러 안에서 동기적으로 이뤄진 것으로 브라우저가 간주해서, "사용자
동작(user gesture) 중에만 클립보드 쓰기를 허용"하는 보안 정책을 통과한다(`await
canvas.toBlob()`처럼 먼저 기다렸다가 `clipboard.write()`를 나중에 호출하면 이 정책에
걸려 실패하는 브라우저가 있다). `navigator.clipboard`나 `window.ClipboardItem`이 없는
구형 브라우저에서는 그냥 실패 메시지로 "QR 이미지 다운로드"를 대신 쓰라고 안내한다.

**챗봇 목록 카드(`.bot-row`)를 클릭하면 바로 편집 화면이 열린다 — 예전엔 행 오른쪽의
별도 "편집" 버튼(`.botEditBtn`)을 따로 눌러야 했다.** 이 행에서 할 수 있는 동작이
편집 하나뿐이라, 버튼 없이 행 전체를 누르는 쪽이 더 자연스럽다는 요청으로 바꿨다 —
`.bot-row`에 `cursor:pointer`를 주고 클릭 리스너를 (버튼이 아니라) 행 자체에
위임했고, 행 오른쪽엔 버튼 대신 단순한 `›` 화살표(`.row-arrow`, 클릭 핸들러 없음 —
순전히 "눌러서 들어갈 수 있다"는 시각적 힌트)만 남겼다. 이 변경으로 그동안
`.botEditBtn`을 클릭해 편집기를 열던 여러 테스트 파일(`test_bot_expiry_field.js`,
`test_bot_expiry_position.js`, `test_builder_assistant_fab.js`,
`test_chatbot_export_excel.js`, `test_chatbot_notes_teacher_view.js`,
`test_chatbot_qr.js`, `test_chatbot_qr_copy.js`, `test_student_bot_share_domain.js`,
`test_chatbot_builder_share.js`)가 전부 `.bot-row`를 클릭하도록 함께 고쳐져야 했다 —
`.bot-row .name` 같은 행 내부 요소를 읽는 부분은 구조가 안 바뀌어서 그대로 뒀다.

## Student chatbot sessions (`bot.html` + `student-bot-chat`) resume by name+학번

Each PIN entry on `bot.html` creates a `custom_bot_sessions` row identified by an
opaque `session_token`, kept client-side only in `sessionStorage` (per-tab, keyed
`ks_bot_session_<slug>`) — so a page refresh survives, but a closed tab or a
different device never did, and every re-visit used to start a brand-new, empty
session even for the same student. `student-bot-chat`'s `start` action now looks
up an existing session **only when the bot collects both name and 학번**
(`bot.collect_name && bot.collect_student_no`) — matching on both is required
because 학번 alone is reliably unique per student but name alone is not (동명이인),
so a single-field bot always starts fresh rather than risk merging two different
students' conversations under a typo or a shared name. When both are collected and
an exact `bot_id + student_name + student_no` match exists (picking the most
recently active one if a student somehow has more than one), the response carries
`resumed: true` plus up to `RESUME_HISTORY_LIMIT` (60) prior messages, which
`bot.html` renders into the chat view before the student sends anything new — so
returning to the same bot on any device, after any amount of time, continues the
same conversation instead of losing it. The AI's own context already worked this
way regardless (the `chat` action always reads `custom_bot_messages` by
`session_id`); this change is what makes the *student* see that same continuity
rather than just the model.

**Edge Function code has no backup outside Supabase itself — this bit us once.**
On 2026-09-29, `student-bot-chat`'s deployed source was found corrupted to the
literal 8-character string `SEE_FILE` (not a placeholder — the actual deployed
`index.ts` body), crashing every invocation with `ReferenceError: SEE_FILE is not
defined` and taking every student bot down (`bot.html` showed "서버에 연결하지
못했어요" for every PIN/message). Since this repo deliberately doesn't check Edge
Function source into git (see "Deployment / infrastructure" above), there was no
previous version to roll back to — recovery meant reconstructing the function
from scratch by cross-referencing this file's documentation, `bot.html`'s actual
request/response contract, the live DB schema (`custom_bots`/`custom_bot_sessions`/
`custom_bot_messages`/`custom_bot_chunks`, RLS policies, the `match_custom_bot_chunks`
RPC), and a working sibling function (`personal-bot-chat`) for shared conventions
(CORS headers, the `json()`/`corsHeaders()` helper shapes, Gemini call patterns).
The rebuilt function additionally documents behavior that wasn't written down
elsewhere: `custom_bots.pin` is a plain 4-digit numeric string with **no hashing**
(`chatbot-builder.html` reads it straight back for the teacher to relay to
students, so there's nothing to hash against), guarded by `failed_pin_attempts`/
`pin_locked_until` (5 wrong attempts locks the bot's PIN entry for 10 minutes);
`preset_type` (`guide`/`inquiry`/`summary`, chosen in `chatbot-builder.html`'s
"안내형"/"탐구형"/"요약형" cards) maps to a distinct system-prompt instruction
layered under the teacher's own free-text `system_prompt`; the `chat` action
streams by calling Gemini's `:streamGenerateContent?alt=sse` endpoint and
re-emitting only the extracted text deltas as raw bytes (not the SSE envelope)
since `bot.html`'s reader loop appends whatever bytes arrive directly to the
screen with no SSE parsing of its own. If you ever touch this function again,
consider keeping a copy of its source in this repo (even just as a reference
file never actually deployed from) precisely because this one has no other
backup — unlike every other Edge Function here, which are equally undocumented
in git but at least have deploy history/version numbers Supabase itself could
theoretically be asked to diff, this one was corrupted at its only copy.

**Replies are deliberately kept short, and pushed to develop across turns
rather than dump everything at once.** A student reported answers were long
enough that reading them ate up class time. `LENGTH_AND_DIALOGUE_INSTRUCTION`
is a fixed system-prompt clause appended after the per-preset instruction and
the teacher's own custom prompt (so it applies to every bot regardless of
preset type, and can't be overridden by a teacher's `system_prompt` short of
them explicitly telling the bot to ignore it): keep replies to roughly 3–5
sentences, don't try to hand over a complete answer/finished deliverable in
one turn, and
end with a short follow-up question or suggestion that carries the
assignment/question forward into the next turn — unless the student has
already asked for a final conclusion or finished result, in which case don't
force a trailing question just to have one. This is prompt-only (no
`max_tokens` change, no hard truncation) so a reply that genuinely needs more
room isn't cut off mid-sentence; length control is advisory, same as every
other instruction in this system prompt.

**Also warns about foul language, and the warning is honest, not a bluff.**
`CONDUCT_WARNING_INSTRUCTION` (another fixed clause, same placement as the
length/dialogue one, applied to every bot) tells the model that if a student
uses profanity or abusive language, it should calmly ask them to stop and
mention that the teacher who made this bot can review the conversation, and
that continuing could mean the teacher sees it. This is true, not an empty
threat: `chatbot-builder.html`'s session list has a "대화 보기" button
(`sessionViewBtn`) that reads the full `custom_bot_messages` transcript for any
session, so a teacher genuinely can — and, if a student was flagged, likely
would — go read it. There is still no active push notification to the teacher
(same "no notification system to hook into" limitation noted elsewhere in this
file) — the bot's line is a deterrent based on real reviewability, not a
promise that the teacher is alerted immediately.

**`bot.html`'s chat view is two columns: chat on the left, a research-notes
panel on the right.** Students often need somewhere to jot down what they've
found while researching alongside the chat, separate from the conversation
itself. `custom_bot_notes` (`id`, `session_id` → `custom_bot_sessions.id` on
delete cascade, `title`, `content`, `source` nullable, `created_at`) holds
these — student-side reads/writes go through `student-bot-chat` (service-role
key) only: it checks the caller's `sessionToken` resolves to a real session
before touching that session's own notes, so one student can never see or edit
another's. Three actions, all authenticated the same way `chat` already is (a
bare `sessionToken`, no Supabase Auth — this whole page is PIN-gated, not
login-gated): `listNotes`/`saveNote` (title+content required, source optional,
all trimmed/length-capped server-side)/`deleteNote` (ownership re-checked via
`.eq('session_id', session.id)`, not just the note id, so a guessed/leaked
note id from another session can't be deleted). `getSessionByToken()` is a
small shared helper for these three handlers; the pre-existing `chat` action's
own inline session lookup was left as-is to keep this change minimal.

**The bot's owning teacher can also read notes directly via RLS** — a
`custom_bot_notes_select_owner` policy (join `session → custom_bots`, check
`owner_id = auth.uid()` or `current_user_is_admin()`) mirrors the pattern
`custom_bot_messages`/`custom_bot_sessions` already use for the exact same
"only the bot's teacher (or an admin) can read this student's data" shape —
correcting an earlier note in this file that claimed messages/sessions have
"no client-facing policies at all"; they do, and notes now follows the same
one rather than needing a fourth Edge Function action. `chatbot-builder.html`'s
session list gained a "메모 보기" button next to the existing "대화 보기"
(`toggleNotes()`, copy-pasted from `toggleTranscript()`'s lazy-load-once-then-
toggle-visibility shape, querying `custom_bot_notes` directly with `sb.from()`
the same way `toggleTranscript` already queries `custom_bot_messages`), and
`exportSessionsToExcel()`'s "엑셀로 내려받기" sheet gained two columns — `메모
수` and `메모 내용` — appended after the existing `대화 내용` column, one row
per student exactly as before (not one row per note): each note is rendered
as `■ 제목\n내용\n(출처: ...)` and joined with a blank line between notes, a
student with none gets `(메모 없음)`.

On the client, `body.bot-chat-active` (toggled by `show()` whenever
`chatView` is shown) widens `.wrap` from the site's normal 640px to 1060px so
two panels have room; `.chat-layout` is a flex row (`chat-shell` at `flex:
1.15`, `.notes-panel` at `flex:1`) that collapses to a column below 760px,
matching this repo's usual mobile-stacking convention, with the notes panel
capped at `max-height:340px` there so it doesn't push the chat below the
fold. The notes list is a simple accordion — clicking a `.note-item-title`
toggles `.open` on its `.note-item` (CSS shows/hides `.note-item-body`, no
JS per-item state) — with content/source only rendered inside the (initially
hidden) body, so titles stay scannable in a tall list. `loadNotes()` runs
whenever `chatView` is shown (both the normal start flow and the
same-tab-refresh resume path at the bottom of the script) and fails silently
on error, since the notes panel is a convenience layered on top of the chat,
not something that should block the student from chatting if it has a
hiccup. Deleting a note updates the local `notes` array and re-renders
immediately (optimistic), then fires the server delete in the background —
if that call fails, the note simply reappears next time `loadNotes()` runs
rather than showing an error the student can't do anything about.

**`.notes-panel` now stays visible as the chat grows long — on mobile too,
not just desktop.** The original fix only covered desktop: `.notes-panel` got
`position:sticky` so it wouldn't scroll away as `.chat-messages` grew the
whole page taller than the viewport, but mobile was deliberately left with
the old "scrolls away below a long chat" behavior (see the dropped
`test_bot_notes_sticky.js`, replaced by `test_bot_notes_fixed_viewport.js`
below) — the reasoning at the time was that a sticky panel snapping to the
top of a narrow stacked layout, only after scrolling past the whole chat
above it, would look jarring. A student explicitly asked for the mobile case
too ("대화가 길어지면 메모 내용도 같이 아래로 내려와서 항상 확인할 수 있게... 이거
모바일에서도 되는거지?"), which made clear sticky-on-a-stacked-column was
never going to satisfy this anyway — sticky only "catches" the panel once
your scroll position reaches where it naturally sits in the flow, i.e. only
*after* scrolling past the entire (now very tall) chat box above it; it does
nothing to keep the panel visible from the very start of a long chat.

**Root-caused and fixed properly instead of patching around it further**: the
actual reason the page was growing taller than the viewport at all is that
`body` only had `min-height:100vh` (a floor, not a ceiling) with no
`overflow` constraint — a flex container with `min-height` instead of a true
`height` doesn't force its flex children to shrink-to-fit, so `.wrap` /
`.chat-layout` / `.chat-shell` grew to fit content instead of being capped,
and the *document itself* scrolled rather than `.chat-messages`'s own
`overflow-y:auto` (the scroll-to-bottom code already only ever touches
`chatMessages.scrollTop`, confirming internal scrolling was always the
intended design — this was a containment bug, not a missing feature). Fixed
by capping the page outright while chatting: `body.bot-chat-active{
height:100vh; height:100dvh; overflow:hidden; }` (the `100dvh` declaration
only wins in browsers that support it, accounting for a mobile browser's
address bar collapsing/expanding; `100vh` is the fallback) plus
`.wrap{ min-height:0; }` so the flex chain actually shrinks instead of
overflowing. With the document itself now permanently pinned to viewport
height, `.chat-messages` is the *only* thing that scrolls, and both the
desktop side column and the mobile stacked column simply split that one
fixed-height screen between `.chat-shell` and `.notes-panel` — neither one
is ever pushed off-screen by chat length, so there's nothing left for
`position:sticky` to work around. The old sticky/`position:static`-on-mobile
split was removed entirely: `.notes-panel` is now a plain flex child
everywhere (desktop: `flex:1` beside `.chat-shell flex:1.15`; mobile
`@media (max-width:760px)`: stacked column, `.chat-shell flex:1.6` /
`.notes-panel flex:1; max-height:38vh`, so chat gets the larger share and
notes keeps a guaranteed-visible minimum). `test_bot_notes_fixed_viewport.js`
sends 15 message round-trips (30 chat bubbles) at both a desktop (1200×800)
and a mobile (390×844) viewport and confirms: the document's `scrollHeight`
never exceeds the viewport height (no document-level scroll exists at all),
`.notes-panel`'s bounding rect stays fully inside the viewport at both sizes,
the note title input is actually clickable (not covered by anything), and
scrolling `#chatMessages` internally doesn't move `.notes-panel` at all
(proving the panel's position is independent of chat scroll position, not
just "currently still visible by luck").

## Personal per-teacher assistant bot (`my-bot.html` + `personal-bot-chat`/`personal-bot-doc-ingest`)

This is a genuinely separate subsystem from both the shared teacher chatbot
(`chat-teacher`) and the student-facing custom chatbots (`custom_bots` /
`chatbot-builder.html` / `bot.html` / `student-bot-chat`, which are entangled with
PIN/slug/session logic for sharing with students) — deliberately kept apart so
adding to one never risks the other. Tables: `personal_bots` (`owner_id` is the
primary key, one row per teacher, holds `system_prompt`), `personal_bot_documents`,
`personal_bot_chunks` (`embedding vector(3072)`, matches via the
`match_personal_bot_chunks(query_embedding, p_owner_id, match_count)` RPC — scoped
by `p_owner_id` so one teacher's uploads never leak into another's answers),
`personal_bot_messages` (a single persistent thread per teacher, no
multi-conversation concept like `chat-teacher` has). Storage bucket
`personal-bot-docs`, objects always under `<owner_id>/...` with RLS checking
`(storage.foldername(name))[1] = auth.uid()::text` (same convention as
`custom-bot-docs`, but keyed directly by the uploader's own id since there's no
intermediate bot-ownership table to join through).

`personal-bot-doc-ingest` reuses `chat-teacher-ingest`'s multi-format extraction
(txt/xlsx/pptx/hwpx server-side; PDF is client-side — see the PDF section above)
and chunking code verbatim — keep all three ingest functions in sync if you
improve the chunking heuristics. `personal-bot-chat` is much simpler than
`chat-teacher`: no function-calling tools, no FAQ cache (per-user system prompts
mean cached answers can't be safely shared), and it does NOT restrict itself to
only the teacher's own materials — RAG context is preferred when relevant, but
the model is told to fall back to general knowledge and act like a personal
secretary for anything else (drafting, planning, general questions), since this
bot is explicitly personal-use rather than the "only answer from school materials"
teacher-wide bot.

`my-bot.html` (standalone + `?widget=1`, same iframe-widget pattern as everything
else) has three parts: a persistent chat, a system-prompt editor, and a document
upload/list panel. The widget mode only shows the chat (matching
`chatbot-teacher.html`'s widget layout) — settings/uploads are standalone-page-only,
reached via the widget's "전체 보기" link. `my-custom-page.html`'s `custom_chatbot`
widget cell now just does `renderIframeWidget(body, '나만의 챗봇 비서', './my-bot.html',
'./my-bot.html?widget=1')` — it used to be an ephemeral single-instruction mini-bot
with no persistence (`mini-chatbot-chat` Edge Function, now unused/orphaned) that
reset every time the cell reopened; this replaced it entirely, so update both
`WIDGETS` maps' label (`my-custom-page.html` and `custom-page-chat`) together if it
changes again.

## `korean-inquiry.html` (국어 현상 탐구 챗봇) — Gemini에서 구상한 설계를 그대로 구현

사용자가 Google Gemini에서 미리 구상해둔 "국어 현상 탐구" 수행평가용 챗봇+활동지 웹앱의
설계(화면 왼쪽 AI 챗봇 + 오른쪽 활동1~3·메모장 탭, 채점기준표를 반영한 시스템 프롬프트,
교사용 엑셀 다운로드)를 스크린샷으로 공유받아 그대로 구현했다. `exam-generator.html`/
`grade-estimate.html`/`mock-interview.html`과 같은 "교무 업무 도구 하위의 독립 도구"
계열에 합류하는 페이지지만, 그 셋과 달리 **이 페이지는 실제로 Supabase에 학생별 작업
내용을 저장하고, Claude를 호출하는 전용 챗봇 Edge Function을 쓴다** — 단발성 계산기가
아니라 학생이 여러 차시에 걸쳐 돌아와 이어서 작업하는, `bot.html`/`custom_bot_sessions`에
더 가까운 성격의 도구다.

- **학생 식별은 학번+이름뿐, 로그인 불필요** — `room-booking.html`의 "no login required"
  모델과 같은 신뢰 수준. `inquiry_sessions` 테이블(`student_no`+`student_name` 복합
  `unique` 제약)이 학생별 행 하나를 들고 있고, 클라이언트는 `localStorage['ks_inquiry_
  student']`에 `{studentNo, studentName}`을 저장해 다음 방문 때 자동으로 이어서 작업할 수
  있게 한다(같은 기기에서만 — `student-bot-chat`의 이름+학번 재개 로직과 같은 발상이지만,
  여긴 PIN도 없고 아예 Supabase Auth 세션 개념 자체가 없다).
- **모든 쓰기는 `SECURITY DEFINER` RPC로만** — `collect.html`의 관례 그대로, 클라이언트가
  `inquiry_sessions`에 직접 `insert`/`update`할 수 있는 RLS 정책은 전혀 없다(이 테이블의
  유일한 클라이언트 RLS는 `select`, 그것도 승인된 교사 전용). `inquiry_session_start`(최초
  접속 시 find-or-create), `inquiry_session_save`(활동1~3 필드 전체를 매번 덮어쓰는
  디바운스 자동저장, `checklist`까지 포함), `inquiry_session_add_memo`/
  `inquiry_session_delete_memo`(메모장), `inquiry_session_submit`(`submitted_at` 기록) —
  다섯 개 모두 `anon`/`authenticated`에 `grant execute`만 돼 있고 비밀번호 검증은 없다
  (설계 자체에 비밀번호 요구사항이 없었음 — `student-bot-chat`의 PIN 없는 이름+학번 재개와
  같은 신뢰 수준을 그대로 따른 것).
- **활동1~3의 각 필드는 `inquiry_sessions`의 평범한 컬럼**(jsonb로 뭉치지 않고 하나하나
  분리) — 내가 발견한 표현/언제·어디서/선정 이유/문법 개념/문법적 분석/추가 조사(활동1),
  시각자료 계획/서론·본론·결론/7개 체크리스트(활동2, `checklist` jsonb), 발표 대본
  5단계(활동3). `inquiry_session_save`는 `p_fields` jsonb에 들어있는 키만 선택적으로
  갱신하지만(`?` 연산자로 존재 여부 확인), 클라이언트(`currentFieldsPayload()`)는 항상
  현재 화면의 전체 필드 값을 보낸다 — 매 900ms 디바운스마다 전체 상태를 그대로 덮어쓰는
  단순한 모델이라, 필드별 부분 갱신 경합을 신경 쓸 필요가 없다.
- **메모장(`memos` jsonb 배열)은 `bot.html`의 연구 노트 패널과 같은 아코디언 UI** — 제목
  줄을 클릭하면 본문이 펼쳐지고(`.memo-item.open`), 삭제는 즉시 RPC 호출 후 로컬 배열에서
  바로 제거한다. 메모 id는 RPC 안에서 `gen_random_uuid()`로 서버가 생성해 돌려준다.
- **챗봇은 "현재 활동 단계"를 매 메시지마다 함께 보내 받는 순차적 가이드** — Gemini
  설계의 "1,2,3 활동에 맞는 단계에 맞는 가이드를 순서에 맞게"라는 요구사항을, 별도의
  상태 머신 없이 클라이언트가 지금 열려있는 탭(`activeTab`)을 `stage` 파라미터로
  Edge Function에 실어 보내는 것만으로 구현했다 — `inquiry-chat` 함수가 그 단계에 해당하는
  필드들을 현재 값 그대로 시스템 프롬프트 뒤에 붙여("[현재 활동 단계: 활동1 — ...]\n내가
  발견한 국어 표현: ...") 모델에게 맥락으로 준다. 메모장 탭에 있을 때는 특별한 단계
  맥락 없이 일반 모드로 응답한다.
- **`inquiry_settings`(단일 행, `id='site'`)가 채점기준표·대화 원칙 전문을 담은
  시스템 프롬프트를 들고 있다** — `collect_settings`/`app_settings`와 같은 "단일 설정
  행" 패턴. Gemini 스크린샷에서 "4. 시각 자료 활용 및 발표 내용 구성"의 배점이 캡처
  과정에서 잘려 보이지 않았는데, 추측으로 숫자를 채워 넣는 대신 그 항목만 "배점: 선생님이
  직접 정해주세요"로 남겨두고 **교사 모드에서 전체 텍스트를 자유롭게 고쳐 쓸 수 있는
  textarea**로 노출했다 — 이 저장소의 "AI가 재구성한 내용은 사람이 바로 고칠 수 있게
  열어둔다"는 원칙 그대로. RLS는 `select`/`update` 둘 다 승인된 교사 전체에 열려있다
  (관리자 전용이 아님 — 다른 과목 선생님도 참고할 수 있게, `form_templates`와 같은 개방
  신뢰 수준).
- **`inquiry-chat` Edge Function**(`verify_jwt:false` — 학생은 로그인하지 않으므로)은 이
  저장소의 "AI provider strategy"를 그대로 따르는 Claude 우선(`claude-sonnet-5-5`)/Gemini
  폴백(`gemini-3.6-flash`, `chat-teacher`가 이미 쓰는 모델과 통일) 구조다. `student-bot-chat`
  이 겪었던 "도구가 없는 단순 채팅에 `output_config.effort`를 실어 보내면 모델이 멈추지
  않고 같은 토큰을 반복하다 `max_tokens`에 걸리는" 사고(이 문서 위쪽에 이미 기록됨)를
  미리 염두에 두고, 이 함수도 도구가 전혀 없는 단순 멀티턴 채팅이라 `output_config` 자체를
  아예 보내지 않는다. 대화 기록(`chat_messages` jsonb 배열)은 학생이 보낸 메시지와
  챗봇의 답변을 **서버가** 매 호출마다 직접 이어붙여 저장한다(클라이언트는 낙관적으로
  먼저 화면에만 그려두고, 저장의 단일 소스는 Edge Function 쪽) — `ai_usage_log`에도
  `function_name:'inquiry-chat'`, `actor_label: "이름(학번)"`(student-bot-chat과 같은
  패턴, `user_id`는 로그인이 없으니 항상 `null`)로 기록한다.
- **교사 모드**(페이지 상단 "🔑 교사 모드" 버튼 → 로그인+`profiles.approved` 확인 →
  `#teacherPanel` 노출, `staff-edit.html`/`duty.html`의 "관리자 모드 버튼" 패턴과 동일한
  모양이지만 `is_admin`이 아니라 `approved`만 요구한다 — 이 과목을 가르치는 교사 누구나
  쓸 수 있어야 하므로)는 학생별 제출 현황 목록(클릭하면 모달로 전체 활동 내용+대화 기록
  보기), 엑셀 다운로드, 그리고 위 시스템 프롬프트 편집 textarea 세 가지를 제공한다. 엑셀은
  Gemini 설계의 최종 결정("질문과 답변을 모두 합친 열이 낫겠어")을 그대로 반영해, 학생 한
  명당 한 행에 활동1~3의 모든 필드 + 체크리스트 요약 + 메모장 + **챗봇과 나눈 질문·답변을
  `Q: .../A: ...`로 한 칸에 이어붙인 통합 열**을 담는다(이 저장소의 다른 엑셀 내보내기와
  같은 `xlsx@0.18.5`(jsdelivr) 관례).
- **발견된 실제 버그 — `style.display=''`로는 스타일시트 규칙으로 숨긴 요소를 다시
  보이게 할 수 없다.** 처음 구현에서 `#teacherPanel`을 `<style>` 블록의 `#teacherPanel{
  display:none; }` 규칙으로 숨겨두고, `tryEnterTeacherMode()`에서 `el('teacherPanel')
  .style.display = '';`로 다시 보이게 하려 했는데 — 인라인 스타일을 지우는 것은 그
  엘리먼트에 애초에 인라인으로 걸려있던 값만 되돌릴 뿐, 스타일시트(CSS 규칙)로 지정된
  `display:none`은 여전히 유효하게 남는다. Playwright로 "교사 모드 진입 후 패널이
  보이는지"를 검증하다가 바로 걸렸다 — **고쳐서** `#teacherPanel{ display:none; }`
  스타일시트 규칙을 지우고, `#mainView`/`#gateView`가 이미 쓰던 것과 같은 방식(HTML
  태그 자체에 `style="display:none;"` 인라인으로 걸어두기)으로 바꿨다 — 이제
  `.style.display=''`가 정확히 그 인라인 값을 지우고 기본값(`block`)으로 되돌린다.
  `el(id).style.display = ''`로 뭔가를 "다시 보이게" 하는 코드를 쓸 때는, 그 요소가
  애초에 인라인 스타일로 숨겨졌는지(이 패턴이 통함) 스타일시트 규칙으로 숨겨졌는지
  (안 통함, `'block'` 등을 명시해야 함) 항상 구분해서 확인할 것.
- 이 환경에서 실제 Claude API 호출 성공 여부까지는 끝까지 확인하지 못했다(이 샌드박스는
  `api.anthropic.com`/`*.supabase.co`로의 아웃바운드가 막혀 있다는, 이 문서 여러 곳에
  이미 기록된 제약) — RPC 다섯 개는 Supabase에 직접 `execute_sql`로 호출해 정상 동작을
  확인했고, `inquiry-chat` Edge Function은 배포까지 완료했지만 실제 호출은 교사가 처음
  써볼 때 확인해야 한다. `test_korean_inquiry.js`(Playwright, Supabase REST/RPC와
  `inquiry-chat` 엔드포인트를 전부 모킹)로 (1) 학번+이름 시작 → localStorage 재개,
  (2) 활동1 필드 입력 → 디바운스 자동저장(`checklist` 포함 payload 확인), (3) 활동2
  체크리스트 토글 → 저장, (4) 탭 전환 시 챗봇 안내 문구가 바뀌는지, (5) 활동3 탭에서
  챗봇에 메시지를 보내면 `stage:'3'`이 정확히 전달되는지, (6) 메모 추가/펼치기, (7)
  제출하기 → 뱃지 갱신, (8) 로그인 없이 교사 모드 시도 시 패널이 안 열리는지, (9) 교사
  목록 렌더링·상세 모달·엑셀 내보내기(통합 Q&A 열 포함)가 올바른지 — 모두 검증했다.
  **이 샌드박스는 `cdn.jsdelivr.net` 아웃바운드도 막혀 있어**(세션마다 허용 목록이 달라
  이전에는 가능했던 적도 있었다 — `food-map.html`/`xlsx` 관련 다른 섹션 참고), 테스트는
  `@supabase/supabase-js`/`xlsx` 패키지를 `npm install`로 로컬에 받아 `page.route()`로
  CDN 요청을 가로채 대신 응답하는 방식으로 돌렸다(페이지 코드 자체는 CDN URL 그대로).

### 학생 활동 내용은 "교사가 삭제하기 전까지" Supabase에 보관 — 교사 모드에 실제 삭제 버튼 추가

사용자가 실제 공식 "국어 현상 탐구 발표지" PDF 3쪽과 실제 채점기준표(평가시기 11월, 10점
만점: 서·논술형 5점+발표 5점) 이미지를 함께 보내며 "학생 탐구내용 학번 이름은 로컬말고
수파베이스 데이터베이스에 저장해줘. 교사가 삭제하기 전까지"라고 요청했다. 확인해보니 학생이
입력한 실제 활동 내용(활동1~3 필드/체크리스트/메모/대화 기록)은 애초부터 전부
`inquiry_sessions`에만 저장되고 있었다 — `localStorage`에는 다음 방문 시 자동으로 이어서
작업할 수 있게 해주는 `{studentNo, studentName}` **식별자 포인터 하나만** 들어있을 뿐,
실제 내용은 한 번도 로컬에 저장된 적이 없었다. 그래서 이 요청의 실제로 빠져 있던 부분은
"로컬 대신 Supabase에 저장"이 아니라 **"교사가 삭제하기 전까지"라는 조건을 실제로 만족시킬
삭제 기능 자체가 교사 모드에 없었다**는 것으로 판단했다 — 지금까지는 학생 데이터를 지울
방법이 전혀 없어서, 사실상 "영구 보관"이었지 "교사가 원할 때 지울 수 있는" 상태가 아니었다.

- **`inquiry_sessions_delete_approved` RLS 정책**(새로 추가)이 `profiles.approved = true`인
  교사 전체에게 `delete`를 허용한다 — 이 테이블의 기존 `select`/RPC 기반 쓰기와 같은
  신뢰 수준("이 과목을 가르치는 교사 누구나", 관리자 전용 아님)을 그대로 따른 것이다.
- **교사 모드 학생 목록 표에 "관리" 열과 행별 "삭제" 버튼이 추가됐다.** `renderTeacherList()`
  가 각 행 끝에 `<button onclick="event.stopPropagation(); deleteStudentSession(i)">삭제
  </button>`를 렌더링하고(`event.stopPropagation()`으로, 행 전체를 누르면 상세 모달이
  열리는 기존 동작과 겹치지 않게 분리), 표 아래 안내문을 "데이터는 선생님이 직접 삭제하기
  전까지 계속 Supabase에 보관돼요"로 바꿨다. `deleteStudentSession(i)`는 **두 번 연속
  `confirm()`**(학번·이름을 명시한 첫 확인 + "정말로 삭제할까요? 한 번 더 확인할게요" 두
  번째 확인)을 모두 통과해야만 `sb.from('inquiry_sessions').delete().eq('student_no',
  s.student_no).eq('student_name', s.student_name)`을 호출한다 — 되돌릴 수 없는 삭제라
  이 저장소의 다른 파괴적 동작(예: `teacher-groups.html`의 그룹 삭제, `link-hub.html`의
  마스터 비밀번호 끄기)과 같은 수준의 이중 확인을 거친다. 교사는 이미 로그인된 실제
  Supabase Auth 세션을 갖고 있으므로(교사 모드 진입 자체가 로그인을 요구), 학생 쪽의
  RPC 우회 없이 평범한 `sb.from(...).delete()` 호출 하나로 RLS가 바로 허용한다. 성공하면
  `teacherSessions` 배열에서 그 행을 `splice`로 제거하고 `renderTeacherList()`를 다시
  호출해 화면에서도 즉시 사라진다.
- `test_korean_inquiry.js`에 [12]번 검증을 추가했다 — (1) "관리" 열 헤더와 행마다 "삭제"
  버튼이 렌더링되는지, (2) 첫 번째 확인을 취소하면 DELETE 요청이 전혀 안 나가고 행이
  그대로 남는지, (3) 첫 확인은 수락하고 두 번째를 취소해도 역시 DELETE가 안 나가는지,
  (4) 두 확인을 모두 수락하면 `student_no=eq.20301&student_name=eq.홍길동` 필터가 정확히
  실린 DELETE 요청이 한 번 나가고 행이 화면에서 사라지는지 — 모두 확인했다.

### 채점기준표를 실제 공식 이미지 기준으로 정정

위에서 "배점: 선생님이 직접 정해주세요"로 남겨뒀던 항목 4(시각 자료 활용 및 발표 내용
구성)는, 사용자가 보내준 실제 채점기준표 이미지 덕분에 더 이상 추측할 필요가 없어졌다.
`inquiry_settings.system_prompt`를 실제 공식 배점 그대로 정확히 교체했다 — 서·논술형
5점(1.주제 선정 및 발견 2점 / 2.문법 지식 활용 분석 2점 / 3.탐구 과정 성실성 1점) + 발표
5점(4.시각 자료 2점 / 5.발표 내용 구성 1점 / 6.발표 기한 준수 2점, 각 항목의 부분 점수
구간(2/1.5/1/0점 등)까지 포함), 그리고 성취기준 코드 [12화언01-01]/[12화언01-03]/
[12화언01-04]/[12화언01-09]까지 전부 이미지에서 그대로 옮겼다. 이 교정은 `inquiry_settings`
행 하나를 덮어쓰는 순수 데이터 변경이라(그 행의 `updated_at`이 최초 삽입 시점과 그대로
일치해 그 사이 교사가 손으로 고친 적이 없음을 먼저 확인한 뒤 진행했다) 어떤 파일도 바뀌지
않는다 — `school-status.html`의 전입생 데이터 정정 사례들과 같은 "데이터만 고친, git
커밋 대상이 아닌 변경"이다. 교사 모드의 시스템 프롬프트 편집 textarea는 여전히 열려있으니,
학교 사정에 따라 배점이 달라지면 언제든 교사가 직접 다시 고칠 수 있다.

### 삭제 권한을 승인된 교사 전체에서 국어 과목 담당 교사(또는 관리자)로 좁힘

사용자가 "그 과목 담당 교사만 지울 수 있어야 돼"라고 요청했다 — 바로 위에서 추가한 삭제
버튼이 승인된 교사 **누구나** 쓸 수 있었던 걸, 이 활동 자체가 국어 과목 전용이니 국어
담당 교사(또는 관리자)만 지울 수 있게 좁힌 것. `profiles.subject`(이미 `staff`/`member-
admin.html`에서 자유 텍스트로 채워지는 기존 칼럼, 예: `"국어"`)를 기준으로 삼았다.

- **`inquiry_sessions_delete_approved` RLS 정책을 `ALTER POLICY`로 조건만 좁혔다**(정책
  이름은 그대로 — `DROP POLICY`를 쓰면 이 환경의 파괴적 SQL 안전장치에 걸려 `cancelled`로
  끝나는 걸 이미 한 번 겪었으므로, 조건만 바꾸는 `ALTER POLICY ... USING (...)`를 대신
  썼다): `approved = true AND (is_admin = true OR subject ilike '%국어%')`로 바뀌었다 —
  관리자는 과목과 무관하게 항상 삭제 가능, 그 외에는 국어 과목 교사만 가능하다.
- **`tryEnterTeacherMode()`**가 교사 모드 진입 시 `profiles.select('approved, is_admin,
  subject')`로 `subject`까지 함께 조회해 모듈 변수 `canDeleteInquirySessions = is_admin ||
  /국어/.test(subject)`를 세팅한다 — RLS와 똑같은 조건을 클라이언트에도 그대로 반영해,
  서버가 막기 전에 UI 자체가 먼저 정직하게 보여준다.
- **`renderTeacherList()`**는 `canDeleteInquirySessions`가 거짓이면 "관리" 열에 삭제
  버튼 대신 `-`만 보여주고, 표 아래 안내문에 "(삭제는 국어 과목 담당 선생님만 할 수
  있어요.)"를 덧붙인다. `deleteStudentSession(i)`도 호출 맨 앞에서 같은 플래그를 다시
  확인해(`alert('이 활동(국어) 담당 선생님만 삭제할 수 있어요.')`) — RLS만 믿고 UI를
  그대로 두면, 권한 없는 교사가 어쩌다 버튼을 보게 되는 경우(예: 플래그 세팅 전 레이스)
  서버 에러로만 알게 되는데, 클라이언트 쪽에서도 한 번 더 막아 더 분명한 한국어 안내를
  먼저 보여준다.

## 국어 현상 탐구 챗봇을 "학생 챗봇 만들기" 하위로 이동

사용자 요청: "국어 현상 탐구 발표 챗봇 페이지를 학생 챗봇 만들기 하위에 넣어줘." 지금까지
`korean-inquiry.html`은 `admin-tools.html`(교무 업무 도구 허브)의 평범한 타일 하나로만
들어가 있었는데, 이 페이지의 성격(학생이 학번+이름으로 접속하는 과목별 전용 챗봇)이
`chatbot-builder.html`("수업용 챗봇 만들기" — 교사가 학생 공유용 챗봇을 만드는 바로 그
페이지)과 더 밀접하다고 판단해, `staff-edit.html`을 `admin-tools.html` 하위로 옮겼던
것과 같은 패턴(상위 페이지 자체에 진입점을 두고, 기존 top-level 타일은 제거)으로
재배치했다.

- **`admin-tools.html`에서 "국어 현상 탐구 챗봇" `tool-card`를 완전히 제거**했다 — 이
  페이지가 유일한 top-level 진입점이었으므로, 이제 이 경로로는 더 이상 닿을 수 없다.
- **`chatbot-builder.html`의 "내가 만든 챗봇" 카드 바로 위에 "📚 미리 만들어진 과목별
  챗봇" 카드를 새로 추가**하고, 그 안에 "국어 현상 탐구 챗봇" 링크 한 줄을 뒀다 — 기존
  "내가 만든 챗봇" 목록(`.bot-row`, 교사가 직접 만든 커스텀 챗봇들)과 구분되는 별도
  카드로, 이 활동은 직접 만드는 게 아니라 이미 만들어진 전용 도구로 바로 들어가 쓰는
  것임을 분명히 했다. **일부러 `.bot-row` 클래스를 재사용하지 않고 `.builtin-bot-row`라는
  새 클래스**(시각적으로는 거의 동일하게 CSS를 베꼈다)를 썼다 — `loadBotList()`가 매번
  `document.querySelectorAll('.bot-row')`로(스코프 없이 문서 전체를 훑어) 클릭 리스너를
  다시 건 뒤 `openEditor(row.dataset.id)`를 호출하는데, 이 링크는 `data-id`가 없으므로
  `.bot-row` 클래스를 그대로 썼다면 클릭할 때마다 `openEditor(undefined)`가 함께
  호출돼(링크 자체는 그래도 정상 이동하지만) 의도치 않은 사이드 이펙트가 끼어들 뻔했다 —
  클래스 이름만 다르게 줘서 그 델리게이트 쿼리에 아예 걸리지 않게 피했다.
- `chatbot-builder.html`과 `admin-tools.html`을 다루는 기존 CLAUDE.md 섹션/테스트 어디도
  `korean-inquiry.html`의 "유일한 진입점"이 admin-tools.html이라고 가정하고 있지 않아서,
  재배치 외에 다른 파일 변경은 필요 없었다. `nav.js`의 `EXTRA_SEARCH_ITEMS` 항목(🔍 전체
  검색으로 찾을 수 있게 하는 등록)은 손대지 않았다 — 이 페이지는 애초에 `admin-tools.html`
  경유로만 메뉴에 노출됐을 뿐 검색 인덱스는 그 허브 페이지와 무관하게 독립적으로 등록돼
  있었으므로, 진입점이 바뀌어도 검색으로는 계속 똑같이 찾을 수 있다.
- `test_chatbot_builder_korean_inquiry_link.js`(새 테스트)로 (1) 새 링크가
  `korean-inquiry.html`을 정확히 가리키는지, (2) 라벨 텍스트가 올바른지, (3) 그 링크가
  `.bot-row` 클래스를 **갖지 않는지**(델리게이트 클릭 리스너에 안 걸리는지 확인하는
  핵심 단언) — 검증했다. 기존 `test_nav_korean_inquiry_search.js`도 다시 돌려 🔍 검색으로
  여전히 찾아지는지(회귀 없음) 확인했다.

## `korean-inquiry.html` — 저장(중간 저장)과 제출(선생님께 최종 제출)을 분리

사용자 요청: "문법 탐구 챗봇은 중간까지의 과정을 저장할 수 있는 저장 버튼을 추가하고, 제출은
최종으로 선생님한테 낸다는 뜻이야." (여기서 "문법 탐구 챗봇"은 `korean-inquiry.html` —
국어 현상 탐구 챗봇 — 을 가리킨다. 활동1이 문법 개념/문법적 분석을 다루기 때문.)

이 페이지는 원래부터 **자동 저장**(각 입력 필드의 `input` 이벤트마다 `scheduleSave()`가
900ms 디바운스 뒤 `inquiry_session_save` RPC를 호출, `#globalSaveIndicator`에 "✓ 자동
저장됨 HH:MM"/"⚠ 저장 실패"로만 조용히 표시)과 **제출**(`#btnSubmit` → `submitActivity()`
→ `inquiry_session_submit` RPC, `submitted_at` 기록)을 둘 다 갖고 있었다 — 즉 "제출 =
선생님께 최종 제출"이라는 의미 자체는 이미 구현돼 있었다. 빠져 있던 건 **학생이 명시적으로
누를 수 있는 "저장" 버튼**뿐이었다 — 지금까지는 저장이 전부 조용한 자동 동작이라, 학생이
"지금까지 쓴 걸 바로 저장해달라"고 직접 요청할 방법이 없었다.

- **`#btnSaveProgress`**("💾 저장하기", `.btn.secondary`)를 활동 탭 영역 맨 아래,
  "✅ 제출하기" 버튼 바로 왼쪽에 추가했다. 그 위에 `.save-submit-hint` 한 줄("💾 저장하기:
  지금까지 쓴 내용을 저장해요 (언제든 눌러도 돼요). · ✅ 제출하기: 선생님께 최종으로
  제출해요.")을 둬서, 두 버튼의 역할이 서로 다르다는 걸 글로도 분명히 했다.
- **`saveProgressManual()`**(새 함수) — 클릭 즉시 `clearTimeout(saveTimer)`로 대기 중인
  자동 저장 디바운스를 취소하고(중복 저장 방지), `doSave()`(기존 자동 저장과 완전히 같은
  RPC 호출 — 새 엔드포인트나 새 RPC는 필요 없었다)를 **그 자리에서 바로** 실행한다. 버튼
  자신의 라벨을 "💾 저장 중…" → 성공 시 "✓ 저장했어요"/실패 시 "⚠ 저장 실패"로 1.5초간
  바꿔 보여주고(그 사이 버튼은 `disabled`), 그 뒤 원래 라벨로 되돌린다 — `collect.html`의
  "복사됨!" 라벨 임시 교체(1500ms 후 원복)와 같은 이 저장소의 관례를 그대로 따랐다.
  **절대로 `inquiry_session_submit`을 호출하지 않는다** — 저장은 저장일 뿐, 제출 배지
  (`#submitBadge`)는 "저장하기"를 눌러도 "아직 제출 전" 상태 그대로 유지된다.
- **제출 확인 문구**(`submitActivity()`의 `confirm()`)도 "최종"이라는 단어를 명시적으로
  넣어 고쳤다: `'지금까지 작성한 내용을 선생님께 최종 제출할까요? ("제출하기"는 선생님에게
  이 활동을 다 했다고 알리는 최종 동작이에요. 제출 후에도 내용은 계속 수정할 수 있어요.)'`
  — 기존 문구("제출 후에도 내용은 계속 수정할 수 있어요")가 담고 있던 "제출해도 잠기지
  않는다"는 사실은 그대로 유지했다(그 동작 자체는 바꾸지 않았다 — 제출 후에도
  `inquiry_session_save`는 계속 같은 행을 덮어쓴다). 제출 버튼/로직(`submitActivity()`)
  자체는 코드 변경 없음 — 이미 "최종"이라는 의미를 정확히 구현하고 있었으므로, 바뀐 건
  그 의미를 학생에게 더 분명하게 전달하는 문구뿐이다.
- `test_korean_inquiry_save_button.js`(새 테스트)로 (1) 저장하기/제출하기 버튼이 둘 다
  있고 둘의 역할을 설명하는 안내 문구가 있는지, (2) "저장하기"를 누르면 (자동 저장의
  900ms 디바운스를 기다리지 않고) 즉시 `inquiry_session_save`가 정확히 한 번 호출되고,
  `inquiry_session_submit`은 전혀 호출되지 않으며, 제출 배지가 "아직 제출 전"을 유지하고,
  버튼에 "저장했어요" 피드백이 뜬 뒤 원래 라벨로 돌아오는지, (3) 저장이 실패하면 버튼에
  "실패" 피드백이 뜨는지, (4) "제출하기"의 확인창 문구에 "최종"이라는 단어가 포함돼
  있고, 확인을 수락하면 `inquiry_session_submit`이 정확히 한 번 호출되는지 — 모두
  검증했다. 기존 `test_korean_inquiry.js`도 다시 돌려 회귀가 없음을 확인했다(이 과정에서
  그 테스트 자신의 두 가지 사전 존재 결함도 함께 고쳤다 — 아래 참고).

**부수적으로 발견·수정한 `test_korean_inquiry.js` 자체의 결함 2건(이번 변경과는 무관,
테스트 코드 안의 문제였다):**
1. [12]번(교사용 삭제 버튼) 검증이 `document.getElementById('teacherPanel').style.display
   = ''`로 로그인 없이 직접 패널을 열어두는 기존 방식을 쓰면서, 실제 로그인 플로우
   (`tryEnterTeacherMode()`)가 세팅하는 `canDeleteInquirySessions` 플래그를 함께 세팅하지
   않아 항상 `false`로 남아있었다 — 그 결과 "삭제 버튼이 보여야 한다"는 단언이 항상
   실패했다(이번 작업과 무관하게 이미 깨져 있던 상태였다). `page.evaluate`에
   `canDeleteInquirySessions = true;`를 추가해 고쳤다.
2. [6]번(챗봇 응답 렌더링) 검증의 `document.querySelectorAll('.chat-bubble.bot')`/
   `.chat-bubble.bot:last-child` 셀렉터가 문서 전체를 대상으로 해서, `showTyping()`이
   `#chatTypingArea`(채팅 목록과 별개의 컨테이너)에 띄우는 "입력 중" 점 세 개짜리 말풍선
   (`class="chat-bubble bot"`, 텍스트 없음)까지 함께 매치했다 — 타이밍에 따라 실제 답변이
   오기 전에 "입력 중" 말풍선 하나(+처음부터 있던 인사 말풍선)만으로 `length>=2` 조건이
   먼저 만족돼, `:last-child`가 그 빈 "입력 중" 말풍선을 집어 "reply rendered" 검증이
   빈 문자열로 실패하는 레이스 컨디션이었다. 두 셀렉터 모두 `#chatMessages
   .chat-bubble.bot`으로 좁혀서(타이핑 말풍선이 들어있는 `#chatTypingArea`는 제외) 고쳤다.

## `chatbot-builder.html`/`bot.html` — 교사가 설계하는 "활동 탭"(탭+하위항목) + 채점 기준

사용자 요청: "국어 문법 탐구 챗봇 보면 2단 구성으로 돼있고 오른쪽에 학생이 과제를
작성하고 메모하는 칸이 있잖아. 이것까지 수업용 챗봇 만들기에서 구현할 수 있으면
좋겠어. 탭1의 내용 탭1의 하위항목 탭2의 내용 탭2의 하위항목등을 교사가 챗봇을
만들면서 설계할 수 있게. 만약에 만들지 않는다면 비어 두면 되겠지. 메모장만 놔두고.
그리고 채점 기준을 올리는 부분도 있으면 좋을 것 같아." — `korean-inquiry.html`
(국어 현상 탐구 챗봇)의 2단 레이아웃(왼쪽 챗봇, 오른쪽 활동1/활동2/활동3 탭+메모장)
구조를 **일반화해서 `chatbot-builder.html`로 만드는 모든 수업용 챗봇(`custom_bots`/
`bot.html`)에도 쓸 수 있게** 한 것 — `korean-inquiry.html`은 그 자체로 완전히 별개의
서브시스템(자신만의 `inquiry_sessions`/`inquiry_settings`)이라 전혀 건드리지 않았고,
이번 작업은 `custom_bots`/`bot.html` 쪽에 같은 UX 패턴을 새로 구현한 것이다.

**메모장(오른쪽 패널)은 사실 이미 모든 수업용 챗봇에 있었다** — `bot.html`의
2단 구성(채팅 왼쪽, "📝 조사한 자료" 메모 패널 오른쪽, `custom_bot_notes` 테이블)은
처음부터 모든 `custom_bots`에 적용되는 범용 기능이었다. 이번에 새로 만든 건 그
메모장 **위에** 추가로 들어가는, 교사가 설계하는 "활동 탭" 뿐이다 — 탭을 하나도
설계하지 않으면 이 패널 자체가 안 보이고 메모장만 그대로 남는다("비어두면 메모장만").

- **`custom_bots.activity_schema`**(새 컬럼, `jsonb not null default '[]'`) — 탭
  배열: `[{id, title, fields: [{key, label, type: 'text'|'textarea'|'checklist',
  options?: string[]}]}]`. **`custom_bots.grading_criteria`**(새 컬럼, `text not
  null default ''`) — 채점 기준 원문(선택). 둘 다 `custom_bots`의 기존 RLS(소유
  교사만 쓰기, `chatbot-builder.html`이 이미 `sb.from('custom_bots')`로 직접
  읽고 쓰는 그 테이블)를 그대로 타므로 새 RLS 정책이 필요 없었다.
- **새 테이블 `custom_bot_activity_responses`**(`session_id uuid primary key
  references custom_bot_sessions(id) on delete cascade`, `responses jsonb not
  null default '{}'`, `updated_at`) — 한 학생 세션의 모든 탭 응답을 하나의 jsonb
  객체(`{fieldKey: value}`, 체크리스트는 체크된 옵션 문자열 배열)로 통째로
  담는다. `custom_bot_notes`/`custom_bot_messages`와 똑같은 패턴으로 RLS에
  클라이언트용 쓰기 정책이 전혀 없고(`student-bot-chat` Edge Function이
  service-role로만 쓴다), **읽기만** `custom_bot_activity_responses_select_owner`
  정책(세션→봇 조인으로 `owner_id = auth.uid()` 또는 관리자)으로 열어, 봇을 만든
  교사가 `chatbot-builder.html`에서 직접 `sb.from(...)`으로 조회할 수 있다.
- **`student-bot-chat` Edge Function 버전 28**(`verify_jwt:false`, 이전처럼 소스가
  git에 커밋되지 않는 함수라 — "Edge Function code has no backup outside Supabase
  itself" 섹션 참고 — 이 CLAUDE.md 글이 그 로직의 유일한 기록이다)에 네 가지를
  추가했다:
  - `start` 액션이 `bot.activity_schema`와 그 세션에 이미 저장된
    `custom_bot_activity_responses.responses`(재접속/새로고침 시 그대로 복원)를
    함께 돌려준다 — 탭이 없으면 빈 배열이라 `bot.html`은 메모장만 보여준다.
  - `info` 액션도 `activitySchema`를 함께 돌려주게 확장했다 — **같은 탭에서
    새로고침해 이미 저장된 sessionToken으로 재접속하는 경로**는 `start`를 다시
    호출하지 않으므로, `bot.html`이 활동 패널을 그리려면 스키마를 어디선가 다시
    가져와야 했다. `info`는 PIN 확인 전에도 호출되는 가벼운(비민감) 조회라 이
    용도에 적합했다.
  - `getActivityResponses`(sessionToken으로 현재 응답 재조회)/
    `saveActivityResponses`(sessionToken + 전체 `responses` 객체를 받아 그
    세션의 행을 `upsert`, `korean-inquiry.html`의 `inquiry_session_save`와
    동일한 "항상 전체를 통째로 덮어쓰기" 디바운스 자동저장 방식 — 60000자 상한
    검사 포함) 두 액션을 추가했다.
  - `chat` 액션의 시스템 프롬프트에 `bot.grading_criteria`가 있으면 "선생님이
    정해둔 채점 기준은 다음과 같다. 학생이 물으면 참고해 쉽게 설명해주되 직접
    점수/등급을 매겨 알려주지는 말라(최종 평가는 선생님이 한다)"는 문장과 함께
    원문을 덧붙인다 — 챗봇이 과제 안내 중 채점 기준을 참고할 수 있게 하면서도,
    학생에게 임의로 점수를 내려주는 건 명시적으로 금지했다.
- **`chatbot-builder.html`의 편집기(`renderEditor()`)에 두 가지를 추가했다**:
  - "추천 질문" 필드 바로 다음에 "채점 기준" textarea(`#fGradingCriteria`) — 타이핑
    또는 `.txt` 파일을 올리면(`#gradingCriteriaFile`, 순수 클라이언트
    `FileReader`, 서버 파싱 없음) 그 내용이 textarea에 그대로 채워진다. "채점
    기준을 올리는 부분"이라는 요청을 "타이핑도 되고 텍스트 파일 업로드도 되는"
    형태로 구현했다 — **PDF/이미지 업로드는 이 시점엔 범위 밖으로 남겨뒀지만,
    바로 아래 "PDF나 이미지로 업로드해도 분석해서 저장" 섹션에서 곧 추가됐다.**
  - "참고 자료" 섹션과 "학생 대화 기록" 섹션 사이에 새 "학생 활동지 설계 (선택)"
    섹션 — `currentActivitySchema`(배열, `openEditor()`에서 `currentBot
    .activity_schema`를 깊은 복사해 들고 있다가 "저장"을 눌러야만 실제
    반영됨) 하나를 화면에 그리는 `renderActivityEditor()`가 탭마다
    `.activity-tab-block`(제목 입력 + "탭 삭제" + 하위항목 목록 + "+ 하위항목
    추가")을 그린다. 각 하위항목(`renderActivityFieldRow()`)은 레이블
    입력 + 종류 `<select>`(텍스트(한 줄)/텍스트(여러 줄)/체크리스트) + 삭제
    버튼이고, 체크리스트를 고르면 옵션을 한 줄에 하나씩 적는 textarea가 추가로
    보인다. **구조가 바뀌는 동작(탭/항목 추가·삭제, 종류 변경)만
    `renderActivityEditor()`를 다시 부르고, 제목/레이블/옵션 텍스트 입력은 그
    입력칸의 `input`/`change` 이벤트가 배열을 직접 수정할 뿐 다시 그리지
    않는다** — 다시 그렸다면 매 키 입력마다 포커스가 끊겼을 것이다. "저장"을
    누르면 `sanitizeActivitySchema()`가 빈 탭 제목을 "활동N"으로 기본값
    채우고 타입을 화이트리스트로 검증한 뒤 `custom_bots.activity_schema`에
    함께 저장된다(다른 필드들과 같은 하나의 저장 버튼/페이로드).
- **`chatbot-builder.html`의 "학생 대화 기록" 섹션**: 세션 행마다 "대화 보기"/
  "메모 보기" 옆에 **현재 봇에 설계된 활동 탭이 있을 때만** "활동 보기" 버튼이
  추가로 보인다(`hasActivitySchema = currentBot.activity_schema.length > 0` —
  탭이 없으면 볼 게 없어 버튼 자체를 안 보여준다). 클릭하면
  `custom_bot_activity_responses`를 직접 `select`해(owner RLS) 그 세션의
  응답을 `formatActivityResponseLines(responses, schema)`로 "■ 탭 제목 /
  - 항목 레이블: 값"(체크리스트는 `[v]`/`[ ]`로) 줄 목록으로 보여준다 — 이
  함수는 "엑셀로 내려받기"(`exportSessionsToExcel()`)에 새로 추가된 "활동지
  내용" 열에도 그대로 재사용돼, 화면 보기와 엑셀 출력이 서로 다른 형식으로
  어긋나지 않는다(탭이 설계 안 된 봇은 그 열에 "(설계된 활동 탭 없음)"만 찍힌다 —
  굳이 그 경우 `custom_bot_activity_responses`를 조회하지 않는다).
- **`bot.html`**: 기존 `.chat-layout`(채팅 + 메모 패널 2단)의 오른쪽을
  `#rightCol`(새 flex 컨테이너)로 감싸고, 그 안에 `#activityPanel`(기본
  `display:none`)과 기존 `.notes-panel`을 세로로 함께 둔다 — 활동 탭이 없으면
  `activityPanel`이 숨겨진 채라 메모장(`flex:1`)이 칸 전체를 그대로 차지해서
  기존(이 기능 추가 이전) 레이아웃과 완전히 동일하게 보인다. 탭이 있으면
  `activityPanel`이 `flex:1.3`(메모장보다 조금 더 넓게 — 활동 하위항목이 보통
  메모보다 입력량이 많아서)으로 함께 나타난다. `initActivityPanel(schema,
  responses)`가 `start`(새 세션) 또는 `info`+`getActivityResponses`(기존
  sessionToken으로 재접속하는 경로, 바로 위 Edge Function 섹션 참고) 양쪽에서
  호출돼 탭+응답을 초기화하고, `renderActivityTabs()`/`renderActivityFields()`가
  탭 버튼 줄과 활성 탭의 입력칸을 그린다. 각 입력칸의 `input`(텍스트류)/
  `change`(체크박스) 이벤트가 `activityResponses` 객체를 직접 갱신하고
  `scheduleActivitySave()`(900ms 디바운스, `korean-inquiry.html`과 동일한
  패턴)가 전체 `responses`를 `saveActivityResponses`로 보낸다 — 저장 상태는
  `#activitySaveMsg`에 "✓ 자동 저장됨"/"⚠ 저장 실패"로 조용히 표시된다(메모장의
  기존 `#notesMsg`와 같은 수준의 조용한 피드백). 탭을 바꿔도 이미 메모리에 있는
  `activityResponses`를 그대로 다시 그릴 뿐 서버를 다시 조회하지 않는다.
  모바일(`@media max-width:760px`)에서는 `#rightCol` 전체가 `.chat-layout`의
  두 번째 flex 자식으로 세로로 쌓이고(`max-height:46vh`), 활동 패널+메모장이
  그 안에서 다시 비율대로 나눠 가진다 — `body.bot-chat-active`가 문서 전체를
  뷰포트 높이로 고정해 채팅이 길어져도 오른쪽 칸이 화면 밖으로 밀려나지 않는다는
  기존 설계(이 문서의 "bot.html's chat view is two columns" 섹션 참고)는 전혀
  안 바뀌었다 — `.notes-panel`이 하던 역할을 이제 `#rightCol`이 한다는 것만
  다르다.
- Playwright로 (1) `test_bot_activity_panel.js` — 스키마가 없으면 패널이 완전히
  숨겨지고 메모장이 기존처럼 동작하는지, 2개 탭(텍스트/여러 줄 텍스트/체크리스트
  필드 혼합)이 설계된 경우 탭 전환 시 보이는 필드가 바뀌고 입력/체크 시
  디바운스 자동저장이 정확한 payload로 나가는지(체크리스트는 체크된 옵션만
  배열로), 탭을 바꿔도 이전 탭에 입력해둔 값이 유지되는지, 기존 sessionToken으로
  재접속(새로고침)하는 경로도 `info`+`getActivityResponses`로 스키마·기존 응답을
  정확히 복원하고 `start`를 다시 호출하지 않는지 — 모두 확인했다. (2)
  `test_bot_notes_regression.js` — 메모장(추가/펼치기/삭제)이 이 레이아웃
  리팩터링 후에도 전혀 안 바뀌었는지 회귀 확인. (3)
  `test_chatbot_builder_activity_designer.js` — 탭 추가/하위항목 추가(텍스트+
  체크리스트)/옵션 입력 → 저장 시 payload의 `activity_schema`/
  `grading_criteria`가 정확한지, 저장 후 "활동 보기" 버튼이 나타나고 실제
  학생 응답을 필드 레이블로(원시 key가 아니라) 보여주는지, 필드/탭 삭제가
  에디터를 다시 빈 상태로 되돌리는지 — 모두 확인했다. (4)
  `test_chatbot_builder_regression.js` — 제목/소개/추천 질문/챗봇 유형 같은
  기존 필드들이 이 변경과 무관하게 여전히 정확히 프리필·저장되는지, 새 필드
  (`grading_criteria`/`activity_schema`)가 빈 상태에서도 저장 payload에 올바른
  기본값(빈 문자열/빈 배열)으로 실리는지 — 확인했다. 전부 로컬 UMD
  `@supabase/supabase-js` 번들(`page.route`로 jsdelivr 대신 서빙)과 localStorage에
  직접 심은 가짜 `sb-tmssupuskkajahpuswcj-auth-token` 세션으로 로그인을
  모킹했다(supabase-js v2의 `getSession()`은 그 키의 값을 먼저 보고, 아직
  만료 전이면 네트워크 호출 없이 그대로 써서 — 이 환경의 `*.supabase.co` 아웃바운드
  차단과 무관하게 테스트할 수 있다).
- **이 환경에서는 역시 실제 Claude/Gemini API 호출 성공 여부(채점 기준이
  실제 대화에 얼마나 잘 반영되는지)까지는 검증할 수 없다** — `api.anthropic
  .com`/`*.supabase.co`로의 아웃바운드가 막혀 있다는 이 문서의 반복되는 제약.
  Edge Function 자체는 Supabase에 정상 배포(버전 28)됐고 코드 리뷰(문법/로직
  검토)와 배포까지는 이 환경에서 끝냈지만, 실제 수업에서 교사가 활동 탭을
  설계하고 학생이 입력해보는 것으로 최종 확인이 필요하다.

## `chatbot-builder.html` — 채점 기준을 PDF나 이미지로 올려도 AI가 분석해서 저장

바로 위 섹션의 "채점 기준" 필드는 처음엔 `.txt` 파일만 받았다(순수 `FileReader`,
서버 호출 없음) — 사용자가 "채점 기준은 pdf나 이미지로 업로드 해도 분석해서
저장하게 해줘"라고 요청해서, PDF/이미지도 올릴 수 있게 확장했다. 핵심은 "분석해서"
— 단순히 원본 바이트를 그대로 집어넣는 게 아니라, 실제 내용을 텍스트로
추출·정리한 결과를 textarea에 채워야 한다는 뜻이라, 새 Edge Function
**`analyze-grading-criteria`**(Claude 우선/Gemini 폴백, `verify_jwt:false`에
`custom-bot-doc-ingest`와 같은 "바로 코드 안에서 로그인+`profiles.approved` 확인"
패턴)를 새로 만들었다.

- **PDF는 항상 클라이언트에서 먼저 읥는다** — 이 저장소의 기존 "PDF reference-
  material uploads are extracted in the browser, not the server" 관행(서버 Edge
  Function의 CPU 2초/응답 150초 제한을 피하기 위해 pdf.js로 브라우저에서 처리)을
  그대로 따랐다. `extractGradingCriteriaFromPdf(file, onStatus)`가
  `pdfjsLib.getDocument()`로 페이지별 텍스트를 뽑고(이미 있던 `extractPdfPages()`
  와 같은 방식이지만, 채점 기준용은 RAG 청크 분할이 필요 없어 별도의 더 단순한
  함수로 새로 짰다), 자료실 PDF 업로드가 쓰는 "스캔본 판별" 휴리스틱(총 글자수
  30자 미만, 또는 텍스트 있는 페이지 비율)과 같은 아이디어를 재사용한다 — 다만
  기준값은 더 느슨한 **30%**(자료실의 5%보다 큼)를 썼다: 채점 기준표는 보통
  한두 페이지짜리 짧은 문서라, 일부 페이지만 텍스트가 안 잡혀도 전체를 스캔본으로
  보고 이미지 분석으로 넘기는 쪽이 부분적으로만 성공한 텍스트를 그대로 저장하는
  것보다 안전하다고 판단했다.
  - **텍스트가 충분히 잡히면**: 페이지별 텍스트를 "[N페이지]\n..." 형태로
    이어붙여 `analyze-grading-criteria`에 `{mode:'text', text}`로 보낸다 — 서버는
    "PDF 추출 과정에서 줄바꿈·공백·표 구조가 깨져 있을 수 있으니, 항목·배점·세부
    기준을 하나도 빠뜨리거나 지어내지 말고 그대로 보존한 채 번호 목록 형태로
    정리해 달라"는 프롬프트로 Claude(실패 시 Gemini)를 호출한다.
  - **스캔본으로 보이면**: `renderPdfPageToImageBase64(pdf, pageNum, scale)`
    (pdf.js의 `page.getViewport()`+`page.render({canvasContext, viewport})`로
    오프스크린 `<canvas>`에 그린 뒤 `canvas.toDataURL('image/png')`) 로 최대
    `GRADING_PDF_MAX_IMAGE_PAGES = 8`페이지까지 PNG로 캡처해,
    `{mode:'image', images:[{data, mediaType:'image/png'}, ...]}`로 보낸다 — 서버는
    Claude의 비전 API(`content` 배열에 `{type:'image', source:{type:'base64',
    media_type, data}}` 블록, 모델 `claude-sonnet-5-5`)로 이미지에 적힌 내용을
    그대로 텍스트로 옮겨 적게 한다.
- **일반 이미지 파일(`image/*`)은 바로 비전 분석으로** —
  `extractGradingCriteriaFromImage(file, onStatus)`가 `fileToBase64()`
  (`FileReader.readAsDataURL` 뒤 `data:...;base64,` 접두사만 떼어냄)로 인코딩해
  `{mode:'image', images:[{data, mediaType: file.type}]}` 한 장짜리 요청을 보낸다.
- **`analyze-grading-criteria` Edge Function**은 이 저장소의 "AI provider
  strategy"(Claude 우선, 실패 시 Gemini 폴백)를 텍스트 모드/이미지 모드 양쪽에
  각각 적용했다 — `callClaudeText`/`callClaudeImages`(모델 `claude-sonnet-5-5`,
  `max_tokens: 8192` — `mock-interview.html`의 `interview-report`가 겪었던 "절삭
  상수가 너무 작아서 조용히 실패→로컬 폴백으로 빠지는" 사고를 교훈삼아 넉넉하게
  잡았다)와 `callGeminiText`/`callGeminiImages`(모델 `gemini-3.6-flash`, 이미지는
  `inline_data`로 전달) 네 함수가 있고, 도구(tool) 호출이 전혀 없는 단순 텍스트
  생성이라 `output_config`/`effort` 같은 필드는 아예 안 보낸다(이 역시
  `student-bot-chat`이 겪은 "도구 없는 호출에 effort를 실어 보내면 모델이
  멈추지 않고 반복하다 `max_tokens`에 걸리는" 사고를 피하기 위한 선제 조치).
  성공한 호출마다 `ai_usage_log`에 `function_name: 'analyze-grading-criteria'`로
  기록한다(이 사이트의 다른 모든 AI 호출 Edge Function과 같은 관행).
- **UI**: `#gradingCriteriaFile`의 `accept`를 `.txt`에서 `.txt,.pdf,image/*`로
  넓혔고, 그 바로 아래 새 `#gradingCriteriaMsg`(작은 `hint2` 텍스트)가
  "텍스트 추출 중 (N/M페이지)" → "AI로 내용 정리/분석 중..." → "✅ AI가 분석한
  내용을 아래 칸에 채웠어요. 필요하면 직접 고쳐도 돼요." 순으로 진행 상황을
  보여준다. 분석 중에는 파일 입력 자체를 `disabled`로 막아 중복 클릭을 방지하고,
  끝나면(성공이든 실패든) 다시 풀어서 재시도할 수 있게 한다. `.txt`는 여전히
  서버 호출 없이 그대로 읥어 채우고, `.txt`/`.pdf`/이미지가 아닌 형식(예:
  `.docx`)은 클라이언트에서 바로 "지원하지 않는 파일 형식이에요" 에러로 막아
  네트워크 호출 자체가 나가지 않는다. 서버가 `{ok:false, error}`를 돌려주면 그
  에러 문구를 그대로 보여주고 textarea는 건드리지 않는다(실패를 성공처럼
  덮어쓰지 않음).
- `test_grading_criteria_upload.js`(Playwright, 로컬 `pdf-lib`로 실제 PDF
  두 개를 즉석에서 만들어 검증 — 하나는 `drawText()`로 진짜 텍스트가 있는 PDF,
  다른 하나는 1×1 PNG만 두 페이지에 그려 넣어 `getTextContent()`가 빈 문자열을
  돌려주는 "스캔본"을 흉내낸 PDF)로 (1) `.txt`는 여전히 네트워크 호출 없이 직접
  채워지는지, (2) 텍스트 PDF는 추출된 실제 텍스트(`Alpha99`/`Beta77`)를 담아
  `mode:'text'` 요청 한 번만 보내는지, (3) 스캔본 PDF는 2페이지 전체를 PNG
  이미지로(각각 base64 데이터와 `image/png` mediaType 포함) `mode:'image'`로
  보내는지, (4) 일반 이미지 파일은 이미지 1장짜리 `mode:'image'` 요청을 바로
  보내는지(실제 파일의 MIME 타입이 그대로 반영되는지), (5) `.docx` 같은 지원
  안 하는 형식은 네트워크 호출 없이 바로 에러 메시지로 막히는지, (6) 서버가
  실패 응답을 주면 그 에러 문구가 그대로 보이고 textarea는 비워진 채 유지되며
  파일 입력이 다시 활성화돼 재시도할 수 있는지 — 21개 단언 모두 확인했다. 기존
  `test_chatbot_builder_regression.js`/`test_chatbot_builder_activity_designer.js`
  도 다시 돌려 회귀가 없음을 확인했다.
- **이 환경에서는 역시 실제 Claude/Gemini API 호출 성공 여부(비전 분석이 실제
  스캔 문서를 얼마나 정확히 읥어내는지)까지는 검증할 수 없다** — `api.anthropic
  .com`으로의 아웃바운드가 막혀 있다는 이 문서의 반복되는 제약. Edge Function
  자체는 Supabase에 정상 배포(버전 1)됐고 배포 직후 소스를 다시 읥어 한글
  주석·프롬프트·로직이 의도한 그대로 저장됐는지 확인까지는 했지만, 실제 수업
  준비 중 교사가 진짜 PDF/사진을 올려보는 것으로 최종 확인이 필요하다.

## `chatbot-builder.html`/`bot.html` 활동 필드 — 글자수 조건(최소/최대) + 학생 화면 실시간
## 카운터(조건 위반 시 빨간색)

사용자 요청: "수업용 챗봇 만들 때 학생 활동을 추가할 수 있잖아. 학생들이 입력하는 부분을
설계할 때 선생님이 글자 수 제한이나 글자 수 조건을 줄 수 있게 해주면 어떤가 싶고,
학생들이 작성할 때도 몇 글자인지 밑에 숫자로 나오게 해주면 좋을 것 같아. 그리고
선생님이 제시한 조건에 맞지 않은 글자수가 나오면 글자수를 빨간색으로 보여주고" — 이미
있던 "학생 활동지 설계(활동 탭+하위항목)" 기능(이 문서 위쪽 참고)에 글자수 조건을
얹었다. Artifact 목업(좌: 선생님 설계 화면에 최소/최대 입력칸, 우: 학생 화면의 정상/
위반 두 상태)으로 먼저 확인받은 뒤 그대로 구현했다.

- **데이터**: 새 컬럼 없이 `custom_bots.activity_schema`의 각 필드 객체에
  `minLength`/`maxLength`(둘 다 선택, 정수)를 추가했을 뿐이다 — 이 컬럼은 이미 jsonb라
  스키마 변경이 필요 없었고, `student-bot-chat` Edge Function의 `start`/`info` 액션
  (`normalizeActivitySchema()`)이 필드 객체를 키 화이트리스트 없이 통째로 돌려주고
  있어서 서버 쪽도 전혀 손대지 않아도 그대로 전달된다. **체크리스트 유형에는 이
  옵션이 없다** — 글자수라는 개념 자체가 텍스트/서술형에만 의미가 있어서다.
- **`chatbot-builder.html` 설계 화면**: `renderActivityFieldRow()`가 체크리스트가
  아닌 필드에는(기존에 옵션 textarea를 보여주던 그 `${f.type === 'checklist' ? ... :
  ...}` 분기의 else 쪽) "최소 글자수"/"최대 글자수" 숫자 입력칸 두 개(`actFieldMinLen`/
  `actFieldMaxLen`, 비워두면 그 쪽은 제한 없음)를 보여준다. `input` 이벤트 핸들러가
  값을 바로 `currentActivitySchema[ti].fields[fi].minLength`/`maxLength`에 쓰고(빈
  문자열이면 `null`), `sanitizeActivitySchema()`는 저장 시 `Number.isFinite()`인
  값만 실어 보낸다 — 비워두면 그 필드 객체에 `minLength`/`maxLength` 키 자체가 안
  생긴다(기본값 비교가 아니라 키 존재 여부로 "제한 없음"을 표현).
- **`bot.html` 학생 화면**: `activityLenInfo(f, value)`가 현재 글자 수와
  `f.minLength`/`f.maxLength`를 비교해 표시 문구("N자 / 최대자", 최대만 없고 최소만
  있으면 "N자 (최소 M자)", 둘 다 없으면 그냥 "N자")와 위반 여부를 계산한다.
  `renderActivityFields()`가 텍스트/서술형 필드마다 입력칸 바로 아래
  `.activity-char-row`(글자수 + 위반 시 사유 한 줄)를 함께 그리고, 타이핑할 때마다
  (`input` 이벤트) **전체를 다시 그리지 않고** `updateActivityCharCountUI()`가 그
  입력칸의 글자수 행만 갈아치운다 — `renderActivityFields()`를 통째로 다시 부르면
  커서 위치가 날아가기 때문(이 저장소의 "구조가 안 바뀌는 입력은 다시 그리지 않는다"
  기존 관행, `chatbot-builder.html`의 활동 설계 에디터 자체가 이미 쓰던 원칙과 동일).
  조건을 벗어나면(`invalid`) `.activity-char-row`와 입력칸(`<input>`/`<textarea>`)
  양쪽 모두에 `invalid` 클래스가 붙어 글자수 숫자·입력칸 테두리가 함께
  `var(--crest-red)`로 바뀐다 — 조건을 만족하면 평소처럼 회색.
- `test_chatbot_builder_charlimit.js`(새 테스트)로 (1) 기존에 저장된 min/max가
  편집기에 그대로 다시 채워지는지(왕복), (2) 체크리스트 유형에는 글자수 행이 전혀
  안 보이는지, (3) 저장 시 변경한 값이 정확히 반영되는지, (4) 값을 비우면 그 필드
  객체에서 키 자체가 빠지는지 — 모두 확인했다. `test_bot_charlimit_and_download.js`
  (아래 다운로드 테스트와 공유)로 (1) 빈 값일 때 초기 표시 문구 3종(최소+최대/최대만/
  제한없음)이 정확한지, (2) 범위 안으로 타이핑하면 즉시 회색으로 바뀌는지(자동저장과
  별개로 매 입력마다 즉시 반영), (3) 범위를 벗어나면 즉시 빨간색(행+입력칸 둘 다)으로
  바뀌고 사유 문구가 뜨는지, (4) 이 글자수 UI 갱신이 기존 디바운스 자동저장
  (`scheduleActivitySave`)을 전혀 방해하지 않는지 — 모두 확인했고, 기존
  `test_bot_activity_panel.js`/`test_chatbot_builder_activity_designer.js`/
  `test_chatbot_builder_regression.js`도 다시 돌려 회귀가 없음을 확인했다.

## `bot.html` 활동지 — "PDF로 저장"/"Word로 저장" 다운로드

사용자 요청: "학생용 챗봇에서 학생이 작성한 활동지 내용을 word나 pdf로 다운받을 수
있게 하는 기능도 가능?" — 가능하다고 답하고(PDF는 기존 `@media print` 관행 재사용,
Word는 `application/msword` MIME의 HTML 블롭을 `.doc`로 내려받는 흔한 트릭, 둘 다
새 외부 라이브러리 없음) Artifact 목업(좌: 활동지 패널 머리줄에 버튼 2개, 우: 다운로드
결과 미리보기)으로 먼저 확인받은 뒤 구현했다.

- **`activityExportBodyHtml()`**(공용 빌더, PDF/Word 둘 다 이 함수 하나를 재사용) —
  지금 메모리에 있는 `activitySchema`/`activityResponses`(자동저장 완료를 기다리지
  않음 — "작성 중에도 다운로드 가능"이라는 요청 그대로)로, 챗봇 제목+"활동지" 제목,
  학생 이름(학번)·오늘 날짜 메타 줄, 탭마다 제목+하위항목(텍스트/서술형은
  줄바꿈 보존, 체크리스트는 `✓`/`☐`)을 담은 인라인-스타일 HTML 문자열을 만든다.
  빈 서술형 필드는 "(작성하지 않음)"으로 보여준다(빈 문자열을 그대로 내려보내지
  않음). **학생 이름/학번**은 이번 방문에서 시작 화면(`#nameInput`/`#noInput`)에
  직접 입력했을 때만 `currentStudentName`/`currentStudentNo`에 채워진다 — 새로고침
  재접속(기존 sessionToken) 경로는 다시 묻지 않으므로 그 경우 메타 줄에서 조용히
  생략된다(알려진, 받아들인 공백 — 실제로 치명적이지 않다).
- **PDF**: `#activityPrintView`(평소 `display:none`, `.wrap`의 형제로 body 바로
  아래 둠)에 "PDF로 저장" 클릭 시 `activityExportBodyHtml()` 결과를 채우고
  `window.print()`를 호출한다. `@media print{ body > *:not(#activityPrintView){
  display:none !important; } #activityPrintView{ display:block !important; } }`가
  인쇄 시 채팅/메모 레이아웃 전체를 가리고 이 뷰만 보여준다 — `mock-interview.html`/
  `grade-estimate.html`이 이미 쓰는 "`@media print`로 화면 UI를 지우고 인쇄용
  콘텐츠만 남긴다"는 이 저장소의 관행을 그대로 따른 것(새 라이브러리 없음).
- **Word**: `downloadActivityWord()`가 `activityExportBodyHtml()`을 MS Office
  XML 네임스페이스(`xmlns:o="urn:schemas-microsoft-com:office:office"`,
  `xmlns:w="urn:schemas-microsoft-com:office:word"`)를 가진 완전한 HTML 문서로
  감싸, `Blob([...], {type:'application/msword'})`로 만들고 `<a download="...doc">`
  을 눌러 내려받게 한다 — Word는 이 MIME+HTML 조합을 그대로 `.doc`로 열어준다는
  잘 알려진 트릭이라, `docx` 같은 OOXML 생성 라이브러리를 새로 들여올 필요가
  없었다(활동지 내용이 단순 텍스트/체크리스트뿐이라 이 수준의 정확도면 충분하다고
  판단).
- 두 버튼(`#btnActivityDlPdf`/`#btnActivityDlWord`, `.activity-dl-btn.pdf`/`.word`
  — PDF는 장미색, Word는 파란색, 목업에서 미리 보여준 색 코딩 그대로)은 활동지
  패널 머리줄(`.activity-panel-head`)에 "학생 활동지" 제목과 나란히 놓인다 — 패널
  전체가 `activitySchema`가 비어있을 때 `display:none`이라(이 문서 위쪽 "학생 활동지
  설계" 섹션 참고) 탭이 하나도 설계 안 된 챗봇에서는 이 버튼들도 자연히 안 보인다.
- `test_bot_charlimit_and_download.js`로 (1) PDF 버튼이 `window.print()`를 정확히
  한 번 호출하는지, (2) 인쇄 뷰에 챗봇 제목·학생 이름/학번·탭 제목·현재 입력값(아직
  저장 전인 값 포함)·빈 필드의 "(작성하지 않음)" 문구가 모두 들어있는지, (3) Word
  버튼을 누르면 실제 다운로드 이벤트가 발생하고(Playwright의 `page.waitForEvent
  ('download')`로 포착) 그 파일 내용이 Word XML 네임스페이스를 포함한 HTML이며
  같은 제목/학생정보/현재 입력값을 담고 있는지 — 모두 확인했다. **파일명 검증에는
  이 샌드박스 환경만의 제약이 있다**: `a.download`에 한글이 들어가면 이 환경의
  헤드리스 Chromium이 `suggestedFilename()`을 "download"로 뭉개버린다는 걸
  직접 재현해 확인했다(같은 코드에 영문 파일명을 쓰면 정상적으로 ".doc" 그대로
  돌아옴) — 실제 브라우저에서는 한글 파일명이 문제없이 동작하는, 이 테스트 환경
  고유의 한계라 판단해 테스트는 ".doc로 끝남" 또는 "이 환경의 폴백인 'download'"
  둘 중 하나를 허용하도록 작성했다.


## `chatbot-builder.html` — "학생 활동지 설계" 탭 제목/레이블 입력칸이 모바일에서 카드 밖으로
## 삐져나오던 버그 (+ QR 로딩 재시도, "학생 대화 기록" 엑셀에 활동지 내용 포함 여부 확인)

사용자가 모바일 화면 스크린샷을 보내며 "수업용챗봇 만들기에서 이렇게 칸이 깨져서 나와"
라고 보고했다 — "활동1" 탭 제목 입력칸이 카드 테두리 밖으로 길게 삐져나온 모습.

**원인**: `.activity-tab-head input[type=text]`(탭 제목)와 `.activity-field-row-top
input[type=text]`(하위항목 레이블)가 둘 다 `flex:1`만 주고 `min-width:0`을 안 줬다 —
flex 아이템의 기본 `min-width`는 `auto`(= 콘텐츠가 요구하는 최소 너비)라서, 부모
플렉스 컨테이너가 그 콘텐츠 최소 너비보다 좁아지면(모바일 화면) `flex:1`이 있어도
줄어들지 못하고 그대로 넘쳐버리는, 잘 알려진 flexbox 함정이다. **고쳐서**
`min-width:0`과 `box-sizing:border-box`(패딩·테두리가 너비 계산에 포함되게)를 둘 다
추가했다 — 탭 제목 칸은 그대로 `flex:1`, 하위항목 레이블 칸은 `flex:1 1 140px`로
바꾸고 그 줄(`.activity-field-row-top`)에 `flex-wrap:wrap`도 추가해, 아주 좁은
화면에서는 유형 선택/삭제 버튼이 다음 줄로 자연스럽게 넘어갈 수 있게 했다(강제로
한 줄에 욱여넣지 않음).

**QR 코드 — 이미 만들어진 챗봇도 당연히 공유 링크+QR이 똑같이 뜬다.** 사용자가 "이미
만들어진 챗봇도 교사모드로 들어가면 링크랑 QR 만들수 있게 해줘"라고 요청했는데, 코드를
확인해보니 `renderEditor()`는 새 챗봇이든 기존 챗봇이든 `openEditor(botId)`를 거쳐
**똑같이** 호출되는 하나의 함수라, 공유 링크+QR 박스(`.share-box`)는 챗봇 목록에서
어떤 챗봇을 클릭해 열어도 편집기 맨 위에 이미 항상 떠 있었다 — 사용자가 스크린샷에서
보여준 "학생 활동지 설계"/"학생 대화 기록" 영역은 그 공유 링크+QR 박스보다 한참
아래라, 아마 스크롤해서 못 보셨을 가능성이 크다. 다만 코드를 다시 읽다가 QR 렌더링
자체의 실제 약점 하나는 발견해서 함께 고쳤다: `if(window.QRCode){ new QRCode(...) }`
가 **단 한 번만** 확인하고 그 순간 라이브러리가 아직 없으면 그냥 조용히 포기했다 —
`qrcodejs` CDN 스크립트가 느리거나 실패하면 QR 칸이 영영 빈 채로 남는다. `index.html`
의 `waitForSupabase()`와 같은 폴링 재시도 패턴(`renderShareQr(shareUrl, forBotId,
attemptsLeft)`, 200ms 간격 최대 25번=5초)으로 바꿔서, 라이브러리가 조금 늦게
로드되더라도 따라잡아 그려지게 했다 — `forBotId`로 그 사이 다른 챗봇으로 전환됐는지
확인해, 늦게 도착한 QR이 엉뚱한 챗봇의 `shareQrBox`에 그려지는 걸 막는다. CDN 자체가
완전히 실패(404 등)하는 경우는 여전히 조용히 포기한다(QR만 안 뜰 뿐 나머지 편집기는
정상 동작 — 이전과 동일한 성격의 성능 저하, 더 나빠지지 않음).

**"학생 대화 기록"의 "엑셀로 내려받기"는 이미 활동지 내용도 포함한다.** 사용자 질문:
"수업용 챗봇 만들기에서 학생 대화 다운받기가 있는데 그걸 다운받으면 학생의 활동지
내용 다운도 되는거야?" — 코드로 직접 확인: `exportSessionsToExcel()`의 열 머리글이
`['이름','학번','대화 시작','마지막 대화','메시지 수','대화 내용','메모 수','메모
내용','활동지 내용']`이고, 마지막 "활동지 내용" 열은 `formatActivityResponseLines()`
(활동 탭 응답을 탭 제목·레이블로 사람이 읽을 수 있게 풀어주는, "활동 보기" 모달과
공유하는 바로 그 함수)로 채워진다 — 즉 **이미 포함돼 있다.** 챗봇에 활동 탭을 설계해둔
경우에만 실제 내용이 들어가고(설계 자체가 없으면 "(설계된 활동 탭 없음)"), 설계된
챗봇이라면 대화 내용·메모·활동지 응답이 학생별 한 줄에 전부 한 번에 내려받아진다.

`test_chatbot_builder_qr_overflow.js`로 (1) 이미 만들어진(새로 만든 게 아닌) 챗봇을
열어도 공유 링크+QR이 정상적으로 뜨는지, (2) 다른 챗봇으로 전환해도 각자 자기 QR만
정확히 뜨고 이전 챗봇의 QR이 남아있지 않는지(캔버스가 쌓이지 않고 정확히 1개), (3)
QR CDN이 완전히 실패(404)해도 JS 에러 없이 나머지 편집기(공유 링크 등)는 정상
동작하고 QR 칸만 조용히 비어있는지, (4) 모바일 폭(390px)에서 탭 제목/하위항목
레이블 입력칸이 카드 경계를 넘지 않고, 페이지 전체에 가로 스크롤도 전혀 생기지
않는지 — 모두 확인했다. 기존 `test_chatbot_builder_activity_designer.js`/
`test_chatbot_builder_regression.js`/`test_chatbot_builder_charlimit.js`도 다시
돌려 회귀가 없음을 확인했다.


## `chatbot-builder.html` — "미리 만들어진 과목별 챗봇"(국어 현상 탐구 챗봇)에도
## 공유 링크 + QR 코드 보기 추가

사용자 요청: "미리 만들어진 챗봇 국어 현상 탐구 발표 챗봇에 링크와 큐알 만들기가
있었으면 하는거야." 교사가 직접 만드는 커스텀 챗봇(`custom_bots`)의 편집기는 이미
챗봇마다 다른 slug로 공유 링크+QR(`qrcodejs`)을 보여주는데, `korean-inquiry.html`
("국어 현상 탐구 챗봇")은 그 서브시스템과 완전히 별개인 고정된 한 페이지라(자신만의
`inquiry_sessions`/`inquiry_settings` 테이블과 `inquiry-chat` Edge Function을 쓰고,
`custom_bots`의 slug/PIN 개념이 전혀 없음 — 학생은 그냥 그 페이지를 열고 학번+이름만
입력) 애초에 "공유할 링크"라는 개념 자체가 없었다 — 있는 거라곤 이 페이지를 가리키는
단 하나의 고정 URL뿐이었다.

- **표시 장소**: `chatbot-builder.html`의 "📚 미리 만들어진 과목별 챗봇" 카드 —
  "국어 현상 탐구 챗봇" 행(`<a class="builtin-bot-row" href="./korean-inquiry.html">`)
  바로 아래, 그 `<a>`와는 별개의 형제 엘리먼트로 "🔗 링크·QR 코드 보기" 토글 버튼
  (`#btnBuiltinShare`)을 추가했다 — 버튼을 `<a>` **안에** 넣으면 클릭 시 앵커의
  네비게이션과 겹쳐버리므로, 일부러 그 바깥에 뒀다. 누르면 기존 커스텀 챗봇 편집기의
  `.share-box` 모양(링크 코드 상자 + QR 칸 + 복사/다운로드 버튼)을 그대로 재사용한
  `#builtinShareBox`가 펼쳐진다(기본은 접힘, `display:none`).
- **공유 URL은 `STUDENT_BOT_BASE_URL`(커스텀 챗봇이 쓰는, bot.html 전용 두 번째
  Netlify 도메인)이 아니라 지금 이 페이지 자신의 주소를 그대로 쓴다** —
  `korean-inquiry.html`은 그 학생 전용 도메인에 따로 배포돼 있지 않고, 교사용 사이트와
  같은 도메인의 로그인 없는 일반 페이지이기 때문이다. `new URL('./korean-inquiry.html',
  location.href).href`로 상대경로를 절대 URL로 해석해, chatbot-builder.html이 어느
  경로 깊이에서 열렸든(현재는 루트뿐이지만) 항상 정확한 절대 주소가 나온다.
- **`renderStaticQr(boxId, shareUrl, attemptsLeft)`**(새 함수) — 기존
  `renderShareQr(shareUrl, forBotId, attemptsLeft)`와 같은 "QR 라이브러리가 defer로
  늦게 로드될 수 있어 폴링 재시도"(최대 25회, 200ms 간격) 패턴을 그대로 따르지만,
  `currentBot`을 추적할 필요가 없는 고정 페이지라 그 가드 없이 더 단순하게 뗐다 — 박스
  id를 매개변수로 받아, 어느 `<div>`에든 QR을 그릴 수 있는 범용 버전이다.
- **`wireBuiltinShareBox()`**(새 함수, 로그인+승인 게이트를 통과해 `#mainView`가
  보이는 시점에 한 번만 호출 — `renderEditor()`처럼 매번 다시 그려지는 영역이 아니라
  정적 HTML이라 한 번만 와이어링하면 된다) — 토글 클릭 시 박스를 펼치고
  (처음 펼칠 때만, `qrRendered` 플래그로 한 번만) QR을 그리고, 다시 누르면 접는다.
  "링크 복사"(`navigator.clipboard.writeText`), "QR 이미지 복사"(`ClipboardItem`+
  `canvas.toBlob()`을 Promise로 감싸 사용자 동작 중 동기 호출로 인정받는, 기존 커스텀
  챗봇 QR 복사와 같은 트릭), "QR 이미지 다운로드"(`canvas.toDataURL` → `<a download>`)
  세 버튼 모두 커스텀 챗봇 편집기의 QR 버튼들과 동일한 구현을 그대로 복붙했다 — 둘
  다 서버 호출이 전혀 필요 없는, 공유 URL 하나를 그대로 인코딩/복사할 뿐인 순수
  클라이언트 동작이라 복붙이 안전했다.

Playwright(로그인 세션/Supabase REST를 모킹)로 (1) 박스가 처음엔 접혀 있는지, (2)
토글을 누르면 펼쳐지고 버튼 라벨이 "닫기"로 바뀌는지, (3) 보여주는 URL이
`http://<현재 origin>/korean-inquiry.html`이고 **`STUDENT_BOT_BASE_URL`(학생 전용
도메인)이 전혀 아닌지**, (4) QR 캔버스가 그 URL을 정확히 인코딩해 렌더링되는지,
(5) 다시 누르면 접히고 라벨이 "보기"로 되돌아가는지, (6) 다시 펼쳤을 때 캔버스가
중복으로 쌓이지 않는지(`qrRendered` 가드 확인), (7) "링크 복사"가 정확한 URL을
클립보드에 담는지, (8) "QR 이미지 다운로드"가 실제 다운로드 이벤트를 발생시키는지 —
모두 확인했고, 기존 `test_chatbot_builder_qr_overflow.js`/
`test_chatbot_builder_activity_designer.js`/`test_chatbot_builder_regression.js`/
`test_chatbot_builder_charlimit.js`도 다시 돌려 회귀가 없음을 확인했다.

## 국어 현상 탐구 → 일반 수업용 챗봇으로 가져오기
- 사이드바·메인 타일에서 korean-inquiry 숨김(ks-menu hidden:true, index 타일 제거). 진입은 chatbot-builder의 "미리 만들어진 과목별 챗봇" 카드 + 🔍 검색.
- 그 카드에 "📋 내 챗봇으로 가져와서 수정하기": inquiry_settings.system_prompt를 읽어 [평가 기준…]~[대화 원칙] 직전은 grading_criteria로, 나머지는 system_prompt로(“매 메시지마다 현재 활동 단계…” 문장은 활동 순서 안내로 치환), activity_schema = 활동1(6)·활동2(4+체크리스트 7)·활동3(5), preset inquiry, 비공개로 custom_bots insert 후 편집기 열기.

## 학생 챗봇 화면(bot.html) 디자인
- `</head>` 직전 `<style id="ks-theme">`로 메인과 같은 토큰(연회색 #F4F5F7·진한 글씨·남색 #2B3A7E)·둥근 카드(18px)·가벼운 그림자, 맨 위 "경성고 수업 챗봇" 브랜드 줄(`.bot-brand`, 채팅 중엔 작게). 사이드바는 넣지 않음(학생용).

## 실험실로 옮김 (2026-10)
- 나만의 챗봇 비서(`my-bot.html`)를 정식 메뉴(KS_MENU 내 업무)·처음 화면 타일에서 빼고 실험실 `LAB_ITEMS`로 옮김. 대시보드 위젯(my-custom-page)은 그대로.
