# Phase 4 — Flow prediction (TabPFN + FastAPI) & retrodiction — Phase Plan

Branch: `phase/4-predict` (from `dev`) · Master plan ref: Phase 4 · Written: 2026-10-09

## Context check (repo state at re-planning)

- Phase 3 merged (PR #2): `readings` populated (4 rivers × 2015→today, 17,196 rows),
  `predictions`/`sources`/`summaries`/`notes` tables exist and are empty;
  migration/seed/backfill scripts re-runnable; `npm run verify` green
- Dashboard is DB-first with live fallback (`src/lib/series.ts`, FRESH_DAYS=3)
- `/retro` is a clearly-labeled SAMPLE shell (`src/app/retro/page.tsx`) waiting for this phase
- No Python code anywhere yet; no `services/` directory
- Python **3.13.7 verified on owner machine** (needs-and-requirements Phase 4 prerequisite ✅)
- `X_INTERNAL_TOKEN` per needs-and-requirements: **agent generates randomly**, owner approves storage in `.env` — done at phase start, only "provided ✓" logged
- `.env.example` has `X_INTERNAL_TOKEN`; **no `PREDICT_URL` yet** — this phase adds it (ARCH §7 update travels with the code)

## Decisions (P4-x, proposed — standing unless owner changes)

| # | Decision | Rationale |
|---|---|---|
| P4-1 | Service is **stateless and DB-free**; caller supplies history/weather/truth per the API.md §1 contract | Single DB layer stays in Node (D2 boundary); service deployable anywhere, contract-tested on fixtures; Python never needs DATABASE_URL |
| P4-2 | Node orchestrators own DB + orchestration: `scripts/backtest.mjs` and `scripts/predict.mjs` (+ `scripts/lib/db.mjs` reads/writes, `scripts/lib/weather.mjs` archive fetch) | Mirrors Phase 3 script pattern (scripts can't import TS `lib/`); TESTING.md §3's `python backtest.py` line is amended to the real command — deliberate doc change recorded in implementation logs |
| P4-3 | **Direct per-horizon models**: one feature matrix + TabPFN fit per horizon h=1..7; no recursion | No compounding error; each day's band is its own estimate; enables honest per-day coverage. ~7 fits/river/call on ~4.3k rows is CPU-seconds each |
| P4-4 | Model regresses `log1p(discharge)`; inverse-transform to m³/s; **bands are empirical residual quantiles in log space at coverage_target 0.75** | Matches ARCH §3.4 + API.md §1.1 note ("empirical-residual quantiles"); log space = multiplicative bands, correct for discharge spanning 0.1–12,000 m³/s (Malir vs Indus) |
| P4-5 | Feature set per river-day: doy sin/cos, discharge lags t-1…t-7, rolling mean 7d/28d, rain sums 3d/7d/14d, temp mean 7d | ARCH §3.4 verbatim. Weather features need **per-day weather across the whole context**, so both endpoints accept an **optional additive field `weather_series`** (`[{date, rain_mm, temp_mean_c}]`); without it the model runs discharge-only. API.md §1 gets a short additive note (v1 request examples stay valid) |
| P4-6 | Orchestrators always send `weather_series` (fetched once per river from Open-Meteo Archive API, cached locally in git-ignored `.cache/`) | Published retro metrics then describe the exact deployed feature pipeline, not a weaker variant |
| P4-7 | Metrics storage: one `predictions` row per backtest day, `kind='backtest'`, full `metrics` jsonb (`{mae, band_coverage, days, trained_through}`) repeated on every row of the run; all rows of one run share one transaction (same `created_at` groups them) | Satisfies invariant P1 without schema change; `/api/v1/retro` picks the newest run per river |
| P4-8 | `/retro` renders only stored rows (never recomputes); page is blocking-dynamic like the dashboard (`instant=false` + `await connection()`) | DATA_DICTIONARY §5; reuses the Phase 3 rendering pattern |
| P4-9 | Live `kind='forecast'` rows seeded once via `scripts/predict.mjs` to prove the mechanism end-to-end; **river-page band display stays out of scope** (UX_SPEC §4.2 defines no prediction slot — adding UI not in the spec would be a spec deviation) | Weekly forecast writes become the Phase 7 worker's job |

## Contract compliance notes

- Endpoints implement API.md §1 **exactly**: `POST /v1/predict`, `POST /v1/backtest`, `GET /v1/health`; auth `X-Internal-Token` (403 missing/wrong); `400 invalid_history` (gaps/unsorted); `422 unknown_river` (static registry of the 4 ids); pydantic validates both directions
- `weather` object on `/v1/predict` is accepted and validated per contract; with P4-5 the per-day series supersedes it when present — contract note added to API.md, no breaking change
- `coverage < 0.70` ⇒ `/retro` renders the `attention` chip **experimental** (PRD §12 success metrics; UX_SPEC §4.3)
- Malir stays in the backtest (master plan: all 4 rivers) — its near-zero hydrograph is a real stress test of log-space bands

## Tasks (ordered)

1. **Env + token** — generate `X_INTERNAL_TOKEN` (random 32-byte hex) into `.env`; add `PREDICT_URL=http://localhost:8000` to `.env` + `.env.example`; update needs-and-requirements.md statuses (Python ✅, token ✅)
2. **Service scaffold** — `services/predict/`: `requirements.txt` (fastapi, uvicorn, tabpfn, pydantic, numpy), `app.py` (FastAPI app, auth dependency, health), `registry.py` (4 river ids), `model.py` (feature builder, TabPFN wrapper, residual-quantile bands), `metrics.py` (MAE, coverage). Run instruction in `services/predict/README.md`. **Early gate: `pip install -r requirements.txt` works on Python 3.13 + first TabPFN call downloads weights** — escalate to owner (side-by-side Python 3.11/3.12) if the wheel stack fails
3. **Model core (pure functions)** — feature matrices per horizon; log1p transform; calibration residuals from a recent internal holdout; band construction; metric computation
4. **Endpoints** — `/v1/predict`, `/v1/backtest` with pydantic schemas mirroring API.md §1; `weather_series` optional additive field
5. **pytest suite** (`services/predict/tests/`, fixtures only, no network): contract shapes (valid fixture → 200), 403/400/422 paths, feature-builder correctness (lag windows, doy range, weather join), band math (lo ≤ point ≤ high, positivity after inverse), metrics vs hand-computed values, registry parity with `scripts/rivers.json`
6. **Node orchestrators** — `scripts/lib/weather.mjs` (archive API: `precipitation_sum`, `temperature_2m_mean`; local cache), `scripts/lib/db.mjs` (read observed series, insert prediction rows), `scripts/backtest.mjs` (per river: hidden window = last 28 days; write kind='backtest' rows + metrics in one transaction), `scripts/predict.mjs` (write kind='forecast' rows, `coverage_target=0.75`, model_version echoed verbatim per contract)
7. **DB access + route** — `src/lib/db.ts` additions: `insertPredictions(rows)`, `getLatestBacktest(riverId)` (newest run: rows + metrics); `GET /api/v1/retro?river_id=&window=` route per API.md §2.4
8. **`/retro` goes live** — replace SAMPLE shell: explainer (keep), per-river `MetricRow` (model_version · MAE · coverage + experimental chip), band-vs-actual chart (Recharts; translucent accent band per UX_SPEC §4.3, actual as solid line; misses visible), miss table, data-window statement from stored metrics; EmptyState remains for rivers without a run; SAMPLE banner removed
9. **Real run** — service up; `npm run backtest` all 4 rivers → rows stored; metrics → **`docs/retro-metrics.md`** (TESTING.md §6 Phase 4 gate) including runtime notes and, if time allows, a with/without-weather comparison run (honest ablation)
10. **Integration tests** — extend `tests/integration/`: P1 (backtest ⇔ metrics present), P2 (every backtest row has a matching `readings` truth row), idempotent re-run (same run twice = no dup days per run), `/api/v1/retro` route returns stored run
11. **Docs** — API.md §1 additive `weather_series` note; TESTING.md §3 command fix (`node scripts/backtest.mjs --river <id>`); ARCH §7 + `PREDICT_URL`; RUNBOOK entries (service down → "unavailable this week" path, TabPFN weight-download failure, port 8000 busy); README status row; plan.md master progress marker at merge
12. **Logs + PR** — implementation-logs.md / testing-logs.md current; `npm run verify` green; PR `phase/4-predict` → `dev`

## Test list (gate)

- pytest: contract shapes + error paths (403/400/422), features, bands, metrics, registry parity — fixtures only
- Real backtest run for 4 rivers: MAE + band coverage recorded in `docs/retro-metrics.md`; coverage ≥ 0.70 → full claim, < 0.70 → published with "experimental" label (both honest, gate passes either way if published with analysis)
- Integration: P1, P2, idempotent re-run, retro route
- `npm run verify` green

## Acceptance (exit criteria)

`/retro` shows real predicted-vs-actual for all 4 rivers with published metrics; backtest reproducible via documented commands; `predictions` populated for both kinds; contract tests + integration tests green; `npm run verify` green; logs current.

## Risks

| Risk | Mitigation |
|---|---|
| tabpfn/torch wheels fail on Python 3.13 + Windows | Test install in task 2, first thing. Contingency: owner installs Python 3.11/3.12 side-by-side (flagged immediately, not mid-phase) |
| TabPFN weights need HuggingFace download at first run | Documented in service README + RUNBOOK; failure = explicit error, never silent |
| Coverage < 0.70 | Expected possibility (PRD risk table): publish metrics lower with analysis + "experimental" chip. Never tune silently to pass |
| Weak laptop runtime (56 fits per full run) | Measure in task 9; if > 10 min, restrict context to recent 5 years (documented, not silent) |
| Archive API multi-year call shape differs from Flood API | Fixture recorded first (tests/fixtures/archive/), adapter written against it |
| Malir log-space bands on near-zero values | log1p handles zeros; verified in pytest with a Malir-like fixture |

## Out of scope (later phases)

Temporal worker scheduling (7) · river-page band UI (not in UX_SPEC) · SerpApi (5) · Gemma (6) · Render deploy of the service (9) · embedding backfill (P3-4 deferral)
