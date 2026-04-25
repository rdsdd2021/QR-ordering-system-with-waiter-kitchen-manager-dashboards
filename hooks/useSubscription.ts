"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Plan = "free" | "pro";

export type Subscription = {
  plan: Plan;
  status: string;
  current_period_end: string | null;
  phonepe_transaction_id: string | null;
};

export type PlanLimits = {
  max_tables: number;
  max_menu_items: number;
  analytics: boolean;
  advanced_features: boolean;
};

const FREE_LIMITS: PlanLimits = {
  max_tables: 5,
  max_menu_items: 20,
  analytics: false,
  advanced_features: false,
};

const PRO_LIMITS: PlanLimits = {
  max_tables: 999,
  max_menu_items: 999,
  analytics: true,
  advanced_features: true,
};

export function useSubscription(restaurantId: string | null) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId) { setLoading(false); return; }

    async function load() {
      const { data } = await supabase
        .from("subscriptions")
        .select("plan, status, current_period_end, phonepe_transaction_id")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();

      setSubscription(data as Subscription ?? { plan: "free", status: "active", current_period_end: null, phonepe_transaction_id: null });
      setLoading(false);
    }

    load();
  }, [restaurantId]);

  const plan: Plan = subscription?.plan ?? "free";
  const isActive = subscription?.status === "active" || subscription?.status === "trialing";
  const isPro = plan === "pro" && isActive;
  const limits: PlanLimits = isPro ? PRO_LIMITS : FREE_LIMITS;

  async function startUpgrade(returnUrl: string, couponCode?: string, billingCycle: "monthly" | "yearly" = "monthly", planOverride?: string) {
    if (!restaurantId) return;
    const planKey = planOverride ?? (billingCycle === "yearly" ? "pro_yearly" : "pro_monthly");

    const callbackUrl = `${window.location.origin}/api/phonepe/popup-callback`;

    const res = await fetch("/api/phonepe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, returnUrl: callbackUrl, plan: planKey, couponCode }),
    });
    const { url, error } = await res.json();
    if (error) { alert(error); return; }

    // Open PhonePe in a narrow mobile-sized popup
    const w = 400, h = 750;
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
    const top  = Math.round(window.screenY + (window.outerHeight - h) / 2);
    const popup = window.open(url, "phonepe_checkout",
      `width=${w},height=${h},left=${left},top=${top},resizable=no,scrollbars=yes`);

    if (!popup) {
      window.location.href = url;
      return;
    }

    // Listen for postMessage from the popup callback page
    async function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "PHONEPE_CALLBACK") return;

      window.removeEventListener("message", handleMessage);
      clearInterval(fallbackPoll);

      const { orderId } = event.data;
      if (!orderId) return;

      // Verify server-side via PhonePe order status API
      await verifyAndUpdate(orderId);
    }

    window.addEventListener("message", handleMessage);

    // Fallback poll — if popup closes without postMessage (user closed manually)
    const fallbackPoll = setInterval(async () => {
      if (!popup.closed) return;
      clearInterval(fallbackPoll);
      window.removeEventListener("message", handleMessage);

      // Re-fetch subscription — webhook may have fired
      const { data } = await supabase
        .from("subscriptions")
        .select("plan, status, current_period_end, phonepe_transaction_id")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (data) setSubscription(data as Subscription);
    }, 1500);

    async function verifyAndUpdate(orderId: string) {
      try {
        const vRes = await fetch("/api/phonepe/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchantOrderId: orderId, restaurantId }),
        });
        const { upgraded } = await vRes.json();
        if (upgraded) {
          // Fetch fresh subscription state
          const { data } = await supabase
            .from("subscriptions")
            .select("plan, status, current_period_end, phonepe_transaction_id")
            .eq("restaurant_id", restaurantId)
            .maybeSingle();
          if (data) setSubscription(data as Subscription);
        }
      } catch (e) {
        console.error("[startUpgrade] verify failed", e);
      }
    }
  }

  return { subscription, loading, plan, isPro, limits, startUpgrade };
}
