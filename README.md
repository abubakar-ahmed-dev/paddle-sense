# PaddleSense — when can I paddle?

**River-level watcher for Pakistan's paddling waters.** Pick your rivers once; PaddleSense watches their levels from free public data, predicts next week's flow window, checks access points and closures, and answers in one plain sentence: *"Saturday morning, the Kunhar should be at a good level. Go then."*

The name: **paddle** — the boat, the stroke — plus **sense**: reading the river before you get on it.

## Why

Paddlers (kayak, raft, SUP) need river flow inside a safe and fun range: too low means dragging over rocks, too high means danger. Today they read raw numbers and guess. Nothing watches, predicts, and translates for them — especially not for Pakistan's rivers.

## Status

Active development for the DEV Hacktoberfest 2026 challenge ("Touch Grass"). See [plans/plan.md](plans/plan.md) for the full phase plan and current progress.

| Piece | State |
|---|---|
| Live GloFAS dashboard (4 rivers) | working |
| Persistence (Tiger Data) | working |
| Flow prediction (TabPFN) + retrodiction | working ([metrics](docs/retro-metrics.md)) |
| Live search (SerpApi) + sourced access notes | working — budget-capped scout; runnable ranges stay honestly "not yet verified" until a human verifies a quoted source |
| Plain-language summaries (hosted Gemma) | working — validated Gemma sentences with a deterministic fallback; the model never decides status and may only reference numbers we gave it |
| Durable weekly watcher (Temporal) | planned |

## Stack

Next.js 16 + TypeScript + Tailwind + Recharts · Open-Meteo Flood API (Copernicus GloFAS v4) · Tiger Data (Postgres + pgvector) · TabPFN via FastAPI · SerpApi · hosted open-weight Gemma · Temporal · Render.

Everything runs on free tiers. No local GPU required.

## Quickstart

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # verify production build
```

Live data (GloFAS) needs no key. Copy `.env.example` to `.env` for the services used by later phases. The prediction service (TabPFN, CPU-only) runs from `services/predict/` — see its [README](services/predict/README.md).

## Branching

- `main` — stable, released only
- `dev` — integration branch; default working branch
- `phase/<n>-<name>` — one branch per plan phase, merged into `dev`

## Docs

Full index: [docs/README.md](docs/README.md). Highlights:

- [docs/PRD.md](docs/PRD.md) — product requirements
- [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md) — system design and decisions
- [plans/plan.md](plans/plan.md) — end-to-end phase plan with progress

## Data honesty

GloFAS values are **grid-cell estimates, not gauge measurements**. PaddleSense shows its cells, its sources, and its dates. It never renders a green "safe" badge — only facts, ranges, and links. Always confirm with local sources before going on the water.

## Credits

- [Open-Meteo Flood API](https://open-meteo.com/en/docs/flood-api) (Copernicus GloFAS, ECMWF) — free for non-commercial use
- River cells validated against the Jul–Sep 2022 monsoon record
