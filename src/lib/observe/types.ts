import { z } from "zod";

/**
 * The wire contract between the SDK and the ingestion endpoint.
 * Versioned (`v`) so the pipeline can evolve the schema without breaking
 * older clients. This same schema is the validation gate on ingest.
 */
export const inferenceEventSchema = z.object({
  v: z.literal(1),
  requestId: z.string().min(1),
  conversationId: z.string().uuid().nullable().optional(),
  messageId: z.string().uuid().nullable().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  status: z.enum(["success", "error", "blocked"]),
  latencyMs: z.number().int().nonnegative().nullable().optional(),
  ttfbMs: z.number().int().nonnegative().nullable().optional(),
  inputTokens: z.number().int().nonnegative().nullable().optional(),
  outputTokens: z.number().int().nonnegative().nullable().optional(),
  totalTokens: z.number().int().nonnegative().nullable().optional(),
  finishReason: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  inputPreview: z.string().nullable().optional(),
  outputPreview: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  // client timestamp; the pipeline records its own receive time too.
  timestamp: z.string().datetime().optional(),
});

export type InferenceEvent = z.infer<typeof inferenceEventSchema>;

export const ingestBatchSchema = z.object({
  events: z.array(inferenceEventSchema).min(1).max(100),
});

export type IngestBatch = z.infer<typeof ingestBatchSchema>;
