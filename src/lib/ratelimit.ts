/**
 * Rate limiter — fixed-window counter, keyed by caller identity.
 *
 * Two tiers guard the two expensive endpoints:
 *   - chat   : few requests/min (provider $$ + latency)
 *   - ingest : high ceiling (it's just a DB write, but still bounded)
 *
 * Implementation is an in-memory window. That's correct for a single instance
 * and the demo, and it's honest about its limits: on multi-instance/serverless
 * fan-out each instance keeps its own counter, so the effective limit is
 * `limit × instances`. The seam is clean — swap `hit()` for an Upstash Redis
 * `INCR`+`EXPIRE` (atomic, shared) and the call sites don't change. See
 * ARCHITECTURE.md.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      ok: true,
      limit,
      remaining: limit - 1,
      resetAt,
      retryAfterSec: 0,
    };
  }

  existing.count += 1;
  const ok = existing.count <= limit;
  return {
    ok,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSec: ok ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

// Opportunistic cleanup so the Map doesn't grow unbounded.
function sweep() {
  const now = Date.now();
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
}
if (typeof setInterval !== "undefined") {
  const t = setInterval(sweep, 60_000);
  // don't keep the process alive just for the sweeper
  (t as { unref?: () => void }).unref?.();
}

export const LIMITS = {
  chat: { limit: 20, windowMs: 60_000 }, // 20 msgs / min / session
  ingest: { limit: 600, windowMs: 60_000 }, // 600 events / min / source
};

/** Derive a best-effort client key from a request (session header or IP). */
export function clientKey(req: Request, fallback = "anon"): string {
  const session = req.headers.get("x-session-id");
  if (session) return `s:${session}`;
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || fallback;
  return `ip:${ip}`;
}
