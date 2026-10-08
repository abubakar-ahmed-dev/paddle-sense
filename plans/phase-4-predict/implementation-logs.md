# Phase 4 — Implementation Log

Append-only by date. Updated whenever any phase file is created or changed.

## 2026-10-09

- Created phase folder + `plan.md` (re-planned against post-Phase-3 repo state).
- Verified Python 3.13.7 on owner machine (needs-and-requirements prerequisite).
- Key decisions recorded in plan.md (P4-1…P4-9): stateless DB-free service; Node
  orchestrators own DB; direct per-horizon TabPFN fits; log1p space with empirical
  residual-quantile bands at coverage_target 0.75; additive optional `weather_series`
  request field (API.md note to follow); metrics jsonb per backtest row (P1-safe);
  `/retro` renders stored rows only; river-page band UI out of scope (not in UX_SPEC).
- Pending from plan: `X_INTERNAL_TOKEN` generation into `.env` (task 1), tabpfn
  install gate on Python 3.13 (task 2).

### Implementation notes (same day)

- **Env (task 1) done** — `X_INTERNAL_TOKEN` generated (random 32-byte hex) into
  `.env`; `PREDICT_URL=http://localhost:8000` added to `.env` + `.env.example`;
  needs-and-requirements statuses updated. Commit `da0176f`.
- **tabpfn version deviation from plan** — plan guessed `tabpfn==6.1.0`; reality:
  9.1.0 is latest and gates model weights behind a Prior Labs account + browser
  license acceptance (fails headless with `OSError: [WinError 10038]` in
  `browser_auth.py`). Pinned **tabpfn==2.0.9**: public weights, headless download,
  verified fit+predict on 3.13. Documented in requirements.txt comment + service README.
- **Context size deviation (documented, measured)** — full 2015+ context (4,299
  rows) is infeasible on this CPU: TabPFN inference grows ~quadratically
  (n=4300 → 232 s per context pass, n=1000 → 14 s, measured). Plan's risk table
  authorized context restriction. Final: **CONTEXT_ROWS=500** most-recent training
  rows + target/calibration batched into one predict call (each call re-processes
  the context). ~7.5 s/fit observed in the real run; full 28-day river backtest ≈
  28 fits ≈ 3.5 min.
- Service committed `cc08956` (16 files): app.py (auth + 3 endpoints, error shape
  per API.md §0), schemas.py, features.py (doy sin/cos, lags 1-7, rolling 7/28d,
  weather 3/7/14d+7d), model.py (log1p, empirical residual quantiles, calibration
  tail 60), metrics.py, registry.py, pytest suite 31 cases.
- **Backtest is leak-free walk-forward** (module docstring): hidden window scored
  in 7-day chunks, each chunk's FeatureBuilder truncated at its own origin.
  Contract's 28-day hidden_window example implies this; noted in API.md §1.2.
- Orchestrators committed `85c5c61`: scripts/lib/weather.mjs (archive adapter,
  ERA5 5-day lag clamp, .cache/), scripts/lib/db.mjs (observed read +
  transactional prediction-run insert, jsonb_to_recordset pattern),
  scripts/backtest.mjs / predict.mjs; `npm run backtest` / `npm run predict`.
  Hole guard: hidden window must be exactly daily or the script fails loudly.
- Retro read path committed `c8726a3`: `insertPredictions` + `getLatestBacktest`
  in src/lib/db.ts (readings join = P2 truth; covered derived), `GET
  /api/v1/retro` route (API.md §2.4, §0 error shape), MetricRow + RetroBandChart
  components, `/retro` page live (blocking-dynamic `instant=false`), SAMPLE shell
  removed. eslint ignores predict venv.
- Docs: API.md §1 additive `weather_series` note + `trained_through` in backtest
  response; TESTING.md §3 real commands; ARCH §7 + PREDICT_URL; RUNBOOK §2.3
  rewritten with observed failure modes (tabpfn license gate, context-cap
  runtime, ERA5 clamp, hole guard). README status row updated.
- Archive fixture recorded: `tests/fixtures/archive/archive-indus-14d-20261009.json`
  (+ .meta.json) — 14-day trimmed tail of the real Indus cell pull.
- Fixed during development: `predict_band` off-by-one (start_date is the first
  target day, not the origin); backtest chunk `n_days` for short final chunks;
  FakeRegressor spread test replaced by pure `band_from()` unit tests.

### Run results + remaining work (same day)

- **Real backtest stored for all 4 rivers** (hidden 2026-09-11→2026-10-08):
  coverage 0.964 / 0.821 / 0.964 / 0.893, MAE 113.4 / 3.6 / 3.2 / 0.14 — all
  above the 0.70 gate; published with caveats in `docs/retro-metrics.md`
  (commit `65ea9f6`).
- **Live forecast rows seeded** (kind='forecast', 7 days × 4 rivers) — proves
  the pipe; weekly cadence stays Phase 7's job (P4-9).
- Known deviation from plan worth noting: `npm run backtest -- --river <id>`
  does NOT narrow the run — package.json's `backtest` script already ends with
  `--all`, and appended flags come after it. River-scoped runs need
  `node --env-file=.env scripts/backtest.mjs --river <id>` directly (documented
  in the script header). The accidental full run was kept: it is exactly the
  published result.
- Exit criteria status: retrodiction page live with real predicted-vs-actual
  for 4 rivers ✓ · metrics published ✓ · service reproducible via documented
  commands ✓ · contract + integration tests green ✓ · `npm run verify` green ✓.
- Out of scope, unchanged: Temporal scheduling (7), river-page band UI (not in
  UX_SPEC §4.2), SerpApi (5), Gemma (6), Render deploy of the service (9).
