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
 * Order creation is delegated to the place_order_atomic RPC which:
 *   - Fetches prices server-side from menu_items (QW-2)
 *   - Snapshots item names at insert time (QW-4)
 *   - Runs all inserts in a single atomic transaction (QW-11)
 */
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { createClient } from "@supabase/supabase-js";
import { fireEvent } from "@/lib/webhooks";

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

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
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

  // Check for unpaid orders at this table
  const hasConflict = await supabase.rpc("check_table_has_unpaid_orders", {
    p_table_id: tableId,
    p_customer_phone: customerPhone?.trim() || null,
  });

  if (hasConflict.data === true) {
    return NextResponse.json({ result: "UNPAID_ORDERS_EXIST" });
  }

  // TODO QW-6: Add quantity validation here (task 8.1)
  // QW-6: Validate each item's quantity — must be an integer in [1, 99]
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      return NextResponse.json(
        { error: "Each item quantity must be an integer between 1 and 99" },
        { status: 400 }
      );
    }
  }

  // ── Single atomic RPC — fetches prices from DB, snapshots names, atomic tx ─
  // Note: item.price from the request body is intentionally NOT passed to the
  // RPC — the RPC fetches actual prices from menu_items server-side (QW-2).
  const { data: orderId, error: rpcError } = await supabase.rpc("place_order_atomic", {
    p_restaurant_id: restaurantId,
    p_table_id: tableId,
    p_items: items.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity })),
    p_customer_name: customerName?.trim() || null,
    p_customer_phone: customerPhone?.trim() || null,
    p_party_size: partySize || null,
  });

  if (rpcError || !orderId) {
    console.error("[api/orders] place_order_atomic error:", rpcError?.message);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }

  // ── Fire order.placed webhook server-side ─────────────────────────────────
  // Must run server-side: the customer page has no staff session token, so
  // the client-side triggerWebhook() in lib/api.ts always silently no-ops here.
  (async () => {
    try {
      const svc = getServiceClient();

      // ── Upsert customer profile ──────────────────────────────────────────
      // Increment visit_count only when this is a new order session (first order
      // from this phone at this restaurant today). Simple approach: always upsert
      // and increment — the unique constraint on (restaurant_id, phone) handles dedup.
      if (customerPhone?.trim() && customerName?.trim()) {
        await svc.rpc("upsert_customer", {
          p_restaurant_id: restaurantId,
          p_phone:         customerPhone.trim(),
          p_name:          customerName.trim(),
        });
      }
      const [orderRes, restaurantRes, tableRes] = await Promise.all([
        svc.from("orders")
          .select("status, customer_name, customer_phone, party_size, created_at, order_items(quantity, price, name, menu_item_id)")
          .eq("id", orderId)
          .maybeSingle(),
        svc.from("restaurants").select("name, slug").eq("id", restaurantId).maybeSingle(),
        svc.from("tables").select("table_number, capacity, floor:floors(name)").eq("id", tableId).maybeSingle(),
      ]);

      const orderRow  = orderRes.data;
      const tableData = tableRes.data as { table_number: number; capacity: number | null; floor: { name: string } | null } | null;

      await fireEvent(restaurantId, "order.placed", {
        order_id: orderId,
        status: orderRow?.status ?? "pending",
        created_at: orderRow?.created_at ?? new Date().toISOString(),
        restaurant: {
          id: restaurantId,
          name: restaurantRes.data?.name ?? null,
          slug: restaurantRes.data?.slug ?? null,
        },
        table: {
          id: tableId,
          table_number: tableData?.table_number ?? null,
          floor: (tableData?.floor as { name: string } | null)?.name ?? null,
          capacity: tableData?.capacity ?? null,
        },
        customer: {
          name: customerName?.trim() || null,
          phone: customerPhone?.trim() || null,
          party_size: partySize || null,
        },
        order_items: ((orderRow?.order_items ?? []) as { quantity: number; price: number; name: string | null; menu_item_id: string }[]).map(i => ({
          menu_item_id: i.menu_item_id,
          name: i.name ?? null,
          quantity: i.quantity,
          unit_price: i.price,
          subtotal: i.quantity * i.price,
        })),
        total_amount: ((orderRow?.order_items ?? []) as { quantity: number; price: number }[])
          .reduce((sum, i) => sum + i.quantity * i.price, 0),
      });
    } catch (err) {
      console.error("[api/orders] order.placed webhook error:", err);
    }
  })();

  return NextResponse.json({ result: orderId });
}
