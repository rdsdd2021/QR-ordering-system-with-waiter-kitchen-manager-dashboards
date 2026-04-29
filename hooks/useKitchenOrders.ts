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
  const [isConnected, setIsConnected] = useState(true);
  // Track IDs of orders that just arrived so we can highlight them
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [reconnectKey, setReconnectKey] = useState(0);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof getSupabaseClient>["channel"]
  > | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dedup concurrent fetches for the same order
  const fetchingRef = useRef<Set<string>>(new Set());

  // ── Initial fetch (shows skeleton) ────────────────────────────────
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await getKitchenOrders(restaurantId);
    setOrders(data);
    setLoading(false);
  }, [restaurantId]);

  // ── Silent background refresh (no skeleton flash) ─────────────────
  // Used on reconnect so existing orders stay visible while we sync.
  const refreshOrdersSilently = useCallback(async () => {
    const data = await getKitchenOrders(restaurantId);
    setOrders(data);
  }, [restaurantId]);

  // ── Status update (called by action buttons) ───────────────────────
  const advanceStatus = useCallback(
    async (orderId: string, newStatus: OrderStatus) => {
      // Capture previous status before optimistic update for rollback
      let previousStatus: OrderStatus = getPreviousStatus(newStatus);
      setOrders((prev) => {
        const order = prev.find((o) => o.id === orderId);
        if (order) previousStatus = order.status;
        return prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o));
      });

      const ok = await updateOrderStatus(orderId, newStatus);
      if (!ok) {
        // Roll back on failure using the actual previous status
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId ? { ...o, status: previousStatus } : o
          )
        );
      }
      // On success: real-time subscription will confirm the update.
      // We intentionally do NOT re-apply the status here to avoid a double-render flicker.
    },
    []
  );

  // ── Initial data fetch ─────────────────────────────────────────────
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // ── Real-time subscription ─────────────────────────────────────────
  useEffect(() => {
    const supabase = getSupabaseClient();

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel(`kitchen:${restaurantId}:${reconnectKey}`);
    channelRef.current = channel;

    // Statuses the kitchen board displays
    const KITCHEN_STATUSES: OrderStatus[] = ["pending", "confirmed", "preparing", "ready"];

    // Fetch a single order and add/update it in state (used for INSERT and
    // UPDATE-into-view cases like pending_waiter → confirmed)
    async function fetchAndUpsertOrder(orderId: string, markNew = false) {
      // Deduplicate concurrent fetches for the same order
      if (fetchingRef.current.has(orderId)) return;
      fetchingRef.current.add(orderId);
      try {
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
      } finally {
        fetchingRef.current.delete(orderId);
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
        // Only mark offline after a sustained failure, not a transient blip
        if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = setTimeout(() => setIsConnected(false), 2000);
        setTimeout(() => setReconnectKey((k) => k + 1), 3000);
      } else if (status === "SUBSCRIBED") {
        if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
        setIsConnected(true);
        setError(null);
        // Silently sync data on (re)connect — no skeleton flash
        refreshOrdersSilently();
      } else if (status === "CLOSED") {
        // CLOSED fires during normal reconnect cycles — wait before showing offline
        if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = setTimeout(() => setIsConnected(false), 2000);
        setTimeout(() => setReconnectKey((k) => k + 1), 1000);
      }
    });

    return () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [restaurantId, reconnectKey, refreshOrdersSilently]);

  return { orders, loading, error, isConnected, advanceStatus, newOrderIds, refetch: fetchOrders };
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
