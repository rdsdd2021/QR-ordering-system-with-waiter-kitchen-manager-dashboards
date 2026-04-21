/**
 * POST /api/webhooks/[id]/test — send a test ping to the endpoint
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fireEvent } from "@/lib/webhooks";

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

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const restaurantId = await getManagerRestaurantId(req);
  if (!restaurantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data: ep } = await supabase
    .from("webhook_endpoints")
    .select("id, restaurant_id, url, secret, events, is_active")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (!ep) return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });

  // Temporarily override events to include "test" and fire directly
  const { signPayload } = await import("@/lib/webhooks");
  const payload = {
    id: crypto.randomUUID(),
    event: "test" as const,
    restaurant_id: restaurantId,
    timestamp: new Date().toISOString(),
    data: {
      message: "This is a test webhook from QR Order",
      endpoint_id: id,
      endpoint_name: ep.url,
    },
  };

  const body = JSON.stringify(payload);
  const signature = await signPayload(ep.secret, body, payload.timestamp);

  let httpStatus: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  let durationMs = 0;
  let success = false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const start = Date.now();

    const res = await fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": `sha256=${signature}`,
        "X-Webhook-Timestamp": payload.timestamp,
        "X-Webhook-Event": "test",
        "X-Webhook-ID": payload.id,
        "User-Agent": "QROrder-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    durationMs = Date.now() - start;
    httpStatus = res.status;
    responseBody = (await res.text().catch(() => "")).slice(0, 500);
    success = res.status >= 200 && res.status < 300;
    if (!success) errorMessage = `HTTP ${res.status}`;
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    errorMessage = isTimeout ? "Request timed out after 8s" : (err instanceof Error ? err.message : "Unknown error");
  }

  // Log the test delivery
  await supabase.from("webhook_deliveries").insert({
    endpoint_id: id,
    event_id: payload.id,
    event_type: "test",
    payload,
    status: success ? "success" : "failed",
    http_status: httpStatus,
    response_body: responseBody,
    error_message: errorMessage,
    duration_ms: durationMs,
    attempt: 1,
    max_attempts: 1,
    delivered_at: success ? new Date().toISOString() : null,
  });

  if (success) {
    await supabase.from("webhook_endpoints").update({
      last_triggered_at: new Date().toISOString(),
    }).eq("id", id);
  }

  return NextResponse.json({ success, httpStatus, responseBody, errorMessage, durationMs });
}
