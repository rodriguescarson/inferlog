import { gateway } from "@ai-sdk/gateway";
import { groq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

/**
 * Multi-provider model registry.
 *
 * Two routing strategies, chosen per model:
 *   - `groq`    : called DIRECTLY via @ai-sdk/groq using GROQ_API_KEY. No card,
 *                 no gateway — works the moment the key is set. This is the
 *                 default so the live demo generates out of the box.
 *   - `gateway` : routed through the Vercel AI Gateway (one credential, every
 *                 provider). On Vercel it's OIDC-authenticated, but the gateway
 *                 requires a billing method on the team to service requests.
 *
 * Either way, swapping models is a dropdown change, not a code change — which
 * is the whole point of "multi-provider support".
 */
export interface ModelDef {
  id: string; // provider-native model id
  label: string;
  provider: string;
  /** how to instantiate the model */
  via: "groq" | "gateway";
}

export const MODELS: Record<string, ModelDef> = {
  // ── Groq (direct, no card needed) ──────────────────────────────────────────
  "llama-3.3-70b": {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    provider: "groq",
    via: "groq",
  },
  "llama-3.1-8b": {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B (instant)",
    provider: "groq",
    via: "groq",
  },
  "gpt-oss-120b": {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: "groq",
    via: "groq",
  },
  // ── Vercel AI Gateway (needs gateway billing enabled) ───────────────────────
  "claude-sonnet": {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5 (gateway)",
    provider: "anthropic",
    via: "gateway",
  },
  "gpt-4.1": {
    id: "openai/gpt-4.1",
    label: "GPT-4.1 (gateway)",
    provider: "openai",
    via: "gateway",
  },
  "gemini-flash": {
    id: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash (gateway)",
    provider: "google",
    via: "gateway",
  },
};

export const DEFAULT_MODEL_KEY = "llama-3.3-70b";

export function resolveModel(key: string): {
  model: LanguageModel;
  def: ModelDef;
} {
  const def = MODELS[key] ?? MODELS[DEFAULT_MODEL_KEY];
  const model = def.via === "groq" ? groq(def.id) : gateway(def.id);
  return { model, def };
}

export function listModels() {
  return Object.entries(MODELS).map(([key, def]) => ({ key, ...def }));
}
