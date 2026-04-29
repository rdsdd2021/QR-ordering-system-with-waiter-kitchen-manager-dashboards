import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fireEvent } from "@/lib/webhooks";
import { writeAuditLog, getClientIp } from "@/lib/audit-log";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/staff/create
 *
 * Creates a new staff member (waiter/kitchen) for a restaurant.
 * Uses the service role key to:
 *  1. Create a Supabase Auth user (so they can log in)
 *  2. Insert a row into the `users` table linked to that auth user
 *
 * This runs server-side so the manager's session is never disrupted.
 */
export async function POST(req: NextRequest) {
  try {
    const { name, email, password, role, restaurantId } = await req.json();

    if (!name || !email || !password || !role || !restaurantId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // 1. Create the auth user (won't affect the caller's session)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: password.trim(),
      email_confirm: true, // Auto-confirm so they can log in immediately
      user_metadata: { name: name.trim() },
    });

    if (authError) {
      console.error("[staff/create] auth error:", authError);
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const authId = authData.user.id;

    // 2. Insert the user profile row
    const { data: insertedUser, error: insertError } = await supabase
      .from("users")
      .insert({
        auth_id: authId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        restaurant_id: restaurantId,
        is_active: true,
      })
      .select("id")
      .single();

    if (insertError) {
      // Roll back: delete the auth user we just created
      await supabase.auth.admin.deleteUser(authId);
      console.error("[staff/create] insert error:", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Fire webhook (non-blocking) — include restaurant name for context
    const { data: restaurantRow } = await supabase
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .maybeSingle();

    fireEvent(restaurantId, "staff.created", {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role,
      restaurant: {
        id: restaurantId,
        name: restaurantRow?.name ?? null,
      },
    }).catch(err => console.error("[staff/create] webhook error:", err));

    // Resolve the manager for this restaurant to use as the actor
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
        action: "staff.created",
        resource_type: "staff_member",
        resource_id: insertedUser?.id ?? null,
        resource_name: name.trim(),
        ip_address: getClientIp(req),
      });
    } catch (err) {
      console.error("[staff/create] writeAuditLog failed", err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[staff/create]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
