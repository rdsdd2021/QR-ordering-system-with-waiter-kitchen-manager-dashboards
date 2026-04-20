"use client";

import { useState } from "react";
import { Clock, Loader2, ChefHat } from "lucide-react";
import { Button } from "@/components/ui/button"; // kept for potential future use
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
    dot: "bg-purple-400", border: "border-purple-200", stripe: "bg-gradient-to-b from-purple-400 to-purple-500",
    nextStatus: null, actionLabel: null, actionClass: "",
  },
  pending: {
    label: "New order",
    dot: "bg-amber-400 animate-pulse", border: "border-amber-200", stripe: "bg-gradient-to-b from-amber-400 to-orange-500",
    nextStatus: "confirmed", actionLabel: "Accept order",
    actionClass: "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md shadow-amber-200",
  },
  confirmed: {
    label: "Confirmed",
    dot: "bg-blue-400", border: "border-blue-200", stripe: "bg-gradient-to-b from-blue-400 to-blue-500",
    nextStatus: "preparing", actionLabel: "Start preparing",
    actionClass: "bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white shadow-md shadow-blue-200",
  },
  preparing: {
    label: "Preparing",
    dot: "bg-orange-400 animate-pulse", border: "border-orange-200", stripe: "bg-gradient-to-b from-orange-400 to-red-400",
    nextStatus: "ready", actionLabel: "Mark ready",
    actionClass: "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200",
  },
  ready: {
    label: "Ready for pickup",
    dot: "bg-green-500", border: "border-green-200", stripe: "bg-gradient-to-b from-emerald-400 to-green-500",
    nextStatus: null, actionLabel: null, actionClass: "",
  },
  served: {
    label: "Served",
    dot: "bg-muted-foreground/40", border: "border-border", stripe: "bg-muted",
    nextStatus: null, actionLabel: null, actionClass: "",
  },
};

function elapsed(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} mins ago`;
}

export default function OrderCard({ order, isNew, onAdvance }: Props) {
  const [busy, setBusy] = useState(false);
  const cfg = STATUS_CONFIG[order.status];

  async function handleAdvance() {
    if (!cfg.nextStatus) return;
    setBusy(true);
    await onAdvance(order.id, cfg.nextStatus);
    setBusy(false);
  }

  return (
    <div className={cn(
      "rounded-xl border bg-card flex overflow-hidden transition-all duration-300",
      isNew && "ring-2 ring-primary/50 shadow-lg shadow-primary/10",
      cfg.border,
    )}>
      {/* Vivid status stripe on left */}
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
            <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
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
                "w-full h-10 text-sm font-bold rounded-xl transition-all duration-150 active:scale-95 hover:scale-[1.02] hover:shadow-lg",
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
            <div className="rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 px-3 py-2.5 text-center">
              <p className="text-xs font-semibold text-emerald-700">✓ Ready for waiter pickup</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
