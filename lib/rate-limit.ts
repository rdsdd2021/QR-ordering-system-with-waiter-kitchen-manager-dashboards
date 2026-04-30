/**
 * G5: Simple in-memory rate limiter for Next.js API routes.
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });
 *   const { ok, retryAfterMs } = limiter.check(key);
 *   if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 *
 * Keys are typically IP + table_id or IP + phone to scope per customer.
 * The store is module-level so it persists across requests within the same
 * serverless function instance. It resets on cold starts (acceptable for
 * rate limiting — not a security-critical store).
 */

type Entry = { count: number; resetAt: number };

export function createRateLimiter(options: { windowMs: number; max: number }) {
  const { windowMs, max } = options;
  const store = new Map<string, Entry>();

  return {
    check(key: string): { ok: boolean; retryAfterMs: number } {
      const now = Date.now();
      const entry = store.get(key);

      if (!entry || now >= entry.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, retryAfterMs: 0 };
      }

      if (entry.count >= max) {
        return { ok: false, retryAfterMs: entry.resetAt - now };
      }

      entry.count++;
      return { ok: true, retryAfterMs: 0 };
    },

    /** Clean up expired entries to prevent unbounded memory growth. */
    purge() {
      const now = Date.now();
      for (const [key, entry] of store) {
        if (now >= entry.resetAt) store.delete(key);
      }
    },
  };
}
