# PaddleSense — how each technology earns its place

| | |
|---|---|
| Purpose | Judge-facing evidence: what we use each partner/open technology *for*, where it lives in the code, and how a judge can verify it in under a minute |
| Rule | Every claim below names a file, a command, a test, or a live endpoint — nothing is asserted from vibes |
| Related | [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) (design + ADRs) · [TESTING.md](TESTING.md) (test strategy) · [cost-audit.md](cost-audit.md) (free-tier proof) |

**TL;DR — category map**

| Technology | Where it's load-bearing | Fastest proof |
|---|---|---|
| [Temporal](#1-temporal--the-durable-heartbeat) | the weekly watcher that survives crashes | `npm run test` → workflow tests kill activities mid-run |
| [TabPFN](#2-tabpfn--bands-that-prove-themselves) | 7-day flow bands + published backtest | [retro-metrics.md](retro-metrics.md) |
| [Gemma (open-weight)](#3-gemma--a-language-model-on-a-leash) | one validated sentence per river | `tests/eval/llm.test.ts` → 36 adversarial + legit cases |
| [SerpApi](#4-serpapi--the-scout-that-reads-urdu) | Urdu+English access/closure scouting on a budget | `npm run range-candidates` report |
| [Tiger Data (Postgres + pgvector)](#5-tiger-data--postgres-pgvector) | 17k+ readings, executable invariants, semantic note search | `npm run test:db` → 37 invariant tests |
| [Render](#6-render--the-whole-product-lives-there) | web app + predict API + background worker | `https://paddle-sense.onrender.com` |
| [The open stack](#7-why-open--the-touch-grass-fit) | open-weight model + open data + local embeddings, $0 to run | [cost-audit.md](cost-audit.md) |

---

## 1. Temporal — the durable heartbeat

**The product claim:** a watcher that runs the full pipeline every week,
retries its own failures, and never loses work to a crash or a double-fire.

**How Temporal is used**

- `workers/workflows.ts` — `weeklyCycle`: the workflow fans out per river
  with **per-river error isolation** (one broken river never blocks the
  other three) and reports a structured cycle summary
  (`stored / predicted / summariesStored / emailsSent` per river).
- `workers/activities.ts` — every side effect (fetch, predict, summarize,
  notify, scout) is a Temporal **activity** with `startToCloseTimeout: 15
  minutes` and retries: 5 attempts, 10 s initial interval, 2× backoff.
- `workers/worker.ts` — boot gate (missing env or stale DB migrations
  **refuse to start**), then schedule create-or-update for `weekly-cycle`
  (Mondays 06:17 UTC, off the hour on purpose), idempotent across boots.
- Production runs the **same `executeCycle` steps** through a
  worker-internal durable loop (`WORKER_MODE=loop`) — decided and recorded
  as ADR D5 in [TECHNICAL_ARCHITECTURE.md §6](TECHNICAL_ARCHITECTURE.md),
  because a 512 MB worker can't host a Temporal server; the workflow path
  remains the dev/test orchestration truth and one env var flips back to it.

**Proof it actually survives**

- `tests/workflows/watcher.test.ts` (Temporal test framework,
  time-skipping): forces activity failures → asserts the workflow still
  completes; runs the cycle **twice** → asserts **zero duplicate rows**.
  These tests kill the worker mid-run on purpose — the exact scenario that
  breaks cron-based watchers.
- Proven live during the build: the worker process was killed mid-cycle
  and the running workflow **completed on restart**; a second trigger the
  same day stored **zero duplicates** (Phase 7 logs,
  `plans/phase-7-watcher/`).
- The verified-range nudge is real: when the Kunhar entered its
  owner-verified range, the cycle detected the transition and sent the
  email — `emailsSent: ["kunhar-balakot"]` in the cycle report.

**Judge's 60-second check**

```bash
npm run test          # includes the workflow kill/duplicate tests
grep -n "retry" workers/workflows.ts
```

## 2. TabPFN — bands that prove themselves

**The product claim:** a 7-day flow band with published error margins,
never a single number — and a forecast that is *checked*, not trusted.

**How TabPFN is used**

- `services/predict/model.py` — one TabPFN regressor per horizon
  (day 1…7) over log1p discharge. Bands are **empirical residual
  quantiles**: the newest calibration rows are held out, the model's
  absolute log-space residuals on them form the spread. Calibrated
  uncertainty is a property of the method, not a bolt-on.
- **CPU-only** inference (`n_estimators=1`) — no GPU anywhere in the
  project, runs on a free-tier container.
- `services/predict/app.py` — leak-free **walk-forward backtest**: the
  hidden window is scored in 7-day chunks, each chunk's features and
  training context truncated at its own origin, so no future truth can
  leak into a past prediction. This is the honesty core: the app publishes
  what it *would have predicted*, not a retrofitted fit.

**Proof it works**

- Published metrics: **band coverage 82–96% across all four rivers**
  against a 70% gate, plus **per-horizon decay** (day-1 vs day-7 coverage
  and MAE) — misses included — in [retro-metrics.md](retro-metrics.md).
- Contract tests: `services/predict/tests/test_contract.py` — 31 tests
  over shaped inputs, band sanity, auth, and the health contract.
- Backfill spot-check behind the features: the Indus reading for
  2022-07-02 (the record July 2022 flood) is **12,021.64 m³/s** in the DB
  vs the published record's 12,022 — the data feeding TabPFN matches
  reality at its most extreme point.

**Judge's 60-second check**

```bash
npm run test:e2e      # the /retro test asserts tabpfn + coverage render
open docs/retro-metrics.md
```

## 3. Gemma — a language model on a leash

**The product claim:** an open-weight model writes the plain-language
sentence, and it **cannot** lie, soften danger, or invent a number.

**How Gemma is used**

- `src/lib/llm.ts` — provider-swappable adapter (Google AI Studio today;
  Groq/Together are one env var away) calling **Gemma** over the
  OpenAI-compatible endpoint. Gemma-4's `<thought>` blocks can't be
  disabled — the tolerant parser handles them.
- **Four runtime gates** before any model sentence reaches the screen:
  1. *schema* — is it the contracted JSON at all?
  2. *numerals* — every number in the sentence must exist in the input
     snapshot we gave it (and no foreign units: the model once relabeled
     "1,632 m³/s" as "1,632 **cfs**" — a 16× unit lie with honest digits;
     caught live, kept as a permanent fixture
     `tests/fixtures/gemma/gemma-fail-unit-relabel-20261009.json`)
  3. *status* — the sentence's status word must **equal** the output of
     the deterministic, unit-tested `computeStatus()`. The model never
     decides safety.
  4. *banned tokens* — `safe`, `danger-free`, `guaranteed` (substring
     match, so "safest" dies too).
  Any gate failure → deterministic UX_SPEC §6 template. Nothing from a
  failed response is ever stored.
- **Cache-before-call**: summaries are stored per river per cycle; the
  request path never calls the LLM. Cost and latency stay bounded.

**Proof the leash holds**

- `tests/eval/llm.test.ts` — **36 eval tests**: every legit state renders
  honestly, and every adversarial case (invented numbers, unit relabels,
  status softening, banned-word smuggling) is **caught by the gates**.
  Includes a recorded pressure test: asked 5× to soften a
  high-water warning, the pipeline kept "do not go" 5/5.
- Model selection was measured, not vibes: a live A/B probe
  ([llm-model-comparison.md](llm-model-comparison.md)) kept the smaller
  Gemma on latency (15–25 s vs 36 s) with equal gate pass rates.
- The fallback path is rehearsed: invalid key → `ok:true` cycle, all
  rivers on §6 templates, **zero rows stored** (failure-drill evidence in
  [qa-report.md](qa-report.md) §3).

**Judge's 60-second check**

```bash
npx vitest run tests/eval/llm.test.ts   # 66/66
cat tests/fixtures/gemma/gemma-fail-unit-relabel-20261009.json
```

## 4. SerpApi — the scout that reads Urdu

**The product claim:** the app finds the human knowledge no dataset has —
access points, road closures, operator pages — and every claim carries a
verbatim quote, a URL, and a date.

**How SerpApi is used**

- `src/lib/scout.ts` — weekly queries per river, **English and Urdu**
  (`کنہار رافٹنگ بند`, `سوات rafting`) with Pakistan geo-parameters
  (`gl=pk`, `hl=ur`) — because Pakistan's river knowledge lives in Urdu.
- **Budget ledger with a hard stop**: one DB row per *live* search,
  capped at 90/month (10 of the free 100 reserved); cache hits never
  spend. Re-running a cycle is free.
- **Extraction discipline**: a range candidate requires the digits *and*
  the unit in the same sentence; a **river-relevance gate** rejects
  claims that don't name the river (its Urdu name counts). The gate
  exists because the first cycle pulled Colorado guidebook quotes — the
  failure is kept as regression fixtures so it can't silently return.
- **Nothing auto-promotes**: candidates wait in an owner review path
  (`npm run range-candidates`); a range only becomes "verified" when a
  human promotes a quoted, dated source.

**Proof it works**

- Invariant S1 enforced by the DB *and* tested: a range/closure claim
  without a quote **cannot exist** (`tests/integration/scout.test.ts`).
- Real outcomes in the DB: 12 live searches total (under 14% of the
  monthly cap), 31 sourced notes including an Urdu-language operator page
  from rafting.com.pk.
- Live semantic recall over the harvest: ask the About-page search
  "Kaghan access" and get the sourced notes back (see §5).

**Judge's 60-second check**

```bash
npm run range-candidates   # human review report — no auto-promotion
grep -n "urduName" src/lib/rivers.ts
```

## 5. Tiger Data — Postgres + pgvector

**The product claim:** one Postgres holds the time series, the provenance
graph, the predictions — and the *rules* as executable constraints.

**How Tiger Data is used**

- `db/migrations/001_init.sql` — readings (17,204 rows, 2015→today × 4
  rivers), sources, predictions, summaries, notes — with the data
  dictionary's invariants written as **CHECK constraints**: a verified
  runnable range cannot exist without a linked source (`rivers_verified_complete`);
  a range/closure source cannot exist without its quote. The database
  *itself* refused an unproven range during development — the guardrail
  works without any app code running.
- **pgvector** with an HNSW index: every scout note is embedded locally
  (all-MiniLM-L6-v2, 384-dim — see §7) and searched by cosine distance;
  `GET /api/v1/search` serves it, and the About page puts a box on it.
- Free-tier sized: **16 MB of 256 MB** — years of headroom at current
  write rates ([cost-audit.md](cost-audit.md)).

**Proof it holds**

- `npm run test:db` spins a throwaway pgvector Postgres and runs **37
  invariant tests** — R1–R3 (range rules), T1, S1–S2 (scout integrity),
  P1–P2 (predictions) — green on every change, in CI.
- Semantic search is live end-to-end: fixture-vector tests assert nearest
  ordering, provenance fields on every hit, and exclusion of un-embedded
  rows (`tests/integration/search.test.ts`).

**Judge's 60-second check**

```bash
npm run test:db          # 37/37 against real Postgres + pgvector
grep -n "rivers_verified_complete" db/migrations/001_init.sql
```

## 6. Render — the whole product lives there

**The claim:** three services, free-tier discipline, real production
cycles.

- **`paddle-sense`** (web service, Node) — the Next.js app; DB-first
  pages with live-API fallback and honest source labels
- **`paddle-sense-predict`** (web service, Python) — the FastAPI + TabPFN
  service; `/v1/health` exposes the serving configuration (model version,
  context rows, torch threads) so anyone can check what's running
- **`paddle-sense-worker`** (background worker, Node) — the durable
  watcher in `WORKER_MODE=loop`; first production cycle ran end-to-end
  (readings stored, forecasts stored, Gemma summaries stored, scout cache
  hit 0 spends)

Deployment is boring on purpose: `main` auto-deploys; every change
arrives by PR with CI (lint, 121 unit/eval/workflow tests, 37 DB
invariants, Python 31, build) — the badge at the top of the README is the
same pipeline judges can re-run locally.

## 7. Why open — the Touch Grass fit

The theme asks for open-weight/open-source AI that gets people outside.
PaddleSense's open choices are load-bearing, not decorative:

- **Open-weight Gemma** does real work (§3) and is **swappable by env
  var** — no vendor lock on the language layer; the adapter's provider
  map is `PROVIDERS` in `src/lib/llm.ts`.
- **Open data** (Copernicus GloFAS via the free Open-Meteo Flood API) is
  the only data source — no proprietary feed, no API key for the core
  dashboard, validated against the public 2022 monsoon record.
- **Open-source embeddings run locally** (`@xenova/transformers`,
  all-MiniLM-L6-v2): semantic search with **no embedding API, no key, no
  quota** — a river club can adopt this with zero accounts.
- **$0 to run, audited**: `npm run cost-audit` reads the live DB and
  exits non-zero if any ceiling is crossed (12/90 searches, 16/256 MB,
  single-digit LLM calls/day). Open innovation here means a paddling club
  in Karachi can fork and run the whole thing for nothing.

## 8. The supporting cast

| Tech | Role | Where |
|---|---|---|
| Open-Meteo Flood API | GloFAS v4 discharge, free | `src/lib/flood.ts` |
| Next.js 16 / React 19 | App Router, PPR, blocking-dynamic dashboard | `src/app/` |
| FastAPI | stateless predict service | `services/predict/` |
| Resend | range-entry email (deterministic body — never the LLM sentence) | `src/lib/notify.ts` |
| Recharts | charts with data-table alternatives (a11y) | `src/app/_components/` |
| Playwright + axe-core | e2e, banned-word honesty sweep, zero-violation a11y gate | `tests/e2e/` |
| Vitest | unit + eval + integration + workflow suites | `tests/` |
| GitHub Actions | CI: lint, tests, build on every PR | `.github/workflows/ci.yml` |

## 9. Verify everything yourself

| Claim | Command | Expected |
|---|---|---|
| Workflow survives kills, no dup rows | `npm run test` | 121 passed incl. workflow suite |
| DB invariants | `npm run test:db` | 37 passed |
| LLM gates catch adversarial output | `npx vitest run tests/eval/llm.test.ts` | 36 passed |
| Prediction contract | `cd services/predict && python -m pytest` | 31 passed |
| UI honesty + a11y + smoke | `npm run test:e2e` | 29 passed, zero axe violations |
| Free-tier audit | `npm run cost-audit` | exit 0, all ceilings green |

Full gate runs with dates and raw outputs: [qa-report.md](qa-report.md).
