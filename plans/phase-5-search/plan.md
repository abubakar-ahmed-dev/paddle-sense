# Phase 5 — Live search & runnable ranges (SerpApi) — Phase Plan

Branch: `phase/5-search` (from `dev`) · Master plan ref: Phase 5 · Written: 2026-10-09

## Context check (repo state at re-planning)

- Phase 4 merged (PR #3): predict service live, `/retro` live with published
  metrics, `predictions` populated (4 backtest runs + 4 forecast runs),
  `npm run verify` + Docker integration (12/12) + pytest (31/31) green
- `sources` and `notes` tables exist and are **empty**; invariant S1
  (range/closure rows require a verbatim quote) is a DB CHECK already
- River detail page renders the amber "Runnable range not yet verified" note
  (`range_state = 'unverified'` for Indus/Kunhar/Swat; Malir =
  `not_a_paddling_river`); the chart's range-band overlay exists in UX_SPEC
  §4.2 but is unwired (no verified river yet)
- No SerpApi code anywhere; no `lib/scout.ts`
- **Blocked on owner: `SERPAPI_KEY` (SerpApi free plan, 100 searches/month)** —
  `needs-and-requirements.md` Phase 5, still ⬜ pending. Build proceeds;
  the live pull is the last task.
- SerpApi contract already fixed: docs/API.md §3.3 (3 query templates per
  river, keep `organic_results[].{link,title,snippet,date}`, snippet stored
  verbatim as the required quote)

## Decisions (P5-x, proposed — standing unless owner changes)

| # | Decision | Rationale |
|---|---|---|
| P5-1 | Scout logic lives in **`src/lib/scout.ts`** (TypeScript) — SerpApi adapter, extraction, budget meter; orchestration via a token-protected internal route `POST /api/internal/scout` | Extraction is consumed by the Phase 7 worker as TS — a `.mjs` twin would duplicate core logic (the P4 split existed only because TabPFN is Python). Manual trigger until the worker exists; `X-Internal-Token` auth matches the predict-service pattern; no public API is added |
| P5-2 | Budget meter hard-stops at **90 searches/month** (10 reserved for in-season manual checks), counted from a `scout_queries` ledger — query-hash cached so identical queries in the same month cost 1 | API.md §3.3 verbatim (stop at 90); the ledger is one tiny table + migration `002_scout_ledger.sql`; cache key = sha256(normalized query) + month |
| P5-3 | Search results cached whole in the ledger row (`results jsonb`); **extraction re-runs on cache, never on live responses in tests** | Fixtures-only CI (TESTING.md §1); a re-extraction pass improves without re-spending budget |
| P5-4 | Range candidates are **stored, never auto-applied**: extraction writes `sources` (kind=`range`, quote verbatim, S1 holds) + `notes` rows; a river's `range_state` flips to `verified` **only** via a deliberate seed/config change the owner approves | "Credible source" is a human judgment (PRD risk table: range data quality); the app never self-promotes a safety-relevant range. `scripts/rivers.json` + `src/lib/rivers.ts` stay the single source of truth (parity test already enforces) |
| P5-5 | Extraction = regex + unit-convertible number patterns over snippets (`between X and Y`, `X–Y cfs|cms|m³/s`, `minimum X`, `at least X`), each candidate carries {lo, hi, unit, quote, url, title, date}; **no LLM in this phase** | Deterministic, fixture-testable; Gemma arrives in Phase 6 and must never decide ranges anyway |
| P5-6 | cfs ↔ m³/s: **1 cfs = 0.0283168 m³/s** stored alongside the raw quote; UI renders both (raw as quoted, m³/s computed, labeled) | Most paddling sources are US cfs; honesty requires the original wording visible |
| P5-7 | Access/closure/operator notes: one `notes` row per relevant organic result (`kind` ∈ `access`/`closure`/`operator`), text = title + trimmed snippet, `source_id` FK (no orphan notes); **embedding column stays deferred (P3-4)** | Scope discipline: keyword relevance carries retrieval at 4 rivers × handful of notes |
| P5-8 | Relevance gate: a result becomes a note only if snippet/title matches per-kind keyword lists (e.g., access: put-in, takeout, access, bridge, road; closure: closed, closure, ban, flood damage; operator: rafting, kayak, tour, operator); **everything else is discarded, not guessed** | Notes are claims shown to users; uncited relevance is how trust dies |
| P5-9 | River-page access list renders from `notes` join `sources` (text + source link + fetched date, UX_SPEC §4.2 item 5); empty list renders the honest empty state, never filler | UX_SPEC §7 states matrix |

## Tasks (ordered)

1. **Branch + plan + logs** (this); `SERPAPI_KEY` reminder to owner (build not blocked; live pull is)
2. **Ledger migration** — `db/migrations/002_scout_ledger.sql`: `scout_queries(id, month, query_hash, query, results jsonb, spent_at)` + UNIQUE `(month, query_hash)`; runner picks it up unchanged
3. **Adapter + budget** — `src/lib/scout.ts`: `searchRiver(query)` (SerpApi GET, fixture-injectable), `monthlyBudget` meter (count ledger rows in current calendar month; ≥ 90 → hard stop with typed error), query-hash cache check before any live call
4. **Extraction** — `src/lib/scout.ts` pure functions: `extractRangeCandidates(snippet)` (P5-5 patterns + unit conversion P5-6), `classifyNote(result)` (P5-8 keyword gates); unit-tested on hand-built snippets
5. **Cycle runner** — `POST /api/internal/scout` (token auth): per river, 3 template queries (API.md §3.3), cache → live → ledger; store `sources` (dedup by unique url, S1) + `notes` (P5-8); returns per-river summary {queries spent, cache hits, candidates, notes}; stops cleanly when budget exhausted
6. **Review path** — `scripts/list-range-candidates.mjs`: prints pending range candidates (river, lo–hi + unit, quote, url, date) so the owner can judge credibility; **no auto-promotion** (P5-4)
7. **Range promotion (after owner review)** — if credible ranges found: update `rivers.json` + `src/lib/rivers.ts` (`runnableRange`, `rangeState: "verified"`), parity test enforces mirror, seed re-run; if not found: documented negative result, ranges stay `unverified` — both outcomes are phase-success per the honesty rules
8. **River-page UI** — access & notes list component (text + `source link · fetched date`), wired on `/river/[id]`; range-band overlay on the chart when a river is `verified` (translucent accent band at [lo, hi], labeled with source); amber unverified note stays otherwise (already built)
9. **/about#ranges** — short section: what a runnable range is, how a range gets verified here (human-reviewed quoted source), why the app refuses to guess (UX_SPEC §4.4)
10. **Fixtures + tests** — record 2–3 real SerpApi responses (with + without range-bearing snippets) as `tests/fixtures/serpapi/…` + `.meta.json` during the first live pull; extraction tests on fixtures + synthetic snippets; budget-meter test (90-stop) against a ledger-filled test DB; S1/S2 invariant assertions extend `tests/integration/`
11. **Live pull + review** — run the scout cycle (12 queries: 3 × 4 rivers), record real spend, produce the candidate report for the owner
12. **Docs + logs + PR** — API.md §2 gains the internal route; RUNBOOK §2.5 rows stay accurate (verify against reality); UX_SPEC §4.2 implemented as specified; README status row; `npm run verify` + Docker suite green; PR → `dev`

## Test list (gate)

- Unit: range-candidate patterns (cfs + m³/s + "between/minimum" forms, no-candidate cases), unit conversion, note classification gates (positive + negative)
- Adapter: fixture-replay search (no live calls in CI), cache-hit path spends nothing
- Budget: 89th call passes, 90th is refused by meter (ledger-driven, real Postgres)
- Integration: sources S1 (quote-or-reject), S2 (url unique), notes FK integrity; scout route 401 without token
- UI: notes list renders text + source + date; empty state honest
- `npm run verify` green; Docker suite green

## Acceptance (exit criteria)

Chart shows **sourced range bands for any river with a credible published range** (Indus/Kunhar/Swat attempted); every displayed claim links to its source with a date; monthly budget respected (≤ 90 with ledger proof); ranges without credible sources stay honestly `unverified`; Malir untouched (`not_a_paddling_river`).

## Risks

| Risk | Mitigation |
|---|---|
| **No public runnable ranges exist for Pakistani rivers** (likely for cfs-style guidance) | Planned-for outcome (PRD risk table): the negative result is documented evidence of honesty; access/notes still deliver value; master plan already frames this as acceptable |
| Snippets too short to hold a range | Extraction stores nothing rather than guessing; full pages are out of scope (SerpiApi snippets only, API.md §3.3) |
| Budget burn on template iterations | Cache-first ledger + dev iteration against recorded fixtures, not live calls |
| Malir false positives (flood-damage news ≠ paddling) | Malir gets queries only for the honesty-check narrative? **No — Malir is excluded from scout cycles** (its state is config, not searchable); only Indus/Kunhar/Swat are scouted |
| SerpApi free-key activation delays | Live pull is task 11; everything before it is fixture-driven |

## Out of scope (later phases)

LLM summaries (6) · weekly automatic scheduling + retry (7 — worker calls `lib/scout.ts` directly) · embedding backfill / hybrid search (P3-4 deferral) · closures driving status logic (status stays `computeStatus()`-only)
