/**
 * TypeScript types that mirror the Supabase database schema.
 * Keep these in sync with your SQL schema.
 */

export type Restaurant = {
  id: string;
  name: string;
  slug?: string | null;
  is_active?: boolean;
  order_routing_mode?: 'direct_to_kitchen' | 'waiter_first';
  waiter_assignment_mode?: 'auto_assign' | 'broadcast';
  geofencing_enabled?: boolean;
  geo_latitude?: number | null;
  geo_longitude?: number | null;
  geo_radius_meters?: number;
  logo_url?: string | null;
  auto_confirm_minutes?: number | null;
};

export type Floor = {
  id: string;
  restaurant_id: string;
  name: string;
  price_multiplier: number;
  created_at: string;
};

export type RestaurantTable = {
  id: string;
  restaurant_id: string;
  table_number: number;
  floor_id?: string | null;
  capacity?: number;
  qr_code_url?: string | null;
};

export type MenuItem = {
  id: string;
  restaurant_id: string;
  name: string;
  price: number;
  is_available: boolean;
  image_url?: string | null;
  tags?: string[];
  description?: string | null;
};

export type Review = {
  id: string;
  menu_item_id: string;
  rating: number;
  comment?: string | null;
  created_at: string;
};

export type MenuItemWithRating = MenuItem & {
  review_count: number;
  avg_rating: number | null;
};

/** User roles in the system */
export type UserRole = "waiter" | "manager" | "kitchen";

export type User = {
  id: string;
  name: string;
  role: UserRole;
  restaurant_id: string;
  created_at: string;
  auth_id?: string;
  email?: string;
  is_active?: boolean;
};

/** All possible order statuses in the extended workflow */
export type OrderStatus = "pending" | "pending_waiter" | "confirmed" | "preparing" | "ready" | "served" | "cancelled";

export type Order = {
  id: string;
  restaurant_id: string;
  table_id: string;
  status: OrderStatus;
  waiter_id: string | null;
  total_amount: number;
  billed_at: string | null;
  created_at: string;
  confirmed_at?: string | null;
  preparing_at?: string | null;
  ready_at?: string | null;
  served_at?: string | null;
};

/**
 * A fully-hydrated order as returned by the kitchen dashboard query.
 * Joins orders → tables, order_items → menu_items in one fetch.
 */
export type KitchenOrder = Order & {
  table: { table_number: number };
  waiter?: { name: string } | null;
  order_items: Array<{
    id: string;
    quantity: number;
    price: number;
    menu_item: { name: string };
  }>;
};

/**
 * A fully-hydrated order as returned by the waiter dashboard query.
 * Similar to KitchenOrder but may include different joins.
 */
export type WaiterOrder = Order & {
  table: { 
    table_number: number;
    floor?: { name: string } | null;
  };
  waiter?: { name: string } | null;
  order_items: Array<{
    id: string;
    quantity: number;
    price: number;
    menu_item: { name: string };
  }>;
};

/**
 * A fully-hydrated order for billing (manager dashboard).
 * Includes all order details needed for generating bills.
 */
export type BillingOrder = Order & {
  table: { table_number: number };
  waiter?: { name: string } | null;
  order_items: Array<{
    id: string;
    quantity: number;
    price: number;
    menu_item: { name: string };
  }>;
};

export type OrderItem = {
  id: string;
  order_id: string;
  menu_item_id: string;
  quantity: number;
  price: number;
};

export type OrderStatusLog = {
  id: string;
  order_id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  created_at: string;
};

/** Cart item — a menu item with a quantity tracked in frontend state */
export type CartItem = MenuItem & {
  quantity: number;
};

/** Customer order session for history display */
export type CustomerOrderSession = {
  session_id: string;
  restaurant_name: string;
  table_number: number;
  floor_name: string | null;
  waiter_name: string | null;
  session_start: string;
  session_end: string | null;
  total_amount: number;
  orders: Array<{
    id: string;
    status: string;
    created_at: string;
    billed_at: string | null;
    items: Array<{ name: string; quantity: number; price: number }>;
  }>;
};

/** Valid state transitions for order status */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending:        ["confirmed", "cancelled"],
  pending_waiter: ["confirmed", "cancelled"],
  confirmed:      ["preparing", "cancelled"],
  preparing:      ["ready"],
  ready:          ["served"],
  served:         [],
  cancelled:      [],
};

/** Check if a status transition is valid */
export function isValidStatusTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

// ── Advanced Features Types ────────────────────────────────────────────────────

export type TableAvailability = {
  table_id: string;
  restaurant_id: string;
  table_number: number;
  capacity: number | null;
  floor_name: string | null;
  price_multiplier: number | null;
  status: 'free' | 'occupied';
};

export type WaiterAvailability = {
  waiter_id: string;
  waiter_name: string;
  restaurant_id: string;
  is_active: boolean;
  active_orders: number;
  status: 'available' | 'busy' | 'inactive';
};

export type PerformanceMetrics = {
  avg_prep_seconds: number | null;
  avg_serve_seconds: number | null;
  avg_turnaround_seconds: number | null;
  order_count: number;
};

export type MenuItemRating = {
  menu_item_id: string;
  restaurant_id: string;
  item_name: string;
  review_count: number;
  avg_rating: number | null;
  min_rating: number | null;
  max_rating: number | null;
};

// ── Coupon System ─────────────────────────────────────────────────────────────

export type DiscountType = "percentage" | "flat";

export type Coupon = {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  applicable_plans: string[];
  created_at: string;
  updated_at: string;
};

export type CouponUsage = {
  id: string;
  coupon_id: string;
  restaurant_id: string;
  used_at: string;
};

export type CouponValidationResult =
  | { valid: true; coupon_id: string; type: DiscountType; value: number }
  | { valid: false; reason: string };

// ── Food Categories & Tags ────────────────────────────────────────────────────

export type FoodCategory = {
  id: string;
  restaurant_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  color: string | null;
  sort_order: number;
  is_suggestion: boolean;
  created_at: string;
  /** Populated when fetching with children */
  children?: FoodCategory[];
};

export type FoodTag = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  color: string | null;
  sort_order: number;
  is_suggestion: boolean;
  created_at: string;
};

export type CategorySuggestion = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  color: string | null;
  parent_name: string | null;
};

export type TagSuggestion = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  color: string | null;
};

// ── Supabase Database generic type ────────────────────────────────────────────
// This is the shape the Supabase client uses for type-safe queries.
export type Database = {
  public: {
    Tables: {
      restaurants: {
        Row: Restaurant;
        Insert: Omit<Restaurant, "id">;
        Update: Partial<Omit<Restaurant, "id">>;
      };
      tables: {
        Row: RestaurantTable;
        Insert: Omit<RestaurantTable, "id">;
        Update: Partial<Omit<RestaurantTable, "id">>;
      };
      menu_items: {
        Row: MenuItem;
        Insert: Omit<MenuItem, "id">;
        Update: Partial<Omit<MenuItem, "id">>;
      };
      users: {
        Row: User;
        Insert: Omit<User, "id" | "created_at">;
        Update: Partial<Omit<User, "id" | "created_at">>;
      };
      orders: {
        Row: Order;
        Insert: {
          restaurant_id: string;
          table_id: string;
          status: "pending";
          waiter_id?: string | null;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Order, "id" | "created_at">>;
      };
      order_items: {
        Row: OrderItem;
        Insert: {
          order_id: string;
          menu_item_id: string;
          quantity: number;
          price: number;
          id?: string;
        };
        Update: Partial<Omit<OrderItem, "id">>;
      };
      order_status_logs: {
        Row: OrderStatusLog;
        Insert: {
          order_id: string;
          old_status?: string | null;
          new_status: string;
          changed_by?: string | null;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<OrderStatusLog, "id" | "created_at">>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};

// ── Bulk Menu Upload ──────────────────────────────────────────────────────────

/** A draft row in the bulk menu upload table (CSV or inline grid) */
export interface DraftRow {
  name: string;
  price: string;           // string for input binding; parsed to number on save
  description: string;
  imageUrl: string;        // optional image URL
  categoryNames: string[]; // display names, resolved to IDs on save
  tagNames: string[];      // display names, resolved to IDs on save
  is_available: boolean;
  // UI state
  _id: string;             // client-side key
  _errors: Record<string, string>;
  _status: "idle" | "saving" | "saved" | "error";
}
