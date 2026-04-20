"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getPerformanceMetrics } from "@/lib/api";
import { Loader2, TrendingUp, ShoppingCart, Clock, ChefHat, Zap, Award } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = { restaurantId: string };

type DailySales = { total_orders: number; total_sales: number };
type TopItem    = { item_name: string; total_quantity: number; total_revenue: number };
type Metrics    = { avgPrepSeconds: number | null; avgServeSeconds: number | null; avgTurnaroundSeconds: number | null; orderCount: number };

function fmt(s: number | null) {
  if (s === null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m === 0 ? `${sec}s` : `${m}m ${sec}s`;
}

function StatCard({ label, value, sub, icon: Icon, accent = false }: {
  label: string; value: string; sub: string;
  icon: React.ElementType; accent?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-5 space-y-3",
      accent ? "bg-primary text-primary-foreground border-primary" : "bg-card"
    )}>
      <div className="flex items-center justify-between">
        <p className={cn("text-xs font-medium uppercase tracking-wider", accent ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {label}
        </p>
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent ? "bg-primary-foreground/15" : "bg-muted")}>
          <Icon className={cn("h-4 w-4", accent ? "text-primary-foreground" : "text-muted-foreground")} />
        </div>
      </div>
      <div>
        <p className={cn("text-2xl font-bold tabular-nums tracking-tight", accent ? "text-primary-foreground" : "")}>{value}</p>
        <p className={cn("text-xs mt-0.5", accent ? "text-primary-foreground/60" : "text-muted-foreground")}>{sub}</p>
      </div>
    </div>
  );
}

function TimeCard({ label, value, sub, icon: Icon }: {
  label: string; value: string; sub: string; icon: React.ElementType;
}) {
  const isNA = value === "—";
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className={cn("text-xl font-bold tabular-nums", isNA && "text-muted-foreground text-base font-normal")}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

export default function Analytics({ restaurantId }: Props) {
  const [loading, setLoading]   = useState(true);
  const [sales, setSales]       = useState<DailySales | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [metrics, setMetrics]   = useState<Metrics | null>(null);

  useEffect(() => { load(); }, [restaurantId]);

  async function load() {
    setLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const [{ data: salesData }, { data: itemsData }, metricsData] = await Promise.all([
        supabase.from("daily_sales").select("total_orders, total_sales")
          .eq("restaurant_id", restaurantId).eq("sale_date", today).maybeSingle(),
        supabase.from("top_selling_items").select("item_name, total_quantity, total_revenue")
          .eq("restaurant_id", restaurantId).order("total_quantity", { ascending: false }).limit(5),
        getPerformanceMetrics(restaurantId),
      ]);
      setSales(salesData || { total_orders: 0, total_sales: 0 });
      setTopItems(itemsData || []);
      setMetrics(metricsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );

  const maxQty = topItems[0]?.total_quantity || 1;

  return (
    <div className="space-y-6">

      {/* ── Today's KPIs ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Revenue today"
          value={`₹${(sales?.total_sales || 0).toFixed(0)}`}
          sub={`${sales?.total_orders || 0} orders billed`}
          icon={TrendingUp}
          accent
        />
        <StatCard
          label="Orders today"
          value={String(sales?.total_orders || 0)}
          sub="Completed and billed"
          icon={ShoppingCart}
        />
      </div>

      {/* ── Performance timing ───────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Avg timing · {metrics?.orderCount ? `${metrics.orderCount} orders` : "no data yet"}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <TimeCard
            label="Kitchen prep"
            value={fmt(metrics?.avgPrepSeconds ?? null)}
            sub="Confirmed → Ready"
            icon={ChefHat}
          />
          <TimeCard
            label="Serve time"
            value={fmt(metrics?.avgServeSeconds ?? null)}
            sub="Ready → Served"
            icon={Zap}
          />
          <TimeCard
            label="Turnaround"
            value={fmt(metrics?.avgTurnaroundSeconds ?? null)}
            sub="Order → Served"
            icon={Clock}
          />
        </div>
      </div>

      {/* ── Top items ────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Award className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Top selling items · all time
          </p>
        </div>

        {topItems.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed">
            <p className="text-sm text-muted-foreground">No sales data yet</p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden divide-y">
            {topItems.map((item, i) => {
              const pct = Math.round((item.total_quantity / maxQty) * 100);
              return (
                <div key={i} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xs font-bold text-muted-foreground/50 w-4 shrink-0">
                        {i + 1}
                      </span>
                      <p className="text-sm font-medium truncate">{item.item_name}</p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-right">
                      <span className="text-xs text-muted-foreground tabular-nums">{item.total_quantity} sold</span>
                      <span className="text-sm font-semibold tabular-nums">₹{item.total_revenue.toFixed(0)}</span>
                    </div>
                  </div>
                  {/* Bar */}
                  <div className="h-1 rounded-full bg-muted overflow-hidden ml-6">
                    <div
                      className="h-full rounded-full bg-primary/60 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
