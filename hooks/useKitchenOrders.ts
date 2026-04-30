"use client";

/**
 * useKitchenOrders
 * ...
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { getKitchenOrders, updateOrderStatus } from "@/lib/api";
import { secureChannel } from "@/lib/channel-token";
import type { KitchenOrder, OrderStatus } from "@/types/database";
import type { NotificationEvent } from "@/hooks/useNotificationSounds";

type NotifyFn = (event: NotificationEvent) => void;

export function useKitchenOrders(restaurantId: string, notify?: NotifyFn) {
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
      // Capture the actual previous status before the optimistic update.
      // We use a ref-captured value to avoid the race condition where two
      // concurrent calls both read the same stale closure value.
      let previousStatus: OrderStatus = "pending";
      setOrders((prev) => {
        const order = prev.find((o) => o.id === orderId);
        if (order) previousStatus = order.status;
        return prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o));
      });

      const ok = await updateOrderStatus(orderId, newStatus);
      if (!ok) {
        // Roll back to the captured previous status
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId ? { ...o, status: previousStatus } : o
          )
        );
      }
    },
    []
  );

  // C1: Kitchen reject — cancel an order from pending or confirmed
  const rejectOrder = useCallback(async (orderId: string) => {
    // Optimistic: remove from board immediately
    let rejectedOrder: KitchenOrder | undefined;
    setOrders((prev) => {
      rejectedOrder = prev.find((o) => o.id === orderId);
      return prev.filter((o) => o.id !== orderId);
    });

    const ok = await updateOrderStatus(orderId, "cancelled");
    if (!ok) {
      // Restore the order on failure
      if (rejectedOrder) {
        setOrders((prev) => [rejectedOrder!, ...prev]);
      }
    }
  }, []);

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

    let cancelled = false;

    async function subscribe() {
      // F5: The broadcast channel name includes a short HMAC token derived from
      // CHANNEL_SECRET so it cannot be guessed by clients that only know the
      // restaurant UUID. The postgres_changes subscription is already auth-gated
      // by RLS and requires a valid session JWT.
      const channelName = await secureChannel("kitchen", restaurantId);
      if (cancelled) return;

      // F5: Only use postgres_changes (auth-gated by RLS), not broadcast (public).
      // The DB trigger broadcasts to `kitchen:{restaurantId}` but we don't subscribe
      // to that channel — we rely solely on postgres_changes which requires a valid
      // JWT and is filtered by RLS policies. This prevents unauthorized clients from
      // subscribing to sensitive order data.
      const channel = supabase.channel(`kitchen:${restaurantId}:${reconnectKey}`);
      channelRef.current = channel;

      // Statuses the kitchen board displays
      const KITCHEN_STATUSES: OrderStatus[] = ["pending", "confirmed", "preparing", "ready"];

      // Fetch a single order and add/update it in state (used for INSERT and
      // UPDATE-into-view cases like pending_waiter → confirmed)
      async function fetchAndUpsertOrder(orderId: string, markNew = false) {
        if (fetchingRef.current.has(orderId)) return;
        fetchingRef.current.add(orderId);
        try {
          await new Promise((r) => setTimeout(r, 300));
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
            notify?.("newOrder");
            setTimeout(() => {
              setNewOrderIds((prev) => { const s = new Set(prev); s.delete(orderId); return s; });
            }, 4000);
          }
        } finally {
          fetchingRef.current.delete(orderId);
        }
      }

      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        async (payload) => {
          if (payload.eventType === "INSERT") {
            fetchAndUpsertOrder((payload.new as any).id, true);
          } else if (payload.eventType === "UPDATE") {
            const u = payload.new as any;
            const newStatus = u.status as OrderStatus;
            setOrders((prev) => {
              const exists = prev.some((o) => o.id === u.id);
              if (exists) {
                if (!KITCHEN_STATUSES.includes(newStatus)) return prev.filter((o) => o.id !== u.id);
                notify?.("orderUpdate");
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
          if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = setTimeout(() => setIsConnected(false), 2000);
          setTimeout(() => setReconnectKey((k) => k + 1), 3000);
        } else if (status === "SUBSCRIBED") {
          if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
          setIsConnected(true);
          setError(null);
          refreshOrdersSilently();
        } else if (status === "CLOSED") {
          if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = setTimeout(() => setIsConnected(false), 2000);
          setTimeout(() => setReconnectKey((k) => k + 1), 1000);
        }
      });
    }

    subscribe();

    return () => {
      cancelled = true;
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [restaurantId, reconnectKey, refreshOrdersSilently, notify]);

  return { orders, loading, error, isConnected, advanceStatus, rejectOrder, newOrderIds, refetch: fetchOrders };
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
