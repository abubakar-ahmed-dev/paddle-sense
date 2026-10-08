# PaddleSense — Claude Instructions

## Project Context

This repository contains PaddleSense, a river-level watcher for Pakistan's
paddling waters (kayak, raft, SUP). It watches river discharge from free public
data (Copernicus GloFAS via the Open-Meteo Flood API), predicts each river's
next-week flow band (TabPFN), scouts runnable ranges and access notes (SerpApi),
and renders one conservative plain-language status per river (hosted
open-weight Gemma, guardrailed). A durable weekly watcher (Temporal) runs the
cycle. The product is honesty-first: it shows facts and ranges with provenance
and never renders a green "safe" verdict.

Read the relevant docs before implementing a feature (all under `docs/` unless
noted; `docs/README.md` is the index):

- `docs/PRD.md` — product scope, users, requirements, acceptance criteria
- `docs/TECHNICAL_ARCHITECTURE.md` — components, decisions (ADR table §6), degradation matrix
- `docs/DATA_DICTIONARY.md` — schema, invariants (R/T/S/P/SM), enums
- `docs/API.md` — internal routes, predict-service contract, external API rules
- `docs/UX_SPEC.md` — screens, components, exact copy, accessibility
- `docs/TESTING.md` — test map, fixtures policy, phase gates
- `docs/RUNBOOK.md` — symptom → cause → fix; health queries
- `docs/DEPLOYMENT.md` — Render topology, migrations, rollback
- `docs/CONTRIBUTING.md` — branches, commits, definition of done
- `docs/deep-dive.md` — research record and data validation (background)
- `plans/plan.md` — master phase plan with current progress
- `plans/CLAUDE.md` — phase execution instructions (read before phase work)
- `competition-details.txt` — challenge brief; local-only, never committed

Inspect code and configuration to determine what exists today. Design
documents do not prove a feature works.

## Phase Workflow (mandatory)

1. **Branch:** create `phase/<n>-<name>` from `dev` (e.g. `phase/2-ui`). All
   phase work happens there; never commit directly to `main` or `dev`.
2. **Re-plan:** before starting the phase, create `plans/phase-<n>-<name>/` and
   write its `plan.md` — a detailed, phase-specific plan based on the *current*
   state of the repo (re-read docs, `git log`, and code to catch drift). The
   master plan is the map; the phase plan is the instruction sheet.
3. **Implement:** follow the phase `plan.md` only. No future-phase work.
4. **Log:** maintain `plans/phase-<n>-<name>/implementation-logs.md` — created
   at phase start, updated whenever any file belonging to that phase is
   created or changed: what changed, which files, decisions, deviations.
5. **Validate:** run the phase's checks; record real commands and results in
   `plans/phase-<n>-<name>/testing-logs.md` (same update rule: update whenever
   phase files change or validation runs).
6. **Merge:** open a PR into `dev`, merge after validation passes and the
   phase's exit criteria hold. Update `plans/plan.md` progress markers as part
   of the merge.

## Source of Truth

The docs above define the **target contract**. Existing code shows what is
implemented today; it does not approve an unplanned deviation.

Do not invent architecture, API contracts, schema, or copy when they are
already defined. When documentation conflicts with implementation, identify
the gap before a major change: migrate the code or update the contract,
tests, and docs deliberately — never silently.

Accepted architectural decisions live in `docs/TECHNICAL_ARCHITECTURE.md` §6
(D1–D8). Do not casually reverse one; record a superseding decision there.

## Implementation Rules

- Implement only the requested feature or current phase.
- Inspect existing code before modifying it; reuse existing utilities and
  patterns when they satisfy the contracts.
- Avoid unnecessary refactoring; do not introduce new infrastructure or
  dependencies without a clear need.
- External services are reached only through their adapters
  (`lib/flood.ts`, `lib/db.ts`, `lib/scout.ts`, `lib/llm.ts`). UI never calls
  a provider directly.
- Rivers, cells, ranges, and thresholds live in config (`lib/rivers.ts`, DB) —
  never inline literals.
- Safety-relevant status is computed only by `lib/status.ts` (`computeStatus()`),
  deterministically and unit-tested. The LLM never decides status.
- Provenance is structural: number/claim components require source + date or
  they do not compile.
- No green "safe" anywhere; danger copy verbatim from `docs/UX_SPEC.md` §6.
- Unknown states render "not yet verified" — never blank, never guessed.
- Never hardcode secrets; keep implementation plans milestone-based.

## Security

- Secrets live in a git-ignored `.env` locally and Render env bindings in
  production. Never in code, logs, plans, or commits.
- No user accounts or PII in v1; the notification email address is the only
  personal data and lives in env only.
- Treat all external API content as untrusted input; validate before render.
- Do not delete stored data (readings, sources, predictions) without explicit
  owner permission — history is the retrodiction evidence.

## AI

Hosted Gemma is reached only through `lib/llm.ts` (provider-swappable via
env). Model output is validated at runtime before use: schema parse → every
numeral must exist in the input → `status_word` must equal `computeStatus()`
→ banned tokens (`safe`, `danger-free`) absent. On any failure, use the
templated fallback; the site never depends on the model. Summaries are cached
per cycle in `summaries` — no LLM calls in the request path.

## Validation

After implementation, run the checks relevant to the changed area — at
minimum: lint, typecheck, relevant tests, and `npm run build`. Do not claim a
feature works without validating it. Required gates per phase are in
`docs/TESTING.md` §6; `npm run verify` green is the definition of done.

## Git

- Work only on the assigned phase branch (created from `dev`).
- Keep commits small and logical: one logical unit per commit; never bundle
  unrelated changes.
- Review `git diff` before committing.
- Never commit secrets, `.env`, generated artifacts, or `competition-details.txt`.
- Never force-push shared branches (`main`, `dev`).

## Do Not Trust Previous Claims

Verify the repository yourself. Do not assume a previous agent (or session)
implemented a feature correctly, ran tests, committed everything, followed the
architecture, or updated docs. Git state, actual test runs, and the running
app are the only evidence.
