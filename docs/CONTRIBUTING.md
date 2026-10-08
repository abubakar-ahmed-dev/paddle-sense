# Contributing to PaddleSense

Solo-builder project (for now) — this file keeps the discipline that keeps quality high when one person does everything.

## Branch model

- `main` — stable only. Never commit directly.
- `dev` — integration. Default working branch.
- `phase/<n>-<name>` — one branch per plan phase (`phase/2-ui`), merged into `dev` when its exit criteria pass ([plans/plan.md](../plans/plan.md)).
- Fixes: `fix/<short-desc>` off `dev`.

## Commits

Conventional Commits, present tense:

```
feat: range band overlay on river detail
fix: NULL discharge rendered as 0 on Malir card
docs: add runbook entries for cell-drift checks
test: status truth table for range_unverified precedence
chore: record serpapi fixture for kunhar range query
```

Scope small: one logical change per commit; docs travel with the behavior they describe.

## Definition of done (any change)

1. `npm run verify` green (lint + typecheck + tests + build)
2. New behavior has a test or an explicit reason it can't ([TESTING.md](TESTING.md))
3. If behavior changed, docs changed ([DATA_DICTIONARY](DATA_DICTIONARY.md)/[API.md](API.md)/[UX_SPEC.md](UX_SPEC.md) as applicable)
4. No secrets, no live API calls in tests, no new dependencies without a one-line justification in the commit body

## Honesty checklist (features that display data)

- [ ] Every number shows its source + date (provenance prop)
- [ ] No green "safe"; danger copy verbatim from [UX_SPEC.md](UX_SPEC.md) §6
- [ ] Unknown states say "not yet verified" — never blank, never guessed
- [ ] Bands stay bands; no point predictions in UI

## Code style

- TypeScript strict, no `any`; external services behind adapters (`lib/flood.ts`, `lib/scout.ts`, `lib/llm.ts`) — UI never calls a provider directly
- Config over literals: rivers, cells, ranges live in `lib/rivers.ts` / DB, never inline
- Comments explain why, not what; match surrounding density
