/**
 * POST /api/webhooks/[id]/retry
 * Body: { delivery_id: string }
 * Retries a specific failed delivery.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { retryDelivery } from "@/lib/webhooks";

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

  const body = await req.json().catch(() => null);
  const deliveryId = body?.delivery_id;
  if (!deliveryId) return NextResponse.json({ error: "delivery_id required" }, { status: 400 });

  // Verify the delivery belongs to this manager's endpoint
  const supabase = getServiceClient();
  const { data: delivery } = await supabase
    .from("webhook_deliveries")
    .select("id, endpoint_id")
    .eq("id", deliveryId)
    .maybeSingle();

  if (!delivery) return NextResponse.json({ error: "Delivery not found" }, { status: 404 });

  const { data: ep } = await supabase
    .from("webhook_endpoints")
    .select("id")
    .eq("id", delivery.endpoint_id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (!ep) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const result = await retryDelivery(deliveryId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true });
}
