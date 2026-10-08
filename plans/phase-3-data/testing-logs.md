# Phase 3 — Testing Logs

Format: reverse-chronological. Real commands and real results only.

## 2026-10-08 — backfill verification (against Tiger Data)

- `npm run backfill` → 4 rivers × 4,299 observed rows (2015-01-01 → 2026-10-08),
  0 null days, 17,196 total.
- Fixture check (node, SQL): `indus-besham / 2022-07-02 / observed = 12,021.64`
  vs validation record 12,022 → deviation 0.8 m³/s (0.007%) — **PASS (±0.5%)**.
- `SELECT river_id, count(*), max(date)` → all 4 rivers newest = 2026-10-08.

## 2026-10-08 — integration tests (Docker, `npm run test:db`)

- Debug iterations recorded in implementation-logs (image corruption →
  pgvector/pgvector:pg17; camelCase key mapping bug in upsert).
- Final run: **1 file, 6 tests, 6 passed** (~2.1 s) against ephemeral
  `pgvector/pgvector:pg17` on :54329:
  - seeded rivers = 4, R3 honesty check = exactly Malir ✓
  - upsert idempotency: double insert → 3 rows; conflict updates value ✓
  - T1: forecast without `forecast_created_for` rejected ✓
  - negative discharge rejected (CHECK) ✓
  - forecast/observed kinds stored and queried separately ✓
  - S1: range source without quote rejected ✓

## 2026-10-08 — unit tests + full gate

- `npm run test` → 3 files, **19 passed**, integration skipped (no
  DATABASE_TEST_URL) — status truth table 9, StatusBadge 7, seed parity 3.
- `npm run verify` (lint + test + build) → **green**. One typecheck failure
  during the phase (`sourceLabel` missing in map destructure) — fixed.

## 2026-10-08 — production smoke (port 3003)

- `GET /` → 200; all 4 provenance footers read **"Tiger Data (stored, through
  2026-10-08)"** — DB-first confirmed, no live API call in request path.
- `GET /river/kunhar-balakot?range=90d` → 200; provenance shows stored source;
  peak stat present.
