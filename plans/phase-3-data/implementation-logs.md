# Phase 3 — Implementation Logs

Format: reverse-chronological entries. Updated whenever phase files change.

## 2026-10-08 — phase start

- Created branch `phase/3-data` from `dev` (after Phase 2 merge, PR #1).
- Wrote `plan.md`; decisions P3-1…P3-5 proposed and discussed with owner.
- **Owner update: Docker IS available** → P3-3 revised: integration tests run
  against an ephemeral Docker Postgres (isolated, no Tiger usage in tests).
- Owner provided `DATABASE_URL` in `.env` (never committed).

## 2026-10-08 — implementation

### Setup
- `npm i postgres` (postgres.js 3.4.9) — decision P3-1.
- Connection verified against Tiger: PostgreSQL 18.6.

### Migrations + seed
- `db/migrations/001_init.sql`: all 6 tables per DATA_DICTIONARY, invariants as
  CHECK constraints (R1, S1, T1, P1), pgvector extension + `notes.embedding`
  vector(384) + HNSW index (columns live, embeddings deferred — P3-4).
- `scripts/migrate.mjs`: ordered, transactional, `_migrations` ledger.
- `scripts/rivers.json` + `scripts/seed-rivers.mjs`: idempotent river seed;
  parity with `src/lib/rivers.ts` enforced by unit test.
- Applied to Tiger: `001_init.sql` applied, 4 rivers seeded.

### Data access + series
- `src/lib/db.ts`: lazy connection (never at import — build-safe), typed
  `listRivers/getRiver/newestObservedDate/getReadings/upsertReadings`
  (jsonb_to_recordset bulk upsert).
- `src/lib/series.ts`: `getDashboardSeries` / `getRiverHistory` — DB-first with
  3-day freshness window, live Flood API fallback (P3-5), honest source labels.

### Backfill
- `scripts/backfill.mjs` + `scripts/lib/flood.mjs` (node-side mirror of the
  TS adapter). 4 rivers × 2015-01-01 → today: **4,299 rows each, 17,196 total,
  0 null days**.
- Fixture check: Indus 2022-07-02 = 12,021.64 m³/s vs validation-record 12,022
  — deviation 0.007%, PASS (±0.5% gate).

### Dashboard DB-first
- `page.tsx` + `river/[id]/page.tsx` now read via `lib/series.ts`; provenance
  footers show the real source: "GloFAS via Tiger Data (stored, through …)" or
  "(live)" fallback. Smoke-tested both paths' labels.

### Debugging notes (recorded per TESTING.md §5)
1. `ERESOLVE` on vitest@5 → pinned vitest@^3 (compatible plugin line).
2. Backfill 400s: root cause was the `.mjs` flood mirror **missing the
   `/v1/flood` path** — requests hit the domain root (S3 "list-type" error).
   The "range caps" diagnosed mid-way were fiction. Fixed path; API serves an
   11-year single call fine. Retry/backoff kept (transient throttling is real).
3. postgres.js bulk insert: `${JSON.stringify(x)}::jsonb` fails ("non-array");
   correct API is `${sql.json(x)}`; `jsonb_to_recordset` alias gives *named*
   columns (use `r.col`, not `r->>'col'`); date columns need explicit `::date`.
4. `postgres:17-alpine` image layers corrupted locally (busybox "Bad message",
   entrypoint missing) even after forced re-pull → switched to
   `pgvector/pgvector:pg17` (debian + pgvector preinstalled), which also fixed
   `extension "vector" is not available`.
5. WSL2 localhost port-forward lag after container start → orchestrator now
   polls the host TCP port before running tests.

## Remaining issues
- Embeddings unfilled by design (P3-4 deferral; hosted-model decision in Phase 5/6).
- DB freshness depends on manual `npm run sync` until the Phase 7 worker.
- Unit suite skips integration without `DATABASE_TEST_URL` (by design).
