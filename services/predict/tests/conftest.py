"""Shared fixtures: a synthetic seasonal river + the test token.

No network, no real rivers — the hydrograph is a sine + weekly wiggle,
which is enough to exercise shapes, math, and the contract.
"""

import math
import os
import sys
from datetime import date, timedelta

os.environ.setdefault("X_INTERNAL_TOKEN", "test-token")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

DAY = timedelta(days=1)
START = date(2026, 1, 1)


def hydrograph(n: int) -> list[float]:
    """Synthetic discharge: slow seasonal cycle + weekly wiggle, all > 0."""
    return [
        round(max(5.0, 500 + 300 * math.sin(2 * math.pi * i / 120) + 40 * math.cos(2 * math.pi * (i % 7) / 7)), 2)
        for i in range(n)
    ]


def series(n: int, start: date = START) -> tuple[list[date], list[float]]:
    return [start + i * DAY for i in range(n)], hydrograph(n)


@pytest.fixture()
def history_150():
    return series(150)


@pytest.fixture()
def token_header():
    return {"X-Internal-Token": "test-token"}
