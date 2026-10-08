"""Backtest scoring — MAE (m³/s) and band coverage. Pure functions."""

from __future__ import annotations


def mae(band_median_or_point: list[float], actual: list[float]) -> float:
    """Mean absolute error in m³/s. Here scored band-midpoint vs actual —
    the band midpoint is the model's best single guess (median)."""
    if not band_median_or_point or len(band_median_or_point) != len(actual):
        raise ValueError("mae: length mismatch")
    errs = [abs(p - a) for p, a in zip(band_median_or_point, actual)]
    return sum(errs) / len(errs)


def band_coverage(days: list[dict]) -> float:
    """Fraction of days whose actual fell inside [band_lo, band_high]."""
    if not days:
        raise ValueError("band_coverage: no days")
    covered = sum(
        1
        for d in days
        if d["band_lo"] <= d["actual"] <= d["band_high"]
    )
    return covered / len(days)
