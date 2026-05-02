/**
 * GET    /api/webhooks/[id]  — fetch single endpoint
 * PATCH  /api/webhooks/[id]  — update name/url/events/is_active
 * DELETE /api/webhooks/[id]  — remove endpoint
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateWebhookUrl, fireEvent } from "@/lib/webhooks";
import { WEBHOOK_EVENTS } from "@/types/webhooks";
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

async function ownsEndpoint(supabase: ReturnType<typeof getServiceClient>, endpointId: string, restaurantId: string) {
  const { data } = await supabase
    .from("webhook_endpoints")
    .select("id")
    .eq("id", endpointId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  return !!data;
}

type Params = { params: Promise<{ id: string }> };

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const restaurantId = await getManagerRestaurantId(req);
  if (!restaurantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select("id, name, url, events, is_active, failure_count, disabled_reason, last_triggered_at, created_at, updated_at")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ endpoint: data });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const restaurantId = await getManagerRestaurantId(req);
  if (!restaurantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  if (!await ownsEndpoint(supabase, id, restaurantId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (!body.name?.trim()) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    updates.name = body.name.trim();
  }
  if (body.url !== undefined) {
    const urlCheck = validateWebhookUrl(body.url);
    if (!urlCheck.ok) return NextResponse.json({ error: urlCheck.reason }, { status: 400 });
    updates.url = body.url.trim();
  }
  if (body.events !== undefined) {
    const valid = (body.events as string[]).filter(e => (WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (valid.length === 0) return NextResponse.json({ error: "Select at least one event" }, { status: 400 });
    updates.events = valid;
  }
  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
    // Clear disabled_reason when manually re-enabling
    if (body.is_active === true) {
      updates.disabled_reason = null;
      updates.failure_count = 0;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("webhook_endpoints")
    .update(updates)
    .eq("id", id)
    .select("id, name, url, events, is_active, failure_count, disabled_reason, last_triggered_at, created_at, updated_at")
    .single();

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
      action: "webhook.updated",
      resource_type: "webhook",
      resource_id: data.id ?? null,
      resource_name: data.url ?? null,
      ip_address: getClientIp(req),
    });
  } catch (err) {
    console.error("[webhooks/update] writeAuditLog failed", err);
  }

  fireEvent(restaurantId, "webhook.updated" as any, {
    endpoint_id: data.id,
    restaurant_id: restaurantId,
    name: data.name,
    url: data.url,
    events: data.events,
    is_active: data.is_active,
    changes: updates,
    updated_at: data.updated_at,
  }).catch(err => console.error("[webhooks/update] webhook.updated fire error:", err));

  return NextResponse.json({ endpoint: data });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const restaurantId = await getManagerRestaurantId(req);
  if (!restaurantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  if (!await ownsEndpoint(supabase, id, restaurantId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch endpoint URL before deletion for audit log resource_name
  const { data: epRow } = await supabase
    .from("webhook_endpoints")
    .select("url")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("webhook_endpoints").delete().eq("id", id);
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
      action: "webhook.deleted",
      resource_type: "webhook",
      resource_id: id,
      resource_name: epRow?.url ?? null,
      ip_address: getClientIp(req),
    });
  } catch (err) {
    console.error("[webhooks/delete] writeAuditLog failed", err);
  }

  fireEvent(restaurantId, "webhook.deleted" as any, {
    endpoint_id: id,
    restaurant_id: restaurantId,
    url: epRow?.url ?? null,
    deleted_at: new Date().toISOString(),
  }).catch(err => console.error("[webhooks/delete] webhook.deleted fire error:", err));

  return NextResponse.json({ success: true });
}
