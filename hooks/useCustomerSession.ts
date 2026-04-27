"use client";

/**
 * useCustomerSession
 *
 * Manages the customer's identity and active orders for a table session.
 *
 * SESSION LOGIC:
 * - On first order, customer enters name/phone/partySize → saved to sessionStorage
 * - On subsequent orders (same browser tab, same table), info is reused automatically
 * - Session is cleared when all orders at the table are billed (billed_at IS NOT NULL)
 *
 * ACTIVE ORDERS:
 * - Fetches all unbilled orders for this table on mount
 * - Subscribes to real-time updates via postgres_changes
 * - Each order shows its current status with live updates
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getSupabaseClient } from "@/lib/supabase";

export type CustomerInfo = {
  name: string;
  phone: string;
  partySize?: number;
};

export type ActiveOrder = {
  id: string;
  status: string;
  created_at: string;
  waiter_name: string | null;
  items: Array<{ name: string; quantity: number }>;
};

const SESSION_KEY = (tableId: string) => `customer_session_${tableId}`;

export function useCustomerSession(restaurantId: string, tableId: string) {
  const [customerInfo, setCustomerInfoState] = useState<CustomerInfo | null>(null);
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);

  // ── Load session from sessionStorage on mount ──────────────────────
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY(tableId));
      if (stored) setCustomerInfoState(JSON.parse(stored));
    } catch {}
  }, [tableId]);

  // ── Save customer info ─────────────────────────────────────────────
  const saveCustomerInfo = useCallback((info: CustomerInfo) => {
    setCustomerInfoState(info);
    try {
      sessionStorage.setItem(SESSION_KEY(tableId), JSON.stringify(info));
    } catch {}
  }, [tableId]);

  // ── Clear session (called when billing is complete) ────────────────
  const clearSession = useCallback(() => {
    setCustomerInfoState(null);
    try {
      sessionStorage.removeItem(SESSION_KEY(tableId));
    } catch {}
  }, [tableId]);

  // ── Fetch active orders for this table ─────────────────────────────
  const fetchActiveOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        id, status, created_at, billed_at,
        waiter:users(name),
        order_items(quantity, menu_item:menu_items(name))
      `)
      .eq("table_id", tableId)
      .is("billed_at", null)
      .order("created_at", { ascending: false });

    if (error) { console.error(error); setLoadingOrders(false); return; }

    const orders: ActiveOrder[] = (data ?? []).map((o: any) => ({
      id: o.id,
      status: o.status,
      created_at: o.created_at,
      waiter_name: o.waiter?.name ?? null,
      items: (o.order_items ?? []).map((oi: any) => ({
        name: oi.menu_item?.name ?? "Item",
        quantity: oi.quantity,
      })),
    }));

    setActiveOrders(orders);
    setLoadingOrders(false);

    // If all orders are billed (none left), clear the session
    if (orders.length === 0) {
      // Only clear if the customer had a session AND their orders were billed
      // (not just because old sessions from previous customers exist)
      const stored = sessionStorage.getItem(SESSION_KEY(tableId));
      if (stored) {
        let sessionData: { name: string; phone: string; since?: string } | null = null;
        try { sessionData = JSON.parse(stored); } catch {}

        // Check if there are billed orders for THIS customer's phone number
        // scoped to orders placed after the session was created
        const { data: billedCheck } = await supabase
          .from("orders")
          .select("id")
          .eq("table_id", tableId)
          .not("billed_at", "is", null)
          .eq("customer_phone", sessionData?.phone ?? "")
          .limit(1);

        if (billedCheck && billedCheck.length > 0) {
          clearSession();
        }
      }
    }
  }, [tableId, clearSession]);

  useEffect(() => {
    fetchActiveOrders();
  }, [fetchActiveOrders]);

  // ── Real-time subscription ─────────────────────────────────────────
  useEffect(() => {
    const client = getSupabaseClient();

    if (channelRef.current) {
      client.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = client
      .channel(`customer:${restaurantId}:${tableId}`)
      .on("broadcast", { event: "order_changed" }, () => {
        fetchActiveOrders();
      })
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `table_id=eq.${tableId}`,
        },
        (msg: any) => {
          const row = msg.new ?? msg.old;
          if (!row) return;

          if (msg.eventType === "INSERT") {
            // New order — fetch to get items
            fetchActiveOrders();
          } else if (msg.eventType === "UPDATE") {
            // Patch status in-place
            setActiveOrders((prev) => {
              // If billed_at is now set, remove from active list
              if (row.billed_at) {
                const remaining = prev.filter((o) => o.id !== row.id);
                // If no more active orders, check if session should clear
                if (remaining.length === 0) fetchActiveOrders();
                return remaining;
              }
              return prev.map((o) =>
                o.id === row.id ? { ...o, status: row.status } : o
              );
            });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      client.removeChannel(channel);
      channelRef.current = null;
    };
  }, [restaurantId, tableId, fetchActiveOrders]);

  return {
    customerInfo,
    saveCustomerInfo,
    clearSession,
    activeOrders,
    loadingOrders,
    hasActiveSession: customerInfo !== null,
    refetchOrders: fetchActiveOrders,
  };
}
