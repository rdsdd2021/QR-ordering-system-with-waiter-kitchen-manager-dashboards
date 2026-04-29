import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const { authId, email, restaurantName, ownerName } = await req.json();

    if (!authId || !email || !restaurantName || !ownerName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Check if this auth user already has a restaurant
    const { data: existing } = await supabase
      .from("users")
      .select("restaurant_id")
      .eq("auth_id", authId)
      .maybeSingle();

    if (existing?.restaurant_id) {
      return NextResponse.json({ restaurantId: existing.restaurant_id });
    }

    // Call the onboarding DB function
    const { data, error } = await supabase.rpc("onboard_restaurant", {
      p_auth_id:    authId,
      p_name:       restaurantName.trim(),
      p_email:      email.trim().toLowerCase(),
      p_owner_name: ownerName.trim(),
    });

    if (error) {
      console.error("[onboard]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    try {
      await writeAuditLog({
        restaurant_id: data.restaurant_id,
        actor_type: 'manager', actor_id: authId, actor_name: ownerName.trim(),
        action: 'restaurant.onboarded', resource_type: 'restaurant',
        resource_id: data.restaurant_id, resource_name: restaurantName.trim(),
      });
    } catch (err) { console.error('[onboard] writeAuditLog failed', err); }

    return NextResponse.json({ restaurantId: data.restaurant_id });
  } catch (err) {
    console.error("[onboard]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
