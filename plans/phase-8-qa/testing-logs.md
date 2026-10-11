# Phase 8 — testing log

Format: date — command — result. Only real runs recorded.

## 2026-10-11

### E2E expansion + honesty sweep

- `npm run test:e2e` (after 2 selector fixes) — **22 passed, 1 flaky-pass**
  (about-notes-search: first query loads MiniLM in dev server; fixed with
  `test.setTimeout(120_000)` + 100 s expect timeout).
  - Initial failures fixed: retro table summary text is "View every
    predicted day as a table" (not "latest readings"); provenance date
    locator needed `p.font-mono` scoping (chart-table cells also matched).
- Selector fixes committed (abd1c03).

### Axe a11y audit

- `npm install -D @axe-core/playwright`; new `tests/e2e/a11y.spec.ts`.
- First run: 4 failed — `link-in-text-block` (serious) on `/` (1 node),
  `/retro` (1), `/about` (2): ochre prose links distinguishable by color
  only. Fixed: `underline decoration-ochre/40 underline-offset-2` on all 7
  prose links (about, retro, home, river, NotesList). Committed (450fb4f).
- Re-run: **6/6 passed — zero critical/serious AND zero moderate/minor
  violations** on `/`, `/river/kunhar-balakot`, `/retro`, `/about`;
  allowlist test passed with an empty list.
- Keyboard data-table test: `summary.focus()` → `Enter` → `<details open>`
  + table visible. PASS.

### Failure drills (RUNBOOK §5)

- **D4 predict down — PASS.** Killed leftover uvicorn (PID 9160,
  `services\predict\.venv\python -m uvicorn app:app --port 8000`) →
  `curl :8000/v1/health` connection refused → `GET /retro` **200** with
  stored coverage/tabpfn rows; `GET /` 200.
- **D1 Flood API down — PASS.** Added `FLOOD_API_BASE` env override
  (commit 9f9222f); dev server with `FLOOD_API_BASE=http://127.0.0.1:9` →
  `GET /` **200**, all 4 rivers render, source label
  "GloFAS via Tiger Data (stored, through …)", **zero** "Could not load
  live data" panels.
- **D2 DB unreachable — PASS.** `DATABASE_URL=postgresql://qa:qa@127.0.0.1:9/dead`:
  - dev mode: `/` 200 (all cards fall through to live Flood API),
    `/about` 200, `/retro` 200 with thrown ECONNREFUSED in dev replay.
  - production build (`next start -p 3100`): `/` 200 with
    "Open-Meteo Flood API (live)" cards; `/retro` **200** degrading to the
    error digest page (client-hydrated boundary — not the styled
    error.tsx panel; PPR nuance recorded in qa-report); `/about` 200.
    No 500 anywhere — RUNBOOK D2 contract holds.
- **D3 Gemma down — PASS.** Dev server with `LLM_API_KEY=invalid-drill-key`;
  `POST /api/internal/summarize` → `ok:true`, all rivers
  `generatedBy:"fallback"` with verbatim §6 sentences, errors
  "LLM request failed with status 400", `stored:false`; DB: **0** summary
  rows for 2026-10-11, total unchanged (4).
- **D5 worker killed mid-cycle — PASS (with honest detour).**
  - Temporal dev server started via `./tools/temporal.exe server
    start-dev …` directly — `npm run temporal:dev` failed on Windows cmd
    with `'tools' is not recognized` (forward-slash script path; RUNBOOK
    note added).
  - Worker booted (boot gate OK), `schedule trigger weekly-cycle` →
    workflow `…T07:55:14Z` Running → **killed worker PID 5324 mid-run** →
    workflow stayed Running → worker restarted → workflow **COMPLETED**:
    `stored:14×4, predicted:3, summariesStored:3` (indus predict failed —
    drill-setup gap: uvicorn restarted WITHOUT `X_INTERNAL_TOKEN` → 503
    service_misconfigured; Temporal retried 5× with backoff, per-river
    isolation kept the rest of the cycle alive).
  - Idempotency after resume: **0 dup readings**; 2 fresh observed days ×
    4 rivers.
  - Healing cycle (`schedule trigger` again): `predicted:4×` (indus
    recovered), `summariesStored:1` (kunhar stored), **0 dup rows**, and
    **`emailsSent:["kunhar-balakot"]` — the first real range-crossing
    email** (kunhar `range_unverified` cycle 2026-10-09 → `in_range`
    today after the owner-verified 35–135 band; Resend delivered).
  - All 4 summaries today `generated_by: gemma-4-26b-a4b-it`.
- **Finding (not a product bug): kunhar schema-gate loop, cycles 1–3.**
  Gemma returned NO answer JSON — it wrote the sentence draft inside its
  `<thought>` block and terminated with `</output>` (raw captured via a
  temporary probe script; deleted). Gate 1 correctly refused; fallback
  served; cycle 4 stored a real sentence. Validator behavior per design;
  recorded as an observed model-limitation + RUNBOOK 2.4 already covers
  the symptom. Two parser regression tests added anyway (thought closed
  with `</output>`; fragment-vs-answer preference — both pass against the
  current parser, kept as permanent guards).

### Unit regression for the parser finding

- `npx vitest run tests/unit/llm.test.ts` — **30/30 passed** (28 prior + 2
  new parser-contract tests).
