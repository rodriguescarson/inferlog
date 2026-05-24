/**
 * Seed synthetic-but-realistic telemetry so the dashboard isn't empty in the
 * demo. Generates conversations, messages, and inference logs spread across the
 * last 24h with believable latency/token/status distributions.
 *
 *   pnpm seed
 */
import { nanoid } from "nanoid";
import { db } from "../src/db/client";
import { conversations, inferenceLogs, messages } from "../src/db/schema";
import { MODELS } from "../src/lib/providers";

const SESSION = "seed-session";
const modelKeys = Object.keys(MODELS);
const rand = (a: number, b: number) => Math.floor(a + Math.random() * (b - a));
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

const PROMPTS = [
  "Explain backpressure in streaming systems.",
  "Write a haiku about databases.",
  "What's the difference between p95 and p99 latency?",
  "How do I redact PII from logs?",
  "Summarize event-driven architecture in two sentences.",
  "Why use idempotency keys on ingestion?",
];

async function main() {
  console.log("Seeding…");
  const now = Date.now();

  for (let i = 0; i < 12; i++) {
    const mk = pick(modelKeys);
    const def = MODELS[mk];
    const convoId = crypto.randomUUID();
    const created = new Date(now - rand(0, 24) * 3_600_000);

    await db.insert(conversations).values({
      id: convoId,
      sessionId: SESSION,
      title: pick(PROMPTS).slice(0, 60),
      model: def.id,
      provider: def.provider,
      createdAt: created,
      updatedAt: created,
    });

    const turns = rand(1, 4);
    for (let t = 0; t < turns; t++) {
      const prompt = pick(PROMPTS);
      const ts = new Date(created.getTime() + t * 60_000);
      const [um] = await db
        .insert(messages)
        .values({ conversationId: convoId, role: "user", content: prompt, createdAt: ts })
        .returning({ id: messages.id });

      const isError = Math.random() < 0.08;
      const inTok = rand(20, 400);
      const outTok = isError ? 0 : rand(50, 800);

      if (!isError) {
        await db.insert(messages).values({
          conversationId: convoId,
          role: "assistant",
          content: "…(seeded assistant response)…",
          tokenCount: outTok,
          createdAt: new Date(ts.getTime() + 2000),
        });
      }

      await db.insert(inferenceLogs).values({
        requestId: nanoid(),
        conversationId: convoId,
        messageId: um.id,
        provider: def.provider,
        model: def.id,
        status: isError ? "error" : "success",
        latencyMs: isError ? rand(200, 800) : rand(400, 4500),
        ttfbMs: rand(150, 900),
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: inTok + outTok,
        finishReason: isError ? null : "stop",
        errorMessage: isError ? "provider_timeout" : null,
        inputPreview: prompt,
        outputPreview: isError ? null : "Seeded response preview…",
        metadata: { modelKey: mk, seeded: true },
        createdAt: ts,
      });
    }
  }
  console.log("Done. Open /dashboard.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
