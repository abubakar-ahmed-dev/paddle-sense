# Phase 3 — Persistence layer (Tiger Data) — Phase Plan

Branch: `phase/3-data` (from `dev`) · Master plan ref: Phase 3 · Written: 2026-10-08

## Context check (repo state at re-planning)

- Phase 2 merged (PR #1): theme, component kit, `/river/[id]`, `/retro`, `/about`, `computeStatus()` + tests; `npm run verify` green
- No database anywhere: dashboard live-fetches Flood API per request; no `lib/db.ts`, no `db/` folder, no migrations
- Owner need: **`DATABASE_URL` (Tiger Data free plan)** — `needs-and-requirements.md` Phase 3; **implementation pauses until provided**
- Constraint reminder: no Docker, no local Postgres, no local model — integration tests run against the Tiger instance (test schema, cleaned up), not a local container

## Decisions (proposed, standing unless changed)

| # | Decision | Rationale |
|---|---|---|
| P3-1 | Driver: `postgres` (postgres.js) | Light, TS-native, tagged-template queries resist injection; `pg` rejected (callbacks/valibot boilerplate for no gain at this scale) |
| P3-2 | Migrations: plain SQL files + ~40-line runner | DEPLOYMENT.md §4 contract; no migration framework needed for 1 table-set |
| P3-3 | Integration tests against `DATABASE_URL` when set, else skipped | No Docker available; Tiger free plan is the only Postgres. Tests use a `ps_test` schema and drop it afterwards |
| P3-4 | pgvector: create extension + columns now, defer embedding backfill | Embeddings need an embedding model — local is impossible (constraint); hosted embeddings are a Phase 5/6 decision. Keyword search carries Phase 5 alone if needed |
| P3-5 | Dashboard becomes DB-first with live-fallback | Reads DB; if newest observed reading is > 3 days old (or DB errors), falls back to live Flood API for display — staleness never shown silently (date always rendered) |

## Tasks

1. **Setup** — `npm i postgres`; `.env` gets `DATABASE_URL` (owner); `db/migrations/` + `scripts/migrate.mjs` runner (`npm run db:migrate`), `_migrations` ledger table
2. **Schema `001_init.sql`** — per DATA_DICTIONARY §2–7: `rivers`, `readings` (PK river_id,date,kind; CHECK discharge >= 0), `sources`, `predictions`, `summaries`, `notes` (+ pgvector extension, `vector(384)` column, HNSW index). No ORM; raw SQL, hand-reviewed
3. **River seed** — `npm run db:seed`: idempotent upsert of `RIVERS` config into `rivers` (incl. `range_state`, honesty notes); invariant R3 check (exactly one not_a_paddling_river)
4. **Data access layer** — `src/lib/db.ts` (server-only): `listRivers()`, `getRiver(id)`, `upsertReadings(rows)`, `getReadings(riverId, from, to, kind)`, `newestObserved(riverId)`. Typed rows mapped from snake_case; parameterized queries only
5. **Backfill** — `npm run backfill -- --river <id> --from <date> [--to <date>]`: chunked Flood API history → observed rows. Default run: 2015-01-01 → today for all 4 rivers (~16k rows total; 1984+ full-history deferred until needed by Phase 4 features)
6. **Dashboard DB-first** — home + river detail read `getReadings`/`newestObserved`; stale (>3 days) or error → live `fetchDischarge` fallback for display (UI always shows the asOf date either way)
7. **Tests** — `tests/integration/db.test.ts` against `DATABASE_URL` with `ps_test` schema: upsert idempotency (double-insert = 1 row), invariant T1 (forecast ⇔ forecast_created_for), range queries, river seed R3; **validation fixture**: Indus 2022-07-02 observed ≈ 12,022 m³/s (±0.5%) after backfill
8. **Docs** — API.md stays as-is (routes unchanged); DATA_DICTIONARY gets a "implemented in Phase 3" note only if drift appears; README status table row "Persistence (Tiger Data) → working" at merge

## Test list (gate)

- Invariant tests (T1, R3, upsert idempotency, PK behavior) against real Postgres
- Backfill verification: row counts match day ranges; Indus 2022-07-02 fixture within ±0.5%
- Dashboard renders identical numbers with DB live vs API fallback (spot check vs current values)
- `npm run verify` green

## Acceptance (exit criteria)

All 4 rivers' history persisted (2015→today); dashboard DB-first with graceful fallback; migration + seed + backfill scripts documented and re-runnable; `npm run verify` green; logs current. **Blocked on: `DATABASE_URL`.**

## Out of scope (later)

Embedding backfill (P3-4 deferral) · weekly automated sync (Phase 7 worker) · `summaries`/`predictions`/`notes` population (Phases 4–6)
