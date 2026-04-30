/**
 * POST /api/orders
 *
 * G5: Server-side order placement endpoint with rate limiting.
 * Replaces the direct client-side Supabase call for order creation.
 *
 * Rate limits (per IP + table):
 *   - 10 orders per minute per table (prevents spam)
 *   - 30 orders per hour per IP (prevents cross-table abuse)
 *
 * The actual order logic delegates to placeOrder() in lib/api.ts
 * which runs with the anon key (respects RLS).
 */
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { createClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@/types/database";

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Per table: 10 orders / minute — prevents a single table from spamming
const perTableLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
// Per IP: 30 orders / hour — prevents cross-table abuse from one client
const perIpLimiter    = createRateLimiter({ windowMs: 3_600_000, max: 30 });

// Purge expired entries every 100 requests to prevent memory growth
let requestCount = 0;
function maybePurge() {
  if (++requestCount % 100 === 0) {
    perTableLimiter.purge();
    perIpLimiter.purge();
  }
}

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  maybePurge();

  const ip = getIp(req);

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { restaurantId, tableId, items, customerName, customerPhone, partySize } = body as {
    restaurantId?: string;
    tableId?: string;
    items?: { menu_item_id: string; quantity: number; price: number }[];
    customerName?: string;
    customerPhone?: string;
    partySize?: number;
  };

  if (!restaurantId || !tableId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // ── Rate limit checks ─────────────────────────────────────────────────────
  const tableKey = `table:${tableId}`;
  const ipKey    = `ip:${ip}`;

  const tableCheck = perTableLimiter.check(tableKey);
  if (!tableCheck.ok) {
    return NextResponse.json(
      { error: "Too many orders placed at this table. Please wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(tableCheck.retryAfterMs / 1000)) },
      }
    );
  }

  const ipCheck = perIpLimiter.check(ipKey);
  if (!ipCheck.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(ipCheck.retryAfterMs / 1000)) },
      }
    );
  }

  // ── Validate party_size ───────────────────────────────────────────────────
  if (partySize !== undefined && partySize !== null) {
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) {
      return NextResponse.json({ error: "party_size must be between 1 and 50" }, { status: 400 });
    }
  }

  // ── Place order using anon client (respects RLS) ──────────────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Check for unpaid orders and fetch restaurant config in parallel
  const [hasConflict, restaurantRes] = await Promise.all([
    supabase.rpc("check_table_has_unpaid_orders", {
      p_table_id: tableId,
      p_customer_phone: customerPhone?.trim() || null,
    }),
    supabase
      .from("restaurants")
      .select("id, order_routing_mode")
      .eq("id", restaurantId)
      .maybeSingle(),
  ]);

  if (hasConflict.data === true) {
    return NextResponse.json({ result: "UNPAID_ORDERS_EXIST" });
  }

  if (!restaurantRes.data) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }

  const routingMode = restaurantRes.data.order_routing_mode || "direct_to_kitchen";
  const initialStatus: OrderStatus = routingMode === "waiter_first" ? "pending_waiter" : "pending";

  // Insert order
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      restaurant_id: restaurantId,
      table_id: tableId,
      status: initialStatus,
      customer_name: customerName?.trim() || null,
      customer_phone: customerPhone?.trim() || null,
      party_size: partySize || null,
    })
    .select("id")
    .maybeSingle();

  if (orderError || !order) {
    console.error("[api/orders] order insert error:", orderError?.message);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }

  const orderId = (order as { id: string }).id;

  // Calculate prices with floor multiplier
  const { data: pricedItems, error: priceError } = await supabase.rpc(
    "calculate_item_prices_batch",
    {
      p_items: items.map((item) => ({
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        base_price: item.price,
      })),
      p_table_id: tableId,
    }
  );

  let orderItems: { order_id: string; menu_item_id: string; quantity: number; price: number }[];

  if (priceError || !pricedItems) {
    // Fallback: fetch floor multiplier directly
    let multiplier = 1.0;
    try {
      const { data: floorRow } = await supabase
        .from("tables")
        .select("floor:floors(price_multiplier)")
        .eq("id", tableId)
        .maybeSingle();
      const floor = (Array.isArray(floorRow?.floor) ? floorRow.floor[0] : floorRow?.floor) as
        | { price_multiplier: number }
        | null
        | undefined;
      if (floor?.price_multiplier) multiplier = floor.price_multiplier;
    } catch {
      console.error("[api/orders] Could not fetch floor multiplier — aborting");
      return NextResponse.json({ error: "Pricing error" }, { status: 500 });
    }
    orderItems = items.map((item) => ({
      order_id: orderId,
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
      price: Math.round(item.price * multiplier * 100) / 100,
    }));
  } else {
    orderItems = (pricedItems as { menu_item_id: string; final_price: number }[]).map((p, i) => ({
      order_id: orderId,
      menu_item_id: p.menu_item_id,
      quantity: items[i].quantity,
      price: p.final_price,
    }));
  }

  const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
  if (itemsError) {
    console.error("[api/orders] order_items insert error:", itemsError.message);
    return NextResponse.json({ error: "Failed to add order items" }, { status: 500 });
  }

  return NextResponse.json({ result: orderId });
}
