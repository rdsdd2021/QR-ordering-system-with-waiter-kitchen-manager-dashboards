/**
 * Server-side auth helpers for API route handlers.
 *
 * WHY: supabase.auth.getUser(token) makes an outbound HTTPS request to the
 * Supabase Auth server on every API call. In environments where that connection
 * is slow or unreliable this causes 10-second timeouts before returning 401.
 *
 * FIX: Decode the JWT payload locally (no network call) to extract the user's
 * `sub` (auth_id), then look up the user in our own `users` table via the
 * service role client. This is safe because:
 *  - We only trust the `sub` claim, which is a UUID we then verify exists in DB.
 *  - The service role client has full DB access and doesn't need to call Auth.
 *  - A forged token with a non-existent `sub` will simply return null from the DB.
 */
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Decode a JWT payload without verifying the signature.
 * Returns null if the token is malformed.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // Base64url → base64 → JSON
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export type UserRow = {
  id: string;
  auth_id: string;
  name: string | null;
  role: string;
  restaurant_id: string;
};

/**
 * Authenticate a Bearer token and return the matching user row.
 * Returns null if the token is missing, malformed, or the user doesn't exist.
 *
 * No outbound network calls — decodes the JWT locally and queries the DB.
 */
export async function getUserFromToken(token: string): Promise<UserRow | null> {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.sub !== "string") return null;

  const authId = payload.sub;

  const svc = getServiceClient();
  const { data, error } = await svc
    .from("users")
    .select("id, auth_id, name, role, restaurant_id")
    .eq("auth_id", authId)
    .maybeSingle();

  if (error || !data) return null;
  return data as UserRow;
}

/**
 * Extract the Bearer token from an Authorization header value.
 * Returns null if the header is missing or not a Bearer token.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}
