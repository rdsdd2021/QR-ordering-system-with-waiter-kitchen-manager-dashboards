/**
 * POST /api/admin/verify-pin
 *
 * G4: Validates the admin PIN server-side so the PIN value never
 * needs to be in the client bundle (NEXT_PUBLIC_ADMIN_PIN removed).
 * Returns { ok: true } on success, 401 on failure.
 * Rate-limited to 5 attempts per IP per minute to prevent brute-force.
 */
import { NextRequest, NextResponse } from "next/server";

// Simple in-memory rate limiter: IP → { count, resetAt }
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 60_000; // 1 minute

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  const now = Date.now();

  // Rate limit check
  const entry = attempts.get(ip);
  if (entry) {
    if (now < entry.resetAt) {
      if (entry.count >= MAX_ATTEMPTS) {
        return NextResponse.json(
          { error: "Too many attempts. Try again in a minute." },
          { status: 429 }
        );
      }
      entry.count++;
    } else {
      // Window expired — reset
      attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    }
  } else {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  }

  const { pin } = await req.json().catch(() => ({ pin: "" }));

  // Read PIN from server-only env var (ADMIN_PIN), fall back to NEXT_PUBLIC_ADMIN_PIN
  // for backwards compatibility during migration, but prefer the non-public var.
  const adminPin =
    process.env.ADMIN_PIN ??
    process.env.NEXT_PUBLIC_ADMIN_PIN ??
    "";

  if (!adminPin) {
    console.error("[admin/verify-pin] ADMIN_PIN env var not set");
    return NextResponse.json({ error: "Admin not configured" }, { status: 500 });
  }

  if (!pin || pin !== adminPin) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Clear rate limit on success
  attempts.delete(ip);
  return NextResponse.json({ ok: true });
}
