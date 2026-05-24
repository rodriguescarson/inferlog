import { gateway } from "@ai-sdk/gateway";
import type { LanguageModel } from "ai";

/**
 * Multi-provider model registry.
 *
 * We route every model through the Vercel AI Gateway (`gateway(id)`), which
 * gives us one credential + one API for Anthropic, OpenAI, Google, xAI, etc.
 * On Vercel the gateway is auto-authenticated (OIDC); locally it uses
 * AI_GATEWAY_API_KEY. Swapping providers is a dropdown change, not a code
 * change — that's the whole point of "multi-provider support".
 */
export interface ModelDef {
  id: string; // gateway model id
  label: string;
  provider: string;
}

export const MODELS: Record<string, ModelDef> = {
  "claude-sonnet": {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
  },
  "claude-haiku": {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
  },
  "gpt-4.1": {
    id: "openai/gpt-4.1",
    label: "GPT-4.1",
    provider: "openai",
  },
  "gpt-4.1-mini": {
    id: "openai/gpt-4.1-mini",
    label: "GPT-4.1 mini",
    provider: "openai",
  },
  "gemini-flash": {
    id: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "google",
  },
  "grok-3": {
    id: "xai/grok-3",
    label: "Grok 3",
    provider: "xai",
  },
};

export const DEFAULT_MODEL_KEY = "claude-sonnet";

export function resolveModel(key: string): {
  model: LanguageModel;
  def: ModelDef;
} {
  const def = MODELS[key] ?? MODELS[DEFAULT_MODEL_KEY];
  return { model: gateway(def.id), def };
}

export function listModels() {
  return Object.entries(MODELS).map(([key, def]) => ({ key, ...def }));
}
