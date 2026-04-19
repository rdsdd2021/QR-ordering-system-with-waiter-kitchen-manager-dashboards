"use client";

import { useState } from "react";
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
  nextStatus: OrderStatus | null;
  actionLabel: string | null;
  actionClass: string;
}> = {
  pending_waiter: {
    label: "Waiting for waiter",
    dot: "bg-purple-400", border: "border-purple-200",
    nextStatus: null, actionLabel: null, actionClass: "",
  },
  pending: {
    label: "New order",
    dot: "bg-amber-400 animate-pulse", border: "border-amber-200",
    nextStatus: "confirmed", actionLabel: "Accept order",
    actionClass: "bg-amber-500 hover:bg-amber-600 text-white",
  },
  confirmed: {
    label: "Confirmed",
    dot: "bg-blue-400", border: "border-blue-200",
    nextStatus: "preparing", actionLabel: "Start preparing",
    actionClass: "bg-blue-500 hover:bg-blue-600 text-white",
  },
  preparing: {
    label: "Preparing",
    dot: "bg-orange-400 animate-pulse", border: "border-orange-200",
    nextStatus: "ready", actionLabel: "Mark ready",
    actionClass: "bg-green-500 hover:bg-green-600 text-white",
  },
  ready: {
    label: "Ready for pickup",
    dot: "bg-green-500", border: "border-green-200",
    nextStatus: null, actionLabel: null, actionClass: "",
  },
  served: {
    label: "Served",
    dot: "bg-muted-foreground/40", border: "border-border",
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
      "rounded-xl border bg-card flex flex-col overflow-hidden transition-all duration-300",
      isNew && "ring-2 ring-primary/40 shadow-md shadow-primary/10",
      cfg.border,
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
            <span className="font-semibold text-sm">Table {order.table.table_number}</span>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground pl-4">
            #{order.id.slice(0, 8).toUpperCase()}
          </p>
          {order.waiter && (
            <p className="text-xs text-muted-foreground pl-4">{order.waiter.name}</p>
          )}
        </div>
        <div className="text-right space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{cfg.label}</span>
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
          <Button
            className={cn("w-full h-9 text-sm font-semibold rounded-lg", cfg.actionClass)}
            onClick={handleAdvance}
            disabled={busy}
          >
            {busy
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Updating…</>
              : <><ChefHat className="h-3.5 w-3.5 mr-2" />{cfg.actionLabel}</>
            }
          </Button>
        </div>
      )}

      {order.status === "ready" && (
        <div className="px-4 pb-4 pt-1">
          <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-2 text-center">
            <p className="text-xs font-medium text-green-700">✓ Ready for waiter pickup</p>
          </div>
        </div>
      )}
    </div>
  );
}
