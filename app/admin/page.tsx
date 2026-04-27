import { createClient } from "@supabase/supabase-js";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

async function getSuperAdminData() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Use service role if available (bypasses RLS, sees inactive restaurants too)
  // Falls back to anon key — admin PIN gate still protects the UI
  const supabase = createClient(url, serviceKey ?? anonKey);

  const [{ data: restaurants }, { data: subscriptions }, { data: orders }] =
    await Promise.all([
      supabase
        .from("restaurants")
        .select("id, name, is_active, created_at, owner_id")
        .order("created_at", { ascending: false }),
      supabase
        .from("subscriptions")
        .select("restaurant_id, plan, status, current_period_end, trial_used, updated_at"),
      supabase
        .from("orders")
        .select("restaurant_id"),
    ]);

  // Aggregate order counts per restaurant
  const orderCounts: Record<string, number> = {};
  (orders ?? []).forEach((o: any) => {
    orderCounts[o.restaurant_id] = (orderCounts[o.restaurant_id] ?? 0) + 1;
  });

  return {
    restaurants: restaurants ?? [],
    subscriptions: subscriptions ?? [],
    orderCounts,
    hasServiceRole: !!serviceKey,
  };
}

export default async function AdminPage() {
  const data = await getSuperAdminData();
  return <AdminClient {...data} />;
}
