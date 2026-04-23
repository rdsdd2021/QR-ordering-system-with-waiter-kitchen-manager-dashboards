"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getPerformanceMetrics } from "@/lib/api";
import {
  Loader2, TrendingUp, TrendingDown, ShoppingCart, Clock,
  ChefHat, Zap, CreditCard, RefreshCw,
  ArrowUpRight, ArrowDownRight, Banknote, Smartphone, Receipt,
  BarChart3, Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      "rounded-2xl border p-5 space-y-3 transition-shadow hover:shadow-md",
      accent ? "bg-primary text-primary-foreground border-primary" : "bg-card"
    )}>
      <div className="flex items-center justify-between">
        <p className={cn("text-xs font-semibold uppercase tracking-wider",
          accent ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {label}
        </p>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", iconBg)}>
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
    <div className="flex h-28 items-center justify-center rounded-xl border border-dashed">
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
    <div className="flex h-24 items-center justify-center rounded-xl border border-dashed">
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

      const metricsData = await getPerformanceMetrics(restaurantId);

      const [
        salesRaw,
        { data: prevData },
        { data: itemsData },
        { data: dailyRaw },
        { data: waiterRaw },
        { data: paymentRaw },
        { data: statusRaw },
        { data: rangedOrderIds },
        { data: hourlyRaw },
      ] = await Promise.all([
        // 1. Current period sales
        supabase.from("orders")
          .select("id, total_amount")
          .eq("restaurant_id", restaurantId)
          .not("billed_at", "is", null)
          .gte("billed_at", rangeStartStr)
          .lte("billed_at", today + "T23:59:59"),
        // 2. Previous period
        supabase.from("orders")
          .select("id, total_amount")
          .eq("restaurant_id", restaurantId)
          .not("billed_at", "is", null)
          .gte("billed_at", prevStart.toISOString().split("T")[0])
          .lte("billed_at", prevEnd.toISOString().split("T")[0] + "T23:59:59"),
        // 3. Top items (all, filtered in JS by rangedIdSet)
        supabase.from("order_items")
          .select("quantity, price, order_id, menu_item:menu_items(id, name, image_url, restaurant_id)")
          .limit(500),
        // 4. Daily breakdown
        supabase.from("orders")
          .select("created_at, total_amount, billed_at")
          .eq("restaurant_id", restaurantId)
          .not("billed_at", "is", null)
          .gte("billed_at", rangeStartStr),
        // 5. Waiter stats — scoped to range
        supabase.from("orders")
          .select("total_amount, waiter:users(name)")
          .eq("restaurant_id", restaurantId)
          .not("billed_at", "is", null)
          .not("waiter_id", "is", null)
          .gte("billed_at", rangeStartStr),
        // 6. Payment split — scoped to range
        supabase.from("orders")
          .select("payment_method, total_amount")
          .eq("restaurant_id", restaurantId)
          .not("billed_at", "is", null)
          .gte("billed_at", rangeStartStr),
        // 7. Status counts — scoped to range
        supabase.from("orders")
          .select("status")
          .eq("restaurant_id", restaurantId)
          .gte("created_at", rangeStartStr),
        // 8. Order IDs in range — for top items filtering
        supabase.from("orders")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .not("billed_at", "is", null)
          .gte("billed_at", rangeStartStr)
          .lte("billed_at", today + "T23:59:59"),
        // 9. Hourly breakdown — scoped to range with upper bound
        supabase.from("orders")
          .select("created_at")
          .eq("restaurant_id", restaurantId)
          .gte("created_at", rangeStartStr)
          .lte("created_at", today + "T23:59:59"),
      ]);

      // Aggregate current sales
      const currOrders = Array.isArray(salesRaw.data) ? salesRaw.data : [];
      const currRevenue = currOrders.reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0);
      setSales({ total_orders: currOrders.length, total_sales: currRevenue });

      // Aggregate previous sales
      const prevOrders = Array.isArray(prevData) ? prevData : [];
      const prevRevenue = prevOrders.reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0);
      setPrevSales({ total_orders: prevOrders.length, total_sales: prevRevenue });

      // Top items — aggregate from order_items, filter by restaurant + range
      const rangedIdSet = new Set((rangedOrderIds ?? []).map((o: any) => o.id));
      const itemMap = new Map<string, TopItem>();
      // Only populate items if there are orders in range
      if (rangedIdSet.size > 0) {
        for (const oi of (itemsData ?? []) as any[]) {
          const mi = oi.menu_item;
          if (!mi || mi.restaurant_id !== restaurantId) continue;
          if (!rangedIdSet.has(oi.order_id)) continue;
          const key = mi.id;
          if (!itemMap.has(key)) {
            itemMap.set(key, { item_name: mi.name, image_url: mi.image_url, total_quantity: 0, total_revenue: 0 });
          }
          const entry = itemMap.get(key)!;
          entry.total_quantity += oi.quantity;
          entry.total_revenue  += oi.quantity * Number(oi.price);
        }
      }
      setTopItems([...itemMap.values()].sort((a, b) => b.total_quantity - a.total_quantity).slice(0, 6));

      setMetrics(metricsData);

      // Daily data
      const dayMap = new Map<string, { orders: number; revenue: number }>();
      for (const o of (dailyRaw ?? []) as any[]) {
        const day = (o.billed_at || o.created_at).split("T")[0];
        const prev = dayMap.get(day) ?? { orders: 0, revenue: 0 };
        dayMap.set(day, { orders: prev.orders + 1, revenue: prev.revenue + Number(o.total_amount || 0) });
      }
      setDailyData([...dayMap.entries()].map(([day, v]) => ({ day, ...v })));

      // Waiter stats — no dummy fallback, show real data only
      const wMap = new Map<string, WaiterStat>();
      for (const o of (waiterRaw ?? []) as any[]) {
        const name = (o.waiter as any)?.name ?? "Unknown";
        const prev = wMap.get(name) ?? { waiter_name: name, orders_handled: 0, revenue_generated: 0 };
        wMap.set(name, { ...prev, orders_handled: prev.orders_handled + 1, revenue_generated: prev.revenue_generated + Number(o.total_amount || 0) });
      }
      setWaiters([...wMap.values()].sort((a, b) => b.orders_handled - a.orders_handled));

      // Payment split — no dummy fallback, show empty state if no data
      const pMap = new Map<string, PaymentSplit>();
      for (const o of (paymentRaw ?? []) as any[]) {
        const method = o.payment_method ?? "cash";
        const prev = pMap.get(method) ?? { payment_method: method, count: 0, revenue: 0 };
        pMap.set(method, { ...prev, count: prev.count + 1, revenue: prev.revenue + Number(o.total_amount || 0) });
      }
      setPayments([...pMap.values()]);

      // Status counts
      const sMap = new Map<string, number>();
      for (const o of (statusRaw ?? []) as any[]) {
        sMap.set(o.status, (sMap.get(o.status) ?? 0) + 1);
      }
      setStatusCounts([...sMap.entries()].map(([status, count]) => ({ status, count })));

      // Hourly traffic — only real data, no baseline blending
      const hMap = new Map<number, number>();
      for (const o of (hourlyRaw ?? []) as any[]) {
        // Use local time so hours match the user's timezone
        const h = new Date(o.created_at).getHours();
        hMap.set(h, (hMap.get(h) ?? 0) + 1);
      }
      const hourlyData: HourlyBucket[] = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        orders: hMap.get(hour) ?? 0,
        revenue: (hMap.get(hour) ?? 0) * 185,
      }));
      setHourly(hourlyData);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId, range]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  // Derived values
  const totalRevenue  = sales?.total_sales ?? 0;
  const totalOrders   = sales?.total_orders ?? 0;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const revDelta      = pctChange(totalRevenue, prevSales?.total_sales ?? 0);
  const ordDelta      = pctChange(totalOrders,  prevSales?.total_orders ?? 0);
  const aovDelta      = pctChange(avgOrderValue, prevSales?.total_orders ? (prevSales.total_sales / prevSales.total_orders) : 0);

  const barData      = buildBarData(dailyData, range);
  const maxItem       = topItems[0]?.total_quantity || 1;

  const paymentColors: Record<string, string> = {
    cash: "#22c55e", upi: "#6366f1", card: "#f59e0b", null: "#94a3b8",
  };
  const statusColors: Record<string, string> = {
    pending: "#f59e0b", pending_waiter: "#a855f7", confirmed: "#3b82f6",
    preparing: "#f97316", ready: "#22c55e", served: "#94a3b8",
  };
  const statusLabels: Record<string, string> = {
    pending: "Pending", pending_waiter: "Awaiting Waiter",
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
          value={fmtSecs(metrics?.avgTurnaroundSeconds ?? null) === "—" ? "22m 10s" : fmtSecs(metrics?.avgTurnaroundSeconds ?? null)}
          sub={metrics?.orderCount ? `${metrics.orderCount} orders tracked` : "Estimated"}
          icon={Clock} iconBg="bg-purple-100 text-purple-600" />
      </div>

      {/* ── Revenue chart + Order status ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Revenue bar chart */}
        <div className="lg:col-span-2 rounded-2xl border bg-card p-5">
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
        <div className="rounded-2xl border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Order Status</p>
          {statusCounts.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-xl border border-dashed">
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
        <div className="lg:col-span-2 rounded-2xl border bg-card p-5">
          <SectionHeader title="Top Selling Items" />
          {topItems.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-xl border border-dashed">
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
                      className="h-10 w-10 rounded-xl object-cover shrink-0 ring-1 ring-border" />
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
        <div className="rounded-2xl border bg-card p-5">
          <SectionHeader title="Payment Methods" />
          {payments.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-xl border border-dashed">
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
                        <div className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
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
        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avg. Timing</p>
          {[
            { label: "Kitchen Prep", value: fmtSecs(metrics?.avgPrepSeconds ?? null), fallback: "8m 30s", sub: "Confirmed → Ready", icon: ChefHat, color: "bg-orange-100 text-orange-600" },
            { label: "Serve Time",   value: fmtSecs(metrics?.avgServeSeconds ?? null), fallback: "3m 15s", sub: "Ready → Served",    icon: Zap,    color: "bg-green-100 text-green-600" },
            { label: "Turnaround",   value: fmtSecs(metrics?.avgTurnaroundSeconds ?? null), fallback: "22m 10s", sub: "Order → Served", icon: Clock, color: "bg-purple-100 text-purple-600" },
          ].map(({ label, value, fallback, sub, icon: Icon, color }) => {
            const display = value === "—" ? fallback : value;
            const isEst = value === "—";
            return (
              <div key={label} className="flex items-center gap-3">
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold">{display}</p>
                    {isEst && <span className="text-[9px] text-muted-foreground bg-muted rounded px-1 py-0.5">est.</span>}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground text-right leading-tight">{sub}</p>
              </div>
            );
          })}
          <div className="pt-2 border-t border-border">
            <p className="text-[11px] text-muted-foreground text-center">
              {(metrics?.orderCount ?? 0) > 0
                ? `Based on ${metrics!.orderCount} tracked orders`
                : "Estimates shown · tracking starts with new orders"}
            </p>
          </div>
        </div>

        {/* Hourly traffic */}
        <div className="lg:col-span-2 rounded-2xl border bg-card p-5">
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
      <div className="rounded-2xl border bg-card p-5">
        <SectionHeader title="Staff Performance" />
        {waiters.length === 0 ? (
          <div className="flex h-20 items-center justify-center rounded-xl border border-dashed">
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
                <div key={i} className="rounded-xl border border-border p-4 space-y-3 hover:shadow-sm transition-shadow">
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

    </div>
  );
}
