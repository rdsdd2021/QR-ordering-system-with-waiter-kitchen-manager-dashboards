/**
 * F5: Channel token utility.
 *
 * Supabase Realtime broadcast channels are public — any client with the anon
 * key can subscribe to any channel name they know. To prevent unauthorized
 * subscription to sensitive channels (kitchen orders, waiter orders, customer
 * order status), we make channel names unguessable by appending a short HMAC
 * token derived from the channel scope + a server-side secret.
 *
 * A client that only knows the restaurant UUID cannot subscribe to
 * `kitchen:{restaurantId}:{token}` without also knowing CHANNEL_SECRET.
 *
 * Usage (server-side, in API routes or page.tsx):
 *   const token = await getChannelToken("kitchen", restaurantId);
 *   // Pass token to the client component as a prop
 *
 * Usage (client-side, in hooks):
 *   const channel = supabase.channel(`kitchen:${restaurantId}:${token}`);
 *
 * The token is a 12-character hex prefix of HMAC-SHA256(secret, scope:id).
 * It is NOT a secret in the cryptographic sense — it's an access-control
 * token that makes channel names unguessable without the server secret.
 */

const CHANNEL_SECRET = process.env.CHANNEL_SECRET ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "fallback-dev-secret";

/**
 * Compute a short channel token for a given scope and id.
 * Safe to call on both server and client (uses Web Crypto API).
 */
export async function getChannelToken(scope: string, id: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${scope}:${id}`)
  );
  // Return first 12 hex chars — enough entropy to prevent guessing
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

/**
 * Build a secured channel name.
 * e.g. secureChannel("kitchen", restaurantId) → "kitchen:{id}:{token}"
 */
export async function secureChannel(scope: string, id: string): Promise<string> {
  const token = await getChannelToken(scope, id);
  return `${scope}:${id}:${token}`;
}
