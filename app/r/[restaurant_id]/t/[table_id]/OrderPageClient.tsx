"use client";

import { useState, useCallback, useEffect } from "react";
import { MapPin, Loader2, UtensilsCrossed, ClipboardList, Lock } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import { useRealtimeMenu } from "@/hooks/useRealtimeMenu";
import { useGeofence } from "@/hooks/useGeofence";
import { useCustomerSession } from "@/hooks/useCustomerSession";
import MenuItemCard from "@/components/MenuItemCard";
import CartDrawer from "@/components/CartDrawer";
import OrderStatusTracker from "@/components/OrderStatusTracker";
import { checkTableHasUnpaidOrders } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { MenuItem, Restaurant, RestaurantTable, Floor } from "@/types/database";

type Tab = "menu" | "orders";

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

  const { cartItems, addToCart, updateQuantity, clearCart, totalPrice, totalItems } = useCart();

  const { customerInfo, saveCustomerInfo, activeOrders } = useCustomerSession(
    restaurant.id,
    table.id
  );

  // ── Table occupancy check ────────────────────────────────────────────
  // If this browser has no active session for this table but the table has
  // unpaid orders, it means another customer is still being served.
  const [tableOccupied, setTableOccupied] = useState<boolean | null>(null); // null = checking

  useEffect(() => {
    // Give useCustomerSession a moment to load from sessionStorage first
    const timer = setTimeout(async () => {
      const hasUnpaid = await checkTableHasUnpaidOrders(table.id);
      if (hasUnpaid) {
        // Check if this browser owns the session (customerInfo will be set if so)
        const sessionKey = `customer_session_${table.id}`;
        const ownSession = sessionStorage.getItem(sessionKey);
        setTableOccupied(!ownSession);
      } else {
        setTableOccupied(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [table.id]);

  const { status: geoStatus, message: geoMessage } = useGeofence({
    enabled: restaurant.geofencing_enabled ?? false,
    restaurantLat: restaurant.geo_latitude ?? null,
    restaurantLng: restaurant.geo_longitude ?? null,
    radiusMeters: restaurant.geo_radius_meters ?? 100,
  });

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
        setMenuItems((prev) => prev.filter((i) => i.id !== payload.id));
      }
    },
    [restaurant.id]
  );

  useRealtimeMenu({ restaurantId: restaurant.id, onMenuChange: handleMenuChange });

  const cartQty = Object.fromEntries(cartItems.map((c) => [c.id, c.quantity]));
  const geoBlocked =
    (restaurant.geofencing_enabled ?? false) &&
    (geoStatus === "denied" || geoStatus === "error");

  // Switch to orders tab automatically when an order is placed
  function handleOrderSuccess() {
    clearCart();
    setActiveTab("orders");
  }

  // Active orders badge count — orders not yet served
  const inProgressCount = activeOrders.filter(
    (o) => !["served"].includes(o.status)
  ).length;

  // ── Table occupied screen ────────────────────────────────────────────
  if (tableOccupied === null) {
    // Still checking — show a brief loading state
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

      {/* ── Geo-fencing banner ──────────────────────────────────────── */}
      {(restaurant.geofencing_enabled ?? false) && geoStatus === "checking" && (
        <div className="mx-auto max-w-lg w-full px-4 pt-3">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            Verifying your location…
          </div>
        </div>
      )}

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
          <div className="px-4 pt-4">
            {activeOrders.length === 0 ? (
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
            ) : (
              <OrderStatusTracker orders={activeOrders} />
            )}
          </div>
        )}
      </main>

      {/* ── Bottom: cart drawer + nav ───────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-lg">

        {/* Cart drawer — sits above the nav, only on menu tab */}
        {!geoBlocked && activeTab === "menu" && cartItems.length > 0 && (
          <CartDrawer
            cartItems={cartItems}
            totalPrice={totalPrice}
            restaurantId={restaurant.id}
            tableId={table.id}
            onUpdateQuantity={updateQuantity}
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
          </div>
        </nav>
      </div>
    </div>
  );
}
