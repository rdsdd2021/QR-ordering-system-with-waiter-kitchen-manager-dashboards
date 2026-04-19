"use client";

/**
 * useRealtimeMenu
 *
 * Real-time hook for customer menu page.
 * Subscribes to menu changes and updates the menu items in real-time.
 */

import { useEffect, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase";

type MenuChangePayload = {
  event: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  name?: string;
  price?: number;
  is_available?: boolean;
};

type Props = {
  restaurantId: string;
  onMenuChange: (payload: MenuChangePayload) => void;
};

export function useRealtimeMenu({ restaurantId, onMenuChange }: Props) {
  const channelRef = useRef<ReturnType<
    ReturnType<typeof getSupabaseClient>["channel"]
  > | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();

    // Prevent duplicate subscriptions
    if ((channelRef.current as { state?: string } | null)?.state === "subscribed") return;

    const channel = supabase.channel(`customer:${restaurantId}`);
    channelRef.current = channel;

    channel
      .on(
        "broadcast",
        { event: "menu_changed" },
        (payload: { payload: MenuChangePayload }) => {
          onMenuChange(payload.payload);
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [restaurantId, onMenuChange]);
}
