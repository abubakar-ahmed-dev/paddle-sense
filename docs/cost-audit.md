# Cost audit — PaddleSense runs on $0

| | |
|---|---|
| Purpose | The $0 claim, proven with numbers instead of asserted. Regenerate any time: `npm run cost-audit` |
| Snapshot | 2026-10-11 (regenerate for fresh numbers — this file records the method + the audited state) |
| Verdict | **Every dimension inside its free tier, with wide margins.** |

The script (`scripts/cost-audit.mjs`) reads the live database and exits 1 if
anything is over its ceiling — the audit is repeatable, not a one-off claim.

## Snapshot 2026-10-11

| Dimension | Used | Free-tier ceiling | Margin | Source of ceiling |
|---|---|---|---|---|
| SerpApi live searches (Oct) | 12 | 90 / month (10 of the free 100 reserved for in-season manual checks) | 13% | Phase 5 budget ledger hard-stop (invariant S2) |
| LLM summaries stored | 8 all-time; ≤ ~10 calls on the heaviest day incl. fallback retries | 200 requests/day (AI Studio free tier, Gemma) | ~5% of a single day's quota | Google AI Studio pricing page |
| Resend emails | 1 (kunhar range-crossing, 2026-10-11) | 3,000 / month (100 / day) | — | Resend free plan |
| Database size | 16 MB | 256 MB (Tiger Data free plan) | 6% | Tiger Data plan page |

Row counts behind the size number: readings 17,204 · predictions 420 ·
sources 32 · notes 31 · scout_queries 12 · summaries 8.

## Honest notes on the numbers

- **LLM accounting is bounded, not metered.** The DB stores provenance
  (model, cycle date) but not token counts, so the audit bounds usage:
  worst case = one call per river per cycle (4) + one retry per failed
  gate (observed ≤ 2 in a bad cycle). Even 10× the worst observed day is
  under the free tier's daily request ceiling.
- **The email count is an upper bound** (one per in-range summary). The
  nudge only fires on a fresh stored summary AND a transition INTO range,
  so real sends are far below the bound.
- **Embeddings cost $0 by construction**: all-MiniLM-L6-v2 runs locally via
  `@xenova/transformers` — no API, no key, no quota.
- **The watcher runs on the developer's machine today** (Temporal dev
  server); production hosting is the Phase 9 decision (Render free tiers)
  and will get its own cost line there.
- Ceilings are provider-published free-tier limits at audit time; the
  script's constants carry the same numbers and are the place to update if
  a provider changes its plan.
