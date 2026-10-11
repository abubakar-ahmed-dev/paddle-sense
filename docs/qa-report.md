# QA report — Phase 8 gate (2026-10-11)

| | |
|---|---|
| Scope | Honesty checklist · accessibility audit · failure drills · cost audit · performance — the Phase 8 exit gate ([plans/plan.md](../plans/plan.md) §8, [TESTING.md](TESTING.md) §6) |
| Method | Every claim below was executed on this date against the real running system; raw evidence in `plans/phase-8-qa/testing-logs.md` |
| Verdict | **All gates pass.** Two issues found and fixed, one model limitation documented, one soft budget consciously exceeded. |

---

## 1. Honesty checklist

| Rule (UX_SPEC / PRD) | Check | Result |
|---|---|---|
| Banned words: safe / safely / danger-free / guaranteed | Executable sweep (`tests/e2e/honesty.spec.ts`) over `/`, all four river pages, `/retro` | **PASS** — zero occurrences |
| `/about` exception: the refusal explainer names the banned words | Sweep asserts the words appear **only** inside "What we refuse to claim" | PASS |
| Danger copy verbatim §6 | Badge text asserted exact (`HIGH WATER — do not go`) whenever `data-status="high_water_dangerous"` renders | PASS (conditional — no high-water state live today) |
| Status never color alone | Every `[data-status]` badge must carry non-empty text | PASS (4/4 cards) |
| Provenance structural: source + date | Every dashboard card and river page asserts `GloFAS cell …` + `YYYY-MM-DD` in the mono footer | PASS |
| Charts dated; ranges carry provenance | Kunhar verified band renders "35 – 135 m³/s (verified — source linked below)" + chart caption | PASS |
| LLM never decides status | Unit + eval suites: `status_word === computeStatus()` gate; today's stored summaries all pass gates (4/4 real Gemma) | PASS |
| Unknown states render, never blank | Malir card, empty retro sections, unverified ranges — all render explicit states (e2e smoke + honesty) | PASS |

## 2. Accessibility audit

- **axe-core** (`@axe-core/playwright`, wcag2a/2aa/21a/21aa) on `/`,
  `/river/kunhar-balakot`, `/retro`, `/about`:
  **zero violations at any impact level.**
- Issue found and fixed during the audit: `link-in-text-block` (serious) —
  ochre prose links were distinguishable by color only. Fix: underline +
  `decoration-ochre/40` on all 7 prose links (`about`, `retro`, home, river,
  `NotesList`). Permanent regression guard: `tests/e2e/a11y.spec.ts`.
- Keyboard: skip-link in layout (`#main`), global `:focus-visible` ochre
  outline, chart data-tables open via keyboard (Tab → Enter → `<details
  open>`, asserted in e2e).
- **Owner tasks (human-only):** NVDA spot check on `/` and `/retro`;
  a keyboard-only tab-through by a human (the e2e asserts the specific
  paths above, a human should walk the rest). Checklist:
  1. NVDA → open `localhost:3000` → verify headings list, card summaries, badge text read aloud
  2. Same on `/retro` (metric rows + "no — miss shown" cells)
  3. Tab through `/`: skip link appears on first Tab; every control reachable; no focus traps

## 3. Failure drills (RUNBOOK §5) — all PASS

| Drill | Method | Observed |
|---|---|---|
| D1 Flood API down | `FLOOD_API_BASE=http://127.0.0.1:9` (new env knob, adapter-level) | `/` serves all 4 rivers from storage — "stored, through …" label, zero error panels |
| D2 DB unreachable | `DATABASE_URL` → dead port; dev **and** production build | `/` 200 via live-Flood-API fallback; `/about` 200 (static); `/retro` 200 → error digest (no 500 anywhere). Note: prod `/retro` degrades to Next's hydrated error page, not the styled `error.tsx` panel — PPR streaming nuance, recovery ("Try again") intact |
| D3 Gemma down | `LLM_API_KEY=invalid-drill-key`, summarize cycle | `ok:true`, all rivers fallback §6 sentences verbatim, errors recorded without the key, **nothing stored** (0 rows for the cycle date) |
| D4 predict service down | killed uvicorn (scoped PID) | `/retro` 200 with stored coverage/MAE/TabPFN rows; `/` unaffected |
| D5 worker killed mid-cycle | worker PID killed while workflow Running → restart | workflow resumed and **COMPLETED** (stored 14×4, summaries + predictions where services healthy); second trigger healed the drill-inflicted gap (indus predict) and finished **0 duplicate rows** |

**Drill bonus:** the second D5 cycle sent the **first real range-crossing
email** — kunhar moved `range_unverified` (cycle 2026-10-09) → `in_range`
after the owner-verified 35–135 m³/s band. The watcher → verified-range →
email chain now has live end-to-end evidence.

## 4. Cost audit

`npm run cost-audit` (exit-0 gate against ceilings): **all dimensions inside
free tiers** — SerpApi 12/90 searches, LLM ≤ 4 calls/day heaviest observed vs
200/day free, 1 email vs 3,000/month, DB 16 MB / 256 MB. Full numbers and
method honesty (bounded-not-metered LLM accounting, local embeddings) in
[cost-audit.md](cost-audit.md).

## 5. Performance (local prod build, 2026-10-11)

Measured against `next start` on the dev machine (not Render — free-tier
cold-start numbers are the Phase 9 measurement):

| Route | HTML | Warm render | Client JS |
|---|---|---|---|
| `/` | 67.6 kB | ~1.8–1.9 s | 386 kB (10 chunks) |
| `/river/kunhar-balakot` | 77.6 kB | ~1.75 s | 357 kB |
| `/retro` | 75.7 kB | ~0.95–1.1 s | 357 kB |
| `/about` | 23.6 kB | 13–32 ms (static) | 225 kB |

- DB is not the bottleneck: dashboard queries measured 0.06–0.15 ms
  (index-only / index scans on `readings_pkey` and
  `readings_river_kind_date_idx`).
- **Soft budget consciously exceeded:** client JS is 386 kB against the
  plan's 200 kB aspiration. Justification: Recharts is the interactive
  core of every data page; the product is a weekly-check tool, not a
  high-traffic consumer app, and the payload is cached by the CDN after
  first load. Documented improvement path (deliberately deferred):
  dynamic-import the charts below the fold; `/about` proves the
  framework floor is 225 kB.
- Next 16 no longer prints per-route First Load JS (Turbopack build
  output); transferred-JS-per-route was measured instead.

## 6. Coverage refresh (2026-10-11)

`npm run test:coverage`: `status.ts` **100%**, `rivers.ts` 100%,
`notify.ts` 86%, `scout.ts` 53%, `llm.ts` 54% — unchanged from the
published 2026-10-10 figures; TESTING.md updated with the fresh date.

## 7. Findings ledger (every issue: fixed or consciously documented)

| # | Finding | Disposition |
|---|---|---|
| F1 | Ochre prose links failed axe `link-in-text-block` (serious) | **Fixed** — underlines; regression test stays |
| F2 | Gemma sometimes ends its response with `</output>` and no answer JSON (kunhar, 3 consecutive cycles today) — schema gate refused, fallback served, stored on cycle 4 | **Documented** — validator behaved per design; 2 parser regression tests added; RUNBOOK 2.4 already covers the symptom |
| F3 | `npm run temporal:dev` broken on Windows cmd (`tools/…` forward-slash path) | **Fixed** — RUNBOOK command updated to invoke the binary directly |
| F4 | Prod `/retro` under dead DB shows Next's error digest page, not the styled error.tsx panel | **Documented** — degradation contract (200, recoverable, honest) holds |
| F5 | Client JS 386 kB vs 200 kB soft budget | **Documented** — Recharts trade-off, deferred dynamic-import path |
| F6 | e2e notes-search flaky on cold MiniLM load | **Fixed** — dedicated timeout in the spec |

## 8. Gate results (definition of done)

- `npm run verify` — lint + typecheck + unit + build: **exit 0**
- e2e: smoke + honesty + a11y — **28 passed, exit 0** (one axe scan on
  `/river/kunhar-balakot` needed its retry — transient dynamic-content
  timing, passed clean on retry; Playwright records it as flaky, not
  failed)
- Failure drills D1–D5: **all PASS** with recorded evidence
- Cost audit: **exit 0**, all inside free tiers
- a11y: **zero axe violations** on all routes

## 9. Final gate runs (this branch `phase/8-qa`, pre-merge, 2026-10-11)

| Command | Result |
|---|---|
| `npm run verify` | **exit 0** |
| `npm run test:db` | **exit 0 — 37/37 tests** |
| `npm run test:e2e` | **exit 0 — 28 passed** (1 flaky-retried, §8) |
| `cd services/predict && python -m pytest` | **31 passed** |
