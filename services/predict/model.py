"""TabPFN band model — direct per-horizon fits (P4-3, P4-4).

Each horizon h ∈ 1..7 gets its own TabPFN regressor over log1p discharge.
Bands are empirical residual quantiles: the newest CALIBRATION_ROWS context
rows are held out, the model's absolute log-space residuals on them are
collected, and the band is the median prediction ± the (1+coverage)/2
quantile of those residuals — ARCH §3.4 / API.md §1.1 "empirical-residual
quantiles targeting ~70–80% coverage by construction".

Context is capped at CONTEXT_ROWS most-recent training rows: TabPFN
inference cost grows ~quadratically with context size and the owner's
laptop is CPU-only (measured 2026-10-09: n=4300 → ~232 s, n=1000 → ~14 s
per context pass). 500 rows keeps a full 28-day walk-forward river run in
the ~2-minute range; recency-weighted, documented — not silent tuning.
The target row and the calibration batch share ONE predict call — each
call re-processes the whole context.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np

CONTEXT_ROWS = 500
CALIBRATION_ROWS = 60
COVERAGE_TARGET = 0.75
HORIZONS = 7


def band_from(pred_log: float, spread: float) -> tuple[float, float, float]:
    """(band_lo, median, band_high) in m³/s from a log-space point + spread.

    Pure so the math is unit-testable without loading TabPFN.
    """
    mid = math.expm1(pred_log)
    return max(0.0, math.expm1(pred_log - spread)), mid, math.expm1(pred_log + spread)


class BandModel:
    """One river's direct per-horizon band model."""

    def __init__(self, builder, origin_idx: int) -> None:
        self.builder = builder
        self.origin_idx = origin_idx
        self._regressor_cls = None  # set lazily; tests inject fakes

    def predict_band(
        self,
        start_date: date,
        coverage_target: float = COVERAGE_TARGET,
        n_days: int = HORIZONS,
    ) -> tuple[list[date], list[float], list[float], list[float]]:
        """Returns (target_dates, band_lo, band_high, median_m3s).

        start_date is the first *target* day (origin = its predecessor).
        """
        targets = [start_date + timedelta(days=h) for h in range(n_days)]
        band_lo: list[float] = []
        band_high: list[float] = []
        medians: list[float] = []

        # Per-horizon residuals share one calibration pass per horizon.
        q = (1.0 + coverage_target) / 2.0

        for h in range(n_days):
            # training horizon is 1-based (days ahead of the origin)
            X, y = self.builder.training_rows(h + 1, CONTEXT_ROWS + CALIBRATION_ROWS)
            if len(X) <= CALIBRATION_ROWS + 10:
                raise ValueError("not enough history to calibrate bands")
            X_fit, y_fit = X[:-CALIBRATION_ROWS], y[:-CALIBRATION_ROWS]
            X_cal, y_cal = X[-CALIBRATION_ROWS:], y[-CALIBRATION_ROWS:]

            if self._regressor_cls is None:
                from tabpfn import TabPFNRegressor

                self._regressor_cls = TabPFNRegressor
            model = self._regressor_cls(n_estimators=1)
            model.fit(np.asarray(X_fit), np.asarray(y_fit))

            target_doy = _doy(targets[h])

            # one predict call for target + calibration: each call
            # re-processes the full context on CPU
            x_test = np.asarray([self.builder.origin_row(self.origin_idx, target_doy)])
            joint = model.predict(np.vstack([x_test, np.asarray(X_cal)]), output_type="median")
            pred_log = float(joint[0])
            residuals = np.abs(joint[1:] - np.asarray(y_cal))
            spread = float(np.quantile(residuals, q))

            lo, mid, hi = band_from(pred_log, spread)
            band_lo.append(lo)
            band_high.append(hi)
            medians.append(mid)

        return targets, band_lo, band_high, medians


def _doy(d: date) -> tuple[float, float]:
    angle = 2 * math.pi * (d.timetuple().tm_yday - 1) / 365.0
    return math.sin(angle), math.cos(angle)
