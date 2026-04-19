"use client";

/**
 * useManagerRealtime
 *
 * Comprehensive real-time hook for manager dashboard.
 * Subscribes to all changes in the restaurant:
 * - Orders
 * - Menu items
 * - Tables
 * - Floors
 * - Staff/Users
 * - Restaurant settings
 */

import { useEffect, useRef, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase";

type OrderChangePayload = {
  event: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  restaurant_id: string;
  table_id: string;
  status: string;
  waiter_id: string | null;
  total_amount: number;
  created_at: string;
};

type MenuChangePayload = {
  event: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  restaurant_id: string;
  name: string;
  price: number;
  is_available: boolean;
};

type TableChangePayload = {
  event: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  restaurant_id: string;
  table_number: number;
  floor_id: string | null;
  capacity: number | null;
};

type FloorChangePayload = {
  event: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  restaurant_id: string;
  name: string;
  display_order: number;
};

type UserChangePayload = {
  event: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  restaurant_id: string;
  name: string;
  role: string;
  email: string | null;
};

type RestaurantChangePayload = {
  event: "UPDATE";
  id: string;
  name: string;
  order_routing_mode: string;
};

type Props = {
  restaurantId: string;
  onOrderChange?: (payload: OrderChangePayload) => void;
  onMenuChange?: (payload: MenuChangePayload) => void;
  onTableChange?: (payload: TableChangePayload) => void;
  onFloorChange?: (payload: FloorChangePayload) => void;
  onUserChange?: (payload: UserChangePayload) => void;
  onRestaurantChange?: (payload: RestaurantChangePayload) => void;
};

export function useManagerRealtime({
  restaurantId,
  onOrderChange,
  onMenuChange,
  onTableChange,
  onFloorChange,
  onUserChange,
  onRestaurantChange,
}: Props) {
  const channelRef = useRef<ReturnType<
    ReturnType<typeof getSupabaseClient>["channel"]
  > | null>(null);

  // Memoize callbacks to prevent unnecessary re-subscriptions
  const handleOrderChange = useCallback(
    (payload: { payload: OrderChangePayload }) => {
      onOrderChange?.(payload.payload);
    },
    [onOrderChange]
  );

  const handleMenuChange = useCallback(
    (payload: { payload: MenuChangePayload }) => {
      onMenuChange?.(payload.payload);
    },
    [onMenuChange]
  );

  const handleTableChange = useCallback(
    (payload: { payload: TableChangePayload }) => {
      onTableChange?.(payload.payload);
    },
    [onTableChange]
  );

  const handleFloorChange = useCallback(
    (payload: { payload: FloorChangePayload }) => {
      onFloorChange?.(payload.payload);
    },
    [onFloorChange]
  );

  const handleUserChange = useCallback(
    (payload: { payload: UserChangePayload }) => {
      onUserChange?.(payload.payload);
    },
    [onUserChange]
  );

  const handleRestaurantChange = useCallback(
    (payload: { payload: RestaurantChangePayload }) => {
      onRestaurantChange?.(payload.payload);
    },
    [onRestaurantChange]
  );

  useEffect(() => {
    const supabase = getSupabaseClient();

    // Prevent duplicate subscriptions
    if ((channelRef.current as { state?: string } | null)?.state === "subscribed") return;

    const channel = supabase.channel(`manager:${restaurantId}`);
    channelRef.current = channel;

    // Subscribe to all event types
    if (onOrderChange) {
      channel.on("broadcast", { event: "order_changed" }, handleOrderChange);
    }
    if (onMenuChange) {
      channel.on("broadcast", { event: "menu_changed" }, handleMenuChange);
    }
    if (onTableChange) {
      channel.on("broadcast", { event: "table_changed" }, handleTableChange);
    }
    if (onFloorChange) {
      channel.on("broadcast", { event: "floor_changed" }, handleFloorChange);
    }
    if (onUserChange) {
      channel.on("broadcast", { event: "user_changed" }, handleUserChange);
    }
    if (onRestaurantChange) {
      channel.on("broadcast", { event: "restaurant_changed" }, handleRestaurantChange);
    }

    channel.subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [
    restaurantId,
    handleOrderChange,
    handleMenuChange,
    handleTableChange,
    handleFloorChange,
    handleUserChange,
    handleRestaurantChange,
  ]);
}
