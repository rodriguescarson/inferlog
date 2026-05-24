import { convertToModelMessages, type UIMessage } from "ai";
import { after, NextResponse } from "next/server";
import {
  ensureConversation,
  insertMessage,
  setConversationTitle,
  touchConversation,
} from "@/db/queries";
import { checkConversation, checkInput } from "@/lib/guardrails";
import { observeStreamText, recordInference } from "@/lib/observe";
import { nanoid } from "nanoid";
import { clientKey, LIMITS, rateLimit } from "@/lib/ratelimit";
import { DEFAULT_MODEL_KEY, resolveModel } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT =
  "You are inferlog's assistant — a concise, helpful chatbot. Keep answers tight and useful.";

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    messages?: UIMessage[];
    conversationId?: string;
    sessionId?: string;
    modelKey?: string;
  } | null;

  if (!body?.messages || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "missing_messages" }, { status: 400 });
  }

  const sessionId = body.sessionId ?? req.headers.get("x-session-id") ?? "anon";
  const conversationId = body.conversationId ?? crypto.randomUUID();
  const modelKey = body.modelKey ?? DEFAULT_MODEL_KEY;
  const { model, def } = resolveModel(modelKey);

  // 1. rate limit (chat tier, keyed by session)
  const rl = rateLimit(`chat:${sessionId}`, LIMITS.chat.limit, LIMITS.chat.windowMs);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfterSec },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  // 2. guardrails (before we touch the provider)
  const convoCheck = checkConversation(body.messages.length);
  const userText = lastUserText(body.messages);
  const inputCheck = checkInput(userText);
  const failed = !convoCheck.ok ? convoCheck : !inputCheck.ok ? inputCheck : null;

  if (failed) {
    // record a `blocked` inference log so it shows up in the dashboards
    after(
      recordInference({
        v: 1,
        requestId: nanoid(),
        // null FK: the conversation isn't persisted yet (we block before
        // creating it). Keep the attempted id in metadata for tracing.
        conversationId: null,
        provider: def.provider,
        model: def.id,
        status: "blocked",
        errorMessage: failed.reason ?? "blocked",
        metadata: { guardrail: failed.code, attemptedConversationId: conversationId },
        timestamp: new Date().toISOString(),
      }),
    );
    return NextResponse.json(
      { error: "guardrail_blocked", code: failed.code, message: failed.reason },
      { status: 422 },
    );
  }

  // 3. persist conversation + the user's turn before streaming
  await ensureConversation({
    id: conversationId,
    sessionId,
    model: def.id,
    provider: def.provider,
  });
  const isFirstTurn = body.messages.filter((m) => m.role === "user").length === 1;
  if (isFirstTurn) {
    after(setConversationTitle(conversationId, userText.slice(0, 80)));
  }
  const userMessageId = await insertMessage({
    conversationId,
    role: "user",
    content: userText,
  });

  const modelMessages = await convertToModelMessages(body.messages);

  // 4. stream via the observability wrapper. abortSignal wires the UI's
  //    "stop" button straight through to the provider call (cancellation).
  const result = observeStreamText(
    {
      model,
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      abortSignal: req.signal,
      async onFinish({ text, usage }) {
        // persist the assistant turn once the stream completes
        after(
          (async () => {
            const assistantId = await insertMessage({
              conversationId,
              role: "assistant",
              content: text,
              tokenCount: usage?.outputTokens ?? null,
            });
            await touchConversation(conversationId);
            return assistantId;
          })(),
        );
      },
    },
    {
      provider: def.provider,
      model: def.id,
      conversationId,
      messageId: userMessageId,
      inputText: userText,
      metadata: { modelKey, sessionId },
    },
  );

  // surface conversationId so a fresh chat can adopt the server id
  return result.toUIMessageStreamResponse({
    headers: { "x-conversation-id": conversationId },
  });
}
