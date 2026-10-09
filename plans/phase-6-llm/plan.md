# Phase 6 — Plain-language layer (hosted Gemma) — Phase Plan

Branch: `phase/6-llm` (from `dev`) · Master plan ref: Phase 6 · Written: 2026-10-09

## Context check (repo state at re-planning)

- Phases 3–5 merged: `readings` (17k+), `predictions` (4 backtest + 4
  forecast runs), `summaries` table exists and is **empty** (schema from
  001_init), `sources`/`notes` hold 22 genuine scout rows
- Dashboard (`src/app/page.tsx`) renders no summary sentence yet — UX_SPEC
  §4.1 item 4 says the card carries one; fallback comes from status + band
- `computeStatus()` + StatusBadge are done and tested (Phase 2); UX_SPEC §6
  fallback templates are verbatim-ready
- No `src/lib/llm.ts`, no LLM code anywhere; `.env.example` documents
  `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` (default gemma-3-27b-it)
- Contract already fixed: docs/API.md §3.4 (OpenAI-compatible
  chat/completions, `{sentence, status_word, confidence}`, banned tokens,
  post-hoc validation in `lib/llm.ts`), DATA_DICTIONARY §5b + §9.3
  (summaries + validation mapping), ARCH §3.5/§8 (adapter, fallback,
  degradation), D4/D6 (hosted Gemma; LLM never decides status)
- **Blocked on owner: `LLM_API_KEY` (Google AI Studio unless owner prefers
  Groq/Together)** — `needs-and-requirements.md` Phase 6 ⬜ pending. Build
  proceeds fixture-first; live eval + first cycle are the last tasks.
- Week-band input: dashboard uses GloFAS `weekBand()` today; Phase 4's
  TabPFN forecast rows exist in `predictions` (kind='forecast'). The
  summarizer input should prefer the newest stored TabPFN band and label its
  source (honest provenance for the numbers the model may reference).

## Decisions (P6-x, proposed — standing unless owner changes)

| # | Decision | Rationale |
|---|---|---|
| P6-1 | Provider adapter in **`src/lib/llm.ts`**: env-swappable provider map (`LLM_PROVIDER` ∈ google \| groq \| together → {baseUrl, default model}), OpenAI-compatible `chat/completions`, fetcher injectable for tests, API key never appears in error messages | ARCH §3.5 / D4; the open-weight-swappable story is one config file; fixture-injectable = no live calls in CI (TESTING §1) |
| P6-2 | **JSON by prompt, not by `response_format`**: schema-constrained system prompt + tolerant parse (strip code fences) — `response_format` used only when the provider map says it supports it | Gemma via AI Studio's OpenAI-compat endpoint may not honor `response_format`; prompt-side constraint + runtime validation is the safety net anyway (§9.3) |
| P6-3 | Summarizer cycle = **`POST /api/internal/summarize`** (token-protected, same `X-Internal-Token` pattern as scout) calling `summarizeAll()` from the lib; Phase 7 worker calls the lib in-process | P5-1 precedent: one implementation, no duplicate .mjs twin; manual trigger until the worker exists |
| P6-4 | Summary **input = structured JSON snapshot** per river: {name, level m³/s, band {lo, high} + bandSource ("tabpfn-v1… newest forecast run" preferred, GloFAS week band fallback), rangeState + runnable range, status word (from `computeStatus()`), up to 5 newest access/closure notes (text only), cycle date} | API.md §2.3 shape; the model may only reference provided values — so the input defines its allowed number universe; notes give the sentence local color (closures) without inventing facts |
| P6-5 | **Validation chain (post-response, in lib/llm.ts):** JSON schema parse → every numeral in `sentence` must exist in the input JSON (comma-normalized compare) → `status_word === computeStatus()` result → banned tokens (`safe`, `safely`, `danger-free`, `guaranteed`) absent → else **discard, store nothing from the model, render fallback** | PRD FR-8, DATA_DICTIONARY §9.3, SM1/SM2; validation failure is a safety gate (RUNBOOK §2.4 treats misses as P0) |
| P6-6 | **Fallback templates verbatim from UX_SPEC §6**, rendered when the model failed OR when no summary exists for the cycle — silently (states matrix §7), never an error card | "Site never depends on the model" (ARCH §3.5); fallback is also `generated_by='fallback'` rows only when stored — v1 stores nothing on failure and renders fallback client-side |
| P6-7 | **Caching:** one `summaries` row per river per cycle_date; insert-if-missing (re-running a cycle the same day is a no-op); dashboard reads newest row per river; request path never calls the LLM | DATA_DICTIONARY §5b, ARCH §10 cost math (≤ 4 summaries/week + eval) |
| P6-8 | **Eval set = tests/eval/llm.test.ts**: ~50 synthetic river-states × validation gates (no safe, no invented numbers, correct status word) run against recorded real outputs + adversarial fakes; forced provider failure proves the fallback path; latency + token usage logged in testing-logs during the live run | TESTING §2 row + §6 gate (≥ 95% pass, fallback proven); eval fixtures are committed so CI never needs the network |

## Tasks (ordered)

1. **Branch + plan + logs** (this); `LLM_API_KEY` reminder to owner (build not blocked; live tasks are)
2. **Adapter** — `src/lib/llm.ts`: provider map + `chatSummary(input)` (fetcher injectable, timeout, tolerant JSON parse); provider parity kept behind one interface
3. **Prompt + input builder** — `buildSummaryInput()` (db reads: newest forecast run, newest notes) + system prompt encoding the §3.4 contract
4. **Validator + fallback** — `validateSummary()` (P6-5 chain, pure), `fallbackSentence()` (UX_SPEC §6 templates, pure); unit tests for both
5. **DB** — `insertSummaryIfMissing`, `getLatestSummary(riverId)` in `src/lib/db.ts` (+ .mjs twin only if a script needs it — none planned)
6. **Cycle runner** — `POST /api/internal/summarize` (token auth; per-river result {generatedBy, validated, latencyMs, stored|fallback}; 401 shape per §0)
7. **Dashboard** — card item 4: cached sentence + provenance (`generated_by · cycle date`); absent → fallback silently; river detail page untouched (UX_SPEC scopes summaries to the dashboard card)
8. **Eval set** — `tests/eval/llm.test.ts`: gate matrix over synthetic states + adversarial outputs (invented number, wrong status word, "safe", malformed JSON, code-fenced JSON) — all must be caught
9. **Live validation** — record 2–3 real Gemma outputs as fixtures (pass case + each failure case) under `tests/fixtures/gemma/` with §4 metas; eval replays them; forced-fetch-failure test proves fallback
10. **First cycle + metrics** — run `POST /api/internal/summarize` live (4 rivers), record latency/tokens in testing-logs; dashboard shows sentences
11. **Docs + logs + PR** — API.md §2.6 (internal summarize route), RUNBOOK §2.4 verified against reality, TESTING §3 commands, README status row, master plan marker; `npm run verify` + Docker suite green; PR → `dev`

## Test list (gate)

- Unit: validator (each gate fires on its adversarial case; pass-through on valid), fallback templates (all §6 statuses verbatim), input builder (band source preference, notes cap)
- Adapter: fixture-replay (no live calls), timeout → error, tolerant JSON parse (fenced output)
- Integration (Docker): insert-if-missing idempotent; getLatestSummary newest-per-river; summarize route 401 shape; SM1 (no banned token stored) asserted on stored rows
- Eval: ≥ 95% of ~50 states pass all gates; failure cases 100% caught; fallback proven by forced provider failure
- `npm run verify` green; Docker suite green

## Acceptance (exit criteria)

Dashboard shows Gemma sentences on all 4 rivers with provenance (`generated_by`, cycle date); eval set ≥ 95% with 100% catch on banned/invented; fallback proven by forced API failure; no LLM call in the request path (code inspection + architecture); cost/latency recorded.

## Risks

| Risk | Mitigation |
|---|---|
| Gemma on AI Studio OpenAI-compat endpoint: availability/quota unknown | Provider map makes Groq/Together a one-env-var switch; measured at live validation; owner decision point if blocked |
| Model emits "safe" or invents numbers | Validation chain discards → fallback; eval gate 100% catch requirement; RUNBOOK P0 protocol |
| Comma-formatted numbers ("1,632") vs input ("1632") false-positive validation | Numeral normalization (strip commas) on both sides before compare; adversarial eval case |
| Free-tier rate limits mid-cycle | Per-river isolation: one river's failure = its fallback only; retry is a cache-free re-run next cycle |
| `summaries` grows unbounded | 4 rows/week ≈ trivial vs 500 MB; retention rule already documented (§10) |

## Out of scope (later phases)

Weekly scheduling + retries (7 — worker calls `summarizeAll()` directly) · notification email body (7) · ElevenLabs audio (P2 stretch, Phase 9 decision) · embeddings for prompt-context retrieval (P3-4 deferral)
