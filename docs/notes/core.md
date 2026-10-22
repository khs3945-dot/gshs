# core — 상세 작업 기록 (예전 CLAUDE.md에서 옮김)

## What this is

경성고 교무 도구 ("Gyeongseong High School teacher tools") — a multi-page static
HTML/JS site with no build step, no bundler, and no package.json. Every page is a
single self-contained `.html` file with its `<style>` and `<script>` inline. There
is no shared JS module system: common logic (Supabase client setup, escapeHtml
helpers, collapse/expand persistence, etc.) is deliberately copy-pasted into each
page rather than imported. Follow that convention for new pages/features instead of
introducing a bundler or shared modules.

Two small shared scripts *are* loaded via `<script defer>` on most pages:
`nav.js` (floating hamburger nav + teacher chatbot fab) and `site-login-badge.js`
(login badge in the corner).

## Commands

There is no build, lint, or automated test tooling checked into this repo (no
`package.json`). Development is: edit an `.html` file directly, then serve the repo
root with a static file server and open the page in a browser, e.g.:

```
python3 -m http.server 8801
```

There is no CI test suite. When verifying changes, do it by hand in a browser (or,
in a sandboxed agent session, with an ad-hoc Playwright script against the local
static server, mocking Supabase REST/RPC calls — there is no committed test
scaffold to run).

## Deployment / infrastructure

- **Hosting**: Netlify, deployed from the `main` branch. `netlify.toml` only
  disables deploy previews for PRs (`context.deploy-preview.ignore`); there is no
  build command configured (it's a static publish of the repo root).
- **A second host, Vercel, is also connected (2026-10-21) — `main`/Netlify stays the
  stable production site; `work`/Vercel is the live preview for in-progress changes.**
  The Vercel project (`gshs`, under the repo owner's own account, GitHub-integration-
  linked) auto-deploys on every push, same static-publish-of-repo-root setup as
  Netlify (no build command, `framework: null`). New work should be pushed to the
  `work` branch (not directly to `main`) and opened as a standing PR from `work` →
  `main` — Vercel builds a real preview deployment for that PR/branch automatically,
  giving a live clickable link to check changes on before merging (this repo's
  `netlify.toml` deliberately disables Netlify's own PR previews to save Netlify
  credits, so Vercel's preview is the actual "see it before it's live" mechanism now).
  Merge `work` → `main` once reviewed; that merge is what actually updates both the
  Vercel production domain and (next deploy) Netlify. SSO/deployment protection on
  the Vercel project is turned off so these links are publicly viewable with no
  Vercel login. Login via Google OAuth and the Kakao Maps SDK need their allowed-
  domain lists in Google Cloud Console / Kakao Developers to include the Vercel
  domain too (see `AUTH-SETUP.md`/`KAKAO-MAP-SETUP.md`) — both consoles support
  registering multiple domains at once, so the Netlify domain doesn't need to be
  removed.
- **Backend**: Supabase (Postgres + Auth + Edge Functions), project id
  `tmssupuskkajahpuswcj`. The publishable/anon key is intentionally hardcoded in
  many pages (`sb_publishable_...`) — this is safe by design, security is enforced
  via RLS policies, not by hiding the key. Do not treat it as a secret.
- **`.github/workflows/keep-supabase-alive.yml`**: a cron (every 3 days) that pings
  the Supabase REST API so the free-tier project doesn't auto-pause after 7 days of
  inactivity (relevant during school breaks).
- **File/Drive-backed features use Google Apps Script instead of Supabase.**
  Several pages (`collect.html`, `link-hub.html`, the weekplan integration) call a
  Google Apps Script Web App URL (`const SCRIPT_URL =
  'https://script.google.com/macros/s/.../exec'`) rather than Supabase, because they
  need to write into Google Drive folders or existing Google Sheets. Supabase is
  used for structured/relational data (accounts, tasks, chat, settings); Apps
  Script is used specifically where the source of truth is a Sheet or Drive files.
  See `collect-setup.md` for how to (re)deploy that Apps Script web app — the
  deployment URL changes if you deploy fresh instead of pushing a new version to
  the existing deployment. (`room-request-setup.md` documents a similar Apps
  Script intake-form approach for classroom bookings that was never actually built
  as an `.html` page — it's superseded by the Supabase-backed `room-booking.html`
  below and can be treated as stale/unused; the `room-request.html` filename it
  references doesn't exist in this repo.)
- One-time external API setup is documented in `AUTH-SETUP.md` (Google OAuth client
  for login), `GCAL-SETUP.md` (Google Calendar API key for `date.html`), and
  `KAKAO-MAP-SETUP.md` (Kakao Maps JavaScript key for `food-map.html`) — read
  these before touching login, calendar-embed, or food-map code.
- **`_headers` forces revalidation on the shared scripts** (`nav.js`, `auth.js`,
  `site-login-badge.js`, `cal-shared.js`) via `Cache-Control: no-cache` — Netlify
  auto-applies a plain-text `_headers` file at the publish root, no build step or
  config needed. `nav.js` in particular gets edited very often (nearly every nav/
  menu/tile feature in this file touches it) and every `<script src="./nav.js"
  defer>` tag across every page references it with no version query string —
  without this, a browser that already had `nav.js` cached could keep running an
  old copy indefinitely, surviving any number of new Netlify deploys, with no
  visible error. `no-cache` here does **not** mean "never cache" — it means
  "cache it, but always ask the server to confirm it's still current first" (a
  conditional `If-None-Match` request, answered with a fast `304` when
  unchanged), so this costs nothing in the common case while guaranteeing every
  visitor picks up a script change on their next page load instead of whenever
  their browser's cache happens to expire. Worth adding an entry here for any
  future shared script in the same category as `nav.js`.
- **Netlify's "Pretty URLs" post-processing setting rewrites every internal
  `./이름.html` link in the deployed HTML to an extension-less absolute path**
  (e.g. `./calendar.html` → `/calendar`) — this is a Netlify **dashboard**
  setting (Site configuration → Build & deploy → Post processing → Asset
  optimization → "Pretty URLs"), invisible from this repo (`netlify.toml` has no
  `[build.processing]` section, so grepping the repo for it finds nothing) and
  was evidently on from very early in this project's life. **This actually
  mattered to app code, not just cosmetics**: `nav.js` compares `href`s it reads
  back off the live DOM (`el.getAttribute('href')`, `window.location.pathname`)
  against the literal `./이름.html` strings in `DEFAULT_NAV_ITEMS` — on the
  deployed site those two sides were never byte-equal, so every such comparison
  silently failed. See the `pageKeyOf()` incident below for what this broke and
  how it was fixed.
