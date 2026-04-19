/**
 * API helper functions that abstract Supabase queries.
 * Keeping data-fetching logic separate from UI components.
 */
import { supabase } from "./supabase";
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
  CustomerOrderSession
} from "@/types/database";
import { isValidStatusTransition } from "@/types/database";

/**
 * Fetch a restaurant by its ID.
 * Returns null if not found.
 */
export async function getRestaurant(
  restaurantId: string
): Promise<Restaurant | null> {
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, slug, is_active, order_routing_mode, geofencing_enabled, geo_latitude, geo_longitude, geo_radius_meters")
    .eq("id", restaurantId)
    .maybeSingle(); // maybeSingle returns null instead of error when 0 rows found

  if (error) {
    console.error("Error fetching restaurant:", error.message, error.code);
    return null;
  }
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

  // Step 1: BILLING SAFETY - Block if another customer has unpaid orders at this table.
  // Same customer placing a second order is fine — we scope the check by phone number.
  const hasConflict = await supabase.rpc("check_table_has_unpaid_orders", {
    p_table_id: tableId,
    p_customer_phone: customerPhone?.trim() || null,
  });
  if (hasConflict.data === true) {
    console.log(`[Billing Safety] Blocked new order for table ${tableId} - existing unpaid orders found`);
    return 'UNPAID_ORDERS_EXIST';
  }

  // Step 2: Get restaurant routing mode to determine initial status
  const restaurant = await getRestaurant(restaurantId);
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

  // Step 4: Calculate final prices with floor multiplier and insert order items
  const orderItems = await Promise.all(
    items.map(async (item) => {
      // Call calculate_item_price function to apply floor-based pricing
      const { data: finalPrice, error } = await supabase.rpc('calculate_item_price', {
        p_menu_item_id: item.menu_item_id,
        p_table_id: tableId
      });

      if (error) {
        console.error("Error calculating price:", error);
        // Fallback to base price if calculation fails
        return {
          order_id: orderId,
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
          price: item.price
        };
      }

      return {
        order_id: orderId,
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        price: finalPrice // Use calculated price with floor multiplier
      };
    })
  );

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems);

  if (itemsError) {
    console.error("Error creating order items:", itemsError.message);
    return null;
  }

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
      `and(waiter_id.is.null,status.in.(pending_waiter,confirmed,ready),table_id.not.in.(${lockedTableIds.join(",")}))`
    );
  } else {
    // No locked tables — show mine + all unassigned
    query = query.or(
      `waiter_id.eq.${waiterId},` +
      `and(waiter_id.is.null,status.in.(pending_waiter,confirmed,ready))`
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
  return data as MenuItem;
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
  }
): Promise<boolean> {
  const { error } = await supabase
    .from("menu_items")
    .update(updates)
    .eq("id", itemId);

  if (error) {
    console.error("Error updating menu item:", error.message);
    return false;
  }
  return true;
}

/**
 * Delete a menu item.
 */
export async function deleteMenuItem(itemId: string): Promise<boolean> {
  const { error } = await supabase
    .from("menu_items")
    .delete()
    .eq("id", itemId);

  if (error) {
    console.error("Error deleting menu item:", error.message);
    return false;
  }
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
 * After billing, checks if all orders for the table are now billed and
 * closes the table session if so.
 */
export async function generateBill(orderId: string): Promise<{
  success: boolean;
  total?: number;
  error?: string;
}> {
  try {
    // Get the table_id before billing so we can check session closure
    const { data: orderRow } = await supabase
      .from("orders")
      .select("table_id")
      .eq("id", orderId)
      .maybeSingle();

    // Call the database function to generate bill
    const { data, error } = await supabase.rpc("generate_bill", {
      p_order_id: orderId,
    });

    if (error) {
      console.error("Error generating bill:", error.message);
      return { success: false, error: error.message };
    }

    if (!data || data.length === 0) {
      return { success: false, error: "No data returned from generate_bill" };
    }

    const result = data[0];

    // If billing succeeded and we know the table, check if all orders are billed
    if (result.success && orderRow) {
      const tableId = (orderRow as any).table_id;
      const { data: unbilled } = await supabase
        .from("orders")
        .select("id")
        .eq("table_id", tableId)
        .is("billed_at", null)
        .neq("status", "served"); // ignore orders not yet served

      // Also check for any served-but-unbilled orders
      const { data: servedUnbilled } = await supabase
        .from("orders")
        .select("id")
        .eq("table_id", tableId)
        .is("billed_at", null)
        .eq("status", "served");

      const remainingUnbilled = (servedUnbilled ?? []).length;

      if (remainingUnbilled === 0) {
        // All served orders are billed — close the session
        await supabase.rpc("close_table_session", { p_table_id: tableId });
      }
    }

    return {
      success: result.success,
      total: parseFloat(result.total_amount),
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
 * Update restaurant order routing mode.
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
  return { success: true };
}

// ── Customer Order History API ────────────────────────────────────────────────

/**
 * Get customer order history by phone number.
 * Groups orders by table sessions and includes waiter names.
 */
export async function getCustomerOrderHistory(
  phoneNumber: string
): Promise<CustomerOrderSession[]> {
  // Get all orders for this phone number with full details
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
    .not("billed_at", "is", null) // Only completed orders
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching customer history:", error.message);
    return [];
  }

  if (!orders || orders.length === 0) return [];

  // Group orders by table sessions
  // A session = consecutive orders at the same table with the same waiter
  const sessions = new Map<string, CustomerOrderSession>();

  for (const order of orders as any[]) {
    const tableId = order.table_id;
    const waiterName = order.waiter?.name ?? null;
    const restaurantName = order.restaurant?.name ?? "Unknown Restaurant";
    const tableNumber = order.table?.table_number ?? 0;
    const floorName = order.table?.floor?.name ?? null;

    // Create a session key based on table + waiter + time proximity
    // For simplicity, we'll group by table and assume orders close in time belong to same session
    const sessionKey = `${tableId}_${waiterName ?? 'no_waiter'}`;

    if (!sessions.has(sessionKey)) {
      sessions.set(sessionKey, {
        session_id: sessionKey,
        restaurant_name: restaurantName,
        table_number: tableNumber,
        floor_name: floorName,
        waiter_name: waiterName,
        session_start: order.created_at,
        session_end: order.billed_at,
        total_amount: 0,
        orders: [],
      });
    }

    const session = sessions.get(sessionKey)!;
    
    // Update session metadata
    if (order.created_at < session.session_start) {
      session.session_start = order.created_at;
    }
    if (!session.session_end || (order.billed_at && order.billed_at > session.session_end)) {
      session.session_end = order.billed_at;
    }

    // Add order to session
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

  // Convert to array and sort by session start (newest first)
  return Array.from(sessions.values()).sort(
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
  const { data, error } = await supabase
    .from("floors")
    .insert({
      restaurant_id: params.restaurantId,
      name: params.name,
      price_multiplier: params.priceMultiplier,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating floor:", error.message);
    return null;
  }
  return data;
}

/**
 * Update a floor.
 */
export async function updateFloor(
  floorId: string,
  updates: { name?: string; price_multiplier?: number }
) {
  const { error } = await supabase
    .from("floors")
    .update(updates)
    .eq("id", floorId);

  if (error) {
    console.error("Error updating floor:", error.message);
    return false;
  }
  return true;
}

/**
 * Delete a floor.
 */
export async function deleteFloor(floorId: string) {
  const { error } = await supabase.from("floors").delete().eq("id", floorId);

  if (error) {
    console.error("Error deleting floor:", error.message);
    return false;
  }
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
