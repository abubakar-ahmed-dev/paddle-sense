# Phase 2 — Implementation Logs

Format: reverse-chronological entries. Updated whenever phase files change.

## 2026-10-08 — phase start

- Created branch `phase/2-ui` from `dev`.
- Wrote `plan.md` after repo-state check (theme: Indus Silt owner-approved this session).
- Created `implementation-logs.md` and `testing-logs.md`.

## 2026-10-08 — implementation

### Theme wiring (Indus Silt)
- Replaced `src/app/globals.css`: `@theme` tokens (bed/stone/silt/ochre/water/danger/attention + status aliases), base body, `::selection`, `:focus-visible` ring, scrollbar tint.
- Rethemed `RiverChart`: observed area in water `#8FC6C2` with gradient, forecast area dashed `#5DA39E`, ochre dashed `today` ReferenceLine, silt-toned tooltip; added height prop.
- Rethemed dashboard (`page.tsx`) to token classes; ochre for current level, water stays chart-only.

### Status logic
- New `src/lib/status.ts`: `computeStatus()` implementing DATA_DICTIONARY §8.5 with precedence (no_data → not_a_paddling_river → range_unverified → thresholds).
- `src/lib/rivers.ts`: added explicit `rangeState` per river (3× `unverified`, Malir `not_a_paddling_river`); dropped the `[0, 0]` runnableRange hack.

### Component kit
- New: `StatusBadge` (contract copy from UX_SPEC §6), `ProvenanceFooter` (source + asOf rendering), `ErrorPanel`, `EmptyState`, `LoadingSkeleton`.

### Pages & structure
- `layout.tsx`: header nav (Rivers / Retrodiction / About), skip link, `main#main` landmark, global honesty footer.
- `page.tsx`: badges + provenance per card, ErrorPanel on fetch failure.
- NEW `/river/[id]`: 30d/90d/1y windows via `fetchDischargeRange` (Flood API `start_date`/`end_date`), peak-in-window stat, Indus Jul-2022 highlight (activates on windows covering 2022-07-02), runnable-range three-state block, provenance, `generateStaticParams` for the 4 curated rivers, `notFound()` fallback.
- NEW `/retro`: explainer + metric-row layout + miss-table with clearly labeled SAMPLE data (amber chip); real metrics arrive Phase 4.
- NEW `/about`: static cached page (GloFAS, grid cells, range verification, refusals, Malir story, open-stack note).
- NEW `loading.tsx` (`/`, `/river/[id]`) and `app/error.tsx` boundary.
- `lib/flood.ts`: added `fetchDischargeRange()`.

### Testing setup
- Added vitest 3 + @vitejs/plugin-react + jsdom + Testing Library + jest-dom; `vitest.config.ts` (jsdom, `@` alias), `tests/setup.ts`; scripts `test`, `test:watch`, `verify`.
- `tests/unit/status.test.ts`: 9 cases covering every §8.5 rule + boundaries + precedence.
- `tests/unit/components/StatusBadge.test.tsx`: 7 cases — contract copy for all 6 statuses + banned-token check.

### Docs
- `docs/UX_SPEC.md` §1–2 amended to Indus Silt (sanctioned, owner-approved).

## Remaining issues
- Unknown river ids render the not-found UI but keep HTTP 200 (PPR streaming limit; `dynamicParams` forbidden under `cacheComponents`). Cosmetic/SEO-only; revisit with middleware in Phase 9 if it matters.
- OG image not yet created (favicon exists). Deferred to Phase 9 polish.
- Jul-2022 highlight is dormant with current windows (30d/90d/1y don't reach 2022); activates on any wider window.
- NVDA hardware pass pending (owner-assisted; checklist in UX_SPEC §8).
- Verified-range band overlay exists in spec but dormant until Phase 5 produces verified ranges.
