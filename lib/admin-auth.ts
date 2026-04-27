import { NextRequest } from "next/server";

/**
 * Validates the admin secret header on API requests.
 * All /api/admin/* routes must call this before doing anything.
 *
 * The client sends: Authorization: Bearer <ADMIN_SECRET>
 * The secret is ADMIN_SECRET (server-only, never NEXT_PUBLIC_).
 */
export function validateAdminRequest(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    // No secret configured — deny all requests to be safe
    console.error("[admin-auth] ADMIN_SECRET env var is not set");
    return false;
  }
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice(7) === secret;
}
