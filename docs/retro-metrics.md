# Retrodiction metrics — published results

| | |
|---|---|
| Purpose | The honest scoreboard (TESTING.md §6 Phase 4 gate): what the predictor actually did on hidden data |
| Run | `npm run backtest` (all 4 rivers) — 2026-10-09, model `tabpfn-v1-r2026-10-09` |
| Protocol | Hide the most recent 28 days of stored GloFAS readings per river; predict them from earlier history only (leak-free walk-forward in 7-day chunks); score band coverage + MAE |

## Results (hidden window 2026-09-11 → 2026-10-08)

| River | Band coverage | MAE (m³/s) | Days | Verdict |
|---|---|---|---|---|
| Indus @ Besham | **96.4%** | 113.4 | 28 | pass (target ≥ 70%) |
| Kunhar @ Balakot | **82.1%** | 3.6 | 28 | pass |
| Swat @ Mingora | **96.4%** | 3.2 | 28 | pass |
| Malir @ Karachi | **89.3%** | 0.14 | 28 | pass (honesty-check river) |

All four clear the ≥ 0.70 coverage threshold, so nothing on `/retro` carries
the "experimental" chip today. Bands were built to target 75% coverage;
landing at 82–96% means they are **wider than needed** — conservative, not
wrong, and the /retro charts show the spread directly.

## Honest caveats (read before quoting these numbers)

1. **Season**: the hidden window is autumn low-flow — the easiest part of
   the hydrograph. Monsoon windows (Jul–Sep) will be harder; we will republish
   these tables as the watcher accumulates cycles rather than claim monsoon skill.
2. **Context**: the model trains on the 500 most recent days per fit (TabPFN
   inference cost grows ~quadratically; measured on the builder's CPU, see
   `services/predict/model.py`). Recency weighting favors recent regime — good
   for autumn, unproven across regime shifts.
3. **Truth is GloFAS, not gauges**: these scores measure prediction against
   the same grid-cell model that feeds the dashboard. They prove internal
   consistency and learning, not gauge-grade accuracy.
4. **Malir's MAE (0.14 m³/s)** looks tiny because the river reads near-zero —
   relative error matters more there; see the /retro chart.
5. **One window, one seed of time.** Coverage on 28 hidden days is evidence,
   not proof. The weekly watcher (Phase 7) is what turns this into a track record.

## Reproduce

```bash
# terminal 1 — service (see services/predict/README.md for setup)
cd services/predict && set -a && . ../../.env && set +a \
  && .venv/Scripts/python -m uvicorn app:app --port 8000

# terminal 2 — backtest all rivers (~15 min on CPU)
npm run backtest

# inspect stored runs
node --env-file=.env scripts/check-predictions.mjs
```

Runtime notes: ~3.5 min per river (28 TabPFN fits at ~7.5 s each, CPU-only,
context 500 + 60 calibration rows). Weather features from the Open-Meteo
Archive API are cached under `.cache/` after the first pull.
