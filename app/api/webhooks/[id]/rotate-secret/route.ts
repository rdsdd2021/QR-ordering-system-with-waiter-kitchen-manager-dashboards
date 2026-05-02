/**
 * POST /api/webhooks/[id]/rotate-secret — generate a new signing secret
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateSecret, fireEvent } from "@/lib/webhooks";
import { writeAuditLog, getClientIp } from "@/lib/audit-log";
import { getUserFromToken, extractBearerToken } from "@/lib/server-auth";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getManagerRestaurantId(req: NextRequest): Promise<string | null> {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) return null;
  const user = await getUserFromToken(token);
  if (!user || user.role !== "manager") return null;
  return user.restaurant_id;
}

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const restaurantId = await getManagerRestaurantId(req);
  if (!restaurantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: ep } = await supabase
    .from("webhook_endpoints")
    .select("id, url")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (!ep) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const newSecret = generateSecret();
  const { error } = await supabase
    .from("webhook_endpoints")
    .update({ secret: newSecret })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
      action: "webhook.secret_rotated",
      resource_type: "webhook",
      resource_id: id,
      resource_name: ep.url ?? null,
      ip_address: getClientIp(req),
    });
  } catch (err) {
    console.error("[webhooks/rotate-secret] writeAuditLog failed", err);
  }

  fireEvent(restaurantId, "webhook.secret_rotated" as any, {
    endpoint_id: id,
    restaurant_id: restaurantId,
    url: ep.url,
    rotated_at: new Date().toISOString(),
  }).catch(err => console.error("[webhooks/rotate-secret] webhook fire error:", err));

  // Return new secret ONCE
  return NextResponse.json({ secret: newSecret });
}
