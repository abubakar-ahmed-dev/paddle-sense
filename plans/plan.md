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

## Phase 2 — Complete UI (deliberately early) ✅ DONE (2026-10-08, PR #1)

> Delivered: Indus Silt theme (owner-approved), `/river/[id]` with 30d/90d/1y windows and peak stats, `/retro` shell with labeled sample, `/about`, `computeStatus()` + 16 unit tests, a11y pass (code-level). Logs: [phase-2-ui/](phase-2-ui/).

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

## Phase 3 — Persistence layer (Tiger Data) ✅ DONE (2026-10-08, PR #2)

> Delivered: schema per DATA_DICTIONARY (invariants as CHECKs, pgvector columns), migrate/seed/backfill scripts, 17,196 readings (4 rivers × 2015→today), backfill fixture PASS (Indus 2022-07-02 = 12,021.64 vs record 12,022), dashboard DB-first with live fallback + honest source labels, integration suite 6/6 in Docker. Logs: [phase-3-data/](phase-3-data/).

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

## Phase 4 — Flow prediction (TabPFN + FastAPI) & retrodiction ✅ DONE (2026-10-09, PR #3)

> Delivered: stateless FastAPI+TabPFN service (tabpfn 2.0.9, log1p bands via empirical residual quantiles, leak-free walk-forward backtest), backtest+predict orchestrators, live `/retro` + `/api/v1/retro`, predictions stored (4×28 backtest + 4×7 forecast rows). Published metrics: coverage 82–96% (all ≥ 70% gate) — [docs/retro-metrics.md](../docs/retro-metrics.md). Logs: [phase-4-predict/](phase-4-predict/).

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

## Phase 5 — Live search & runnable ranges (SerpApi) ✅ DONE (2026-10-09, PR #4)

> Delivered: scout ledger + budget meter (9/90 live searches spent, cache proven live), `src/lib/scout.ts` (regex range extraction with unit-required rule, cfs→m³/s beside verbatim quotes, keyword gates + river-relevance gate), token-protected `POST /api/internal/scout`, owner review path (`npm run range-candidates`, zero auto-promotion), river-page sourced notes + chart band overlay + `/about#ranges`. **Honest negative result:** no published cfs-style runnable ranges exist for Indus/Kunhar/Swat — first-cycle candidates were all US-river false positives, fixed by the relevance gate under the bug protocol (2 real fixtures as regression tests); ranges stay "not yet verified". 22 genuine access/closure/operator notes stored; Malir never scouted. Logs: [phase-5-search/](phase-5-search/).

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

## Phase 6 — Plain-language layer (hosted Gemma) ✅ DONE (2026-10-09, PR #5)

> Delivered: `src/lib/llm.ts` (provider-swappable adapter; JSON by prompt;
> 4-gate validation: schema → numerals ⊆ input + foreign-unit rejection →
> `status_word === computeStatus()` → banned tokens; UX_SPEC §6 fallback
> templates; cache-before-call per river per cycle_date), token-protected
> `POST /api/internal/summarize`, dashboard card item 4 with provenance,
> eval set (30 legit runs 100% pass, 15 adversarial 100% caught) + two
> live-recorded Gemma fixtures. Live on `gemma-4-26b-a4b-it` (chosen over
> `gemma-4-31b-it` by probe: ~15–25 s vs ~36 s): Gemma-4 `<thought>` blocks
> handled (cannot be disabled — parser strips, max_tokens 2048); real
> unit-relabel failure ("1632 cfs") caught and kept as a fixture; first
> cycle 3/4 stored + 1 honest fallback, same-day rerun 3 cache hits + retry
> stored. `npm run verify` exit 0; test:db 29/29 (integration files now
> sequential — shared-Postgres race fixed). Logs: [phase-6-llm/](phase-6-llm/).

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

## Phase 7 — Durable watcher (Temporal) ✅ DONE (2026-10-09, PR #6)

> Delivered: `workers/` (activities wrapping the existing libs with zero
> duplicated logic; `weeklyCycle` workflow with per-river isolation + 5×
> backoff retries; worker boot gate — env + migrations — with schedule
> create-or-update, Mondays 06:17 UTC), `src/lib/notify.ts` (transition-
> into-`in_range` email via Resend, deterministic §6 body — never the LLM
> sentence alone), `npm run temporal:dev` (CLI binary, SQLite-persisted) +
> `npm run start:worker`. **Live-proven:** full cycle (scout 0 spent/9 cache
> hits, 4×14 readings, 4 forecast runs, 4 summaries); same-day re-run fully
> idempotent (predict skipped, summaries cached, notify skipped); worker
> killed mid-cycle → workflow resumed on restart → completed; real email
> delivered (Resend id logged). Pre-merge catch: summarize cache path now
> returns `stored:false` so resume can never re-email. `npm run verify`
> exit 0 (116 tests); test:db 33/33. Known honest limit: the nudge is
> dormant until a human verifies a runnable range. Logs:
> [phase-7-watcher/](phase-7-watcher/).

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

## Phase 7b — Trust & depth hardening (stretch) ⬜

Branch: `phase/7b-hardening`

> Added 2026-10-10 after a judge-lens review of the repo ("with plenty of
> time, what upgrades win?"). Pure-upside phase: every item closes a
> checkable gap or strengthens a partner-category story. Highlights:
> GitHub Actions CI (web + db + predict jobs), real Playwright smoke
> (TESTING.md's documented `test:e2e` made true), pgvector activated
> (0/22 notes embedded today → semantic search over river notes via local
> MiniLM), Urdu scout queries with an Urdu-aware relevance gate, per-horizon
> (day-1/day-7) backtest metrics, Gemma A/B table + recorded high-water
> softening fixture, last-year comparison line + season strip on charts,
> coverage measured, docs-vs-reality sweep, D5 decision criteria, demo
> script, and an owner-in-the-loop range-verification drive (verified river
> or honest negative — both acceptable outcomes).

Goal: make every claim in the docs true, every partner technology visibly
earn its category entry, and the demo assets deliberate.

**Exit criteria:** CI green on `dev`; e2e real; semantic search live;
Urdu queries inside budget; per-horizon metrics published; no checkable
doc untruths; range-verification attempt documented.

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

> Note (added 2026-10-10, from Phase 7b review): deploy **early**, not as
> the last step — free-tier cold starts and the worker memory measurement
> (D5 evidence per P75-11) need calendar room, and the production path is
> pre-decided as the worker-internal durable loop with Temporal on
> dev/tests.

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
