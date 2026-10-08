# PaddleSense — API Reference

| | |
|---|---|
| Scope | Every HTTP interface in and around PaddleSense: our own services, our internal JSON routes, and the external APIs we consume |
| Status | v1 — endpoints marked **Phase n** land with that phase |
| Related | [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) · [PRD.md](PRD.md) |

---

## 0. Conventions (all PaddleSense APIs)

- **Format:** JSON only, UTF-8.
- **Errors:** every non-2xx returns
  ```json
  { "error": { "code": "river_not_found", "message": "No river with id 'indus-skardu'" } }
  ```
  Codes are stable strings, never numbers alone.
- **Units:** discharge is always **m³/s**. Dates are `YYYY-MM-DD` (river-local day, GMT source data).
- **Provenance rule:** any response field derived from an external source carries sibling metadata `{ "source": "<url>", "asOf": "<ISO date>" }`.
- **Auth:** PaddleSense services are internal. The predict service accepts calls only from the app/worker (`X-Internal-Token` shared secret in env, Phase 4). No public API exists in v1.
- **Versioning:** path-versioned (`/v1/...`) when first needed; breaking changes = new path, old path kept until the challenge ends.

---

## 1. Prediction service (FastAPI + TabPFN) — Phase 4

Base URL: `http://localhost:8000` (dev) · Render internal URL (prod)

### 1.1 `POST /v1/predict`

Predict the 7-day discharge band for one river.

**Request**
```json
{
  "river_id": "indus-besham",
  "history": [
    { "date": "2026-10-01", "discharge": 1710.4 },
    { "date": "2026-10-02", "discharge": 1698.2 }
  ],
  "weather": {
    "rain_3d": 12.4, "rain_7d": 31.0, "rain_14d": 48.2,
    "temp_mean_7d": 18.6
  },
  "start_date": "2026-10-09"
}
```

**Response 200**
```json
{
  "river_id": "indus-besham",
  "model_version": "tabpfn-v1-r2026-10-08",
  "days": [
    { "date": "2026-10-09", "band_lo": 1512.0, "band_high": 1849.0 },
    { "date": "2026-10-10", "band_lo": 1498.0, "band_high": 1832.0 }
  ],
  "trained_through": "2026-10-08"
}
```

**Errors:** `400 invalid_history` (gaps or unsorted dates) · `403 unauthorized` (missing token) · `422 unknown_river` · `503 model_not_loaded`

**Notes:** bands are empirical-residual quantiles targeting ~70–80% coverage by construction; `model_version` must be echoed into the `predictions` table verbatim.

### 1.2 `POST /v1/backtest`

Hide a window, predict it from earlier history only, score against truth.

**Request**
```json
{
  "river_id": "indus-besham",
  "history": [{ "date": "2026-09-01", "discharge": 2455.0 }],
  "hidden_window": { "from": "2026-09-08", "to": "2026-10-05" },
  "truth": [
    { "date": "2026-09-08", "discharge": 2311.0 },
    { "date": "2026-09-09", "discharge": 2296.5 }
  ]
}
```

**Response 200**
```json
{
  "river_id": "indus-besham",
  "model_version": "tabpfn-v1-r2026-10-08",
  "days": [
    { "date": "2026-09-08", "band_lo": 2180.0, "band_high": 2510.0,
      "actual": 2311.0, "covered": true }
  ],
  "metrics": { "mae": 96.4, "band_coverage": 0.786, "days": 28 }
}
```

`band_coverage` is the number the `/retro` page publishes. Below 0.70, the UI must label the forecast "experimental" (PRD §10).

### 1.3 `GET /v1/health` — Phase 4

`{ "status": "ok", "model_version": "tabpfn-v1-r2026-10-08", "loaded": true }` — used by the Render health check and the degradation matrix.

---

## 2. Internal JSON routes (Next.js route handlers)

Thin JSON views over Tiger Data for the worker and future use. Server components read the DB directly; these routes exist for the worker's summary step, tests, and any embeddable widget. **Phase 3 onward.**

### 2.1 `GET /api/v1/rivers`

```json
{
  "rivers": [
    {
      "id": "indus-besham",
      "name": "Indus",
      "stretch": "Besham stretch (KKH)",
      "cell": { "lat": 34.88, "lon": 72.88, "elevation": 633 },
      "range_state": "verified",
      "runnable": { "lo": 800, "high": 3000,
                    "source": "https://…operator page…", "asOf": "2026-10-08" }
    }
  ]
}
```

### 2.2 `GET /api/v1/rivers/{id}/readings?from=&to=&kind=observed|forecast`

```json
{
  "river_id": "indus-besham",
  "kind": "observed",
  "series": [
    { "date": "2026-10-07", "discharge": 1655.1,
      "source": "https://flood-api.open-meteo.com", "asOf": "2026-10-08" }
  ]
}
```

`kind=forecast` returns model/GloFAS forecast rows, always flagged separately from history.

### 2.3 `GET /api/v1/rivers/{id}/status`

The single source the worker and UI agree on:

```json
{
  "river_id": "indus-besham",
  "status": "in_range",
  "computed_by": "computeStatus() v1",
  "current": 1632.0,
  "week_band": { "lo": 1498.0, "high": 1849.0 },
  "summary": {
    "text": "Indus is holding in its usual autumn band. A runnable week.",
    "generated_by": "gemma-3-27b-it",
    "validated": true,
    "asOf": "2026-10-08"
  }
}
```

`summary` is absent (not null) when the LLM failed and the fallback was used — the fallback is rendered client-side from `status` + `week_band`.

**Status values:** `dry` · `in_range` · `high_water_dangerous` · `range_unverified` · `not_a_paddling_river` · `no_data`

### 2.4 `GET /api/v1/retro?river_id=&window=28`

Stored backtest results (never recomputed on request):

```json
{
  "river_id": "indus-besham",
  "window_days": 28,
  "model_version": "tabpfn-v1-r2026-10-08",
  "metrics": { "mae": 96.4, "band_coverage": 0.786 },
  "days": [
    { "date": "2026-09-10", "band_lo": 2180.0, "band_high": 2510.0,
      "actual": 2311.0, "covered": true }
  ]
}
```

---

## 3. External APIs consumed (contracts we depend on)

### 3.1 Open-Meteo Flood API (GloFAS v4) — live since Phase 1

- **Endpoint:** `GET https://flood-api.open-meteo.com/v1/flood`
- **Our canonical call:**
  ```
  ?latitude=34.88&longitude=72.88
  &daily=river_discharge
  &past_days=14&forecast_days=30
  ```
- **Response shape we rely on:**
  ```json
  { "latitude": 34.875, "longitude": 72.875, "elevation": 633.0,
    "daily": { "time": ["2026-10-05"], "river_discharge": [1632.05] },
    "daily_units": { "river_discharge": "m³/s" } }
  ```
- **Multi-location:** up to N comma-separated coordinates in one call — used by the weekly backfill, one request per cycle
- **History:** `start_date`/`end_date` from 1984 (consolidated reanalysis); forecast ensemble stats (`river_discharge_mean/_max/...`) available but unused in v1
- **Known quirks:** ~5 km grid — requested coordinates snap to a cell (`latitude`/`longitude` in the response are the *cell* coordinates, not yours — log both); small ephemeral channels (Malir) may read near-zero
- **Limits:** free non-commercial, no key; be polite — batch, cache, weekly cadence

### 3.2 Open-Meteo Archive API — Phase 4 (prediction features)

- `GET https://archive-api.open-meteo.com/v1/archive?latitude=…&longitude=…&start_date=…&end_date=…&daily=precipitation_sum,temperature_2m_mean`
- Used for upstream catchment rain (3/7/14-day sums) and temperature (snowmelt proxy)
- Same no-key free model; historical only (recent days come from the forecast API)

### 3.3 SerpApi — Phase 5 (scout)

- **Endpoint:** `GET https://serpapi.com/search`
- **Our query templates (per river, weekly, cache-first):**
  - `{river} rafting runnable level cfs|m3/s` — runnable-range candidates
  - `{river} {stretch} put-in access operator` — access notes
  - `{river} rafting closed {month} {year}` — closures/incidents
- **Response fields we keep:** `organic_results[].{link,title,snippet,date}`, raw cached in `sources` with the verbatim snippet as the required quote
- **Limits:** free plan = 100 searches/month → budget meter in `lib/scout.ts` hard-stops at 90, reserving 10 for in-season manual checks; CI replays fixtures, zero live calls

### 3.4 Hosted Gemma (Google AI Studio first; provider-swappable) — Phase 6

- **Shape:** OpenAI-compatible `chat/completions` with JSON-constrained output (response_format / guided JSON depending on provider)
- **System prompt contract:** model receives structured river-state JSON; must output `{ "sentence": str, "status_word": enum, "confidence": 0..1 }`; banned tokens: `safe`, `danger-free`; every numeral must exist in the input
- **Validation (in `lib/llm.ts`, post-response):** schema parse → number cross-check → status_word must equal `computeStatus()` → else discard and use fallback template
- **Limits:** free tier per provider (AI Studio: generous daily quota; measured in Phase 6); 4 calls/week steady-state + eval runs

### 3.5 ElevenLabs (text-to-speech) — optional, P2 (stretch)

- **Use:** reads the deterministic status sentence aloud (audio briefing before the drive)
- **Text source:** `computeStatus()` output / fallback template — never the raw LLM sentence alone
- **Shape:** `POST /v1/text-to-speech/{voice_id}` with plain text; free tier (~10k chars/month) far exceeds a few sentences per week
- **Cut first** if the schedule slips; entering the category is genuine only if this ships

---

## 4. Endpoint–phase map

| Endpoint | Phase | Consumer |
|---|---|---|
| `GET /api/v1/rivers` | 3 | worker, tests |
| `GET /api/v1/rivers/{id}/readings` | 3 | worker, retro page |
| `GET /api/v1/rivers/{id}/status` | 3 | worker, UI fallback |
| `POST /v1/predict` | 4 | worker |
| `POST /v1/backtest` | 4 | backtest job |
| `GET /v1/health` | 4 | Render health check |
| `GET /api/v1/retro` | 4 | retro page |
| External: Flood / Archive / SerpApi / Gemma | 1 / 4 / 5 / 6 | ingestion, scout, summarizer |
| External: ElevenLabs (optional) | P2 stretch | audio briefing |
