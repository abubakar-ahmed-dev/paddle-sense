# PaddleSense ("When can I paddle?") — Deep Dive & Build Plan

**Active project (selected 2026-10-08; named PaddleSense, earlier working name Darya (دریا, Urdu for river).** Replaces Adopt-a-Tree (deselected: needs local compute + personal outdoor visits — both unavailable).
Decision record: earlier research docs were removed; this file is the research/architecture source of truth. Phase-by-phase execution plan with progress: [plan.md](plan.md).

---

## 1. What we are building

A web app for **kayakers, canoeists, and paddleboarders**. Paddlers need river flow inside a safe and fun range: too low means dragging the boat over rocks, too high means danger. Today they read raw gauge numbers and guess.

You pick your local rivers once. The app then:

- **watches** the river levels from free public data (a durable Temporal workflow that runs for weeks),
- **predicts** next week's flow for each river (TabPFN, trained on flow history + upstream rain),
- **checks** access points, closures, and permit news with live web search (SerpApi),
- and tells you one plain sentence: *"Saturday morning, River X should be at a good level. 3 access points open. Go then."*

**You are the builder, not the user.** The product serves people who go outside. Nothing in it requires you to visit a river, take photos, or record videos. The demo is charts, forecasts, and agent traces — all from real public data.

**The honesty trick that replaces the outdoor bonus:** retrodiction. Hide the last 4 weeks of a river's real data, let the model predict it from older history only, then reveal the recorded truth side by side. Real, checkable proof of accuracy, with zero field trips.

---

## 2. Why this fits your constraints

| Constraint | How this idea handles it |
|---|---|
| Weak laptop, no Ollama | No local model. Gemma served via a **free hosted provider** — the challenge explicitly allows this ("serve it through Google Cloud or another provider"). Still open-weight, still $0, still a genuine Gemma category entry. |
| Weak laptop, no Docker | Temporal has a lightweight dev-server binary (`temporal server start-dev`) — no Docker needed. Better: the production worker can run as a **Render free background worker**, so your laptop only writes code. |
| No tree/trail visits, no photos, no videos | Demo is data-driven. The only "outdoor" artifact is optional: if you can ever stand on any bridge over a river once, one photo of the water next to the app's reading is a bonus — but nothing depends on it. |
| Must be free | Every service has a free tier; total $0 (table below). |
| Judging: creativity | Fresh audience — zero of the ~210 scanned submissions touch paddling or water conditions. |
| Judging: writing quality | The story: paddlers' forum quote (from a remote Reddit question) + honest retrodiction tables + agent traces. |

---

## 3. Data sources and demo rivers — LOCKED (Karachi, Pakistan)

| Data | Source | Verified details |
|---|---|---|
| River discharge (flow), history + forecast | **Open-Meteo Flood API (GloFAS v4, Copernicus)** | `river_discharge` in m³/s, daily; global ~5 km grid; history from 1984 (consolidated reanalysis) + seamless recent past; 30-day forecasts (ensemble stats available); free for non-commercial use, no API key. Endpoint: `https://flood-api.open-meteo.com/v1/flood?latitude=..&longitude=..&daily=river_discharge` |
| Rain + weather history (upstream catchment) | Open-Meteo archive API | Global, no key. Feeds TabPFN as predictors (upstream rain, snowmelt season signal) |
| Access points, operators, runnable ranges, closures | SerpApi (live web search) | Rafting operator pages, trip reports, guidebook text |
| Human voice for the post | Pakistani rafting tour operators / paddlers (DM or post), plus r/Kayaking | Remote — no field trips |

**Demo rivers (4):** Pakistan's real paddling waters are the northern snowmelt rivers — Karachi's own channels (Malir, Lyari) are dry or polluted most of the year and are not paddling destinations. That fact becomes part of the story, not a problem:

| River | Why | GloFAS note |
|---|---|---|
| Indus (Skardu stretch) | Real rafting destination, big flow, strong snowmelt seasonality — best prediction story | Large basin, well resolved on the 5 km grid |
| Kunhar (Kaghan Valley) | Rafting/kayak spot, seasonal | Mid-size basin |
| Swat (Kalam stretch) | Rafting destination | Mid-size basin |
| **Malir (Karachi — hometown river)** | **The honesty check.** The app should say "not runnable — near-zero flow" almost every week, and spike only in monsoon. You have stood beside it — one photo of the actual channel next to the app's near-zero reading is the most honest demo artifact in the whole post. Bonus: monsoon spikes on Malir are the same data Karachi flood warnings need — worth one sentence in the post, not a feature (scope). | Small ephemeral channel — grid cell may read very low; if the cell misses the channel, we shift coordinates ~0.1° and say so honestly |

Day-1 task: ~~snap each river's coordinates~~ **DONE (2026-10-08, live API validated).** Final grid cells, chosen by sweeping ~40 cells per basin and checking the 2022 monsoon record (92 days, zero missing):

| River | Cell (lat, lon) | Elevation | Oct 2026 flow | Jul–Sep 2022 peak | Verdict |
|---|---|---|---|---|---|
| Indus — Besham stretch (KKH) | 34.88, 72.88 | 633 m | 1,632 m³/s | **12,022 m³/s** | Flagship: big, clean snowmelt hydrograph — ideal for TabPFN |
| Kunhar — Balakot stretch | 34.58, 73.33 | ~1,397 m | 51 m³/s | 193 m³/s | Good: clean snowmelt curve |
| Swat — lower/Mingora | 34.77, 72.38 | 931 m | 92 m³/s | 239 m³/s | Usable: flatter signal (downstream attenuation); rafting runs upstream — say so honestly |
| Malir — Karachi | 24.93, 67.18 | 34 m | 0.10 m³/s (dry) | 11 m³/s | Honesty check only: reads dry with small monsoon spikes; do not oversell |

Notes: the upper-Swat and Skardu (Rondu gorge) cells resolve poorly (grid misses narrow valleys) — the chosen cells are the best-resolved main-stem representations of each river, and the app will label them as such ("GloFAS cell near X"). July-heavy 2022 curves confirm snowmelt seasonality, which is the predictor TabPFN will learn.

"Good level" per river is learned or configured: each river has a runnable range (from paddling operators/guides via SerpApi). The app turns raw numbers into that one plain sentence with a hosted Gemma call. For the three northern rivers, ranges come from operator pages; for Malir the range is "essentially always: no."

---

## 4. Tech stack

| Piece | Tool | Cost |
|---|---|---|
| Web app + API | Next.js + TypeScript + Tailwind + Recharts | Free |
| LLM (plain-language summaries, jargon translation) | **Gemma (open-weight) via free hosted API** (Google AI Studio / Groq / Together free tier — exact one picked at build time) | Free |
| Durable watcher | **Temporal** — dev binary locally; production worker on Render free background worker | Free |
| Database | **Tiger Data** free plan (Postgres + pgvector): flow history as time series + trail/riverside knowledge for hybrid search | Free |
| Flow prediction | **TabPFN** (Python, runs on CPU for small data) behind a tiny **FastAPI** service | Free |
| Live web search | **SerpApi** free plan (100 searches/month — enough with caching + weekly schedule) | Free |
| Hosting | **Render** free tier (web service + background worker) | Free |
| Tracing (optional) | Sentry free developer plan | Free |
| Build story | GitHub Copilot free tier + Entire/DevRelay session sharing | Free |
| Fine-tuning (optional, first cut if busy) | Tinker — challenge credits at hacktoberfest.com/my | Free with credits |

**Total: $0.**

---

## 5. Architecture

```
[Temporal schedule — per river, weekly]
   │
   ├─► [Flow fetcher]   USGS / Open-Meteo Flood API  ──► Tiger Data (time series)
   ├─► [Scout agent]    SerpApi: access points, closures, trip reports ──► Tiger Data
   ├─► [Predictor]      TabPFN: history + upstream rain ──► next-week flow window
   └─► [Summarizer]     Gemma (hosted): one plain sentence per river
        │
        ▼
[Next.js dashboard on Render]
   river cards: current level · this week's window · good days · sources
   retrodiction page: predicted vs actual (the honesty page)
```

Screen list (4): **Setup** (pick rivers + your paddling range) · **Dashboard** (river cards) · **River detail** (chart, prediction, access notes, sources) · **Retrodiction page** (predicted vs recorded truth).

---

## 6. Challenge categories entered

**Strong (genuine):** Temporal (weeks-long durable watcher — textbook, 0-entry pool) · TabPFN (flow forecasting, ~6 entries but none do hydrology) · SerpApi (access/closure discovery, 0 entries) · Tiger Data (time series + hybrid search, 0 entries) · Gemma (hosted open-weight serving, genuine) · Render (hosting + worker) · GitHub Copilot · Entire.

**Optional:** Sentry (agent traces), Tinker (fine-tune a summarizer/predictor head, show delta), ElevenLabs (audio river briefing — small, honest add).

**Skip honestly:** MongoDB (one DB), Arduino (hardware), Backboard unless genuinely used.

Plus the **overall winner** track.

---

## 7. Risks and honest answers

1. **"Do you even paddle?"** — The post must say honestly: I built this for paddlers after asking them (screenshot a real Reddit r/Kayaking answer with permission). Never pretend to be an expert. The retrodiction evidence + domain quotes carry credibility instead of personal experience.
2. **Prediction quality** — River flow is genuinely hard. Mitigation: predict a *window* ("600–900 cfs"), not a point; validate with retrodiction; publish the misses. If GloFAS-derived predictions are weak for your rivers, the fallback story is "we summarize and watch levels + alerts accurately; the forecast window is experimental" — still honest, still useful.
3. **SerpApi 100/month limit** — enough for a weekly schedule over a handful of rivers with caching. Cache aggressively; schedule searches, never per-pageview.
4. **"Runnable range" data quality** — ranges come from paddling guides/forums (SerpApi). Store the source with every range; mark unverified ranges as such.
5. **Scope** — smallest viable: 3 rivers, one region, weekly cadence, 4 screens. Multi-river scale is a "what's next" line, not a feature.
6. **Safety framing** — levels danger side: always show conservative language ("high water: dangerous — do not go") and link official sources. Never render a green "safe" badge; render the facts + range + sources, same trust design as the trail idea.

---

## 8. Judging-criteria check

| Criterion | Assessment |
|---|---|
| Writing quality | Strong if we do the remote interview + honest retrodiction tables + "how I debugged the watcher" trace story. |
| Relevance (open AI + outside) | Open-weight Gemma at the core (summaries), open public data, free to run; gets *paddlers* outside. Author's own outdoor presence: not required, honestly disclosed. |
| Creativity | High: untouched audience, fresh intersection (tabular flow forecasting + durable watching + live search). |
| Technical execution | Achievable in a week at 3-river scope; every component has a free tier and known-good integration path. |

---

## 9. Seven-day plan

| Day | Work |
|---|---|
| 1 | Wire Open-Meteo Flood API into Tiger Data for all 4 rivers. Snap GloFAS grid cells. Chart one river. |
| 2 | Temporal watcher (dev binary): weekly fetch + retries. Render worker deploy. |
| 3 | TabPFN service: retrodiction on one river (predict last 4 weeks, compare). This is the flagship artifact. |
| 4 | SerpApi scout (access points, closures, runnable ranges) + Gemma plain-language summaries. |
| 5 | Dashboard + river detail + retrodiction pages. Deploy to Render. |
| 6 | Remote paddler interview (Reddit/forum). Optional: Sentry, ElevenLabs briefing, Tinker. |
| 7 | Polish retrodiction page, screenshots, write the post, enter categories. |

---

## 10. Things YOU need to do

1. ~~Country/city~~ — done: Karachi, Pakistan. Data plan locked (section 3).
2. **The one photo (optional, 5 minutes):** next time you pass the Malir channel, take one photo of it. The app will say "not runnable — near-zero flow." Photo + app side by side = the most honest artifact in the post. No trip needed just for this.
3. **Create free accounts and give me the keys** (below).
4. **Claim Tinker credits** at hacktoberfest.com/my (only if we do the optional fine-tune).
5. **During the week:** none — no visits, no photos, no videos required. Optionally, ask the Reddit r/Kayaking question yourself from your account (a real account asking real users is more credible than me describing it).
6. Make sure you have a **dev.to account** and a **GitHub** repo ready.

## 11. What I need from you (details / credentials)

| # | Item | Why |
|---|---|---|
| 1 | ~~Country + city~~ — answered (Karachi). Any nearby river you know = Malir, already in the plan | — |
| 2 | **Tiger Data** free account → connection string | Database |
| 3 | **SerpApi** free account → API key | Live search |
| 4 | **Render** free account (deploy access) | Hosting + worker |
| 5 | **GitHub** repo for the project | Code + Copilot/Entire story |
| 6 | One hosted Gemma API key (Google AI Studio free / Groq / Together — I'll tell you which once we start) | LLM calls |
| 7 | Optional: Sentry key, ElevenLabs key | Tracing / audio briefing |
| 8 | Yes/no: any outdoor visit possible (bridge over a river) | Optional bonus plan |

**Security note:** keys go in a git-ignored `.env` only — never in the repo or in chat logs you might share.
