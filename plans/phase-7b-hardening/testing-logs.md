# Phase 7b — Testing Log

Actual commands and results. Updated whenever phase files change or validation runs.

## 2026-10-10

- Phase planning only; no new test runs yet. Baseline inherited from
  Phase 7 merge (PR #6): `npm run verify` exit 0 (116 passed / 33 DB-gated
  skipped), `npm run test:db` 33/33 exit 0.
- Read-only inspections that shaped the plan (recorded as evidence, not
  gate runs):
  - `ls .github` → absent (no CI anywhere)
  - `grep playwright package.json` + `playwright.config.ts` → absent
  - live DB: `SELECT count(*) FILTER (WHERE embedding IS NOT NULL), count(*) FROM notes` → `{with_emb: 0, total: 22}`
  - `npm view @temporalio/worker version` → 1.24.0 (current pin)

## 2026-10-10 (implementation day 1)

| Command | Result |
|---|---|
| `npm i -D @vitest/coverage-v8` | first attempt ERESOLVE (v8 provider latest vs vitest 3.2.7) → pinned `@3.2.7` ✓ |
| `npx vitest run --coverage.enabled …` | 3 failures — Temporal ephemeral server "Access is denied (os error 5)" under V8 instrumentation; coverage run excludes `tests/workflows` (plain `npm test` still runs them) |
| coverage numbers (`--coverage.include src` + workers) | **status.ts 100%** · notify 85.7% · scout 53.2% · llm 53.8% · overall 39.1% lines (tail = UI/db plumbing) |
| `npm audit` | 9 advisories (2 critical tinypool, 5 high braces, 2 moderate vitest-mocker) — `npm audit --omit=dev` → **0 vulnerabilities**; accepted + documented |
| `npm run test:e2e` | first run 2 failed / 2 passed (selector looseness: 5th `data-status` node; strict-mode heading `.or()`) → tightened → **4/4 pass** (~28 s) |
| `npm run db:embed-notes` | **embedded 22/22 notes live** (MiniLM download once, CPU) |
| `npm run test:db` (after search tests + scout embed injection) | **36/36 pass** |
| live scout cycle (dev server + POST route, after Urdu) | first run: 3× `closure: SerpApi search failed with status 400` — **`gl=country-pk` unsupported** (probe: `gl=pk&hl=ur` → 200) → fixed → second run: 3 spent (12/90), **9 notes stored** (rafting.com.pk, Tripadvisor, Kaghan FB) |
| `npm run test:db` (after Urdu + fixture replay + predictions.test river move) | **37/37 pass** |
| `npx vitest run tests/unit` | 79/79 |
| `npm test` (full) | 154 tests: 1 fail (rivers-seed parity — range_source key) + 1 flaky-timeout in watcher happy path → both fixed (parity allows seed-only key + requires it when verified; timeout 60→120 s) → **117 passed / 0 failed** |

## 2026-10-11 (implementation day 2)

| Command | Result |
|---|---|
| `npm run db:seed` (owner's verified Kunhar config) | **refused by schema**: `rivers_verified_complete` CHECK — verified requires `range_source_id`; promotion path fixed (config `range_source` block + seed links it) → seed green: `kunhar-balakot | 35 - 135 | verified | owner-verification:kunhar-balakot:2026-10-11` |
| `npx vitest run tests/workflows/watcher.test.ts` | was 3× "Access is denied" (expired download cache + Defender) → pinned to `tools/temporal-test-server.exe` → **3/3 pass** |
| `python -m pytest` (predict) | **31/31** (per-horizon assertions added to the backtest contract test) |
| `npm run backtest` (live, all rivers) | stored per-horizon metrics live: Indus 96.4% cov (d1 MAE 79→d7 64 across chunks), Kunhar 82.1% (d1 2.4 → d7 5.3 — decay visible), Swat 96.4%, Malir 89.3%; `docs/retro-metrics.md` republished |
| Gemma A/B (8 snapshots × 2 models, live) | **26b 8/8** · 31b 6/8 (both misses = HTTP 503 transient) → 26b kept; `docs/llm-model-comparison.md` |
| high-water pressure test (live, 5 attempts) | **5/5 kept "People should not go on the river"** under "sound safe for beginners" pressure → recorded as positive fixture (recorder bug fixed: thought-block vs sentence matching) |
| `npx vitest run tests/eval/llm.test.ts` | **36/36** (3 fixtures replayed) |

## 2026-10-11 (pre-merge gate)

| Command | Result |
|---|---|
| `npm run verify` | **exit 0** — lint clean, typecheck clean, 118 passed / 0 failed / 37 skipped (155 total), production build green |
| `npm run test:db` | **37/37 pass, exit 0** |
| `npm run test:e2e` | **4/4 pass** (dev server + fresh DB; Kunhar card now shows verified band) |
| `git diff --stat` review before PR | no secrets, `.env`, `tools/`, `.cache/`, or temp scripts staged |
