"use client";

import { useState, useCallback, useEffect } from "react";
import { MapPin, Loader2, UtensilsCrossed, ClipboardList, Lock, Bell, AlertTriangle, Sparkles } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import { useRealtimeMenu } from "@/hooks/useRealtimeMenu";
import { useGeofence } from "@/hooks/useGeofence";
import { useCustomerSession } from "@/hooks/useCustomerSession";
import MenuItemCard from "@/components/MenuItemCard";
import CartDrawer from "@/components/CartDrawer";
import OrderStatusTracker from "@/components/OrderStatusTracker";
import ReviewPrompt from "@/components/ReviewPrompt";
import { getSupabaseClient } from "@/lib/supabase";
import { checkTableHasUnpaidOrders } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import type { MenuItem, Restaurant, RestaurantTable, Floor } from "@/types/database";

type WelcomeData = {
  name: string;
  visit_count: number;
  last_seen_at: string;
  top_items: string[];
};

type Tab = "menu" | "orders";

// An order that has been served and is ready for review
type ReviewableOrder = {
  orderId: string;
  customerPhone: string | null;
  items: Array<{ menu_item_id: string; name: string; quantity: number }>;
};

type Props = {
  restaurant: Restaurant;
  table: RestaurantTable;
  menuItems: MenuItem[];
  floorInfo: Pick<Floor, "id" | "name" | "price_multiplier"> | null;
};

export default function OrderPageClient({
  restaurant,
  table,
  menuItems: initialMenuItems,
  floorInfo,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("menu");
  const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems);

  // B1: track names of items removed from cart due to deletion so we can warn the customer
  const [removedItemNames, setRemovedItemNames] = useState<string[]>([]);

  const handleItemInvalidated = useCallback((itemId: string) => {
    // Look up the name from current menuItems state before it's removed
    setMenuItems((prev) => {
      const item = prev.find((i) => i.id === itemId);
      if (item) {
        setRemovedItemNames((names) => [...names, item.name]);
      }
      return prev;
    });
  }, []);

  const { cartItems, addToCart, updateQuantity, clearCart, invalidateCartItem, totalPrice } = useCart(
    floorInfo?.price_multiplier ?? 1.0,
    table.id,
    handleItemInvalidated,
  );

  const { customerInfo, saveCustomerInfo, activeOrders, refetchOrders, sessionLoaded } = useCustomerSession(
    restaurant.id,
    table.id
  );

  const { toast } = useToast();

  // ── Welcome-back data ────────────────────────────────────────────────
  const [welcomeData, setWelcomeData] = useState<WelcomeData | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  useEffect(() => {
    // Session cleared (billing complete) — reset welcome banner so next
    // customer at this table gets a fresh experience.
    if (!customerInfo) {
      setWelcomeData(null);
      setWelcomeDismissed(false);
      return;
    }
    if (!customerInfo.phone || !sessionLoaded) return;
    const supabase = getSupabaseClient();
    supabase
      .rpc("get_customer_welcome", {
        p_restaurant_id: restaurant.id,
        p_phone: customerInfo.phone,
      })
      .then(({ data }) => {
        if (data && data.length > 0) {
          const row = data[0];
          // Only show welcome banner for returning customers (visit_count > 1)
          if (row.visit_count > 1) setWelcomeData(row as WelcomeData);
        }
      });
  }, [customerInfo, sessionLoaded, restaurant.id]);

  // ── Table occupancy check ────────────────────────────────────────────
  const [tableOccupied, setTableOccupied] = useState<boolean | null>(null);

  const checkOccupancy = useCallback(async () => {
    const hasUnpaidByOther = await checkTableHasUnpaidOrders(
      table.id,
      customerInfo?.phone ?? null
    );
    setTableOccupied(hasUnpaidByOther);
  }, [table.id, customerInfo?.phone]);

  // Initial check once session is loaded
  useEffect(() => {
    if (!sessionLoaded) return;
    checkOccupancy();
  }, [sessionLoaded, checkOccupancy]);

  // Re-check in real-time whenever any order on this table changes —
  // so the occupied screen disappears the moment the table is cleared,
  // and reappears if someone else places an order while this page is open.
  useEffect(() => {
    const client = getSupabaseClient();
    const channel = client
      .channel(`occupancy:${table.id}`)
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `table_id=eq.${table.id}`,
        },
        () => { checkOccupancy(); }
      )
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [table.id, checkOccupancy]);

  // ── Review prompt ────────────────────────────────────────────────────
  // When an order transitions to "served", queue it for review.
  // We track which order IDs have already been queued to avoid duplicates.
  const [reviewQueue, setReviewQueue] = useState<ReviewableOrder[]>([]);
  const [dismissedReviews, setDismissedReviews] = useState<Set<string>>(new Set());
  const orderStatusMapRef = useState<Map<string, string>>(() => new Map())[0];

  useEffect(() => {
    // Don't fire toasts or queue reviews when the table is occupied by someone
    // else — this user has no active session here.
    if (tableOccupied) return;

    activeOrders.forEach((order) => {
      const prev = orderStatusMapRef.get(order.id);

      if (prev && prev !== order.status) {
        // Always fire a toast on status change so the customer notices
        // even if they're browsing the menu tab
        const STATUS_TOASTS: Record<string, { title: string; description: string; variant: "success" | "info" | "warning" }> = {
          confirmed:  { title: "Order confirmed ✓",        description: "The kitchen has your order.",          variant: "success" },
          preparing:  { title: "Kitchen is cooking 🍳",    description: "Your order is being prepared.",        variant: "info"    },
          ready:      { title: "Your order is ready! 🚀",  description: "A waiter is bringing it to you.",      variant: "success" },
          served:     { title: "Enjoy your meal! 😊",      description: "Your order has been served.",          variant: "success" },
          cancelled:  { title: "Order cancelled",          description: "Your order was cancelled.",            variant: "warning" },
        };
        const cfg = STATUS_TOASTS[order.status];
        if (cfg) toast({ ...cfg, duration: 5000 });

        // Detect transition TO "served" → queue for review
        if (prev !== "served" && order.status === "served") {
          setReviewQueue((q) => {
            if (q.some((r) => r.orderId === order.id)) return q;
            return [
              ...q,
              {
                orderId: order.id,
                // Capture phone now — customerInfo may be cleared by billing
                // before the customer gets a chance to submit the review.
                customerPhone: customerInfo?.phone ?? null,
                items: order.items.map((i) => ({
                  menu_item_id: i.menu_item_id ?? "",
                  name: i.name,
                  quantity: i.quantity,
                })),
              },
            ];
          });
        }
      }

      orderStatusMapRef.set(order.id, order.status);
    });
  }, [activeOrders, orderStatusMapRef, toast]);

  const { status: geoStatus, message: geoMessage } = useGeofence({
    enabled: restaurant.geofencing_enabled ?? false,
    restaurantLat: restaurant.geo_latitude ?? null,
    restaurantLng: restaurant.geo_longitude ?? null,
    radiusMeters: restaurant.geo_radius_meters ?? 100,
  });

  // B2: geo-fence "permission denied" should not hard-block — show a warning
  // banner but still allow ordering. Only block when the customer is provably
  // outside the radius (status === "denied", i.e. location obtained but too far).
  const geoBlocked =
    (restaurant.geofencing_enabled ?? false) &&
    geoStatus === "denied"; // "error" (permission denied / unavailable) no longer blocks

  const geoPermissionDenied =
    (restaurant.geofencing_enabled ?? false) &&
    geoStatus === "error";

  const handleMenuChange = useCallback(
    (payload: any) => {
      if (payload.event === "INSERT") {
        setMenuItems((prev) => {
          if (prev.some((i) => i.id === payload.id)) return prev;
          return [
            ...prev,
            {
              id: payload.id,
              restaurant_id: restaurant.id,
              name: payload.name,
              price: payload.price,
              is_available: payload.is_available,
            },
          ];
        });
      } else if (payload.event === "UPDATE") {
        setMenuItems((prev) =>
          prev.map((i) =>
            i.id === payload.id
              ? {
                  ...i,
                  name: payload.name ?? i.name,
                  price: payload.price ?? i.price,
                  is_available: payload.is_available ?? i.is_available,
                }
              : i
          )
        );
      } else if (payload.event === "DELETE") {
        // B1: remove deleted item from cart before removing from menu list
        invalidateCartItem(payload.id);
        setMenuItems((prev) => prev.filter((i) => i.id !== payload.id));
      }
    },
    [restaurant.id, invalidateCartItem]
  );

  useRealtimeMenu({ restaurantId: restaurant.id, onMenuChange: handleMenuChange });

  const cartQty = Object.fromEntries(cartItems.map((c) => [c.id, c.quantity]));

  // Track whether the cart drawer is showing its success screen so we keep it
  // mounted even after the cart is cleared (otherwise it unmounts immediately
  // and the success screen never shows).
  const [cartShowingSuccess, setCartShowingSuccess] = useState(false);

  // Called immediately when order is placed — clears cart without switching tabs
  function handleClearCart() {
    clearCart();
    setRemovedItemNames([]);
    setCartShowingSuccess(true);
  }

  // Called after the 4-second success screen — switches to orders tab
  function handleOrderSuccess() {
    setCartShowingSuccess(false);
    setActiveTab("orders");
  }

  // Active orders badge count — orders not yet served or cancelled
  const inProgressCount = activeOrders.filter(
    (o) => !["served", "cancelled"].includes(o.status)
  ).length;

  // ── Call Waiter ──────────────────────────────────────────────────────
  const [waiterCalled, setWaiterCalled] = useState(false);
  const [callingWaiter, setCallingWaiter] = useState(false);

  async function handleCallWaiter() {
    if (waiterCalled || callingWaiter) return;
    setCallingWaiter(true);
    try {
      const client = getSupabaseClient();
      await client.channel(`restaurant:${restaurant.id}`).send({
        type: "broadcast",
        event: "call_waiter",
        payload: {
          table_id: table.id,
          table_number: table.table_number,
          customer_name: customerInfo?.name ?? null,
          sent_at: new Date().toISOString(),
        },
      });
      setWaiterCalled(true);
      setTimeout(() => setWaiterCalled(false), 60_000);
    } catch {
      // Non-critical
    } finally {
      setCallingWaiter(false);
    }
  }

  // ── Table occupied screen ────────────────────────────────────────────
  if (tableOccupied === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tableOccupied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border bg-card shadow-sm">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold">{restaurant.name}</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          Table {table.table_number}
        </p>
        <div className="mt-6 rounded-xl border bg-card px-6 py-5 shadow-sm max-w-xs w-full">
          <p className="font-semibold text-base">Table is currently occupied</p>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            This table is being served. Please ask your waiter to clear the table before placing a new order.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-lg px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight">
                {restaurant.name}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                🪑 Table {table.table_number}
                {customerInfo && (
                  <span className="ml-1.5 text-foreground/70">· Hi, {customerInfo.name}!</span>
                )}
              </p>
            </div>
            <a
              href="/history"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
            >
              Order History
            </a>
          </div>
        </div>
      </header>

      {/* ── B1: Removed-item warning banner ────────────────────────── */}
      {removedItemNames.length > 0 && (
        <div className="mx-auto max-w-lg w-full px-4 pt-3">
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-amber-800 dark:text-amber-300">
                {removedItemNames.length === 1
                  ? `"${removedItemNames[0]}" was removed from your cart`
                  : `${removedItemNames.length} items were removed from your cart`}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                {removedItemNames.length === 1 ? "This item is" : "These items are"} no longer available.
              </p>
            </div>
            <button
              onClick={() => setRemovedItemNames([])}
              className="text-amber-600 hover:text-amber-800 text-xs shrink-0"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Welcome-back banner ─────────────────────────────────────── */}
      {welcomeData && !welcomeDismissed && (
        <div className="mx-auto max-w-lg w-full px-4 pt-3">
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Welcome back, {welcomeData.name}! 👋
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Visit #{welcomeData.visit_count} · Last here{" "}
                {(() => {
                  const days = Math.floor(
                    (Date.now() - new Date(welcomeData.last_seen_at).getTime()) / 86400000
                  );
                  if (days === 0) return "today";
                  if (days === 1) return "yesterday";
                  if (days < 7)  return `${days} days ago`;
                  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
                  return `${Math.floor(days / 30)} months ago`;
                })()}
              </p>
              {welcomeData.top_items.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Your favourites: {welcomeData.top_items.join(", ")}
                </p>
              )}
            </div>
            <button
              onClick={() => setWelcomeDismissed(true)}
              className="text-muted-foreground hover:text-foreground transition-colors text-xs shrink-0"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Geo-fencing banners ─────────────────────────────────────── */}
      {(restaurant.geofencing_enabled ?? false) && geoStatus === "checking" && (
        <div className="mx-auto max-w-lg w-full px-4 pt-3">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            Verifying your location…
          </div>
        </div>
      )}

      {/* B2: Hard block only when provably outside radius */}
      {geoBlocked && (
        <div className="mx-auto max-w-lg w-full px-4 pt-3">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <MapPin className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-destructive">Ordering not available</p>
              <p className="text-xs text-muted-foreground mt-0.5">{geoMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* B2: Soft warning when location permission was denied — ordering still allowed */}
      {geoPermissionDenied && (
        <div className="mx-auto max-w-lg w-full px-4 pt-3">
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3">
            <MapPin className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-amber-800 dark:text-amber-300">Location access denied</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                We couldn't verify your location. You can still order — a staff member may check if needed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab content ─────────────────────────────────────────────── */}
      <main className="flex-1 mx-auto max-w-lg w-full overflow-y-auto pb-32">

        {/* MENU TAB */}
        {activeTab === "menu" && (
          <div className="px-4 pt-4">
            {menuItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-4xl mb-3">🍽️</p>
                <p className="font-medium text-sm">No items available right now</p>
                <p className="text-xs text-muted-foreground mt-1">Please check back later</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {menuItems.map((item) => (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    quantity={cartQty[item.id] ?? 0}
                    onAddToCart={geoBlocked ? () => {} : addToCart}
                    onDecrement={
                      geoBlocked ? () => {} : (id, qty) => updateQuantity(id, qty - 1)
                    }
                    priceMultiplier={floorInfo?.price_multiplier ?? 1.0}
                    disabled={geoBlocked}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ORDERS TAB */}
        {activeTab === "orders" && (
          <div className="px-4 pt-4 space-y-4">
            {activeOrders.length > 0 && (
              // B5: pass restaurantId and refetchOrders so the tracker can cancel orders
              <OrderStatusTracker
                orders={activeOrders}
                restaurantId={restaurant.id}
                customerPhone={customerInfo?.phone ?? null}
                onOrderCancelled={refetchOrders}
                reviewQueue={reviewQueue}
                dismissedReviews={dismissedReviews}
                onDismissReview={(orderId) =>
                  setDismissedReviews((d) => new Set([...d, orderId]))
                }
              />
            )}

            {/* Pending reviews for orders that have since been billed and removed
                from activeOrders — show them standalone so they're not lost */}
            {activeOrders.length === 0 && reviewQueue
              .filter((r) => !dismissedReviews.has(r.orderId))
              .map((r) => (
                <div key={r.orderId} className="rounded-xl border bg-card overflow-hidden">
                  {/* Minimal header so the customer knows which order this is for */}
                  <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
                    <span className="text-xs text-muted-foreground font-mono">
                      #{r.orderId.slice(0, 6).toUpperCase()} · Served
                    </span>
                  </div>
                  <ReviewPrompt
                    orderId={r.orderId}
                    restaurantId={restaurant.id}
                    customerPhone={r.customerPhone}
                    items={r.items}
                    onDismiss={() =>
                      setDismissedReviews((d) => new Set([...d, r.orderId]))
                    }
                  />
                </div>
              ))
            }

            {activeOrders.length === 0 && reviewQueue.filter((r) => !dismissedReviews.has(r.orderId)).length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-4xl mb-3">📋</p>
                <p className="font-medium text-sm">No orders yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Add items from the menu and place your first order
                </p>
                <button
                  onClick={() => setActiveTab("menu")}
                  className="mt-4 text-sm text-primary font-medium hover:underline"
                >
                  Browse menu →
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Bottom: cart drawer + nav ───────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-lg">

        {/* Cart drawer — sits above the nav, only on menu tab */}
        {!geoBlocked && activeTab === "menu" && (cartItems.length > 0 || cartShowingSuccess) && (
          <CartDrawer
            cartItems={cartItems}
            totalPrice={totalPrice}
            restaurantId={restaurant.id}
            tableId={table.id}
            onUpdateQuantity={updateQuantity}
            onClearCart={handleClearCart}
            onOrderSuccess={handleOrderSuccess}
            savedCustomerInfo={customerInfo}
            onSaveCustomerInfo={saveCustomerInfo}
          />
        )}

        {/* Bottom navbar */}
        <nav className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex">
            <button
              onClick={() => setActiveTab("menu")}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                activeTab === "menu" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <UtensilsCrossed className="h-5 w-5" />
              Menu
            </button>

            <button
              onClick={() => setActiveTab("orders")}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors relative",
                activeTab === "orders" ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="relative">
                <ClipboardList className="h-5 w-5" />
                {inProgressCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                    {inProgressCount}
                  </span>
                )}
              </span>
              My Orders
            </button>

            <button
              onClick={handleCallWaiter}
              disabled={callingWaiter || waiterCalled}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                waiterCalled
                  ? "text-green-600"
                  : "text-muted-foreground hover:text-foreground disabled:opacity-50"
              )}
            >
              {callingWaiter
                ? <Loader2 className="h-5 w-5 animate-spin" />
                : <Bell className={cn("h-5 w-5", waiterCalled && "animate-pulse")} />
              }
              {waiterCalled ? "Called!" : "Call Waiter"}
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
