/**
 * Input guardrails — run BEFORE we spend a token on the provider.
 *
 * Cheap, deterministic, in-process checks. Three jobs:
 *   1. Bound the request (length / message count) — protects cost + context.
 *   2. Block trivially abusive / injection-y inputs with a denylist.
 *   3. Surface a structured reason so the route can log a `blocked` event.
 *
 * This is intentionally NOT a model-based safety classifier. For production
 * you'd layer a moderation model (OpenAI moderation / Llama Guard) on top —
 * see ARCHITECTURE.md. The point here is a fast first gate.
 */

export interface GuardrailResult {
  ok: boolean;
  reason?: string;
  code?: "too_long" | "empty" | "too_many_messages" | "blocked_content";
}

const MAX_CHARS = 8_000;
const MAX_MESSAGES = 50;

// crude prompt-injection / abuse denylist — illustrative, case-insensitive
const DENYLIST: RegExp[] = [
  // "ignore (all|the|your)? (previous|prior|above)? instructions" and variants
  /\bignore\b[\s\w]*\binstructions\b/i,
  /\b(disregard|forget|override)\b[\s\w]*\b(system prompt|instructions|rules)\b/i,
  /\bdrop\s+table\b/i,
];

export function checkInput(text: string): GuardrailResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, code: "empty", reason: "Message is empty." };
  }
  if (trimmed.length > MAX_CHARS) {
    return {
      ok: false,
      code: "too_long",
      reason: `Message exceeds ${MAX_CHARS} characters.`,
    };
  }
  for (const re of DENYLIST) {
    if (re.test(trimmed)) {
      return {
        ok: false,
        code: "blocked_content",
        reason: "Input was blocked by a safety guardrail.",
      };
    }
  }
  return { ok: true };
}

export function checkConversation(messageCount: number): GuardrailResult {
  if (messageCount > MAX_MESSAGES) {
    return {
      ok: false,
      code: "too_many_messages",
      reason: `Conversation exceeds ${MAX_MESSAGES} messages. Start a new one.`,
    };
  }
  return { ok: true };
}

export const GUARDRAIL_LIMITS = { MAX_CHARS, MAX_MESSAGES };
