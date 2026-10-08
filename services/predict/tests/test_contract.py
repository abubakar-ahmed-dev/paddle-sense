"""Contract tests — docs/API.md §1 shapes and error paths (fixtures only)."""

from datetime import date, timedelta

from conftest import START, series
from fastapi.testclient import TestClient

import app as app_module
from app import app

DAY = timedelta(days=1)


def client() -> TestClient:
    return TestClient(app)


def history_payload(dates, q):
    return [{"date": d.isoformat(), "discharge": v} for d, v in zip(dates, q)]


def test_health_ok():
    r = client().get("/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["loaded"] is True
    assert body["model_version"].startswith("tabpfn-v1-r")


def test_predict_requires_token():
    dates, q = series(150)
    r = client().post(
        "/v1/predict",
        json={"river_id": "indus-besham", "history": history_payload(dates, q),
              "start_date": (dates[-1] + DAY).isoformat()},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "unauthorized"


def test_predict_rejects_wrong_token():
    dates, q = series(150)
    r = client().post(
        "/v1/predict",
        headers={"X-Internal-Token": "nope"},
        json={"river_id": "indus-besham", "history": history_payload(dates, q),
              "start_date": (dates[-1] + DAY).isoformat()},
    )
    assert r.status_code == 403


def test_predict_unknown_river_422():
    dates, q = series(150)
    r = client().post(
        "/v1/predict",
        headers={"X-Internal-Token": "test-token"},
        json={"river_id": "indus-skardu", "history": history_payload(dates, q),
              "start_date": (dates[-1] + DAY).isoformat()},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "unknown_river"


def test_predict_rejects_gapped_history():
    dates, q = series(150)
    payload = history_payload(dates, q)
    del payload[100]  # one missing day
    r = client().post(
        "/v1/predict",
        headers={"X-Internal-Token": "test-token"},
        json={"river_id": "indus-besham", "history": payload,
              "start_date": (dates[-1] + DAY).isoformat()},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_history"


def test_predict_rejects_unsorted_history():
    dates, q = series(150)
    payload = history_payload(dates, q)
    payload[10], payload[11] = payload[11], payload[10]
    r = client().post(
        "/v1/predict",
        headers={"X-Internal-Token": "test-token"},
        json={"river_id": "indus-besham", "history": payload,
              "start_date": (dates[-1] + DAY).isoformat()},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_history"


def test_predict_success_shape():
    dates, q = series(150)
    r = client().post(
        "/v1/predict",
        headers={"X-Internal-Token": "test-token"},
        json={"river_id": "indus-besham", "history": history_payload(dates, q),
              "start_date": (dates[-1] + DAY).isoformat()},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["river_id"] == "indus-besham"
    assert body["model_version"].startswith("tabpfn-v1-r")
    assert body["trained_through"] == dates[-1].isoformat()
    assert len(body["days"]) == 7
    first = body["days"][0]
    assert first["date"] == (dates[-1] + DAY).isoformat()
    assert 0 <= first["band_lo"] <= first["band_high"]


def test_backtest_success_and_metrics():
    hist_dates, hist_q = series(120)
    truth_dates, truth_q = series(12, start=hist_dates[-1] + DAY)
    r = client().post(
        "/v1/backtest",
        headers={"X-Internal-Token": "test-token"},
        json={
            "river_id": "kunhar-balakot",
            "history": history_payload(hist_dates, hist_q),
            "hidden_window": {"from": truth_dates[0].isoformat(),
                              "to": truth_dates[-1].isoformat()},
            "truth": history_payload(truth_dates, truth_q),
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["river_id"] == "kunhar-balakot"
    assert body["trained_through"] == hist_dates[-1].isoformat()
    assert len(body["days"]) == 12
    for d, td, tq in zip(body["days"], truth_dates, truth_q):
        assert d["date"] == td.isoformat()
        assert d["actual"] == tq
        assert d["covered"] == (d["band_lo"] <= d["actual"] <= d["band_high"])
    m = body["metrics"]
    assert m["days"] == 12
    assert 0.0 <= m["band_coverage"] <= 1.0
    assert m["mae"] >= 0.0
    # coverage fraction consistent with the days array
    covered = sum(1 for d in body["days"] if d["covered"])
    assert abs(m["band_coverage"] - covered / 12) < 1e-9


def test_backtest_rejects_window_overlapping_history():
    hist_dates, hist_q = series(120)
    r = client().post(
        "/v1/backtest",
        headers={"X-Internal-Token": "test-token"},
        json={
            "river_id": "kunhar-balakot",
            "history": history_payload(hist_dates, hist_q),
            "hidden_window": {"from": hist_dates[100].isoformat(),
                              "to": hist_dates[110].isoformat()},
            "truth": history_payload(hist_dates[100:111], hist_q[100:111]),
        },
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_history"


def test_backtest_rejects_incomplete_truth():
    hist_dates, hist_q = series(120)
    truth_dates, truth_q = series(10, start=hist_dates[-1] + DAY)
    r = client().post(
        "/v1/backtest",
        headers={"X-Internal-Token": "test-token"},
        json={
            "river_id": "kunhar-balakot",
            "history": history_payload(hist_dates, hist_q),
            "hidden_window": {"from": truth_dates[0].isoformat(),
                              "to": truth_dates[-1].isoformat()},
            "truth": history_payload(truth_dates[:-2], truth_q[:-2]),
        },
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_history"


def test_service_misconfigured_without_token(monkeypatch):
    monkeypatch.setattr(app_module, "TOKEN", "")
    dates, q = series(150)
    r = client().post(
        "/v1/predict",
        headers={"X-Internal-Token": "test-token"},
        json={"river_id": "indus-besham", "history": history_payload(dates, q),
              "start_date": (dates[-1] + DAY).isoformat()},
    )
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "service_misconfigured"
