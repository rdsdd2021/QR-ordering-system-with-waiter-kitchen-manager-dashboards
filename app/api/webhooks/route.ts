/**
 * GET  /api/webhooks  — list endpoints for the authenticated manager's restaurant
 * POST /api/webhooks  — create a new endpoint
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateSecret, validateWebhookUrl } from "@/lib/webhooks";
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

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const restaurantId = await getManagerRestaurantId(req);
  if (!restaurantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select("id, name, url, events, is_active, failure_count, disabled_reason, last_triggered_at, created_at, updated_at")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ endpoints: data ?? [] });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const restaurantId = await getManagerRestaurantId(req);
  if (!restaurantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { name, url, events } = body as { name?: string; url?: string; events?: string[] };

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!url?.trim())  return NextResponse.json({ error: "URL is required" }, { status: 400 });

  const urlCheck = validateWebhookUrl(url.trim());
  if (!urlCheck.ok) return NextResponse.json({ error: urlCheck.reason }, { status: 400 });

  const validEvents = (events ?? []).filter(e => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (validEvents.length === 0) return NextResponse.json({ error: "Select at least one event" }, { status: 400 });

  const secret = generateSecret();
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("webhook_endpoints")
    .insert({
      restaurant_id: restaurantId,
      name: name.trim(),
      url: url.trim(),
      secret,
      events: validEvents,
    })
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
      action: "webhook.created",
      resource_type: "webhook",
      resource_id: data.id ?? null,
      resource_name: data.url ?? null,
      ip_address: getClientIp(req),
    });
  } catch (err) {
    console.error("[webhooks/create] writeAuditLog failed", err);
  }

  // Return secret ONCE — never returned again
  return NextResponse.json({ endpoint: data, secret }, { status: 201 });
}
