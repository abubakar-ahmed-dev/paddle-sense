# Phase 4 — Testing Log

Actual commands and results. Updated whenever phase files change or validation runs.

## 2026-10-09

- Environment check: `python --version` → `Python 3.13.7` ✅ (prerequisite per
  needs-and-requirements.md). No service code exists yet; pytest suite not started.

### Service suite

- `pip install` (tabpfn 9.1.0 → downgrade `tabpfn==2.0.9` after license-gate
  failure) — all wheels resolved on 3.13. TabPFN smoke: fit+predict ok, 60.2 s
  including one-time weight download.
- Context benchmark (`TabPFNRegressor(n_estimators=1)`, 11 features, CPU):
  n=1000 fit 0.3 s / predict 14.1 s · n=2200 predict 62.7 s · n=4300 predict
  232.1 s → CONTEXT_ROWS=500 + single batched predict call per fit.
- `pytest -q` (services/predict): **31 passed** (~36 s) after fixes; re-run of
  band+contract subset after CONTEXT_ROWS change: **17 passed** (~50 s).

### Real runs

- Service `uvicorn app:app --port 8000`: `/v1/health` →
  `{"status":"ok","model_version":"tabpfn-v1-r2026-10-09","loaded":true}`.
- First backtest attempt with 1,000-row context aborted — ~105 s/fit in the
  real pipeline (target + calibration made two full-context passes). Fix:
  CONTEXT_ROWS=500 + single batched predict call → ~7.5 s/fit. Committed as
  `perf(predict)`.
- `npm run backtest` (all 4 rivers, hidden 2026-09-11→2026-10-08), stored
  28 kind='backtest' rows each:
  - indus-besham coverage **0.964**, mae **113.4**
  - kunhar-balakot coverage **0.821**, mae **3.6**
  - swat-mingora coverage **0.964**, mae **3.2**
  - malir-karachi coverage **0.893**, mae **0.14**
  All ≥ 0.70 → no "experimental" chip on /retro. Published with caveats in
  `docs/retro-metrics.md`.
- `npm run predict` (all 4 rivers): 7 kind='forecast' rows each stored;
  Indus day-1 band 1,422–1,616 m³/s (plausible autumn recession from ~1,632),
  Malir 0.1–0.1 (dry ✓).
- `node --env-file=.env scripts/check-predictions.mjs` — 8 runs listed
  (4 backtest + 4 forecast) ✓

### Web app

- `npm run lint` ✅ (after eslint ignores for `services/predict/.venv`)
- `npx tsc --noEmit` ✅
- `npm run build` ✅ — `/retro` PPR, `/api/v1/retro` dynamic.
- Smoke (dev server): `/retro` → 200, renders all 4 rivers with real coverage
  numbers (96.4 / 82.1 / 96.4 / 89.3), no SAMPLE banner, "N/28 days inside the
  band" per river; `/api/v1/retro?river_id=indus-besham` → 200 with metrics +
  28 days; unknown river → 404 `river_not_found`. Dev server stopped by scoped
  PID kill (blanket node.exe kill avoided).

### Integration (Docker)

- `npm run test:db`: **12 passed / 12** (2 files) after fixing a wrong test
  expectation in the P2 case (04-03 belonged to the previous run — runs are
  served whole; expected array corrected, code was right).

### Final gate

- `npm run verify` (lint + typecheck + unit + build): **green** —
  19 unit tests passed / 12 integration skipped (no DATABASE_TEST_URL in
  verify env), build ✓.
- `npm run test:db`: 12/12 green.
- pytest (services/predict): 31/31 green (17 re-verified after context change).
