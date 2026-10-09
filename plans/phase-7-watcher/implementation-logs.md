# Phase 7 — Implementation Log

Append-only by date. Updated whenever any phase file is created or changed.

## 2026-10-09

- Phase 6 merged (PR #5, merge commit `83300e0`); master plan marker on
  `dev` (`0df5780`). All six cycle steps exist as tested libs — the watcher
  is orchestration only.
- Created branch `phase/7-watcher` (from `dev`) + `plan.md`.
- Key decisions (P7-1…P7-8): TypeScript SDK ^1.24 (`@temporalio/*`) run via
  `tsx`, Temporal CLI dev server binary with SQLite persistence under
  `.cache/` (no Docker); one weekly schedule → `weeklyCycle`, rivers
  sequential; activities wrap the existing libs (fetch/store, predict,
  scout, summarize, notify) with zero logic duplication; skip-if-done-today
  idempotency (predict joins the summary pattern); `shouldNotify` = transition
  INTO `in_range` only, email body deterministic (§3.7: never the LLM
  sentence alone), Resend REST via `src/lib/notify.ts` (fetcher injectable);
  worker boot gate (migrations + env) per DEPLOYMENT.md; D5 production
  addendum = measurement plan now, empirical choice at Phase 9; tests via
  `@temporalio/testing` time-skipping env (no server in CI).
- Owner inputs: Resend key provided (`NOTIFY_EMAIL_*` in `.env`, values
  never committed) → nudge ON, single recipient. Known honest limit: nudge
  is dormant until a runnable range is verified (all four rivers are
  `range_unverified`); decision path tested via unit + test-DB simulation.

## 2026-10-09 (implementation)

- **Deps** — `@temporalio/{worker,workflow,client,testing}` 1.24.0 +
  `tsx` 4.23.15. Temporal CLI binary v1.9.1 downloaded to git-ignored
  `tools/` (GitHub release zip; `@temporalio/cli` does not exist on npm).
  `npm run temporal:dev` (SQLite `--db-filename .cache/temporal-dev.db`,
  UI :8233) + `npm run start:worker` scripts. `.gitignore` `tools/`.
- **Windows/`@swc/core` finding (bug protocol):** Temporal's workflow
  bundler loads `@swc/core`; 1.16.13 ships a native-binding ACL validation
  that fails on this machine ("DACL grants replacement rights … Reinstall
  the native package"). Pinned `overrides.@swc/core = 1.12.9` (pre-check
  version) — loads clean. Documented for anyone reproducing the dev env.
- **`src/lib/notify.ts`** — `shouldNotify` transition truth table (null
  history never claims a crossing), `buildRangeEmail` (deterministic §6
  sentence + band + source line + "never contains model-generated text"
  footer), `sendRangeEmail` (Resend REST, fetcher injectable, key only in
  the Authorization header, non-Resend provider = loud skip). 8 unit tests.
- **`workers/activities.ts`** — `fetchAndStoreRiver` (observed days only —
  the forecast tail's home is the TabPFN run), `predictRiver` (predict-
  service contract from Phase 4; **skip-if-done-today** via
  `getLatestForecastRun`; archive-weather injection point for tests),
  `scoutCycle`/`summarizeCycle` (lib calls), `notifyRiver` (fresh-row +
  transition gates → deterministic email), `bootGate` (required env +
  `_migrations` vs `db/migrations/*.sql` diff; `NOTIFY_*` optional warning),
  `allRiverIds` (config-driven).
- **`workers/workflows.ts`** — `weeklyCycle(riverIds)`: scout → per-river
  fetch+predict (isolated try/catch, errors land in the report) →
  summarize → per-river notify (never fatal). Retry policy: 5 attempts,
  10 s initial, ×2 backoff. `errMessage` unwraps Temporal's
  ApplicationFailure/activity-failure wrapping so reports carry real causes.
- **`workers/worker.ts`** — boot gate → `NativeConnection` → schedule
  create-or-update (`weekly-cycle`, Mondays 06:17 UTC; `handle.update`
  refreshes spec+action from config on every boot) → worker run with
  SIGINT/SIGTERM drain.
- **`src/lib/db.ts`** — added `getRecentSummaries(riverId, limit)` (newest-
  first; the crossing check reads [0] and [1]).
- **Tests** — `tests/workflows/watcher.test.ts` (time-skipping env, mock
  activities: happy-path ordering, forced fetch failure ×2 → retries →
  completes, one-river-fails isolation; vitest 60 s timeouts);
  `tests/integration/watcher.test.ts` (real Postgres: predict double-run →
  exactly one run; notify fresh-transition email + rerun skip + no-
  transition/no-row skips; bootGate refuses missing env, passes a migrated
  DB with a nudge-disabled warning). Watcher file cleans up exactly its own
  rows in `afterAll` (shared-DB hygiene).
- **Test-infra fix:** vitest now runs integration files sequentially AND in
  stable order (`fileParallelism: false` + `sequence.sortFiles: false`) —
  the size-sorted default put `predictions.test` before `db.test`, whose
  shared-river assertions then failed. Comment explains the order contract.
- **Live dedupe bug found and fixed (pre-merge):** `summarizeRiver`'s cache
  path returned `stored: true`; a mid-run resume would then re-email a
  river whose row already existed. Fixed to `stored: false` (nothing freshly
  inserted) — this is what `notifyRiver`'s fresh-row gate rides on. API.md
  §2.6 documents the `stored` semantics. No test asserted the old value.

### Live evidence (2026-10-09, dev server + worker + predict service)

- Schedule `weekly-cycle` created by worker 1, refreshed (update path) by
  worker 2 — both log lines captured.
- **Cycle 1** (schedule trigger): report `{scoutRan: true, 4× stored 14 +
  predicted true, summariesStored 4, emailsSent []}`; scout 0 spent / 9
  cache hits (SerpApi ledger reused from Phase 5's live runs); 4 fresh
  forecast runs (one per river); 4 summaries cached-or-stored; notify
  dormant by design (all `range_unverified`).
- **Cycle 2** (after the dedupe fix): predict all 4 skipped ("forecast run
  already exists for today"), summarize all 4 `cache`/`stored:false`,
  notify all 4 skipped ("no fresh summary this cycle") — double-run
  idempotency proven against the real stack.
- **Kill-mid-run resume:** worker killed 30 s into cycle 3 → workflow stayed
  `Running`; new worker booted (schedule refreshed) → workflow `Completed`.
- **Boot gate:** env + migrations passed live; `NOTIFY_*` warning path
  verified in integration test.
- **Real email:** one `sendRangeEmail` call through the production adapter
  → Resend `202` with id `01a120f5-bb29-777c-a18b-1b15dede3360` (deterministic
  template; owner inbox).
- Dev servers (Temporal, predict) and worker stopped after validation
  (scoped PID kills).
- Deviation from plan: none material. The `stored: false` cache fix and the
  `@swc/core` pin are recorded above; both under the bug protocol.
