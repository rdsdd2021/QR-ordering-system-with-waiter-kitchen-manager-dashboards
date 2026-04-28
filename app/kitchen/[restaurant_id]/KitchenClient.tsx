"use client";

import { RefreshCw, Wifi, WifiOff, LogOut, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import OrderCard from "@/components/kitchen/OrderCard";
import { useKitchenOrders } from "@/hooks/useKitchenOrders";
import ProtectedRoute from "@/components/ProtectedRoute";
import type { Restaurant } from "@/types/database";
import { useState } from "react";

type Props = {
  restaurant: Restaurant;
};

// Status columns shown on the board — left to right = workflow order
// Kitchen flow now ends at 'ready' (waiters handle 'served')
const COLUMNS = [
  { status: "pending",   label: "Pending",   emptyText: "No new orders" },
  { status: "confirmed", label: "Confirmed", emptyText: "Nothing confirmed" },
  { status: "preparing", label: "Preparing", emptyText: "Nothing in progress" },
  { status: "ready",     label: "Ready",     emptyText: "Nothing ready yet" },
] as const;

function KitchenClientContent({ restaurant }: Props) {
  const { signOut, profile } = useAuth();
  const { orders, loading, error, isConnected, advanceStatus, newOrderIds, refetch } =
    useKitchenOrders(restaurant.id);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function markAllReady() {
    const preparing = orders.filter((o) => o.status === "preparing");
    if (!preparing.length) return;
    setBulkBusy(true);
    await Promise.all(preparing.map((o) => advanceStatus(o.id, "ready")));
    setBulkBusy(false);
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs font-bold">K</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-semibold text-sm text-foreground">{restaurant.name}</h1>
              <p className="text-xs text-muted-foreground">
                Kitchen Display • {profile?.name}
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

            <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8" title="Sign Out">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Loading skeleton ─────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-1 gap-3 p-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-48 w-72 rounded-lg shrink-0" />
          ))}
        </div>
      )}

      {/* ── Kanban board ─────────────────────────────────────────────── */}
      {!loading && (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {COLUMNS.map(({ status, label, emptyText }) => {
            const col = orders.filter((o) => o.status === status);
            return (
              <div
                key={status}
                className="flex w-72 shrink-0 flex-col gap-3"
              >
                {/* Column header */}
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {label}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {status === "preparing" && col.length > 1 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px] gap-1"
                        onClick={markAllReady}
                        disabled={bulkBusy}
                      >
                        <CheckCheck className="h-3 w-3" />
                        All Ready
                      </Button>
                    )}
                    {col.length > 0 && (
                      <span
                        className={cn(
                          "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                          status === "pending"
                            ? "bg-warning-light text-warning"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {col.length}
                      </span>
                    )}
                  </div>
                </div>

                {/* Cards */}
                {col.length === 0 ? (
                  <div className="flex h-24 items-center justify-center rounded-xl border border-dashed">
                    <p className="text-xs text-muted-foreground">{emptyText}</p>
                  </div>
                ) : (
                  col.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      isNew={newOrderIds.has(order.id)}
                      onAdvance={advanceStatus}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function KitchenClient({ restaurant }: Props) {
  return (
    <ProtectedRoute requiredRole="kitchen" restaurantId={restaurant.id}>
      <KitchenClientContent restaurant={restaurant} />
    </ProtectedRoute>
  );
}
