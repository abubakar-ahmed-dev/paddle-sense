# PaddleSense — End-to-End Phase Plan

Legend: ✅ done · 🔶 in progress / partial · ⬜ not started

**Branch model:** `main` = stable only. `dev` = integration (default working branch). Each phase gets its own branch `phase/<n>-<name>`, merged into `dev` when its exit criteria pass. Nothing is pushed to `main` during the challenge.

**Testing model:** every phase has built-in verification (its "exit criteria"), plus a dedicated QA phase (8) that gates the release. Tests are written with the phase that introduces the code they cover, so Phase 8 is confirmation, not catch-up.

---

## Phase 0 — Research, idea selection & data validation ✅ DONE

- ✅ Challenge research: scanned ~210 existing submissions; mapped saturated themes and empty partner categories
- ✅ Idea selection: "When can I paddle?" chosen (fresh audience, best category fit, fits builder constraints: no local GPU, no field trips)
- ✅ Data premise verified live: Open-Meteo Flood API (GloFAS v4) covers Pakistan
- ✅ Grid-cell selection: swept ~40 cells; validated 4 final cells against the Jul–Sep 2022 monsoon record (Indus@Besham peak 12,022 m³/s; Malir honest-dry)
- ✅ Feasibility, risks, free-tier math, category strategy → `docs/deep-dive.md`

**Exit criteria met:** data premise proven with real API records; $0 cost confirmed.

---

## Phase 1 — Project setup & living skeleton ✅ DONE

- ✅ Scaffold: Next.js 16 + TypeScript + Tailwind + Recharts (`src/` app-router)
- ✅ Data client: `src/lib/flood.ts` — typed GloFAS fetch, current-value + week-band helpers
- ✅ River config: `src/lib/rivers.ts` — 4 validated cells with honest notes and elevations
- ✅ Dashboard v0 (read-only, live data): per-river cards, charts, statuses; build passes; page verified rendering real values (Indus 1,632 m³/s)
- ✅ Repo hygiene: `.gitignore` (env files, local-only files), `.env.example`, professional README, docs/ structure
- ✅ Local git initialized: initial commit on `main`, working branch `dev`
- ✅ Repo created and `dev` pushed and tracking (`github-personal:abubakar-ahmed-dev/paddle-sense`)

**Exit criteria:** `npm run build` green; dashboard shows live river data; repo pushable. ✅

---

## Phase 2 — Complete UI (deliberately early) ⬜

Branch: `phase/2-ui`

Goal: the whole product surface exists visually and navigably, driven by live/sample data only — no database, no LLM, no Temporal yet. Every later phase plugs into a finished UI.

Tasks:
- River detail pages (`/river/[id]`): bigger chart (toggle past 30d / 90d / 1y), cell metadata, source links, history highlights (e.g., "2022 peak on this day")
- Retrodiction page shell (`/retro`): predicted-vs-actual layout fed by sample/static data until Phase 4 fills it
- Runnable-range UI: three display states — verified range (colored band on chart) / "not yet verified" / "not a paddling river" (Malir)
- Status logic UI: `dry` / `in_range` / `high_water_dangerous` treatments with conservative language, no green "safe" badge (enums: DATA_DICTIONARY §8.5; copy: UX_SPEC §6)
- States: loading, error (with retry), empty (no data for a cell)
- Layout: responsive (mobile-first), dark theme consistency, favicon + OG image
- Accessibility pass: keyboard navigation, focus rings, contrast, semantic HTML, list-equivalents for every chart

Testing in this phase:
- Component/state tests for status rendering (`dry` / `in_range` / `high_water_dangerous` / unknown) — Vitest + Testing Library
- Manual a11y pass (keyboard-only tab-through, NVDA spot check)

**Exit criteria:** all routes navigable with realistic data; zero console errors; a11y checklist passes; build green.

---

## Phase 3 — Persistence layer (Tiger Data) ⬜

Branch: `phase/3-data`

Goal: readings become history. Everything later (prediction, retrodiction, watcher) reads from here.

Tasks:
- Provision Tiger Data free service; `DATABASE_URL` in `.env`
- Schema: `rivers`, `readings(time, river_id, discharge, source, fetched_at)` (time-series friendly), `sources`, `predictions` (for Phase 4)
- Data-access layer in `src/lib/db.ts` (upsert readings, query ranges, latest per river)
- Backfill script: fetch and store the historical record per river (deep past for training, recent for retrodiction)
- Dashboard switches from live-fetch to DB-first with API fallback
- pgvector column + embedding backfill for later knowledge search (river notes, sources)

Testing in this phase:
- Integration tests against a throwaway Postgres (docker or local) for upsert/query logic
- Backfill verification: row counts + spot values match the API for known dates (e.g., Indus 2022-07-02 = 12,022)

**Exit criteria:** dashboard serves from DB; history stored for all 4 rivers; tests green.

---

## Phase 4 — Flow prediction (TabPFN + FastAPI) & retrodiction ⬜

Branch: `phase/4-predict`

Goal: the flagship artifact — honest, checkable prediction.

Tasks:
- FastAPI microservice wrapping TabPFN (`/v1/predict`, `/v1/backtest`, `/v1/health` — see [API.md](../docs/API.md) §1); runs on CPU (small data)
- Features per river-day: day-of-year, past N days' discharge, upstream catchment rain (Open-Meteo archive), temperature signal
- Predict next 7-day discharge **band** (e.g., 600–900 m³/s), never a single number
- Backtest harness: hide last 4 weeks, predict from history only, score vs stored truth (MAE, band coverage %)
- `/retro` page goes live: predicted band vs recorded truth, per river, with metrics shown — misses included
- Store predictions in DB with model version

Testing in this phase:
- Backtest is the test: report metrics; define honest thresholds (e.g., band coverage ≥ 70% to claim "weekly window")
- Service contract tests (fixture inputs → shaped outputs)

**Exit criteria:** retrodiction page shows real predicted-vs-actual for all 4 rivers with published metrics; service reproducible via documented command.

---

## Phase 5 — Live search & runnable ranges (SerpApi) ⬜

Branch: `phase/5-search`

Goal: replace "range not yet verified" with cited, sourced ranges; add access/closure awareness.

Tasks:
- Scout queries per river: rafting operator pages, guidebook text, trip reports (SerpApi; budget-aware: ~100 free searches/month → cached, weekly cadence)
- Range extraction: candidate "runnable between X and Y" statements **with source URL + quote**; confidence flag; ranges stay "unverified" until ≥1 credible source
- Fill `runnableRange` for Indus/Kunhar/Swat; Malir stays explicitly "not a paddling river"
- Access notes: put-ins, operators, permit mentions per river, each with source + date
- Search-budget meter in admin/logs (never blow the free tier)

Testing in this phase:
- Extraction tests on saved search fixtures (no live calls in CI)
- Cache/quote integrity tests: nothing renders without a source

**Exit criteria:** chart shows sourced range bands for 3 rivers; every claim links to its source; budget respected.

---

## Phase 6 — Plain-language layer (hosted Gemma) ⬜

Branch: `phase/6-llm`

Goal: one honest sentence per river. The open-weight model does real work.

Tasks:
- Provider setup (Google AI Studio free tier first; provider-swappable via one config)
- Prompt + schema: inputs = level, band, range, access notes; output = 1–2 sentences + status word, conservative tone enforced
- Guardrails: never "safe"; danger language for high water; no invented numbers (model may only reference provided values — validated post-hoc)
- Fallback: templated non-LLM sentence when API unavailable (site never breaks)
- Cache summaries per fetch cycle (cost control)

Testing in this phase:
- Eval set of ~50 synthetic river-states → check status word correctness, no "safe", no invented numbers
- Latency/cost logged per summary

**Exit criteria:** dashboard shows Gemma sentences on all rivers; eval set passes; fallback proven by forced API failure.

---

## Phase 7 — Durable watcher (Temporal) ⬜

Branch: `phase/7-watcher`

Goal: the system runs itself for weeks and survives failures — the Temporal category's core demo.

Tasks:
- Temporal dev-server binary locally (no Docker dependency)
- Weekly workflow per river: fetch → store → predict → summarize → detect range-crossing; activity retries with backoff
- Catch-up behavior: missed schedules resume; duplicate runs are idempotent (upserts)
- Optional email nudge when a river enters its range (Resend/Gmail SMTP, free tier)
- Production: Temporal worker as a Render background worker (laptop-free operation); if free-tier constraints bite, fall back to a worker-internal durable loop with Temporal kept for dev/tests — **decision recorded as an ADR** (TECHNICAL_ARCHITECTURE.md D5)

Testing in this phase:
- Workflow tests: forced activity failures → assert retries and completion
- Idempotency test: run workflow twice on same data → no duplicate rows

**Exit criteria:** a forced kill mid-run resumes correctly; a full week's cycle executes end-to-end on schedule; worker deployable.

---

## Phase 8 — Testing & QA gate ⬜

Branch: `phase/8-qa` (or folded into each merge as it grows)

Goal: prove it all works together, honestly.

- Full unit + integration + e2e suite green (Playwright smoke: dashboard, river page, retro page load with data)
- Honesty checklist review: every number traceable to a source; every chart dated; conservative language everywhere; cells/dates visible
- a11y audit (keyboard, contrast, NVDA pass)
- Cost audit: SerpApi budget, LLM tokens, DB size — all inside free tiers
- Failure drills: kill network mid-cycle, kill DB, expire LLM key → site degrades gracefully
- Performance: first-load budget on free Render tier (cached pages where possible)

**Exit criteria:** all gates pass; issues found are fixed or consciously documented as limitations.

---

## Phase 9 — Deploy & hardening (Render) ⬜

Branch: `phase/9-deploy`

- Render: web service (Next.js) + background worker (Temporal worker) + env vars from `.env` names
- DB migrations run on deploy; health endpoint; uptime check
- Sentry (optional) for error/tracing visibility — doubles as Agent-Tracing category evidence
- Final verification against production URL (retro page, summaries, scheduler firing)

**Exit criteria:** public URL stable; one full scheduled cycle observed in production; free-tier limits verified.

---

## Phase 10 — Demo, write-up & submission ⬜

Branch: `phase/10-submission` (docs mostly)

- Demo assets: dashboard screenshots, retrodiction reveal (the flagship image), one operator quote, 20-second narrative GIF
- DEV post draft in `docs/post-draft.md`: submission template, hook (paddlers' problem), live demo link, how-it-works, why-open-matters (free to run, open data, open-weight swappable model, no field trips needed to verify — retrodiction), honest metrics, what's next
- Category entries (genuine ones only): Temporal · TabPFN · SerpApi · Tiger Data · Gemma · Render · GitHub Copilot · Entire (+optional Sentry, ElevenLabs)
- Submission checklist: template followed, DevRelay/Entire session link, tags (`hf26challenge`), submitted before deadline

**Exit criteria:** post published; all category entries made; repo + demo link live in the post.

---

## Dependencies & order rationale

- **UI first (Phase 2)** per project decision: every later phase has a visible home, so integration never rewrites the front end.
- Data (3) before prediction (4): prediction needs stored history.
- Search (5) and LLM (6) are independent of each other — can run in either order or parallel.
- Watcher (7) comes after everything it orchestrates exists.
- QA (8) is continuous but gates Phase 9.

## Action items

1. ✅ ~~Create the GitHub repo and push~~ — done: `github-personal:abubakar-ahmed-dev/paddle-sense`, `dev` pushed and tracking
2. Free accounts/keys for upcoming phases (provide each when its phase starts): Tiger Data (Phase 3) · SerpApi (5) · Google AI Studio (6) · Resend or Gmail SMTP (7, optional)
3. Delete the old `next-one` and `darya` folders manually (both held by the earlier session's locks; only empty shells/agent settings inside)
