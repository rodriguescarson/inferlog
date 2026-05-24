# Architecture notes

## System at a glance

```
 ┌─────────────┐   UIMessage    ┌──────────────────────────────────────────┐
 │  Browser    │  stream (SSE)  │  /api/chat  (Next.js route, Node runtime)  │
 │  useChat    │ ◀───────────── │                                            │
 │  + sidebar  │ ─────────────▶ │  1. rate limit (session)                   │
 └─────────────┘   send msg     │  2. guardrails (length / injection)        │
        ▲                       │  3. persist conversation + user message    │
        │ list/resume/cancel    │  4. observeStreamText(...)  ── AI Gateway ─▶ provider
        │                       │        │  capture: latency, ttfb, tokens,   │
 ┌──────┴───────┐               │        │  status, redacted previews         │
 │ /api/convers.│               │        ▼                                    │
 │ /api/stats   │               │   emit InferenceEvent ─▶ [event bus]        │
 └──────┬───────┘               └────────────────────────────┬───────────────┘
        │ read                             after() flush      │ HTTP POST (token)
        ▼                                                     ▼
 ┌─────────────┐    SQL rollups    ┌───────────────────────────────────────┐
 │  Dashboard  │ ◀──────────────── │  /api/ingest                          │
 │  (recharts) │                   │  authN → throttle → validate(zod)     │
 └─────────────┘                   │  → redact (defense-in-depth)          │
                                   │  → idempotent upsert                  │
                                   └───────────────────┬───────────────────┘
                                                       ▼
                                        ┌───────────────────────────────┐
                                        │ Postgres                      │
                                        │ conversations / messages /    │
                                        │ inference_logs (+JSONB meta)  │
                                        └───────────────────────────────┘
```

## Ingestion flow

1. **Capture (SDK).** `observeStreamText` (`src/lib/observe/index.ts`) wraps the AI SDK's `streamText`. It records start time, the time-to-first-token (first `onChunk`), and on completion reads token usage + finish reason from `onFinish` (or the error from `onError`). It builds an `InferenceEvent`, redacts the input/output previews, and hands it off.
2. **Decouple (event bus).** The event is emitted on an in-process bus (`events.ts`). Producers never know the sink. This is the seam where a real broker (Kafka/QStash/SQS) plugs in.
3. **Ship.** Two sinks share one code path (`persistEvents` in `store.ts`) so they can't drift:
   - **In-process (default).** When the chatbot and the pipeline are the same deployment, `recordInference` calls `persistEvents` directly — no network hop. This is robust and fast on serverless, where a self-HTTP call to one's own deployment URL is fragile (deployment-protected URLs, token bootstrapping, extra latency).
   - **HTTP (external).** Set `INGEST_URL` and the SDK's `transport.ts` POSTs batches to `/api/ingest` with a bearer token instead — retry-once, `keepalive`, never throws. This is the path a *separate* service or a browser/edge SDK would use.

   Either way the call happens inside Next's `after()`, so it runs **after** the user's stream is flushed — zero added latency.
4. **Ingest (endpoint).** `/api/ingest` runs an ordered pipeline: **authN** (token) → **throttle** (rate limit) → **validate/parse** (zod schema is the contract gate; malformed batch → `400`, no partial writes) → **extract** (promote queryable fields to columns, bag the rest in JSONB) → **redact** (again, at the trust boundary) → **store** (idempotent upsert on `request_id`).
5. **Read (dashboard).** `/api/stats` computes rollups in SQL (`percentile_cont` for p95, `filter` aggregates for error/blocked counts, `date_trunc` for hourly buckets). The dashboard polls every 5s.

## Logging strategy

- **What we log:** model, provider, status (`success` / `error` / `blocked`), total + time-to-first-token latency, input/output/total tokens, finish reason, error message, redacted previews, conversation/message ids, and a free-form JSONB metadata bag.
- **Fire-and-forget, never blocking.** Telemetry failure must never degrade the product. Every capture path is wrapped in try/catch and runs post-response.
- **Idempotent by design.** Each event carries a client-generated `request_id`; the sink upserts on it. Safe to retry, safe to deliver twice.
- **Three statuses, one table.** Blocked-by-guardrail requests are logged too (`status='blocked'`, with the guardrail code in metadata) so the dashboard reflects what the system *refused*, not just what it served.
- **Previews not payloads.** Previews are truncated (≤500 chars) and PII-redacted before they ever leave the chat process.

## Scaling considerations

| Layer | Today | Next step |
|---|---|---|
| Ingestion | Synchronous DB upsert per request | Queue/stream (QStash/Kafka) + batching consumer; endpoint just enqueues |
| Throughput | Single Postgres, indexed by time/status/model | Read replica for dashboards; partition `inference_logs` by day |
| Dashboard reads | Aggregate raw rows on each poll | Continuous aggregates / rollup tables (Timescale) or ClickHouse for OLAP |
| Rate limiting | In-memory per instance | Upstash Redis `INCR`+`EXPIRE` (atomic, shared) |
| Connections | Small pool, `prepare:false` | PgBouncer / Supabase / Neon pooler in front |
| Provider calls | Vercel AI Gateway (one hop, multi-provider, OIDC) | Gateway also gives failover + per-model routing + spend caps |
| Retention | Keep everything | TTL / sampling on logs; transcripts kept longer than telemetry |

The decoupling that matters is already in place: producers emit events, a token-authed HTTP boundary separates capture from storage, and the SDK can target a *different* ingestion host via `INGEST_URL`. Splitting ingestion into its own service is config, not a rewrite.

## Failure-handling assumptions

- **Provider/gateway error** → captured as an `error` inference log (with message + latency), surfaced to the user as a stream error, conversation stays resumable.
- **Ingestion down / 5xx** → transport retries once then drops the event (logged to stderr). We accept *at-most-once with best-effort retry* for telemetry: losing a metric is acceptable; slowing a user is not. (A broker upgrades this to at-least-once.)
- **Duplicate delivery** → idempotent upsert dedupes on `request_id`.
- **Malformed payload** → rejected wholesale at the zod gate (`400`); never a partial/garbage write.
- **Bad/missing auth on ingest** → `401`. **Over-limit** → `429` with `Retry-After`.
- **Client disconnect / Stop button** → `req.signal` aborts the provider call (`abortSignal`); partial output captured. Conversations can also be soft-`cancelled`/`archived` without deleting history.
- **Guardrail trip** → `422` to the client, `blocked` event logged; no provider spend.
- **DB unavailable at ingest** → `500`; the chat response itself already streamed (persistence of the assistant turn runs in `after()` and is best-effort).
- **PII leak risk** → mitigated at two layers (SDK + ingest); only previews are stored, never full bodies.

## Why these choices (decoupling seams)

- The **event bus** (`events.ts`) keeps the chat path ignorant of how logs are stored.
- The **HTTP ingest boundary** with a shared token means the SDK and the pipeline are already separate services in everything but deployment topology.
- **Drizzle + plain Postgres** keeps storage portable (local Docker, Supabase, Neon, Vercel Postgres) — no managed-service lock-in.
- **Vercel AI Gateway** turns "multi-provider support" into a registry + dropdown rather than per-provider SDK wiring and key management.
