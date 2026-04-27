"use client";

import { cn } from "@/lib/utils";
import type { ActiveOrder } from "@/hooks/useCustomerSession";

const STATUS_CONFIG: Record<string, {
  label: string; color: string; dot: string; bg: string; description: string;
}> = {
  pending:        { label: "Received",        color: "text-amber-700",  dot: "bg-amber-400 animate-pulse", bg: "bg-amber-50/60 border-amber-100",   description: "Your order has been received" },  pending_waiter: { label: "Awaiting waiter", color: "text-purple-700", dot: "bg-purple-400 animate-pulse", bg: "bg-purple-50/60 border-purple-100", description: "A waiter will confirm shortly" },
  confirmed:      { label: "Confirmed",       color: "text-blue-700",   dot: "bg-blue-500",                bg: "bg-blue-50/60 border-blue-100",     description: "Confirmed — kitchen is next" },
  preparing:      { label: "Preparing",       color: "text-orange-700", dot: "bg-orange-500 animate-pulse", bg: "bg-orange-50/60 border-orange-100", description: "Kitchen is preparing your order 🍳" },
  ready:          { label: "Ready!",          color: "text-green-700",  dot: "bg-green-500",               bg: "bg-green-50/60 border-green-100",   description: "Your order is ready — waiter is on the way 🚀" },
  served:         { label: "Served",          color: "text-muted-foreground", dot: "bg-muted-foreground/40", bg: "",                                description: "Enjoy your meal! 😊" },
};

const STEPS = ["pending", "confirmed", "preparing", "ready", "served"] as const;

function stepIndex(status: string) {
  if (status === "pending_waiter") return 0;
  return STEPS.indexOf(status as typeof STEPS[number]);
}

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function OrderStatusTracker({ orders }: { orders: ActiveOrder[] }) {
  if (!orders.length) return null;

  return (
    <div className="space-y-3">
      {orders.map(order => {
        const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;
        const idx = stepIndex(order.status);
        const active = ["pending", "pending_waiter", "confirmed", "preparing"].includes(order.status);

        return (
          <div key={order.id} className={cn("rounded-xl border overflow-hidden", cfg.bg || "bg-card border-border")}>
            {/* Status row */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", cfg.dot)} />
                <span className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</span>
                {order.waiter_name && (
                  <span className="text-xs text-muted-foreground">· {order.waiter_name}</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                #{order.id.slice(0, 6).toUpperCase()} · {fmt(order.created_at)}
              </span>
            </div>

            {/* Progress bar */}
            {order.status !== "pending_waiter" && (
              <div className="px-4 pb-3">
                <div className="flex gap-1 mb-2">
                  {STEPS.map((_, i) => (
                    <div key={i} className={cn(
                      "h-1 flex-1 rounded-full transition-all duration-700",
                      i <= idx ? "bg-primary" : "bg-border"
                    )} />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{cfg.description}</p>
              </div>
            )}

            {order.status === "pending_waiter" && (
              <div className="px-4 pb-3">
                <p className="text-xs text-muted-foreground">{cfg.description}</p>
              </div>
            )}

            {/* Items */}
            {order.items.length > 0 && (
              <div className="px-4 pb-3 flex flex-wrap gap-x-3 gap-y-0.5">
                {order.items.map((item, i) => (
                  <span key={i} className="text-xs text-muted-foreground">
                    {item.quantity}× {item.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
