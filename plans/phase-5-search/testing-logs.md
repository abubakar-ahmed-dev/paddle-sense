# Phase 5 — Testing Log

Actual commands and results. Updated whenever phase files change or validation runs.

## 2026-10-09

- Phase planning only; no test runs yet. Baseline inherited from Phase 4
  merge: `npm run verify` green, Docker integration 12/12, pytest 31/31.

### During implementation

- `npm run lint` — clean (every pass).
- `npx vitest run tests/unit/scout.test.ts` — 19/19 (first pass), then
  **23/23** after the river-relevance gate (riverRelevant + token stoplist).
- `npm run test` — 38 passed / 19 integration skipped (no DB env): status 9,
  StatusBadge 7, scout 23 (first pass: scout 19), rivers-seed 3.
- `npm run test:db` (Docker throwaway Postgres):
  - first run: 2 failures — test fake queries didn't match the fake
    responder's keywords (test bug, not code bug); fixed test strings.
  - second run: **20/20** (db 6 + predictions 6 + scout 8, including budget
    hard-stop at 90, S1/S2, notes FK, cycle idempotency, real-fixture replay
    stores nothing, route 401 shape).
  - third run after gate + renamed fixtures: **20/20** again.
- `npm run build` — green; routes: /api/internal/scout ƒ, /river/[id] ◐,
  /retro ◐, /about ○.

### Live validation (real SerpApi, real Tiger Data)

- `npm run db:migrate` — `applied: 002_scout_ledger.sql`, 2 applied.
- `POST /api/internal/scout` ×3 (token auth): spend **9/90** total; third
  pass 9/9 cache hits, 0 spend, nothing stored twice.
- `npm run range-candidates` — 11 candidates printed, all US-river false
  positives → led to the relevance-gate fix (see implementation log).
- Post-gate cycle — 0 new candidates/notes from cached US responses (gate
  effective live).

### Definition of done

- `npm run verify` green — recorded in the PR (final gate run listed there).
- Docker integration suite green (20/20).
- Phase gate (TESTING.md §6 row 5): scout extraction fixtures green ✓;
  budget meter test proves the 90-search stop ✓.
