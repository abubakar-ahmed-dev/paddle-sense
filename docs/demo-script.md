# Demo script — how to capture the submission assets

Manufactured deliberately (P75-13) instead of improvised at submission
time. Each asset lists: goal · setup · shots · talking point.

Everything runs locally: `npm run dev` (site) · `npm run temporal:dev` +
`npm run start:worker` (watcher) · predict service up for cycles.

---

## 1. The money shot: a verified river, end to end (~20 s GIF)

Kunhar is verified (35–135 m³/s, owner decision 2026-10-11). Today's flow
(~51 m³/s) is **inside** the range.

- **Dashboard** (`/`): Kunhar card shows `In runnable range`, the shaded
  band sits on the chart, the dashed last-year line runs underneath, the
  Gemma sentence names the range.
- **River page**: band + dashed line + season strip; sourced notes below;
  provenance footer with cell + date.
- **Talking point:** "one honest sentence, every number traceable, and the
  range is there only because a human verified a quote — the system never
  invented it."

## 2. Retrodiction reveal — the trust scene (~15 s)

- `/retro`: per-river coverage + MAE, the **forecast-decay line** (day-1
  vs day-7), band-vs-actual charts, miss table.
- Scroll the miss table on purpose. Misses are visible by design.
- **Talking point:** "we publish the misses; coverage 82–96% on hidden
  autumn weeks; day-1 is sharp, day-7 is a window — so we re-predict weekly."

## 3. Temporal catch-up — the durability scene (~60 s GIF)

1. Start dev server + worker; show the UI (`localhost:8233`) → schedule
   `weekly-cycle` exists.
2. Trigger: `tools/temporal.exe schedule trigger --schedule-id weekly-cycle`.
3. ~20 s in, kill the worker (`taskkill //F //PID <pid>` — scoped).
4. Point at the workflow stuck `Running` in the UI.
5. Restart the worker. Workflow completes.
6. Show the second same-day trigger doing nothing (cache; predict skipped).
- **Talking point:** "killed mid-cycle; Temporal resumed it; re-runs are
  idempotent — zero duplicate rows, zero double emails."

## 4. Guardrails scene — the model misbehaves on camera (~15 s)

- `tests/fixtures/gemma/gemma-fail-unit-relabel-20261009.json`: the real
  recorded response where the model said "1632 cfs" (digits honest, unit a
  16× lie) — validator caught it, fallback rendered.
- Show the dashboard fallback line (deterministic §6 sentence) vs a Gemma
  sentence — indistinguishable in placement, different in provenance line.
- **Talking point:** "the LLM summarizes; it never decides status, never
  invents numbers — and when it lies, we don't ship its sentence."

## 5. Semantic search — the Tiger Data scene (~15 s)

- `/about#notes-search`: query "Kaghan access" → top hits with sources +
  dates; each note embedded locally (MiniLM, 384-dim), pgvector HNSW.
- **Talking point:** "17k+ readings, invariant-as-CHECK constraints, and a
  vector index over everything the scout found — all on the free tier."

## 6. Urdu scouting — the local-knowledge scene (~10 s)

- Show `tests/fixtures/serpapi/serpapi-urdu-closure-query-20261010.json`
  (the real کنہار query) and the Kunhar notes it produced — including
  rafting.com.pk, a real operator.
- **Talking point:** "Pakistani rivers are written about in Urdu; we scout
  in Urdu too."

## Post-content notes (draft material for the dev.to write-up)

- **Ops facts (B4):** 17,196 readings back to 2015; scout ledger
  dedupes by (month, query-hash) with a hard 90/month cap; invariants R1–R3,
  T1, S1–S2, P1–P2 are literal CHECK constraints tested against real
  Postgres; SM1 keeps banned tokens out of stored summaries.
- **Self-caught failures (B7):** the first live scout stored US-river
  ranges for Pakistani rivers — the relevance gate was born from that
  failure, and the failing responses are permanent fixtures that replay in
  CI. Same story for the "1632 cfs" relabel.
- **Free-tier math:** Open-Meteo (no key) · SerpApi 100/mo (cap 90) ·
  AI Studio free Gemma (~4 summaries/week + evals) · Tiger Data free ·
  Resend free (single recipient) · Render free.
