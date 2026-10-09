# Phase 5 — Implementation Log

Append-only by date. Updated whenever any phase file is created or changed.

## 2026-10-09

- Phase 4 merged (PR #3); master plan marker updated on `dev` (`179d756`).
- Created branch `phase/5-search` + `plan.md`.
- Key decisions recorded (P5-1…P5-9): scout logic in TS (`src/lib/scout.ts`)
  with token-protected internal route for manual cycles (Phase 7 worker will
  call the lib directly); budget hard-stop at 90 with a ledger table
  (`002_scout_ledger.sql`); results cached whole in the ledger, extraction
  re-runs on cache; **range candidates are stored, never auto-applied** —
  `range_state` flips to `verified` only via owner-approved seed change;
  deterministic regex extraction (no LLM); cfs conversion stored beside the
  verbatim quote; keyword-gated notes; **Malir excluded from scout cycles**.
- Owner provided `SERPAPI_KEY` (in `.env`) before implementation started;
  recorded in `plans/needs-and-requirements.md` (status only, never the value).

### Implementation (in commit order)

- `db/migrations/002_scout_ledger.sql` — `scout_queries(month, query_hash,
  query, results jsonb, spent_at)` + UNIQUE(month, query_hash); applied to
  Tiger Data (`npm run db:migrate`, 2 applied).
- `src/lib/db.ts` — getScoutCache / recordScoutQuery / countScoutQueries /
  upsertSource (url = S2 dedup key, keeps first fetched_at) /
  insertNoteIfMissing (idempotent, FK-bound) / getNotes (join sources).
- `src/lib/scout.ts` — SerpApi adapter (fixture-injectable fetcher, key never
  in errors), query-hash ledger cache, BudgetExhaustedError hard stop at 90,
  extractRangeCandidates (between/span/minimum forms, unit required — no unit
  = discard), cfs→m³/s via CFS_TO_CMS=0.0283168, classifyNote (closure >
  access > operator, junk discarded), riverRelevance gate, runScoutCycle.
- `src/app/api/internal/scout/route.ts` — POST, X-Internal-Token auth, §0
  error shape; per-query errors recorded, never abort the cycle.
- `scripts/list-range-candidates.mjs` + `npm run range-candidates` — owner
  review report; prints claim/quote/source/date; promotes nothing.
- UI — RiverChart runnable-band overlay (ReferenceArea, ochre at 0.12,
  extendDomain) + figcaption band line + table-alternative mention;
  NotesList (text + kind chip + source link + fetched date, honest empty);
  river page wires getNotes + band when verified; unverified note now links
  `/about#ranges`; about page anchor + human-review paragraph (P5-4 copy).
- Decision recorded here (plan §task-8 note): **range candidates do not
  render on the public river page** — UX_SPEC §4.2 item 5 lists access &
  notes; pre-verification candidates live in the owner review path
  (`npm run range-candidates`) until a human promotes one. UI filter:
  `notes.filter(n => n.kind !== "range")`.

### Live pull (first cycle, 2026-10-09)

- 3 template queries × 3 scouted rivers; SerpApi 503 on one Swat access
  query (transient) — re-run cycle: 8 cache hits + 1 retry, total spend
  **9 live searches / 90 cap**; second full pass: 9/9 cache hits, 0 spend
  (idempotency + cache proven live).
- First cycle stored 11 range candidates — **all false positives**: US-river
  guidebook snippets (Colorado, Rio Grande, Tuolumne, Salt, American, Blue)
  found because the query template matches, not because they are about our
  rivers. This is the plan's predicted risk (no public cfs-style ranges for
  Pakistani rivers) manifesting as cross-river contamination.
- **Bug protocol applied** (TESTING.md §5): failing case = real fixtures;
  fix = river-relevance gate (P5-8 extension) — a result must name the river
  or a stretch proper noun (stoplist: river/stretch/the/of/lower/upper)
  before any kind gate; regression tests: unit riverRelevant cases +
  real-fixture replay test asserting nothing is stored. The gate fix
  re-extracted from cache at zero budget (P5-3 paying off).
- Access/closure/operator notes stored pre-gate are genuine river content
  (pakistantoday.com.pk Kaghan closure item, thenews.com.pk Swat items,
  pedokp.gov.pk barrier document, Indus operator pages) — gate-passing, kept.
- **Pre-gate US-river rows (11 range notes + 7 range sources) remain in the
  DB quarantined**: never rendered (kind filter on the page + they fail the
  gate on any re-extraction) and never promotable. Deletion awaits explicit
  owner approval per CLAUDE.md's stored-data rule. Cleanup SQL is prepared
  and held by the phase lead; NOT run yet.
- No river was promoted: Indus/Kunhar/Swat ranges stay honestly `unverified`
  (documented negative result — phase-success per plan §risks). Malir
  untouched.

### Deviations from plan (all deliberate, none silent)

1. Plan task 10 expected "2–3 real SerpApi responses with + without
   range-bearing snippets". Reality: the live responses themselves proved the
   without-relevance case is the important one; both committed fixtures are
   real "with ranges but wrong river" responses, plus synthetic fakes cover
   no-range cases.
2. Fixture file names follow TESTING.md §4 (`serpapi-{case}-{yyyymmdd}.json`
   + `{url, fetched_at, note}` metas) — the plan's looser naming was
   corrected to policy during the docs pass.
3. RUNBOOK §1 blanket `taskkill //F //IM node.exe` replaced with scoped
   PID kill (matches the permission rule learned in Phase 4).
