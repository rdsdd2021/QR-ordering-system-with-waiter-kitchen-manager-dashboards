"use client";

import { useState } from "react";
import { Clock, Loader2, UserCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import OrderItemList from "../kitchen/OrderItemList";
import type { WaiterOrder, OrderStatus } from "@/types/database";

type Props = {
  order: WaiterOrder;
  currentWaiterId: string;
  onTakeOrder:   (orderId: string, waiterId: string) => Promise<void>;
  onAcceptOrder: (orderId: string, waiterId: string) => Promise<void>;
  onMarkServed:  (orderId: string, waiterId: string) => Promise<void>;
};

const STATUS_CONFIG: Record<OrderStatus, {
  label: string; dot: string; border: string; description: string;
}> = {
  pending:        { label: "New Order",         dot: "bg-amber-400",              border: "border-amber-200",  description: "Waiting for kitchen" },
  pending_waiter: { label: "Needs acceptance",  dot: "bg-purple-400 animate-pulse", border: "border-purple-200", description: "Waiting for waiter to accept" },
  confirmed:      { label: "Confirmed",         dot: "bg-blue-400",               border: "border-blue-200",   description: "Kitchen is preparing" },
  preparing:      { label: "Preparing",         dot: "bg-orange-400 animate-pulse", border: "border-orange-200", description: "Being prepared in kitchen" },
  ready:          { label: "Ready",             dot: "bg-green-500",              border: "border-green-200",  description: "Ready for pickup and serving" },
  served:         { label: "Served",            dot: "bg-muted-foreground/40",    border: "border-border",     description: "Delivered to customer" },
  cancelled:      { label: "Cancelled",         dot: "bg-gray-400",               border: "border-gray-200",   description: "Order was cancelled" },
};

function elapsed(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} mins ago`;
}

export default function WaiterOrderCard({ order, currentWaiterId, onTakeOrder, onAcceptOrder, onMarkServed }: Props) {
  const [busy, setBusy] = useState(false);
  const cfg = STATUS_CONFIG[order.status];

  const isMe         = order.waiter_id === currentWaiterId;
  const isUnassigned = !order.waiter_id;

  const canAccept = (isUnassigned || isMe) && order.status === "pending_waiter";
  const canTake   = isUnassigned && order.status === "ready";
  const canServe  = isMe && order.status === "ready";

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    await fn();
    setBusy(false);
  }

  return (
    <div className={cn(
      "rounded-lg border bg-card flex flex-col overflow-hidden transition-colors duration-200",
      cfg.border,
      isMe && "ring-2 ring-primary/30",
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
            <span className="font-semibold text-sm">
              Table {order.table.table_number}
              {order.table.floor?.name && (
                <span className="font-normal text-muted-foreground"> · {order.table.floor.name}</span>
              )}
            </span>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground pl-4">
            #{order.id.slice(0, 8).toUpperCase()}
          </p>
          <p className={cn("text-xs pl-4", isMe ? "text-primary font-medium" : "text-muted-foreground")}>
            {isMe ? "Assigned to you" : order.waiter ? order.waiter.name : "Unassigned"}
          </p>
        </div>
        <div className="text-right space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{cfg.label}</span>
          <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {elapsed(order.created_at)}
          </div>
        </div>
      </div>

      <div className="h-px bg-border mx-4" />

      {/* Description */}
      <p className="px-4 py-2 text-xs text-muted-foreground">{cfg.description}</p>

      <div className="h-px bg-border mx-4" />

      {/* Items */}
      <div className="px-4 py-3 flex-1">
        <OrderItemList items={order.order_items} />
      </div>

      {/* Actions */}
      {(canAccept || canTake || canServe) && (
        <div className="px-4 pb-4 pt-1 space-y-2">
          {canAccept && (
            <Button
              variant="default"
              className="w-full h-9 text-sm font-semibold rounded-lg bg-purple-500 hover:bg-purple-600"
              onClick={() => act(() => onAcceptOrder(order.id, currentWaiterId))}
              disabled={busy}
            >
              {busy
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Accepting…</>
                : <><CheckCircle2 className="h-3.5 w-3.5 mr-2" />{isMe ? "Confirm Order" : "Accept Order"}</>
              }
            </Button>
          )}
          {canTake && (
            <Button
              variant="default"
              className="w-full h-9 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-600"
              onClick={() => act(() => onTakeOrder(order.id, currentWaiterId))}
              disabled={busy}
            >
              {busy
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Taking…</>
                : <><UserCheck className="h-3.5 w-3.5 mr-2" />Take Order</>
              }
            </Button>
          )}
          {canServe && (
            <Button
              variant="default"
              className="w-full h-9 text-sm font-semibold rounded-lg"
              onClick={() => act(() => onMarkServed(order.id, currentWaiterId))}
              disabled={busy}
            >
              {busy
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Marking…</>
                : <><CheckCircle2 className="h-3.5 w-3.5 mr-2" />Mark Served</>
              }
            </Button>
          )}
        </div>
      )}

      {order.status === "served" && (
        <div className="px-4 pb-4 pt-1">
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
            <p className="text-xs text-muted-foreground">✓ Order completed</p>
          </div>
        </div>
      )}
    </div>
  );
}
