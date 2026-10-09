# Phase 6 — Testing Log

Actual commands and results. Updated whenever phase files change or validation runs.

## 2026-10-09

- Phase planning only; no test runs yet. Baseline inherited from Phase 5
  merge (PR #4): `npm run verify` green (42 unit tests), Docker integration
  20/20, live scout spend 9/90.

## 2026-10-09 (implementation + live validation)

Owner provided `LLM_API_KEY` (Google AI Studio). All commands run from repo
root on `phase/6-llm`.

| Command | Result |
|---|---|
| `npx vitest run tests/unit/llm.test.ts` | first run 21/24 (3 test-expectation fixes: en-dash range format is §3-literal `40.00–120`, prompt embeds the snapshot JSON so quotes are escaped, snapshot numerals are unformatted) → final **24/24 pass** |
| `npx vitest run tests/eval/llm.test.ts` | 32/33 before fixtures — the 1 red is the fixture-forcing test by design; after live recording **33/33 pass** (30/30 legit runs = 100% ≥ 95% gate; 15/15 adversarial caught = 100%) |
| `npx vitest run tests/unit/llm.test.ts tests/eval/llm.test.ts` (post thought-block parser + unit-consistency gate) | **62/62 pass** |
| `npm run test:db` | first run 28/29 — 1 failure in the *pre-existing* `db.test.ts` (parallel-file race on the shared throwaway Postgres, exposed by the new 4th file's timing); fixed with `fileParallelism: false` in `vitest.config.ts` → **29/29 pass** (4 files) |
| `npm test` | 98 passed / 1 failed (fixture-forcing test, red by design until recording) / 29 skipped (DB-gated) |
| Live probe: both models, real prompt, `max_tokens` 200→1024→4096 | `gemma-4-31b-it`: 200 OK, ~36 s, 376/59 tok, complete fenced JSON · `gemma-4-26b-a4b-it`: 200 OK, ~15–25 s, 376/48–61 tok, complete · both emit `<thought>` blocks; `reasoning_effort:"none"` → HTTP 400 "Thinking budget is not supported for this model" |
| `POST /api/internal/summarize` (dev server, cycle 1, 2026-10-09) | HTTP 200, **142 s total**: indus 23.3 s 466/54 `model` ✓ stored · kunhar 41.1 s 668/43 `model` ✓ stored · malir 20.9 s 404/51 `model` ✓ stored · swat 43.5 s `fallback` `validation: schema` (thinking truncation), nothing stored — real-provider fallback proven |
| `POST /api/internal/summarize` (cycle 2, same day) | HTTP 200, 32 s: indus/kunhar/malir `cache` (0 tokens) — insert-if-missing idempotency live · swat retried (no stored row): 22.5 s 492/60 `model` ✓ stored |
| `GET /` (dashboard) | renders all four sentences: 3 model + 1 fallback→model after cycle 2, each model sentence with `summary · gemma-4-26b-a4b-it · cycle 2026-10-09` |
| Route auth spot-check | covered by integration test (401 with missing/wrong token, §0 error shape); not re-fired live to avoid extra LLM spend |

Pending before merge: `npm run verify` (lint + typecheck + test + build) and
final `npm run test:db` — run after docs/logs land; results appended below.

## 2026-10-09 (pre-merge gate)

| Command | Result |
|---|---|
| `npm run verify` | **exit 0** — lint clean, typecheck clean, 105 passed / 0 failed / 29 skipped (DB-gated, 134 total), production build green (summarize route listed as ƒ dynamic) |
| `npm run test:db` | **29/29 pass** (4 integration files, sequential) |
| `git diff --stat` review before PR | 13 changed files + 5 new, no secrets, no `.env`, no temp scripts (`.probe-llm.mjs` / `.record-fixtures.mjs` deleted before staging) |
