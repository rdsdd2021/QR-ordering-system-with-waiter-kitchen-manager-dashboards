/**
 * POST /api/admin/change-password
 * Changes a user's password via the Supabase Admin Auth API.
 * Requires ADMIN_SECRET header (injected by /api/admin/proxy).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeAuditLog, getClientIp } from "@/lib/audit-log";

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET ?? "";
  const authHeader = req.headers.get("Authorization");

  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Service role key not configured" }, { status: 500 });
  }

  const { restaurantId, newPassword } = await req.json();
  if (!restaurantId || !newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "restaurantId and newPassword (min 8 chars) are required" }, { status: 400 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

  // Find the manager's auth_id for this restaurant
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("auth_id, name, email")
    .eq("restaurant_id", restaurantId)
    .eq("role", "manager")
    .maybeSingle();

  if (userErr || !user) {
    return NextResponse.json({ error: "Manager not found for this restaurant" }, { status: 404 });
  }

  // Update password via Supabase Admin Auth
  const { error: authErr } = await supabase.auth.admin.updateUserById(user.auth_id, {
    password: newPassword,
  });

  if (authErr) {
    return NextResponse.json({ error: authErr.message }, { status: 500 });
  }

  // Audit log — fire-and-forget; a failed write must never block the response
  try {
    await writeAuditLog({
      restaurant_id: restaurantId,
      actor_type: 'admin',
      actor_id: 'admin',
      actor_name: 'Super Admin',
      action: 'auth.password_changed',
      resource_type: 'user',
      resource_id: user.auth_id,
      resource_name: user.name ?? null,
      ip_address: getClientIp(req),
    });
  } catch (err) {
    console.error("[audit-log] change-password audit write failed", err);
  }

  return NextResponse.json({ success: true, managerEmail: user.email, managerName: user.name });
}
