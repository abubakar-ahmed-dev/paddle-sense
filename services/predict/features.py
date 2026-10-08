"""Feature engineering — pure functions over the request payload.

Per river-day *origin* t (the last observed day before the targets):
  - day-of-year sin/cos of the origin (targets share it; see model.py for
    how target-day doy is used instead)
  - discharge lags t-1..t-7, rolling means 7d/28d (all trailing, inclusive
    of t)
  - weather trailing windows at t (rain 3/7/14d sums, temp 7d mean) when a
    weather series was supplied

The same construction applies to every training row (origin = some
historical day) and to the single test origin (yesterday), so the model
never sees a feature distribution it was not trained on.

Model regresses log1p(discharge) (P4-4): the rivers span 0.1–12,000 m³/s.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

LAGS = 7
ROLL_WINDOWS = (7, 28)
RAIN_WINDOWS = (3, 7, 14)
MIN_HISTORY_DAYS = 60  # 28 for roll windows + margin for calibration


@dataclass(frozen=True)
class WeatherDay:
    date: date
    rain_mm: float
    temp_mean_c: float


def daily_dates(history_dates: list[date]) -> bool:
    """Strictly ascending and gap-free daily series."""
    return all(
        (b - a).days == 1 for a, b in zip(history_dates, history_dates[1:])
    )


def _doy_features(d: date) -> tuple[float, float]:
    angle = 2 * math.pi * (d.timetuple().tm_yday - 1) / 365.0
    return math.sin(angle), math.cos(angle)


class FeatureBuilder:
    """Builds origin rows from aligned history + optional weather."""

    def __init__(
        self,
        history_dates: list[date],
        history_discharge: list[float],
        weather: dict[date, WeatherDay] | None = None,
    ) -> None:
        self.dates = history_dates
        self.discharge = history_discharge
        self.weather = weather or {}
        self._by_date = dict(zip(history_dates, history_discharge))
        max_weather_window = max(RAIN_WINDOWS)
        self.min_origin_idx = max(
            LAGS, max(ROLL_WINDOWS) - 1, max_weather_window - 1
        )

    def origin_row(self, origin_idx: int, target_doy: tuple[float, float] | None = None) -> list[float]:
        """Feature vector for the origin at self.dates[origin_idx].

        target_doy overrides the doy features for a future target day
        (each target day of the week gets its own season signal while all
        lags stay anchored to the known origin).
        """
        t = self.dates[origin_idx]
        doy_sin, doy_cos = target_doy if target_doy else _doy_features(t)
        vals = [self._by_date[self.dates[origin_idx - k]] for k in range(1, LAGS + 1)]
        row = [doy_sin, doy_cos, *vals]
        for w in ROLL_WINDOWS:
            window = self.discharge[origin_idx - w + 1 : origin_idx + 1]
            row.append(sum(window) / w)
        row.extend(self._weather_features(origin_idx))
        return row

    def _weather_features(self, origin_idx: int) -> list[float]:
        if not self.weather:
            return []
        t = self.dates[origin_idx]
        rains, temps = [], []
        for w in RAIN_WINDOWS:
            window = [self.weather.get(t - timedelta(days=k)) for k in range(w)]
            known = [x for x in window if x is not None]
            rains.append(sum(x.rain_mm for x in known) / w if known else 0.0)
        t_window = [self.weather.get(t - timedelta(days=k)) for k in range(7)]
        known_t = [x for x in t_window if x is not None]
        temps.append(sum(x.temp_mean_c for x in known_t) / 7 if known_t else 0.0)
        return [*rains, *temps]

    def feature_dim(self) -> int:
        probe = 2 + LAGS + len(ROLL_WINDOWS)
        return probe + (len(RAIN_WINDOWS) + 1 if self.weather else 0)

    def training_rows(self, horizon: int, max_rows: int) -> tuple[list[list[float]], list[float]]:
        """(X, y) pairs: origin t predicts discharge at t + horizon (log1p).

        Rows are generated oldest→newest; the caller keeps the newest
        `max_rows` (recency-weighted context, P4 runtime decision).
        """
        xs: list[list[float]] = []
        ys: list[float] = []
        last = len(self.dates) - 1
        for i in range(self.min_origin_idx, last - horizon + 1):
            y = self.discharge[i + horizon]
            xs.append(self.origin_row(i))
            ys.append(math.log1p(y))
        if len(xs) > max_rows:
            xs, ys = xs[-max_rows:], ys[-max_rows:]
        return xs, ys

    def test_rows(self, origin_idx: int, target_dates: list[date]) -> list[list[float]]:
        """Feature rows for future target days: origin-anchored lags,
        target-day doy, weather held at the origin (future unknown)."""
        rows = []
        for d in target_dates:
            rows.append(self.origin_row(origin_idx, target_doy=_doy_features(d)))
        return rows
