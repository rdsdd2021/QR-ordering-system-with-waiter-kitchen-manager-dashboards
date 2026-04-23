"use client";

/**
 * useKitchenOrders
 *
 * Manages the full lifecycle of kitchen orders:
 *  1. Initial fetch of all orders for the restaurant
 *  2. Real-time subscription via Supabase broadcast
 *
 * HOW THE REAL-TIME SUBSCRIPTION WORKS
 * ─────────────────────────────────────
 * We use Supabase Realtime's `broadcast` mechanism (not postgres_changes).
 * A PostgreSQL trigger on the `orders` table calls `realtime.send()` after
 * every INSERT or UPDATE, publishing a message to the topic
 * `kitchen:{restaurant_id}` with event name `order_changed`.
 *
 * The client subscribes to that topic and receives a payload containing the
 * updated order row. We then:
 *  - On INSERT: prepend the new order to state (it won't have joined data yet,
 *    so we re-fetch the single order to get table + items).
 *  - On UPDATE: patch the existing order's status in-place (optimistic update
 *    already applied by the action button, this confirms it).
 *
 * The channel is public (no auth) to keep the kitchen MVP simple.
 * Cleanup runs on unmount to avoid memory leaks / duplicate subscriptions.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { getKitchenOrders, updateOrderStatus } from "@/lib/api";
import type { KitchenOrder, OrderStatus } from "@/types/database";

export function useKitchenOrders(restaurantId: string) {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track IDs of orders that just arrived so we can highlight them
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<
    ReturnType<typeof getSupabaseClient>["channel"]
  > | null>(null);

  // ── Initial fetch ──────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await getKitchenOrders(restaurantId);
    setOrders(data);
    setLoading(false);
  }, [restaurantId]);

  // ── Status update (called by action buttons) ───────────────────────
  const advanceStatus = useCallback(
    async (orderId: string, newStatus: OrderStatus) => {
      // Optimistic update — patch state immediately so UI feels instant
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );

      const ok = await updateOrderStatus(orderId, newStatus);
      if (!ok) {
        // Roll back on failure
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? { ...o, status: getPreviousStatus(newStatus) }
              : o
          )
        );
      }
    },
    []
  );

  // ── Initial data fetch ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    
    async function loadInitialData() {
      setLoading(true);
      setError(null);
      const data = await getKitchenOrders(restaurantId);
      if (!cancelled) {
        setOrders(data);
        setLoading(false);
      }
    }
    
    loadInitialData();
    
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  // ── Real-time subscription ─────────────────────────────────────────
  useEffect(() => {
    const supabase = getSupabaseClient();

    if ((channelRef.current as { state?: string } | null)?.state === "subscribed") return;

    const channel = supabase.channel(`kitchen:${restaurantId}`);
    channelRef.current = channel;

    // Statuses the kitchen board displays
    const KITCHEN_STATUSES: OrderStatus[] = ["pending", "confirmed", "preparing", "ready"];

    // Fetch a single order and add/update it in state (used for INSERT and
    // UPDATE-into-view cases like pending_waiter → confirmed)
    async function fetchAndUpsertOrder(orderId: string, markNew = false) {
      await new Promise((r) => setTimeout(r, 300)); // let order_items commit
      const fresh = await getKitchenOrders(restaurantId);
      const order = fresh.find((o) => o.id === orderId);
      if (!order) return;
      setOrders((prev) => {
        const idx = prev.findIndex((o) => o.id === orderId);
        if (idx === -1) return [order, ...prev];
        const next = [...prev];
        next[idx] = order;
        return next;
      });
      if (markNew) {
        setNewOrderIds((prev) => new Set(prev).add(orderId));
        setTimeout(() => {
          setNewOrderIds((prev) => { const s = new Set(prev); s.delete(orderId); return s; });
        }, 4000);
      }
    }

    // Method 1: Broadcast from DB trigger
    channel.on(
      "broadcast",
      { event: "order_changed" },
      async (payload: { payload: BroadcastPayload }) => {
        const msg = payload.payload;

        if (msg.event === "INSERT") {
          fetchAndUpsertOrder(msg.id, true);
        } else if (msg.event === "UPDATE") {
          const newStatus = msg.status as OrderStatus;
          setOrders((prev) => {
            const exists = prev.some((o) => o.id === msg.id);
            if (exists) {
              // Order already on board — patch status in-place
              // If status is no longer kitchen-relevant, remove it
              if (!KITCHEN_STATUSES.includes(newStatus)) {
                return prev.filter((o) => o.id !== msg.id);
              }
              return prev.map((o) => o.id === msg.id ? { ...o, status: newStatus } : o);
            } else if (KITCHEN_STATUSES.includes(newStatus)) {
              // Order wasn't on board yet (e.g. pending_waiter → confirmed)
              // Fetch it so we get full data with items
              fetchAndUpsertOrder(msg.id, true);
            }
            return prev;
          });
        }
      }
    );

    // Method 2: Postgres Changes (fallback — works even without the trigger)
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      async (payload) => {
        if (payload.eventType === "INSERT") {
          fetchAndUpsertOrder((payload.new as any).id, true);
        } else if (payload.eventType === "UPDATE") {
          const u = payload.new as any;
          const newStatus = u.status as OrderStatus;
          setOrders((prev) => {
            const exists = prev.some((o) => o.id === u.id);
            if (exists) {
              if (!KITCHEN_STATUSES.includes(newStatus)) {
                return prev.filter((o) => o.id !== u.id);
              }
              return prev.map((o) => o.id === u.id ? { ...o, status: newStatus } : o);
            } else if (KITCHEN_STATUSES.includes(newStatus)) {
              fetchAndUpsertOrder(u.id, true);
            }
            return prev;
          });
        }
      }
    );

    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        setError("Real-time connection lost. Retrying…");
      } else if (status === "SUBSCRIBED") {
        setError(null);
      }
    });

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [restaurantId]);

  return { orders, loading, error, advanceStatus, newOrderIds, refetch: fetchOrders };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type BroadcastPayload = {
  event: string;
  id: string;
  restaurant_id: string;
  table_id: string;
  status: string;
  created_at: string;
};

/** Returns the status one step before the given one (for rollback). */
function getPreviousStatus(status: OrderStatus): OrderStatus {
  const flow: OrderStatus[] = ["pending", "confirmed", "preparing", "ready"];
  const idx = flow.indexOf(status);
  return idx > 0 ? flow[idx - 1] : "pending";
}
