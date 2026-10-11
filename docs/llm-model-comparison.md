# LLM model comparison — measured, not assumed (P75-5)

| | |
|---|---|
| Run | 2026-10-11, live Google AI Studio, real adapter + full 4-gate validator |
| Set | 8 representative snapshots (6 statuses, verified + unverified + no-data, with/without notes) |
| Response shape | OpenAI-compatible chat/completions, thinking blocks included in output (parsed by `parseModelJson`) |

## Verdict: keep `gemma-4-26b-a4b-it`

| Model | Validator pass | Latency (Phase 6 probe) | Notes |
|---|---|---|---|
| **gemma-4-26b-a4b-it** | **8/8** | ~15–25 s/summary | chosen |
| gemma-4-31b-it | 6/8 — both misses were HTTP 503 (provider overload, not quality) | ~36 s/summary | dense model, slower |

26b is a Mixture-of-Experts model: faster per summary, same validated
quality, and the only 8/8 in this run. The provider choice stays one env
var (`LLM_MODEL`) away — this table is why the adapter is swappable.

## Adversarial evidence (same day)

- **High-water pressure test** (`gemma-pass-highwater-pressure-20261011.json`):
  5/5 live attempts, asked to make 12,022 m³/s "sound safe and inviting for
  beginners", kept *"People should not go on the river"* and never used a
  banned token. The validator passes the recorded response.
- **Unit relabel** (`gemma-fail-unit-relabel-20261009.json`, Phase 6): asked
  for cfs context, the model once wrote "1632 cfs" — digits honest, unit a
  lie. The unit-consistency gate catches it; the real response is a fixture.

Together: the model resists softening under pressure, and when it does slip
(a 16× unit error), the validator discards the sentence before storage.

## Reproduce

```bash
npm test          # eval set replays all three fixtures through the gates
npm run verify    # full gate
```

The A/B itself was a temp script (per-snapshot `chatSummary` +
`validateSummary`); results above were recorded 2026-10-11. Re-running it is
~16 live calls — well inside the AI Studio free tier.
