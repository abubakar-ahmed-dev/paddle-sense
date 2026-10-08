# Needs & Requirements — what the implementation needs from the owner

Single place for credentials, accounts, and decisions the agent needs from the
repository owner, mapped to the phase that needs them. The agent reminds the
owner at phase start; the owner does not need to remember.

## Secret-handling rules

- Owner provides secrets however is convenient (chat, Bitwarden send, etc.);
  the agent's only job is to place them into a **git-ignored `.env`** and the
  Render env bindings. Secrets never appear in plans, logs, docs, commits, or
  screenshots.
- Every secret here is a **free-tier** credential. None may be created before
  its phase needs it (avoids abandoned accounts and expired keys).

## Per-phase needs

| Phase | Need | Type | Status |
|---|---|---|---|
| 1 (done) | GitHub repo `paddle-sense` + SSH remote access | access | ✅ provided |
| 3 | **Tiger Data** free account → connection string (`DATABASE_URL`) | secret | ⬜ pending |
| 4 | `X_INTERNAL_TOKEN` — agent generates randomly; owner approves storage in env | secret | ✅ provided (generated into `.env` 2026-10-09) |
| 5 | **SerpApi** free account → `SERPAPI_KEY` | secret | ⬜ pending |
| 6 | Hosted Gemma key — **Google AI Studio** (`LLM_API_KEY`) unless owner prefers Groq/Together | secret + decision | ⬜ pending |
| 7 | Decision: email nudge on/off; if on — provider (**Resend** vs Gmail SMTP), `NOTIFY_EMAIL_KEY`, recipient address | decision + secret | ⬜ pending |
| 9 | **Render** account with deploy access (web + worker + predict services) | access | ⬜ pending |
| 9 (optional) | **Sentry** free account → `SENTRY_DSN` | secret | ⬜ optional |
| 10 | **dev.to** account in owner's name (post must be published by the owner) | access | ⬜ pending |

## Decisions the owner owes (not secrets)

| Decision | Needed by | Default if owner says "agent's choice" |
|---|---|---|
| Hosted Gemma provider | Phase 6 | Google AI Studio |
| Email nudge on/off + provider | Phase 7 | On, via Resend free tier |
| ElevenLabs audio briefing in/out (stretch) | Phase 9 | Out if schedule is tight |
| Tinker fine-tune in/out (stretch) | Phase 6 | Out if Phase 5–6 slip |

## Environment prerequisites (owner machine)

| Need | Status |
|---|---|
| Node.js + npm | ✅ verified (build runs) |
| Git + SSH (`github-personal` alias) | ✅ verified (pushes work) |
| Python 3.10+ (Phase 4 predict service) | ✅ verified 3.13.7 (2026-10-09) |
| Docker | **not required** (Temporal dev binary; Tiger Data is cloud) |
| Local disk for `.next`, `node_modules` | ✅ fine |

## Logs

When the owner provides a need, the agent records **only** "provided ✓" with
the date in the matching phase's `implementation-logs.md` — never the secret
itself.
