/**
 * Client-side helpers for the webhook API.
 * All calls include the Supabase session token for auth.
 */
import { supabase } from "@/lib/supabase";
import type { WebhookEndpoint, WebhookDelivery, WebhookEventType } from "@/types/webhooks";

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function apiFetch(path: string, init?: RequestInit) {
  const token = await getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export async function listEndpoints(): Promise<WebhookEndpoint[]> {
  const data = await apiFetch("/api/webhooks");
  return data.endpoints;
}

export async function createEndpoint(payload: {
  name: string; url: string; events: WebhookEventType[];
}): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
  return apiFetch("/api/webhooks", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateEndpoint(
  id: string,
  updates: Partial<{ name: string; url: string; events: WebhookEventType[]; is_active: boolean }>
): Promise<WebhookEndpoint> {
  const data = await apiFetch(`/api/webhooks/${id}`, { method: "PATCH", body: JSON.stringify(updates) });
  return data.endpoint;
}

export async function deleteEndpoint(id: string): Promise<void> {
  await apiFetch(`/api/webhooks/${id}`, { method: "DELETE" });
}

export async function testEndpoint(id: string): Promise<{
  success: boolean; httpStatus: number | null; responseBody: string | null;
  errorMessage: string | null; durationMs: number;
}> {
  return apiFetch(`/api/webhooks/${id}/test`, { method: "POST" });
}

export async function rotateSecret(id: string): Promise<{ secret: string }> {
  return apiFetch(`/api/webhooks/${id}/rotate-secret`, { method: "POST" });
}

// ── Deliveries ────────────────────────────────────────────────────────────────

export async function listDeliveries(
  endpointId: string,
  opts?: { status?: string; limit?: number; offset?: number }
): Promise<{ deliveries: WebhookDelivery[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit)  params.set("limit",  String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  return apiFetch(`/api/webhooks/${endpointId}/deliveries?${params}`);
}

export async function retryDeliveryClient(endpointId: string, deliveryId: string): Promise<void> {
  await apiFetch(`/api/webhooks/${endpointId}/retry`, {
    method: "POST",
    body: JSON.stringify({ delivery_id: deliveryId }),
  });
}
