# PaddleSense predict service

FastAPI + TabPFN (Python, CPU-only). Stateless: callers supply history,
weather, and truth — the service returns discharge **bands**, never points
(`docs/API.md` §1 is the contract).

## Setup (once)

```bash
cd services/predict
python -m venv .venv                      # Python 3.10+ verified on 3.13
.venv/Scripts/pip install -r requirements.txt        # Windows
# .venv/bin/pip install -r requirements.txt          # macOS/Linux
```

tabpfn is pinned to the 2.x line: 9.x gates weights behind a Prior Labs
account + browser license acceptance; 2.0.9 downloads public weights
headless. First model fit downloads ~100 MB of weights from HuggingFace
(one-time, cached under `~/.cache/huggingface` — offline machines fail
with an explicit download error).

## Run (dev)

```bash
# from services/predict, with X_INTERNAL_TOKEN set (repo root .env)
X_INTERNAL_TOKEN=... .venv/Scripts/python -m uvicorn app:app --port 8000
```

Orchestrators in the repo root call it via `PREDICT_URL` +
`X_INTERNAL_TOKEN` (`npm run backtest`, `npm run predict`).

## Layout

- `app.py` — endpoints, auth, validation (`/v1/predict`, `/v1/backtest`, `/v1/health`)
- `schemas.py` — pydantic mirrors of the API contract
- `features.py` — per-origin feature rows (doy sin/cos, lags 1–7, rolling means 7/28d, weather 3/7/14d rain + 7d temp)
- `model.py` — direct per-horizon TabPFN fits in log1p space; empirical residual-quantile bands (coverage target 0.75); context capped at 1,000 most-recent rows (CPU runtime, measured 2026-10-09)
- `metrics.py` — MAE + band coverage
- `registry.py` — accepted river ids (parity-tested against `scripts/rivers.json`)
- `tests/` — pytest contract + unit suite, fixtures only, no network

## Design notes (why it looks like this)

- **Direct per-horizon models** (one fit per horizon 1–7, no recursion):
  no compounding error; each day's band is its own estimate.
- **log1p space**: rivers span 0.1 (Malir) – 12,000 (Indus) m³/s; bands are
  multiplicative, which is what a hydrograph wants.
- **Leak-free walk-forward backtest**: hidden window scored in 7-day
  chunks, each chunk's context truncated at its own origin — matching how
  the weekly product would really have predicted.
