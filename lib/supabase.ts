/**
 * Supabase client factory.
 *
 * We use a lazy singleton pattern so the client is only created when
 * actually needed at runtime — not during Next.js static analysis at build time.
 * This prevents build failures when env vars aren't set in CI.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env.local file."
    );
  }

  _client = createClient(supabaseUrl, supabaseAnonKey, {
    realtime: {
      params: {
        eventsPerSecond: 20,
      },
    },
  });
  return _client;
}

/**
 * Convenience proxy for data queries (used in lib/api.ts).
 * For real-time subscriptions use getSupabaseClient() directly.
 */
export const supabase = {
  from: (...args: Parameters<SupabaseClient["from"]>) =>
    getSupabaseClient().from(...args),
  rpc: (...args: Parameters<SupabaseClient["rpc"]>) =>
    getSupabaseClient().rpc(...args),
  auth: getSupabaseClient().auth,
  channel: (...args: Parameters<SupabaseClient["channel"]>) =>
    getSupabaseClient().channel(...args),
  removeChannel: (...args: Parameters<SupabaseClient["removeChannel"]>) =>
    getSupabaseClient().removeChannel(...args),
};
