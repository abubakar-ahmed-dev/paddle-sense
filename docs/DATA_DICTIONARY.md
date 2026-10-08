# PaddleSense — Data Dictionary

| | |
|---|---|
| Scope | Every persisted field, config value, controlled vocabulary, and external-data mapping in PaddleSense |
| Storage | Tiger Data — Postgres + pgvector (single database) |
| Related | [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) §3.2 · [API.md](API.md) · [PRD.md](PRD.md) |

---

## 1. Conventions

- **Units:** discharge is m³/s everywhere (DB, API, UI, docs). Elevation in meters. Rain in mm. Temperature in °C.
- **Dates:** `DATE` (river-day, GMT — GloFAS data is daily/GMT). Timestamps: `TIMESTAMPTZ` UTC.
- **IDs:** river ids are stable slugs (`indus-besham`) — never renamed once published; display names may change.
- **Null semantics:** `NULL` means "no value" (missing reading). A value of `0` means the river genuinely measured zero flow. Never substitute one for the other — Malir's dryness is data.
- **Provenance invariant:** any fact that came from outside the system has a row in `sources` reachable by FK. No orphan claims.

---

## 2. Table: `rivers`

The curated catalog. Seeded from `src/lib/rivers.ts`; the DB row is authoritative at runtime after Phase 3.

| Column | Type | Constraints | Description | Example |
|---|---|---|---|---|
| `id` | `text` | PK | Stable slug | `indus-besham` |
| `name` | `text` | not null | Display name | `Indus` |
| `stretch` | `text` | not null | Human stretch label | `Besham stretch (KKH)` |
| `cell_lat` | `double precision` | not null | Chosen GloFAS cell latitude (snapped) | `34.88` |
| `cell_lon` | `double precision` | not null | Chosen GloFAS cell longitude (snapped) | `72.88` |
| `cell_elevation` | `int` | not null | Cell elevation from API — shown in UI for transparency | `633` |
| `runnable_lo` | `double precision` | nullable | Runnable-range lower bound, m³/s | `800` |
| `runnable_hi` | `double precision` | nullable | Runnable-range upper bound, m³/s | `3000` |
| `range_state` | `range_state` | not null, enum | See §8.1 | `unverified` |
| `range_source_id` | `uuid` | nullable, FK → `sources.id` | Where the range came from; required when `range_state = 'verified'` | — |
| `honesty_note` | `text` | not null | The card's plain-language caveat | Rafting runs happen upstream (Kalam–Bahrain); this well-resolved lower cell is a proxy. |

**Invariant R1:** `range_state = 'verified'` ⇔ `runnable_lo`, `runnable_hi`, `range_source_id` are all non-null.
**Invariant R2:** `runnable_lo < runnable_hi` when present.
**Invariant R3 (Malir):** exactly one river has `range_state = 'not_a_paddling_river'` in v1.

---

## 3. Table: `readings`

One row per river-day per kind. The time series and the retrodiction ground truth.

| Column | Type | Constraints | Description | Example |
|---|---|---|---|---|
| `river_id` | `text` | PK part, FK → `rivers.id` | — | `indus-besham` |
| `date` | `date` | PK part | The river-day this value describes | `2022-07-02` |
| `kind` | `reading_kind` | PK part, enum | See §8.2 — observed vs forecast rows never mix | `observed` |
| `discharge` | `double precision` | nullable, `CHECK (discharge IS NULL OR discharge >= 0)` | m³/s; NULL = source had no value | `12022.4` |
| `source` | `text` | not null | Data origin URL | `https://flood-api.open-meteo.com` |
| `fetched_at` | `timestamptz` | not null | When we stored it | `2026-10-08T06:12:33Z` |
| `forecast_created_for` | `date` | nullable | For `kind='forecast'`: the cycle date that produced this forecast row — lets us score old forecasts later | `2026-10-08` |

**PK:** `(river_id, date, kind)` → re-running a fetch cycle is a no-op (idempotent upsert).
**Invariant T1:** `kind = 'forecast'` ⇔ `forecast_created_for IS NOT NULL`.
**Validation fixture (regression):** `indus-besham / 2022-07-02 / observed ≈ 12022` — a test asserts the backfill reproduces this within ±0.5%.

---

## 4. Table: `sources`

Provenance for every external claim (ranges, access notes, closures, snippets).

| Column | Type | Constraints | Description | Example |
|---|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | — | — |
| `url` | `text` | not null, `UNIQUE` | The claim's origin page | `https://…/kunhar-rafting` |
| `kind` | `source_kind` | not null, enum | See §8.3 | `range` |
| `quote` | `text` | nullable | Verbatim supporting text; required for `range`/`closure` kinds (quote-or-reject rule) | `"best between 500 and 2,000 cfs"` |
| `title` | `text` | nullable | Page title at fetch time | `Kunhar Rafting Guide` |
| `fetched_at` | `timestamptz` | not null | — | — |
| `search_query` | `text` | nullable | The SerpApi query that found it (audit + budget accounting) | `kunhar river rafting runnable level` |

**Invariant S1:** rows with `kind IN ('range','closure')` must have non-null `quote`.
**Invariant S2:** every `url` is stored once; claims reference it by FK.

---

## 5. Table: `predictions`

Model outputs, stored at generation time. The `/retro` page reads these — it never recomputes.

| Column | Type | Constraints | Description | Example |
|---|---|---|---|---|
| `id` | `uuid` | PK | — | — |
| `river_id` | `text` | FK → `rivers.id` | — | `kunhar-balakot` |
| `created_at` | `timestamptz` | not null | When produced | — |
| `target_date` | `date` | not null | The day being predicted | `2026-10-12` |
| `band_lo` | `double precision` | not null, `CHECK (band_lo <= band_high)` | Band lower, m³/s | `38.2` |
| `band_high` | `double precision` | not null | Band upper, m³/s | `64.9` |
| `coverage_target` | `double precision` | not null | Intended coverage of this band | `0.75` |
| `model_version` | `text` | not null | Echoed from the predict service | `tabpfn-v1-r2026-10-08` |
| `kind` | `prediction_kind` | not null, enum | See §8.4 — live forecast vs retrodiction replay | `forecast` |
| `metrics` | `jsonb` | nullable | Backtest metrics when `kind='backtest'`: `{"mae": 96.4, "band_coverage": 0.786, "days": 28}` | — |

**Invariant P1:** `kind = 'backtest'` ⇔ `metrics IS NOT NULL`.
**Invariant P2:** a backtest row must have a matching `readings` row (its truth) for the same `(river_id, target_date)`.

---

## 6. Table: `notes`

Scouted access/closure/operator knowledge, embedding-indexed for later retrieval.

| Column | Type | Constraints | Description | Example |
|---|---|---|---|---|
| `id` | `uuid` | PK | — | — |
| `river_id` | `text` | FK → `rivers.id` | — | `swat-mingora` |
| `text` | `text` | not null | The claim, in our words | `Put-in near Kalam bridge; operators run Kalam–Bahrain in summer.` |
| `kind` | `source_kind` | not null | What kind of claim | `access` |
| `source_id` | `uuid` | FK → `sources.id`, not null | Provenance (no orphan notes) | — |
| `embedding` | `vector(384)` | not null | all-MiniLM-L6-v2 embedding of `text` | — |
| `fetched_at` | `timestamptz` | not null | Freshness shown in UI | — |

Index: `CREATE INDEX ON notes USING hnsw (embedding vector_cosine_ops);`

---

## 7. Config structure: `src/lib/rivers.ts`

The seed source for `rivers` (and the only place a developer edits rivers). Fields map 1:1 to the table plus UI notes:

| Field | Maps to | Notes |
|---|---|---|
| `id`, `name`, `stretch` | same columns | slug stability rule applies |
| `cell.lat`, `cell.lon`, `cellElevation` | `cell_lat`, `cell_lon`, `cell_elevation` | validated values, Phase 0 sweep |
| `runnableRange: [lo, hi] \| null` | `runnable_lo/hi` + `range_state` | `null` seeds `unverified`; `[0, 0]` seeds `not_a_paddling_river` (Malir) |
| `note` | `honesty_note` | shown verbatim on the card |

---

## 8. Controlled vocabularies (enums)

### 8.1 `range_state` — how much we trust the runnable range
| Value | Meaning |
|---|---|
| `verified` | Range backed by a quoted source (`range_source_id` set) |
| `unverified` | No credible source yet — UI must say "range not yet verified" |
| `not_a_paddling_river` | Malir: kept in the catalog as the honesty check |

### 8.2 `reading_kind`
| Value | Meaning |
|---|---|
| `observed` | Historical/actual discharge (GloFAS reanalysis or seamless past) |
| `forecast` | A future-day value from a forecast; `forecast_created_for` required |

### 8.3 `source_kind`
| Value | Requires `quote` |
|---|---|
| `range` | yes |
| `closure` | yes |
| `access` | preferred |
| `operator` | no |
| `reference` | no (methodology pages, e.g., GloFAS docs) |

### 8.4 `prediction_kind`
| Value | Meaning |
|---|---|
| `forecast` | This week's live band, shown on river pages |
| `backtest` | Retrodiction replay row + metrics, shown on `/retro` |

### 8.5 `status` (computed, not stored — `lib/status.ts`)
| Value | Rule (deterministic) |
|---|---|
| `dry` | `discharge <= runnable_lo` |
| `in_range` | `runnable_lo < discharge < runnable_hi` |
| `high_water_dangerous` | `discharge >= runnable_hi` |
| `range_unverified` | `range_state = 'unverified'` |
| `not_a_paddling_river` | `range_state = 'not_a_paddling_river'` |
| `no_data` | current discharge is NULL |

Order matters: `no_data` and range-state rules precede threshold comparisons. This truth table is the 100%-coverage unit test.

---

## 9. External field mappings

### 9.1 Open-Meteo Flood API → `readings`
| API field | → | Notes |
|---|---|---|
| `daily.time[i]` | `readings.date` | GMT day |
| `daily.river_discharge[i]` | `readings.discharge` | m³/s, may be `null` → keep NULL |
| response `latitude`/`longitude` | logged only | the *snapped cell*, not the requested point — stored in cycle logs for the grid-miss audit |
| response `elevation` | sanity check | must match `rivers.cell_elevation` ±50 m or the fetch flags a warning |
| i < past_days | `kind='observed'` | — |
| i ≥ past_days | `kind='forecast'`, `forecast_created_for=cycle date` | — |

### 9.2 SerpApi → `sources` (+ `notes`)
| API field | → |
|---|---|
| `organic_results[].link` | `sources.url` (dedup key) |
| `organic_results[].title` | `sources.title` |
| `organic_results[].snippet` | `sources.quote` — stored verbatim, never paraphrased |
| search query used | `sources.search_query` |

### 9.3 Gemma output → validated, then cached with cycle
| Field | Validation |
|---|---|
| `sentence` | every numeral must appear in the input JSON; else discard → fallback |
| `status_word` | must equal `computeStatus()` output; else discard |
| `confidence` | logged, not shown |
| banned tokens | `safe`, `danger-free` → discard |

---

## 10. Retention & scale

- Everything is kept — the history *is* the retrodiction evidence. At v1 scale (4 rivers × ~15k days + forecasts) the dataset is a few MB, far inside Tiger Data's free 500 MB
- `sources`/`notes` grow with weekly scout cycles; query-hash caching prevents duplicate rows
- If size ever matters: forecast rows older than 1 year may be pruned *only* after their scoring value is captured in `predictions.metrics`
