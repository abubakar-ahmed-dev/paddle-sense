# Phase 7 — Durable watcher (Temporal) — Phase Plan

Branch: `phase/7-watcher` (from `dev`) · Master plan ref: Phase 7 · Written: 2026-10-09

## Context check (repo state at re-planning)

- Phases 3–6 merged: every cycle step exists as an importable, idempotent
  lib call — `upsertReadings` (readings), `runScoutCycle` (scout, ledger
  cache), `insertPredictions` + `getLatestForecastRun` (predictions),
  `summarizeAll` (summaries, insert-if-missing), `computeStatus` (status).
  The watcher is pure orchestration over finished parts.
- `scripts/predict.mjs` shows the predict-service call shape
  (`POST {PREDICT_URL}/v1/predict`, `X-Internal-Token`, history + weather
  series; archive weather via `scripts/lib/weather.mjs` with `.cache/`).
- ARCH §3.6 fixes the workflow: weekly, per river — fetch → store → scout →
  predict → summarize → detect range-crossing → maybe notify. §3.7: email
  body = deterministic status + sources, **never the LLM sentence alone**.
- DEPLOYMENT.md pre-commits two Phase 7 deliverables: `npm run start:worker`
  and a boot check that refuses to start when `_migrations` is behind.
- RUNBOOK §2.6 expects: schedule visible in Temporal UI (localhost:8233),
  worker heartbeat, duplicate rows must stay at 0.
- Owner inputs: `NOTIFY_EMAIL_*` present in `.env` (Resend key provided
  2026-10-09 → email nudge is ON, single recipient). Temporal SDK confirmed:
  `@temporalio/{worker,workflow,client,testing}` 1.24.0, Node 22 local.
- Email reality check: all four rivers are `range_unverified` until a human
  verifies a range — the nudge is built and tested but **dormant** until
  Phase 5's owner review promotes a real range. Documented, not hidden.

## Decisions (P7-x, proposed — standing unless owner changes)

| # | Decision | Rationale |
|---|---|---|
| P7-1 | **TypeScript SDK end to end**: `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/client`, `@temporalio/testing` ^1.24; worker entry run via `tsx`; dev server = Temporal CLI binary (`temporal server start-dev` with a SQLite file under git-ignored `.cache/` so schedules survive dev restarts — catch-up is demonstrable) | ARCH §3.6 / D5; SDK bundles TS workflows itself, `tsx` is the only new dev dep; CLI binary is a dev machine download (git-ignored `tools/`), no Docker (constraint) |
| P7-2 | **One weekly schedule → `weeklyCycle` workflow** (schedule id `weekly-cycle`, Monday ~06:17 UTC); inside, river work is sequential per river (4 rivers ≈ minutes; rate-limit friendly), cycle-level steps (`runScoutCycle`, `summarizeAll`) run once | ARCH §4.1 heartbeat shape; scout/summarize libs are already all-rivers with their own caches; sequential keeps SerpApi/LLM free tiers happy |
| P7-3 | **Activities reuse the libs, zero logic duplicated**: `fetchAndStoreRiver` (flood.ts + upsertReadings), `runPredict` (predict-service call + `insertPredictions`), `scoutCycle` (`runScoutCycle`), `summarizeCycle` (`summarizeAll`), `notifyRiver` (new `src/lib/notify.ts`) | CLAUDE.md adapter rules; Phase 7 worker calling the lib is the pre-agreed contract (P5-1/P6-3) |
| P7-4 | **Idempotency = skip-if-done-today**, same pattern as summaries: `runPredict` skips when `getLatestForecastRun` was created today (a *new run* per forced cycle is history, but a re-executed schedule must not create one); readings upsert, scout cache and summaries insert-if-missing already dedupe | Master plan gate "double-run → no duplicate rows"; mirrors P6-7 |
| P7-5 | **Range-crossing + email**: pure `shouldNotify(previousStatusWord, currentStatusWord)` — true only on transition INTO `in_range`; the email body is the deterministic §6 fallback sentence + band + source links (ARCH §3.7: never the LLM sentence alone); one email per river per cycle (only when this cycle's summary row was freshly inserted, `stored === true`); Resend REST API via fetch in `src/lib/notify.ts` (fetcher injectable, key never in errors/logs); notify failure never fails the cycle | FR-9, NFR-6 (single operator recipient, env only); transition logic is deterministic and unit-testable; `stored=false` (cache/fallback) can never double-send |
| P7-6 | **Worker boot gate** (DEPLOYMENT.md contract): before connecting, check `_migrations` covers every file in `db/migrations/`, and required env is present (`DATABASE_URL`, `X_INTERNAL_TOKEN`, `PREDICT_URL`, `LLM_*`; `NOTIFY_EMAIL_*` optional → nudge disabled with a loud log line if absent); heartbeat log each cycle; `npm run start:worker` | Pre-committed in DEPLOYMENT.md; worker refusing to boot stale beats silently writing bad rows |
| P7-7 | **Production hosting = an explicit D5 addendum, not a new decision**: Temporal is the dev/test orchestration truth; the Render free-tier worker will be *measured* at Phase 9 (server-on-worker vs the documented durable-loop fallback — same activities, same idempotency, wrapper swap only). The addendum is written in TECHNICAL_ARCHITECTURE §6 this phase; no code path forks on it yet | Master plan: "decided in Phase 7 with a documented ADR" — we record the decision framework + measurement plan now, the empirical choice lands at Phase 9 boot |
| P7-8 | **Tests per TESTING.md**: workflow tests in `tests/workflows/watcher.test.ts` via `@temporalio/testing` time-skipping env (no server in CI): injected activity failure → retries with backoff → workflow completes; double execution → no duplicate rows (integration assert); unit tests for `shouldNotify` + notify template (fake fetcher); live run validates schedule + UI + real email | Pre-committed gate; CI needs no Temporal server (TESTING §1 fixtures-not-network) |

## Tasks (ordered)

1. **Branch + plan + logs** (this); Resend row ✅ in `needs-and-requirements.md`
2. **Deps + dev server**: `npm i -D` the four `@temporalio/*` packages (deps actually: worker/workflow/client are prod deps — worker runs in prod later; testing + tsx dev) + download Temporal CLI binary to git-ignored `tools/` (`.gitignore` update), `npm run temporal:dev` script (SQLite-persisted dev server + UI :8233)
3. **`src/lib/notify.ts`** — Resend adapter + `shouldNotify` + email template (deterministic sentence, band, source links); unit tests (fake fetcher)
4. **`workers/`** — `activities.ts` (thin lib wrappers incl. predict-service call + skip-if-done-today), `workflows.ts` (`weeklyCycle`), `worker.ts` (boot gate: migrations + env, heartbeat, task queue `paddle-sense`), schedules setup script (`workers/schedule.mjs` or CLI)
5. **Tests** — `tests/workflows/watcher.test.ts` (retry + completion under injected failure; idempotency double-run against Docker Postgres), unit notify tests; TESTING.md map already lists this row
6. **Live validation** — dev server + worker locally: trigger one full cycle (temporal CLI), verify readings/predictions/summaries rows + scout budget + a real Resend email to the owner address (nudge is dormant for in_range — simulate with a temporary verified-range config in the TEST DB only, or assert template path via unit tests + log line live); catch-up: kill worker mid-cycle, restart, watch resume; screenshots/log excerpts into logs
7. **Docs + logs + PR** — ARCH §6 D5 addendum (production measurement plan), RUNBOOK §2.6 verified rows, DEPLOYMENT `start:worker` confirmed real, README status row, master plan marker; `npm run verify` + `npm run test:db` green; PR → `dev`

## Test list (gate)

- Unit: `shouldNotify` truth table (dry→in_range true, in_range→in_range false, *→high_water false, fallback rows false); email template carries deterministic sentence + sources and never the raw LLM sentence; notify adapter (2xx stored, non-2xx retried-then-skipped, key redaction)
- Workflow (time-skipping env): activity throws → retries (backoff visible) → completes; happy path completes with all activities called once per contract
- Integration (Docker): double `weeklyCycle` execution same day → readings count unchanged, one prediction run (not two), summaries/notes/scout unchanged; boot gate refuses when migrations table is behind
- Live: one scheduled cycle observed end-to-end in dev server + UI; forced kill mid-run resumes; email delivered (or loud dormant-log proof)
- `npm run verify` green; `npm run test:db` green

## Acceptance (exit criteria)

A forced kill mid-run resumes correctly; a full cycle executes end-to-end on schedule (dev server + UI evidence); worker deployable (`start:worker` + boot gate); double-run adds no duplicate rows; email path proven (delivery or documented dormant state).

## Risks

| Risk | Mitigation |
|---|---|
| Temporal CLI binary download on Windows (no Docker/choco assumption) | direct GitHub release zip → git-ignored `tools/`; documented fallback: `go install` if owner has Go (not assumed) |
| TS SDK native core (Rust/napi) on Windows | supported platform for 1.24; verify first task before building everything (task 2 smoke) |
| Resend free tier requires verified domain for arbitrary senders | use Resend's default onboarding sender to the owner address; if undeliverable, fall back to Gmail SMTP (env-swapped `NOTIFY_EMAIL_PROVIDER`) — adapter already provider-shaped |
| Render free worker RAM vs Temporal server | P7-7: measured at Phase 9; durable-loop fallback is the documented escape hatch, same activities |
| Nudge dormant (no verified ranges yet) | tested via unit + test-DB simulation; live log line proves the decision path honestly |
| predict-service must be running for cycles | activity failure → retry → skip pattern: predict failure marks river failed, rest of cycle continues (isolation like scout/summarize) |

## Out of scope (later phases)

Render deployment + the empirical D5 choice (9) · ElevenLabs audio (P2 stretch, 9 decision) · embeddings retrieval for prompts (P3-4 deferral) · multi-recipient/opt-in UI (v1 = single env recipient)
