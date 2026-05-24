import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * A single shared postgres connection pool. On Vercel's serverless/fluid
 * runtime we keep the pool tiny (max 1–5) because each instance is short-lived
 * and connection slots are the scarce resource. For a real high-throughput
 * ingestion path you'd front Postgres with a pooler (PgBouncer / Supabase
 * pooler / Neon) — see ARCHITECTURE.md.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Don't crash import-time on the client bundle; only throw when actually used.
  console.warn("[db] DATABASE_URL is not set — DB operations will fail.");
}

const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__sql ??
  postgres(connectionString ?? "postgres://localhost:5432/inferlog", {
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // safe with transaction-mode poolers
  });

if (process.env.NODE_ENV !== "production") globalForDb.__sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
