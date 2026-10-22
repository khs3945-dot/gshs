# ai-chatbots — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

## AI provider strategy: Claude first, Gemini fallback (all AI-calling Edge Functions)

The user pays for Claude API access directly (Supabase secret `CLAUDE_API_KEY`,
alongside the pre-existing `GEMINI_API_KEY`). Every Edge Function that calls an
LLM for actual text generation (not embeddings — see below) tries Claude first
and only falls back to the pre-existing Gemini code path if the Claude call
throws (network failure, non-2xx including 429 quota exhaustion, or the key
being unset). This is a deliberate product decision, not a cost-driven
default — Claude is preferred, Gemini is the safety net.

- **Model**: two tiers, both called via raw `fetch()` to
  `https://api.anthropic.com/v1/messages` (`anthropic-version: 2023-06-01`,
  `x-api-key: CLAUDE_API_KEY`) — matching this repo's existing convention of
  no SDK dependencies in Edge Functions. `claude-sonnet-5-5` is used for the
  flagship/complex functions (`chat-teacher`, `personal-bot-chat`,
  `custom-page-chat`, `student-bot-chat` — these used `claude-opus-5-5`
  originally, swapped to Sonnet 5.5 by explicit user request to try it as the
  default "best" tier; revert to Opus if quality turns out worse).
  `claude-haiku-4-5-20251001` is used for every simple/single-call function
  (`refine-suggested-questions`, `summarize-messages`, `week-brief-summarize`,
  `refine-chat-doc-text`, `bot-session-summarize`, `chatbot-builder-assistant`,
  `auto-label-messages`, and the `classifyDocument` step inside
  `chat-teacher-ingest` — these used `claude-sonnet-5-5` before this same
  request lowered them a tier). This is a deliberate, user-directed choice
  of model per function, not an automatic cost optimization — don't change
  either tier's model without being asked.
- **Embeddings stay Gemini-only** (`gemini-embedding-001`) in every function
  that does RAG (`chat-teacher`, `personal-bot-chat`, `student-bot-chat`, and
  the three `*-doc-ingest` functions) — Claude has no embeddings API, so there
  is nothing to fall back from there.
- **Pattern for a single-call function** (`summarize-messages`,
  `week-brief-summarize`, `refine-suggested-questions`, `refine-chat-doc-text`,
  `bot-session-summarize`, `chatbot-builder-assistant`, and the `classifyDocument`
  step inside `chat-teacher-ingest`): build the prompt once, `try { await
  callClaude(prompt) } catch { await callGemini(prompt) }`, then run the same
  parsing/validation logic on whichever raw text came back. A function that
  expects JSON back appends an explicit "반드시 JSON 형식으로만 답하세요" instruction
  to the Claude call (Claude has no `responseMimeType: 'application/json'`
  equivalent — Gemini's `generationConfig.responseMimeType` still gets used on
  the Gemini-fallback path) and parses with a lenient `extractJson()` helper
  (plain `JSON.parse`, or a substring between the first `{` and last `}` if
  that fails) rather than trusting the model to never wrap its answer in
  prose or a code fence.
- **Pattern for a multi-turn/chat function** (`personal-bot-chat`,
  `custom-page-chat`): the existing Gemini `contents` array
  (`{role: 'user'|'model', parts: [{text}]}`) is converted to Claude's
  `messages` shape (`{role: 'user'|'assistant', content: string}`) by a small
  per-function `callClaude(systemInstruction, contents)` — `role: 'model'` →
  `'assistant'`, and each turn's `parts` are joined into one string. Both
  functions keep their existing prompt-tag/JSON-parsing logic (`custom-page-chat`'s
  `<action>{...}</action>` regex, `personal-bot-chat`'s plain-text reply)
  unchanged — only which provider produced the raw text differs.
- **`chat-teacher` is the one function with real tool-calling** (function
  declarations `search_calendar_events`/`find_document`/`remember_fact`/
  `add_todo`/`summarize_messages`) and needed a heavier rework: `TOOL_SPECS`
  defines each tool once, `toGeminiFunctionDeclarations()`/`toClaudeTools()`
  convert it to each provider's schema shape, and `executeTool(name, args, ctx)`
  is the single shared dispatcher both `runClaudeLoop()`/`runGeminiLoop()`
  call — so the actual business logic (inserting a task, saving a fact,
  signed-url lookup, etc.) exists in exactly one place regardless of which
  provider is driving the conversation. Claude's tool loop uses
  `output_config: {effort: 'medium'}` — chosen deliberately over a lower
  effort level, since this is the flagship, most tool-heavy function and
  correct tool selection matters more here than shaving cost; this predates
  and is independent of the Opus→Sonnet model swap above, so it was left
  as-is when the model changed. The web-search fallback (`runWebSearchFallback`)
  is unchanged and always uses Gemini's `google_search` grounding tool
  regardless of which provider produced the primary answer — Claude has no
  equivalent grounding tool in this codebase's usage.
- **`student-bot-chat`'s `chat` action streams tokens** (`bot.html` appends
  raw response bytes directly with no SSE parsing of its own), so its fallback
  decision has to happen *before* committing to a response stream, not mid-stream:
  `startClaudeStream()` opens a `stream: true` request to `/v1/messages` and
  returns `null` (never throws) on any non-ok response or network failure;
  the caller falls back to the pre-existing Gemini `streamGenerateContent`
  request only when that's `null`. Once a stream is committed to, a single
  `ReadableStream` reader loop parses **both** providers' SSE framing (both
  send `data: {json}\n\n` lines, but the JSON shape differs — Claude's
  `content_block_delta`/`delta.text_delta.text` vs. Gemini's
  `candidates[0].content.parts[].text`) and re-emits only the extracted text
  deltas as raw bytes, exactly as before. A failure *after* the stream has
  started (either provider) just ends the stream early with whatever text
  had already been sent — this already-existing limitation wasn't changed.

**Incident: `chat-teacher` was silently falling back to Gemini on every
single call.** An admin noticed `ai-usage.html` showed only Gemini usage for
`chat-teacher` and asked why. `query_logs` showed every Claude call failing
with `400: 'claude-sonnet-5-5' does not support the \`speed\` parameter. This
feature is only available on supported models.` — the deployed
`runClaudeLoop()` was sending `speed: 'fast'` in the request body plus an
`'anthropic-beta': 'fast-mode-2026-02-01'` header (a "fast mode" feature,
apparently added for `claude-opus-5-5` back when that was the model here —
an earlier log entry from the same day shows a 429 specifically naming
`claude-opus-5-5`'s fast-mode token quota), but neither was removed when the
model was swapped to `claude-sonnet-5-5`, which doesn't support `speed` at
all. Since `runClaudeLoop()` throws on any non-ok response and the caller
catches that and falls through to Gemini, this bug was invisible from the
teacher-facing side (every chat still got an answer) and only showed up as
"why does ai-usage.html say Gemini" days later. **Fixed** by removing both
the `speed` field and the `anthropic-beta` header from `chat-teacher`'s
Claude request, going back to plain `output_config: {effort: 'medium'}` —
matching the pattern every other Claude-calling function already uses (none
of `personal-bot-chat`/`custom-page-chat`/`student-bot-chat` ever had the
`speed`/fast-mode addition, so this was isolated to `chat-teacher`).
Redeployed as version 40. If `ai-usage.html` ever again shows a function as
100% one provider when it's supposed to be Claude-first, check
`query_logs` for that function's own `"Claude API failed, falling back to
Gemini:"` console.error line (or whatever each function's own catch-block
logs) before assuming it's a quota/outage issue — a parameter the model
doesn't support fails exactly as "shouldn't happen but keeps replying" as a
real outage would, from a teacher's point of view.

**Incident: `student-bot-chat` occasionally streamed literal `<invoke
name="think"> </invoke>` tool-call-syntax to a student, repeated hundreds of
times until it ate the whole `max_tokens` budget.** A teacher screenshotted a
student session (`bot.html`) where the assistant's reply was nothing but that
repeated tag instead of an actual answer. `ai_usage_log` confirmed it: one
call in that session had `output_tokens: 4096` — it hit the hard cap
mid-generation rather than ending normally, which is what you'd expect if the
model got stuck emitting the same token sequence in a loop and never reached
a stop condition. Root cause: `startClaudeStream()`'s request body carried
`output_config: { effort: 'low' }` even though this function defines **no
tools at all** (unlike `chat-teacher`, which also sets an `effort` value but
pairs it with a real `tools` array) — sending a reasoning-effort knob with no
tool schema for the model to actually invoke is the likely trigger for the
model trying to express an internal "think" tool call as literal text and
never recovering. Scoped by querying `ai_usage_log` for `output_tokens >=
3900` across the trailing 7 days: out of 739 `student-bot-chat` calls, exactly
one hit the cap — rare, but a real student saw broken output from it. **Fixed**
by dropping `output_config` entirely from `student-bot-chat`'s Claude request
(redeployed as version 25) — this function doesn't need an effort tier since
it was never doing tool-assisted reasoning to begin with. Unlike the `speed`-
parameter incident above, this wasn't a hard API rejection (the call returned
200 and streamed real tokens, so `ai_usage_log` alone didn't flag it — the
giveaway was `output_tokens` pinned at the `max_tokens` ceiling, not a provider
mismatch). If a similar "pinned at max_tokens" pattern shows up again in any
Claude-calling function, check whether `output_config.effort` is set without a
matching `tools` array before assuming it's just a verbose answer.

**Two Edge Functions were found completely broken (`"SEE_FILE"`-corrupted
deployed source — see the `student-bot-chat` incident already documented
below) while rolling this out**: `chat-teacher` and `auto-label-messages`
were both throwing `ReferenceError: SEE_FILE is not defined` on every
invocation (confirmed via `query_logs`, not just a guess). Both were
reconstructed from scratch — using this file's own documentation of their
contracts, the live DB schema, sibling functions' conventions, and (for
`chat-teacher`) `chatbot-teacher.html`'s actual request/response shape — with
the Claude-first pattern above folded in at the same time, and redeployed.
No independent test invocation of either could be run from this environment
(outbound network to `*.supabase.co` is blocked from this sandbox), so the
usual advice applies: watch `messages.html`'s 자동 라벨링/자동 분류 and
`chatbot-teacher.html` for the first real uses after this change.

## AI usage logging (`ai_usage_log` table + `ai-usage.html`)

Every Edge Function that makes an actual text-generation call (Claude or
Gemini — not an embedding call; RAG embeddings are never logged, per the
"Embeddings stay Gemini-only" note above) fires a non-blocking insert into
`ai_usage_log` right after a successful response: `function_name`,
`provider` (`'claude'`|`'gemini'`), `model`, `user_id` (nullable — the
Supabase Auth uid when the caller is a logged-in teacher), `actor_label`
(nullable — used instead of `user_id` for callers with no Supabase Auth
session), `input_tokens`/`output_tokens` (from Claude's `data.usage` or
Gemini's `data.usageMetadata`), and `cache_creation_input_tokens`/
`cache_read_input_tokens` (Claude only, `null` for Gemini calls). Each
function defines its own small `logAiUsage(admin, {...})` helper
(`admin.from('ai_usage_log').insert(...).then(() => {}, e => console.error(...))`)
rather than sharing one across functions, matching this repo's usual
copy-paste-per-function convention for Edge Functions (which have no shared
module system either). A failed insert is only logged to the console, never
surfaced to the caller — usage logging must never be able to break an actual
AI reply.

- **Single-call functions** (`week-brief-summarize`, `chatbot-builder-assistant`,
  `personal-bot-chat`, `custom-page-chat`, and the `classifyDocument` step in
  `chat-teacher-ingest`) log once per request, right after the Claude or
  Gemini call that produced the reply.
- **`chat-teacher`'s tool-calling loop** (`runClaudeLoop`/`runGeminiLoop`) can
  make several API calls per user turn (once per tool round-trip, up to
  `MAX_TOOL_LOOPS`), so both loops accumulate `inputTokens`/`outputTokens`
  (and, for Claude, the two cache token fields) across every iteration and
  return them alongside the final text; one `logAiUsage` call fires after the
  loop resolves, with the summed totals. `runWebSearchFallback` (the separate
  Gemini call with the `google_search` grounding tool, used when the primary
  answer looks like a "couldn't find it") is a genuinely separate billable
  call, so it logs under its own `function_name` — `'chat-teacher-websearch'`,
  not `'chat-teacher'` — so the two can be told apart when reviewing usage.
- **`student-bot-chat`'s streaming `chat` action** has no single response
  object to read `usage`/`usageMetadata` off of — token counts arrive as part
  of the SSE stream itself. The reader loop's `evt` parsing was extended to
  also capture usage fields as they stream by: Claude's `message_start` event
  carries `message.usage.{input_tokens, cache_creation_input_tokens,
  cache_read_input_tokens}` and `message_delta` carries `usage.output_tokens`;
  Gemini's chunks carry `usageMetadata.{promptTokenCount, candidatesTokenCount}`
  (usually only populated on the final chunk, but every chunk is checked so a
  provider that changes when it sends this can't silently break the count).
  Since a student bot session has no Supabase Auth user, `logAiUsage` is
  called with `userId: null` and an `actorLabel` built from the bot's title
  plus the student's collected name/학번 (e.g. `"수학 탐구 챗봇 - 홍길동(10203)"`,
  or `"익명"` if the bot doesn't collect a name) — this is the one function
  that actually uses the `actor_label` column rather than `user_id`. The log
  call happens in the stream's `finally` block, after the assistant's full
  reply has already been saved to `custom_bot_messages`.

**`ai-usage.html`** is the admin-only page that reads this table back
(RLS on `ai_usage_log` has no client-facing insert policy at all — every
insert goes through the service-role key inside an Edge Function — and its
one `ai_usage_log_select_admin` policy gates `select` on
`current_user_is_admin()`, so the page queries the table directly with
`sb.from('ai_usage_log')` rather than needing its own RPC/Edge Function).
Reached the same way `member-admin.html`/`teacher-groups.html` are — an
admin-only tool-card on `admin-tools.html` and an `adminOnly: true` entry in
`nav.js`'s `EXTRA_SEARCH_ITEMS`, not a top-level `DEFAULT_NAV_ITEMS`/
`index.html` tile. A period `<select>` (오늘/최근 7일/최근 30일/전체, default
최근 7일) re-fetches from Supabase on change (pushed down as a
`created_at >= ...` filter, capped at 20,000 rows — this table is new and
low-volume, so no server-side aggregation was needed yet); a function-name
`<select>` (populated from whatever distinct `function_name` values the
fetched rows actually contain) re-filters the already-fetched rows
client-side with no refetch, same "filter what's already loaded" pattern
`room-booking.html`'s 교실별/위치별 필터 uses. Three tables, all aggregated
client-side over the filtered rows: **기능별 집계** (keyed by
`function_name|provider|model`, so `chat-teacher` and
`chat-teacher-websearch` — or a Claude vs. Gemini-fallback split of the same
function — show as separate rows), **로그인 사용자별 집계** (keyed by
`user_id`, rows with no `user_id` excluded; a second `profiles` query
`.in('id', ids)` on just the distinct ids present joins in display names —
a `user_id` with no matching profile, e.g. a deleted account, falls back to
showing a truncated id rather than breaking the row), and the **학생 챗봇
사용량** card (rows with a `user_id` excluded — this is where
`student-bot-chat`'s rows land, since those have no Supabase Auth user).
`parseActorLabel(label)` splits `actor_label` back into `{bot, name,
studentNo}` — it's written by `student-bot-chat` as `` `${bot title} -
${student name}(${student no})` ``, so the parser finds the **last**
`' - '` in the string (not the first) specifically so a bot title that
itself contains `' - '` — e.g. `"국어 - 문학 챗봇"` — still splits correctly
into the bot title and the name/학번 part. Two tables share this card: a
**학생별 합계** table keyed by `name|studentNo` alone, which sums a
student's usage across every different bot they used (answering "how much
did this specific student use, in total" rather than per-bot), and a
**챗봇별 합계** table keyed by `parseActorLabel(label).bot` alone — one row
per chatbot, summing every student's usage of that bot (plus an "이용 학생
수" column, a distinct count of `name|studentNo` combinations seen for that
bot). This table used to be keyed by the *full* `actor_label` (one row per
bot+student combination, "챗봇별 세부 내역") — per explicit feedback that a
per-student breakdown was already redundant with 학생별 합계 directly above
it, it was simplified to a pure per-bot aggregate with no 이름/학번 columns
at all, rather than adding a filter or a bot-picker dropdown (the two other
options raised) — since the user's own stated preference was "그냥 챗봇에서
사용한 학생들의 전체 사용량을 보여주는 걸로". An "이름 또는 학번으로 검색" text
input (`studentSearchFilter`, substring match against the parsed
`name`/`studentNo`, re-filtering client-side on every keystroke — no
refetch) still narrows both tables at once (filtering which raw rows get
aggregated into 챗봇별 합계, even though that table itself no longer shows
names), so an admin can still narrow 학생별 합계 by name/학번 while 챗봇별
합계 reflects just the matching subset's totals. All
tables and the stat tiles above them re-render from the already-fetched
`allRows` array whenever the function filter or the student search changes;
only the period filter triggers a real
Supabase query.

**로그인 사용자별 집계** and **학생별 합계** are paginated (the other two
tables, 기능별 집계/챗봇별 합계, are not — those stay small in practice).
Each has its own `userPage`/`userPageSize` and `studentPage`/`studentPageSize`
module-scope state (default page size 20), a shared `paginationHtml(prefix,
total, page, pageSize)` helper rendering a page-size `<select>` (exactly
10/20/30/50/100, matching the explicit request — not an arbitrary set) plus
이전/다음 buttons and a "N / M페이지 (총 K명)" status line, appended right
after each table inside the same `innerHTML` render. Since the table (and its
pagination controls) are fully replaced on every render, click/change
handling for 이전/다음/페이지-크기 is one pair of delegated listeners on
`document` (matched via `.pg-prev`/`.pg-next`/`.pg-size-select` +
`data-pg-prefix="user"|"student"` ) rather than re-attached per render.
Pagination is purely a client-side slice of the already-sorted `entries`
array — no refetch on page/size change, same "filter what's already loaded"
principle the function/student filters already use. Changing the page size
resets that table's own page back to 1; changing the 기능 필터, the 기간
필터(which also refetches), or the 학생 검색 box all reset **both** tables'
pages back to 1 where relevant (기간/기능 changes affect both tables' row
sets; 학생 검색 only resets `studentPage`, since it doesn't touch the teacher
table) — otherwise a page number left at, say, 3 could silently show an
empty table once a filter shrinks the row count.

**예상 비용 (`app_settings.ai_model_pricing`, admin-editable, no hardcoded
rates).** Anthropic/Google's actual $/token billing rate for a given model
isn't something this codebase can know on its own — rates change, and
hardcoding a guessed number would silently mislabel real spend as fact. So
instead of baking in fixed prices, a "모델별 단가 설정" card (right below the
기간·기능 필터 card, above 기능별 집계) lets an admin type in the $(USD) price
per 1M(백만) tokens for each `provider|model` combination that has actually
appeared in `ai_usage_log` — four inputs per row (입력/출력/캐시 생성/캐시
읽기 $ per 1M), matching the four token fields already recorded. Saved as a
single jsonb map keyed by `` `${provider}|${model}` `` in the new
`app_settings.ai_model_pricing` column (same single-row/RLS pattern as every
other site-wide setting in this file — "anyone select, admin update" — reused
as-is even though this page is already admin-gated end to end). The pricing
form is built from the **union** of `Object.keys(pricing)` and every
`provider|model` pair in the currently-fetched `allRows` (`allKnownPriceKeys()`)
rather than just the latter, so a model priced once doesn't silently vanish
from the settings UI just because the currently-selected 기간 filter happens
to have no rows for it. Saving is a plain read-then-write of the whole map
(`savePricing()`, one `app_settings.update` call) — it starts from a shallow
copy of the existing `pricing[key]` object per row rather than an empty one,
so leaving one of the four fields blank on an otherwise-filled row clears
just that field instead of dropping the other three.

`costForRow(r)` computes one row's cost as `input_tokens/1e6 * inputPrice +
output_tokens/1e6 * outputPrice + cache_creation_input_tokens/1e6 *
cacheWritePrice + cache_read_input_tokens/1e6 * cacheReadPrice` via
`priceFor(provider, model)` (defaults every field to `0` when nothing's been
entered yet, so an unpriced model just contributes $0 rather than throwing or
showing `NaN`). This is folded straight into the existing `aggregate()`
helper (one more accumulated field, `agg.cost`) so every aggregated table gets
cost for free, plus into `renderStatGrid`'s total. A 예상 비용 column/tile was
added to all four tables (기능별 집계, 로그인 사용자별 집계, 학생별 합계, 챗봇별
합계) and the stat grid — `기능별 집계`'s breakdown by
`function_name|provider|model` is specifically what answers "비용이 모델에
따라 얼마씩인지" ( cost broken out per model), since that's the one table
already keyed by model. `fmtCost(n)` shows 4 decimal places below $1 (token
costs are routinely sub-cent) and 2 decimals at or above $1, always prefixed
`$` — there's no ₩ conversion, since Claude/Gemini billing itself is in USD.
Gemini rows always have `cache_creation_input_tokens`/`cache_read_input_tokens`
at `0`/`null` already (prompt caching is a Claude-only concept in this
codebase's usage), so leaving a Gemini model's 캐시 생성/읽기 price fields
blank has no effect on its cost regardless.

**학생 챗봇 AI 모델 설정 (`app_settings.student_bot_model`) — admin toggle
between Sonnet and Haiku for `student-bot-chat`.** An admin noticed the
student-facing chatbot (`bot.html` / `student-bot-chat`) was burning through
more Claude tokens than expected and wanted a cost/quality lever without
redeploying the Edge Function every time. `student-bot-chat` used to hardcode
`const CLAUDE_MODEL = 'claude-sonnet-5-5'`; this was replaced with
`DEFAULT_CLAUDE_MODEL` (same value, used only as the fallback) plus a new
`resolveClaudeModel(admin)` helper that reads `app_settings.student_bot_model`
on every `chat` request and falls back to the default when it's null/empty —
no RPC needed, since `app_settings` already has "anyone select, admin update"
RLS and this read happens server-side with the service-role client anyway.
The resolved model is threaded through `startClaudeStream()` and into the
`logAiUsage()` call (so switching models is immediately visible in
ai-usage.html's per-model breakdown, not just a silent behavior change). A
new "학생 챗봇 AI 모델 설정" card on **ai-usage.html** (right above 모델별 단가
설정, same admin-only page) holds a plain two-option `<select>` — 소넷
(`claude-sonnet-5-5`, 기본값) / 하이쿠 (`claude-haiku-4-5-20251001`, 비용 절감,
the same exact model string `chatbot-builder-assistant` already uses) — and a
저장 button that does a single `app_settings.update({student_bot_model})`
call, mirroring the pricing card's save pattern. This only affects
`student-bot-chat`'s own Claude call; every other Claude-calling Edge
Function keeps its own hardcoded model per the "AI provider strategy"
section below, and the Gemini fallback path (triggered whenever the Claude
call fails, regardless of which Claude model was selected) is untouched.

## The teacher chatbot (`chat-teacher` Edge Function + `chatbot-teacher.html`)

- Chat model is `gemini-3.6-flash`; embeddings are `gemini-embedding-001`
  (`text-embedding-004` is deprecated — don't revert to it).
- RAG matches come from the `match_chat_chunks` RPC, which returns a `similarity`
  column; matches below `RAG_SIMILARITY_THRESHOLD` (0.5) are dropped before being
  used as context or listed as a source (top-K vector search otherwise always
  returns something, even when nothing is actually relevant).
- The calendar context injected into every message covers a fixed window (today
  -10 days to +21 days). Questions outside that window are handled by a Gemini
  function-calling tool, `search_calendar_events`, that fetches an arbitrary range
  (capped at 400 days) on demand — the fixed window is intentionally not widened
  further, to avoid injecting huge amounts of calendar data into every request.
- Sources shown to the user are not "whatever context was fetched" — the model is
  instructed to end its reply with a `[[참고자료: ...]]` line naming only what it
  actually used; that line is parsed out of the displayed text and intersected
  against the list of things actually provided (to drop any hallucinated names).
- **RAG sources carry a subtitle/page when available.** `chat-teacher-ingest`'s
  `chunkText()` already prefixes a chunk's stored `content` with `[heading]\n` when
  it detects a heading-looking paragraph right before it (see `withHeading()`), and
  the client-side PDF chunking pipeline (see the PDF section below) sets a real
  `page_number` per chunk — so no new column was needed for headings, just
  extraction at query time. `match_chat_chunks` additionally selects `page_number`
  (added via a `DROP FUNCTION` + recreate migration, since Postgres can't
  `CREATE OR REPLACE` a function's return-column list). `chat-teacher` extracts each
  RAG match's heading with `content.match(/^\[(.+?)\]\n/)`, and — since matches come
  back ordered by similarity — keeps only the first (highest-similarity) chunk's
  `{heading, page}` per document title in a `ragDocTitles` → info map. `sources` is
  no longer always `string[]`: a RAG-sourced title that actually has a heading or
  page is emitted as `{title, heading?, page?}`; every other source (site-menu
  guide, weekplan, calendar, approved facts, web-search results) stays a plain
  string, exactly as before. Both shapes are valid inside the same `sources` array
  (jsonb, so no schema change needed for `chat_messages.sources` /
  `chat_faq_cache.sources`), and `chatbot-teacher.html`'s `renderSources()` handles
  both — a string renders as before (plain text, or a link if it matches the
  `"제목 (URL)"` web-source pattern), an object renders as `제목 — 소제목 (p.5)` with
  the heading/page parts omitted when absent. This also keeps old rows saved before
  this change (plain strings only) rendering correctly.
- Suggested-question chips come from `top_asked_questions(p_limit, p_min_count)`;
  only questions asked `p_min_count` times or more are shown, and the UI reveals
  them progressively (2 by default, "더보기" for the rest) rather than all at once.
- Speech-to-text input dedupes on the *text*, not on `SpeechRecognition`'s
  `resultIndex`/`isFinal` fields — in practice the browser sometimes re-emits an
  already-finalized segment as a longer/duplicate "final" result, so naively
  trusting `isFinal` produces repeated words. The fix compares each new segment
  against the previously accumulated text and only appends genuinely new content.
- **마이크로 듣는 중에 "보내기" 버튼(또는 Enter)을 바로 눌러도 음성 인식이
  멈춘다 — 예전엔 마이크 "중지" 버튼 자신의 클릭 핸들러에만 멈추는 로직이
  있어서, 다른 경로로 전송하면 녹음이 계속 듣고 있는 상태로 남아있었다.**
  `sendMessage()` 맨 앞(`sending = true` 전)에 `if(listening && recognizer)` 가드를
  추가해, 전송 경로가 무엇이든(보내기 버튼 클릭, Enter 키) 녹음 중이면
  `recognizer.stop()`을 호출하고 `listening = false`로 바꾸고 마이크 버튼의
  시각 상태도 직접 되돌린다 — 마이크 버튼 자신의 클릭 핸들러가 가진
  멈추기+전송 로직과는 별개의, `sendMessage()` 쪽에서 선제적으로 멈추는
  경로다.
- **마이크 "중지" 버튼으로 전송한 뒤에도 입력창에 같은 내용이 다시 채워지는
  버그 — `SpeechRecognition.stop()`은 동기적으로 인식을 끝내지 않는다.**
  `recognizer.stop()`을 호출해도 브라우저가 그 직전까지 듣던 음성을 비동기로
  한 번 더 `'result'` 이벤트로 늦게 보내올 수 있다 — `sendMessage()`가 이미
  입력창을 비우고 전송을 마친 뒤에 그 뒤늦은 이벤트가 도착하면, 그 핸들러가
  다시 `el('chatInput').value = ...`로 입력창을 채워버려서 "전송했는데 같은
  내용이 또 남아있다"처럼 보였다. 고쳐서 `'result'` 핸들러 맨 앞에
  `if(!listening) return;` 가드를 추가했다 — 멈추기를 요청한 시점(마이크
  중지 버튼이든, 바로 위 항목의 `sendMessage()` 쪽 선제 멈추기든)에 이미
  `listening`을 `false`로 바꿔두므로, 그 이후 늦게 도착하는 모든 `'result'`
  이벤트는 조용히 무시된다. `test_chatbot_teacher_mic_send.js`(가짜
  `SpeechRecognition` 스텁, `_emit()`으로 임의 시점에 `'result'` 이벤트를
  수동으로 발생시켜 이 레이스를 직접 재현)로 (1) 음성 입력 중 "보내기"를
  누르면 `recognizer.stop()`이 호출되고 listening이 꺼지는지, (2) 전송 후
  입력창이 비워지는지, (3) 그 뒤 도착하는 뒤늦은 result 이벤트가 입력창을
  다시 채우지 않는지, (4) 마이크 중지 버튼으로 전송한 경우도 동일하게
  동작하는지 — 네 가지 모두 검증했다.
- `add_todo` is a Gemini function-calling tool (same pattern as `find_document`/
  `remember_fact`) that lets a teacher add a to-do by chat or voice (e.g. "내일까지
  성적 입력 할 일에 추가해줘"). Unlike `summarize_messages` (which needs browser-only
  `.udb` data and has to hand off via `pageAction`), this one the Edge Function can
  finish entirely server-side: it inserts into `tasks` (`{owner_id, title,
  due_at}`) **and** a matching `task_assignments` row (`{task_id, assignee_id:
  uid}`) before returning a canned confirmation reply — no second Gemini call
  needed. The `task_assignments` row is not optional: every to-do list on this
  site (`my-todo.html`/`my-page.html`'s local task list) renders its checkbox
  disabled unless the current user has a `task_assignments` row for that task
  (`item.myAssignment`), since completion state lives on the assignment, not the
  task itself — a task inserted without one shows up with a permanently
  unclickable checkbox. This bit every "add a personal to-do via X" path that
  only inserted into `tasks`: fixed here, in `messages.html`/`my-custom-page.html`/
  `my-page.html`'s "할 일에 추가" (로컬 destination) in the message-summary flow,
  and must be kept in mind for any future one.
- When no school-specific source (RAG matches, weekplan, calendar, approved facts)
  answers the question, the system prompt tells the model to say so honestly
  (reusing the existing `NO_ANSWER_PATTERNS` regex bank used for the suggested-
  question stats), but it must also decide *why* it doesn't know: if the question
  is about something specific to 경성고등학교 itself (a person, schedule, facility,
  internal policy — anything where another school's case wouldn't help), it's told
  to include the fixed sentence "이 내용은 우리 학교만 해당되는 정보라 자료에서 확인되지
  않으면 알려드리기 어려워요." (matched server-side by `SCHOOL_SPECIFIC_NO_SEARCH_RE`);
  otherwise (a generally-applicable question — education policy, law, common
  procedure — that just isn't covered by uploaded materials) it uses a plain
  "찾지 못했어요" phrasing. The web-search fallback only fires when
  `looksLikeNoAnswer(replyText)` matches **and** `SCHOOL_SPECIFIC_NO_SEARCH_RE`
  does not — searching the web for other schools' cases when the question was
  never answerable that way just adds noise. When it does fire, a **second**
  Gemini call is made with the `google_search` grounding tool instead of the
  custom `functionDeclarations` tools (Gemini doesn't allow mixing the two kinds
  of tools in one request), instructed to lead with "우리 학교 자료에서는 찾지
  못했지만" and to NOT write source URLs or "출처: ..." lines in the answer body
  itself (a regex strips any trailing `출처:`/`참고 링크:` block as a safety net
  in case the model does anyway). Citations come from
  `groundingMetadata.groundingChunks[].web.{uri,title}` and replace `sourcesUsed`
  as `"제목 (URL)"` strings — `chatbot-teacher.html`'s `renderSources` renders only
  the title as a clickable link and never shows the raw URL text. Web-sourced
  answers are deliberately excluded from `chat_faq_cache` since external
  information can go stale.
- **Reference material isn't only uploaded from `chatbot-teacher.html` itself.**
  `messages.html` has a "🤖 챗봇 참고자료로 보내기" action (per-message and as a
  bulk checkbox action), open to **any logged-in (approved) teacher** — not just
  admins. It never uploads a message's raw text directly — the click opens a
  review queue (`openChatRefQueue`, one modal, reused for both the single-message
  and bulk cases) showing an editable title/content prefilled from the message.
  The sender can hand-edit it, or click "✨ AI로 다듬기" to have the
  `refine-chat-doc-text` Edge Function (Gemini, strips greetings/signatures and
  condenses multi-person chat into plain statements without inventing facts)
  rewrite it first — nothing is sent until "이 내용으로 보내기" is clicked for that
  item, and only the current (possibly edited) text is what actually gets
  uploaded. Bulk selection just queues multiple messages through the same modal
  one at a time ("건너뛰기" skips an item without sending). The upload itself
  (`sendChatDocText`) is the same sequence `chatbot-teacher.html`'s "텍스트
  직접 입력" tab uses: upload a text `Blob` to the `chat-teacher-docs` storage
  bucket, insert the `chat_documents` row (tagged `category: '메신저'`), then call
  `chat-teacher-ingest` with the new `documentId` to chunk+embed it. Reuse
  `sendChatDocText` for any future "send this as chatbot reference material"
  feature elsewhere — but keep the review-before-send step, since the whole point
  is that nothing goes into the chatbot's knowledge unedited and unconfirmed.

  **Admin-only gate removed (both button visibility and server-side).** This
  feature originally hid the button behind `profile.is_admin` in `messages.html`
  and separately enforced `is_admin` again inside `refine-chat-doc-text` — per
  explicit request to open it to every logged-in teacher, both gates were
  dropped at once. In `messages.html`, `isAdmin` was removed entirely (it had no
  other use on that page) — `#msgBulkChatbotRef`'s `display:''` and the
  per-message `<button data-act="chatbot-ref">` now render unconditionally once
  `mainView` shows. **This needed a matching server-side change, not just a UI
  tweak** — `refine-chat-doc-text` (the "✨ AI로 다듬기" call) still checked
  `profiles.is_admin` and returned 403 `"관리자 계정만 사용할 수 있습니다."`, so a
  non-admin would have seen the button, opened the review modal, and then hit a
  wall the moment they clicked "다듬기" (editing by hand and sending directly
  would still have worked, since that path only ever went through `chat_documents`'
  `insert` RLS, which already only required `current_user_is_approved()` — see
  `chat_documents_insert_approved` policy — never admin). Fixed by swapping that
  function's `profiles.select('is_admin')` + `is_admin` check for
  `profiles.select('approved')` + `approved`, redeployed as version 7. No client
  change was needed for this half — `messages.html` already sends the same
  bearer token regardless of admin status. There is still no separate management
  UI for "sent-to-chatbot" reference items — deleting one was already possible
  (and still is, unchanged) via `chatbot-teacher.html`'s own "자료 목록" tab,
  which has never been admin-gated (any approved teacher can delete any shared
  doc there, per its own comment: "승인된 선생님이면 누구나 파일을 교체·삭제할 수
  있어요") — `messages.html`-sent docs just show up there tagged `category:
  '메신저'` like any other upload.

## Chatbot "답변 기다리는 중" indicator — animated three-dot pulse, not static text

Every chat UI on the site (`chatbot-teacher.html`, `bot.html`, `my-bot.html`,
and `nav.js`'s two floating-assistant fabs — 대시보드 도우미 in
`buildGlobalChat()` and 수업용 챗봇 만들기 도우미 in `buildBuilderAssistantFab()`)
showed a plain static string — "생각하는 중..." or "생각 중…" — while waiting
for the AI's reply, with no visual cue that anything was actually happening
versus the page being stuck. Per explicit request for "점 세 개 밝기가
변하면서 진행중임을 보여주는 표시" (the classic chat-app "typing" indicator —
three dots pulsing in sequence), all five were replaced with the same
`.ks-typing-dots` markup/CSS pattern: three `<span class="dot">` elements
inside one `<span class="ks-typing-dots">`, each animated via
`@keyframes ksTypingDotPulse` (opacity/scale pulse, `1.2s infinite
ease-in-out`) with `animation-delay` staggered `0.2s` apart per dot so they
visibly ripple left-to-right rather than blinking in unison. Since this repo
has no shared stylesheet, the identical CSS block (`.ks-typing-dots`/`.dot`/
the keyframes) is copy-pasted into each of the three standalone HTML pages'
`<style>` blocks, and once into `nav.js`'s own injected `<style>` tag (shared
by both of its chat-fab builders, since they're in the same file) — same
copy-paste-per-page convention as every other shared-but-not-modularized
pattern in this codebase. Each page's own `appendTyping()`/typing-bubble
code just swapped a `div.textContent = '생각하는 중...'` (or the `nav.js`
builders' `typing.textContent = '생각 중…'`) for
`div.innerHTML = '<span class="ks-typing-dots"><span class="dot"></span>
<span class="dot"></span><span class="dot"></span></span>'` — no other logic
changed (the element is still appended/removed the same way once the reply
arrives or the request fails). `my-bot.html`'s version replaces what used to
be a plain static `'...'` three-character string with the same animated
markup, for consistency with the other four spots. Verified with
`test_typing_dots.js` that the three dots render and that
`getComputedStyle(dot).animationName` is actually `ksTypingDotPulse` (not
`none`), confirming the CSS keyframe is applied, not just present in the
stylesheet unused.

## `chat-teacher` can now search several other site pages directly, not just uploaded documents

The chatbot used to only answer from material someone deliberately uploaded
(RAG chunks, weekplan, approved facts) or from the fixed calendar window — a
question like "문서 양식 공유에 기안문 양식 있어?" or "3층 교실 오늘 비어있어?"
had no path to an answer even though the data already lives elsewhere on the
site, because re-uploading every page's content as a separate chatbot document
would mean maintaining it twice. Per explicit request ("문서 양식 공유에 있는
글들도 챗봇이 읽어서 참고하게 할 수 있어? ... 링크나 문서 양식 공유, 교사별 일정,
주간계획, 학사일정, 교실 사용 예약 현황 같은 것들도 페이지 내에 있는 질문들이니까
질문하면 바로 답변할 수 있으면 좋을 것 같은데. 사실 자료실도 마찬가지고"),
`TOOL_SPECS` gained five more Gemini-function-calling/Claude-tool entries that
each query the live table (or, for 업무링크/자료실, the relevant Apps Script)
directly at answer time — no separate ingest/embedding step, so the data is
always current and there's nothing to keep in sync:

- **`search_form_templates`** — `form_templates` `ilike` across
  title/category/content (admin client, so RLS doesn't gate it — this tool
  already only runs for an `approved` teacher, same trust level the page
  itself requires), returns up to 3 matches with `stripHtmlTags(content)`
  truncated to 800 chars (the rich-editor HTML from the section above would
  otherwise feed raw tags to the model for no benefit).
- **`search_links`** — fetches `LINK_HUB_SCRIPT_URL` (link-hub.html's own,
  separate Apps Script deployment — not the shared `SCRIPT_URL` collect.html/
  file-library.html use) with a plain GET, exactly like `link-hub.html`'s own
  `loadLinks()` does, and filters the returned array by name/desc/category
  substring server-side before returning the top 5.
- **`search_file_library`** — POSTs `{action:'librarySearch', query}` to the
  shared `SCRIPT_URL` (the same `librarySearch` action `file-library.html`'s
  own search already calls), returning up to 5 files (with their real
  `uc?export=download` link) and 5 folders.
- **`search_teacher_schedule`** — `staff` `ilike` on `name`, then reshapes
  `schedule` (the same `{day: {period: {subject, room}}}` shape documented
  under "teacher.html/teachers.html schedule data shape" above) into a short
  `"월: 1교시 수학(301), ..."`-style line per teacher, rather than handing the
  model raw nested JSON to parse.
- **`search_room_bookings`** — `room_bookings` filtered by `booking_date`
  (defaults to today if the model didn't pass a valid date) and, optionally,
  `room_name ilike`, returning each match's time range/title/teacher_name.

All five follow the exact same `{found: boolean, ...}` JSON-string return
convention the existing tools (`find_document`, `remember_fact`) already use,
and the system prompt's `[규칙]` section was extended with one more sentence
telling the model which tool to reach for per topic (문서 양식/업무 링크/자료실/
선생님 시간표/교실 예약) — `find_document` (챗봇 참고자료 전용) and
`search_file_library` (자료실 전체) are both mentioned together in that
sentence so the model doesn't conflate the two. Deployed as `chat-teacher`
version 41; redeploy the same way documented elsewhere in this file (never a
fresh deployment, always a new version of the existing function) if you touch
this again.

**`search_duty_roster`** was added later (a gap found while verifying a
user-shared checklist that asked for the chatbot to be able to search 학생
지도 당번/교사 시간표/학사일정/캘린더 — the other three already existed via
`search_teacher_schedule`/the calendar context+`search_calendar_events`, but
nothing queried `duty_roster`). Same shape as `search_room_bookings`: filters
`duty_roster` by `duty_date` (defaults to today if the model didn't pass a
valid `YYYY-MM-DD`) and, optionally, `zone ilike` (e.g. 정문/후문/중식/야자),
returning each match's `{zone, time, who}` — matching "오늘 정문 지도 누구예요?"
style questions. The `[규칙]` sentence above was extended with "...교실 예약
현황을 물어보면 search_room_bookings 도구를, 학생 지도 당번표를 물어보면
search_duty_roster 도구를, 할 일을 추가해달라고 하면..." to tell the model when
to reach for it. Deployed as `chat-teacher` version 43. Like every other
Edge Function change in this file, this could only be code-reviewed
(TypeScript-checked) and deployed from this sandboxed environment — there's
no outbound network to `*.supabase.co` here to invoke it end-to-end, so
watch `chatbot-teacher.html`'s real usage (or `query_logs`) for the first
actual uses.

## `chat-teacher`도 이제 등록(쓰기)이 된다 — 검색뿐 아니라 문서 양식/업무 링크/교실 예약을 챗봇이 직접 올릴 수 있음

바로 위 검색 도구들을 추가한 뒤 사용자가 명시적으로 물었다: "교사 챗봇에 문서양식
업무링크 맛집지도, 교실 예약, 할일 등을 등록하게하는것도 되는거야?" — 그 시점에는
`add_todo` 하나만 실제로 쓰기가 가능했고 나머지는 전부 검색(읽기) 전용이었다. 이후
"등록기능도 추가", "챗봇에서 등록 할 수 있게 해"로 두 번 더 명시적으로 확인받아
`TOOL_SPECS`에 쓰기 도구 세 개를 추가했다(`chat-teacher` version 42):

- **`register_form_template`** — `form_templates`에 바로 `insert`한다
  (`title`/`category`/`content` 모두 필수, `is_html: false`, `author_id`는
  호출자의 `uid`, `author_name`은 함수 맨 위에서 이미 조회해둔 `profile.name`을
  `ToolExecCtx`에 `teacherName`으로 실어 재사용 — `remember_fact`가 매번
  `profiles`를 다시 조회하던 것과 달리 한 번 조회한 값을 그대로 쓴다). RLS가
  `auth.uid() = author_id`만 요구하는 셀프-귀속 insert라, 서비스 롤 클라이언트로
  직접 `author_id: uid`를 넣는 것만으로 조건을 만족한다.
- **`register_link`** — `link-hub.html`의 "+ 새 링크 추가" 폼이 실제로 보내는
  요청(`{category, name, url, desc, mainShow}`, **`action` 필드 없음** — 삭제/수정은
  각각 `action:'delete'`/`action:'update'`를 보내지만, 새로 추가할 때는 `action`
  없이 이 다섯 필드만 보내는 게 그 페이지 자신의 코드로 확인된 유일한 "성공하는"
  요청 모양이다)를 그대로 `LINK_HUB_SCRIPT_URL`에 복제해서 보낸다. **이 Apps
  Script는 `collect-setup.md`에 소스가 문서화돼 있지 않아**(link-hub.html만의
  별개 배포, 이 저장소 어디에도 그 서버 쪽 코드가 없음) 요청 모양을 클라이언트
  코드에서 그대로 베껴 추론한 것 — 실제 배포 핸들러가 "action 없음 = 새로 추가"로
  정확히 분기하는지는 이 환경에서 직접 호출해 확인할 수 없었다(아래 참고).
- **`register_room_booking`** — `room_bookings`에 `insert`한다
  (`roomName`/`date`/`startTime`/`endTime`/`title` 모두 필수, 날짜/시간 형식과
  시작<종료를 먼저 정규식/문자열 비교로 검증). 로그인한 교사의 직접 예약 경로와
  동일하게 `teacher_id: uid, teacher_name`을 실어 보내고(비밀번호가 필요한 익명
  예약 RPC 경로는 쓰지 않음 — 챗봇 호출자는 이미 Supabase Auth로 로그인한
  `approved` 교사), 겹치는 예약(`23P01`, exclusion constraint)과 존재하지 않는
  교실 이름(`23503`, FK violation)을 각각 "이미 다른 예약이 있습니다"/"교실을
  찾을 수 없습니다"로 번역해 되돌린다 — 두 에러 코드 모두 이미 `room-booking.html`
  문서화된 그 테이블의 실제 제약과 일치한다.

**맛집 공유지도(`food_spots`)는 의도적으로 제외했다.** 스키마를 직접 조회해
확인한 결과 `food_spots.lat`/`lng`가 둘 다 `double precision NOT NULL`이고, 이
코드베이스 어디에도 서버 쪽(Edge Function/Apps Script) 지오코딩 기능이 없다
(food-map.html 자신의 위치 입력도 전부 브라우저에서 Kakao Maps JS SDK로 지도를
직접 클릭하거나 Kakao 장소검색 결과를 고르는 방식뿐 — 주소나 이름 텍스트만으로
좌표를 서버에서 알아낼 방법이 이 저장소에 전혀 없음). 주소 문자열만 받아서
좌표 없이 저장하는 건 `NOT NULL` 제약을 어기므로 불가능하고, 임의의 좌표를
지어내는 것도 당연히 받아들일 수 없는 선택이라 판단해 쓰기 도구를 만들지
않았다 — 대신 `SITE_MENU_GUIDE`에 food-map.html을 한 줄 추가하고(위치를
지도에서 직접 찍어야 한다는 설명 포함), 시스템 프롬프트의 `[규칙]`에 "맛집
등록 요청은 food-map.html에서 직접 하도록 안내하라"는 문장을 넣었다 — 챗봇이
아예 모르는 척하는 대신, 왜 안 되는지와 어디서 할 수 있는지를 정확히 안내하게
했다.

시스템 프롬프트의 `[규칙]`도 한 문장 추가해서, 선생님이 서식/링크/교실 예약을
"등록해줘/올려줘/예약해줘"라고 하면 검색 도구가 아니라 이 세 등록 도구를 쓰도록,
등록에 필요한 정보가 부족하면 먼저 물어보고, 등록 성공/실패 결과를 분명히
알려주도록 지시했다. 세 도구 모두 `add_todo`와 같은 패턴으로 확인 없이 바로
실행한다(별도의 "정말 등록할까요?" 왕복 없음) — 교사가 챗봇에 직접 요청한 것
자체가 이미 확인 단계이므로, 이 저장소의 기존 쓰기 도구(`add_todo`,
`remember_fact`)와 일관된 단순함을 유지했다.

**이 환경에서 직접 테스트할 수 없는 변경이다.** `*.supabase.co`로의 아웃바운드
네트워크가 이 샌드박스에서 막혀 있어(이 문서 다른 곳에도 반복 언급된 제약)
배포된 Edge Function을 직접 호출해 실제 AI가 이 세 도구를 올바르게 선택·호출하는지
확인할 수 없었다 — 코드 리뷰(문법 균형, RLS/제약 조건과의 일치, 기존 패턴과의
일관성)와 배포 자체만 이 환경에서 할 수 있는 전부였다. 특히 `register_link`의
요청 모양은 위에서 설명했듯 추론에 기반하므로, 실제로 `link-hub.html`에 새
링크가 안 생기면 가장 먼저 의심해볼 지점이다. 실제 사용 후 문제가 보이면
`query_logs`로 `chat-teacher`의 콘솔 에러(`register_* insert/link-hub search
failed` 등 각 분기의 `console.error` 라벨)를 먼저 확인할 것.

## PDF reference-material uploads are extracted in the browser, not the server

All three doc-upload surfaces (`chatbot-teacher.html` → `chat-teacher-ingest`,
`chatbot-builder.html` → `custom-bot-doc-ingest`, `my-bot.html` →
`personal-bot-doc-ingest`) used to have their Edge Function download the file and
extract text server-side for every format including PDF (via `unpdf`). A ~20MB/
200-page PDF reliably blew past Supabase's free-plan Edge Function limits (2s CPU,
150s wall-clock) doing that parsing, so **PDF specifically** was moved to a
client-side pipeline; **txt/xlsx/pptx/hwpx are unchanged** (still extracted
server-side in the same functions — only the PDF branch was removed from each,
along with the `unpdf` import).

Each of the three HTML pages loads `pdfjs-dist@3.11.174` from jsdelivr (`build/
pdf.min.js` + `build/pdf.worker.min.js`, exposing the `pdfjsLib` global — no
bundler needed) and, only when the selected file's extension is `pdf`, runs this
client-side sequence (implemented three times, copy-paste-per-page as usual —
keep all three in sync if you touch this logic):
1. `extractPdfPages(file, onProgress)` — `pdfjsLib.getDocument()` + `page.getTextContent()`
   per page, keeping pages **unmerged** (unlike the server's old single merged-text
   approach) so each chunk can carry an accurate page number.
2. `chunkPageText(text)` — the same paragraph/heading-based chunking algorithm as
   the server's `chunkText()` (`CHUNK_SIZE=1500`, `CHUNK_OVERLAP=150`,
   `HEADING_RE`), ported to JS verbatim, but run **once per page** rather than on
   one merged string, so a chunk never spans a page boundary and always has a
   well-defined `pageNumber`. `buildPdfChunks()` flattens all pages' chunks in
   order, caps the total at `PDF_MAX_CHUNKS=400` (matching the server's old cap),
   and assigns a global sequential `chunkIndex`.
3. Chunks are POSTed to the ingest function in sequential batches of `PDF_BATCH_SIZE=25`
   (`runPdfBatches()`; batches are never sent concurrently) as
   `{documentId, chunks: [{content, pageNumber, chunkIndex}], isFirst, isLast}`.
   Each batch retries up to `PDF_MAX_ATTEMPTS=4` (1 try + 3 retries, backing off
   800ms×attempt) before giving up. The Edge Function's pre-chunked branch (taken
   whenever the request body has a `chunks` array, checked before the legacy
   `{documentId}`-only path) does **only** embedding + insertion — `isFirst`
   triggers `delete().eq('document_id', documentId)` first (so a re-upload
   replaces old chunks, same convention as the legacy path) and kicks off
   `classifyDocument` (chat-teacher-ingest only) using the first batch's content as
   a sample; `isLast` touches the document's `updated_at`. `page_number` is a
   plain nullable `integer` column added to `chat_chunks`/`custom_bot_chunks`/
   `personal_bot_chunks` — populated for PDFs, `null` for every other format.
4. If a batch ultimately fails after all retries, the client remembers
   `{documentId, batches, failedBatchIndex, title}` in a module-scope
   `pendingPdfResume` variable and renders a "⏸ 이어서 저장" button (delegated
   click handler on `document.body`, since the message container's `innerHTML` is
   replaced on every status update) that resumes `runPdfBatches()` from exactly
   that batch — it does **not** re-extract or re-chunk the file, and critically
   does not resend `isFirst` (which would wipe the batches that already saved).
5. Near-empty extraction (scanned/image-only PDFs, checked via total non-whitespace
   character count and the fraction of pages with any real text) skips the batch
   step entirely and reports "글자를 추출할 수 없는 PDF입니다. 스캔본인지 확인해
   주세요" — the file itself is still kept in storage/`*_documents`, same as any
   other "couldn't extract content" case.

Progress is shown as plain status text through the same message element the
non-PDF upload path already used (`onStatus(...)` → `setMsg(...)`), not a numeric
progress bar — `텍스트 추출 중 (45/200페이지)` during extraction,
`저장 중 (3/10묶음)` during batch upload. The upload button stays disabled for the
whole multi-file loop exactly like before, so no separate "PDF is processing"
lock was needed. `chatbot-teacher.html`'s "파일 교체" (replace-file) flow has its
own copy of this same batch-upload logic, since it re-ingests into an existing
`documentId` rather than creating a new document row.

## 교사용 챗봇 화면 개편(위젯·전체 화면 공통)
- 예시 질문을 맨 위(작은 칩), 기존 버튼 4개는 ⋯ 메뉴(새 대화·이전 대화 불러오기·자동 읽어주기 스위치·관리자 기본값). 말풍선 글씨 거의 검정(#0B0B0F), 연한 색, 선 마이크·동그란 보내기.
- 열 때마다 새 대화: `loadConversationHistory` 자동 호출 제거. nav.js가 창 닫을 때 iframe에 `panel-closed` postMessage → `startNewConversation()`. 지난 대화는 `openHistory()`(chat_conversations 최근 40개 + 첫 user 메시지·질문 수) → `loadConversation(id)`로 이어감.
- 위젯 iframe에서 nav.js가 body에 준 padding-top 56px 때문에 아래가 잘리던 것 → `body.widget-mode{padding-top:0}`.

## 기능별 AI 모델 설정 + 교사 챗봇 웹 검색 제거 (2026-10-22)
- `app_settings.ai_models` jsonb({함수이름: claude 모델}) 추가. Claude 쓰는 Edge Function 16개가 `resolveClaudeModel(admin)`으로 자기 키를 읽고, 없거나 형식이 이상하면 코드의 `DEFAULT_CLAUDE_MODEL`. student-bot-chat은 ai_models → student_bot_model → 기본 순.
- ai-usage.html "기능별 AI 모델 설정" 카드(옛 학생 챗봇 카드 자리): 오퍼스 5.5/소넷 5.5/하이쿠 4.5, 기본값과 같으면 저장 안 함, 학생 챗봇은 student_bot_model도 같이 저장.
- chat-teacher v44: 답 못 찾으면 웹 검색 폴백(runWebSearchFallback) 없이 "학교 자료에서는 찾지 못했어요."로 끝냄(응답 지연 원인). 못 찾은 답은 FAQ 캐시에 저장 안 함.
- 버튼 숨기기 회색 원: 지름 1600px, 중심을 ✕보다 508px 아래(화면 밖)로 — 화면 아래 낮고 넓은 언덕 모양. 놓기 판정 반지름 600.
- 교사 챗봇: 학교 자료에서 못 찾으면 서버가 canWebSearch:true → 답 아래 "인터넷에서 검색해 볼까요? [🔎 검색하기]". 누르면 같은 질문을 webSearch:true로 보내 Gemini google_search 답만 추가(질문은 다시 저장 안 함). 우리 학교 전용 정보 문구일 땐 버튼 없음.
- chat-teacher v46~48: search_staff(명렬·내선·그룹), get_meal(NEIS), search_announcements, find_free_rooms(rooms − 겹치는 room_bookings), search_calendar_events에 keyword+academic_events, 시스템 프롬프트에 시험 목록·학교 기본 정보·게시 중 공지. 소스 원본은 scratchpad에만(배포는 MCP에 전체 붙여넣기).
- 2026-10-22 서브에이전트로 15개 함수에 resolveClaudeModel 추가 배포 — 손으로 옮겨 쓰다 한글 몇 글자가 깨진 적 있음(student-bot-chat·custom-page-chat·summarize-messages는 고침). week-brief-summarize "딜 2~4문장", chatbot-builder-assistant "어딜한 요청" 같은 이상한 글자는 원래부터인지 불확실.
- chat-teacher v49: search_students(class_sections 최신 연도의 담임·부담임·인원, students 명단·이름으로 반 번호; 성별 없음). v50: "오늘/내일/이번 주/지금…" 들어간 질문은 FAQ 캐시 읽기·저장 안 함(예전에 "오늘 일정은?" 등이 30일 캐시로 묵은 답을 내던 문제, 기존 3건 만료 처리).
