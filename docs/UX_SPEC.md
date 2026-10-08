# PaddleSense — UX Specification

| | |
|---|---|
| Scope | Screens, components, states, exact copy, and accessibility rules — the single reference for building the UI (Phase 2) |
| Rule | If code and this file disagree, this file wins; fix the code or amend the file deliberately |
| Related | [PRD.md](PRD.md) §7 · [DATA_DICTIONARY.md](DATA_DICTIONARY.md) §8 (enums) · [API.md](API.md) §2 |

---

## 1. Design direction

- **Feel:** calm, dark, data-first. The river is the hero; the chrome stays quiet.
- **Theme:** dark slate (`bg-slate-950` page, `slate-900/60` cards, `slate-800` borders) — already established in dashboard v0.
- **Type:** system stack via Next font (`Geist`); tabular numbers (`font-mono`) for every measurement.
- **Motion:** none beyond hover/focus transitions. Rivers are slow; the UI should be too.

## 2. Color semantics (locked)

| Token | Use | Hex (tailwind) |
|---|---|---|
| `accent` | Levels, charts, interactive highlights | `sky-400` / fill `sky-500 @ 50%` |
| `danger` | `high_water_dangerous`, fetch errors | `red-400` text on `red-950/40` |
| `attention` | `range_unverified`, stale data | `amber-400` text |
| `neutral` | `dry`, `not_a_paddling_river`, `no_data` | `slate-300` text |
| `in_range` | `in_range` status | `sky-300` text — **never green** |

**Hard rule (PRD NFR-2):** no green "safe" badge exists anywhere in the design system. `in_range` is informational (sky), never celebratory (emerald/green).

## 3. Number, date, and copy formats

- Discharge: thousands separators, no decimals ≥ 100 (`1,632 m³/s`), 2 decimals < 100 (`0.10 m³/s`)
- Dates: `8 Oct 2026` in prose, `YYYY-MM-DD` in mono provenance strings
- Bands: `1,498 – 1,849 m³/s` (en dash)
- Every card carries a provenance footer: `GloFAS cell 34.88, 72.88 (633 m) · fetched 8 Oct, 06:12 UTC`
- Danger copy is verbatim from §6; never improvised

## 4. Screens

### 4.1 Dashboard `/`

```
┌ PaddleSense — when can I paddle? ──────────────────────────┐
│ one-line description + link to /about                      │
├────────────────────────────────────────────────────────────┤
│ [RiverCard × 4, ordered: Indus, Kunhar, Swat, Malir]       │
├────────────────────────────────────────────────────────────┤
│ footer: data honesty one-liner + /about link               │
└────────────────────────────────────────────────────────────┘
```

**RiverCard anatomy (top→bottom):**
1. Header row: `name — stretch` (link → detail) · current level, mono, right-aligned
2. Meta row: `StatusBadge` · week band · cell coordinates + elevation (mono, muted)
3. Chart: 14d past (solid area) + 30d forecast (same series, forecast section visually lighter — lighter stroke or dashed baseline at today)
4. Summary sentence (Phase 6; absent → fallback sentence from status)
5. `honesty_note` + range-state line (muted, small)

Malir's card is intentionally the most honest thing on the page: `not_a_paddling_river` badge, near-zero chart, and its honesty note — no special styling beyond the note.

### 4.2 River detail `/river/[id]`

1. Back link · title block (name, stretch, cell metadata)
2. Range selector: `7d · 30d · 90d · 1y` (default 30d) — history from DB (Phase 3)
3. Large chart with **range band overlay** when `range_state = verified` (horizontal translucent `accent` band at `[runnable_lo, runnable_hi]`, labeled "runnable range · source"); when `unverified`, show an amber note instead: `Runnable range not yet verified — see /about#ranges`
4. Event markers (e.g., `Jul 2022 peak: 12,022 m³/s`) as dots + tooltips
5. Access & notes list (Phase 5): each item = text + `source link · fetched date`
6. Provenance block: every source used on this page, full list

### 4.3 Retrodiction `/retro`

1. Header + one-paragraph explainer (what is being claimed and how it is checked)
2. Per-river metric row: `model_version · MAE · band coverage` — coverage `< 70%` renders an `attention` chip: `experimental`
3. Per-river chart: predicted band (translucent accent) vs actual line (solid white) — misses are *visible*, never clipped
4. Miss table for covered-by-band failures: date, band, actual
5. Data window statement: `Predicted from history through 7 Sep; truth from 8 Sep – 5 Oct`

### 4.4 About `/about`

Static, cached. Sections: what GloFAS is · what a grid cell is (why Skardu cell ≠ Skardu gauge) · what "runnable range" means and how it gets verified · what this app refuses to claim · the Malir story · link to repo + docs.

## 5. Component inventory (Phase 2 deliverable)

| Component | Props (essentials) | Notes |
|---|---|---|
| `RiverCard` | river, series, status, summary? | composes the below |
| `StatusBadge` | `status` enum | colors from §2; text from §6 |
| `LevelChart` | series, today, band?, markers? | Recharts; forecast section lighter |
| `RangeBandChart` | series, band | detail page; overlay rect |
| `SummarySentence` | summary? or (status, band) fallback | italicize nothing; plain |
| `ProvenanceFooter` | items: {label, url?, asOf} | mono, muted |
| `MetricRow` | model_version, mae, coverage | `/retro` |
| `ErrorPanel` | message, retry? | red panel (exists in v0) |
| `EmptyState` | what, why | honest empties |
| `LoadingSkeleton` | variant | card-shaped shimmer |

**Provenance rule in code:** chart and number components require a `provenance` prop — TypeScript error if missing. This is NFR-2 enforced by the compiler.

## 6. Exact copy (verbatim strings)

| Status | Badge text | Sentence fallback template |
|---|---|---|
| `in_range` | `In runnable range` | `{name} is inside its runnable range ({lo}–{hi} m³/s).` |
| `dry` | `Below runnable — dry` | `{name} is at {q} m³/s — below its runnable range.` |
| `high_water_dangerous` | `HIGH WATER — do not go` | `{name} is at {q} m³/s — above its runnable range. **Do not go.**` |
| `range_unverified` | `Range not yet verified` | `{name} is at {q} m³/s. Its runnable range is not yet verified — check local sources.` |
| `not_a_paddling_river` | `Not a paddling river` | `{name} reads {q} m³/s — a seasonal channel, kept here as an honesty check.` |
| `no_data` | `No data` | `No reading for {name} yet.` |

**Banned words in UI copy:** safe, safely, danger-free, guaranteed. "Confirmed" is banned unless a human confirmed it.

## 7. States matrix

| Surface | Loading | Error | Empty |
|---|---|---|---|
| RiverCard chart | skeleton (card-shaped) | ErrorPanel + retry | EmptyState `No readings yet` |
| Summary sentence | hidden until cycle data | fallback sentence silently | fallback sentence |
| Range overlay | — | — | amber unverified note |
| `/retro` charts | skeleton rows | ErrorPanel | EmptyState `First backtest has not run yet` |

## 8. Accessibility (gate for Phase 2 exit)

- Full keyboard operability; visible focus rings (`focus-visible:ring-sky-400`) on every interactive element
- Every chart has a data-table alternative (`<details>` with the series table) — map-only/visual-only info is banned (same rule as the trail project)
- Status conveyed by text, never color alone
- Contrast ≥ 4.5:1 for text (slate-200/950, sky-400/950 pass; verify amber-400 on 950)
- Landmarks: `header`, `main`, `nav` skip-link; one `h1` per page
- Manual pass: keyboard-only tab-through + NVDA spot check on dashboard and `/retro`

## 9. Responsive rules

- Breakpoint: single-column mobile-first; `max-w-3xl` container (established)
- Cards stack; charts full-width, fixed 160px height (mobile) → 220px (`sm:`)
- Tables (`/retro` miss table) scroll horizontally with sticky first column
- Touch targets ≥ 40px
