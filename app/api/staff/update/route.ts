import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeAuditLog, getClientIp } from "@/lib/audit-log";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * PATCH /api/staff/update
 *
 * Updates a staff member's name and/or email.
 * Uses the service role key to also update the Supabase Auth email
 * so the login email stays in sync with the users table.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { userId, restaurantId, name, email } = await req.json();

    if (!userId || !restaurantId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Verify the user belongs to this restaurant
    const { data: userRow, error: fetchErr } = await supabase
      .from("users")
      .select("id, auth_id, restaurant_id")
      .eq("id", userId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (fetchErr || !userRow) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }

    // Update the users table
    const updates: Record<string, string> = {};
    if (name?.trim()) updates.name = name.trim();
    if (email?.trim()) updates.email = email.trim().toLowerCase();

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await supabase
        .from("users")
        .update(updates)
        .eq("id", userId);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
    }

    // If email changed, also update the Supabase Auth account
    if (email?.trim() && userRow.auth_id) {
      const { error: authErr } = await supabase.auth.admin.updateUserById(
        userRow.auth_id,
        { email: email.trim().toLowerCase() }
      );
      if (authErr) {
        console.error("[staff/update] auth email update failed:", authErr.message);
        // Non-fatal — profile is updated, auth email update is best-effort
      }
    }

    // Resolve the manager for this restaurant to use as the actor
    const { data: managerRow } = await supabase
      .from("users")
      .select("id, name")
      .eq("restaurant_id", userRow.restaurant_id)
      .eq("role", "manager")
      .maybeSingle();

    try {
      await writeAuditLog({
        restaurant_id: userRow.restaurant_id,
        actor_type: "manager",
        actor_id: managerRow?.id ?? "unknown",
        actor_name: managerRow?.name ?? "Manager",
        action: "staff.updated",
        resource_type: "staff_member",
        resource_id: userId,
        resource_name: name?.trim() ?? null,
        metadata: { updated_fields: updates },
        ip_address: getClientIp(req),
      });
    } catch (err) {
      console.error("[staff/update] writeAuditLog failed", err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[staff/update]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
