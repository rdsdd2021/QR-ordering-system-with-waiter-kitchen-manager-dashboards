/**
 * POST /api/webhooks/trigger
 *
 * Internal endpoint to fire a webhook event.
 * Called by client-side lib/api.ts after mutations (order placed, menu changes, etc.)
 * Authenticated via the user's session token — only managers and staff of the
 * restaurant can trigger events for their own restaurant.
 *
 * Body: { restaurantId: string; event: WebhookEventType; data: Record<string, unknown> }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fireEvent } from "@/lib/webhooks";
import { WEBHOOK_EVENTS, type WebhookEventType } from "@/types/webhooks";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getRestaurantIdForUser(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user }, error } = await anonClient.auth.getUser(token);
  if (error || !user) return null;

  const svc = getServiceClient();
  const { data } = await svc
    .from("users")
    .select("restaurant_id, role")
    .eq("auth_id", user.id)
    .maybeSingle();

  // Allow manager, waiter, kitchen — any authenticated staff member
  if (!data?.restaurant_id) return null;
  return data.restaurant_id;
}

export async function POST(req: NextRequest) {
  const restaurantId = await getRestaurantIdForUser(req);
  if (!restaurantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { restaurantId: bodyRestaurantId, event, data } = body as {
    restaurantId?: string;
    event?: string;
    data?: Record<string, unknown>;
  };

  // Ensure the caller can only fire events for their own restaurant
  if (bodyRestaurantId && bodyRestaurantId !== restaurantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!event || !(WEBHOOK_EVENTS as readonly string[]).includes(event)) {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
  }

  // Fire async — don't block the response
  fireEvent(restaurantId, event as WebhookEventType, data ?? {}).catch(err =>
    console.error("[webhooks/trigger] fireEvent error:", err)
  );

  return NextResponse.json({ queued: true });
}
