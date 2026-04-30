// POST /api/audit — write a single audit entry from client-side code
// Authenticates via Bearer JWT, derives actor from token
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog, AuditEntry, getClientIp } from "@/lib/audit-log";
import { getUserFromToken, extractBearerToken } from "@/lib/server-auth";

export async function POST(req: NextRequest) {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userRow = await getUserFromToken(token);
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
