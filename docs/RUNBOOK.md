# PaddleSense — Runbook (debugging & operations)

| | |
|---|---|
| Purpose | Symptom → cause → fix, fast. If diagnosing a bug took > 15 minutes, its entry goes in here (TESTING.md §5) |
| Related | [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) §8 (degradation matrix) · [API.md](API.md) · [DATA_DICTIONARY.md](DATA_DICTIONARY.md) |

---

## 1. Local stack — start everything

```bash
# web app
npm run dev                          # http://localhost:3000

# temporal dev server (Phase 7+)  — no docker needed
temporal server start-dev            # UI: http://localhost:8233

# prediction service (Phase 4+)
cd services/predict && uvicorn app:app --port 8000 --reload

# psql into Tiger Data (or local throwaway)
psql "$DATABASE_URL"
```

Kill stuck node processes (Windows) — scoped PID only, never a blanket
`taskkill //F //IM node.exe` (it kills unrelated processes too):
`netstat -ano | grep :3000` → note the PID in the last column →
`taskkill //F //PID <pid>`.

---

## 2. Symptom → diagnosis → fix

### 2.1 Dashboard shows "No data" / stale levels

| Check | Command / where | Likely cause → fix |
|---|---|---|
| Is the API itself up? | `curl -s 'https://flood-api.open-meteo.com/v1/flood?latitude=34.88&longitude=72.88&daily=river_discharge&past_days=1&forecast_days=1'` | If this fails: provider outage → dashboard will show last stored cycle; nothing to do |
| What did we last store? | `SELECT river_id, max(date) FROM readings WHERE kind='observed' GROUP BY 1;` | Old by > 3 days → watcher didn't run → check Temporal UI (§3) |
| Any fetch errors logged? | cycle report (worker log) / Temporal activity failures | Fix per error message; re-run workflow (§4) |

### 2.2 Chart looks wrong (spikes, gaps, all-zero)

| Check | Command / where | Likely cause → fix |
|---|---|---|
| NULL vs 0 confusion | `SELECT date, discharge FROM readings WHERE river_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date;` | Malir legitimately reads ~0. If Indus is 0: wrong cell was queried → verify `rivers.cell_lat/lon` against `docs/deep-dive.md` §3 |
| Missing days | `SELECT date FROM readings WHERE river_id=$1 AND kind='observed' AND date BETWEEN $2 AND $3 AND discharge IS NULL;` | Provider gap → backfill repair (§4.3) |
| Cell drift (elevation mismatch) | compare `rivers.cell_elevation` vs API `elevation` in cycle log | Mismatch > 50 m → wrong cell snapped → re-run the Phase 0 sweep for that river |

### 2.3 Predict service errors (Phase 4)

| Symptom | Check | Fix |
|---|---|---|
| `/v1/health` says `"status":"degraded"` | body: `loaded`/token | `loaded:false` → tabpfn import failed (see next row); token unset → `X_INTERNAL_TOKEN` missing from env (service returns `503 service_misconfigured`) |
| `TabPFNLicenseError` / HuggingFace download error at first fit | service log | weights download blocked → check network; tabpfn must stay on the 2.x line (9.x demands a Prior Labs account) — see `services/predict/requirements.txt` comment |
| `400 invalid_history` | error `message` names the problem (gaps, unsorted, truth mismatch, window over history) | hidden window has null reading days → shrink `--days` or refresh readings (`npm run sync`) |
| Backtest takes minutes per river | expected: ~15 s × (7 horizons × ⌈days/7⌉ chunks) on CPU; context capped at 1,000 rows on purpose | don't raise the cap casually — inference grows ~quadratically (measured 2026-10-09: n=1000 ≈ 14 s, n=4300 ≈ 232 s per fit) |
| Connection refused on `npm run backtest` | `curl http://localhost:8000/v1/health` | service not running → start it (§1); port busy → another uvicorn holds 8000, kill it first |
| `pip install` fails on Python 3.13 | venv intact? | recreate: `cd services/predict && python -m venv .venv` then reinstall pinned requirements |

### 2.4 LLM summaries wrong or missing (Phase 6+)

| Symptom | Cause | Fix |
|---|---|---|
| Fallback template shows instead of Gemma sentence | provider error OR a validation gate fired | cycle summary `rivers[].error` names it (`validation: schema/numbers/status/banned` or the provider message); run the eval set (`tests/eval/llm.test.ts`) to reproduce. Re-running the cycle the same day retries only rivers with no stored row (observed live 2026-10-09: Swat failed the schema gate in cycle 1, stored on the cycle-2 retry) |
| Summary never appears for one river | thinking-token truncation (Gemma-4 emits `<thought>` blocks that count against `max_tokens`) | adapter sets `max_tokens: 2048` and a 90 s timeout (measured 15–75 s live); if truncation recurs, raise `max_tokens` in `src/lib/llm.ts` |
| Sentence contains a number not in the input | validation should have caught it → it didn't | **bug in validator**: add failing case to eval set, fix validator — this is a safety gate, treat as P0 |
| Sentence uses "cfs" or another foreign unit | model relabeled the m³/s value (observed live 2026-10-09, recorded as `tests/fixtures/gemma/gemma-fail-unit-relabel-20261009.json`) | unit-consistency check in gate 2 discards it → fallback; if a new unit slips through, same P0 protocol as above |
| Status word disagrees with badge | status_word ≠ computeStatus() | validator must catch; if not, same P0 protocol |
| All rivers fallback at once | `LLM_API_KEY`/`LLM_MODEL` unset or provider down | check env bindings; `chatSummary` errors surface in `rivers[].error` without the key |

### 2.5 SerpApi issues (Phase 5)

| Symptom | Check | Fix |
|---|---|---|
| Scout skipped / cycle stops early | cycle summary `budgetExhausted` (`POST /api/internal/scout`) | monthly cap (90) reached → wait for month reset; cache keeps repeat queries free |
| One query error `SerpApi search failed with status 503` | cycle summary `rivers[].errors` | transient provider error → re-run the cycle: the other queries are cache hits, only the failed one re-spends (observed live 2026-10-09) |
| US-river ranges stored as candidates | `npm run range-candidates` shows Colorado/Rio Grande/Tuolumne quotes | extraction without the river-relevance gate (P5-8) matched US guidebooks — gate added 2026-10-09; pre-gate rows deleted with owner approval the same day (guarded SQL, log in plans/phase-5-search) |
| Range claim without quote | `SELECT url FROM sources WHERE kind IN ('range','closure') AND quote IS NULL;` | must return 0 rows (invariant S1) — if not, extraction bug: fixture test, then fix |
| Same source re-scraped | `SELECT url, count(*) FROM sources GROUP BY 1 HAVING count(*) > 1;` | must be 0 — url is UNIQUE; check cache key hashing |

### 2.6 Temporal issues (Phase 7+)

| Symptom | Check | Fix |
|---|---|---|
| Cycles not firing | Temporal UI `localhost:8233` → schedules (`weekly-cycle`, Mondays 06:17 UTC) | worker recreates/refreshes the schedule at every boot — start the worker (`npm run start:worker`) and check its heartbeat line; trigger manually with `tools/temporal.exe schedule trigger --schedule-id weekly-cycle` |
| `npm run temporal:dev` fails with `'tools' is not recognized` | Windows cmd cannot exec the forward-slash script path | run the binary directly from bash: `./tools/temporal.exe server start-dev --db-filename .cache/temporal-dev.db --port 7233 --ui-port 8233` (observed 2026-10-11) |
| Temporal dev server won't boot / history errors | `.cache/temporal-dev.db` (SQLite) grew across sessions or corrupted on a crash | reset it — `rm .cache/temporal-dev.db` then `npm run temporal:dev`. The worker re-creates the schedule on next boot; idempotent activities make the next cycle a no-op |
| No email when a river enters range (adapter level) | Resend sender is `onboarding@resend.dev` by default | that sender delivers **only to the Resend account owner's email** — fine for v1's single-operator recipient (`NOTIFY_EMAIL_TO`), disclosed by design; a custom sender needs a verified domain in Resend (`NOTIFY_EMAIL_FROM`) |
| Worker exits at boot | log line `[worker] fatal: …` | boot gate: missing env (`DATABASE_URL`, `X_INTERNAL_TOKEN`, `PREDICT_URL`, `LLM_*`) or the DB is behind on migrations → run `npm run db:migrate`, set env, restart. A missing `NOTIFY_EMAIL_*` is a warning (nudge disabled), never fatal |
| Workflow stuck | UI → workflow → pending activities | failing activity → open its error; retries with backoff are visible in event history. Kill/Restarting the worker resumes it — proven live 2026-10-09 (worker killed mid-cycle, workflow completed on restart) |
| Render worker crash-loops with `node: .env: not found` | deploy log shows `start:worker` → crash → restart, repeating | Render has no `.env` file — env vars arrive as process env. Override the service start command to `npx tsx workers/worker.ts` (observed on the first production worker deploy, 2026-10-13; the same deploy also caught that the `WORKER_MODE=loop` code path had not been merged to `main` — merge before deploying the worker) |
| Duplicate rows after re-run | `SELECT river_id, date, kind, count(*) FROM readings GROUP BY 1,2,3 HAVING count(*) > 1;` | must be 0 (idempotency). Predictions: one forecast run per river per day (`predictRiver` skips when today's run exists — observed live, cycle 2); summaries one row per cycle_date; emails only when a fresh summary row was stored AND the status moved into range |
| No email when a river enters range | workflow report `emailsSent` | notify only fires on a fresh stored summary + a transition INTO `in_range`; with all ranges unverified the nudge is dormant by design. Adapter skip reasons land in the activity result (`no fresh summary this cycle` / `no transition into range`) |

### 2.7 Build/deploy issues

| Symptom | Fix |
|---|---|
| `cacheComponents` / prerender error at build | a route touches `Date`/live fetch without `await connection()` + `export const instant = false` — see dashboard page pattern |
| Port 3000 busy | another node holds it → `netstat -ano \| grep :3000`, then `taskkill //F //PID <pid>` (scoped kill — never blanket-kill node.exe) |
| Render deploy fails on build | check env vars present (TECHNICAL_ARCHITECTURE.md §7); build locally with `npm run build` first |
| LF/CRLF warnings on commit | cosmetic; leave as-is (no .gitattributes yet — add one only if diffs get noisy) |

---

## 3. Health checks (run when anything feels off)

```sql
-- freshness: observed data age per river (expect < 8 days)
SELECT river_id, max(date) AS newest, now()::date - max(date) AS age_days
FROM readings WHERE kind='observed' GROUP BY 1 ORDER BY age_days DESC;

-- coverage: expected daily rows vs actual (gaps)
SELECT river_id, count(*) FILTER (WHERE discharge IS NULL) AS nulls,
       count(*) AS rows
FROM readings WHERE kind='observed' GROUP BY 1;

-- prediction staleness (Phase 4+): newest forecast prediction per river
SELECT river_id, max(target_date) FROM predictions
WHERE kind='forecast' GROUP BY 1;

-- provenance integrity (S1): claims without quotes
SELECT count(*) FROM sources
WHERE kind IN ('range','closure') AND quote IS NULL;   -- must be 0

-- safety language guard (spot check): any stored summary with banned token
SELECT river_id, text FROM summaries                    -- table lands Phase 6
WHERE text ILIKE '%safe%';                              -- must be 0 rows
```

```bash
# service pings
curl -s http://localhost:8000/v1/health          # predict service
curl -s http://localhost:3000/api/v1/rivers | head -40
```

---

## 4. Operations

### 4.1 Force a cycle re-run (Phase 7+)
Temporal UI → workflow → signal/start new run with the same idempotent inputs. Safe by design: upserts make it a no-op if data is already stored.

### 4.2 Add a river
1. Sweep GloFAS cells (Phase 0 method) — validate against a known flood month
2. Add entry to `src/lib/rivers.ts` (id slug is permanent)
3. Backfill history for the new river
4. Range stays `unverified` until a quoted source lands
5. Update PRD §3 rivers table if scope officially grows

### 4.3 Backfill repair (gap in history)
```bash
npm run backfill -- --river indus-besham --from 2026-09-01 --to 2026-10-01
```
Idempotent; safe to re-run. Verify with §2.2 queries.

### 4.4 Rotate a leaked key
1. Revoke at provider
2. New key → `.env` locally, Render env in prod
3. `git log -S "<old key>"` to confirm it never touched git (it shouldn't — keys are env-only)

---

## 5. Failure drills (Phase 8 gate — rehearsed 2026-10-11, all PASS)

Evidence and exact commands: `docs/qa-report.md` §3.

| Drill | How | Expected result (degradation matrix) | Last rehearsed |
|---|---|---|---|
| Flood API down | `FLOOD_API_BASE=http://127.0.0.1:9 npm run dev` | dashboard serves last cycle with its date | 2026-10-11 PASS |
| DB unreachable | wrong `DATABASE_URL` | no 500; `/` falls back to live API; `/retro` degrades to error page | 2026-10-11 PASS |
| Gemma down | invalid `LLM_API_KEY` + `POST /api/internal/summarize` | fallback sentences; nothing stored | 2026-10-11 PASS |
| Predict service down | stop uvicorn (scoped PID) | `/retro` still renders stored rows | 2026-10-11 PASS |
| Worker killed mid-cycle | kill worker PID during run, restart | workflow resumes; duplicate-run leaves 0 dup rows | 2026-10-11 PASS |
