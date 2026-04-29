import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateAdminRequest } from "@/lib/admin-auth";
import { writeAuditLog, getClientIp } from "@/lib/audit-log";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const supabase = getServiceClient();

  const allowed = ["code", "type", "value", "duration_days", "max_uses", "expires_at", "applicable_plans", "is_active"];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) {
      update[key] = key === "code" ? String(body[key]).toUpperCase().trim() : body[key];
    }
  }

  const { data, error } = await supabase
    .from("coupons")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  try {
    await writeAuditLog({
      actor_type: 'admin',
      actor_id: 'admin',
      actor_name: 'Super Admin',
      action: 'coupon.updated',
      resource_type: 'coupon',
      resource_id: id,
      resource_name: data.code,
      ip_address: getClientIp(req),
    });
  } catch (auditErr) {
    console.error("[audit-log] coupon.updated failed", auditErr);
  }

  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getServiceClient();

  // Fetch the coupon code before deletion so it can be included in the audit entry
  const { data: coupon } = await supabase
    .from("coupons")
    .select("code")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("coupons").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  try {
    await writeAuditLog({
      actor_type: 'admin',
      actor_id: 'admin',
      actor_name: 'Super Admin',
      action: 'coupon.deleted',
      resource_type: 'coupon',
      resource_id: id,
      resource_name: coupon?.code ?? null,
      ip_address: getClientIp(req),
    });
  } catch (auditErr) {
    console.error("[audit-log] coupon.deleted failed", auditErr);
  }

  return NextResponse.json({ success: true });
}
