"""Unit: feature builder — lag windows, rolling means, weather joins."""

import math
from datetime import date, timedelta

from features import FeatureBuilder, WeatherDay

DAY = timedelta(days=1)
START = date(2026, 3, 1)


def make(n: int, weather: bool = False):
    dates = [START + i * DAY for i in range(n)]
    q = [float(100 + i) for i in range(n)]
    w = None
    if weather:
        w = {d: WeatherDay(d, rain_mm=1.0 * i, temp_mean_c=10.0 + 0.1 * i) for i, d in enumerate(dates)}
    return FeatureBuilder(dates, q, w), dates, q


def test_daily_dates_rejects_gaps_and_unsorted():
    from features import daily_dates

    assert daily_dates([START, START + DAY, START + 2 * DAY])
    assert not daily_dates([START, START + 2 * DAY])
    assert not daily_dates([START + DAY, START])


def test_lags_are_trailing():
    fb, dates, q = make(40)
    row = fb.origin_row(10)
    # lags occupy positions 2..8 (after doy sin/cos): q[9], q[8], ..., q[3]
    assert row[2:9] == [q[9], q[8], q[7], q[6], q[5], q[4], q[3]]


def test_rolling_means():
    fb, dates, q = make(60)
    row = fb.origin_row(30)
    mean7 = sum(q[24:31]) / 7
    mean28 = sum(q[3:31]) / 28
    assert row[9] == mean7
    assert row[10] == mean28


def test_doy_features_are_bounded():
    fb, dates, q = make(40)
    row = fb.origin_row(30)
    assert -1.0 <= row[0] <= 1.0 and -1.0 <= row[1] <= 1.0
    assert math.isclose(row[0] ** 2 + row[1] ** 2, 1.0, rel_tol=1e-9)


def test_weather_features_join_per_day():
    fb, dates, q = make(60, weather=True)
    row = fb.origin_row(30)
    i = 30
    # rain windows average the known daily values; our fixture makes them linear
    rain3 = sum(1.0 * (i - k) for k in range(3)) / 3
    rain7 = sum(1.0 * (i - k) for k in range(7)) / 7
    rain14 = sum(1.0 * (i - k) for k in range(14)) / 14
    temp7 = sum(10.0 + 0.1 * (i - k) for k in range(7)) / 7
    assert row[11:15] == [rain3, rain7, rain14, temp7]


def test_feature_dim_changes_with_weather():
    fb_plain, _, _ = make(40)
    fb_weather, _, _ = make(40, weather=True)
    assert fb_plain.feature_dim() == 2 + 7 + 2
    assert fb_weather.feature_dim() == 2 + 7 + 2 + 4


def test_training_rows_use_log1p_targets():
    fb, dates, q = make(60)
    X, y = fb.training_rows(horizon=1, max_rows=1000)
    assert len(X) == len(y)
    assert all(v > 0 for v in y)
    # newest row targets the last available day
    assert math.isclose(y[-1], math.log1p(q[-1]), rel_tol=1e-12)


def test_training_rows_capped_to_most_recent():
    fb, dates, q = make(200)
    X, y = fb.training_rows(horizon=1, max_rows=50)
    assert len(X) == 50
    assert math.isclose(y[-1], math.log1p(q[-1]), rel_tol=1e-12)


def test_test_rows_differ_only_by_doy():
    fb, dates, q = make(40)
    rows = fb.test_rows(30, [dates[30] + DAY * k for k in range(1, 4)])
    assert len(rows) == 3
    assert rows[0][2:] == rows[1][2:] == rows[2][2:]  # same lags/rolls/weather
    assert rows[0][:2] != rows[1][:2]  # different doy
