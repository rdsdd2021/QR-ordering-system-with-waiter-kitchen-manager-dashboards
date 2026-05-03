"use client";

import { RefreshCw, Wifi, WifiOff, LogOut, Volume2, VolumeX, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import WaiterOrderCard from "@/components/waiter/WaiterOrderCard";
import { useWaiterOrders } from "@/hooks/useWaiterOrders";
import { useNotificationSounds } from "@/hooks/useNotificationSounds";
import { useToast } from "@/hooks/useToast";
import ProtectedRoute from "@/components/ProtectedRoute";
import type { Restaurant } from "@/types/database";
import { useRef, useEffect } from "react";

type Props = {
  restaurant: Restaurant;
};

// Inner component — only mounts once we have a confirmed waiterId,
// so useWaiterOrders never fires with an empty string and never re-fetches.
function WaiterDashboard({ restaurant, waiterId, onSignOut, profileName }: {
  restaurant: Restaurant;
  waiterId: string;
  onSignOut: () => void;
  profileName: string | undefined;
}) {
  const { notify, muted, toggleMute } = useNotificationSounds();
  const { toast } = useToast();
  const isWaiterMode = restaurant.order_routing_mode === "waiter_first";

  const SECTIONS = [
    {
      key: "my_orders",
      label: "My Orders",
      emptyText: "No orders assigned to you",
      filter: (orders: any[], wId: string) =>
        orders.filter(o => o.waiter_id === wId && o.status !== "cancelled"),
    },
    {
      key: "available",
      label: isWaiterMode
        ? (restaurant.waiter_assignment_mode === "broadcast" ? "Available to Accept" : "Needs Attention")
        : "Ready to Serve",
      emptyText: isWaiterMode
        ? (restaurant.waiter_assignment_mode === "broadcast" ? "No orders waiting to be accepted" : "Nothing needs attention right now")
        : "No orders ready to serve",
      filter: (orders: any[]) =>
        orders.filter(o =>
          !o.waiter_id && (
            o.status === "pending_waiter" ||
            o.status === "ready" ||
            // In broadcast mode, confirmed-but-unassigned orders also appear here
            (restaurant.waiter_assignment_mode === "broadcast" && o.status === "confirmed")
          )
        ),
    },
  ];

  const { orders, loading, error, isConnected, takeOrder, acceptOrder, markServed, refetch } =
    useWaiterOrders(restaurant.id, waiterId, notify);

  // Toast on new order assigned to this waiter, and when an order becomes ready.
  // isInitialLoadRef prevents toasting for orders that already exist on page load.
  const prevOrderIdsRef    = useRef<Set<string>>(new Set());
  const prevOrderStatusRef = useRef<Map<string, string>>(new Map());
  const isInitialLoadRef   = useRef(true);

  useEffect(() => {
    // Skip the first run — these are orders that were already there on mount,
    // not genuinely new arrivals. Seed the refs silently.
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      orders.forEach((order) => {
        prevOrderIdsRef.current.add(order.id);
        prevOrderStatusRef.current.set(order.id, order.status);
      });
      return;
    }

    orders.forEach((order) => {
      const isNew      = !prevOrderIdsRef.current.has(order.id);
      const prevStatus = prevOrderStatusRef.current.get(order.id);

      if (isNew && order.waiter_id === waiterId) {
        toast({
          title:       "New order assigned",
          description: `Table ${order.table?.table_number ?? "?"}`,
          variant:     "warning",
          duration:    5000,
        });
      } else if (prevStatus && prevStatus !== order.status && order.status === "ready") {
        toast({
          title:       "Order ready to serve 🚀",
          description: `Table ${order.table?.table_number ?? "?"}`,
          variant:     "success",
          duration:    5000,
        });
      }

      prevOrderStatusRef.current.set(order.id, order.status);
    });
    prevOrderIdsRef.current = new Set(orders.map((o) => o.id));
  }, [orders, waiterId, toast]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs font-bold">W</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-semibold text-sm text-foreground">{restaurant.name}</h1>
              <p className="text-xs text-muted-foreground">
                Waiter Dashboard • {profileName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Real-time connection indicator */}
            {!isConnected ? (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <WifiOff className="h-3.5 w-3.5" />
                Offline
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <Wifi className="h-3.5 w-3.5" />
                Live
              </span>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={refetch}
              className="h-8 w-8"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleMute}
              className="h-8 w-8"
              title={muted ? "Unmute notifications" : "Mute notifications"}
            >
              {muted
                ? <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                : <Volume2 className="h-3.5 w-3.5" />
              }
            </Button>

            <Button variant="ghost" size="icon" onClick={onSignOut} className="h-8 w-8" title="Sign Out">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── C4: Action error banner — shown when a race is lost or serve fails ── */}
      {error && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* ── Loading skeleton ─────────────────────────────────────────── */}
      {loading && (
        <div className="flex-1 p-4 space-y-6">
          <Skeleton className="h-6 w-32 rounded-lg" />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        </div>
      )}

      {/* ── Order sections ───────────────────────────────────────────── */}
      {!loading && (
        <div className="flex-1 p-4 space-y-6">
          {SECTIONS.map(({ key, label, emptyText, filter }) => {
            const sectionOrders = filter(orders, waiterId);
            
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
                        currentWaiterId={waiterId}
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

function WaiterClientContent({ restaurant }: Props) {
  const { signOut, profile } = useAuth();

  // Wait for profile to load before mounting the dashboard
  if (!profile?.id) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col gap-3 p-4 w-full max-w-sm">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <WaiterDashboard
      restaurant={restaurant}
      waiterId={profile.id}
      onSignOut={signOut}
      profileName={profile.name}
    />
  );
}

export default function WaiterClient({ restaurant }: Props) {
  return (
    <ProtectedRoute requiredRole="waiter" restaurantId={restaurant.id}>
      <WaiterClientContent restaurant={restaurant} />
    </ProtectedRoute>
  );
}