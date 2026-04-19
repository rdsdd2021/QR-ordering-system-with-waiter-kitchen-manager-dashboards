import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const { restaurantId, isActive } = await req.json();
  if (!restaurantId) return NextResponse.json({ error: "restaurantId required" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Service role bypasses RLS — required to update is_active
  // Without it, the update will fail due to RLS (managers can only update their own restaurant)
  const supabase = createClient(url, serviceKey ?? anonKey);

  const { error } = await supabase
    .from("restaurants")
    .update({ is_active: isActive })
    .eq("id", restaurantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
