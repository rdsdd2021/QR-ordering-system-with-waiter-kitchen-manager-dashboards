"use client";

import { useEffect, useState } from "react";

export type Plan = {
  id: string;
  name: string;
  tagline: string;
  monthly_paise: number;
  yearly_paise: number;
  features: string[];
  unavailable: string[];
  is_active: boolean;
  is_highlighted: boolean;
  cta: "choose" | "contact" | "downgrade_unsupported";
  sort_order: number;
};

let _cache: Plan[] | null = null;
let _promise: Promise<Plan[]> | null = null;

async function fetchPlans(): Promise<Plan[]> {
  if (_cache) return _cache;
  if (!_promise) {
    _promise = fetch("/api/plans").then((r) => r.json()).then((data) => {
      _cache = Array.isArray(data) ? data : [];
      return _cache!;
    });
  }
  return _promise;
}

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>(_cache ?? []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) { setPlans(_cache); setLoading(false); return; }
    fetchPlans().then((p) => { setPlans(p); setLoading(false); });
  }, []);

  return { plans, loading };
}

/** Fetch plans server-side or in API routes (no cache) */
export async function getPlans(): Promise<Plan[]> {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as Plan[];
}
