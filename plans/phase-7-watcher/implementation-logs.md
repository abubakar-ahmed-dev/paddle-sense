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
- Verified versions live: `@temporalio/*` 1.24.0 exist on npm; Node 22.16
  local; `@temporalio/cli` does NOT exist (dev server comes from the Go
  Temporal CLI binary — download to git-ignored `tools/`, not npm).
- Nothing implemented yet; tasks 2–7 pending.
