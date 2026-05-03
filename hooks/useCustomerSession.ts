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
  items: Array<{ menu_item_id: string; name: string; quantity: number }>;
};

const SESSION_KEY = (tableId: string) => `customer_session_${tableId}`;

// Use localStorage (not sessionStorage) so the session persists across tabs
// in the same browser. A customer opening the same QR link in a second tab
// should see their existing session, not the "table occupied" screen.
// The session is explicitly cleared when billing completes, so there is no
// stale-data risk.
const storage = {
  get: (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set: (key: string, value: string): void => {
    try { localStorage.setItem(key, value); } catch {}
  },
  remove: (key: string): void => {
    try { localStorage.removeItem(key); } catch {}
  },
};

export function useCustomerSession(restaurantId: string, tableId: string) {
  const [customerInfo, setCustomerInfoState] = useState<CustomerInfo | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);

  // ── Load session from localStorage on mount ───────────────────────
  useEffect(() => {
    try {
      const stored = storage.get(SESSION_KEY(tableId));
      if (stored) setCustomerInfoState(JSON.parse(stored));
    } catch {}
    // Mark session as loaded regardless of whether data was found.
    // This must happen in the same effect so the occupancy check in
    // OrderPageClient always sees the correct customerInfo value.
    setSessionLoaded(true);
  }, [tableId]);

  // ── Save customer info ─────────────────────────────────────────────
  const saveCustomerInfo = useCallback((info: CustomerInfo) => {
    setCustomerInfoState(info);
    storage.set(SESSION_KEY(tableId), JSON.stringify(info));
  }, [tableId]);

  // ── Clear session (called when billing is complete) ────────────────
  const clearSession = useCallback(() => {
    setCustomerInfoState(null);
    storage.remove(SESSION_KEY(tableId));
  }, [tableId]);

  // ── Fetch active orders for this table ─────────────────────────────
  const fetchActiveOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        id, status, created_at, billed_at,
        waiter:users(name),
        order_items(quantity, menu_item_id, menu_item:menu_items(name))
      `)
      .eq("table_id", tableId)
      .is("billed_at", null)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false });

    if (error) { console.error(error); setLoadingOrders(false); return; }

    const orders: ActiveOrder[] = (data ?? []).map((o: any) => ({
      id: o.id,
      status: o.status,
      created_at: o.created_at,
      waiter_name: o.waiter?.name ?? null,
      items: (o.order_items ?? []).map((oi: any) => ({
        menu_item_id: oi.menu_item_id ?? "",
        name: oi.menu_item?.name ?? "Item",
        quantity: oi.quantity,
      })),
    }));

    setActiveOrders(orders);
    setLoadingOrders(false);

    // If all orders are billed (none left), clear the session
    if (orders.length === 0) {
      const stored = storage.get(SESSION_KEY(tableId));
      if (stored) {
        let sessionData: { name: string; phone: string; since?: string } | null = null;
        try { sessionData = JSON.parse(stored); } catch {}

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
              // Remove from active list if billed or cancelled
              if (row.billed_at || row.status === "cancelled") {
                const remaining = prev.filter((o) => o.id !== row.id);
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
    sessionLoaded,
    hasActiveSession: customerInfo !== null,
    refetchOrders: fetchActiveOrders,
  };
}
