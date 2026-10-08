# PaddleSense — Product Requirements Document (PRD)

| | |
|---|---|
| Product | PaddleSense — river-level watcher for Pakistan's paddling waters |
| Version | 1.0 (draft for hackathon build) |
| Date | 2026-10-08 |
| Status | Approved for development |
| Related docs | [plans/plan.md](../plans/plan.md) (execution phases) · [deep-dive.md](deep-dive.md) (research & architecture) |
| Companion challenge | DEV Hacktoberfest 2026 — "Touch Grass" (`hf26challenge`) |

---

## 1. Overview

### 1.1 One-liner

PaddleSense watches river levels on Pakistan's paddling waters from free public data, predicts the coming week's flow window for each river, checks access points and closures, and answers in one plain sentence: *"Saturday morning, the Kunhar should be at a good level. Go then."*

### 1.2 Product goals

1. A paddler can, in under 30 seconds, decide **which river** and **which day** is worth going to this week.
2. Every number the app shows is **traceable** to a named public source, with a visible date.
3. The app **never** renders a green "safe" verdict — facts, ranges, and links only.
4. The whole system runs on **free tiers** ($0) and **open public data**.
5. The system **runs itself**: a durable weekly watcher fetches, predicts, summarizes, and flags — surviving failures and restarts.

### 1.3 Non-goals (v1)

- Gauge-grade accuracy — GloFAS grid values are estimates, and the app says so
- Multi-country coverage (Pakistan first; architecture stays data-source-agnostic)
- Social features, accounts, or multi-user auth (single-operator deployment)
- Real-time telemetry, hardware sensors, or mobile apps (responsive web only)
- Flood warning service for the public (the Malir monsoon signal is noted honestly, not productized)

---

## 2. Background & problem

### 2.1 The problem

Paddlers — kayakers, raft guides, SUP riders — need river flow inside a **runnable range**: too low means dragging the boat over rocks; too high means danger. Today this decision is made by reading raw gauge numbers, scattered Facebook groups, and word of mouth. Nothing watches levels, predicts the week ahead, and translates hydrology into a plain go/no-go sentence — for any river, and especially not for Pakistan's.

### 2.2 Why Pakistan, why now

Pakistan's paddling waters are the northern snowmelt rivers — the Indus, Kunhar, and Swat — where commercial rafting and growing kayak interest meet seasonal, weather-driven flows. Flow information exists (Copernicus GloFAS models every river on Earth at ~5 km resolution), but nobody has turned it into a paddler-facing decision tool for this region.

### 2.3 Prior art and differentiation

| Existing | Gap PaddleSense fills |
|---|---|
| Global river apps and gauge sites (US-centric) | No Pakistan focus; raw numbers, no plain-language verdicts |
| Weather apps | No river discharge, no runnable ranges, no paddling context |
| Facebook groups / operator word-of-mouth | Not timely, not structured, not verifiable |

Differentiators: **Pakistan-first**, **flow-window prediction** (not just current level), **source-cited ranges**, **plain-language output from an open-weight model**, **$0 to run**.

---

## 3. Target users

### Persona A — "The weekend rafter" (primary)

Books a rafting trip (Skardu, Kaghan, Swat) once or twice a season. Wants to know: *is the water good this weekend, and is the trip operator's stretch runnable?* Reads the dashboard for 30 seconds, decides, books.

### Persona B — "The trip operator" (secondary, informed the product)

Runs weekend rafting trips. Checks levels obsessively in season. Wants a per-river dashboard with a forecast band and closure notes, so they don't drive clients four hours to a dead or dangerous river.

### Persona C — "The growing kayaker" (secondary)

Independent paddler planning their own runs. Wants history and the prediction band to plan trips days ahead, plus access notes (put-ins, operators, hazards).

**Note on the builder:** the author is not a paddler and has no field access — the product is designed builder-first, user-informed (operator/paddler input gathered remotely), and every claim is evidence-backed by public data. This constraint is stated openly in all public material.

---

## 4. User stories (prioritized)

| ID | Story | Priority |
|---|---|---|
| U1 | As a rafter, I see today's level and this week's forecast band for each river, so I can pick a day. | P0 |
| U2 | As a rafter, I see whether the level is inside the runnable range — or that the range is not yet verified — so I am never misled. | P0 |
| U3 | As an operator, I get a one-sentence plain-language status per river, so I can forward it to clients. | P0 |
| U4 | As any user, I can open a retrodiction page showing past predictions vs recorded reality, so I can judge whether to trust the forecast. | P0 |
| U5 | As a kayaker, I see access points, operators, and closure notes per river, each with a source link and date. | P1 |
| U6 | As a returning user, I get notified (email) when a river enters its runnable range. | P1 |
| U7 | As any user, I can view river history (up to years) with notable events marked (e.g., the July 2022 peak). | P1 |
| U8 | As a skeptic, I can click every number and see where it came from. | P0 |

---

## 5. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-1 | River catalog with 4 curated stretches: Indus (Besham), Kunhar (Balakot), Swat (Mingora), Malir (Karachi, honesty-check) | Cells fixed and validated against the Jul–Sep 2022 record; cell coordinates + elevation shown in UI |
| FR-2 | Daily ingestion of GloFAS discharge (m³/s) per river from the Open-Meteo Flood API | Weekly schedule (Temporal); retries on failure; past 14d + 30d forecast per fetch |
| FR-3 | Persistence of all readings as a time series (Tiger Data / Postgres + pgvector) | Historical backfill from 1984 consolidated record; idempotent upserts |
| FR-4 | Next-7-day discharge **band** prediction per river (TabPFN via FastAPI) | Band, never a point; features: day-of-year, recent discharge, upstream rain; model version stored |
| FR-5 | Retrodiction page: hide last 4 weeks, predict from history, plot predicted band vs recorded truth; publish MAE + band-coverage metrics | The trust centerpiece; misses shown, never hidden |
| FR-6 | Runnable ranges per river, each with source URL + quote + verification state | States: `verified` / `unverified` / `not-a-paddling-river`; unknown ranges never invented |
| FR-7 | Access & closure notes per river via live search (SerpApi) with source + date | Weekly cadence, cache-first, monthly search budget ≤ 100 (free tier) |
| FR-8 | One-sentence plain-language status per river (hosted open-weight Gemma) | Guardrails: never "safe", no invented numbers (validated post-hoc), conservative tone; non-LLM fallback sentence if API down |
| FR-9 | Range-crossing detection + optional email notification (free SMTP/Resend) | Opt-in, single recipient for v1 |
| FR-10 | Source provenance everywhere: every displayed number/claim links to its origin + fetch date | Enforced in UI layer — components require a `source` prop |
| FR-11 | Status computation: `dry` / `in-range` / `high water — dangerous` / `range not verified` | Deterministic logic, unit-tested; LLM never decides safety status |

---

## 6. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Cost | $0 across all services (free tiers); documented budget per service |
| NFR-2 | Honesty & trust | 100% of claims source-linked; conservative language enforced by tests; no green "safe" badge anywhere |
| NFR-3 | Accessibility | WCAG AA basics: keyboard navigation, contrast, semantic HTML, chart text alternatives |
| NFR-4 | Performance | Dashboard first paint < 3 s on Render free tier; cached pages where data is not live |
| NFR-5 | Reliability | Watcher survives kill mid-run (Temporal retries + catch-up); duplicate runs produce no duplicate data |
| NFR-6 | Privacy | No user accounts, no PII stored; single-operator email only |
| NFR-7 | Maintainability | TypeScript strict; typed data-access layer; no hidden literals (rivers, cells, ranges in config) |
| NFR-8 | Testability | Unit tests for status/range logic; integration tests for DB; contract tests for external APIs (fixtures); workflow tests for Temporal; backtest as the prediction test |

---

## 7. UX requirements

### 7.1 Screens (v1)

1. **Dashboard (`/`)** — river cards: current level, week band chart, computed status, one-sentence summary, provenance footer
2. **River detail (`/river/[id]`)** — larger chart with history toggles, range band overlay (when verified), access notes, source list, event markers
3. **Retrodiction (`/retro`)** — predicted band vs actual, per river, with honest metrics header
4. **About / data honesty** — what GloFAS is, what a grid cell is, what "runnable range" means, what the app refuses to claim

### 7.2 UX rules

- Mobile-first (operators check from phones on the road)
- Loading, error, and empty states on every data surface
- Danger language is always conservative; high water always says "do not go"
- The Malir card tells the truth loudly: "not a paddling river — honesty check"

---

## 8. Data

### 8.1 Sources

| Data | Source | License/cost |
|---|---|---|
| River discharge (daily, history + 30-day forecast) | Open-Meteo Flood API (Copernicus GloFAS v4) | Free, non-commercial, no key |
| Upstream rain & temperature (predictors) | Open-Meteo archive / forecast API | Free, no key |
| Runnable ranges, access points, closures, operators | SerpApi (live web search) | Free tier 100 searches/month |
| Plain-language generation | Hosted open-weight Gemma (Google AI Studio free tier; provider-swappable) | Free tier |

### 8.2 Data model (Postgres / Tiger Data)

- `rivers(id, name, stretch, cell_lat, cell_lon, cell_elevation, runnable_lo, runnable_hi, range_state, range_source_id)`
- `readings(river_id, date, discharge, source, fetched_at)` — PK (river_id, date)
- `sources(id, url, kind, fetched_at)` — every range/access claim links here
- `predictions(river_id, created_at, target_week, band_lo, band_high, model_version, metrics)`
- pgvector column on river notes/knowledge for later hybrid search

### 8.3 Data validation (done, Phase 0)

Chosen cells verified against the Jul–Sep 2022 monsoon: Indus@Besham peak 12,022 m³/s (2 Jul), Kunhar 193, Swat 239, Malir honest-dry with 11 m³/s spike. 92 days, zero missing values.

---

## 9. Architecture (summary)

```
[Temporal weekly workflow, per river]  (dev binary locally → Render background worker in prod)
   ├─ fetch discharge (Open-Meteo Flood)      ──► Tiger Data readings
   ├─ scout access/closures (SerpApi, cached) ──► Tiger Data sources
   ├─ predict next-7-day band (TabPFN/FastAPI)──► Tiger Data predictions
   ├─ summarize (hosted Gemma, guardrailed)
   └─ detect range-crossing ──► optional email
[Next.js 16 + Tailwind + Recharts on Render]  ◄── reads Tiger Data
   /  dashboard · /river/[id] · /retro · /about
```

Full rationale and alternatives: [deep-dive.md](deep-dive.md).

---

## 10. Success metrics & acceptance criteria

| Metric | Target for v1 |
|---|---|
| Retrodiction band coverage (4 rivers, 4 hidden weeks) | ≥ 70% of actual values inside predicted band — or the metric is published lower, with analysis |
| Source provenance | 100% of displayed claims carry source + date |
| Dashboard UX | River → decision in < 30 s; all states designed |
| Reliability | One full scheduled cycle in production without manual intervention; forced-kill recovery demonstrated |
| Cost | $0 confirmed from provider dashboards |
| Challenge submission | DEV post published, all genuine category entries made, template followed |

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Prediction skill too weak for a "window" claim | Bands not points; backtest-first; if weak, publish honest metrics and frame prediction as experimental |
| GloFAS grid misses small rivers (seen at Skardu, upper Swat) | Cells chosen by sweep + 2022 validation; UI shows cell identity; stretches named honestly (e.g., "lower river, Mingora") |
| SerpApi free-tier exhaustion | Weekly cadence, cache-first, budget meter, fixtures for CI |
| LLM hallucination | Schema-constrained output, post-hoc number validation, templated fallback, never decides safety |
| Solo-builder overreach | Phase plan with exit criteria ([plans/plan.md](../plans/plan.md)); predefined cut list |

---

## 12. Release plan

- **v0.1 "honest skeleton"** (done): live GloFAS dashboard, validated cells, build green
- **v0.2**: complete UI, persistence, retrodiction live (Phases 2–4)
- **v0.3**: sourced ranges, LLM summaries, durable watcher (Phases 5–7)
- **v1.0 "submission"**: QA gate passed, deployed on Render, DEV post published (Phases 8–10)

Phase-level tasks, tests, and exit criteria live in [plans/plan.md](../plans/plan.md).

---

## 13. Open questions

1. Exact runnable ranges for Indus/Kunhar/Swat — pending operator/guide sources (Phase 5)
2. Best hosted-Gemma provider by reliability on free tier — to be measured in Phase 6
3. Email nudge provider (Resend vs Gmail SMTP) — decided in Phase 7
4. Whether the Malir monsoon signal deserves a small "flood season note" — deliberately out of scope for v1; revisit post-challenge
