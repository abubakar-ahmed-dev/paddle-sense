# Phase 2 — Testing Logs

Format: reverse-chronological. Real commands and real results only.

## 2026-10-08 — unit tests

- `npm run test` → vitest 3.2.7: **2 files, 16 tests, 16 passed** (45.7 s)
  - `tests/unit/status.test.ts` — 9/9 (full §8.5 truth table incl. boundaries `<= lo`, `>= hi`, precedence: no_data over all; not_a_paddling_river over thresholds; Malir 0.1 m³/s case)
  - `tests/unit/components/StatusBadge.test.tsx` — 7/7 (contract copy for all 6 statuses, data-status attribute, banned-token "safe" check)

## 2026-10-08 — build

- `npm run build` → failed first run: readonly tuple in test fixture (`as const`) vs mutable `[number, number]`. Fixed fixture typing; rebuilt.
- `npm run build` → failed second run: `dynamicParams` route export rejected under `nextConfig.cacheComponents`. Removed export (see implementation-logs remaining issues); rebuilt.
- `npm run verify` (lint + test + build) → **green**. Routes: `/` (PPR dynamic), `/about` (static), `/retro` (static), `/river/[id]` + 4 prerendered river shells.

## 2026-10-08 — production smoke (`next start`, port 3002)

- `GET /` → 200; exactly 1 h1; badges render (`Range not yet verified` ×3, `Not a paddling river`); Indus current level 1,632 m³/s present.
- `GET /river/indus-besham` → 200; 30-day series rendered (31 days, real recession 3,490 → 1,632 m³/s); peak stat `3,490 m³/s on 2026-09-08`; unverified-range amber block; provenance with cell coords + date.
- `GET /river/indus-besham?range=1y` → 200 (pre-fix run).
- `GET /river/kunhar-balakot`, `/river/swat-mingora`, `/river/malir-karachi` → all 200 with prerendered shells.
- `GET /river/bogus-id` → 200 + not-found content (PPR status limitation, logged).
- `GET /retro` → 200; SAMPLE chip present exactly once; miss-table renders with an explicit miss row.
- `GET /about` → 200.

## 2026-10-08 — accessibility (code-level pass)

- Skip link (`#main`) in layout; single h1 per page verified on `/`.
- `:focus-visible` ring global; charts expose `<details>` data-table alternative (last 14 rows); status conveyed by text + `data-status`, never color alone.
- Pending: owner-assisted NVDA hardware pass (UX_SPEC §8).
