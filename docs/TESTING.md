# PaddleSense — Testing Guide

| | |
|---|---|
| Purpose | What we test, how, where tests live, and what must pass before anything merges — so bugs surface here, not on the demo |
| Philosophy | Test the things that can **lie to users**: safety status, provenance, bands, claims. Everything else is tested pragmatically |
| Related | [DATA_DICTIONARY.md](DATA_DICTIONARY.md) (invariants = test cases) · [plans/plan.md](../plans/plan.md) (phase gates) |

---

## 1. Principles

1. **Fixtures, never live calls, in tests.** Every external API (Flood, Archive, SerpApi, Gemma) is replayed from recorded fixtures in `tests/fixtures/`. CI has no network. A fixture is a real recorded response, committed once, annotated with its fetch date.
2. **The backtest is the prediction test.** No unit test pretends to know hydrology. The prediction is judged by `POST /v1/backtest` metrics against stored truth.
3. **Regression tests are permanent.** Every bug becomes a failing test first, then a fix. The test stays forever.
4. **Invariants from the data dictionary are executable.** R1–R3, T1, S1–S2, P1–P2 map 1:1 to integration tests.
5. **100% coverage only where it matters:** `lib/status.ts` truth table. Elsewhere, cover behavior, not lines.

---

## 2. Test map

| Layer | Tool | Location | Runs in | Gate |
|---|---|---|---|---|
| Status truth table | Vitest | `tests/unit/status.test.ts` | every commit | 100% of §8.5 cases |
| Band & formatting helpers | Vitest | `tests/unit/` | every commit | — |
| Provenance enforcement | Vitest + Testing Library | `tests/unit/components/` | every commit | number components **fail to typecheck** without `provenance` prop |
| DB access + invariants | Vitest + throwaway Postgres | `tests/integration/` | every commit (docker) | R1–R3, T1, S1–S2, P1–P2 green |
| Flood API adapter | Vitest + fixtures | `tests/integration/flood.test.ts` | every commit | parse, NULL handling, cell-snap logging |
| Scout extraction + relevance gates | Vitest | `tests/unit/scout.test.ts` | every commit | range patterns (unit forms, no-unit = discard), keyword gates, river-relevance gate |
| Scout ledger, budget, invariants | Vitest + throwaway Postgres + fixtures | `tests/integration/scout.test.ts` | every commit (docker) | S1, S2, notes FK, budget hard-stop at 90, real-fixture replay stores nothing |
| LLM validator + fallback + adapter | Vitest | `tests/unit/llm.test.ts` | every commit | every gate fires on its adversarial case; §6 templates verbatim; tolerant parse (fences, `<thought>` blocks) |
| LLM output validation | Vitest + recorded outputs | `tests/eval/llm.test.ts` | every commit | eval set ≥ 95%: no `safe`, no invented numbers, correct `status_word`; recorded Gemma fixtures replay |
| Summary cycle + invariants | Vitest + throwaway Postgres | `tests/integration/llm.test.ts` | every commit (docker) | insert-if-missing idempotent, cache-before-call, SM1 (nothing banned stored), route 401 |
| Prediction | Backtest harness (pytest) | `services/predict/tests/` | Phase 4 | coverage published; ≥ 0.70 or flagged `experimental` |
| Temporal workflows | Temporal test framework | `tests/workflows/` | Phase 7 | forced activity failure → retry completes; double-run → no dup rows |
| E2E smoke | Playwright | `tests/e2e/` | pre-merge to `dev` | `/`, `/river/[id]`, `/retro` load with data |
| Accessibility | Manual + axe scan | checklist in [UX_SPEC.md](UX_SPEC.md) §8 | Phase 2 exit, then each release | keyboard + NVDA pass |

---

## 3. Commands

```bash
# unit + integration (web app)
npm run test            # vitest run, once
npm run test:watch      # during development

# integration DB (needs docker once, then cached)
npm run test:db         # spins throwaway postgres, runs invariant tests

# prediction service (Phase 4)
cd services/predict && .venv/Scripts/python -m pytest   # unit + contract, fixtures only
npm run backtest -- --river indus-besham                # real backtest → metrics + stored run
npm run predict                                         # live 7-day band → stored run

# scout cycle (Phase 5; needs the app running + SERPAPI_KEY in .env)
curl -X POST http://localhost:3000/api/internal/scout -H "X-Internal-Token: $X_INTERNAL_TOKEN"
npm run range-candidates                                # owner review report (no auto-promotion)

# summary cycle (Phase 6; needs the app running + LLM_* in .env)
curl -X POST http://localhost:3000/api/internal/summarize -H "X-Internal-Token: $X_INTERNAL_TOKEN"

# durable watcher (Phase 7; Temporal CLI binary in git-ignored tools/)
npm run temporal:dev        # dev server + UI (http://localhost:8233, SQLite-persisted)
npm run start:worker        # boot gate → schedule create/update → heartbeat
tools/temporal.exe schedule trigger --schedule-id weekly-cycle   # fire one cycle now

# e2e (Phase 5+, needs running app)
npm run test:e2e        # playwright against localhost:3000

# everything, pre-push
npm run verify          # lint + typecheck + test + build
```

`npm run verify` green is the **definition of "works on my machine."**

---

## 4. Fixture management

- Recorded responses live in `tests/fixtures/{flood,serpapi,gemma,archive}/…`, named `{provider}-{case}-{yyyymmdd}.json`
- Each fixture has a sibling `.meta.json`: `{ "url": "…", "fetched_at": "…", "note": "why this case exists" }`
- One fixture per interesting case: normal cell, Malir near-zero, NULL day, multi-location batch, SerpApi result with and without range-bearing snippet, Gemma output that fails number validation
- Re-recording a fixture is a deliberate act: it changes test truth, so the commit message must say why

---

## 5. Bug protocol (how every bug is handled)

1. **Reproduce** with the smallest input (usually a fixture or SQL row)
2. **Write the failing test** that expresses the bug
3. **Fix** until green
4. **Leave the test** — it is now a permanent regression guard
5. **Add a line to the RUNBOOK** if the bug took > 15 min to diagnose (symptom → cause → fix), so it never takes 15 minutes again

---

## 6. Phase gates (from plans/plan.md, restated as test gates)

| Phase | Nothing merges until |
|---|---|
| 2 UI | status truth table green; provenance typecheck active; a11y checklist done |
| 3 Data | invariant tests (R/T/S/P) green against real Postgres; backfill fixture test passes |
| 4 Predict | backtest run for all 4 rivers, metrics published in repo (`docs/retro-metrics.md`); contract tests green |
| 5 Search | scout extraction fixtures green; budget meter test proves the 90-search stop |
| 6 LLM | eval set ≥ 95%; fallback path proven by forced provider failure |
| 7 Watcher | workflow retry + idempotency tests green |
| 8 QA | `npm run verify` + e2e + a11y + failure drills (RUNBOOK §5) all green |
| 9 Deploy | production smoke: one full cycle observed; health checks pass |

---

## 7. What we deliberately do NOT test

- GloFAS itself (we are not ECMWF; we record and disclose)
- Chart pixel output (Recharts is trusted; we test data-in)
- Third-party SDK internals (we test our adapters at their boundaries)
- Anything requiring live third-party calls (fixtures only — flaky tests are deleted, not retried)
