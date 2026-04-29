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

export async function GET(req: NextRequest) {
  if (!validateAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("plans").select("*").order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  if (!validateAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("plans").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  try {
    await writeAuditLog({
      actor_type: 'admin', actor_id: 'admin', actor_name: 'Super Admin',
      action: 'plan.created', resource_type: 'plan',
      resource_id: data.id, resource_name: data.name,
      ip_address: getClientIp(req),
    });
  } catch (err) { console.error('[plans/create] writeAuditLog failed', err); }
  return NextResponse.json(data, { status: 201 });
}
