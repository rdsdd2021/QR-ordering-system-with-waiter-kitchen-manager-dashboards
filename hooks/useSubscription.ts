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

  async function startUpgrade(returnUrl: string, couponCode?: string) {
    if (!restaurantId) return;
    const res = await fetch("/api/phonepe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, returnUrl, plan: "pro", couponCode }),
    });
    const { url, error } = await res.json();
    if (error) { alert(error); return; }
    window.location.href = url;
  }

  return { subscription, loading, plan, isPro, limits, startUpgrade };
}
