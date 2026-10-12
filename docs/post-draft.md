# PaddleSense: I built a river-watcher so Pakistani paddlers stop guessing

> Draft for the DEV Hacktoberfest 2026 submission post (`hf26challenge`).
> Status when publishing: confirm the Render URL works, upload the
> screenshots from `public/images/` (dev.to needs manual upload), and fill
> the demo link placeholder before hitting publish.

**Suggested tags:** `hacktoberfest`, `hacktoberfest-challenge`, `python`, `typescript`, `showcase`
**Suggested cover image:** `public/images/homepage-hero.png`

---

Every paddler knows the feeling. You have a free Saturday, the weather is
perfect, you drive two hours to the river — and it's either a trickle over
rocks or a brown monster. Both were knowable in advance. Nobody translates
the data.

In Pakistan this problem is total. Global paddling tools don't cover our
rivers. The hydrology data exists — Copernicus's GloFAS model simulates
every river on Earth — but it's published as raw discharge numbers for
scientists, not as "should I go paddling this weekend?" for someone with a
kayak.

So I built **PaddleSense**: a river-level watcher for Pakistan's paddling
waters. It watches the rivers, predicts the coming week, checks access
notes, and answers in one plain, conservative sentence. This post is about
why, how it works, and what I deliberately refused to make it do.

![Dashboard](PLACEHOLDER: homepage-hero.png)

## The one-sentence version

PaddleSense answers **"when can I paddle?"** for four Pakistani rivers —
with the source and date attached to every number, and without ever saying
the word "safe".

## What it actually does

- **Watches river levels daily** from the Open-Meteo Flood API (Copernicus
  GloFAS v4 — free, no account). Four rivers: the Indus at Besham, the
  Kunhar at Balakot, the Swat at Mingora, and Karachi's Malir — more on why
  a non-paddling stream is in the app later.
- **Predicts the next 7 days as a band**, not a number, using TabPFN — a
  foundation model for tabular data that runs on CPU. Then it *proves* the
  forecast by retrodiction: hiding past weeks, predicting them blind, and
  publishing every miss on a public page.
- **Scouts the web weekly** with SerpApi for access notes, road closures,
  and runnable-range quotes — in English *and* Urdu. Every claim is stored
  with its verbatim quote, the source URL, and the fetch date.
- **Writes one sentence per river** with hosted Gemma (an open-weight
  model). The sentence is validated at runtime from four angles before it
  is allowed on screen.
- **Emails you when a river enters its verified runnable range.** The whole
  pipeline runs itself weekly — and survives being killed mid-run.

![Retrodiction — predicted band vs recorded reality](PLACEHOLDER: retro-page.png)

## The design rule that shaped everything: honesty first

Whitewater has a hard truth: the wrong flow level kills people. So the
product's first principle is that it must never lie, never oversell, and
never fake confidence. That rule produced the features I'm proudest of:

**1. There is no green "safe" badge anywhere.** When a river is inside its
runnable range, the badge is calm water-blue. When it's high, it says
"HIGH WATER — do not go". I ban the words *safe*, *danger-free* and
*guaranteed* from the UI, and an automated Playwright sweep crawls every
page on every change to enforce the ban.

**2. Every number carries its source.** GloFAS values are grid-cell
estimates, not gauge readings — the site says so on every card, with the
cell coordinates, elevation, and fetch date. The About page explains why a
cell near Skardu is not a gauge in Skardu.

**3. Ranges are never invented.** A runnable range only appears after a
human verifies a quoted source. Until then the app says "not yet verified"
and shows the raw level. During testing the schema actually refused my own
range entry because I hadn't attached provenance — the guardrail catching
its author is exactly what it's for. (Today: Indus verified at 55–120
m³/s, Kunhar at 35–135 m³/s; Swat still honestly unverified.)

**4. The Malir is the honesty check.** Karachi's Malir is not a paddling
river — it reads near-zero most of the year. It stays in the app on
purpose: when the site says "0.1 m³/s — not runnable" and you can look at
the dry riverbed yourself, that's the app telling the truth even when the
truth is boring.

**5. The LLM is on a leash.** Gemma writes nice sentences, but it never
decides your safety. The deterministic `computeStatus()` function owns
that. The model's output passes four gates before display: schema check,
every numeral must exist in the data we gave it (the model once relabeled
m³/s as "cfs" — caught and recorded as a regression fixture), the status
word must equal the computed one, and banned words are absent. Any
failure falls back to a plain template. The site never depends on the
model.

## How it's built

```
Next.js 16 + TypeScript  ──── the app (PPR, dark "Indus Silt" theme)
        │
Tiger Data (Postgres + pgvector) ──── 17k+ daily readings, embedded notes
        │
FastAPI + TabPFN ──── 7-day flow bands, CPU-only, backtested
        │
SerpApi ──── weekly scout, budget-capped, EN + UR queries
        │
Hosted Gemma ──── one validated sentence per river
        │
Temporal (dev) / in-process loop (prod) ──── the weekly heartbeat
        │
Resend ──── "the Kunhar is in range" email
```

A few decisions worth explaining:

**TabPFN for prediction.** No local GPU, no training loop, no MLOps. TabPFN
gives calibrated uncertainty out of the box — which matters because the
product renders a *band* with published error margins, not a point. The
backtest harness hides real past weeks and scores the model; coverage
metrics live in the repo, misses included. Honesty applies to my own model
too.

**Temporal for durability.** The watcher must survive laptop reboots and
crashed runs. Temporal gives retries, catch-up, and kill-mid-run resume.
The workflow tests literally kill activities mid-cycle and assert the run
completes with zero duplicate rows. For the free-tier production deploy the
same activities run in a worker-internal durable loop — the decision and
its measured reasoning are recorded as an ADR in the repo.

**pgvector with a twist: embeddings cost $0.** The scout's access notes are
embedded locally with all-MiniLM-L6-v2 (384 dims, running via
transformers.js — no API, no key) and searched with pgvector's cosine
distance. "Where can I put in near Kaghan?" returns actual sourced notes.

**Urdu scouting.** Pakistan's operator knowledge is mostly in Urdu. The
scout runs native-script queries (کنہار رافٹنگ and friends) with
Pakistan-geo search parameters, gated by a relevance check so a Colorado
guidebook never contaminates a Swat range candidate. That gate exists
because on the very first cycle, US rivers *did* leak in — the failure is
kept as a fixture so it can't happen again.

**The whole thing runs on free tiers.** Audited, not vibes: `npm run
cost-audit` reads the live database and exits non-zero if any ceiling
(SerpApi 90/month, AI Studio daily quota, Tiger Data storage, Resend) is
crossed. Current state: 16 MB of 256 MB, 12 of 90 searches, single-digit
LLM calls per day.

![River detail with verified band](PLACEHOLDER: river_indus-besham.png)

## What the QA gate looks like

Because the product makes safety-adjacent claims, it has a safety-adjacent
test culture:

- **The honesty sweep** — banned words, verbatim danger copy, provenance
  with dates — is executable Playwright, not a style guide.
- **axe-core audits every route**; the audit found a real issue (links
  distinguishable by color only) which is now fixed with a permanent
  regression test.
- **Five failure drills** are rehearsed with recorded evidence: Flood API
  down (dashboard serves stored data), database unreachable (no 500s),
  LLM key invalid (fallback sentences, nothing stored), predict service
  down (retro page still renders), worker killed mid-cycle (workflow
  resumes, zero duplicates).
- **Invariant tests** encode the data dictionary: a range claim without a
  quote cannot exist in the database; a verified range without a source
  cannot exist; a scout budget cannot be blown.

## What I'd build next

- A public API and per-club subscriptions (still no accounts — v1 is
  accountless by design)
- More rivers once cells are validated against local knowledge
- Gauge cross-references where Pakistan's irrigation data is published
- A public "range candidates" review queue so paddlers can help verify

## Try it

- **Live app:** PLACEHOLDER: render URL
- **Code:** [github.com/abubakar-ahmed-dev/paddle-sense](https://github.com/abubakar-ahmed-dev/paddle-sense)
  (this post's repo — docs folder has the full PRD, architecture decision
  records, QA report, and cost audit)

If you paddle in Pakistan — or anywhere with rivers and no paddling
tooling — I'd genuinely like to know what you'd want it to watch next.
Drop a comment.

---

*Built for the DEV Hacktoberfest 2026 challenge. Free data, free tiers,
open-weight model — $0 to run, and honest about every number it shows you.*
