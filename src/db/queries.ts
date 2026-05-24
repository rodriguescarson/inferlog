import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./client";
import { conversations, inferenceLogs, messages } from "./schema";

export async function ensureConversation(input: {
  id: string;
  sessionId: string;
  model: string;
  provider: string;
  title?: string;
}) {
  await db
    .insert(conversations)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      model: input.model,
      provider: input.provider,
      title: input.title ?? "New conversation",
    })
    .onConflictDoUpdate({
      target: conversations.id,
      set: { model: input.model, provider: input.provider, updatedAt: new Date() },
    });
}

export async function insertMessage(input: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokenCount?: number | null;
}) {
  const [row] = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      tokenCount: input.tokenCount ?? null,
    })
    .returning({ id: messages.id });
  return row.id;
}

export async function touchConversation(id: string) {
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, id));
}

export async function setConversationStatus(
  id: string,
  status: "active" | "cancelled" | "archived",
) {
  await db
    .update(conversations)
    .set({ status, updatedAt: new Date() })
    .where(eq(conversations.id, id));
}

export async function setConversationTitle(id: string, title: string) {
  await db
    .update(conversations)
    .set({ title: title.slice(0, 120) })
    .where(eq(conversations.id, id));
}

export async function listConversations(sessionId: string) {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.sessionId, sessionId))
    .orderBy(desc(conversations.updatedAt))
    .limit(100);
}

export async function getConversationMessages(
  conversationId: string,
  sessionId: string,
) {
  // ownership check folded into the query
  const convo = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.sessionId, sessionId),
      ),
    )
    .limit(1);
  if (convo.length === 0) return null;

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
  return { conversation: convo[0], messages: msgs };
}

export async function deleteConversation(id: string, sessionId: string) {
  return db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.sessionId, sessionId)));
}

/** Dashboard rollups computed in SQL — cheap, no app-side aggregation. */
export async function getStats(sinceHours = 24) {
  const since = new Date(Date.now() - sinceHours * 3_600_000);

  const totals = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${inferenceLogs.status} = 'error')::int`,
      blocked: sql<number>`count(*) filter (where ${inferenceLogs.status} = 'blocked')::int`,
      avgLatency: sql<number>`coalesce(avg(${inferenceLogs.latencyMs}) filter (where ${inferenceLogs.status} = 'success'), 0)::int`,
      p95Latency: sql<number>`coalesce(percentile_cont(0.95) within group (order by (case when ${inferenceLogs.status} = 'success' then ${inferenceLogs.latencyMs} end)), 0)::int`,
      avgTtfb: sql<number>`coalesce(avg(${inferenceLogs.ttfbMs}) filter (where ${inferenceLogs.ttfbMs} is not null), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(${inferenceLogs.totalTokens}), 0)::int`,
    })
    .from(inferenceLogs)
    .where(gte(inferenceLogs.createdAt, since));

  // throughput + errors bucketed per hour for the time-series charts
  const series = await db
    .select({
      bucket: sql<string>`date_trunc('hour', ${inferenceLogs.createdAt})`,
      requests: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${inferenceLogs.status} = 'error')::int`,
      avgLatency: sql<number>`coalesce(avg(${inferenceLogs.latencyMs}) filter (where ${inferenceLogs.status} = 'success'), 0)::int`,
    })
    .from(inferenceLogs)
    .where(gte(inferenceLogs.createdAt, since))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const byModel = await db
    .select({
      model: inferenceLogs.model,
      provider: inferenceLogs.provider,
      requests: sql<number>`count(*)::int`,
      avgLatency: sql<number>`coalesce(avg(${inferenceLogs.latencyMs}) filter (where ${inferenceLogs.status} = 'success'), 0)::int`,
      tokens: sql<number>`coalesce(sum(${inferenceLogs.totalTokens}), 0)::int`,
    })
    .from(inferenceLogs)
    .where(gte(inferenceLogs.createdAt, since))
    .groupBy(inferenceLogs.model, inferenceLogs.provider)
    .orderBy(sql`count(*) desc`);

  const recent = await db
    .select()
    .from(inferenceLogs)
    .orderBy(desc(inferenceLogs.createdAt))
    .limit(20);

  return { totals: totals[0], series, byModel, recent };
}
