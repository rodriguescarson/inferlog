import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema design notes
 * -------------------
 * Three core tables, deliberately normalized but denormalized where it pays off:
 *
 *  - conversations  : one row per chat session (the unit the UI lists/resumes).
 *  - messages       : the durable transcript (what the user actually sees).
 *  - inference_logs : one row per LLM call — the observability record.
 *
 * `messages` and `inference_logs` are kept SEPARATE on purpose. A message is a
 * product artifact (must survive, user-facing). An inference log is telemetry
 * (high volume, may be sampled/rolled-up/expired). Coupling them would force the
 * transcript to inherit the retention + write-amplification profile of metrics.
 *
 * `inference_logs.metadata` is JSONB so the SDK can attach provider-specific
 * fields (cache hits, reasoning tokens, safety scores) without a migration. The
 * columns we query/aggregate on (latency, tokens, status) are promoted to real
 * typed columns + indexes; everything else rides in JSONB. Classic
 * "index what you filter, bag the rest" tradeoff.
 */

export const messageRoleEnum = pgEnum("message_role", [
  "system",
  "user",
  "assistant",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "cancelled",
  "archived",
]);

export const logStatusEnum = pgEnum("log_status", [
  "success",
  "error",
  "blocked", // rejected by a guardrail before it reached the provider
]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default("New conversation"),
    // session/user owner — we key rate-limiting and listing off this.
    sessionId: text("session_id").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    status: conversationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversations_session_idx").on(t.sessionId, t.updatedAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    // tokens attributed to this single message when known (assistant turns).
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const inferenceLogs = pgTable(
  "inference_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // a client-generated id so the SDK can correlate/dedupe even if the
    // ingestion write is retried (idempotency handle).
    requestId: text("request_id").notNull().unique(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: logStatusEnum("status").notNull(),
    // latency: total wall-clock; ttfb: time-to-first-token (streaming UX metric).
    latencyMs: integer("latency_ms"),
    ttfbMs: integer("ttfb_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    finishReason: text("finish_reason"),
    errorMessage: text("error_message"),
    // PII-redacted previews — never the full payload (cost + privacy tradeoff).
    inputPreview: text("input_preview"),
    outputPreview: text("output_preview"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // dashboards scan by time; this index serves the time-series rollups.
    index("logs_created_idx").on(t.createdAt),
    index("logs_status_idx").on(t.status, t.createdAt),
    index("logs_model_idx").on(t.model, t.createdAt),
    index("logs_conversation_idx").on(t.conversationId),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type InferenceLog = typeof inferenceLogs.$inferSelect;
export type NewInferenceLog = typeof inferenceLogs.$inferInsert;
