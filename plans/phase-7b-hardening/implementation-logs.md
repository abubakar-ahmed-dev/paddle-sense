# Phase 7b — Implementation Log

Append-only by date. Updated whenever any phase file is created or changed.

## 2026-10-10

- Phase 7 merged (PR #6, merge `e644180`; master marker `ef501e3`).
- Created branch `phase/7b-hardening` (from `dev`) + `plan.md`.
- Origin: owner asked "where is room for improvement with plenty of time —
  features, partner-tech upgrades, and what an expert judge would find".
  Deep-dive inspection on 2026-10-10 verified the gap list now encoded in
  P75-1…P75-13: no CI; `test:e2e` documented but nonexistent; pgvector
  column + HNSW index present with 0/22 notes embedded (live DB query);
  no coverage tooling; UX_SPEC §5 compiler-enforcement claim unverified;
  npm audit advisories; English-only scout queries despite Urdu-dominant
  local coverage; run-level-only backtest metrics; no recorded high-water
  adversarial Gemma output; single-model choice justified only by an
  informal probe.
- Scope guard: this phase adds no new river, no accounts, no paid service.
  Everything is $0, network-free in CI (per TESTING §1), and reversible.

## 2026-10-10 (implementation day 1)

- **CI (P75-1)** — `.github/workflows/ci.yml`: `web` (Node 22, lint+test+
  build), `db` (pgvector/pgvector:pg17 service container → `test:db`), 
  `predict` (Python 3.13, pip cache, pytest). No secrets by design. README
  badge. Commit `22f1344`.
- **Audit + coverage + sweep (P75-7/8)** — `@vitest/coverage-v8` pinned to
  vitest 3.2.7; `npm run test:coverage` skips `tests/workflows` (Temporal
  ephemeral server cannot start under V8 instrumentation on Windows —
  access-denied on the extracted binary; `npm test` still runs them).
  Numbers: `status.ts` 100%, `notify.ts` 86%, `scout.ts` 53%, `llm.ts` 54%
  lines. `npm audit`: 9 advisories, **all dev toolchain** (vitest 3/tinypool
  /braces/eslint-config-next), production tree 0 — accepted + documented;
  breaking vitest-5 upgrade deferred. UX_SPEC §5 "compiler-enforced
  provenance prop" was false in code — softened to the real composition
  pattern (audit note dated). RUNBOOK: Temporal dev-DB reset row + Resend
  onboarding-sender disclosure. Commit `1f5f84b`.
- **E2E (P75-2)** — Playwright + chromium installed; `playwright.config.ts`
  (webServer `npm run dev`, reuse); `tests/e2e/smoke.spec.ts`: dashboard
  (4 cards, `section [data-status]` ×4, GloFAS provenance), river page
  (h1 + range-state honesty + provenance), retro (coverage + tabpfn), 
  about. First run: 2 selector-looseness failures (5th `data-status` node
  outside sections; strict-mode heading match) — tightened, **4/4 pass**.
  Artifacts git-ignored. Commit `f9a64db`.
- **pgvector (P75-3)** — `src/lib/embed.ts` (all-MiniLM-L6-v2, 384-dim,
  mean-pool + L2-normalize, injectable `EmbedFn`); scout embeds every
  stored note (embed-or-skip: an embedding outage never drops provenance);
  `insertNoteIfMissing` carries the vector (`::vector` param cast);
  `scripts/embed-notes.mjs` backfilled **22/22 live**; `GET /api/v1/search`
  (cosine top-5 with source links; 400/502 shapes); `/about#notes-search`
  client box. Integration tests use literal vectors — model never runs in
  CI. Docker suite 36/36. Commit `f065243`.
- **Urdu queries (P75-4)** — `urduName` on every river (سندھ/کنہار/سوات/
  ملیر); 4th template per river (`<urduName> rafting بند`); SerpApi
  `gl=pk&hl=ur` — **`gl=country-pk` 400s, measured live** (bug protocol:
  probe → fix → log). Relevance gate accepts the native-script name, so
  Urdu pages about other rivers stay rejected. Live cycle: 3 searches spent
  (12/90), **9 operator notes stored** — including rafting.com.pk, a real
  Kunhar operator. Real Urdu fixture + positive replay test. 
  `predictions.test` moved off the shared malir river (order-independence
  of the sequential integration suite). Docker 37/37. Commit `91848fb`.

## 2026-10-11 (implementation day 2)

- **Per-horizon metrics (P75-6)** — service computes `day{n}_coverage` /
  `day{n}_mae` per chunk position (horizon = days since its own origin);
  pydantic `Metrics` gained `extra="allow"`; contract test asserts the
  per-horizon keys and their consistency with the blended numbers; 
  orchestrator passes the keys through verbatim (first live run stored
  without them — the .mjs twin built its own metrics dict; fixed).
  Live re-run (2026-10-10 model `tabpfn-v1-r2026-10-10`): decay table in
  `docs/retro-metrics.md` + explicit freshness rule; retro page renders a
  forecast-decay line. Charts (P75-9/10): dashed same-days-last-year line
  (DB-only, honest absence; 7d/30d/90d windows on the river page), 
  `SeasonStrip` climatology above every chart (labeled, not a forecast).
  Python 31/31; vitest green. Commit `b6f88b8`.
- **Range verification — the drive (P75-12) completed by the owner.** The
  owner edited both config files (Kunhar 35–135 m³/s, `verified`). The
  first `db:seed` was **refused by the schema**: invariant R2 requires
  `range_source_id` for a verified range, and the seed never linked one —
  a pre-existing promotion-path gap surfaced by the first real promotion.
  Fixed under the bug protocol: `rivers.json` carries a `range_source`
  block (owner-knowledge attribution: `owner-verification:
  kunhar-balakot:2026-10-11`, kind=reference — no external quote by design,
  upgradeable when a published source emerges); seed validates + upserts
  the source and now mirrors `runnable_*`/`range_source_id` on update.
  Seed re-run: Kunhar verified with linked source; parity test updated to
  allow the seed-only `range_source` key (and to *require* it for verified
  rivers). Owner commit `01ae5b3`; seed fix `46b6dd9`-family (see git log).
- **Watcher test regression fixed** — the 3 time-skipping tests began
  failing ("Access is denied" os error 5): the SDK's test-server download
  cache expires after a day and Windows Defender then denies the fresh
  download. Pinned `createTimeSkipping` to the preserved binary in
  git-ignored `tools/` (existing-path) with cached-download fallback for
  other machines. 3/3 pass. Commit `a3856db`.
- **Gemma A/B + pressure fixture (P75-5)** — 8 snapshots × 2 models through
  the real adapter + validator: **26b 8/8**, 31b 6/8 (both misses HTTP 503,
  transient) → `gemma-4-26b-a4b-it` kept, `docs/llm-model-comparison.md`.
  High-water pressure test: 5/5 attempts kept "People should not go on the
  river" when pressed to make 12,022 m³/s "sound safe for beginners" —
  recorded as a **positive** fixture (resistance evidence; a caught-failure
  case already exists from Phase 6). Eval replays 3 fixtures: 36/36.
  First recorder attempt mistakenly matched "safe" in the `<thought>` block
  instead of the sentence — recorder fixed to sentence-level (same lesson
  as the Urdu recorder). D5 addendum finalized (production = worker-
  internal durable loop, decided; Phase 9 = memory evidence); 
  `docs/demo-script.md` (6 scenes + post-content notes). Commit `5d01c4b`.
- Temp scripts (`.ab-llm.mts`, `.softening-fixture.mts`) deleted after use.

## Pending (close-out)

- Testing-log final gates: `npm run verify`, `npm run test:db`, 
  `npm run test:e2e` on the final tree; PR + master-plan marker at merge.
