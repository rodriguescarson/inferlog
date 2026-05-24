/**
 * PII redaction.
 *
 * Runs on every preview string BEFORE it leaves the chat process for the
 * ingestion pipeline. The threat model: inference logs are widely readable
 * (dashboards, analysts, exports) so they must never carry raw secrets/PII.
 *
 * This is regex-based — fast, dependency-free, and deterministic. It will not
 * catch names/addresses (that needs an NER model); see ARCHITECTURE.md for the
 * upgrade path. We bias toward over-redaction: a false positive is cheap, a
 * leaked card number is not.
 */

type Rule = { label: string; re: RegExp };

const RULES: Rule[] = [
  { label: "EMAIL", re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  // E.164-ish and common separated phone formats
  {
    label: "PHONE",
    re: /(?<!\d)(\+?\d{1,3}[\s.-]?)?(\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)/g,
  },
  // 13–16 digit card numbers, optionally separated
  {
    label: "CARD",
    re: /(?<!\d)(?:\d[ -]?){13,16}(?!\d)/g,
  },
  { label: "SSN", re: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g },
  { label: "IP", re: /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g },
  // Common API-key shapes (OpenAI/Anthropic/Google/Stripe-like)
  {
    label: "API_KEY",
    re: /\b(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{16,})\b/g,
  },
];

export interface RedactionResult {
  text: string;
  /** counts per label, e.g. { EMAIL: 2 } — handy for "how much PII flows through us" metrics */
  found: Record<string, number>;
  redacted: boolean;
}

export function redact(input: string | undefined | null): RedactionResult {
  if (!input) return { text: "", found: {}, redacted: false };
  let text = input;
  const found: Record<string, number> = {};

  for (const { label, re } of RULES) {
    text = text.replace(re, (match) => {
      // skip obvious false positives for CARD (e.g. long ID with letters already excluded by \d)
      found[label] = (found[label] ?? 0) + 1;
      return `[${label}_REDACTED]`;
    });
  }

  return {
    text,
    found,
    redacted: Object.keys(found).length > 0,
  };
}

/** Truncate then redact — previews are capped so logs stay cheap. */
export function makePreview(input: string, max = 500): RedactionResult {
  const truncated = input.length > max ? `${input.slice(0, max)}…` : input;
  return redact(truncated);
}
