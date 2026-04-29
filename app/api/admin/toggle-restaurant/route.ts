import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateAdminRequest } from "@/lib/admin-auth";
import { writeAuditLog, getClientIp } from "@/lib/audit-log";

export async function POST(req: NextRequest) {
  if (!validateAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { restaurantId, isActive } = await req.json();
  if (!restaurantId) return NextResponse.json({ error: "restaurantId required" }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch the restaurant name before updating so it can be included in the audit log
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("name")
    .eq("id", restaurantId)
    .single();

  const { error } = await supabase
    .from("restaurants")
    .update({ is_active: isActive })
    .eq("id", restaurantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Write audit log — failure must never block the response
  try {
    await writeAuditLog({
      restaurant_id: restaurantId,
      actor_type: 'admin',
      actor_id: 'admin',
      actor_name: 'Super Admin',
      action: isActive ? 'restaurant.activated' : 'restaurant.deactivated',
      resource_type: 'restaurant',
      resource_id: restaurantId,
      resource_name: restaurant?.name ?? null,
      ip_address: getClientIp(req),
    });
  } catch (auditErr) {
    console.error("[audit-log] toggle-restaurant audit write failed", auditErr);
  }

  return NextResponse.json({ ok: true });
}
