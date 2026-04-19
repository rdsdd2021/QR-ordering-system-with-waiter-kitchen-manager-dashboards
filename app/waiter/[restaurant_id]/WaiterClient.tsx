"use client";

import { RefreshCw, Wifi, WifiOff, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import WaiterOrderCard from "@/components/waiter/WaiterOrderCard";
import { useWaiterOrders } from "@/hooks/useWaiterOrders";
import ProtectedRoute from "@/components/ProtectedRoute";
import type { Restaurant } from "@/types/database";

type Props = {
  restaurant: Restaurant;
};

// Order sections for waiter dashboard
const SECTIONS = [
  { 
    key: "my_orders", 
    label: "My Orders", 
    emptyText: "No orders assigned to you",
    filter: (orders: any[], waiterId: string) => 
      orders.filter(o => o.waiter_id === waiterId)
  },
  { 
    key: "available", 
    label: "Available Orders", 
    emptyText: "No orders need attention",
    filter: (orders: any[], waiterId: string) => 
      orders.filter(o => !o.waiter_id && (o.status === "pending_waiter" || o.status === "confirmed" || o.status === "ready"))
  },
] as const;

function WaiterClientContent({ restaurant }: Props) {
  const { signOut, profile } = useAuth();
  
  // Get current waiter ID from authenticated user profile
  const currentWaiterId = profile?.id;
  
  const { 
    orders, 
    loading, 
    error, 
    takeOrder,
    acceptOrder,
    markServed, 
    refetch 
  } = useWaiterOrders(restaurant.id, currentWaiterId || "");

  // Show loading if auth is still loading or no profile
  if (!profile || !currentWaiterId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">
          Loading waiter profile...
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h1 className="font-semibold tracking-tight">{restaurant.name}</h1>
            <p className="text-xs text-muted-foreground">
              Waiter Dashboard • {profile?.name}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Real-time connection indicator */}
            {error ? (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <WifiOff className="h-3.5 w-3.5" />
                Offline
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Wifi className="h-3.5 w-3.5 text-green-500" />
                Live
              </span>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={refetch}
              className="h-8 gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>

            <Button variant="outline" size="sm" onClick={signOut} className="h-8">
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* ── Loading skeleton ─────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground animate-pulse">
            Loading orders…
          </p>
        </div>
      )}

      {/* ── Order sections ───────────────────────────────────────────── */}
      {!loading && (
        <div className="flex-1 p-4 space-y-6">
          {SECTIONS.map(({ key, label, emptyText, filter }) => {
            const sectionOrders = filter(orders, currentWaiterId);
            
            return (
              <section key={key}>
                {/* Section header */}
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    {label}
                  </h2>
                  {sectionOrders.length > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">
                      {sectionOrders.length}
                    </span>
                  )}
                </div>

                {/* Orders grid */}
                {sectionOrders.length === 0 ? (
                  <div className="flex h-24 items-center justify-center rounded-xl border border-dashed">
                    <p className="text-xs text-muted-foreground">{emptyText}</p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {sectionOrders.map((order) => (
                      <WaiterOrderCard
                        key={order.id}
                        order={order}
                        currentWaiterId={currentWaiterId}
                        onTakeOrder={takeOrder}
                        onAcceptOrder={acceptOrder}
                        onMarkServed={markServed}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function WaiterClient({ restaurant }: Props) {
  return (
    <ProtectedRoute requiredRole="waiter" restaurantId={restaurant.id}>
      <WaiterClientContent restaurant={restaurant} />
    </ProtectedRoute>
  );
}