"""River registry — the ids this service accepts.

Mirrors scripts/rivers.json (parity asserted in tests/test_registry.py);
the service never invents a river.
"""

RIVER_IDS: frozenset[str] = frozenset(
    {
        "indus-besham",
        "kunhar-balakot",
        "swat-mingora",
        "malir-karachi",
    }
)
