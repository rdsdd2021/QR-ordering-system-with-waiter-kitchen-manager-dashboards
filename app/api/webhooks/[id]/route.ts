/**
 * GET    /api/webhooks/[id]  — fetch single endpoint
 * PATCH  /api/webhooks/[id]  — update name/url/events/is_active
 * DELETE /api/webhooks/[id]  — remove endpoint
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateWebhookUrl } from "@/lib/webhooks";
import { WEBHOOK_EVENTS } from "@/types/webhooks";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getManagerRestaurantId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const svc = getServiceClient();
  const { data } = await svc.from("users").select("restaurant_id, role").eq("auth_id", user.id).maybeSingle();
  if (!data || data.role !== "manager") return null;
  return data.restaurant_id;
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

  const { error } = await supabase.from("webhook_endpoints").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
