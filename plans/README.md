# plans/ — PaddleSense implementation plans

Index and working protocol. Phase execution instructions live in `CLAUDE.md`
beside this file. Authoritative product/technical contracts live in `docs/`
(the root `README.md` orients; it does not override `docs/API.md`,
`docs/DATA_DICTIONARY.md`, or `docs/UX_SPEC.md`).

## Files

| File | Purpose |
| --- | --- |
| `CLAUDE.md` | Phase execution instructions (read before any phase work). |
| `plan.md` | Master phase plan (Phases 0–10) with dependency order and current progress. Authority for sequencing. |
| `needs-and-requirements.md` | Credentials, accounts, and decisions the agent needs from the owner, per phase. |
| `manual-tasks.md` | Human-only tasks (photos, posts, account creation) mapped to phases. |
| `phase-2-ui/` … | One folder per phase, created **immediately before that phase starts**. |

## Per-phase folder protocol

Each `phase-<n>-<slug>/` folder holds three files:

| File | Created when | Content |
| --- | --- | --- |
| `plan.md` | At **re-planning**, immediately before the phase starts | Detailed, current instructions for that phase: exact files to create/change/remove, contract sections to implement, test list, acceptance checks. Written after re-reading `docs/`, `git log`, and the code to catch drift since the previous phase. The master plan is intentionally not this detailed; behavior may change as the project progresses, so each phase is planned fresh. |
| `implementation-logs.md` | When the phase starts; **updated whenever any phase file is created or changed** | What was changed, files affected, decisions taken, deviations from plan, remaining issues. Written whether or not the phase completes. |
| `testing-logs.md` | When the phase starts; **updated whenever validation runs or phase files change** | Commands run, actual results (pass/fail counts), coverage of the phase's test list, environment notes. |

Until a phase begins, its folder does not exist (or contains only a `README.md`
stub describing scope).

## Workflow per phase

1. **Branch:** create `phase/<n>-<slug>` from `dev` (e.g. `phase/2-ui`). All
   phase work happens on that branch; never work directly on `main` or `dev`.
2. **Re-plan:** write `phase-<n>-<slug>/plan.md` after re-checking docs, git
   state, and code for drift. Update the master `plan.md` if reality diverged.
3. **Implement:** follow the phase `plan.md` within the phase scope only;
   keep `implementation-logs.md` current as files change.
4. **Validate:** run the phase's checks; record real commands and results in
   `testing-logs.md`.
5. **Merge:** review `git status`/`git diff`, open a PR into `dev`, merge after
   validation passes and the phase's exit criteria hold. Small, logical
   commits only — one logical unit per commit. Never commit secrets, `.env`,
   generated artifacts, or `competition-details.txt`.

## Standing rules (from root `CLAUDE.md` and owner decisions)

- Docs in `docs/` define the target contract; code is evidence of what exists
  today. Never silently extend an older prototype past a contract.
- Safety status is deterministic (`lib/status.ts`); the LLM summarizes behind
  validation gates and never decides status. No green "safe" anywhere.
- Ranges stay `unverified` until a quoted, sourced claim exists; predictions
  are bands, never points; retrodiction metrics are published even when
  unflattering.
- External providers are reached only through adapters (`lib/flood.ts`,
  `lib/db.ts`, `lib/scout.ts`, `lib/llm.ts`).
- Plans are milestone-based; secrets never appear in plans, logs, source
  control, or client code — local secrets live in a git-ignored `.env`.
- Logs are append-only by date; update entries rather than duplicating them.
