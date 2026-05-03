"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabaseClient } from "@/lib/supabase";
import type { ActiveOrder } from "@/hooks/useCustomerSession";
import ReviewPrompt from "@/components/ReviewPrompt";

const STATUS_CONFIG: Record<string, {
  label: string; color: string; dot: string; bg: string; description: string;
}> = {
  pending:        { label: "Received",        color: "text-amber-700 dark:text-amber-400",   dot: "bg-amber-400 animate-pulse",    bg: "bg-amber-50/60 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",    description: "Your order has been received" },
  pending_waiter: { label: "Awaiting waiter", color: "text-purple-700 dark:text-purple-400", dot: "bg-purple-400 animate-pulse",   bg: "bg-purple-50/60 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800", description: "A waiter will confirm shortly" },
  confirmed:      { label: "Confirmed",       color: "text-blue-700 dark:text-blue-400",     dot: "bg-blue-500",                   bg: "bg-blue-50/60 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",     description: "Confirmed — kitchen is next" },
  preparing:      { label: "Preparing",       color: "text-orange-700 dark:text-orange-400", dot: "bg-orange-500 animate-pulse",   bg: "bg-orange-50/60 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800", description: "Kitchen is preparing your order 🍳" },
  ready:          { label: "Ready!",          color: "text-green-700 dark:text-green-400",   dot: "bg-green-500",                  bg: "bg-green-50/60 dark:bg-green-950/30 border-green-200 dark:border-green-800",   description: "Your order is ready — waiter is on the way 🚀" },
  served:         { label: "Served",          color: "text-muted-foreground",                dot: "bg-muted-foreground/40",        bg: "",                                                                               description: "Enjoy your meal! 😊" },
  cancelled:      { label: "Cancelled",       color: "text-muted-foreground",                dot: "bg-muted-foreground/40",        bg: "bg-muted/30 border-border",                                                      description: "Order was cancelled" },
};

const STEPS = ["pending", "confirmed", "preparing", "ready", "served"] as const;

// Statuses where the cancel button is shown to the customer
const CANCELLABLE_STATUSES = new Set(["pending", "pending_waiter"]);

function stepIndex(status: string) {
  if (status === "pending_waiter") return 0;
  return STEPS.indexOf(status as typeof STEPS[number]);
}

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type ReviewableOrder = {
  orderId: string;
  customerPhone: string | null;
  items: Array<{ menu_item_id: string; name: string; quantity: number }>;
};

type Props = {
  orders: ActiveOrder[];
  restaurantId: string;
  customerPhone: string | null;
  onOrderCancelled?: () => void;
  reviewQueue: ReviewableOrder[];
  dismissedReviews: Set<string>;
  onDismissReview: (orderId: string) => void;
};

export default function OrderStatusTracker({ orders, restaurantId, customerPhone, onOrderCancelled, reviewQueue, dismissedReviews, onDismissReview }: Props) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleCancel(orderId: string) {
    if (cancelling) return;
    setCancelling(orderId);
    setCancelError(null);

    try {
      const supabase = getSupabaseClient();

      if (!customerPhone) {
        setCancelError("Can't verify your identity. Please refresh and try again.");
        setCancelling(null);
        return;
      }

      const { data: result, error } = await supabase.rpc("cancel_order_by_customer", {
        p_order_id:       orderId,
        p_customer_phone: customerPhone,
      });

      if (error) {
        setCancelError("Couldn't cancel the order. Please ask a staff member.");
      } else if (result === "ok") {
        onOrderCancelled?.();
      } else if (result === "wrong_owner") {
        setCancelError("You can only cancel your own orders.");
      } else if (result === "not_cancellable") {
        setCancelError("This order can no longer be cancelled — it's already being prepared.");
      } else {
        setCancelError("Order not found.");
      }
    } catch {
      setCancelError("Something went wrong. Please try again.");
    } finally {
      setCancelling(null);
    }
  }

  if (!orders.length) return null;

  return (
    <div className="space-y-3">
      {cancelError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-3">
          <span>{cancelError}</span>
          <button onClick={() => setCancelError(null)} className="shrink-0 text-destructive/70 hover:text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {orders.map(order => {
        const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;
        const idx = stepIndex(order.status);
        const canCancel = CANCELLABLE_STATUSES.has(order.status);
        const isCancelling = cancelling === order.id;

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
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">
                  #{order.id.slice(0, 6).toUpperCase()} · {fmt(order.created_at)}
                </span>
                {/* B5: cancel button — only shown while order is still cancellable */}
                {canCancel && (
                  <button
                    onClick={() => handleCancel(order.id)}
                    disabled={isCancelling}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 border border-border rounded-md px-2 py-0.5"
                    aria-label="Cancel order"
                  >
                    {isCancelling
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <X className="h-3 w-3" />
                    }
                    {isCancelling ? "Cancelling…" : "Cancel"}
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            {order.status !== "pending_waiter" && order.status !== "cancelled" && (
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

            {(order.status === "pending_waiter" || order.status === "cancelled") && (
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

            {/* Inline review prompt — only for served orders with a pending review */}
            {order.status === "served" && (() => {
              const review = reviewQueue.find((r) => r.orderId === order.id && !dismissedReviews.has(r.orderId));
              if (!review) return null;
              return (
                <ReviewPrompt
                  orderId={review.orderId}
                  restaurantId={restaurantId}
                  customerPhone={review.customerPhone}
                  items={review.items}
                  onDismiss={() => onDismissReview(order.id)}
                />
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
