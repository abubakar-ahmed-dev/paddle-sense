# PaddleSense — Technical Architecture

| | |
|---|---|
| Scope | How PaddleSense is built: components, data flows, decisions, failure behavior |
| Status | v1 — matches Phase 1 (dashboard) and the Phase 2–9 build plan |
| Related | [PRD.md](PRD.md) (what & why) · [../plans/plan.md](../plans/plan.md) (when) · [deep-dive.md](deep-dive.md) (research) |

---

## 1. Design principles

1. **Open data in, honest answers out.** Every displayed value is traceable to a named public source with a date. The UI layer enforces this structurally (components require provenance).
2. **Facts, not verdicts.** Safety-relevant language is deterministic, conservative code — never model output. The LLM summarizes; it never decides.
3. **$0 and swappable.** Every external service sits behind a thin adapter with a free tier, and can be replaced by editing one config/adapter file.
4. **Durable by default.** Anything that must happen on a schedule lives in a Temporal workflow, not a cron job or a request handler.
5. **Bands, not points.** Hydrology is uncertain; the product shows ranges and publishes how often it was right.

---

## 2. System context

```
                ┌────────────────────────────────────────────┐
                │                 PaddleSense                │
                │                                            │
 Open-Meteo ────┼──► ingestion ──► Tiger Data ──► Next.js ───┼──► paddler (browser)
 Flood API      │   (Temporal     (Postgres +     web app    │
 (GloFAS)       │    worker)       pgvector)       (Render)  │
                │        │                                │
 SerpApi ───────┼──► scout ──────► sources              │
                │        │                                │
 Open-Meteo ────┼──► predictors (TabPFN/FastAPI) ─► predictions
 weather archive│        │                                │
                │        ▼                                │
 hosted Gemma ◄─┼── summarizer ──► cached sentences       │
 (open-weight)  │        │                                │
                │        ▼                                │
                │   range-crossing detector ──► email ────┼──► operator (inbox)
                └────────────────────────────────────────────┘
```

All arrows into PaddleSense are read-only public data; all arrows out are a web page and an email.

---

## 3. Components

### 3.1 Web application — Next.js 16 (TypeScript, Tailwind, Recharts)

- **Routes:** `/` dashboard · `/river/[id]` detail · `/retro` retrodiction · `/about` data honesty
- **Rendering model:** Next 16 `cacheComponents` — the dashboard is a blocking-dynamic route (`export const instant = false` + `await connection()`), because levels are live; static shells with `"use cache"` are used for anything not per-request (about page, river history charts once persistence lands)
- **Key modules:**
  - `src/lib/rivers.ts` — the only place rivers, cells, and range states are defined (config, not literals in code)
  - `src/lib/flood.ts` — typed Open-Meteo Flood API adapter (current value, week band) — becomes the ingestion client in Phase 3
  - `src/lib/db.ts` *(Phase 3)* — data-access layer; the only code that talks SQL
- **UI rules enforced in code:** every number-rendering component takes a `source` prop (origin URL + fetch date); status badges come only from `computeStatus()` (FR-11), never from LLM output

### 3.2 Storage — Tiger Data (Postgres + pgvector)

```sql
rivers       (id, name, stretch, cell_lat, cell_lon, cell_elevation,
              runnable_lo, runnable_hi, range_state, range_source_id)
readings     (river_id, date, discharge, source, fetched_at,
              PRIMARY KEY (river_id, date))          -- time series, idempotent upserts
sources      (id, url, kind, fetched_at)             -- provenance for every claim
predictions  (river_id, created_at, target_week, band_lo, band_high,
              model_version, metrics jsonb)
notes        (river_id, text, source_id, embedding vector(384))  -- hybrid search later
```

- Time-series access is range-scoped queries by `(river_id, date)`; no separate timescaleDB features needed at this scale (4 rivers × ~15k days)
- pgvector stores small local embeddings (all-MiniLM-class model) for "similar river notes" and prompt-context retrieval
- Retention: everything; the dataset is the retrodiction evidence

### 3.3 Ingestion — fetchers (inside Temporal activities)

- **Flow fetcher:** one call per river per cycle (`past_days=14&forecast_days=30`), normalized to `readings` upserts; stores both observed and forecast series separately (forecast rows flagged, never mixed with history)
- **Scout (Phase 5):** SerpApi queries per river (runnable range, access, closures), results cached by query-hash; hard monthly budget meter (≤ 100); extracted claims stored with verbatim quote + URL; CI uses recorded fixtures, never live calls
- Idempotency: upserts keyed on `(river_id, date)` and `(source url)` — a workflow that runs twice changes nothing

### 3.4 Prediction service — FastAPI + TabPFN

- Process: small Python service, CPU-only; started alongside dev, deployed as its own Render free web service (or sidecar worker) in Phase 4
- Endpoints:
  - `POST /predict` — river_id + recent history + weather features → `{band_lo, band_high, model_version, coverage_estimate}` for each of the next 7 days
  - `POST /backtest` — river_id + hidden-window spec → per-day predicted vs actual + MAE + band coverage
- Feature engineering (per river-day): day-of-year (sin/cos), discharge lags t-1…t-7, upstream catchment rain sums (3d/7d/14d from Open-Meteo archive), temperature signal (snowmelt proxy)
- Band construction: quantile-style spread around the TabPFN point estimate (empirical residual quantiles from backtests) — a 70–80% coverage band by construction
- Honesty: model version + training-window recorded per prediction; the retrodiction page reads `predictions` + `readings` and never re-computes on the fly

### 3.5 Language layer — hosted Gemma (open-weight)

- **Provider adapter:** one module; Google AI Studio first, Groq/Together swappable via env (`LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`)
- **Input:** structured JSON only (level, band, range state, access notes, sources) — the model never fetches anything
- **Output schema:** `{sentence, status_word, confidence}`; post-hoc validation: every number in the sentence must exist in the input; `status_word` must equal the deterministic `computeStatus()` result; "safe" is a banned token
- **Fallback:** if the provider errors or validation fails, a templated non-LLM sentence is rendered — the site never breaks because an LLM did
- **Caching:** one summary per river per fetch cycle, stored with the cycle's data

### 3.6 Orchestration — Temporal

- **Local dev:** Temporal dev-server binary (`temporal server start-dev`) — no Docker requirement
- **Production:** self-hosted server is *not* deployed; worker connects to a lightweight Temporal server on the same Render worker, or (if that proves flaky on free tiers) the schedule degrades to a worker-internal durable loop with Temporal retained for dev/tests — decided in Phase 7 with a documented ADR
- **Workflow (weekly, per river):** `fetch flow → store → scout → predict → summarize → detect range-crossing → maybe notify`
- **Activities** are small, typed, and independently retried (exponential backoff); the workflow survives restarts and catches up missed schedules
- **Tests:** activity-failure injection asserts retries; double-run asserts idempotency

### 3.7 Notifications (Phase 7, optional)

- Email via Resend free tier or Gmail SMTP — single opt-in recipient, one email per river-crossing event per week (rate-limited), body = the deterministic status + sources (never the LLM sentence alone)

---

## 4. Key data flows

### 4.1 Weekly cycle (the heartbeat)

```
Temporal cron (weekly)
  └─ per river:
       fetchDischarge(river)          → readings (observed + forecast rows)
       scoutSearch(river)  [cached]   → sources, notes
       predict(river)                 → predictions (band, model_version)
       summarize(river, structured)   → cached sentence (validated)
       computeStatus(river)           → dashboard state, crossing events
       notifyIfCrossing(river)        → optional email
```

### 4.2 Request path (user opens dashboard)

```
browser → Render (Next.js)
  → db.latest(river), db.band(river), cached sentence   (Tiger Data)
  → render cards: level, band chart, status, sentence, provenance footer
```

No external API is called in the user request path — everything user-facing is served from storage/cache. This keeps the free tier fast and the site resilient to provider outages.

### 4.3 Trust path (retrodiction)

```
Phase 4 backtest job: hide last 4 weeks → /backtest → store predictions + metrics
/retro page reads predictions vs readings → plot band vs truth → publish MAE/coverage
```

---

## 5. Repository layout (target)

```
paddle-sense/
├─ src/
│  ├─ app/                    # Next.js routes (dashboard, river, retro, about)
│  │  └─ _components/         # UI components (RiverChart, StatusBadge, …)
│  ├─ lib/
│  │  ├─ rivers.ts            # river/cell/range config (single source of truth)
│  │  ├─ flood.ts             # Open-Meteo Flood adapter
│  │  ├─ db.ts                # Tiger Data access layer (Phase 3)
│  │  ├─ scout.ts             # SerpApi adapter + budget meter (Phase 5)
│  │  ├─ llm.ts               # Gemma provider adapter + guardrails (Phase 6)
│  │  └─ status.ts            # computeStatus() — deterministic, unit-tested
│  └─ workers/                # Temporal workflows + activities (Phase 7)
├─ services/predict/          # FastAPI + TabPFN service (Phase 4)
├─ docs/                      # PRD, architecture, deep-dive
├─ plans/                     # phase plan with progress
└─ .env.example
```

---

## 6. Technical decisions (ADR summary)

| # | Decision | Rationale | Rejected alternatives |
|---|---|---|---|
| D1 | GloFAS via Open-Meteo Flood API as the only flow source | Global (covers Pakistan), free, no key, 1984+ history, verified against 2022 record | USGS (US-only); national gauges (no public API for PK) |
| D2 | Tiger Data (Postgres + pgvector) | Free plan covers scale; time-series + vector in one DB; challenge category fit | MongoDB (fine but no advantage here); SQLite (no hosted free tier for the worker) |
| D3 | TabPFN for flow bands | Tabular weekly-forecast task, small data, CPU-friendly, honest band via residual quantiles | LSTM/Prophet (more tuning, worse story); raw GloFAS forecast alone (no learning from local residual structure) |
| D4 | Hosted Gemma, not local Ollama | Builder hardware constraint; challenge explicitly allows provider serving; swappable adapter keeps open-weight story | Local Gemma (no GPU); closed APIs (breaks the open-core requirement) |
| D5 | Temporal for scheduling | Weeks-long durable watcher is the product's spine; retries/catch-up/idempotency for free | cron (no retry/durability story); queue workers (same, weaker narrative) |
| D6 | Deterministic status + LLM summary split | Safety language must be testable; LLM only translates | LLM-decides-status (untestable, unsafe) |
| D7 | Bands, never point predictions | Hydrology uncertainty; enables honest coverage metrics | Point forecast + error bars added later (same thing, worse framing) |
| D8 | Next.js blocking-dynamic dashboard + cached everything else | Free-tier latency without stale levels | Fully static (stale data); fully dynamic (slow on free tier) |

---

## 7. Configuration (environment)

| Var | Used by | Phase |
|---|---|---|
| `DATABASE_URL` | db layer, workers | 3 |
| `SERPAPI_KEY` | scout | 5 |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` | summarizer | 6 |
| `NOTIFY_EMAIL_*` (provider key, recipient) | notifications | 7 |
| `TEMPORAL_ADDRESS` (dev default) | workers | 7 |
| `SENTRY_DSN` (optional) | tracing | 9 |

Secrets live only in `.env` (git-ignored) and Render env vars. `.env.example` documents all names; no real values ever in git.

---

## 8. Failure behavior (degradation matrix)

| Failure | User-visible result | System behavior |
|---|---|---|
| Flood API down on cycle day | Dashboard shows last stored cycle with its date | Activity retries with backoff; next cycle heals |
| Tiger Data unreachable | Cached page + error banner on live parts | Worker retries; site never 500s on the dashboard shell |
| SerpApi budget exhausted | Ranges keep last verified state, marked with age | Scout skips month; no live calls in request path anyway |
| Gemma provider down / invalid output | Templated fallback sentence | Validation failure logged; flagged in cycle report |
| TabPFN service down | Prediction card shows "unavailable this week" + prior band age | Retrodiction page still renders stored results |
| Worker killed mid-cycle | Nothing visible | Temporal resumes; idempotent upserts make the re-run a no-op |
| Whole Render service down | Site unreachable | Free-tier risk accepted; redeploy is one command |

---

## 9. Security

- Read-only public data in; no user input touches SQL (typed parameterized access layer)
- No accounts, no PII; notification email is the only personal data and lives in env
- Secrets in `.env`/Render only; `.env*` git-ignored, `.env.example` committed
- Outbound calls restricted to allowlisted hosts per adapter

---

## 10. Performance notes

- User request path touches only Tiger Data + cache (no third-party calls) — targets < 3 s first paint on Render free tier
- Charts render from at most ~45 points (14 past + 30 forecast); history views are range-limited queries
- SerpApi calls happen in the weekly cycle with query-hash caching; CI replays fixtures
- LLM cost: ≤ 4 summaries/week (one per river) + eval runs

---

## 11. Testing strategy (summary)

| Layer | Tool | Gate |
|---|---|---|
| Status/range/band logic | Vitest unit | `computeStatus()` truth table 100% |
| DB access | Integration (throwaway Postgres) | Upserts idempotent; queries scoped |
| External API adapters | Contract tests on fixtures | No live calls in CI |
| LLM output | Eval set (~50 states) | No "safe", no invented numbers, correct status word |
| Prediction | Backtest harness | Coverage/MAE published, threshold ≥ 70% or documented |
| Workflows | Temporal test framework | Retry + idempotency proven |
| E2E | Playwright smoke | Dashboard, river, retro load with data |
| Accessibility | Manual + automated checks | Keyboard, contrast, NVDA pass |

Phase-by-phase gating lives in [../plans/plan.md](../plans/plan.md).

---

## 12. Known constraints & limitations

1. GloFAS is a ~5 km global model: narrow valleys (Skardu, upper Swat) resolve poorly; chosen cells are best-available main-stem representations and are labeled as such in the UI
2. Forecast skill is unproven until Phase 4's backtest; until then the UI says "range not yet verified"
3. Free tiers mean cold starts (Render), monthly quotas (SerpApi), and rate limits (LLM) — all handled by the degradation matrix above
4. Solo-builder bus factor is 1; every external system is documented here and swappable by design
