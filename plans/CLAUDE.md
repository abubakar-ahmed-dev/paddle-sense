# Implementation Phase Instructions

This directory holds the implementation plans for **PaddleSense**, a
river-level watcher for Pakistan's paddling waters. These instructions apply
while carrying out any phase in this directory. Document paths are relative to
the repository root (`docs/…`, `plans/…`).

## Before Starting a Phase

1. Create the phase branch: `phase/<n>-<name>` from `dev` (e.g. `phase/2-ui`).
2. Create the phase folder `plans/phase-<n>-<name>/` and write its `plan.md`
   (see the per-phase protocol in `README.md` beside this file). Re-plan
   against the repo's *current* condition: re-read the relevant docs, `git
   log`, and the code. The master `plan.md` is the map; the phase `plan.md` is
   the detailed, current instruction sheet. Update the master plan if reality
   has diverged.
3. Read: the phase `plan.md`, the relevant sections of `docs/PRD.md`,
   `docs/TECHNICAL_ARCHITECTURE.md`, and the task-specific contracts
   (`docs/API.md`, `docs/DATA_DICTIONARY.md`, `docs/UX_SPEC.md`,
   `docs/TESTING.md`, `docs/RUNBOOK.md`, `docs/DEPLOYMENT.md`) as applicable.
4. Then inspect the existing implementation and its actual configuration.
   Documents define intended behavior; their existence does not mean a feature
   is built, tested, or deployed. If code and docs differ, identify the
   discrepancy before a major change and update the appropriate contract as
   part of the work.

## Work Scope

- Implement only the current phase/feature.
- Do not start future phases or redesign unrelated parts.
- Avoid unnecessary refactoring; preserve existing functionality.
- Follow the accepted decisions in `docs/TECHNICAL_ARCHITECTURE.md` §6
  (D1–D8). Record a superseding decision there before intentionally changing
  the agreed architecture.

## PaddleSense Boundaries

- Discharge values are GloFAS grid-cell estimates. The UI always shows the
  cell identity and fetch date; it never presents them as gauge measurements.
- Safety status comes only from `computeStatus()` (`lib/status.ts`),
  deterministically. The LLM summarizes; it never decides status, and its
  output is validated post-hoc (numbers traced to input, `status_word` must
  match, banned tokens: `safe`, `danger-free`). Validation failure → fallback
  template.
- No green "safe" badge exists anywhere; high water always says "do not go".
- Runnable ranges render only as `verified` (with quoted source) or
  `unverified` ("not yet verified"). Ranges are never invented to fill the UI.
- Malir stays in the catalog as the honesty check (`not_a_paddling_river`).
- The user request path reads storage/cache only — no third-party API calls
  while rendering.
- No public API in v1; internal routes are `/api/v1/*` as contracted in
  `docs/API.md`. No accounts, no PII, no social features without a new
  architectural decision.
- Predictions are bands, never point values; retrodiction metrics are
  published even when unflattering.

## During Implementation

Before changing a file: understand its current responsibility, check how it
is used, follow existing project patterns. When introducing a dependency,
service, API field, or external integration, verify it against the relevant
contract before implementing it. If an accepted decision must change, update
the ADR table and affected docs and tests first.

## Testing

Run validation appropriate to the change and the scripts that actually exist.
Do not claim a test or quality target passed without running and recording it.

- Frontend changes: lint, typecheck, relevant component tests, Playwright
  checks when user-facing behavior changes (mobile, keyboard, states).
- Backend/worker changes: lint, typecheck, unit/integration tests for the
  changed contract, fixture-based adapter tests.
- Prediction changes: run the backtest harness and record real metrics.
- Record actual commands and results in the phase's `testing-logs.md`.

## Logs (mandatory)

Two log files live in each phase folder and are **updated whenever any file
belonging to that phase is created or changed** (not only at phase end):

- `implementation-logs.md` — what was changed, files affected, decisions
  taken, deviations from plan, remaining issues.
- `testing-logs.md` — commands run, actual results (pass/fail counts),
  coverage of the phase's test list, environment notes.

Keep entries concise and append-only by date. Update existing entries when
correcting previous work instead of duplicating. Separate completed behavior
from planned or unverified behavior.

## Git

Only commit work that belongs to the current phase. Before committing:

1. Review `git status` and `git diff`.
2. Run required validation.
3. Confirm no secrets, `.env`, generated artifacts, or unintended assets are
   included.
4. Break larger changes into smaller, logically separated commits — one
   logical unit per commit.
5. Commit with a meaningful Conventional Commit message.

Never force-push shared branches (`main`, `dev`). Merge to `dev` via PR only.

## Completion

A phase is complete only when:

- planned implementation is complete
- relevant tests pass, or blockers are recorded explicitly in the logs
- the phase's exit criteria (master `plan.md`) hold
- known issues are resolved or documented in `implementation-logs.md`
- both log files are current
- the final `git diff` was reviewed before the PR merge
