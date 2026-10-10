# Phase 7b — Trust & depth hardening (stretch) — Phase Plan

Branch: `phase/7b-hardening` (from `dev`) · Written: 2026-10-10 ·
Position: after Phase 7, before the Phase 8 QA gate. Pure upside: every task
either closes a judge-findable gap or strengthens a partner-category story.
Nothing here is required for the product to work — which is exactly why it
is scheduled before QA, not "later".

## Context check (repo state at re-planning, verified 2026-10-10)

- Phases 2–7 merged. `npm run verify` exit 0 (116 tests + 33 DB-gated),
  `test:db` 33/33, watcher proven live (resume, idempotency, email).
- **Verified gaps (inspection, 2026-10-10):** no `.github/` (zero CI);
  `test:e2e` documented in TESTING.md but no Playwright anywhere;
  `notes.embedding vector(384)` + HNSW index exist but **0 of 22 notes have
  embeddings** (pgvector dead weight); no coverage tooling; UX_SPEC §5
  claims provenance is compiler-enforced — unverified; `npm audit` has
  advisories; `@swc/core` pin (1.12.9) documented only in phase logs.
- Scout queries are English-only although Pakistani river coverage is
  heavily Urdu (news, operators). SerpApi ledger at 9/90 spend — room.
- Two Gemma models available (`gemma-4-26b-a4b-it` chosen by informal
  probe); eval set has no recorded high-water softening attempt.
- Backtest metrics are run-level (overall MAE + coverage); no per-horizon
  split, so forecast decay is invisible.
- Charts show only the current window; last year's shape (already stored,
  2015→today) is one query away and huge for "is this normal?".

## Decisions (P75-x, proposed — standing unless owner changes)

| # | Decision | Rationale |
|---|---|---|
| P75-1 | **CI via GitHub Actions**: `.github/workflows/ci.yml`, two jobs — `web` (Node 22, `npm ci`, lint, test, build) and `db` (pgvector/postgres service container → `DATABASE_TEST_URL` → `npm run test:db`), plus `predict` (setup-python 3.13, pip install, pytest). Triggers: `pull_request` + `push` to `dev`. No secrets in CI (unit+db suites are network-free by design). Badge in README | TESTING §1 says CI has no network — the suites already obey; CI makes the claim checkable. Biggest trust-per-token spend in the repo |
| P75-2 | **Playwright smoke, for real**: `playwright.config.ts` with `webServer: npm run dev`, `tests/e2e/smoke.spec.ts` — `/` renders 4 river cards + a badge each, `/river/kunhar-balakot` shows chart + sourced notes, `/retro` shows metric rows, `/about` loads. `npm run test:e2e`. Gate stays **pre-merge to `dev`** (needs the DB; not a CI job) | Makes the existing TESTING.md row true instead of deleting it. DB-first serving means no live third-party calls once data is fresh |
| P75-3 | **Activate pgvector**: `src/lib/embed.ts` wraps `@xenova/transformers` `all-MiniLM-L6-v2` (384-dim, quantized, CPU, no API key; model downloaded on first use). `scout.ts` embeds note text at insert (`insertNoteIfMissing` gains embedding). One-off `scripts/embed-notes.mjs` (tsx) backfills the 22 existing notes. Read side: `GET /api/v1/search?q=` → cosine top-5 notes with source links; small client search box on `/about#notes-search` | Converts the unused vector column + HNSW index into a working feature ("search the collected river notes semantically"), the single biggest Tiger Data-category lift. Local model keeps $0 and network-free CI |
| P75-4 | **Urdu scout queries**: each river config gains `urduName` (e.g. Kunhar → `کنہار`); `queryTemplates` adds one Urdu closure/level template per river; SerpApi called with `gl=country-pk&hl=ur` for those; `riverRelevance` gate accepts either the Latin tokens or the Urdu name. Budget unchanged (3 rivers × 5 templates = 15/month ≪ 90 cap). One recorded Urdu-result fixture for the gate test | Better data from the sources that actually write about these rivers; a Pakistan-authentic detail. The relevance gate must not false-positive on Urdu pages about other things — fixture proves it |
| P75-5 | **Gemma A/B + adversarial fixture**: run the full eval set against both `gemma-4-26b-a4b-it` and `gemma-4-31b-it` (pass rate + latency + tokens), publish `docs/llm-model-comparison.md`; record one real high-water softening attempt as `tests/fixtures/gemma/` fixture (eval replays it) | Replaces "we picked the faster one by a probe" with a measured table; the softened-danger fixture closes the last uncovered failure mode with real evidence |
| P75-6 | **Per-horizon backtest metrics**: predict service reports day-1..day-7 MAE + band coverage split (schema already has per-day rows); `/retro` metric row shows `day1 MAE · day7 MAE`; `docs/retro-metrics.md` regenerated live | Shows forecast decay honestly — "day-1 is sharp, day-7 is a window" — instead of one blended number a sceptic would discount |
| P75-7 | **Docs-vs-reality sweep**: audit every checkable claim (TESTING map rows, UX_SPEC §5 provenance-compiler line, README status table, API.md endpoint list). Either make each true (preferred) or soften the doc. `npm audit` pass with fixes/accepted-noted | Judges cross-read docs against code. Every "verified" above came from exactly this kind of cross-read |
| P75-8 | **Coverage measured once**: `vitest run --coverage.enabled` (v8), numbers recorded in testing-logs + a line in TESTING.md; `lib/status.ts` must show 100% (its §5 principle claims it) | Turns a principle into a number |
| P75-9 | **Last-year comparison line** on dashboard + river charts: `RiverChart` gains optional `lastYear` series (dashed, labelled "same days last year"); data via `getReadings(river, window shifted −1y)` — already stored | "Is this normal for October?" is the paddler's real question; cheapest big UX win, zero new data |
| P75-10 | **Season strip**: static `src/lib/seasons.ts` (snowmelt rise Mar–May, peak Jun–Aug, monsoon overlap Jul–Sep, autumn fade Sep–Oct, winter low Nov–Feb) rendered as a thin labelled strip above each chart. Static config = honest (it's climatology, not a forecast) | Newcomers misread snowmelt charts; the strip teaches the shape in one glance |
| P75-11 | **D5 decision criteria pre-written**: TECHNICAL_ARCHITECTURE §6 addendum gains the concrete rule — "measure worker RSS at Render boot; if > 400 MB or OOM → durable loop" — so Phase 9 only fills in numbers | A pending ADR reads as unfinished thinking; a criteria-fulfilling ADR reads as engineering |
| P75-12 | **Range-verification drive** (owner + agent): intensive candidate hunt for ONE river (Kunhar first: extra manual SerpApi checks within budget, operator/guidebook reading). If a credible quoted claim emerges → owner promotes via the documented config path → full-loop demo (band + badge + email armed). If not → the honest negative stands and the demo shows the review path instead | The demo money-shot is a verified river; at minimum this produces the strongest possible attempt and a documented decision |
| P75-13 | **Demo script**: `docs/demo-script.md` — 60-second Temporal catch-up GIF steps (kill worker mid-cycle → restart → event history), retry-on-503 replay, range review → verification flow, retro reveal | Submission assets get manufactured deliberately, not improvised in Phase 10 |

## Tasks (ordered)

1. **Branch + plan + logs** (this)
2. **CI** (P75-1) + README badge; verify green on this branch's own PR
3. **Audit + coverage + docs sweep** (P75-7, P75-8, `npm audit`) — fast credibility pass; UX_SPEC/TESTING edits land here
4. **Playwright e2e** (P75-2) — config + smoke spec + `test:e2e`; run once against local dev with fresh DB data
5. **pgvector activation** (P75-3) — embed.ts, scout insert path, 22-note backfill, search route, /about search box; fixture note (model file is downloaded, never committed)
6. **Urdu queries** (P75-4) — config + templates + gate extension + fixture + one live cycle observing spend
7. **Per-horizon metrics** (P75-6) — predict service + retro page + metrics doc; re-run backtest live, publish
8. **Gemma A/B + softening fixture** (P75-5) — eval-only, no product change unless the table says switch
9. **Charts**: last-year line (P75-9) then season strip (P75-10) — component work + visual check
10. **D5 criteria** (P75-11) + **demo script** (P75-13)
11. **Range-verification drive** (P75-12) — owner-in-the-loop; outcome recorded either way
12. **Docs + logs + PR** — master plan marker, TESTING map updates, README status, `npm run verify` + `test:db` + `test:e2e` green, PR → `dev`

## Test list (gate)

- CI: both jobs green on this PR (self-demonstrating); predict job green
- E2E: 4 smoke checks pass locally (`npm run test:e2e`)
- pgvector: backfill reports 22/22 embedded; `/api/v1/search?q=kaghan access` returns ≤5 notes with sources; route has unit/int tests (fake embedder injected; real model never runs in CI)
- Urdu: relevance-gate unit tests (Urdu river page accepted, Urdu irrelevant page rejected); live cycle ledger shows Urdu queries spent ≤ cap
- Metrics: backtest re-run stores per-horizon metrics; retro page renders day1/day7; doc updated with real numbers
- Gemma: comparison table committed; softening fixture replayed in eval (100% catch maintained)
- Charts: dashboard + river page render last-year line and season strip (component tests + manual screenshot)
- Coverage: number recorded; `status.ts` at 100%
- Sweep: every doc claim audited true-or-softened; `npm audit` advisories fixed or accepted-noted
- Regression: `npm run verify` exit 0, `npm run test:db` green, e2e green

## Acceptance (exit criteria)

CI badge green on `dev`; e2e real; every note embedded and semantic search live in the UI; Urdu queries running inside budget; per-horizon metrics published; Gemma choice backed by a table; charts answer "normal for this season?"; docs contain no checkable untruths; range-verification attempt documented with an outcome (verified river or honest negative + review-path demo).

## Risks

| Risk | Mitigation |
|---|---|
| `@xenova/transformers` model download on first use (HF network, ~30 MB) | documented; scout path degrades gracefully if embed fails (note stored without embedding — insert must not fail the cycle); CI never downloads (search tests use injected fake embedder) |
| Urdu templates return junk or zero results | gate + fixtures protect the pipeline; zero candidates is an honest outcome; spend stays inside cap |
| Playwright flaky on free GitHub CI | e2e deliberately NOT a CI job (needs DB + env); local/pre-merge gate only |
| Per-horizon metrics expose worse day-7 numbers | that is the point — publish them; coverage gate (≥70%) stays the honesty bar |
| Range drive finds nothing (Phase 5 precedent) | accepted outcome; review path itself becomes the demo; no invented ranges ever |
| Chart additions clutter small screens | last-year line hidden on mobile via responsive rule; season strip collapses to a label |

## Out of scope (still)

i18n UI beyond scout queries · accounts/multi-user · more rivers (each needs Phase-0-style cell validation — separate decision) · Temporal Cloud · ElevenLabs audio (Phase 9 stretch decision) · notification digests/broadcasts
