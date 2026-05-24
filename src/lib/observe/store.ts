import { db } from "@/db/client";
import { inferenceLogs } from "@/db/schema";
import { redact } from "./redact";
import type { InferenceEvent } from "./types";

/**
 * persistEvents — the single source of truth for turning validated
 * InferenceEvents into rows.
 *
 * Shared by BOTH ingestion paths so they can't drift:
 *   - the HTTP `/api/ingest` endpoint (external SDK clients), and
 *   - the in-process recorder (`recordInference`), which calls this directly
 *     instead of POSTing to itself. The self-HTTP hop was fragile on
 *     serverless (deployment-protected URLs, token bootstrapping, extra
 *     latency); an in-process write is both more robust and faster, while the
 *     HTTP boundary stays available for true cross-service use.
 *
 * Redaction runs here too — the last gate before bytes hit the database.
 */
export async function persistEvents(events: InferenceEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  const rows = events.map((e) => ({
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
    // defense-in-depth: re-redact regardless of source
    inputPreview: e.inputPreview ? redact(e.inputPreview).text : null,
    outputPreview: e.outputPreview ? redact(e.outputPreview).text : null,
    metadata: (e.metadata ?? null) as Record<string, unknown> | null,
    createdAt: e.timestamp ? new Date(e.timestamp) : new Date(),
  }));

  await db
    .insert(inferenceLogs)
    .values(rows)
    .onConflictDoNothing({ target: inferenceLogs.requestId });

  return rows.length;
}
