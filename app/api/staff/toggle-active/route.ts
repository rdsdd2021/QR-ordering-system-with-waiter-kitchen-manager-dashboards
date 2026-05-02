/**
 * PATCH /api/staff/toggle-active
 *
 * Activates or deactivates a staff member and writes an audit log entry.
 * Body: { userId: string, restaurantId: string, isActive: boolean }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeAuditLog, getClientIp } from "@/lib/audit-log";
import { fireEvent } from "@/lib/webhooks";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function PATCH(req: NextRequest) {
  try {
    const { userId, restaurantId, isActive } = await req.json();

    if (!userId || !restaurantId || typeof isActive !== "boolean") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Verify the user belongs to this restaurant
    const { data: userRow, error: fetchErr } = await supabase
      .from("users")
      .select("id, name, role, restaurant_id")
      .eq("id", userId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (fetchErr || !userRow) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }

    // Update is_active
    const { error: updateErr } = await supabase
      .from("users")
      .update({ is_active: isActive })
      .eq("id", userId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Resolve the manager for audit logging
    const { data: managerRow } = await supabase
      .from("users")
      .select("id, name")
      .eq("restaurant_id", restaurantId)
      .eq("role", "manager")
      .maybeSingle();

    try {
      await writeAuditLog({
        restaurant_id: restaurantId,
        actor_type: "manager",
        actor_id: managerRow?.id ?? "unknown",
        actor_name: managerRow?.name ?? "Manager",
        action: isActive ? "staff.updated" : "staff.deactivated",
        resource_type: "staff_member",
        resource_id: userId,
        resource_name: userRow.name ?? null,
        metadata: { is_active: isActive },
        ip_address: getClientIp(req),
      });
    } catch (err) {
      console.error("[staff/toggle-active] writeAuditLog failed", err);
    }

    // Fetch restaurant name for webhook context
    const { data: restaurantRow } = await supabase
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .maybeSingle();

    fireEvent(
      restaurantId,
      isActive ? "staff.reactivated" : "staff.deactivated",
      {
        user_id: userId,
        restaurant_id: restaurantId,
        name: userRow.name ?? null,
        role: userRow.role,
        is_active: isActive,
        restaurant: {
          id: restaurantId,
          name: restaurantRow?.name ?? null,
        },
      }
    ).catch(err => console.error("[staff/toggle-active] webhook error:", err));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[staff/toggle-active]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
