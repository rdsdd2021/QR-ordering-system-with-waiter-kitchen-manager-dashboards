"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { 
  getWaiterOrders, 
  assignWaiterToOrder, 
  markOrderServed,
  acceptOrder
} from "@/lib/api";
import type { WaiterOrder } from "@/types/database";

export function useWaiterOrders(restaurantId: string, waiterId: string) {
  const [orders, setOrders] = useState<WaiterOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);
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
    setOrders((prev) =>
      prev.map((o) => o.id === orderId ? { ...o, status: "served" as const } : o)
    );
    const success = await markOrderServed(orderId, wId);
    if (!success) {
      setOrders((prev) =>
        prev.map((o) => o.id === orderId ? { ...o, status: "ready" as const } : o)
      );
    }
  }, []);

  // ── Real-time subscription ─────────────────────────────────────────
  useEffect(() => {
    const supabase = getSupabaseClient();

    // Always tear down and recreate — never reuse stale channels
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`waiter:${restaurantId}`)
      // Broadcast from DB trigger (fires after order_items are inserted)
      .on("broadcast", { event: "order_changed" }, (msg: any) => {
        const p = msg.payload;
        if (!p?.id) return;

        if (p.event === "INSERT") {
          // Fetch the full order with items
          fetchAndUpsertOrder(p.id);
        } else if (p.event === "UPDATE") {
          // Patch status/waiter in-place — items are preserved via spread
          setOrders((prev) =>
            prev.map((o) =>
              o.id === p.id ? { ...o, status: p.status, waiter_id: p.waiter_id } : o
            )
          );
        }
      })
      // Postgres changes as fallback
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        (msg: any) => {
          const row = msg.new ?? msg.old;
          if (!row?.id) return;

          if (msg.eventType === "INSERT") {
            fetchAndUpsertOrder(row.id);
          } else if (msg.eventType === "UPDATE") {
            setOrders((prev) =>
              prev.map((o) =>
                o.id === row.id ? { ...o, status: row.status, waiter_id: row.waiter_id } : o
              )
            );
          }
        }
      )
      .subscribe((status: string) => {
        if (status === "CHANNEL_ERROR") {
          setError("Real-time connection lost. Retrying…");
        } else if (status === "SUBSCRIBED") {
          setError(null);
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [restaurantId, waiterId, fetchAndUpsertOrder]);

  return { 
    orders, 
    loading, 
    error, 
    takeOrder, 
    acceptOrder: acceptOrderAction,
    markServed, 
    refetch: fetchOrders,
  };
}
