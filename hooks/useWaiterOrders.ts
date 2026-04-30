"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { 
  getWaiterOrders, 
  assignWaiterToOrder, 
  markOrderServed,
  acceptOrder
} from "@/lib/api";
import { secureChannel } from "@/lib/channel-token";
import type { WaiterOrder, OrderStatus } from "@/types/database";
import type { NotificationEvent } from "@/hooks/useNotificationSounds";

type NotifyFn = (event: NotificationEvent) => void;

export function useWaiterOrders(restaurantId: string, waiterId: string, notify?: NotifyFn) {
  const [orders, setOrders] = useState<WaiterOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks order IDs we've already fetched to avoid duplicate fetches
  const fetchingRef = useRef<Set<string>>(new Set());

  // ── Fetch helpers ──────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await getWaiterOrders(restaurantId, waiterId);
    setOrders(data);
    setLoading(false);
  }, [restaurantId, waiterId]);

  // ── Silent background refresh (no skeleton flash) ─────────────────
  // Used on reconnect so existing orders stay visible while we sync.
  const refreshOrdersSilently = useCallback(async () => {
    const data = await getWaiterOrders(restaurantId, waiterId);
    setOrders(data);
  }, [restaurantId, waiterId]);

  // Fetch a single order by ID and add/update it in state
  const fetchAndUpsertOrder = useCallback(async (orderId: string) => {
    // Deduplicate concurrent fetches for the same order
    if (fetchingRef.current.has(orderId)) return;
    fetchingRef.current.add(orderId);

    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("orders")
        .select(
          `id, restaurant_id, table_id, status, waiter_id, created_at,
           table:tables(table_number, floor:floors(name)),
           waiter:users(name),
           order_items(id, quantity, price, menu_item:menu_items(name))`
        )
        .eq("id", orderId)
        .maybeSingle();

      if (!data) return;

      // Check visibility: skip if this order belongs to another waiter's locked table
      const order = data as unknown as WaiterOrder;
      const isAssignedToMe = order.waiter_id === waiterId;
      const isUnassigned = !order.waiter_id;

      if (!isAssignedToMe && !isUnassigned) return; // belongs to another waiter

      setOrders((prev) => {
        const exists = prev.findIndex((o) => o.id === orderId);
        if (exists === -1) return [order, ...prev];
        const next = [...prev];
        next[exists] = order;
        return next;
      });
    } finally {
      fetchingRef.current.delete(orderId);
    }
  }, [restaurantId, waiterId]);

  // ── Initial load ───────────────────────────────────────────────────
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // ── Waiter actions ─────────────────────────────────────────────────
  const takeOrder = useCallback(async (orderId: string, wId: string) => {
    // Optimistic update
    setOrders((prev) =>
      prev.map((o) => o.id === orderId ? { ...o, waiter_id: wId, waiter: { name: "You" } } : o)
    );
    
    const success = await assignWaiterToOrder(orderId, wId);
    if (!success) {
      // Revert optimistic update
      setOrders((prev) =>
        prev.map((o) => o.id === orderId ? { ...o, waiter_id: null, waiter: null } : o)
      );
      
      // Show user-friendly error message
      setError("Could not take order - it may have been assigned to another waiter");
      setTimeout(() => setError(null), 3000);
    }
  }, []);

  const acceptOrderAction = useCallback(async (orderId: string, wId: string) => {
    // Optimistic update
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? { ...o, waiter_id: wId, waiter: { name: "You" }, status: "confirmed" as const }
          : o
      )
    );
    
    const success = await acceptOrder(orderId, wId);
    if (!success) {
      // Revert optimistic update
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? { ...o, waiter_id: null, waiter: null, status: "pending_waiter" as const }
            : o
        )
      );
      
      // Show user-friendly error message
      setError("Could not accept order - it may have been taken by another waiter");
      setTimeout(() => setError(null), 3000);
    }
  }, []);

  const markServed = useCallback(async (orderId: string, wId: string) => {
    // C5: Pre-check status before optimistic update — avoids a confusing
    // snap-back if the order isn't actually ready to serve.
    const currentOrder = orders.find((o) => o.id === orderId);
    if (!currentOrder) return;
    if (currentOrder.status !== "ready") {
      setError("This order isn't ready to serve yet.");
      setTimeout(() => setError(null), 3000);
      return;
    }

    // Optimistic update — capture previous status for rollback (C3 fix)
    let previousStatus: OrderStatus = currentOrder.status;
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id === orderId) { previousStatus = o.status; return { ...o, status: "served" as const }; }
        return o;
      })
    );

    const success = await markOrderServed(orderId, wId);
    if (!success) {
      setOrders((prev) =>
        prev.map((o) => o.id === orderId ? { ...o, status: previousStatus } : o)
      );
      setError("Could not mark order as served. Please try again.");
      setTimeout(() => setError(null), 4000);
    }
  }, [orders]);

  // ── Real-time subscription ─────────────────────────────────────────
  useEffect(() => {
    const supabase = getSupabaseClient();

    // Always tear down and recreate — never reuse stale channels
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    let cancelled = false;

    async function subscribe() {
      // F5: Only use postgres_changes (auth-gated by RLS), not broadcast (public).
      // postgres_changes requires a valid JWT and is filtered by RLS policies,
      // preventing unauthorized clients from receiving sensitive order data.
      if (cancelled) return;

      const channel = supabase
        .channel(`waiter:${restaurantId}:${reconnectKey}`)
        // F5: postgres_changes is auth-gated by RLS — requires valid JWT
        .on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
          (msg: any) => {
            const row = msg.new ?? msg.old;
            if (!row?.id) return;

            if (msg.eventType === "INSERT") {
              fetchAndUpsertOrder(row.id);
              notify?.("newOrder");
            } else if (msg.eventType === "UPDATE") {
              const assignedToMe = row.waiter_id === waiterId;
              const assignedToOther = row.waiter_id && row.waiter_id !== waiterId;
              const isServed = row.status === "served";
              const isReady = row.status === "ready";

              setOrders((prev) => {
                const exists = prev.some((o) => o.id === row.id);
                if (exists) {
                  if (isServed || assignedToOther) return prev.filter((o) => o.id !== row.id);
                  if (isReady) notify?.("orderReady");
                  else notify?.("orderUpdate");
                  return prev.map((o) =>
                    o.id === row.id ? { ...o, status: row.status, waiter_id: row.waiter_id } : o
                  );
                } else if (assignedToMe) {
                  fetchAndUpsertOrder(row.id);
                  notify?.("newOrder");
                }
                return prev;
              });
            }
          }
        )
      .subscribe((status: string) => {
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

      channelRef.current = channel;
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
  }, [restaurantId, waiterId, fetchAndUpsertOrder, reconnectKey, refreshOrdersSilently, notify]);

  return { 
    orders, 
    loading, 
    error,
    isConnected,
    takeOrder, 
    acceptOrder: acceptOrderAction,
    markServed, 
    refetch: fetchOrders,
  };
}
