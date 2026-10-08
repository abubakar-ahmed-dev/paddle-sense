"""Unit: band construction math (pure) + BandModel shape via fake regressor."""

import math
from datetime import date, timedelta

from features import FeatureBuilder
from model import BandModel, band_from

DAY = timedelta(days=1)
START = date(2026, 1, 1)


def test_band_from_is_symmetric_in_log_space():
    lo, mid, hi = band_from(pred_log=math.log1p(1500.0), spread=0.2)
    assert lo <= mid <= hi
    assert math.isclose(math.log1p(mid) - math.log1p(lo), 0.2, rel_tol=1e-9)
    assert math.isclose(math.log1p(hi) - math.log1p(mid), 0.2, rel_tol=1e-9)


def test_band_from_never_negative_lo():
    lo, _mid, hi = band_from(pred_log=math.log1p(0.05), spread=5.0)
    assert lo == 0.0
    assert hi > 0.0


def test_band_from_handles_malir_scale():
    # near-zero rivers stay positive and proportional
    lo, mid, hi = band_from(pred_log=math.log1p(0.1), spread=0.1)
    assert 0.0 <= lo < mid < hi
    assert mid < 1.0


class FakeRegressor:
    """Constant log-space offset predictor — enough for shape assertions."""

    offset = 0.05

    def __init__(self, n_estimators=1):
        pass

    def fit(self, X, y):
        self.mean = float(np_mean(y))

    def predict(self, X, output_type="median"):
        import numpy as np

        return np.full(len(X), self.mean + self.offset)


def np_mean(y):
    import numpy as np

    return float(np.mean(y))


def make_model(n=200):
    dates = [START + i * DAY for i in range(n)]
    q = [100.0 + (i % 37) * 3.0 for i in range(n)]
    fb = FeatureBuilder(dates, q, None)
    m = BandModel(fb, origin_idx=n - 1)
    m._regressor_cls = FakeRegressor
    return m


def test_band_has_seven_days_ordered_and_positive():
    m = make_model()
    targets, lo, hi, mid = m.predict_band(START + timedelta(days=200))
    assert len(targets) == 7 and len(lo) == 7 and len(hi) == 7
    # start_date is the first target day
    assert targets[0] == START + timedelta(days=200)
    assert targets[-1] == START + timedelta(days=206)
    assert all(0.0 <= l <= h for l, h in zip(lo, hi))
    assert all(l <= md <= h for l, md, h in zip(lo, mid, hi))


def test_short_history_raises():
    m = make_model(n=95)  # too few rows to calibrate
    try:
        m.predict_band(START + timedelta(days=95))
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_partial_horizon_chunk():
    m = make_model()
    targets, lo, hi, mid = m.predict_band(START + timedelta(days=200), n_days=3)
    assert len(targets) == 3
