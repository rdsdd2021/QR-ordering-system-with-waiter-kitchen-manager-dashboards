/**
 * Webhook dispatch engine.
 * Called by API routes to fire events to registered endpoints.
 */
import { createClient } from "@supabase/supabase-js";
import {
  WebhookEventType, WebhookPayload,
  RETRY_DELAYS_S, MAX_ATTEMPTS, DISPATCH_TIMEOUT_MS, MAX_PAYLOAD_BYTES,
} from "@/types/webhooks";

// ── Supabase service client ───────────────────────────────────────────────────

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── HMAC-SHA256 signature ─────────────────────────────────────────────────────

export async function signPayload(secret: string, body: string, timestamp: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── SSRF / URL validation ─────────────────────────────────────────────────────

export function validateWebhookUrl(url: string): { ok: boolean; reason?: string } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, reason: "Invalid URL" }; }

  if (parsed.protocol !== "https:") return { ok: false, reason: "URL must use HTTPS" };

  const host = parsed.hostname.toLowerCase();
  const blocked = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./,
    /^::1$/,
    /^0\.0\.0\.0$/,
  ];
  if (blocked.some(r => r.test(host))) {
    return { ok: false, reason: "Private/loopback addresses are not allowed" };
  }
  return { ok: true };
}

// ── Secret generation ─────────────────────────────────────────────────────────

export function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "whsec_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Core dispatch ─────────────────────────────────────────────────────────────

type DispatchResult = {
  status: "success" | "failed";
  httpStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  durationMs: number;
};

async function dispatchToUrl(
  url: string,
  secret: string,
  payload: WebhookPayload,
): Promise<DispatchResult> {
  let body = JSON.stringify(payload);

  // F3: If payload exceeds the size cap, attempt a truncated fallback before failing.
  // Strip large array fields from data (e.g. order_items) and add a truncation notice.
  if (new TextEncoder().encode(body).length > MAX_PAYLOAD_BYTES) {
    const truncatedData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload.data)) {
      // Drop array fields that are likely the bulk of the payload
      if (!Array.isArray(v)) {
        truncatedData[k] = v;
      }
    }
    truncatedData._truncated = true;
    truncatedData._truncation_reason = "Payload exceeded 64 KB limit — array fields omitted";

    const truncatedPayload: WebhookPayload = { ...payload, data: truncatedData };
    const truncatedBody = JSON.stringify(truncatedPayload);

    if (new TextEncoder().encode(truncatedBody).length > MAX_PAYLOAD_BYTES) {
      // Even the truncated version is too large — fail with a clear message
      return {
        status: "failed", httpStatus: null, responseBody: null,
        errorMessage: "Payload exceeds 64 KB even after truncation",
        durationMs: 0,
      };
    }

    // Use the truncated body
    body = truncatedBody;
  }

  const timestamp = payload.timestamp;
  const signature = await signPayload(secret, body, timestamp);
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": `sha256=${signature}`,
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Event": payload.event,
        "X-Webhook-ID": payload.id,
        "User-Agent": "QROrder-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const durationMs = Date.now() - start;
    const responseBody = (await res.text().catch(() => "")).slice(0, 500);
    const success = res.status >= 200 && res.status < 300;

    return {
      status: success ? "success" : "failed",
      httpStatus: res.status,
      responseBody,
      errorMessage: success ? null : `HTTP ${res.status}`,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      status: "failed",
      httpStatus: null,
      responseBody: null,
      errorMessage: isTimeout ? "Request timed out after 8s" : (err instanceof Error ? err.message : "Unknown error"),
      durationMs,
    };
  }
}

// ── Fire event to all matching endpoints ─────────────────────────────────────

export async function fireEvent(
  restaurantId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  eventId?: string, // pass for retries to keep stable ID
): Promise<void> {
  const supabase = getServiceClient();

  // Fetch active endpoints subscribed to this event
  const { data: endpoints, error } = await supabase
    .from("webhook_endpoints")
    .select("id, url, secret, failure_count")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .contains("events", [eventType]);

  if (error || !endpoints?.length) return;

  const stableEventId = eventId ?? crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const payload: WebhookPayload = {
    id: stableEventId,
    event: eventType,
    restaurant_id: restaurantId,
    timestamp,
    data,
  };

  // Dispatch to all endpoints concurrently (capped at 10)
  const batch = endpoints.slice(0, 10);

  // F2: Create all delivery records synchronously so they exist in the DB
  // immediately, then dispatch HTTP calls in the background without blocking
  // the caller. Uses `waitUntil` on Vercel Edge/Node runtimes when available,
  // otherwise detaches via a void promise.
  const dispatchAll = Promise.allSettled(batch.map(ep => deliverToEndpoint(ep, payload, supabase)));

  // @ts-ignore — `waitUntil` is available on Vercel's extended Request context
  if (typeof globalThis !== "undefined" && (globalThis as any)[Symbol.for("waitUntil")]) {
    (globalThis as any)[Symbol.for("waitUntil")](dispatchAll);
  } else {
    // Detach — let the promise run without blocking the caller
    dispatchAll.catch(err => console.error("[fireEvent] dispatch error:", err));
  }
}

async function deliverToEndpoint(
  ep: { id: string; url: string; secret: string; failure_count: number },
  payload: WebhookPayload,
  supabase: ReturnType<typeof getServiceClient>,
): Promise<void> {
  // Create delivery record
  const { data: delivery, error: insertErr } = await supabase
    .from("webhook_deliveries")
    .insert({
      endpoint_id: ep.id,
      event_id: payload.id,
      event_type: payload.event,
      payload,
      status: "pending",
      attempt: 1,
      max_attempts: MAX_ATTEMPTS,
    })
    .select("id")
    .single();

  if (insertErr || !delivery) return;

  const result = await dispatchToUrl(ep.url, ep.secret, payload);

  const nextAttempt = result.status === "failed" ? 2 : null;
  const nextRetryAt = nextAttempt && RETRY_DELAYS_S[0]
    ? new Date(Date.now() + RETRY_DELAYS_S[0] * 1000).toISOString()
    : null;

  // Update delivery record
  await supabase.from("webhook_deliveries").update({
    status: result.status === "success" ? "success" : (nextRetryAt ? "retrying" : "failed"),
    http_status: result.httpStatus,
    response_body: result.responseBody,
    error_message: result.errorMessage,
    duration_ms: result.durationMs,
    next_retry_at: nextRetryAt,
    delivered_at: result.status === "success" ? new Date().toISOString() : null,
  }).eq("id", delivery.id);

  // Update endpoint stats
  if (result.status === "success") {
    await supabase.from("webhook_endpoints").update({
      last_triggered_at: new Date().toISOString(),
      failure_count: 0,
    }).eq("id", ep.id);
  } else {
    const newFailureCount = ep.failure_count + 1;
    const autoDisable = newFailureCount >= 10;
    await supabase.from("webhook_endpoints").update({
      failure_count: newFailureCount,
      ...(autoDisable ? {
        is_active: false,
        disabled_reason: "Auto-disabled after 10 consecutive failures",
      } : {}),
    }).eq("id", ep.id);
  }
}

// ── Retry a specific delivery ─────────────────────────────────────────────────

export async function retryDelivery(deliveryId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getServiceClient();

  const { data: delivery, error } = await supabase
    .from("webhook_deliveries")
    .select("*, endpoint:webhook_endpoints(url, secret, is_active, failure_count)")
    .eq("id", deliveryId)
    .single();

  if (error || !delivery) return { ok: false, error: "Delivery not found" };
  if (delivery.attempt >= delivery.max_attempts) return { ok: false, error: "Max retry attempts reached" };

  const ep = delivery.endpoint as { url: string; secret: string; is_active: boolean; failure_count: number };

  const result = await dispatchToUrl(ep.url, ep.secret, delivery.payload as WebhookPayload);
  const newAttempt = delivery.attempt + 1;
  const hasMoreRetries = newAttempt < delivery.max_attempts;
  const nextRetryAt = result.status === "failed" && hasMoreRetries && RETRY_DELAYS_S[newAttempt - 1]
    ? new Date(Date.now() + RETRY_DELAYS_S[newAttempt - 1] * 1000).toISOString()
    : null;

  await supabase.from("webhook_deliveries").update({
    status: result.status === "success" ? "success" : (nextRetryAt ? "retrying" : (hasMoreRetries ? "failed" : "dead")),
    http_status: result.httpStatus,
    response_body: result.responseBody,
    error_message: result.errorMessage,
    duration_ms: result.durationMs,
    attempt: newAttempt,
    next_retry_at: nextRetryAt,
    delivered_at: result.status === "success" ? new Date().toISOString() : null,
  }).eq("id", deliveryId);

  if (result.status === "success") {
    await supabase.from("webhook_endpoints").update({
      last_triggered_at: new Date().toISOString(),
      failure_count: 0,
    }).eq("id", delivery.endpoint_id);
  }

  return { ok: true };
}
