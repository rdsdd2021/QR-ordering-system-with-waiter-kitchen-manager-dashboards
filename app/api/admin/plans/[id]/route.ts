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

const ALLOWED = [
  "name", "tagline", "monthly_paise", "yearly_paise",
  "features", "unavailable", "is_active", "is_highlighted",
  "cta", "sort_order",
];

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

  const update: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in body) update[key] = body[key];
  }

  const { data, error } = await supabase
    .from("plans").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  try {
    await writeAuditLog({
      actor_type: 'admin', actor_id: 'admin', actor_name: 'Super Admin',
      action: 'plan.updated', resource_type: 'plan',
      resource_id: data.id, resource_name: data.name,
      metadata: { updated_fields: update },
      ip_address: getClientIp(req),
    });
  } catch (err) { console.error('[plans/update] writeAuditLog failed', err); }
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
  const { data: plan } = await supabase.from("plans").select("name").eq("id", id).maybeSingle();
  const { error } = await supabase.from("plans").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  try {
    await writeAuditLog({
      actor_type: 'admin', actor_id: 'admin', actor_name: 'Super Admin',
      action: 'plan.deleted', resource_type: 'plan',
      resource_id: id, resource_name: plan?.name ?? null,
      ip_address: getClientIp(req),
    });
  } catch (err) { console.error('[plans/delete] writeAuditLog failed', err); }
  return NextResponse.json({ success: true });
}
