import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { inferenceLogs } from "@/db/schema";
import { ingestBatchSchema } from "@/lib/observe/types";
import { redact } from "@/lib/observe/redact";
import { clientKey, LIMITS, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * Ingestion endpoint.
 *
 * Pipeline stages, in order:
 *   1. AuthN  — shared bearer token (INGEST_TOKEN). Keeps the world from
 *               writing junk telemetry into our store.
 *   2. Throttle — bounded writes per source.
 *   3. Validate/parse — zod is the contract gate; malformed events are
 *               rejected wholesale with a 400 (no partial garbage).
 *   4. Extract — promote the queryable fields to columns; bag the rest in JSONB.
 *   5. Store  — idempotent upsert keyed on requestId, so retried/duplicate
 *               deliveries don't double-count. This is what makes the
 *               fire-and-forget transport safe.
 */
const INGEST_TOKEN = process.env.INGEST_TOKEN ?? "dev-ingest-token";

export async function POST(req: Request) {
  // 1. authN
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${INGEST_TOKEN}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. throttle
  const rl = rateLimit(
    `ingest:${clientKey(req)}`,
    LIMITS.ingest.limit,
    LIMITS.ingest.windowMs,
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  // 3. validate
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = ingestBatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues.slice(0, 10) },
      { status: 400 },
    );
  }

  // 4. extract -> rows
  const rows = parsed.data.events.map((e) => ({
    requestId: e.requestId,
    conversationId: e.conversationId ?? null,
    messageId: e.messageId ?? null,
    provider: e.provider,
    model: e.model,
    status: e.status,
    latencyMs: e.latencyMs ?? null,
    ttfbMs: e.ttfbMs ?? null,
    inputTokens: e.inputTokens ?? null,
    outputTokens: e.outputTokens ?? null,
    totalTokens: e.totalTokens ?? null,
    finishReason: e.finishReason ?? null,
    errorMessage: e.errorMessage ?? null,
    // Defense-in-depth: the SDK already redacts, but we re-redact at the
    // trust boundary so a direct/buggy poster can never persist raw PII.
    inputPreview: e.inputPreview ? redact(e.inputPreview).text : null,
    outputPreview: e.outputPreview ? redact(e.outputPreview).text : null,
    metadata: (e.metadata ?? null) as Record<string, unknown> | null,
    createdAt: e.timestamp ? new Date(e.timestamp) : new Date(),
  }));

  // 5. idempotent store
  try {
    await db
      .insert(inferenceLogs)
      .values(rows)
      .onConflictDoNothing({ target: inferenceLogs.requestId });
  } catch (err) {
    console.error("[ingest] store failed:", err);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }

  return NextResponse.json({ accepted: rows.length }, { status: 202 });
}
