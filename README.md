# inferlog

A lightweight **chatbot + LLM inference logging & ingestion system**. Every model call is wrapped by a small observability SDK that captures latency, token usage, status, and PII-redacted previews, then ships them near-real-time to an ingestion API that validates, redacts, and stores them in Postgres. A live dashboard reads back latency / throughput / error metrics.

> Built as one deployable Next.js app so the whole loop — chat → SDK → ingestion → DB → dashboard — is easy to read and run. The SDK, ingestion service, and storage are cleanly separated and could be split into independent services without touching the producers (see [ARCHITECTURE.md](./ARCHITECTURE.md)).

**Live demo:** https://inferlog.vercel.app · **Dashboard:** https://inferlog.vercel.app/dashboard

> Note: the chatbot's live generation requires the Vercel team's AI Gateway to have a payment method on file (it then draws on free credits). The full **logging / ingestion / dashboard / guardrail / redaction** pipeline is live and exercisable without it — the dashboard above is populated from real events flowing through the ingestion API.

---

## What's inside

| Requirement | Where |
|---|---|
| Multi-turn chatbot, short context, simple UI | `src/components/ChatApp.tsx`, `src/app/api/chat/route.ts` |
| Lightweight SDK / wrapper capturing inference metadata | `src/lib/observe/` |
| Sends logs to ingestion in near real-time | in-process `persistEvents` by default; HTTP `transport.ts` when `INGEST_URL` set (+ Next `after()`) |
| Ingestion API: receive → validate → extract → store | `src/app/api/ingest/route.ts` |
| DB storage: messages, inference logs, extracted metadata | `src/db/schema.ts` |
| **Multi-provider** (Anthropic/OpenAI/Google/xAI) | `src/lib/providers.ts` via Vercel AI Gateway |
| **Streaming** responses | AI SDK `streamText` → `useChat` |
| **Latency + throughput + error dashboards** | `src/app/dashboard`, `src/db/queries.ts` |
| **Docker Compose** one-command setup | `docker-compose.yml` |
| **Event-based architecture** | `src/lib/observe/events.ts` (bus) → transport |
| **PII redaction** | `src/lib/observe/redact.ts` (SDK + ingest boundary) |
| **Guardrails + rate limiting** | `src/lib/guardrails.ts`, `src/lib/ratelimit.ts` |
| Frontend: cancel / list / resume conversations | sidebar + `stop()` + `/api/conversations` |

---

## Quick start

### Option A — Docker Compose (one command)

```bash
export AI_GATEWAY_API_KEY=...   # from vercel.com → AI Gateway (one key, all providers)
docker compose up --build
```

Postgres comes up with the schema auto-applied (the drizzle-generated DDL is mounted as init SQL), the app builds and serves on **http://localhost:3000**. No migration step.

### Option B — Local dev

```bash
pnpm install
cp .env.example .env            # fill DATABASE_URL + AI_GATEWAY_API_KEY

# bring up just Postgres (or point DATABASE_URL at any Postgres)
docker run -d --name inferlog-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=inferlog postgres:16-alpine

pnpm db:push        # apply schema
pnpm seed           # optional: synthetic telemetry so the dashboard isn't empty
pnpm dev            # http://localhost:3000
```

> **LLM credentials:** models route through the **Vercel AI Gateway**. On Vercel it's auto-authenticated (OIDC) — no key needed in prod. Locally, set `AI_GATEWAY_API_KEY`. Everything *except* live generation (ingestion, dashboards, guardrails, redaction) runs fine without a key.

---

## Environment

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Any Postgres. Use the *pooled* string for Supabase/Neon. |
| `AI_GATEWAY_API_KEY` | local only | Prod uses Vercel OIDC. |
| `INGEST_TOKEN` | yes | Shared bearer token guarding `/api/ingest`. |
| `INGEST_URL` | no | Point the SDK at a separate ingestion service. Defaults to same-origin. |
| `DB_POOL_MAX` | no | Pool size (default 5). |

---

## Schema design decisions

Three tables (`src/db/schema.ts`):

- **`conversations`** — one row per chat session; the unit the UI lists/resumes. Carries `session_id` (owner), the active `model`/`provider`, and a `status` (`active` / `cancelled` / `archived`).
- **`messages`** — the durable transcript. Product data: must survive, user-facing.
- **`inference_logs`** — one row per LLM call. Telemetry: high-volume, samplable, expirable.

**Key tradeoffs:**

1. **Messages and logs are separate tables.** A message is a product artifact; a log is metrics. They have opposite retention and write-amplification profiles, so coupling them would force the transcript to inherit the cost model of telemetry. They link by `message_id` (nullable FK).
2. **Promote what you query, bag the rest.** Columns we filter/aggregate on — `latency_ms`, `ttfb_ms`, `*_tokens`, `status`, `model`, `created_at` — are typed columns with indexes. Provider-specific extras (cache hits, reasoning tokens, safety scores) ride in a `metadata` JSONB column, so new fields don't need a migration.
3. **`request_id` is a unique idempotency key.** The fire-and-forget transport can retry; the ingest upsert (`on conflict (request_id) do nothing`) makes duplicate delivery safe — no double-counting.
4. **Indexes match the dashboard's access patterns:** `(created_at)`, `(status, created_at)`, `(model, created_at)` serve the time-series rollups and filters; `(session_id, updated_at)` serves the conversation list.
5. **Previews, not payloads.** We store truncated, PII-redacted previews — never full prompt/response bodies. Cheaper, and it bounds privacy exposure.

---

## Tradeoffs made

- **One app instead of microservices.** The SDK/ingestion/storage are decoupled in code (separate modules, an event bus seam, a token-authed HTTP boundary) but deploy as one Next.js app. This is the right call for a take-home: trivial to run and read, and the seams are real enough to split later. A standalone ingestion service is an `INGEST_URL` change away.
- **In-memory rate limiter.** Correct for a single instance / the demo. On serverless fan-out each instance keeps its own counter, so the effective limit is `limit × instances`. The call sites are unchanged when swapped for Upstash Redis (`INCR`+`EXPIRE`).
- **Regex PII redaction.** Fast, deterministic, dependency-free — catches emails, phones, cards, SSNs, IPs, API keys. It won't catch names/addresses (needs an NER model). Applied at *both* the SDK and the ingest boundary (defense in depth).
- **`after()` for log flushing.** Logs are sent after the user's stream is flushed, so observability never adds latency to the chat. The transport never throws into the hot path.
- **Synchronous DB writes at ingest.** Simple and durable for this volume. The honest scaling path is a queue/stream between the endpoint and the DB — see ARCHITECTURE.md.

---

## What I'd improve with more time

- **Real broker** (Kafka / QStash / Redis Streams) behind the event bus, with a batching consumer and a dead-letter queue, instead of per-request HTTP flush.
- **Distributed rate limiting + WAF** (Upstash / Vercel Firewall) and per-user quotas.
- **Rollup tables / continuous aggregates** (or Timescale/ClickHouse) so the dashboard reads pre-aggregated buckets instead of scanning raw logs.
- **Model-based moderation** (Llama Guard / OpenAI moderation) layered on the regex guardrail, plus output-side guardrails.
- **Cost tracking** (per-token pricing → $ per conversation/model) and alerting on error-rate/latency SLO breaches.
- **Auth** (real sessions/users instead of a localStorage session id) and RLS.
- **Tests**: unit tests for redaction/guardrails, a contract test for the ingest schema, an e2e for the chat loop.

---

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm db:push` | Apply schema to `DATABASE_URL` |
| `pnpm db:generate` | Regenerate migration SQL (also the Docker init SQL) |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm seed` | Insert synthetic telemetry |

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the ingestion flow, logging strategy, scaling, and failure-handling assumptions.

---

Stack: Next.js 16 (App Router) · AI SDK v6 + Vercel AI Gateway · Drizzle ORM · Postgres · Tailwind · Recharts.
