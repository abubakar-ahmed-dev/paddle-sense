# PaddleSense — Documentation Index

Read in this order when joining the project (or re-orienting after a break):

| # | Doc | One line | Answer it gives |
|---|---|---|---|
| 1 | [../README.md](../README.md) | Project front page | What is this? |
| 2 | [PRD.md](PRD.md) | Product requirements | What are we building, for whom, and what does "done" mean? |
| 3 | [deep-dive.md](deep-dive.md) | Research & validation | Why this product, why these rivers/cells, what did we verify? |
| 4 | [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | System design | How is it built and why each choice? |
| 5 | [DATA_DICTIONARY.md](DATA_DICTIONARY.md) | Schema & vocabularies | What does every field mean and what invariants hold? |
| 5b | [TECHNOLOGIES.md](TECHNOLOGIES.md) | Per-technology evidence | How is each partner technology actually used, and how do I verify it in a minute? |
| 6 | [API.md](API.md) | Interface contracts | What endpoints exist, in and out? |
| 7 | [UX_SPEC.md](UX_SPEC.md) | Screen & copy rules | What does the user see, exactly? |
| 8 | [TESTING.md](TESTING.md) | Test strategy | How do we know it works — and how do bugs get caught? |
| 8b | [retro-metrics.md](retro-metrics.md) | Published prediction scores | How good is the forecast, honestly? |
| 9 | [RUNBOOK.md](RUNBOOK.md) | Debugging & operations | Something broke — symptom → cause → fix |
| 10 | [DEPLOYMENT.md](DEPLOYMENT.md) | Hosting & release | How does it reach the internet and come back from failure? |
| 11 | [CONTRIBUTING.md](CONTRIBUTING.md) | Working rules | Branches, commits, definition of done |
| 12 | [../plans/plan.md](../plans/plan.md) | Phase plan with progress | What phase are we in, what's next? |
| 13 | [../plans/CLAUDE.md](../plans/CLAUDE.md) | Phase execution instructions + per-phase folder protocol | How is each phase planned, logged, branched, and merged? |

**Doc rules:** docs travel with the behavior they describe (same PR). If code and a doc disagree, fix the code or amend the doc deliberately — never let them drift silently.
