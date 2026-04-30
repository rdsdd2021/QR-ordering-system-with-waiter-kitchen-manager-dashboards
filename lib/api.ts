/**
 * API helper functions that abstract Supabase queries.
 * Keeping data-fetching logic separate from UI components.
 */
import { supabase } from "./supabase";

// ── Restaurant config cache ───────────────────────────────────────────────────
// Restaurant config (routing mode, geofencing, etc.) rarely changes.
// Cache it in-memory for 5 minutes to avoid a DB round-trip on every order.

type CachedRestaurant = { data: import("@/types/database").Restaurant; expiresAt: number };
const _restaurantCache = new Map<string, CachedRestaurant>();
const RESTAURANT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedRestaurant(id: string): import("@/types/database").Restaurant | null {
  const entry = _restaurantCache.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _restaurantCache.delete(id); return null; }
  return entry.data;
}

function setCachedRestaurant(id: string, data: import("@/types/database").Restaurant) {
  _restaurantCache.set(id, { data, expiresAt: Date.now() + RESTAURANT_CACHE_TTL_MS });
}

/** Call this whenever restaurant settings are updated so the cache stays fresh. */
export function invalidateRestaurantCache(restaurantId: string) {
  _restaurantCache.delete(restaurantId);
}
import type { 
  MenuItem, 
  Restaurant, 
  RestaurantTable, 
  User, 
  KitchenOrder, 
  WaiterOrder,
  BillingOrder,
  OrderStatus,
  OrderStatusLog,
  Floor,
  CustomerOrderSession,
  FoodCategory,
  FoodTag,
  CategorySuggestion,
  TagSuggestion,
} from "@/types/database";
import { isValidStatusTransition } from "@/types/database";
import type { WebhookEventType } from "@/types/webhooks";

// ── Webhook trigger helper ────────────────────────────────────────────────────

/**
 * Fire a webhook event from the client side.
 * Calls the server-side /api/webhooks/trigger endpoint which handles auth
 * and dispatches to all subscribed endpoints for the restaurant.
 * Non-blocking — errors are swallowed so they never break the caller.
 */
async function triggerWebhook(
  restaurantId: string,
  event: WebhookEventType,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;

    await fetch("/api/webhooks/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ restaurantId, event, data }),
    });
  } catch {
    // Non-fatal — webhook failures must never break the main flow
  }
}

/**
 * Fetch a restaurant by its ID.
 * Results are cached in-memory for 5 minutes — call invalidateRestaurantCache()
 * after any settings update to keep the cache consistent.
 */
export async function getRestaurant(
  restaurantId: string
): Promise<Restaurant | null> {
  const cached = getCachedRestaurant(restaurantId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, slug, logo_url, is_active, order_routing_mode, geofencing_enabled, geo_latitude, geo_longitude, geo_radius_meters, auto_confirm_minutes")
    .eq("id", restaurantId)
    .maybeSingle(); // maybeSingle returns null instead of error when 0 rows found

  if (error) {
    console.error("Error fetching restaurant:", error.message, error.code);
    return null;
  }
  if (data) setCachedRestaurant(restaurantId, data as Restaurant);
  return data as Restaurant | null;
}

/**
 * Fetch a table by its ID, scoped to a restaurant.
 * Returns null if not found.
 */
export async function getTable(
  restaurantId: string,
  tableId: string
): Promise<RestaurantTable | null> {
  const { data, error } = await supabase
    .from("tables")
    .select("id, restaurant_id, table_number, floor_id, capacity, qr_code_url")
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle(); // maybeSingle returns null instead of error when 0 rows found

  if (error) {
    console.error("Error fetching table:", error.message, error.code);
    return null;
  }
  return data as RestaurantTable | null;
}

/**
 * Fetch all available menu items for a restaurant.
 * Only returns items where is_available = true.
 */
export async function getMenuItems(restaurantId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, restaurant_id, name, price, is_available, image_url, tags, description")
    .eq("restaurant_id", restaurantId)
    .eq("is_available", true)
    .order("name");

  if (error) {
    console.error("Error fetching menu items:", error.message);
    return [];
  }
  return (data ?? []) as MenuItem[];
}

/**
 * Check if a table has any unpaid orders.
 * Returns true if there are existing orders that haven't been billed yet.
 */
export async function checkTableHasUnpaidOrders(tableId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_table_has_unpaid_orders", {
    p_table_id: tableId,
  });

  if (error) {
    console.error("Error checking unpaid orders:", error.message);
    return false;
  }

  return data === true;
}

/**
 * Get existing unpaid orders for a table.
 * Used to show customers what orders are already pending payment.
 */
export async function getTableUnpaidOrders(tableId: string): Promise<Array<{
  order_id: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
  total_amount: number;
}>> {
  const { data, error } = await supabase.rpc("get_table_unpaid_orders", {
    p_table_id: tableId,
  });

  if (error) {
    console.error("Error getting unpaid orders:", error.message);
    return [];
  }

  return data || [];
}

/**
 * Place an order:
 * 
 * BILLING SAFETY: This function now checks for existing unpaid orders and prevents
 * new orders from being placed if there are unpaid bills to avoid billing conflicts.
 * 
 * 1. Check for existing unpaid orders (returns 'UNPAID_ORDERS_EXIST' if found)
 * 2. Determine initial status based on restaurant's routing mode
 * 3. Insert a new row into `orders`
 * 4. Insert all cart items into `order_items`
 *
 * ROUTING LOGIC:
 * - If routing_mode = 'direct_to_kitchen': status = 'pending' (visible to kitchen immediately)
 * - If routing_mode = 'waiter_first': status = 'pending_waiter' (waiter must accept first)
 *
 * Returns the created order ID on success, null on failure, or 'UNPAID_ORDERS_EXIST' if blocked.
 */
export async function placeOrder(params: {
  restaurantId: string;
  tableId: string;
  items: { menu_item_id: string; quantity: number; price: number }[];
  customerName?: string;
  customerPhone?: string;
  partySize?: number;
}): Promise<string | 'UNPAID_ORDERS_EXIST' | null> {
  const { restaurantId, tableId, items, customerName, customerPhone, partySize } = params;

  // Step 1 + 2 in parallel: check for unpaid orders AND fetch restaurant config simultaneously.
  // Previously these were sequential — now they run concurrently, saving one full round-trip.
  const [hasConflict, restaurant] = await Promise.all([
    supabase.rpc("check_table_has_unpaid_orders", {
      p_table_id: tableId,
      p_customer_phone: customerPhone?.trim() || null,
    }),
    getRestaurant(restaurantId),
  ]);

  if (hasConflict.data === true) {
    console.log(`[Billing Safety] Blocked new order for table ${tableId} - existing unpaid orders found`);
    return 'UNPAID_ORDERS_EXIST';
  }

  if (!restaurant) {
    console.error("Restaurant not found:", restaurantId);
    return null;
  }

  // Determine initial order status based on routing mode
  const routingMode = restaurant.order_routing_mode || 'direct_to_kitchen';
  const initialStatus: OrderStatus = routingMode === 'waiter_first' ? 'pending_waiter' : 'pending';

  console.log(`[Order Routing] Mode: ${routingMode}, Initial Status: ${initialStatus}`);

  // Step 3: Create the order record with appropriate initial status
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
    console.error("Error creating order:", orderError?.message);
    return null;
  }

  const orderId = (order as { id: string }).id;

  // Step 4: Calculate final prices with floor multiplier in a single RPC call
  const { data: pricedItems, error: priceError } = await supabase.rpc('calculate_item_prices_batch', {
    p_items: items.map(item => ({ menu_item_id: item.menu_item_id, quantity: item.quantity, base_price: item.price })),
    p_table_id: tableId,
  });

  let orderItems: { order_id: string; menu_item_id: string; quantity: number; price: number }[];

  if (priceError || !pricedItems) {
    // B4 fix: RPC failed — fetch the floor multiplier directly so we never
    // silently fall back to the base price and charge the wrong amount.
    console.warn("Batch price calculation failed, fetching floor multiplier directly:", priceError?.message);

    let multiplier = 1.0;
    try {
      const { data: floorRow } = await supabase
        .from("tables")
        .select("floor:floors(price_multiplier)")
        .eq("id", tableId)
        .maybeSingle();
      const floor = (Array.isArray(floorRow?.floor) ? floorRow.floor[0] : floorRow?.floor) as { price_multiplier: number } | null | undefined;
      if (floor?.price_multiplier) multiplier = floor.price_multiplier;
    } catch {
      // If this also fails, log clearly — do NOT silently use base price
      console.error("[placeOrder] Could not fetch floor multiplier — order aborted to prevent wrong billing");
      return null;
    }

    orderItems = items.map(item => ({
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

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems);

  if (itemsError) {
    console.error("Error creating order items:", itemsError.message);
    return null;
  }

  // Fire webhook (non-blocking) — enrich with restaurant, table, and item names
  (async () => {
    try {
      const [restaurantRes, tableRes, menuItemsRes] = await Promise.all([
        supabase.from("restaurants").select("name, slug").eq("id", restaurantId).maybeSingle(),
        supabase.from("tables").select("table_number, capacity, floor:floors(name)").eq("id", tableId).maybeSingle(),
        supabase.from("menu_items").select("id, name, description, tags").in("id", orderItems.map(i => i.menu_item_id)),
      ]);

      const menuItemMap = Object.fromEntries(
        (menuItemsRes.data ?? []).map((m: { id: string; name: string; description: string | null; tags: string[] | null }) => [m.id, m])
      );
      const tableData = tableRes.data as { table_number: number; capacity: number | null; floor: { name: string } | null } | null;

      triggerWebhook(restaurantId, "order.placed", {
        order_id: orderId,
        status: initialStatus,
        created_at: new Date().toISOString(),
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
        order_items: orderItems.map(i => ({
          menu_item_id: i.menu_item_id,
          name: menuItemMap[i.menu_item_id]?.name ?? null,
          description: menuItemMap[i.menu_item_id]?.description ?? null,
          tags: menuItemMap[i.menu_item_id]?.tags ?? null,
          quantity: i.quantity,
          unit_price: i.price,
          subtotal: i.quantity * i.price,
        })),
        total_amount: orderItems.reduce((sum, i) => sum + i.quantity * i.price, 0),
      });
    } catch {
      // Non-fatal
    }
  })();

  return orderId;
}

// ── User Management API ───────────────────────────────────────────────────────

/**
 * Fetch all users for a restaurant, optionally filtered by role.
 */
export async function getUsers(
  restaurantId: string,
  role?: string
): Promise<User[]> {
  let query = supabase
    .from("users")
    .select("id, name, role, restaurant_id, created_at")
    .eq("restaurant_id", restaurantId)
    .order("name");

  if (role) {
    query = query.eq("role", role);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching users:", error.message);
    return [];
  }
  return (data ?? []) as User[];
}

/**
 * Fetch a user by ID.
 */
export async function getUser(userId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, role, restaurant_id, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching user:", error.message);
    return null;
  }
  return data as User | null;
}

// ── Kitchen Dashboard API ─────────────────────────────────────────────────────

/**
 * Fetch all orders for a restaurant (kitchen view), newest first.
 * Joins tables, waiter info, and order_items → menu_items.
 * 
 * ROUTING LOGIC:
 * Kitchen should ONLY see orders that have been accepted/confirmed.
 * - Excludes 'pending_waiter' (waiting for waiter to accept)
 * - Excludes 'served' (already completed)
 * - Shows: 'pending', 'confirmed', 'preparing', 'ready'
 */
export async function getKitchenOrders(
  restaurantId: string
): Promise<KitchenOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, restaurant_id, table_id, status, waiter_id, created_at,
       table:tables(table_number),
       waiter:users(name),
       order_items(id, quantity, price, menu_item:menu_items(name))`
    )
    .eq("restaurant_id", restaurantId)
    .in("status", ["pending", "confirmed", "preparing", "ready"]) // Kitchen sees these statuses
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching kitchen orders:", error.message);
    return [];
  }
  return (data ?? []) as unknown as KitchenOrder[];
}

/**
 * Update order status (kitchen operations: pending → confirmed → preparing → ready).
 * Validates state transitions and logs changes.
 */
export async function updateOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
  userId?: string
): Promise<boolean> {
  // First, get current order to validate transition
  const { data: currentOrder, error: fetchError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError || !currentOrder) {
    console.error("Error fetching current order:", fetchError?.message);
    return false;
  }

  const currentStatus = currentOrder.status as OrderStatus;
  
  // Validate transition (client-side check, server also validates)
  if (!isValidStatusTransition(currentStatus, newStatus)) {
    console.error(`Invalid transition from ${currentStatus} to ${newStatus}`);
    return false;
  }

  // Update the order status
  const updateData: any = { status: newStatus };
  if (userId) {
    updateData.waiter_id = userId;
  }

  const { error } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", orderId);

  if (error) {
    console.error("Error updating order status:", error.message);
    return false;
  }

  // Map order status → webhook event
  const statusEventMap: Partial<Record<OrderStatus, WebhookEventType>> = {
    confirmed:    "order.confirmed",
    preparing:    "order.preparing",
    ready:        "order.ready",
    served:       "order.served",
    cancelled:    "order.cancelled",
  };
  const webhookEvent = statusEventMap[newStatus];
  if (webhookEvent) {
    (async () => {
      try {
        const { data: orderRow } = await supabase
          .from("orders")
          .select(`
            restaurant_id, table_id, customer_name, customer_phone, party_size,
            total_amount, created_at, waiter_id,
            table:tables(table_number, capacity, floor:floors(name)),
            waiter:users(name),
            order_items(quantity, price, menu_item:menu_items(id, name, description, tags))
          `)
          .eq("id", orderId)
          .maybeSingle();

        if (!orderRow?.restaurant_id) return;

        const { data: restaurantRow } = await supabase
          .from("restaurants")
          .select("name, slug")
          .eq("id", orderRow.restaurant_id)
          .maybeSingle();

        const tableData = orderRow.table as unknown as { table_number: number; capacity: number | null; floor: { name: string } | null } | null;
        const waiterData = (Array.isArray(orderRow.waiter)
          ? (orderRow.waiter as { name: string }[])[0] ?? null
          : orderRow.waiter as { name: string } | null);
        type RawMenuItem = { id: string; name: string; description: string | null; tags: string[] | null };
        type RawItem = { quantity: number; price: number; menu_item: RawMenuItem | RawMenuItem[] | null };
        const rawItems = (orderRow.order_items ?? []) as unknown as RawItem[];
        const normalizedItems = rawItems.map(i => ({
          quantity: i.quantity,
          price: i.price,
          menu_item: Array.isArray(i.menu_item) ? (i.menu_item[0] ?? null) : i.menu_item,
        }));

        triggerWebhook(orderRow.restaurant_id, webhookEvent, {
          order_id: orderId,
          status: newStatus,
          previous_status: currentStatus,
          created_at: orderRow.created_at,
          restaurant: {
            id: orderRow.restaurant_id,
            name: restaurantRow?.name ?? null,
            slug: restaurantRow?.slug ?? null,
          },
          table: {
            id: orderRow.table_id,
            table_number: tableData?.table_number ?? null,
            floor: (tableData?.floor as { name: string } | null)?.name ?? null,
            capacity: tableData?.capacity ?? null,
          },
          customer: {
            name: orderRow.customer_name ?? null,
            phone: orderRow.customer_phone ?? null,
            party_size: orderRow.party_size ?? null,
          },
          waiter: waiterData ? { id: orderRow.waiter_id, name: waiterData.name } : null,
          order_items: normalizedItems.map(i => ({
            name: i.menu_item?.name ?? null,
            description: i.menu_item?.description ?? null,
            tags: i.menu_item?.tags ?? null,
            quantity: i.quantity,
            unit_price: i.price,
            subtotal: i.quantity * i.price,
          })),
          total_amount: orderRow.total_amount,
        });
      } catch {
        // Non-fatal
      }
    })();
  }

  return true;
}

// ── Waiter Dashboard API ──────────────────────────────────────────────────────

/**
 * Fetch orders for waiter dashboard.
 *
 * SESSION-BASED VISIBILITY RULES:
 * A waiter sees:
 *  1. Orders assigned to them (their own active orders)
 *  2. Unassigned orders for tables that have NO active session
 *     (i.e. truly available tables — no other waiter is serving them)
 *
 * Orders for tables that already have an active session owned by another
 * waiter are NOT shown — those will be auto-assigned by the DB trigger.
 */
export async function getWaiterOrders(
  restaurantId: string,
  waiterId?: string
): Promise<WaiterOrder[]> {
  if (!waiterId) {
    // Fallback: no filter (manager/debug view)
    const { data, error } = await supabase
      .from("orders")
      .select(
        `id, restaurant_id, table_id, status, waiter_id, created_at,
         table:tables(table_number, floor:floors(name)),
         waiter:users(name),
         order_items(id, quantity, price, menu_item:menu_items(name))`
      )
      .eq("restaurant_id", restaurantId)
      .neq("status", "served")
      .order("created_at", { ascending: false });
    if (error) { console.error("Error fetching waiter orders:", error.message); return []; }
    return (data ?? []) as unknown as WaiterOrder[];
  }

  // 1. Get table IDs that have an active session owned by ANOTHER waiter
  //    (we must exclude unassigned orders for those tables)
  const { data: otherSessions } = await supabase
    .from("table_sessions")
    .select("table_id")
    .eq("restaurant_id", restaurantId)
    .neq("waiter_id", waiterId)
    .is("closed_at", null);

  const lockedTableIds: string[] = (otherSessions ?? []).map((s: any) => s.table_id);

  // 2. Build the order query
  //    Show: orders assigned to me  OR  unassigned orders on unlocked tables
  let query = supabase
    .from("orders")
    .select(
      `id, restaurant_id, table_id, status, waiter_id, created_at,
       table:tables(table_number, floor:floors(name)),
       waiter:users(name),
       order_items(id, quantity, price, menu_item:menu_items(name))`
    )
    .eq("restaurant_id", restaurantId)
    .neq("status", "served");

  if (lockedTableIds.length > 0) {
    // Assigned to me  OR  (unassigned AND not on a locked table AND right status)
    query = query.or(
      `waiter_id.eq.${waiterId},` +
      `and(waiter_id.is.null,status.in.(pending_waiter,ready),table_id.not.in.(${lockedTableIds.join(",")}))`
    );
  } else {
    // No locked tables — show mine + all unassigned pending_waiter/ready
    query = query.or(
      `waiter_id.eq.${waiterId},` +
      `and(waiter_id.is.null,status.in.(pending_waiter,ready))`
    );
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) { console.error("Error fetching waiter orders:", error.message); return []; }
  return (data ?? []) as unknown as WaiterOrder[];
}

/**
 * Assign a waiter to an order AND open a table session.
 * Used for direct-to-kitchen routing where the waiter takes an already-confirmed order.
 */
export async function assignWaiterToOrder(
  orderId: string,
  waiterId: string
): Promise<boolean> {
  try {
    // Use atomic assignment function to prevent race conditions
    const { data, error } = await supabase.rpc("assign_order_to_waiter", {
      p_order_id: orderId,
      p_waiter_id: waiterId,
    });

    if (error) {
      console.error("Error assigning waiter to order:", error.message);
      return false;
    }

    return data === true;
  } catch (error) {
    console.error("Error in assignWaiterToOrder:", error);
    return false;
  }
}

/**
 * Mark an order as served (waiter operation: ready → served).
 */
export async function markOrderServed(
  orderId: string,
  waiterId: string
): Promise<boolean> {
  return updateOrderStatus(orderId, "served", waiterId);
}

/**
 * Accept an order (waiter-first routing: pending_waiter → confirmed).
 * Sets waiter_id, changes status to 'confirmed', and opens a table session.
 */
export async function acceptOrder(
  orderId: string,
  waiterId: string
): Promise<boolean> {
  try {
    // Use atomic acceptance function to prevent race conditions
    const { data, error } = await supabase.rpc("accept_order_atomic", {
      p_order_id: orderId,
      p_waiter_id: waiterId,
    });

    if (error) {
      console.error("Error accepting order:", error.message);
      return false;
    }

    if (data === true) {
      // Fire order.confirmed webhook with rich data
      (async () => {
        try {
          const { data: orderRow } = await supabase
            .from("orders")
            .select(`
              restaurant_id, table_id, customer_name, customer_phone, party_size,
              total_amount, created_at,
              table:tables(table_number, capacity, floor:floors(name)),
              order_items(quantity, price, menu_item:menu_items(id, name, description, tags))
            `)
            .eq("id", orderId)
            .maybeSingle();

          if (!orderRow?.restaurant_id) return;

          const { data: restaurantRow } = await supabase
            .from("restaurants")
            .select("name, slug")
            .eq("id", orderRow.restaurant_id)
            .maybeSingle();

          const tableData = orderRow.table as unknown as { table_number: number; capacity: number | null; floor: { name: string } | null } | null;
          type RawMenuItem2 = { id: string; name: string; description: string | null; tags: string[] | null };
          type RawItem2 = { quantity: number; price: number; menu_item: RawMenuItem2 | RawMenuItem2[] | null };
          const rawItems = (orderRow.order_items ?? []) as unknown as RawItem2[];
          const normalizedItems2 = rawItems.map(i => ({
            quantity: i.quantity,
            price: i.price,
            menu_item: Array.isArray(i.menu_item) ? (i.menu_item[0] ?? null) : i.menu_item,
          }));

          triggerWebhook(orderRow.restaurant_id, "order.confirmed", {
            order_id: orderId,
            status: "confirmed",
            created_at: orderRow.created_at,
            restaurant: {
              id: orderRow.restaurant_id,
              name: restaurantRow?.name ?? null,
              slug: restaurantRow?.slug ?? null,
            },
            table: {
              id: orderRow.table_id,
              table_number: tableData?.table_number ?? null,
              floor: (tableData?.floor as { name: string } | null)?.name ?? null,
              capacity: tableData?.capacity ?? null,
            },
            customer: {
              name: orderRow.customer_name ?? null,
              phone: orderRow.customer_phone ?? null,
              party_size: orderRow.party_size ?? null,
            },
            waiter: { id: waiterId },
            order_items: normalizedItems2.map(i => ({
              name: i.menu_item?.name ?? null,
              description: i.menu_item?.description ?? null,
              tags: i.menu_item?.tags ?? null,
              quantity: i.quantity,
              unit_price: i.price,
              subtotal: i.quantity * i.price,
            })),
            total_amount: orderRow.total_amount,
          });
        } catch {
          // Non-fatal
        }
      })();
    }

    return data === true;
  } catch (error) {
    console.error("Error in acceptOrder:", error);
    return false;
  }
}

// ── Order Status Logs API ─────────────────────────────────────────────────────

/**
 * Fetch status change history for an order.
 */
export async function getOrderStatusLogs(
  orderId: string
): Promise<OrderStatusLog[]> {
  const { data, error } = await supabase
    .from("order_status_logs")
    .select(
      `id, order_id, old_status, new_status, created_at,
       changed_by_user:users(name)`
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching order status logs:", error.message);
    return [];
  }
  return (data ?? []) as unknown as OrderStatusLog[];
}

// ── Audit log helper (client-side) ───────────────────────────────────────────

/**
 * Fire-and-forget audit log call via the /api/audit endpoint.
 * Never throws — a failed audit write must never block the primary action.
 */
async function logAudit(
  action: string,
  resourceType: string,
  resourceId?: string | null,
  resourceName?: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, resource_type: resourceType, resource_id: resourceId, resource_name: resourceName, metadata }),
    });
  } catch { /* non-blocking */ }
}

// ── Manager Dashboard API ─────────────────────────────────────────────────────

/**
 * Fetch all menu items for a restaurant (manager view).
 * Includes both available and unavailable items.
 */
export async function getAllMenuItems(restaurantId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, restaurant_id, name, price, is_available, image_url, tags, description")
    .eq("restaurant_id", restaurantId)
    .order("name");

  if (error) {
    console.error("Error fetching all menu items:", error.message);
    return [];
  }
  return (data ?? []) as MenuItem[];
}

/**
 * Create a new menu item.
 */
export async function createMenuItem(params: {
  restaurantId: string;
  name: string;
  price: number;
  description?: string | null;
  image_url?: string | null;
  tags?: string[] | null;
}): Promise<MenuItem | null> {
  const { data, error } = await supabase
    .from("menu_items")
    .insert({
      restaurant_id: params.restaurantId,
      name: params.name,
      price: params.price,
      description: params.description || null,
      image_url: params.image_url || null,
      tags: params.tags || null,
      is_available: true,
    })
    .select("id, restaurant_id, name, price, is_available, image_url, tags, description")
    .maybeSingle();

  if (error) {
    console.error("Error creating menu item:", error.message);
    return null;
  }

  const item = data as MenuItem;
  // Fire webhook (non-blocking) — include full item details
  triggerWebhook(params.restaurantId, "menu.item_created", {
    item_id: item.id,
    name: item.name,
    price: item.price,
    description: item.description ?? null,
    tags: item.tags ?? null,
    image_url: item.image_url ?? null,
    is_available: item.is_available,
  });

  // Fire audit log (non-blocking)
  logAudit('menu_item.created', 'menu_item', item.id, item.name, { price: item.price });

  return item;
}

/**
 * Update a menu item (name, price, availability, description, image, tags).
 */
export async function updateMenuItem(
  itemId: string,
  updates: {
    name?: string;
    price?: number;
    is_available?: boolean;
    description?: string | null;
    image_url?: string | null;
    tags?: string[] | null;
  },
  restaurantId?: string
): Promise<boolean> {
  const { error } = await supabase
    .from("menu_items")
    .update(updates)
    .eq("id", itemId);

  if (error) {
    console.error("Error updating menu item:", error.message);
    return false;
  }

  // Fire webhook (non-blocking) — include full updated fields
  const rid = restaurantId;
  if (rid) {
    // Fetch the current state of the item to send complete data
    supabase
      .from("menu_items")
      .select("id, name, price, is_available, description, image_url, tags")
      .eq("id", itemId)
      .maybeSingle()
      .then(({ data: currentItem }) => {
        triggerWebhook(rid, "menu.item_updated", {
          item_id: itemId,
          name: currentItem?.name ?? null,
          price: currentItem?.price ?? null,
          description: currentItem?.description ?? null,
          tags: currentItem?.tags ?? null,
          image_url: currentItem?.image_url ?? null,
          is_available: currentItem?.is_available ?? null,
          changes: updates,
        });
      });
  }

  // Fire audit log (non-blocking)
  const auditAction = updates.is_available !== undefined
    ? 'menu_item.availability_toggled'
    : 'menu_item.updated';
  logAudit(auditAction, 'menu_item', itemId, null, { changes: updates });

  return true;
}

/**
 * Delete a menu item.
 */
export async function deleteMenuItem(itemId: string, restaurantId?: string): Promise<boolean> {
  // Fetch item details before deletion so we can include them in the webhook
  let deletedItem: { name: string; price: number; description: string | null; tags: string[] | null } | null = null;
  if (restaurantId) {
    const { data } = await supabase
      .from("menu_items")
      .select("name, price, description, tags")
      .eq("id", itemId)
      .maybeSingle();
    deletedItem = data;
  }

  const { error } = await supabase
    .from("menu_items")
    .delete()
    .eq("id", itemId);

  if (error) {
    console.error("Error deleting menu item:", error.message);
    return false;
  }

  // Fire webhook (non-blocking) — include item details captured before deletion
  if (restaurantId) {
    triggerWebhook(restaurantId, "menu.item_deleted", {
      item_id: itemId,
      name: deletedItem?.name ?? null,
      price: deletedItem?.price ?? null,
      description: deletedItem?.description ?? null,
      tags: deletedItem?.tags ?? null,
    });
  }

  // Fire audit log (non-blocking)
  logAudit('menu_item.deleted', 'menu_item', itemId, deletedItem?.name ?? null);

  return true;
}

/**
 * Fetch orders ready for billing (served but not yet billed).
 * 
 * BILLING LOGIC:
 * - Only shows orders with status = 'served'
 * - Only shows orders where billed_at IS NULL
 * - Includes order items for total calculation
 */
export async function getUnbilledOrders(
  restaurantId: string
): Promise<BillingOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, restaurant_id, table_id, status, waiter_id, total_amount, billed_at, created_at,
       table:tables(table_number),
       waiter:users(name),
       order_items(id, quantity, price, menu_item:menu_items(name))`
    )
    .eq("restaurant_id", restaurantId)
    .eq("status", "served")
    .is("billed_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching unbilled orders:", error.message);
    return [];
  }
  return (data ?? []) as unknown as BillingOrder[];
}

/**
 * Fetch completed (billed) orders.
 */
export async function getBilledOrders(
  restaurantId: string,
  limit: number = 50
): Promise<BillingOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, restaurant_id, table_id, status, waiter_id, total_amount, billed_at, created_at,
       table:tables(table_number),
       waiter:users(name),
       order_items(id, quantity, price, menu_item:menu_items(name))`
    )
    .eq("restaurant_id", restaurantId)
    .not("billed_at", "is", null)
    .order("billed_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching billed orders:", error.message);
    return [];
  }
  return (data ?? []) as unknown as BillingOrder[];
}

/**
 * Generate bill for an order.
 * Accepts optional payment method, discount, and a force flag.
 * D1: When force=true, non-served orders are auto-advanced to served before billing.
 * D3: Session is only closed when ALL non-cancelled orders are billed.
 */
export async function generateBill(
  orderId: string,
  options?: {
    paymentMethod?: "cash" | "card" | "upi";
    discountAmount?: number;
    discountNote?: string;
    force?: boolean;
  }
): Promise<{
  success: boolean;
  gross?: number;
  net?: number;
  error?: string;
}> {
  try {
    const { data: orderRow } = await supabase
      .from("orders")
      .select("table_id")
      .eq("id", orderId)
      .maybeSingle();

    const { data, error } = await supabase.rpc("generate_bill", {
      p_order_id:        orderId,
      p_payment_method:  options?.paymentMethod  ?? null,
      p_discount_amount: options?.discountAmount  ?? 0,
      p_discount_note:   options?.discountNote    ?? null,
      p_force:           options?.force           ?? false,
    });

    if (error) {
      console.error("Error generating bill:", error.message);
      return { success: false, error: error.message };
    }

    if (!data || data.length === 0) {
      return { success: false, error: "No data returned from generate_bill" };
    }

    const result = data[0];

    if (result.success && orderRow) {
      const tableId = (orderRow as any).table_id;

      // D3: Close session only when no unbilled non-cancelled orders remain
      const { data: stillActive } = await supabase
        .from("orders")
        .select("id")
        .eq("table_id", tableId)
        .is("billed_at", null)
        .not("status", "in", '("cancelled")');

      if ((stillActive ?? []).length === 0) {
        await supabase.rpc("close_table_session", { p_table_id: tableId });
      }

      // Fetch full order details for rich webhook payload
      const { data: fullOrder } = await supabase
        .from("orders")
        .select(`
          restaurant_id, customer_name, customer_phone, party_size, created_at,
          table:tables(table_number, capacity, floor:floors(name)),
          waiter:users(name),
          order_items(quantity, price, menu_item:menu_items(id, name, description, tags))
        `)
        .eq("id", orderId)
        .maybeSingle();

      if (fullOrder?.restaurant_id) {
        const { data: restaurantRow } = await supabase
          .from("restaurants")
          .select("name, slug")
          .eq("id", fullOrder.restaurant_id)
          .maybeSingle();

        const gross = parseFloat(result.total_amount);
        const net   = parseFloat(result.net_amount ?? result.total_amount);
        const tableData = (Array.isArray(fullOrder.table)
          ? (fullOrder.table as unknown as { table_number: number; capacity: number | null; floor: { name: string } | null }[])[0] ?? null
          : fullOrder.table as unknown as { table_number: number; capacity: number | null; floor: { name: string } | null } | null);
        const waiterData3 = (Array.isArray(fullOrder.waiter)
          ? (fullOrder.waiter as { name: string }[])[0] ?? null
          : fullOrder.waiter as { name: string } | null);
        type RawMenuItem3 = { id: string; name: string; description: string | null; tags: string[] | null };
        type RawItem3 = { quantity: number; price: number; menu_item: RawMenuItem3 | RawMenuItem3[] | null };
        const rawItems3 = (fullOrder.order_items ?? []) as unknown as RawItem3[];
        const normalizedItems3 = rawItems3.map(i => ({
          quantity: i.quantity,
          price: i.price,
          menu_item: Array.isArray(i.menu_item) ? (i.menu_item[0] ?? null) : i.menu_item,
        }));

        const sharedOrderData = {
          order_id: orderId,
          created_at: fullOrder.created_at,
          restaurant: {
            id: fullOrder.restaurant_id,
            name: restaurantRow?.name ?? null,
            slug: restaurantRow?.slug ?? null,
          },
          table: {
            id: tableId,
            table_number: tableData?.table_number ?? null,
            floor: (tableData?.floor as { name: string } | null)?.name ?? null,
            capacity: tableData?.capacity ?? null,
          },
          customer: {
            name: fullOrder.customer_name ?? null,
            phone: fullOrder.customer_phone ?? null,
            party_size: fullOrder.party_size ?? null,
          },
          waiter: waiterData3 ? { name: waiterData3.name } : null,
          order_items: normalizedItems3.map(i => ({
            name: i.menu_item?.name ?? null,
            description: i.menu_item?.description ?? null,
            tags: i.menu_item?.tags ?? null,
            quantity: i.quantity,
            unit_price: i.price,
            subtotal: i.quantity * i.price,
          })),
        };

        triggerWebhook(fullOrder.restaurant_id, "order.billed", {
          ...sharedOrderData,
          gross_amount: gross,
          net_amount: net,
          payment_method: options?.paymentMethod ?? null,
          discount_amount: options?.discountAmount ?? 0,
          discount_note: options?.discountNote ?? null,
        });
        if (options?.paymentMethod) {
          triggerWebhook(fullOrder.restaurant_id, "payment.method_recorded", {
            order_id: orderId,
            payment_method: options.paymentMethod,
            amount: net,
            restaurant: {
              id: fullOrder.restaurant_id,
              name: restaurantRow?.name ?? null,
            },
            table: {
              id: tableId,
              table_number: tableData?.table_number ?? null,
              floor: (tableData?.floor as { name: string } | null)?.name ?? null,
            },
            customer: {
              name: fullOrder.customer_name ?? null,
              phone: fullOrder.customer_phone ?? null,
            },
          });
        }
      }
    }

    return {
      success: result.success,
      gross:   parseFloat(result.total_amount),
      net:     parseFloat(result.net_amount ?? result.total_amount),
    };
  } catch (err) {
    console.error("Exception generating bill:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * D4: Bill all orders for a table atomically in a single DB transaction.
 * Replaces the sequential per-order loop in BillDialog.
 * When force=true, non-served orders are auto-advanced to served before billing.
 */
export async function billTable(
  tableId: string,
  options?: {
    paymentMethod?: "cash" | "card" | "upi";
    discountAmount?: number;
    discountNote?: string;
    force?: boolean;
  }
): Promise<{
  success: boolean;
  billedCount?: number;
  skippedCount?: number;
  grossTotal?: number;
  netTotal?: number;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.rpc("bill_table", {
      p_table_id:        tableId,
      p_payment_method:  options?.paymentMethod  ?? null,
      p_discount_amount: options?.discountAmount  ?? 0,
      p_discount_note:   options?.discountNote    ?? null,
      p_force:           options?.force           ?? false,
    });

    if (error) {
      console.error("Error billing table:", error.message);
      return { success: false, error: error.message };
    }

    const result = data as {
      success: boolean;
      billed_count: number;
      skipped_count: number;
      gross_total: number;
      net_total: number;
    };

    return {
      success:      result.success,
      billedCount:  result.billed_count,
      skippedCount: result.skipped_count,
      grossTotal:   parseFloat(String(result.gross_total)),
      netTotal:     parseFloat(String(result.net_total)),
    };
  } catch (err) {
    console.error("Exception billing table:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Update restaurant order routing mode.
 * C2: When switching to direct_to_kitchen, migrate any orphaned pending_waiter
 * orders to pending so the kitchen sees them immediately.
 */
export async function updateRestaurantRoutingMode(
  restaurantId: string,
  routingMode: "direct_to_kitchen" | "waiter_first"
): Promise<boolean> {
  const { error } = await supabase
    .from("restaurants")
    .update({ order_routing_mode: routingMode })
    .eq("id", restaurantId);

  if (error) {
    console.error("Error updating routing mode:", error.message);
    return false;
  }

  // Invalidate cache so next order picks up the new routing mode immediately
  invalidateRestaurantCache(restaurantId);

  // C2: Migrate orphaned pending_waiter orders when switching to direct_to_kitchen
  if (routingMode === "direct_to_kitchen") {
    const { error: migrateError } = await supabase.rpc("migrate_pending_waiter_orders", {
      p_restaurant_id: restaurantId,
    });
    if (migrateError) {
      // Non-fatal — log but don't fail the routing mode save
      console.warn("[updateRestaurantRoutingMode] migrate_pending_waiter_orders failed:", migrateError.message);
    }
  }

  return true;
}

/**
 * Update core restaurant details (name, slug).
 */
export async function updateRestaurantDetails(
  restaurantId: string,
  updates: { name?: string; slug?: string | null }
): Promise<{ success: boolean; error?: string }> {
  // If slug is being set, check it's not already taken by another restaurant
  if (updates.slug) {
    const { data: existing } = await supabase
      .from("restaurants")
      .select("id")
      .eq("slug", updates.slug.trim())
      .neq("id", restaurantId)
      .maybeSingle();

    if (existing) {
      return { success: false, error: "This URL slug is already taken. Please choose another." };
    }
  }

  const { error } = await supabase
    .from("restaurants")
    .update({
      ...(updates.name !== undefined && { name: updates.name.trim() }),
      ...(updates.slug !== undefined && { slug: updates.slug?.trim() || null }),
    })
    .eq("id", restaurantId);

  if (error) {
    console.error("Error updating restaurant details:", error.message);
    return { success: false, error: error.message };
  }
  // Invalidate cache so the updated name/slug is reflected immediately
  invalidateRestaurantCache(restaurantId);
  return { success: true };
}

// ── Customer Order History API ────────────────────────────────────────────────

/**
 * Get customer order history by phone number.
 * Groups orders by actual table_sessions (opened_at / closed_at) for accurate history.
 */
export async function getCustomerOrderHistory(
  phoneNumber: string
): Promise<CustomerOrderSession[]> {
  const { data: orders, error } = await supabase
    .from("orders")
    .select(`
      id, status, created_at, billed_at, total_amount, table_id,
      restaurant:restaurants(name),
      table:tables(table_number, floor:floors(name)),
      waiter:users(name),
      order_items(quantity, price, menu_item:menu_items(name))
    `)
    .eq("customer_phone", phoneNumber.trim())
    .not("billed_at", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching customer history:", error.message);
    return [];
  }
  if (!orders || orders.length === 0) return [];

  // Fetch all table_sessions that overlap with these orders' tables
  const tableIds = [...new Set((orders as any[]).map((o) => o.table_id))];
  const { data: sessions } = await supabase
    .from("table_sessions")
    .select("id, table_id, waiter_id, opened_at, closed_at")
    .in("table_id", tableIds)
    .order("opened_at", { ascending: false });

  const sessionRows = (sessions ?? []) as {
    id: string; table_id: string; waiter_id: string;
    opened_at: string; closed_at: string | null;
  }[];

  // Map each order to the session it falls within (by table + time window)
  function findSession(order: any) {
    return sessionRows.find((s) =>
      s.table_id === order.table_id &&
      order.created_at >= s.opened_at &&
      (s.closed_at === null || order.created_at <= s.closed_at)
    );
  }

  const sessionMap = new Map<string, CustomerOrderSession>();

  for (const order of orders as any[]) {
    const matched = findSession(order);
    // Fall back to a synthetic key if no session row found (legacy data)
    const sessionKey = matched?.id ?? `${order.table_id}_legacy`;

    if (!sessionMap.has(sessionKey)) {
      sessionMap.set(sessionKey, {
        session_id: sessionKey,
        restaurant_name: order.restaurant?.name ?? "Unknown Restaurant",
        table_number: order.table?.table_number ?? 0,
        floor_name: order.table?.floor?.name ?? null,
        waiter_name: order.waiter?.name ?? null,
        session_start: matched?.opened_at ?? order.created_at,
        session_end: matched?.closed_at ?? order.billed_at,
        total_amount: 0,
        orders: [],
      });
    }

    const session = sessionMap.get(sessionKey)!;
    session.orders.push({
      id: order.id,
      status: order.status,
      created_at: order.created_at,
      billed_at: order.billed_at,
      items: (order.order_items ?? []).map((item: any) => ({
        name: item.menu_item?.name ?? "Item",
        quantity: item.quantity,
        price: parseFloat(item.price),
      })),
    });
    session.total_amount += parseFloat(order.total_amount) || 0;
  }

  return Array.from(sessionMap.values()).sort(
    (a, b) => new Date(b.session_start).getTime() - new Date(a.session_start).getTime()
  );
}

// ── Advanced Features API ─────────────────────────────────────────────────────

/**
 * Fetch all floors for a restaurant.
 */
export async function getFloors(restaurantId: string) {
  const { data, error } = await supabase
    .from("floors")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("name");

  if (error) {
    console.error("Error fetching floors:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Fetch floor information for a specific table.
 * Returns null if table has no floor assigned.
 */
export async function getTableFloor(tableId: string): Promise<Pick<Floor, 'id' | 'name' | 'price_multiplier'> | null> {
  const { data, error } = await supabase
    .from("tables")
    .select("floor:floors(id, name, price_multiplier)")
    .eq("id", tableId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching table floor:", error.message);
    return null;
  }
  
  // The floor field will be null if no floor is assigned, or an object if assigned
  const floor = data?.floor as any;
  
  if (!floor || Array.isArray(floor)) {
    return null;
  }
  
  return floor as Pick<Floor, 'id' | 'name' | 'price_multiplier'>;
}

/**
 * Create a new floor.
 */
export async function createFloor(params: {
  restaurantId: string;
  name: string;
  priceMultiplier: number;
}) {
  const res = await fetch('/api/floors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      restaurantId: params.restaurantId,
      name: params.name,
      priceMultiplier: params.priceMultiplier,
    }),
  });
  if (!res.ok) {
    console.error("Error creating floor:", await res.text());
    return null;
  }
  return res.json();
}

/**
 * Update a floor.
 */
export async function updateFloor(
  floorId: string,
  updates: { name?: string; price_multiplier?: number },
  restaurantId?: string
) {
  if (!restaurantId) {
    // Fallback to direct Supabase call if restaurantId not provided
    const { error } = await supabase.from("floors").update(updates).eq("id", floorId);
    if (error) { console.error("Error updating floor:", error.message); return false; }
    return true;
  }
  const res = await fetch('/api/floors', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ floorId, restaurantId, updates }),
  });
  if (!res.ok) { console.error("Error updating floor:", await res.text()); return false; }
  return true;
}

/**
 * Delete a floor.
 */
export async function deleteFloor(floorId: string, restaurantId?: string) {
  if (!restaurantId) {
    // Fallback to direct Supabase call if restaurantId not provided
    const { error } = await supabase.from("floors").delete().eq("id", floorId);
    if (error) { console.error("Error deleting floor:", error.message); return false; }
    return true;
  }
  const res = await fetch('/api/floors', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ floorId, restaurantId }),
  });
  if (!res.ok) { console.error("Error deleting floor:", await res.text()); return false; }
  return true;
}

/**
 * Fetch table availability status.
 */
export async function getTableAvailability(restaurantId: string) {
  const { data, error } = await supabase
    .from("table_availability")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("table_number");

  if (error) {
    console.error("Error fetching table availability:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Fetch waiter availability status.
 */
export async function getWaiterAvailability(restaurantId: string) {
  const { data, error } = await supabase
    .from("waiter_availability")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("waiter_name");

  if (error) {
    console.error("Error fetching waiter availability:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Fetch performance metrics.
 * Uses turnaround view's order_count as the primary count since it only
 * requires served_at (most permissive). Prep/serve counts may be lower
 * if some orders skipped intermediate statuses.
 */
export async function getPerformanceMetrics(restaurantId: string) {
  const [prepTime, serveTime, turnaroundTime] = await Promise.all([
    supabase
      .from("avg_preparation_time")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle(),
    supabase
      .from("avg_serving_time")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle(),
    supabase
      .from("avg_turnaround_time")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle(),
  ]);

  // Use turnaround count as primary — it only needs served_at so it's the most inclusive
  const orderCount =
    turnaroundTime.data?.order_count ||
    prepTime.data?.order_count ||
    serveTime.data?.order_count ||
    0;

  return {
    avgPrepSeconds: prepTime.data?.avg_prep_seconds ?? null,
    avgServeSeconds: serveTime.data?.avg_serve_seconds ?? null,
    avgTurnaroundSeconds: turnaroundTime.data?.avg_turnaround_seconds ?? null,
    orderCount,
  };
}

/**
 * Update table details.
 */
export async function updateTable(
  tableId: string,
  updates: {
    table_number?: number;
    floor_id?: string | null;
    capacity?: number;
  }
) {
  const { error } = await supabase
    .from("tables")
    .update(updates)
    .eq("id", tableId);

  if (error) {
    console.error("Error updating table:", error.message);
    return false;
  }
  return true;
}

/**
 * Backfill QR code URLs for tables that don't have one yet.
 * Safe to call multiple times — only updates tables where qr_code_url is null.
 */
export async function backfillQrCodes(restaurantId: string) {
  const { data, error } = await supabase
    .from("tables")
    .select("id, restaurant_id")
    .eq("restaurant_id", restaurantId)
    .is("qr_code_url", null);

  if (error || !data || data.length === 0) return;

  await Promise.all(
    data.map((table) =>
      supabase
        .from("tables")
        .update({ qr_code_url: `/r/${table.restaurant_id}/t/${table.id}` })
        .eq("id", table.id)
    )
  );
}

/**
 * Create a new table and auto-generate its QR code URL.
 */
export async function createTable(params: {
  restaurantId: string;
  tableNumber: number;
  floorId?: string;
  capacity?: number;
}) {
  // Step 1: Insert the table to get its ID
  const { data, error } = await supabase
    .from("tables")
    .insert({
      restaurant_id: params.restaurantId,
      table_number: params.tableNumber,
      floor_id: params.floorId || null,
      capacity: params.capacity || 4,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating table:", error.message);
    return null;
  }

  // Step 2: Build the QR URL using the new table's ID
  const qrUrl = `/r/${params.restaurantId}/t/${data.id}`;

  // Step 3: Save the QR URL back to the table
  const { error: updateError } = await supabase
    .from("tables")
    .update({ qr_code_url: qrUrl })
    .eq("id", data.id);

  if (updateError) {
    console.error("Error saving QR URL:", updateError.message);
  }

  return { ...data, qr_code_url: qrUrl };
}

/**
 * Delete a table.
 */
export async function deleteTable(tableId: string) {
  const { error } = await supabase.from("tables").delete().eq("id", tableId);

  if (error) {
    console.error("Error deleting table:", error.message);
    return false;
  }
  return true;
}

/**
 * Toggle waiter active status.
 */
export async function toggleWaiterStatus(waiterId: string, isActive: boolean) {
  const { error } = await supabase
    .from("users")
    .update({ is_active: isActive })
    .eq("id", waiterId);

  if (error) {
    console.error("Error updating waiter status:", error.message);
    return false;
  }
  return true;
}

// ============================================================================
// FOOD CATEGORIES
// ============================================================================

/** Fetch all categories for a restaurant (flat list, ordered by sort_order). */
export async function getFoodCategories(restaurantId: string): Promise<FoodCategory[]> {
  const { data, error } = await supabase
    .from("food_categories")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("sort_order")
    .order("name");

  if (error) { console.error("getFoodCategories:", error.message); return []; }
  return (data ?? []) as FoodCategory[];
}

/** Build a tree from flat list: top-level categories with .children populated. */
export function buildCategoryTree(flat: FoodCategory[]): FoodCategory[] {
  const map = new Map<string, FoodCategory>();
  flat.forEach(c => map.set(c.id, { ...c, children: [] }));
  const roots: FoodCategory[] = [];
  map.forEach(c => {
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children!.push(c);
    } else {
      roots.push(c);
    }
  });
  return roots;
}

export async function createFoodCategory(params: {
  restaurantId: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  color?: string | null;
  parent_id?: string | null;
  sort_order?: number;
  is_suggestion?: boolean;
}): Promise<FoodCategory | null> {
  const { data, error } = await supabase
    .from("food_categories")
    .insert({
      restaurant_id: params.restaurantId,
      name: params.name,
      description: params.description ?? null,
      image_url: params.image_url ?? null,
      color: params.color ?? null,
      parent_id: params.parent_id ?? null,
      sort_order: params.sort_order ?? 0,
      is_suggestion: params.is_suggestion ?? false,
    })
    .select("*")
    .maybeSingle();

  if (error) { console.error("createFoodCategory:", error.message); return null; }
  return data as FoodCategory;
}

export async function updateFoodCategory(
  id: string,
  updates: Partial<Pick<FoodCategory, "name" | "description" | "image_url" | "color" | "parent_id" | "sort_order">>
): Promise<boolean> {
  const { error } = await supabase.from("food_categories").update(updates).eq("id", id);
  if (error) { console.error("updateFoodCategory:", error.message); return false; }
  return true;
}

export async function deleteFoodCategory(id: string): Promise<boolean> {
  const { error } = await supabase.from("food_categories").delete().eq("id", id);
  if (error) { console.error("deleteFoodCategory:", error.message); return false; }
  return true;
}

// ============================================================================
// FOOD TAGS
// ============================================================================

export async function getFoodTags(restaurantId: string): Promise<FoodTag[]> {
  const { data, error } = await supabase
    .from("food_tags")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("sort_order")
    .order("name");

  if (error) { console.error("getFoodTags:", error.message); return []; }
  return (data ?? []) as FoodTag[];
}

export async function createFoodTag(params: {
  restaurantId: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  color?: string | null;
  sort_order?: number;
  is_suggestion?: boolean;
}): Promise<FoodTag | null> {
  const { data, error } = await supabase
    .from("food_tags")
    .insert({
      restaurant_id: params.restaurantId,
      name: params.name,
      description: params.description ?? null,
      image_url: params.image_url ?? null,
      color: params.color ?? null,
      sort_order: params.sort_order ?? 0,
      is_suggestion: params.is_suggestion ?? false,
    })
    .select("*")
    .maybeSingle();

  if (error) { console.error("createFoodTag:", error.message); return null; }
  return data as FoodTag;
}

export async function updateFoodTag(
  id: string,
  updates: Partial<Pick<FoodTag, "name" | "description" | "image_url" | "color" | "sort_order">>
): Promise<boolean> {
  const { error } = await supabase.from("food_tags").update(updates).eq("id", id);
  if (error) { console.error("updateFoodTag:", error.message); return false; }
  return true;
}

export async function deleteFoodTag(id: string): Promise<boolean> {
  const { error } = await supabase.from("food_tags").delete().eq("id", id);
  if (error) { console.error("deleteFoodTag:", error.message); return false; }
  return true;
}

// ============================================================================
// SUGGESTIONS
// ============================================================================

export async function getCategorySuggestions(): Promise<CategorySuggestion[]> {
  const { data, error } = await supabase
    .from("category_suggestions")
    .select("*")
    .order("parent_name", { nullsFirst: true })
    .order("name");

  if (error) { console.error("getCategorySuggestions:", error.message); return []; }
  return (data ?? []) as CategorySuggestion[];
}

export async function getTagSuggestions(): Promise<TagSuggestion[]> {
  const { data, error } = await supabase
    .from("tag_suggestions")
    .select("*")
    .order("name");

  if (error) { console.error("getTagSuggestions:", error.message); return []; }
  return (data ?? []) as TagSuggestion[];
}

// ============================================================================
// MENU ITEM ↔ CATEGORY / TAG ASSIGNMENTS
// ============================================================================

export async function getMenuItemCategories(menuItemId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("menu_item_categories")
    .select("category_id")
    .eq("menu_item_id", menuItemId);

  if (error) { console.error("getMenuItemCategories:", error.message); return []; }
  return (data ?? []).map((r: { category_id: string }) => r.category_id);
}

export async function setMenuItemCategories(menuItemId: string, categoryIds: string[]): Promise<boolean> {
  // Delete existing then insert new
  const { error: delErr } = await supabase
    .from("menu_item_categories")
    .delete()
    .eq("menu_item_id", menuItemId);

  if (delErr) { console.error("setMenuItemCategories delete:", delErr.message); return false; }
  if (categoryIds.length === 0) return true;

  const { error: insErr } = await supabase
    .from("menu_item_categories")
    .insert(categoryIds.map(cid => ({ menu_item_id: menuItemId, category_id: cid })));

  if (insErr) { console.error("setMenuItemCategories insert:", insErr.message); return false; }
  return true;
}

export async function getMenuItemTags(menuItemId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("menu_item_tags")
    .select("tag_id")
    .eq("menu_item_id", menuItemId);

  if (error) { console.error("getMenuItemTags:", error.message); return []; }
  return (data ?? []).map((r: { tag_id: string }) => r.tag_id);
}

export async function setMenuItemTags(menuItemId: string, tagIds: string[]): Promise<boolean> {
  const { error: delErr } = await supabase
    .from("menu_item_tags")
    .delete()
    .eq("menu_item_id", menuItemId);

  if (delErr) { console.error("setMenuItemTags delete:", delErr.message); return false; }
  if (tagIds.length === 0) return true;

  const { error: insErr } = await supabase
    .from("menu_item_tags")
    .insert(tagIds.map(tid => ({ menu_item_id: menuItemId, tag_id: tid })));

  if (insErr) { console.error("setMenuItemTags insert:", insErr.message); return false; }
  return true;
}
