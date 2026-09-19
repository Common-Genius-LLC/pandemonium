// A fixed-window rate limiter, in memory, keyed by whatever the caller passes
// (the client IP, for link previews). In memory is enough for one API process;
// a second process would need a shared store, and would say so by needing it.

export interface RateLimitResult { ok: boolean; remaining: number; retryAfterSec: number }

export function createRateLimiter({ limit, windowMs, now = Date.now }: {
  limit: number; windowMs: number; now?: () => number;
}) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  // Expired windows are swept lazily, whenever the map has grown, so memory is
  // bounded by the number of distinct callers per window and nothing needs a
  // timer that would keep the process (or a test run) alive.
  function sweep(t: number) {
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
  }

  return {
    check(key: string): RateLimitResult {
      const t = now();
      if (buckets.size > 10_000) sweep(t);
      let b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        b = { count: 0, resetAt: t + windowMs };
        buckets.set(key, b);
      }
      b.count++;
      const ok = b.count <= limit;
      return { ok, remaining: Math.max(0, limit - b.count), retryAfterSec: ok ? 0 : Math.ceil((b.resetAt - t) / 1000) };
    },
  };
}
