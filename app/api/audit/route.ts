// POST /api/audit — write a single audit entry from client-side code
// Authenticates via Bearer JWT, derives actor from token
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeAuditLog, AuditEntry, getClientIp } from "@/lib/audit-log";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = authHeader.slice(7);

  const anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user }, error } = await anonClient.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: userRow } = await svc.from("users").select("restaurant_id, role, name, id").eq("auth_id", user.id).maybeSingle();
  if (!userRow) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const entry: AuditEntry = {
    restaurant_id: userRow.restaurant_id,
    actor_type: (userRow.role === 'manager' ? 'manager' : 'staff') as AuditEntry['actor_type'],
    actor_id: userRow.id,
    actor_name: userRow.name ?? 'Unknown',
    action: body.action,
    resource_type: body.resource_type,
    resource_id: body.resource_id ?? null,
    resource_name: body.resource_name ?? null,
    metadata: body.metadata ?? {},
    ip_address: getClientIp(req),
  };

  const id = await writeAuditLog(entry);
  return NextResponse.json({ id });
}
