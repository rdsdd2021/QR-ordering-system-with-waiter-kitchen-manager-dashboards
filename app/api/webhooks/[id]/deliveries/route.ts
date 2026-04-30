/**
 * GET /api/webhooks/[id]/deliveries — paginated delivery log for an endpoint
 * Query params: ?status=success|failed|dead|retrying&limit=50&offset=0
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const restaurantId = await getManagerRestaurantId(req);
  if (!restaurantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();

  // Verify ownership
  const { data: ep } = await supabase
    .from("webhook_endpoints")
    .select("id")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!ep) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit  = Math.min(parseInt(url.searchParams.get("limit")  ?? "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  let query = supabase
    .from("webhook_deliveries")
    .select("id, event_id, event_type, status, http_status, response_body, error_message, attempt, max_attempts, duration_ms, next_retry_at, delivered_at, created_at", { count: "exact" })
    .eq("endpoint_id", id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deliveries: data ?? [], total: count ?? 0 });
}
