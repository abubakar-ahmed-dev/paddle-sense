"""PaddleSense predict service — FastAPI + TabPFN (Phase 4).

Stateless and DB-free (P4-1): callers supply history, weather, and truth;
this service only turns them into bands and metrics. Auth is the shared
X-Internal-Token secret (docs/API.md §0); /v1/health is unauthenticated
(Render health check).

Backtest is a leak-free walk-forward (docs/API.md §1.2 "predict it from
earlier history only"): the hidden window is scored in 7-day chunks; each
chunk's features and training context are truncated at its own origin, so
no truth after an origin can influence that chunk's band — matching how
the weekly product would really have predicted.

Run:  .venv/Scripts/python -m uvicorn app:app --port 8000   (see README.md)
"""

from __future__ import annotations

import os
from datetime import date, timedelta

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from features import FeatureBuilder, WeatherDay
from metrics import band_coverage, mae
from model import CONTEXT_ROWS, COVERAGE_TARGET, HORIZONS, BandModel, _limit_torch_threads
from registry import RIVER_IDS
from schemas import (
    BacktestRequest,
    BacktestResponse,
    HealthResponse,
    PredictRequest,
    PredictResponse,
)

MODEL_VERSION = f"tabpfn-v1-r{date.today().isoformat()}"
TOKEN = os.environ.get("X_INTERNAL_TOKEN", "")

app = FastAPI(title="PaddleSense predict", version="v1")


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(status_code=status_code, detail={"code": code, "message": message})


@app.exception_handler(HTTPException)
async def error_shape(_request, exc: HTTPException):
    """docs/API.md §0: errors are {error: {code, message}}, codes are stable strings."""
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        body = {"error": exc.detail}
    else:
        body = {"error": {"code": "http_error", "message": str(exc.detail)}}
    return JSONResponse(status_code=exc.status_code, content=body)


def require_token(x_internal_token: str | None) -> None:
    if not TOKEN:
        raise ApiError(503, "service_misconfigured", "X_INTERNAL_TOKEN is not set")
    if x_internal_token != TOKEN:
        raise ApiError(403, "unauthorized", "missing or wrong X-Internal-Token header")


def check_river(river_id: str) -> None:
    if river_id not in RIVER_IDS:
        raise ApiError(422, "unknown_river", f"No river with id '{river_id}'")


def daily(dates: list[date]) -> bool:
    return all((b - a).days == 1 for a, b in zip(dates, dates[1:]))


def ascending(dates: list[date]) -> bool:
    return all(b > a for a, b in zip(dates, dates[1:]))


def aligned_history(req: PredictRequest | BacktestRequest) -> tuple[list[date], list[float]]:
    dates = [p.date for p in req.history]
    if not ascending(dates) or not daily(dates):
        raise ApiError(400, "invalid_history", "history dates must be strictly ascending and daily")
    return dates, [p.discharge for p in req.history]


def weather_map(req: PredictRequest | BacktestRequest) -> dict[date, WeatherDay] | None:
    if not req.weather_series:
        return None
    days = [WeatherDay(w.date, w.rain_mm, w.temp_mean_c) for w in req.weather_series]
    if not ascending([w.date for w in days]) or not daily([w.date for w in days]):
        raise ApiError(400, "invalid_history", "weather_series must be strictly ascending and daily")
    return {w.date: w for w in days}


def make_model(req, dates: list[date], discharge: list[float], origin_idx: int) -> BandModel:
    builder = FeatureBuilder(dates, discharge, weather_map(req))
    if len(dates) - 1 < builder.min_origin_idx + 10:
        raise ApiError(
            400,
            "invalid_history",
            f"need at least ~{builder.min_origin_idx + 10} days of history",
        )
    return BandModel(builder, origin_idx=origin_idx)


@app.get("/v1/health")
def health() -> HealthResponse:
    loaded = True
    torch_threads = None
    try:
        import tabpfn  # noqa: F401

        import torch

        _limit_torch_threads()
        torch_threads = torch.get_num_threads()
    except Exception:
        loaded = False
    return HealthResponse(
        status="ok" if (loaded and TOKEN) else "degraded",
        model_version=MODEL_VERSION,
        loaded=loaded,
        context_rows=CONTEXT_ROWS,
        torch_threads=torch_threads,
    )


@app.post("/v1/predict")
def predict(
    req: PredictRequest, x_internal_token: str | None = Header(default=None)
) -> PredictResponse:
    require_token(x_internal_token)
    check_river(req.river_id)
    dates, discharge = aligned_history(req)
    model = make_model(req, dates, discharge, origin_idx=len(dates) - 1)

    start = req.start_date if req.start_date > dates[-1] else dates[-1] + timedelta(days=1)
    targets, lo, hi, _mid = model.predict_band(start, COVERAGE_TARGET)
    return PredictResponse(
        river_id=req.river_id,
        model_version=MODEL_VERSION,
        days=[
            {"date": d, "band_lo": l, "band_high": h}
            for d, l, h in zip(targets, lo, hi)
        ],
        trained_through=dates[-1],
    )


@app.post("/v1/backtest")
def backtest(
    req: BacktestRequest, x_internal_token: str | None = Header(default=None)
) -> BacktestResponse:
    require_token(x_internal_token)
    check_river(req.river_id)
    dates, discharge = aligned_history(req)

    hidden_from, hidden_to = req.hidden_window.from_, req.hidden_window.to
    if hidden_from <= dates[-1]:
        raise ApiError(400, "invalid_history", "hidden_window must start after the history ends")
    if hidden_from > hidden_to:
        raise ApiError(400, "invalid_history", "hidden_window.from must be <= hidden_window.to")

    truth_dates = [t.date for t in req.truth]
    span = (hidden_to - hidden_from).days + 1
    expected = [hidden_from + timedelta(days=i) for i in range(span)]
    if truth_dates != expected:
        raise ApiError(400, "invalid_history", "truth must cover the hidden window exactly, daily")

    # Merged series: history + truth. Each chunk is scored with a builder
    # truncated at its own origin (see module docstring) — later chunks may
    # use earlier truth days as lags, exactly like real weekly re-prediction.
    all_dates = dates + truth_dates
    all_q = discharge + [t.discharge for t in req.truth]
    date_idx = {d: i for i, d in enumerate(all_dates)}

    days: list[dict] = []
    mids: list[float] = []
    chunk_start = hidden_from
    while chunk_start <= hidden_to:
        origin_idx = date_idx[chunk_start - timedelta(days=1)]
        chunk_to = min(chunk_start + timedelta(days=HORIZONS - 1), hidden_to)
        chunk_dates = [
            chunk_start + timedelta(days=i)
            for i in range((chunk_to - chunk_start).days + 1)
        ]
        builder = FeatureBuilder(all_dates[: origin_idx + 1], all_q[: origin_idx + 1],
                                 weather_map(req))
        model = BandModel(builder, origin_idx=origin_idx)
        n_days = (chunk_to - chunk_start).days + 1
        targets, lo, hi, mid = model.predict_band(chunk_start, COVERAGE_TARGET, n_days=n_days)
        truth_by_date = {t.date: t.discharge for t in req.truth}
        for d, l, h, m in zip(targets, lo, hi, mid):
            actual = truth_by_date.get(d)
            if actual is None:
                raise ApiError(400, "invalid_history", f"truth missing for {d.isoformat()}")
            days.append({"date": d, "band_lo": l, "band_high": h,
                         "actual": actual, "covered": l <= actual <= h})
            mids.append(m)
        chunk_start = chunk_to + timedelta(days=1)

    actuals = [d["actual"] for d in days]

    # Per-horizon split (Phase 7b, P75-6): forecast decay is honest only if
    # it is visible — day-1 is sharp, day-7 is a window. Horizon = position
    # within its own prediction chunk, so a multi-chunk backtest scores each
    # step against its own origin, exactly like the live predict path.
    base_date = date.fromisoformat(str(days[0]["date"]))
    horizons_cov: dict[int, list[bool]] = {}
    horizons_err: dict[int, list[float]] = {}
    for d, mid in zip(days, mids):
        h = (date.fromisoformat(str(d["date"])) - base_date).days + 1
        horizons_cov.setdefault(h, []).append(bool(d["covered"]))
        horizons_err.setdefault(h, []).append(abs(mid - d["actual"]))
    per_horizon: dict[str, float] = {}
    for h in sorted(horizons_cov):
        cov = horizons_cov[h]
        per_horizon[f"day{h}_coverage"] = round(sum(1 for x in cov if x) / len(cov), 3)
        per_horizon[f"day{h}_mae"] = round(sum(horizons_err[h]) / len(horizons_err[h]), 3)

    return BacktestResponse(
        river_id=req.river_id,
        model_version=MODEL_VERSION,
        days=days,
        metrics={
            "mae": mae(mids, actuals),
            "band_coverage": band_coverage(days),
            "days": len(days),
            **per_horizon,
        },
        trained_through=dates[-1],
    )
