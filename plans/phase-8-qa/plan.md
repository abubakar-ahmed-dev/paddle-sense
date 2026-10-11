# Phase 8 — Testing & QA gate — plan

Branch: `phase/8-qa` (from `dev`)
Master plan: `plans/plan.md` §Phase 8. Gates: `docs/TESTING.md` §6 row 8 —
"`npm run verify` + e2e + a11y + failure drills (RUNBOOK §5) all green".

Phase 8 is confirmation, not catch-up: tests were written with the phases that
introduced the code. This phase (a) widens e2e beyond smoke, (b) makes the
honesty rules executable, (c) audits accessibility with a tool, not a promise,
(d) rehearses the five failure drills with recorded evidence, (e) proves the
$0 claim with real numbers, (f) measures performance honestly.

Everything runs locally — e2e and drills need the dev DB and live services,
so they stay documented local gates (CI keeps its three network-free jobs).

---

## 1. E2E expansion — `tests/e2e/`

Current state: 4 smoke tests (`smoke.spec.ts`). Expand to cover the full
surface the product actually claims:

1. `smoke.spec.ts` additions (keep existing 4):
   - `/river/kunhar-balakot` shows the **verified band** (35–135 m³/s
     overlay label) — first verified river, must render as a band, not the
     amber note.
   - `/retro` per-river chart + metric row render with a stored backtest
     (coverage + MAE visible, `tabpfn` named).
   - `/about#ranges` + notes search box render; search returns hits or the
     honest empty state (needs local DB — assert one of the two, never an
     error panel).
   - SeasonStrip renders on dashboard and river page.
   - Mobile viewport (375×667) dashboard smoke: cards stack, no horizontal
     overflow (`document.scrollWidth <= innerWidth`).
2. New `tests/e2e/honesty.spec.ts` — **the banned-words sweep, executable**:
   - Crawl `/`, all four `/river/[id]`, `/retro`, `/about`.
   - Assert zero occurrences of `safe|safely|danger-free|guaranteed`
     (case-insensitive) in rendered text. UX_SPEC §6 banned list.
   - Assert every river card carries a provenance footer matching
     `/GloFAS cell/` and a date string.
   - Assert danger copy for any `high_water_dangerous` badge is verbatim
     `HIGH WATER — do not go` (UX_SPEC §6).
   - Assert status is conveyed by text: every `[data-status]` element has
     non-empty text (never color alone).
3. New `tests/e2e/a11y.spec.ts` — axe scans (see §2).

Exit: all e2e green locally against `npm run dev` + local DB.

## 2. Accessibility audit — tool + manual, recorded

- Add devDep `@axe-core/playwright`. Scan `/`, `/river/kunhar-balakot`,
  `/retro`, `/about` in `a11y.spec.ts`. Gate: **zero critical/serious
  violations**; moderate/minor are listed and fixed or consciously
  documented in the QA report.
- Contrast: axe covers it; spot-check the §2 token pairs against the
  pre-checked ratios in UX_SPEC §2 rule 4.
- Chart data-table alternatives already exist (`<details>` in RiverChart +
  RetroBandChart) — e2e asserts they open and contain numbers.
- Keyboard tab-through (dashboard + `/retro`): performed, steps + result
  recorded in `docs/qa-report.md`.
- NVDA spot check: **owner task** (needs a human with a screen reader) —
  written as a step-by-step checklist in the QA report; marked pending
  owner if not done before merge.

## 3. Failure drills — RUNBOOK §5, all five, with evidence

Each drill: run it, record command + observed behavior + PASS/FAIL in
`docs/qa-report.md` §drills. Any FAIL becomes a bug per TESTING §5 protocol
(failing test first, then fix).

| # | Drill | Method | Expected |
|---|---|---|---|
| D1 | Flood API down | point `FLOOD_API_BASE` (or equivalent adapter env) at an unreachable host; load `/` | dashboard serves last stored cycle with its date; no crash |
| D2 | DB unreachable | `DATABASE_URL` to a dead port; load `/` and `/retro` | no 500; cached shell/error banner per TECH_ARCH §8 matrix |
| D3 | Gemma down | invalid `LLM_API_KEY`; run one summarize cycle | fallback §6 sentences; cycle completes; nothing stored for failed rivers |
| D4 | Predict service down | stop uvicorn; load `/retro` | stored rows render; honest "unavailable" for live predict |
| D5 | Worker killed mid-cycle | start cycle, Ctrl+C worker, restart | workflow resumes; 0 duplicate rows (re-run of the Phase 7 proof, re-evidenced) |

## 4. Cost audit — prove $0 with numbers

New `scripts/cost-audit.mjs` (env: `DATABASE_URL`), prints:

- SerpApi: ledger spent this month vs 90 cap (scout ledger tables).
- LLM: stored summaries count, distinct cycle days, model name — mapped to
  AI-Studio free-tier RPD math (no token accounting exists in DB; state that
  honestly and bound it from cycle counts × max_tokens).
- DB size: `pg_database_size(current_database())` + per-table row counts
  (readings/sources/predictions/summaries/notes) vs Tiger free tier.
- Email: Resend sends this cycle (from notify activity logs where recorded).

Output also written to `docs/cost-audit.md` (regenerable; committed once this
phase with its date). Gate: every number inside its free tier.

## 5. Performance — measured, not vibes

- `next build` route table recorded (First Load JS per route) into the QA
  report; note the budget: largest route < 200 KB First Load JS (soft
  budget; justify if exceeded).
- Playwright timing pass: DOM content loaded + fully loaded for `/`,
  `/river/kunhar-balakot`, `/retro` against local dev (cold and warm);
  recorded as indicative numbers with the "local ≠ free-tier cold start"
  caveat (real cold-start numbers land in Phase 9 on Render).
- DB query latency for the dashboard queries (EXPLAIN ANALYZE the two main
  reads) — confirm no unbounded scans at current row counts.

## 6. Coverage refresh

Re-run `npm run test:coverage`; update the numbers in TESTING.md principle 5
(2026-10-10 figures are stale after 7b). Gate: `status.ts` still 100%.

## 7. Docs updated as part of the gate

- `docs/TESTING.md` — e2e/honesty/a11y/audit rows + new commands
  (`npm run cost-audit`), refreshed coverage line.
- `docs/RUNBOOK.md` §5 — drill results annotated with dates.
- `docs/qa-report.md` — the phase artifact: honesty checklist, a11y results,
  drill evidence, cost numbers, perf numbers, findings list with
  fixed/documented disposition.
- `plans/plan.md` — Phase 8 marker on merge.

## 8. Dependencies & risks

- New devDep: `@axe-core/playwright` (justified: the a11y gate needs a tool;
  no runtime impact).
- Risk: honesty sweep may surface a banned word in existing copy (likely
  "safe" inside /about prose explaining that we *refuse* to say safe —
  handle by scoping the sweep to exclude quoted refusals, or rewording;
  decide from what the crawl actually finds).
- Risk: D2 (DB unreachable) may reveal Next.js prerender behavior that needs
  an error-boundary tweak — that is exactly what this phase is for.
- e2e remains a local gate (needs DB + services); CI unaffected.

## 9. Order of work

1. Branch `phase/8-qa` from `dev`; commit this plan.
2. E2E expansion + honesty sweep (write tests, run, fix what they find).
3. Axe a11y scans + fixes.
4. Failure drills D1–D5 with evidence.
5. Cost audit script + report.
6. Perf measurement.
7. Coverage refresh + docs updates + qa-report.md.
8. Full gates: `npm run verify`, `npm run test:db`, `npm run test:e2e`,
   pytest. PR → `dev`.

## Exit criteria

- All e2e green (smoke + honesty + a11y specs).
- Axe: zero critical/serious violations on all four routes.
- D1–D5 rehearsed, evidence recorded, all PASS (or bug-protocol'd to PASS).
- Cost audit: all numbers inside free tiers, committed with date.
- Perf numbers recorded with budget disposition.
- Coverage refreshed in TESTING.md; `status.ts` 100%.
- `npm run verify` exit 0; issues found fixed or consciously documented.
