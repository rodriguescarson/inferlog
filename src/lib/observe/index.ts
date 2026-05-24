import { streamText, type StreamTextOnFinishCallback } from "ai";
import { nanoid } from "nanoid";
import { inferenceBus } from "./events";
import { makePreview } from "./redact";
import { sendEvents } from "./transport";
import type { InferenceEvent } from "./types";

export { inferenceEventSchema, ingestBatchSchema } from "./types";
export type { InferenceEvent } from "./types";
export { redact, makePreview } from "./redact";
export { sendEvents } from "./transport";
export { inferenceBus } from "./events";

/**
 * inferlog observability SDK — the "lightweight wrapper" deliverable.
 *
 * `observeStreamText` is a drop-in replacement for the AI SDK's `streamText`.
 * It returns the exact same result object (so callers keep using
 * `.toUIMessageStreamResponse()`), but transparently captures inference
 * metadata — latency, time-to-first-token, token usage, finish reason, status,
 * PII-redacted previews — and emits it to the ingestion pipeline.
 *
 * Capture is FIRE-AND-FORGET and wrapped in try/catch: nothing here can break
 * or slow the user's response. That's the cardinal rule of an observability
 * sidecar.
 */

export interface ObserveContext {
  provider: string;
  model: string;
  conversationId?: string | null;
  messageId?: string | null;
  /** raw input (latest user turn) — redacted before it leaves the process */
  inputText?: string;
  /** extra metadata bag stored as JSONB */
  metadata?: Record<string, unknown>;
}

type StreamTextArgs = Parameters<typeof streamText>[0];

/**
 * Emit one inference event onto the bus + flush it to ingestion.
 * Exported so non-streaming paths (or tests) can record manually.
 */
export async function recordInference(event: InferenceEvent): Promise<void> {
  try {
    inferenceBus.emitInference(event);
    await sendEvents([event]);
  } catch (err) {
    // swallow — telemetry must never surface to the caller
    console.error("[observe] recordInference failed:", err);
  }
}

export function observeStreamText(
  args: StreamTextArgs,
  ctx: ObserveContext,
): ReturnType<typeof streamText> {
  const requestId = nanoid();
  const startedAt = Date.now();
  let ttfbMs: number | null = null;
  const inputPreview = ctx.inputText
    ? makePreview(ctx.inputText).text
    : null;

  // Collect text deltas to build the (redacted) output preview without
  // re-reading the whole stream.
  let outputBuf = "";

  const userOnFinish = args.onFinish as StreamTextOnFinishCallback<never> | undefined;
  const userOnError = args.onError;
  const userOnChunk = args.onChunk;

  const result = streamText({
    ...args,
    onChunk(e) {
      if (ttfbMs === null) ttfbMs = Date.now() - startedAt;
      const part = e.chunk;
      if (part.type === "text-delta") outputBuf += part.text ?? "";
      userOnChunk?.(e);
    },
    async onFinish(e) {
      try {
        const usage = e.totalUsage ?? e.usage;
        const event: InferenceEvent = {
          v: 1,
          requestId,
          conversationId: ctx.conversationId ?? null,
          messageId: ctx.messageId ?? null,
          provider: ctx.provider,
          model: ctx.model,
          status: "success",
          latencyMs: Date.now() - startedAt,
          ttfbMs,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          finishReason: e.finishReason ?? null,
          errorMessage: null,
          inputPreview,
          outputPreview: makePreview(e.text || outputBuf).text,
          metadata: ctx.metadata ?? null,
          timestamp: new Date().toISOString(),
        };
        await recordInference(event);
      } catch (err) {
        console.error("[observe] onFinish capture failed:", err);
      }
      // @ts-expect-error — pass through caller's onFinish with original shape
      await userOnFinish?.(e);
    },
    async onError(e) {
      try {
        const event: InferenceEvent = {
          v: 1,
          requestId,
          conversationId: ctx.conversationId ?? null,
          messageId: ctx.messageId ?? null,
          provider: ctx.provider,
          model: ctx.model,
          status: "error",
          latencyMs: Date.now() - startedAt,
          ttfbMs,
          finishReason: null,
          errorMessage:
            e.error instanceof Error ? e.error.message : String(e.error),
          inputPreview,
          outputPreview: outputBuf ? makePreview(outputBuf).text : null,
          metadata: ctx.metadata ?? null,
          timestamp: new Date().toISOString(),
        };
        await recordInference(event);
      } catch (err) {
        console.error("[observe] onError capture failed:", err);
      }
      userOnError?.(e);
    },
  });

  return result;
}
