# Phase 6 — Implementation Log

Append-only by date. Updated whenever any phase file is created or changed.

## 2026-10-09

- Phase 5 merged (PR #4, merge commit `87d6270`); master plan marker updated
  on `dev` (`7ba40c5`).
- Created branch `phase/6-llm` + `plan.md`.
- Key decisions recorded (P6-1…P6-8): provider-swappable adapter in
  `src/lib/llm.ts` (env: LLM_PROVIDER/LLM_API_KEY/LLM_MODEL); JSON by prompt
  + tolerant parse (response_format only where supported); token-protected
  `POST /api/internal/summarize` for manual cycles (P5-1 precedent — Phase 7
  worker calls the lib); input = structured JSON snapshot with band source
  labeled (newest TabPFN forecast run preferred, GloFAS week-band fallback);
  4-gate validation chain with discard→fallback; UX_SPEC §6 fallback
  templates verbatim; one row per river per cycle_date (insert-if-missing);
  eval set (~50 states, ≥95%, 100% catch on banned/invented) + forced-failure
  fallback proof; latency/tokens logged at live run.
- Pending from owner: `LLM_API_KEY` (Google AI Studio unless owner prefers
  Groq/Together) — `plans/needs-and-requirements.md` Phase 6 ⬜ pending.
  Build proceeds fixture-first; live validation + first cycle are the last
  tasks and need the key.

## 2026-10-09 (implementation, after owner provided the AI Studio key)

Owner provided `LLM_API_KEY` (Google AI Studio) plus two candidate model
names: `gemma-4-26b-a4b-it` and `gemma-4-31b-it`. Implemented per plan.

- **DB (`src/lib/db.ts`)** — `insertSummaryIfMissing` (NOT EXISTS guard on
  `(river_id, cycle_date)`; no UNIQUE constraint existed in 001_init, so the
  guard mirrors `insertNoteIfMissing`), `getLatestSummary` (newest cycle),
  `getLatestForecastRun` (newest `kind='forecast'` run collapsed to a week
  envelope: min band_lo / max band_high).
- **`src/lib/llm.ts`** — adapter + validator + fallback + cycle, all in one
  module per API.md §3.4 ("validation in `lib/llm.ts`"):
  - Provider map google/groq/together (OpenAI-compatible `/chat/completions`);
    key only in the Authorization header, never in error messages; fetcher
    injectable; timeout default 90 s (thinking models are slow — measured).
  - Single-turn prompt (instructions + JSON snapshot in one user message):
    Gemma via the OpenAI-compat endpoint is most reliable without a system
    role, and P6-2 wants prompt-side JSON anyway.
  - `validateSummary` gates: schema → numerals ⊆ input snapshot (comma-
    normalized) → `status_word === computeStatus()` → banned tokens.
  - `fallbackSentence` — UX_SPEC §6 templates verbatim; the `**Do not go.**`
    markdown emphasis in the spec is rendered as the plain sentence text
    (stored text carries no markdown markers).
  - `buildSummaryInput` — display-rounded numbers (§3 formats) so the model
    copies exactly what the UI shows; TabPFN forecast-run band preferred with
    its source labeled; ≤ 5 newest access/closure notes.
  - `summarizeRiver`/`summarizeAll` — cache-before-call (stored row for the
    cycle date ⇒ zero LLM spend), per-river isolation, nothing stored on any
    failure (v1 renders the template client-side, P6-6).
- **`POST /api/internal/summarize`** (`src/app/api/internal/summarize/route.ts`)
  — mirror of the scout route: 401 `X-Internal-Token`, per-river results,
  500 `summarize_failed` only for whole-cycle crashes.
- **Dashboard** — `SummarySentence` component (UX_SPEC §4.1 item 4 + §5);
  `page.tsx` reads `getLatestSummary` (DB failure ⇒ fallback silently —
  states matrix §7) and renders `summary · {generatedBy} · cycle {date}`
  provenance only for model sentences.
- **Tests** — unit (validator gates incl. comma numerals + thought-block
  parsing, §6 fallbacks verbatim, adapter fixture replay, §3 formatting),
  eval (15 synthetic states × 2 sentence variants = 30 legit runs, 100%
  pass; 15 adversarial cases, 100% caught; recorded-fixture replay),
  integration (insert-if-missing idempotent, newest-per-river read, forecast
  envelope, cache-before-call with zero extra LLM calls, provider failure ⇒
  §6 fallback stored nothing, banned output discarded (SM1), invented number
  discarded, route 401 shape).
- **Test-infra fix (pre-existing race exposed):** the 4 integration files
  share one throwaway Postgres; they ran in parallel and `predictions.test`
  malir rows raced `db.test`'s `newestObservedDate` max assertion (my added
  file shifted the timing). `vitest.config.ts` now sets
  `fileParallelism: false` with a comment — deterministic, negligible cost
  at this suite size.

### Live findings (owner-provided key, 2026-10-09)

- **Model choice:** probed both owner-suggested models with the real
  summarizer prompt. `gemma-4-31b-it`: complete answer but ~36 s and 59
  completion tokens; `gemma-4-26b-a4b-it`: complete answer ~15–25 s, same
  validated quality. **Chose `gemma-4-26b-a4b-it`** (MoE speed); `LLM_MODEL`
  set in `.env` (value not committed).
- **Gemma-4 thinking blocks:** the models emit `<thought>…</thought>`
  blocks that cannot be disabled (`reasoning_effort` → HTTP 400 "Thinking
  budget is not supported for this model"; `generationConfig.thinkingConfig`
  → unknown field). Two consequences, both handled:
  1. tokens: thoughts count against `max_tokens` — early probes truncated at
     200/1024. Adapter now sends `max_tokens: 2048` (measured thought+answer
     ≈ 400–700).
  2. parsing: `parseModelJson` strips `<thought>` blocks (and code fences),
     then brace-scans left-to-right; a fragment that still parses (e.g. a
     nested band object from truncated thought text) fails the schema gate —
     safe by construction.
- **Validator extension (real failure, bug protocol):** under simulated user
  pressure ("also state the discharge in cfs"), Gemma once produced
  `"The discharge is 1632 cfs."` — digits honest, unit a 16× lie; the
  contracted numeral gate passes it. Gate 2 now also rejects foreign units
  (`cfs`/`cubic feet`/`ft³`); the real response is recorded as
  `tests/fixtures/gemma/gemma-fail-unit-relabel-20261009.json` (eval replays
  it). Known limit, documented: the gate checks units we name, not every
  conceivable mislabel.
- **Fixtures recorded live** (TESTING.md §4 shape): `gemma-pass-indus-
  unverified-20261009.json` (honest pass) + `gemma-fail-unit-relabel-
  20261009.json`, each with `{url (key redacted), fetched_at, note}` metas
  including live latency/token counts.
- **First cycle (2026-10-09, `POST /api/internal/summarize`, 142 s total):**
  Indus 23.3 s (466/54 tok) ✓ stored · Kunhar 41.1 s (668/43) ✓ stored ·
  Malir 20.9 s (404/51) ✓ stored · **Swat failed the schema gate** (thinking
  truncation; tokens unreported) → §6 fallback rendered, nothing stored —
  the degradation path proven with a real provider, not a mock.
- **Second cycle same day:** Indus/Kunhar/Malir served from cache (0 tokens,
  no LLM latency) — P6-7 idempotency proven live; Swat had no stored row, so
  only it re-spent: 22.5 s (492/60) ✓ stored. Dashboard then shows 4 model
  sentences + provenance lines.
- Latency/token accounting for the eval gate: ~15 live Gemma calls today
  (2 probes ×3, fixture retries, 2 cycles) — trivial against the AI Studio
  free tier; steady-state cost stays ≤ 4 summaries/week + eval replays
  (offline).
- Temp scripts (`.probe-llm.mjs`, `.record-fixtures.mjs`) used for probing
  and fixture recording were deleted after use; never committed.
- Deviation from plan task list: none material. Parser hardening (thought
  blocks) and the unit-consistency check are additions inside P6-5's gate 2,
  both bug-protocol driven with recorded evidence.
