# Phase 2 — Complete UI (deliberately early) — Phase Plan

Branch: `phase/2-ui` (from `dev`) · Master plan ref: Phases 2 · Written: 2026-10-08

## Context check (repo state at re-planning)

- Dashboard v0 live: `/` renders 4 rivers from GloFAS (page.tsx, RiverChart)
- Theme decision made this phase: **Indus Silt** (owner-approved) — replaces v0 slate/sky
- No persistence, no LLM, no Temporal yet — UI runs on live Flood API + sample data
- `lib/status.ts` does not exist yet — statuses are computed inline in page.tsx (to be extracted + tested)
- Rivers config lacks explicit `rangeState` (inferred from `runnableRange` shape) — to be made explicit

## Tasks

1. **Theme wiring (Indus Silt)**
   - Replace `src/app/globals.css`: `@theme` tokens (bed/stone/silt/ochre/water/danger/attention + status aliases), base styles, focus-visible, chart gradient helpers
   - Retheme `RiverChart`: water `#8FC6C2` stroke/fill, today ReferenceLine (ochre dashed), forecast section lighter than observed
   - Retheme `page.tsx` to token classes; layout nav + skip link
2. **Status logic** — `src/lib/status.ts`: `computeStatus()` per DATA_DICTIONARY §8.5 (precedence: `no_data` → `not_a_paddling_river` → `range_unverified` → thresholds); add `rangeState` to `River` in `lib/rivers.ts` (3× unverified, Malir `not_a_paddling_river`; drop the `[0,0]` hack)
3. **Component kit** — `StatusBadge` (exact copy per UX_SPEC §6), `ProvenanceFooter`, `ErrorPanel`, `EmptyState`, `LoadingSkeleton`
4. **Pages**
   - `/river/[id]` — 30d/90d/1y window (Flood API `start_date`/`end_date`), peak-in-window stat, unverified-range amber note, cell metadata, provenance block, `notFound()` for bad ids
   - `/retro` — shell: explainer, metric-row layout with **clearly labeled illustrative sample** (amber chip: real data arrives Phase 4), miss-table structure
   - `/about` — static cached: GloFAS explainer, grid-cell honesty, range verification, refusals, Malir story
   - `loading.tsx` for `/` and `/river/[id]`; `error.tsx` boundary
5. **Accessibility** — skip link, landmarks, chart data-table alternatives (`<details>`), focus rings, single h1 per page
6. **Testing setup** — Vitest + Testing Library + jsdom; `tests/unit/status.test.ts` (truth table, 100% of §8.5); `StatusBadge` component test; scripts `test`, `verify`
7. **Docs amendment** — `UX_SPEC.md` §1–2 tokens → Indus Silt (sanctioned change, owner-approved)

## Out of scope (later phases)

Verified-range band overlay (no verified ranges until Phase 5) · OG image · real retrodiction (Phase 4) · NVDA hardware pass (owner-assisted, recorded in testing-logs)

## Test list (gate)

- `tests/unit/status.test.ts` — every §8.5 rule + precedence cases, 100%
- `StatusBadge` renders exact badge text for all 6 statuses; no "safe" string
- `npm run build` green · `npm run test` green · manual keyboard tab-through
- Every page: single h1, skip link works, charts have table alternatives

## Acceptance (exit criteria)

All routes navigable (`/`, `/river/indus-besham`, `/retro`, `/about`); zero console errors on load; a11y checklist pass; build + tests green; logs current.
