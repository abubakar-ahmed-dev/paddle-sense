# Phase 7 — Testing Log

Actual commands and results. Updated whenever phase files change or validation runs.

## 2026-10-09

- Phase planning only; no test runs yet. Baseline inherited from Phase 6
  merge (PR #5): `npm run verify` exit 0 (105 passed / 29 DB-gated skipped),
  `npm run test:db` 29/29, live summary cycle stored 4/4 model sentences.
- Version checks (read-only): `@temporalio/{worker,workflow,client,testing}`
  1.24.0 on npm; Node 22.16.0; `@temporalio/cli` not a package (dev server =
  Temporal CLI Go binary).

## 2026-10-09 (implementation + live validation)

| Command | Result |
|---|---|
| `npm i @temporalio/{worker,workflow,client}` + `-D @temporalio/testing tsx` | installed 1.24.0 / tsx 4.23.15; `import('@temporalio/worker')` smoke OK |
| `./tools/temporal.exe server start-dev --db-filename .cache/temporal-dev.db --port 7233 --ui-port 8233` | server up; UI `http://localhost:8233` → HTTP 200. Note: `--db-sqlite-file` flag does not exist in CLI 1.9.1 → `--db-filename` |
| `npx vitest run tests/unit/notify.test.ts` | **8/8 pass** |
| `npx vitest run tests/workflows/watcher.test.ts` | first runs: `@swc/core` 1.16.13 native-binding ACL failure (fixed by pin `overrides.@swc/core=1.12.9`), then 2 assertion/timeout failures (Temporal wraps error messages; vitest 5 s default) → after `errMessage` unwrap + 60 s timeouts: **3/3 pass** |
| `npm run test:db` | several iterations: shared-DB ordering (size-sorted file order broke `db.test`/`llm.test` assumptions) fixed via `sequence.sortFiles: false`; watcher file made hermetic (own-row cleanup); notify test env fixed → final **33/33 pass, exit 0** (5 files) |
| `npm test` | **116 passed / 0 failed / 33 skipped (DB-gated), 149 total** |
| Worker boot (`npm run start:worker`) | boot gate passed; `[worker] schedule "weekly-cycle" created` (worker 1) / `already exists — spec refreshed` (worker 2); heartbeat line present; bundle compiled clean |
| `tools/temporal.exe schedule trigger --schedule-id weekly-cycle` (cycle 1) | workflow `Completed` in ~5 min; report: scout 0 spent/9 cache hits; 4 rivers × 14 readings stored; 4 predicted (fresh runs); summaries 4; emails 0 (nudge dormant — all ranges unverified, by design) |
| Same trigger (cycle 2, after `stored:false` fix) | predict 4× `skipped: forecast run already exists for today`; summarize 4× `cache, stored:false`; notify 4× `skipped: no fresh summary this cycle` — double-run idempotency proven live |
| Kill drill: trigger cycle 3 → `taskkill` worker node PID mid-cycle → restart worker | workflow stayed `Running`, new worker resumed it → `Completed`. Exit criterion met |
| Live Resend send via `sendRangeEmail` (one-off script, deleted after) | `{"sent":true,"id":"01a120f5-bb29-777c-a18b-1b15dede3360"}` — deterministic template delivered to the owner address |
| Cleanup | dev server, predict service, worker stopped with scoped PID kills (wmic commandline match → taskkill //PID) |

Pending before merge: `npm run verify` + final `npm run test:db` after
docs land; results appended below.

## 2026-10-09 (pre-merge gate)

| Command | Result |
|---|---|
| `npm run verify` | first exit 1 (lint warning `init` unused; then vitest 3 typecheck rejected `sequence.sortFiles` — removed, size order proved stable once watcher cleans its rows) → final **exit 0**: lint clean, typecheck clean (incl. `workers/`), 116 passed / 0 failed / 33 skipped (149 total), production build green |
| `npm run test:db` | **33/33 pass, exit 0** |
| `git diff --stat` review before PR | no secrets, `.env`, `tools/`, or `.cache/` staged; temp scripts deleted |
