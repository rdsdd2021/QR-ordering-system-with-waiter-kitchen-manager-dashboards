"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import {
  Users, Search, RefreshCw, Loader2, TrendingUp,
  Phone, ShoppingBag, Star, ArrowUpDown,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = { restaurantId: string };

type Customer = {
  phone: string;
  name: string;
  visit_count: number;
  first_seen_at: string;
  last_seen_at: string;
  total_spend: number;
  avg_order_value: number;
  order_count: number;
  top_item_name: string | null;
  days_since_last: number;
};

type SortKey = "last_seen_at" | "visit_count" | "total_spend" | "avg_order_value" | "days_since_last";
type SortDir = "asc" | "desc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(n: number) {
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtRelative(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function StatCard({
  label, value, sub, icon: Icon, iconBg,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; iconBg: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", iconBg)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SortButton({
  label, sortKey, current, dir, onSort,
}: {
  label: string; sortKey: SortKey;
  current: SortKey; dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={cn(
        "flex items-center gap-1 text-xs font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      {active
        ? dir === "desc"
          ? <ChevronDown className="h-3 w-3" />
          : <ChevronUp className="h-3 w-3" />
        : <ArrowUpDown className="h-3 w-3 opacity-40" />
      }
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CustomersManager({ restaurantId }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]       = useState("");
  const [sortKey, setSortKey]     = useState<SortKey>("last_seen_at");
  const [sortDir, setSortDir]     = useState<SortDir>("desc");
  const [expanded, setExpanded]   = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const { data, error } = await supabase.rpc("get_customer_list", {
      p_restaurant_id: restaurantId,
    });

    if (!error && data) {
      setCustomers(data as Customer[]);
    }
    setLoading(false);
    setRefreshing(false);
  }, [restaurantId]);

  useEffect(() => { load(); }, [load]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? customers.filter(
          (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)
        )
      : customers;

    return [...list].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === "last_seen_at") {
        av = new Date(a.last_seen_at).getTime();
        bv = new Date(b.last_seen_at).getTime();
      } else {
        av = Number(a[sortKey]);
        bv = Number(b[sortKey]);
      }
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [customers, search, sortKey, sortDir]);

  // ── Summary stats ─────────────────────────────────────────────────
  const totalCustomers  = customers.length;
  const totalRevenue    = customers.reduce((s, c) => s + Number(c.total_spend), 0);
  const totalOrders     = customers.reduce((s, c) => s + Number(c.order_count), 0);
  const avgOrderValue   = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const repeatCustomers = customers.filter((c) => c.visit_count > 1).length;
  const repeatRate      = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">

      {/* ── Summary cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total Customers"
          value={totalCustomers.toLocaleString("en-IN")}
          sub="unique phone numbers"
          icon={Users}
          iconBg="bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400"
        />
        <StatCard
          label="Repeat Rate"
          value={`${repeatRate.toFixed(0)}%`}
          sub={`${repeatCustomers} returning`}
          icon={TrendingUp}
          iconBg="bg-green-100 dark:bg-green-950/50 text-green-600 dark:text-green-400"
        />
        <StatCard
          label="Total Revenue"
          value={fmtINR(totalRevenue)}
          sub="from billed orders"
          icon={ShoppingBag}
          iconBg="bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400"
        />
        <StatCard
          label="Avg Order Value"
          value={fmtINR(avgOrderValue)}
          sub="per customer"
          icon={Star}
          iconBg="bg-purple-100 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400"
        />
      </div>

      {/* ── Toolbar ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </button>
        <p className="text-xs text-muted-foreground ml-auto hidden sm:block">
          {filtered.length} of {totalCustomers} customers
        </p>
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="font-medium text-sm">
            {search ? "No customers match your search" : "No customers yet"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {search ? "Try a different name or phone number" : "Customers appear here after their first billed order"}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {/* Header row */}
          <div className="hidden md:grid grid-cols-[1fr_80px_100px_110px_110px_100px] gap-4 px-4 py-2.5 bg-muted/40 border-b text-xs">
            <span className="font-medium text-muted-foreground">Customer</span>
            <SortButton label="Visits"    sortKey="visit_count"     current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortButton label="Spend"     sortKey="total_spend"     current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortButton label="Avg Order" sortKey="avg_order_value" current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortButton label="Last Seen" sortKey="last_seen_at"    current={sortKey} dir={sortDir} onSort={handleSort} />
            <span className="font-medium text-muted-foreground">Top Item</span>
          </div>

          {/* Rows */}
          <div className="divide-y">
            {filtered.map((c) => {
              const isExpanded = expanded === c.phone;
              return (
                <div key={c.phone}>
                  {/* Main row */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : c.phone)}
                    className="w-full text-left"
                  >
                    {/* Mobile layout */}
                    <div className="md:hidden px-4 py-3 space-y-1 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">{c.name}</p>
                        <span className={cn(
                          "text-[11px] font-medium px-2 py-0.5 rounded-full",
                          c.visit_count > 3
                            ? "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-400"
                            : c.visit_count > 1
                            ? "bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400"
                            : "bg-muted text-muted-foreground"
                        )}>
                          {c.visit_count} visit{c.visit_count !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>
                        <span>{fmtINR(c.total_spend)} total</span>
                        <span>{fmtRelative(c.days_since_last)}</span>
                      </div>
                    </div>

                    {/* Desktop layout */}
                    <div className="hidden md:grid grid-cols-[1fr_80px_100px_110px_110px_100px] gap-4 px-4 py-3 hover:bg-muted/30 transition-colors items-center">
                      {/* Name + phone */}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Phone className="h-3 w-3 shrink-0" />
                          {c.phone}
                        </p>
                      </div>
                      {/* Visits */}
                      <div>
                        <span className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded-full",
                          c.visit_count > 3
                            ? "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-400"
                            : c.visit_count > 1
                            ? "bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400"
                            : "bg-muted text-muted-foreground"
                        )}>
                          {c.visit_count}×
                        </span>
                      </div>
                      {/* Total spend */}
                      <p className="text-sm font-semibold tabular-nums">{fmtINR(c.total_spend)}</p>
                      {/* Avg order */}
                      <p className="text-sm tabular-nums text-muted-foreground">{fmtINR(c.avg_order_value)}</p>
                      {/* Last seen */}
                      <div>
                        <p className="text-xs font-medium">{fmtRelative(c.days_since_last)}</p>
                        <p className="text-[11px] text-muted-foreground">{fmtDate(c.last_seen_at)}</p>
                      </div>
                      {/* Top item */}
                      <p className="text-xs text-muted-foreground truncate">
                        {c.top_item_name ?? "—"}
                      </p>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 py-3 bg-muted/20 border-t grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div>
                        <p className="text-muted-foreground mb-0.5">First visit</p>
                        <p className="font-medium">{fmtDate(c.first_seen_at)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-0.5">Orders placed</p>
                        <p className="font-medium">{c.order_count}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-0.5">Avg order value</p>
                        <p className="font-medium">{fmtINR(c.avg_order_value)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-0.5">Favourite item</p>
                        <p className="font-medium">{c.top_item_name ?? "—"}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
