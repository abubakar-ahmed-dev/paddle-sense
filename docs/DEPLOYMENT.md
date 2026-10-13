# PaddleSense — Deployment Guide

| | |
|---|---|
| Scope | Hosting topology, first-deploy checklist, migrations, verification, rollback |
| Host | Render free tier (web service + background worker + predict service) |
| Related | [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) §7 (env vars) · [RUNBOOK.md](RUNBOOK.md) |

---

## 1. Topology

| Service | Type on Render | Runs | Phase |
|---|---|---|---|
| `paddle-sense-web` | Web service (Node) | Next.js app | 1 |
| `paddle-sense-worker` | Background worker (Node) | Temporal worker + cycle activities | 7 |
| `paddle-sense-predict` | Web service (Python/Docker) | FastAPI + TabPFN | 4 |
| Tiger Data | managed Postgres (external) | database | 3 |

Free-tier notes: web services sleep after inactivity (first request wakes them, ~30 s); workers do not sleep; accept cold starts on the public URL — they are disclosed, not hidden.

## 2. Environment variables

Mirrors `.env.example` (names are the contract — see [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) §7). Set in Render dashboard per service, never in the repo.

| Var | Web | Worker | Predict |
|---|---|---|---|
| `DATABASE_URL` | ✅ | ✅ | — |
| `SERPAPI_KEY` | — | ✅ | — |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` | — | ✅ | — |
| `X_INTERNAL_TOKEN` | — | ✅ | ✅ |
| `WORKER_MODE` | — | ✅ (`loop` in production) | — |
| `TEMPORAL_ADDRESS` | — | dev only | — |
| `NOTIFY_EMAIL_*` | — | ✅ | — |
| `PREDICT_CONTEXT_ROWS` (optional) | — | — | leave unset (= 500, the published setting); lower only if the free-tier OOM recurs — then re-run the backtest and republish metrics |
| `SENTRY_DSN` (optional) | ✅ | ✅ | — |

## 3. First deploy checklist (per service)

1. Render → New → connect the GitHub repo (`paddle-sense`), branch `main` (auto-deploy on)
2. Build command `npm ci && npm run build` · start `npm run start` (web) / `npx tsx workers/worker.ts` (worker — see the env-file note below) / `pip install -r requirements.txt` + `uvicorn app:app --host 0.0.0.0 --port $PORT` (predict, Root Directory `services/predict`)
3. Paste env vars for that service (table above); the worker also needs `WORKER_MODE=loop`
4. First boot: check logs for the health line (`Ready in …` web / worker heartbeat)
5. Open the URL — dashboard must show river cards (web) / one clean cycle (worker)

**Worker env-file note (live catch, 2026-10-13):** `npm run start:worker`
runs `tsx --env-file=.env`, but Render injects env vars as process env —
there is no `.env` file, and the worker crash-loops with `node: .env: not
found`. On Render, override the start command to `npx tsx
workers/worker.ts` (env comes from the dashboard bindings instead).

## 4. Database migrations

- Migrations are plain SQL files: `db/migrations/NNN_name.sql`, applied oldest-first by `npm run db:migrate` (a 40-line runner: list files, apply unapplied in one transaction each, record in `_migrations(name, applied_at)`)
- Rules: forward-only; every migration is idempotent-safe to run once; destructive changes require a line in the commit message saying what is lost and why it is acceptable
- Apply order on deploy: **migrate → deploy app**. The worker refuses to start if `_migrations` is behind the app's expected version (checked at boot, Phase 7)

## 5. Post-deploy verification (every deploy)

```bash
BASE=https://paddle-sense.onrender.com
curl -s  "$BASE/api/v1/rivers" | head -20         # rivers list, provenance fields present
curl -s  "$BASE/api/v1/rivers/indus-besham/status" # status computed, summary or fallback
```

Then eyeball: `/` cards render · `/retro` (Phase 4+) renders stored metrics · dates are recent · Malir still says "not a paddling river".

## 6. Rollback

1. Render → service → **Rollback** to previous deploy (minutes)
2. DB is forward-only: if a migration caused it, apply the documented down-path script for that migration (`db/migrations/NNN_name.down.sql` — optional, only written when a phase actually needs one)
3. Never roll code forward past a bad migration; fix data first, then code

## 7. Monitoring

- Phase 9: uptime ping on `/` (Render cron or UptimeRobot free) + optional Sentry for errors
- Weekly self-check (operator habit): RUNBOOK §3 health queries — 2 minutes, catches staleness before users do

## 8. Cost guardrails

| Service | Free limit | Alarm sign | Response |
|---|---|---|---|
| Render web | 750 h/mo instances | extra instance spun up | single service only; no autoscaling |
| SerpApi | 100 searches/mo | budget meter > 90 | scout stops (hard stop); wait for reset |
| Tiger Data | 500 MB | size query (DATA_DICTIONARY §10) | years away; prune policy documented |
| Gemma provider | daily quota | validation-fallback rate rising | lower cadence; provider swap is one env var |
