import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fireEvent } from "@/lib/webhooks";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * DELETE /api/staff/delete
 *
 * Removes a staff member completely:
 *  1. Looks up their auth_id from the users table
 *  2. Deletes the users row
 *  3. Deletes the Supabase Auth account so they can no longer log in
 *
 * Body: { userId: string (users.id), restaurantId: string }
 * restaurantId is used to scope the lookup and prevent cross-restaurant deletes.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId, restaurantId } = await req.json();

    if (!userId || !restaurantId) {
      return NextResponse.json({ error: "userId and restaurantId are required" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // 1. Fetch the user to get their auth_id, scoped to this restaurant
    const { data: userRow, error: fetchError } = await supabase
      .from("users")
      .select("id, auth_id, name, role")
      .eq("id", userId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (fetchError || !userRow) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }

    // Prevent deleting managers via this route
    if (userRow.role === "manager") {
      return NextResponse.json({ error: "Cannot delete manager accounts via this route" }, { status: 403 });
    }

    // 2. Delete the users profile row
    const { error: deleteRowError } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);

    if (deleteRowError) {
      return NextResponse.json({ error: deleteRowError.message }, { status: 500 });
    }

    // 3. Delete the Supabase Auth account (best-effort — don't fail if missing)
    if (userRow.auth_id) {
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(userRow.auth_id);
      if (authDeleteError) {
        // Log but don't fail — profile row is already gone
        console.warn("[staff/delete] auth delete failed:", authDeleteError.message);
      }
    }

    // Fire webhook (non-blocking) — include restaurant name and staff name for context
    const { data: restaurantRow } = await supabase
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .maybeSingle();

    fireEvent(restaurantId, "staff.deactivated", {
      user_id: userId,
      name: userRow.name ?? null,
      role: userRow.role,
      restaurant: {
        id: restaurantId,
        name: restaurantRow?.name ?? null,
      },
    }).catch(err => console.error("[staff/delete] webhook error:", err));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[staff/delete]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
