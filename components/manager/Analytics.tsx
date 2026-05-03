"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { getPerformanceMetrics, getRestaurantReviews } from "@/lib/api";
import {
  Loader2, TrendingUp, TrendingDown, ShoppingCart, Clock,
  ChefHat, Zap, CreditCard, RefreshCw,
  ArrowUpRight, ArrowDownRight, Banknote, Smartphone, Receipt,
  BarChart3, Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReviewWithItem } from "@/types/database";

type Props = { restaurantId: string };

// ── Types ─────────────────────────────────────────────────────────────────────

type DailySales = { total_orders: number; total_sales: number };
type TopItem = { item_name: string; image_url: string | null; total_quantity: number; total_revenue: number };
type Metrics = { avgPrepSeconds: number | null; avgServeSeconds: number | null; avgTurnaroundSeconds: number | null; orderCount: number };
type DayRevenue = { day: string; orders: number; revenue: number };
type WaiterStat = { waiter_name: string; orders_handled: number; revenue_generated: number };
type PaymentSplit = { payment_method: string | null; count: number; revenue: number };
type OrderStatusCount = { status: string; count: number };
type HourlyBucket = { hour: number; orders: number; revenue: number };

type Range = "today" | "7d" | "30d";

// ── Helpers (defined outside component — never recreated on render) ───────────

function fmtSecs(s: number | null) {
  if (s === null) return "—";
  // Cap at 99 minutes — anything beyond is bad seed data
  if (s > 99 * 60) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m === 0 ? `${sec}s` : `${m}m ${sec}s`;
}

function fmtINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function pctChange(curr: number, prev: number) {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

// Dummy food images by keyword
const FOOD_IMAGES: Record<string, string> = {
  pizza:   "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=64&h=64&fit=crop",
  burger:  "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=64&h=64&fit=crop",
  cake:    "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=64&h=64&fit=crop",
  chai:    "https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=64&h=64&fit=crop",
  salad:   "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=64&h=64&fit=crop",
  pasta:   "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=64&h=64&fit=crop",
  coffee:  "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=64&h=64&fit=crop",
  default: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=64&h=64&fit=crop",
};

function getFoodImage(name: string, imageUrl: string | null): string {
  if (imageUrl) return imageUrl;
  const lower = name.toLowerCase();
  for (const [key, url] of Object.entries(FOOD_IMAGES)) {
    if (lower.includes(key)) return url;
  }
  return FOOD_IMAGES.default;
}

// Generate bar data — only real days, no dummy fill
function buildBarData(real: DayRevenue[], range: Range): { label: string; revenue: number; orders: number }[] {
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const today = new Date();
  const dateList = Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    return d.toISOString().split("T")[0];
  });
  const realMap = new Map(real.map((r) => [r.day, r]));
  return dateList.map((day) => {
    const r = realMap.get(day);
    return {
      label:   fmtDate(day),
      revenue: r ? Number(r.revenue) : 0,
      orders:  r ? Number(r.orders)  : 0,
    };
  });
}

function KpiCard({
  label, value, sub, icon: Icon, iconBg, delta, accent,
}: {
  label: string; value: string; sub: string;
  icon: React.ElementType; iconBg: string;
  delta?: number | null; accent?: boolean;
}) {
  const up = delta !== null && delta !== undefined && delta >= 0;
  return (
    <div className={cn(
      "rounded-lg border p-5 space-y-3 transition-colors",
      accent ? "bg-primary text-primary-foreground border-primary" : "bg-card"
    )}>
      <div className="flex items-center justify-between">
        <p className={cn("text-xs font-semibold uppercase tracking-wider",
          accent ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {label}
        </p>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", iconBg)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div>
        <p className={cn("text-2xl font-bold tabular-nums tracking-tight",
          accent ? "text-primary-foreground" : "text-foreground")}>{value}</p>
        <div className="flex items-center gap-2 mt-1">
          <p className={cn("text-xs", accent ? "text-primary-foreground/60" : "text-muted-foreground")}>{sub}</p>
          {delta !== null && delta !== undefined && (
            <span className={cn(
              "flex items-center gap-0.5 text-[11px] font-semibold rounded-full px-1.5 py-0.5",
              up ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
            )}>
              {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      {action && (
        <button onClick={onAction} className="text-xs font-medium text-primary hover:underline">{action}</button>
      )}
    </div>
  );
}

// ── Chart components ─────────────────────────────────────────────────────────

// Revenue bar chart with hover tooltip
function RevenueChart({ data }: {
  data: { label: string; revenue: number; orders: number }[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const BAR_H = 96;
  const max = Math.max(...data.map(d => d.revenue), 1);
  const hasAny = data.some(d => d.revenue > 0);
  const hov = hovered !== null ? data[hovered] : null;

  if (!hasAny) return (
    <div className="flex h-28 items-center justify-center rounded-lg border border-dashed">
      <p className="text-sm text-muted-foreground">No revenue in this period</p>
    </div>
  );

  return (
    <div className="w-full select-none">
      {/* Tooltip row */}
      <div className="h-7 flex items-center mb-2">
        {hov && hov.revenue > 0 ? (
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold">{hov.label}</span>
            <span className="text-sm font-bold text-primary">{fmtINR(hov.revenue)}</span>
            <span className="text-xs text-muted-foreground">{hov.orders} order{hov.orders !== 1 ? "s" : ""}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/40">Hover a bar for details</span>
        )}
      </div>
      {/* Bars — full-height hover zones */}
      <div className="flex items-end gap-1 w-full" style={{ height: BAR_H }}>
        {data.map((d, i) => {
          const barH = d.revenue > 0 ? Math.max(Math.round((d.revenue / max) * BAR_H), 4) : 2;
          const isHov = hovered === i;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col justify-end cursor-default"
              style={{ height: BAR_H }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className={cn(
                  "w-full rounded-t-sm transition-colors duration-100",
                  d.revenue > 0
                    ? isHov ? "bg-primary" : "bg-primary/55"
                    : "bg-border/25"
                )}
                style={{ height: barH }}
              />
            </div>
          );
        })}
      </div>
      {/* X-axis labels */}
      <div className="flex mt-1.5">
        {data.map((d, i) => {
          const step = Math.max(1, Math.floor(data.length / 7));
          const show = i % step === 0 || i === data.length - 1;
          return (
            <span key={i} className={cn(
              "flex-1 text-[10px] text-center transition-colors",
              hovered === i ? "text-primary font-semibold" : "text-muted-foreground",
              !show && hovered !== i && "invisible"
            )}>
              {d.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// Hourly traffic bar chart with hover tooltip
function HourlyChart({ data }: { data: HourlyBucket[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const BAR_H = 80;
  const hasAny = data.some(d => d.orders > 0);

  if (!hasAny) return (
    <div className="flex h-24 items-center justify-center rounded-lg border border-dashed">
      <p className="text-sm text-muted-foreground">No order data in this period</p>
    </div>
  );

  const max = Math.max(...data.map(d => d.orders), 1);
  const peakHour = data.reduce((a, b) => b.orders > a.orders ? b : a, data[0]);
  const hov = hovered !== null ? data.find(d => d.hour === hovered) ?? null : null;

  return (
    <div className="w-full select-none">
      {/* Tooltip row */}
      <div className="h-7 flex items-center mb-2">
        {hov && hov.orders > 0 ? (
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold">
              {String(hov.hour).padStart(2, "0")}:00 – {String(hov.hour + 1).padStart(2, "0")}:00
            </span>
            <span className="text-sm font-bold text-primary">{hov.orders} order{hov.orders !== 1 ? "s" : ""}</span>
            {hov.hour === peakHour.hour && (
              <span className="text-[11px] font-semibold text-orange-500 bg-orange-500/10 rounded px-1.5 py-0.5">Peak</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/40">Hover a bar for details</span>
        )}
      </div>
      {/* Bars — full-height hover zones */}
      <div className="flex items-end gap-px w-full" style={{ height: BAR_H }}>
        {data.map((d) => {
          const barH = d.orders > 0 ? Math.max(Math.round((d.orders / max) * BAR_H), 3) : 2;
          const isPeak = d.hour === peakHour.hour && d.orders > 0;
          const isHov = hovered === d.hour;
          const intensity = d.orders / max;
          return (
            <div
              key={d.hour}
              className="flex-1 flex flex-col justify-end cursor-default"
              style={{ height: BAR_H }}
              onMouseEnter={() => setHovered(d.hour)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className={cn(
                  "w-full rounded-t-sm transition-colors duration-100",
                  d.orders === 0 ? "bg-border/15"
                  : isPeak ? (isHov ? "bg-orange-400" : "bg-orange-500")
                  : isHov ? "bg-primary"
                  : intensity > 0.6 ? "bg-primary/75"
                  : intensity > 0.3 ? "bg-primary/50"
                  : "bg-primary/30"
                )}
                style={{ height: barH }}
              />
            </div>
          );
        })}
      </div>
      {/* X-axis */}
      <div className="flex justify-between mt-1.5">
        {[0, 4, 8, 12, 16, 20, 23].map(h => (
          <span key={h} className={cn(
            "text-[10px] transition-colors",
            hovered === h ? "text-primary font-semibold" : "text-muted-foreground"
          )}>{h}:00</span>
        ))}
      </div>
    </div>
  );
}

// Donut chart (SVG)
function DonutChart({ segments, centerLabel }: { segments: { label: string; value: number; color: string }[]; centerLabel?: string }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let cumulative = 0;
  const r = 40; const cx = 50; const cy = 50;
  const paths = segments.map((seg) => {
    const startAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    cumulative += seg.value;
    const endAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = seg.value / total > 0.5 ? 1 : 0;
    return { ...seg, d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z` };
  });
  return (
    <svg viewBox="0 0 100 100" className="w-24 h-24">
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.color} opacity={0.9} />
      ))}
      {/* White hole */}
      <circle cx={cx} cy={cy} r={26} fill="white" className="dark:fill-zinc-900" />
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#111" className="dark:fill-white">
        {centerLabel ?? total}
      </text>
      <text x={cx} y={cy + 9} textAnchor="middle" fontSize="6" fill="#888">orders</text>
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Analytics({ restaurantId }: Props) {
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [range, setRange]             = useState<Range>("7d");
  const [sales, setSales]             = useState<DailySales | null>(null);
  const [prevSales, setPrevSales]     = useState<DailySales | null>(null);
  const [topItems, setTopItems]       = useState<TopItem[]>([]);
  const [metrics, setMetrics]         = useState<Metrics | null>(null);
  const [dailyData, setDailyData]     = useState<DayRevenue[]>([]);
  const [waiters, setWaiters]         = useState<WaiterStat[]>([]);
  const [payments, setPayments]       = useState<PaymentSplit[]>([]);
  const [statusCounts, setStatusCounts] = useState<OrderStatusCount[]>([]);
  const [hourly, setHourly]             = useState<HourlyBucket[]>([]);
  const [reviews, setReviews]           = useState<ReviewWithItem[]>([]);

  // Debounce ref — prevents firing a new load while one is already in-flight
  // when the user rapidly switches range tabs.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll the parent overflow container to top when Analytics mounts
  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const rangeStart = new Date();
      rangeStart.setDate(rangeStart.getDate() - (range === "today" ? 0 : range === "7d" ? 6 : 29));
      const rangeStartStr = rangeStart.toISOString().split("T")[0];

      const prevStart = new Date(rangeStart);
      prevStart.setDate(prevStart.getDate() - (range === "today" ? 1 : range === "7d" ? 7 : 30));
      const prevEnd = new Date(rangeStart);
      prevEnd.setDate(prevEnd.getDate() - 1);

      // Single RPC call replaces 9 separate queries — all aggregation happens in Postgres
      const [summaryResult, metricsData, reviewsData] = await Promise.all([
        supabase.rpc("get_analytics_summary", {
          p_restaurant_id: restaurantId,
          p_range_start:   rangeStartStr,
          p_range_end:     today,
          p_prev_start:    prevStart.toISOString().split("T")[0],
          p_prev_end:      prevEnd.toISOString().split("T")[0],
        }),
        getPerformanceMetrics(restaurantId),
        getRestaurantReviews(restaurantId, 20),
      ]);

      if (summaryResult.error) {
        console.error("[Analytics] RPC error:", summaryResult.error);
        return;
      }

      const s = summaryResult.data as {
        curr_sales:    { total_orders: number; total_sales: number };
        prev_sales:    { total_orders: number; total_sales: number };
        top_items:     Array<{ item_name: string; image_url: string | null; total_quantity: number; total_revenue: number }> | null;
        daily_data:    Array<{ day: string; orders: number; revenue: number }> | null;
        waiter_stats:  Array<{ waiter_name: string; orders_handled: number; revenue_generated: number }> | null;
        payment_split: Array<{ payment_method: string | null; count: number; revenue: number }> | null;
        status_counts: Array<{ status: string; count: number }> | null;
        hourly_traffic:Array<{ hour: number; orders: number }> | null;
      };

      setSales(s.curr_sales ?? { total_orders: 0, total_sales: 0 });
      setPrevSales(s.prev_sales ?? { total_orders: 0, total_sales: 0 });
      setTopItems(s.top_items ?? []);
      setDailyData(s.daily_data ?? []);
      setWaiters(s.waiter_stats ?? []);
      setPayments(s.payment_split ?? []);
      setStatusCounts(s.status_counts ?? []);
      setMetrics(metricsData);
      setReviews(reviewsData);

      // Build full 24-hour array from sparse hourly data
      const hMap = new Map((s.hourly_traffic ?? []).map((h) => [h.hour, h.orders]));
      setHourly(
        Array.from({ length: 24 }, (_, hour) => ({
          hour,
          orders:  hMap.get(hour) ?? 0,
          revenue: 0,
        }))
      );

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId, range]);

  // Debounce range changes by 300 ms so rapid tab switching doesn't fire multiple requests
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { load(); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [load]);

  // Derived values — all hooks must be called before any early return
  const totalRevenue  = sales?.total_sales ?? 0;
  const totalOrders   = sales?.total_orders ?? 0;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const revDelta      = pctChange(totalRevenue, prevSales?.total_sales ?? 0);
  const ordDelta      = pctChange(totalOrders,  prevSales?.total_orders ?? 0);
  const aovDelta      = pctChange(avgOrderValue, prevSales?.total_orders ? (prevSales.total_sales / prevSales.total_orders) : 0);
  const barData       = useMemo(() => buildBarData(dailyData, range), [dailyData, range]);
  const maxItem       = topItems[0]?.total_quantity || 1;

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  const paymentColors: Record<string, string> = {
    cash: "#22c55e", upi: "#6366f1", card: "#f59e0b", null: "#94a3b8",
  };
  const statusColors: Record<string, string> = {
    pending: "#f59e0b", pending_waiter: "#a855f7", confirmed: "#3b82f6",
    preparing: "#f97316", ready: "#22c55e", served: "#94a3b8",
  };
  const statusLabels: Record<string, string> = {
    pending: "New Order", pending_waiter: "Awaiting Waiter",
    confirmed: "Confirmed", preparing: "Preparing",
    ready: "Ready", served: "Served",
  };

  const totalStatusCount = statusCounts.reduce((s, c) => s + c.count, 0) || 1;
  const paymentTotal     = payments.reduce((s, p) => s + p.count, 0) || 1;

  return (
    <div className="space-y-5 pb-10">

      {/* ── Range + Refresh ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <BarChart3 className="h-3.5 w-3.5" />
          <span>
            {range === "today" ? "Today's data" : range === "7d" ? "Last 7 days" : "Last 30 days"}
            {refreshing && <span className="ml-2 text-primary animate-pulse">· Updating…</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs font-medium">
            {(["today", "7d", "30d"] as Range[]).map((r) => (
              <button key={r} onClick={() => setRange(r)}
                className={cn("px-3 py-1.5 transition-colors",
                  range === r ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted")}>
                {r === "today" ? "Today" : r === "7d" ? "7 Days" : "30 Days"}
              </button>
            ))}
          </div>
          <button onClick={() => load(true)} disabled={refreshing}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Revenue" value={fmtINR(totalRevenue)}
          sub={`${totalOrders} billed orders`} icon={TrendingUp}
          iconBg="bg-primary/10 text-primary" delta={revDelta} accent />
        <KpiCard label="Total Orders" value={String(totalOrders)}
          sub="Completed & billed" icon={ShoppingCart}
          iconBg="bg-blue-100 text-blue-600" delta={ordDelta} />
        <KpiCard label="Avg. Order Value" value={fmtINR(avgOrderValue)}
          sub="Per billed order" icon={Receipt}
          iconBg="bg-amber-100 text-amber-600" delta={aovDelta} />
        <KpiCard label="Avg. Turnaround"
          value={fmtSecs(metrics?.avgTurnaroundSeconds ?? null)}
          sub={metrics?.orderCount ? `${metrics.orderCount} orders tracked` : "No data yet"}
          icon={Clock} iconBg="bg-purple-100 text-purple-600" />
      </div>

      {/* ── Revenue chart + Order status ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Revenue bar chart */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Revenue Overview</p>
              <p className="text-2xl font-bold tabular-nums mt-0.5">{fmtINR(totalRevenue)}</p>
              {revDelta !== null && (
                <span className={cn(
                  "inline-flex items-center gap-0.5 text-[11px] font-semibold rounded-full px-2 py-0.5 mt-1",
                  revDelta >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                )}>
                  {revDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(revDelta).toFixed(1)}% vs prev period
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground self-start mt-1">
              {range === "today" ? "Today" : range === "7d" ? "Last 7 days" : "Last 30 days"}
            </p>
          </div>
          <RevenueChart data={barData} />
        </div>

        {/* Order status donut */}
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Order Status</p>
          {statusCounts.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
              <p className="text-sm text-muted-foreground">No orders in this period</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <DonutChart
                centerLabel={String(totalStatusCount)}
                segments={statusCounts.map((s) => ({
                  label: statusLabels[s.status] ?? s.status,
                  value: s.count,
                  color: statusColors[s.status] ?? "#94a3b8",
                }))}
              />
              <div className="w-full space-y-2">
                {statusCounts.map((s) => (
                  <div key={s.status} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ background: statusColors[s.status] ?? "#94a3b8" }} />
                      <span className="text-xs text-muted-foreground truncate">
                        {statusLabels[s.status] ?? s.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-semibold tabular-nums">{s.count}</span>
                      <span className="text-[10px] text-muted-foreground w-8 text-right">
                        {((s.count / totalStatusCount) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Top items + Payment split ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Top selling items */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-5">
          <SectionHeader title="Top Selling Items" />
          {topItems.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed">
              <p className="text-sm text-muted-foreground">No sales data in this period</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topItems.map((item, i) => {
                const pct = Math.round((item.total_quantity / maxItem) * 100);
                const rankColors = ["text-amber-500", "text-slate-400", "text-orange-400"];
                return (
                  <div key={i} className="flex items-center gap-3 group">
                    <span className={cn("text-sm font-bold w-5 text-center shrink-0",
                      rankColors[i] ?? "text-muted-foreground/40")}>{i + 1}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={getFoodImage(item.item_name, item.image_url)} alt={item.item_name}
                      className="h-10 w-10 rounded-lg object-cover shrink-0 ring-1 ring-border" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className="text-sm font-semibold truncate">{item.item_name}</p>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-muted-foreground tabular-nums">{item.total_quantity} sold</span>
                          <span className="text-sm font-bold tabular-nums text-foreground">{fmtINR(item.total_revenue)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary/70 transition-all duration-700"
                          style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Payment split */}
        <div className="rounded-lg border bg-card p-5">
          <SectionHeader title="Payment Methods" />
          {payments.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
              <p className="text-sm text-muted-foreground">No billed orders in this period</p>
            </div>
          ) : (
            <>
              <div className="flex justify-center mb-5">
                <DonutChart
                  centerLabel={String(paymentTotal)}
                  segments={payments.map((p) => ({
                    label: p.payment_method ?? "Cash",
                    value: p.count,
                    color: paymentColors[p.payment_method ?? "null"] ?? "#94a3b8",
                  }))}
                />
              </div>
              <div className="space-y-3">
                {payments.map((p) => {
                  const method = p.payment_method ?? "cash";
                  const Icon = method === "upi" ? Smartphone : method === "card" ? CreditCard : Banknote;
                  return (
                    <div key={method} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: (paymentColors[method] ?? "#94a3b8") + "20" }}>
                          <Icon className="h-4 w-4" style={{ color: paymentColors[method] ?? "#94a3b8" }} />
                        </div>
                        <div>
                          <p className="text-xs font-semibold capitalize">{method}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {((p.count / paymentTotal) * 100).toFixed(0)}% · {p.count} orders
                          </p>
                        </div>
                      </div>
                      <p className="text-sm font-bold tabular-nums">{fmtINR(p.revenue)}</p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Timing cards + Hourly chart ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Timing */}
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avg. Timing</p>
          {[
            { label: "Kitchen Prep", value: fmtSecs(metrics?.avgPrepSeconds ?? null), sub: "Confirmed → Ready", icon: ChefHat, color: "bg-orange-100 text-orange-600" },
            { label: "Serve Time",   value: fmtSecs(metrics?.avgServeSeconds ?? null), sub: "Ready → Served",    icon: Zap,    color: "bg-green-100 text-green-600" },
            { label: "Turnaround",   value: fmtSecs(metrics?.avgTurnaroundSeconds ?? null), sub: "Order → Served", icon: Clock, color: "bg-purple-100 text-purple-600" },
          ].map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="flex items-center gap-3">
              <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", color)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="text-sm font-bold">{value}</p>
              </div>
              <p className="text-[10px] text-muted-foreground text-right leading-tight">{sub}</p>
            </div>
          ))}
          <div className="pt-2 border-t border-border">
            <p className="text-[11px] text-muted-foreground text-center">
              {(metrics?.orderCount ?? 0) > 0
                ? `Based on ${metrics!.orderCount} tracked orders`
                : "Estimates shown · tracking starts with new orders"}
            </p>
          </div>
        </div>

        {/* Hourly traffic */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hourly Traffic</p>
              {hourly.some(d => d.orders > 0) && (() => {
                const peak = hourly.reduce((a, b) => b.orders > a.orders ? b : a, hourly[0]);
                const total = hourly.reduce((s, d) => s + d.orders, 0);
                return (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {total} orders · peak at <span className="font-semibold text-orange-500">{peak.hour}:00</span>
                  </p>
                );
              })()}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-orange-500 inline-block" /> Peak</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary inline-block" /> High</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary/25 inline-block" /> Low</span>
            </div>
          </div>
          <HourlyChart data={hourly} />
        </div>
      </div>

      {/* ── Waiter performance ─────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-5">
        <SectionHeader title="Staff Performance" />
        {waiters.length === 0 ? (
          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">No waiter data in this period</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {waiters.map((w, i) => {
              const maxOrders = waiters[0]?.orders_handled || 1;
              const pct = Math.round((w.orders_handled / maxOrders) * 100);
              const initials = w.waiter_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
              const avatarColors = ["bg-blue-500", "bg-purple-500", "bg-green-500", "bg-amber-500", "bg-rose-500"];
              const avgRev = w.orders_handled > 0 ? w.revenue_generated / w.orders_handled : 0;
              return (
                <div key={i} className="rounded-lg border border-border p-4 space-y-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-center gap-3">
                    <div className={cn("h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0", avatarColors[i % avatarColors.length])}>
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{w.waiter_name}</p>
                      <p className="text-[11px] text-muted-foreground">Waiter · avg {fmtINR(avgRev)}/order</p>
                    </div>
                    {i === 0 && (
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 shrink-0">
                        <Star className="h-3 w-3 fill-amber-500 text-amber-500" /> Top
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Orders handled</span>
                      <span className="font-bold">{w.orders_handled}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary/60 transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Revenue generated</span>
                      <span className="font-bold">{fmtINR(w.revenue_generated)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Customer reviews ───────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-5">
        <SectionHeader title="Recent Customer Reviews" />
        {reviews.length === 0 ? (
          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">No reviews yet — they appear here after customers rate their orders</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Summary row */}
            {(() => {
              const total = reviews.length;
              const avg = reviews.reduce((s, r) => s + r.rating, 0) / total;
              const dist = [5, 4, 3, 2, 1].map((star) => ({
                star,
                count: reviews.filter((r) => r.rating === star).length,
              }));
              return (
                <div className="flex items-center gap-6 pb-4 border-b">
                  {/* Big average */}
                  <div className="text-center shrink-0">
                    <p className="text-4xl font-bold tabular-nums">{avg.toFixed(1)}</p>
                    <div className="flex items-center justify-center gap-0.5 mt-1">
                      {[1,2,3,4,5].map((s) => (
                        <Star key={s} className={cn("h-3.5 w-3.5", s <= Math.round(avg) ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/30")} />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{total} review{total !== 1 ? "s" : ""}</p>
                  </div>
                  {/* Distribution bars */}
                  <div className="flex-1 space-y-1.5">
                    {dist.map(({ star, count }) => {
                      const pct = total > 0 ? (count / total) * 100 : 0;
                      return (
                        <div key={star} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-3 text-right shrink-0">{star}</span>
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-amber-400 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-4 tabular-nums shrink-0">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Individual reviews */}
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {reviews.map((r) => (
                <div key={r.id} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                    {[1,2,3,4,5].map((s) => (
                      <Star key={s} className={cn("h-3 w-3", s <= r.rating ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/20")} />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{r.item_name}</p>
                    {r.comment && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.comment}</p>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                    {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}



