"use client";

/**
 * useRealtimeOrderStatus
 *
 * Real-time hook for customer order status tracking.
 * Subscribes to order changes for a specific table and updates order status in real-time.
 */

import { useEffect, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase";

type OrderStatusPayload = {
  event: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  status: string;
  total_amount?: number;
};

type Props = {
  restaurantId: string;
  tableId: string;
  onOrderStatusChange: (payload: OrderStatusPayload) => void;
};

export function useRealtimeOrderStatus({ 
  restaurantId, 
  tableId, 
  onOrderStatusChange 
}: Props) {
  const channelRef = useRef<ReturnType<
    ReturnType<typeof getSupabaseClient>["channel"]
  > | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();

    // Prevent duplicate subscriptions
    if ((channelRef.current as { state?: string } | null)?.state === "subscribed") return;

    const channel = supabase.channel(`customer:${restaurantId}:${tableId}`);
    channelRef.current = channel;

    channel
      .on(
        "broadcast",
        { event: "order_changed" },
        (payload: { payload: OrderStatusPayload }) => {
          onOrderStatusChange(payload.payload);
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [restaurantId, tableId, onOrderStatusChange]);
}
