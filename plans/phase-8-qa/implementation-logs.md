# Phase 8 — implementation log

Format: date — what changed, which files, decisions, deviations.

## 2026-10-11

- Phase started. Branch `phase/8-qa` created from `dev` (3918edf).
- `plans/phase-8-qa/plan.md` committed (02d7644).
- Created this log + `testing-logs.md`.
- E2E expansion: `tests/e2e/smoke.spec.ts` +7 tests (kunhar verified band,
  retro decay + table, dashboard data-table, season strip, notes search,
  mobile overflow); new `tests/e2e/honesty.spec.ts` (banned-words sweep on
  6 routes, /about refusal-scoped exception, verbatim danger copy,
  data-status text, provenance+date). Committed abd1c03.
- a11y: added `@axe-core/playwright`; `tests/e2e/a11y.spec.ts` (4 route
  scans, allowlist test, keyboard data-table). Found + fixed
  `link-in-text-block` (serious): underline added to 7 prose links.
  Committed 450fb4f.
- `src/lib/flood.ts`: `FLOOD_API_BASE` env override for drill D1
  (+ .env.example). Committed 9f9222f.
- Failure drills D1–D5 executed (evidence in testing-logs.md).
  Deviations: D5 needed predict service restarted WITH
  `X_INTERNAL_TOKEN` (drill-setup gap, product retried correctly);
  `npm run temporal:dev` broken on Windows cmd (`tools/…` forward-slash
  path) — run binary via bash directly; RUNBOOK note to add.
- D5 bonus: first real range-crossing email (kunhar → in_range) — the
  verified range now drives the nudge end-to-end.
- Finding: Gemma occasionally terminates with `</output>` and no answer
  JSON (kunhar 3× today) — schema gate + fallback behaved as designed;
  2 parser regression tests added to `tests/unit/llm.test.ts` (30/30).
  Not a code change to llm.ts — parser already prefers the contracted
  shape; tests lock that contract.
- Local-only diagnostics used and deleted: `scripts/probe-kunhar.mjs`
  (raw model capture). Never committed.
