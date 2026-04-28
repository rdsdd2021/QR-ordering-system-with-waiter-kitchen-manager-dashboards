"use client";

import { useState, useEffect } from "react";
import { Clock, Loader2, ChefHat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import OrderItemList from "./OrderItemList";
import type { KitchenOrder, OrderStatus } from "@/types/database";

type Props = {
  order: KitchenOrder;
  isNew: boolean;
  onAdvance: (orderId: string, newStatus: OrderStatus) => Promise<void>;
};

const STATUS_CONFIG: Record<OrderStatus, {
  label: string;
  dot: string;
  border: string;
  stripe: string;
  nextStatus: OrderStatus | null;
  actionLabel: string | null;
  actionClass: string;
}> = {
  pending_waiter: {
    label: "Waiting for waiter",
    dot: "bg-purple-400", border: "border-purple-200", stripe: "bg-purple-400",
    nextStatus: null, actionLabel: null, actionClass: "",
  },
  pending: {
    label: "New order",
    dot: "bg-amber-400 animate-pulse", border: "border-amber-200", stripe: "bg-amber-400",
    nextStatus: "confirmed", actionLabel: "Accept order",
    actionClass: "bg-amber-500 hover:bg-amber-600 text-white",
  },
  confirmed: {
    label: "Confirmed",
    dot: "bg-blue-400", border: "border-blue-200", stripe: "bg-blue-400",
    nextStatus: "preparing", actionLabel: "Start preparing",
    actionClass: "bg-blue-500 hover:bg-blue-600 text-white",
  },
  preparing: {
    label: "Preparing",
    dot: "bg-orange-400 animate-pulse", border: "border-orange-200", stripe: "bg-orange-400",
    nextStatus: "ready", actionLabel: "Mark ready",
    actionClass: "bg-emerald-500 hover:bg-emerald-600 text-white",
  },
  ready: {
    label: "Ready for pickup",
    dot: "bg-green-500", border: "border-green-200", stripe: "bg-emerald-500",
    nextStatus: null, actionLabel: null, actionClass: "",
  },
  served: {
    label: "Served",
    dot: "bg-muted-foreground/40", border: "border-border", stripe: "bg-muted-foreground/30",
    nextStatus: null, actionLabel: null, actionClass: "",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-gray-400", border: "border-gray-200", stripe: "bg-gray-400",
    nextStatus: null, actionLabel: null, actionClass: "",
  },
};

function elapsed(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} mins ago`;
}

function urgencyClass(iso: string, status: string): string {
  if (status === "ready" || status === "served" || status === "pending_waiter") return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins >= 20) return "border-red-400 bg-red-50/30";
  if (mins >= 12) return "border-amber-400 bg-amber-50/30";
  return "";
}

export default function OrderCard({ order, isNew, onAdvance }: Props) {
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const cfg = STATUS_CONFIG[order.status];

  // Re-render every 60s so elapsed times stay accurate
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  async function handleAdvance() {
    if (!cfg.nextStatus) return;
    setBusy(true);
    await onAdvance(order.id, cfg.nextStatus);
    setBusy(false);
  }

  return (
    <div className={cn(
      "rounded-lg border bg-card flex overflow-hidden transition-colors duration-200",
      isNew && "ring-2 ring-primary/50",
      urgencyClass(order.created_at, order.status) || cfg.border,
    )}>
      {/* Solid status stripe on left */}
      <div className={cn("w-1.5 shrink-0", cfg.stripe)} />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
              <span className="font-bold text-sm">Table {order.table.table_number}</span>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground pl-4">
              #{order.id.slice(0, 8).toUpperCase()}
            </p>
            {order.waiter && (
              <p className="text-xs text-muted-foreground pl-4">{order.waiter.name}</p>
            )}
          </div>
          <div className="text-right space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">{cfg.label}</span>
            <div className={cn(
              "flex items-center justify-end gap-1 text-xs",
              (() => {
                const mins = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
                if (mins >= 20 && order.status !== "ready" && order.status !== "served") return "text-red-600 font-semibold";
                if (mins >= 12 && order.status !== "ready" && order.status !== "served") return "text-amber-600 font-semibold";
                return "text-muted-foreground";
              })()
            )}>
              <Clock className="h-3 w-3" />
              {elapsed(order.created_at)}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-border mx-4" />

        {/* Items */}
        <div className="px-4 py-3 flex-1">
          <OrderItemList items={order.order_items} />
        </div>

        {/* Action */}
        {cfg.actionLabel && (
          <div className="px-4 pb-4 pt-1">
            <button
              className={cn(
                "w-full h-10 text-sm font-bold rounded-lg transition-colors duration-150",
                cfg.actionClass
              )}
              onClick={handleAdvance}
              disabled={busy}
            >
              {busy
                ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating…</span>
                : <span className="flex items-center justify-center gap-2"><ChefHat className="h-3.5 w-3.5" />{cfg.actionLabel}</span>
              }
            </button>
          </div>
        )}

        {order.status === "ready" && (
          <div className="px-4 pb-4 pt-1">
            <div className="rounded-lg bg-muted/50 border border-border px-3 py-2.5 text-center">
              <p className="text-xs font-semibold text-muted-foreground">✓ Ready for waiter pickup</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
