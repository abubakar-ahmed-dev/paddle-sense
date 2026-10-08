"""Unit: metric math against hand-computed values."""

import pytest

from metrics import band_coverage, mae


def test_mae_hand_computed():
    assert mae([100.0, 200.0], [110.0, 180.0]) == 15.0
    assert mae([5.0], [5.0]) == 0.0


def test_mae_length_mismatch_raises():
    with pytest.raises(ValueError):
        mae([1.0, 2.0], [1.0])


def test_coverage_counts_inside_band_only():
    days = [
        {"band_lo": 10, "band_high": 20, "actual": 15},  # in
        {"band_lo": 10, "band_high": 20, "actual": 20},  # edge counts as in
        {"band_lo": 10, "band_high": 20, "actual": 10},  # edge counts as in
        {"band_lo": 10, "band_high": 20, "actual": 21},  # miss
    ]
    assert band_coverage(days) == 0.75


def test_coverage_empty_raises():
    with pytest.raises(ValueError):
        band_coverage([])
