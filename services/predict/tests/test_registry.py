"""Registry parity: the service's accepted rivers mirror the DB seed."""

import json
import os

from registry import RIVER_IDS


def test_registry_matches_seed_config():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    with open(os.path.join(root, "scripts", "rivers.json"), encoding="utf-8") as f:
        seeded = json.load(f)
    assert RIVER_IDS == {r["id"] for r in seeded}
