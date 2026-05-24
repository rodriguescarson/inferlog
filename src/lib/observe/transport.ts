import { inferenceEventSchema, type InferenceEvent } from "./types";

/**
 * Transport: gets a validated InferenceEvent to the ingestion endpoint.
 *
 * Design goals:
 *  - Never block or throw into the chat hot-path. Logging failures must not
 *    break the user's response.
 *  - Near real-time: we POST as soon as we have the event (no long buffering),
 *    but the caller runs us inside Next's `after()` so it happens AFTER the
 *    user's stream is flushed.
 *  - Idempotent at the sink: every event carries a unique `requestId`, so a
 *    retried POST upserts rather than duplicates.
 *
 * INGEST_URL lets you point the SDK at a *separate* ingestion service. Default
 * is same-origin `/api/ingest`, which is what the demo deployment uses.
 */
function ingestUrl(): string {
  const base =
    process.env.INGEST_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/ingest`
      : "http://localhost:3000/api/ingest");
  return base;
}

const INGEST_TOKEN = process.env.INGEST_TOKEN ?? "dev-ingest-token";
const MAX_RETRIES = 1;

export async function sendEvents(events: InferenceEvent[]): Promise<void> {
  if (events.length === 0) return;

  // Validate client-side too — fail fast and never send garbage over the wire.
  const valid = events.filter((e) => inferenceEventSchema.safeParse(e).success);
  if (valid.length === 0) return;

  const body = JSON.stringify({ events: valid });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(ingestUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${INGEST_TOKEN}`,
        },
        body,
        // keepalive helps the request survive a terminating serverless instance
        keepalive: true,
      });
      if (res.ok) return;
      // 4xx (bad payload / auth) won't get better on retry — bail.
      if (res.status >= 400 && res.status < 500) {
        console.error(`[observe] ingest rejected ${res.status}`);
        return;
      }
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error("[observe] ingest transport failed:", err);
      }
    }
    // simple linear backoff
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
  }
}
