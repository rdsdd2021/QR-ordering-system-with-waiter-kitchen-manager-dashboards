"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, RefreshCw, Search, Filter, Download,
  X, User, Phone, TrendingUp, ShoppingBag, AlertCircle,
  Receipt, CheckCircle2, XCircle, Calendar, ChevronDown,
} from "lucide-react";
import { supabase, getSupabaseClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// Fire-and-forget audit log via /api/audit
async function logAudit(
  action: string,
  resourceType: string,
  resourceId?: string | null,
  resourceName?: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, resource_type: resourceType, resource_id: resourceId, resource_name: resourceName, metadata }),
    });
  } catch { /* non-blocking */ }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

type DateSegment = "today" | "yesterday" | "week" | "month" | "custom";

function startOfDay(d: Date) {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function endOfDay(d: Date) {
  const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
}
function getSegmentRange(seg: DateSegment, customFrom: string, customTo: string): [Date, Date] {
  const now = new Date();
  if (seg === "today")     return [startOfDay(now), endOfDay(now)];
  if (seg === "yesterday") { const y = new Date(now); y.setDate(y.getDate() - 1); return [startOfDay(y), endOfDay(y)]; }
  if (seg === "week")      { const w = new Date(now); w.setDate(w.getDate() - 6); return [startOfDay(w), endOfDay(now)]; }
  if (seg === "month")     { const m = new Date(now); m.setDate(m.getDate() - 29); return [startOfDay(m), endOfDay(now)]; }
  // custom
  const from = customFrom ? startOfDay(new Date(customFrom)) : startOfDay(new Date(0));
  const to   = customTo   ? endOfDay(new Date(customTo))     : endOfDay(now);
  return [from, to];
}
function fmtDate(d: Date) {
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

type Props = { restaurantId: string };

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderLogRow = {
  id: string;
  status: string;
  table_number: number;
  floor_name: string | null;
  capacity: number | null;
  waiter_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  item_count: number;
  total_qty: number;
  order_total: number;
  total_amount: number;
  billed_at: string | null;
  created_at: string;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  wait_to_confirm_s: number | null;
  prep_time_s: number | null;
  serve_time_s: number | null;
  turnaround_s: number | null;
  items: Array<{ id: string; name: string; quantity: number; price: number }>;
};

type SortKey = "created_at" | "table_number" | "turnaround_s" | "order_total";
type SortDir = "asc" | "desc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtAgo(iso: string | null) {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}
function dur(seconds: number | null) {
  if (seconds === null || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
function orderId(id: string) {
  return `#ORD-${id.slice(0, 4).toUpperCase()}`;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  pending:        "bg-amber-50 text-amber-600 border border-amber-200",
  pending_waiter: "bg-purple-50 text-purple-600 border border-purple-200",
  confirmed:      "bg-blue-50 text-blue-600 border border-blue-200",
  preparing:      "bg-orange-50 text-orange-600 border border-orange-200",
  ready:          "bg-green-50 text-green-600 border border-green-200",
  served:         "bg-blue-50 text-blue-600 border border-blue-200",
  cancelled:      "bg-red-50 text-red-500 border border-red-200",
};
const STATUS_DOT: Record<string, string> = {
  pending:        "bg-amber-500",
  pending_waiter: "bg-purple-500",
  confirmed:      "bg-blue-500",
  preparing:      "bg-orange-500",
  ready:          "bg-green-500",
  served:         "bg-blue-500",
  cancelled:      "bg-red-500",
};
const STATUS_LABEL: Record<string, string> = {
  pending:        "New Order",
  pending_waiter: "Awaiting Waiter",
  confirmed:      "Confirmed",
  preparing:      "Preparing",
  ready:          "Ready",
  served:         "Served",
  cancelled:      "Cancelled",
};

// Next valid status for "Mark as Ready" / advance action
const NEXT_STATUS: Record<string, string> = {
  pending:        "confirmed",
  pending_waiter: "confirmed",
  confirmed:      "preparing",
  preparing:      "ready",
  ready:          "served",
};
const NEXT_LABEL: Record<string, string> = {
  pending:        "Confirm Order",
  pending_waiter: "Confirm Order",
  confirmed:      "Start Preparing",
  preparing:      "Mark as Ready",
  ready:          "Mark as Served",
};

const TABS = [
  { key: "all",           label: "All Orders"  },
  { key: "preparing",     label: "Preparing"   },
  { key: "ready",         label: "Ready"       },
  { key: "served",        label: "Served"      },
  { key: "cancelled",     label: "Cancelled"   },
];

const PAGE_SIZE = 10;

const DATE_SEGMENTS: { key: DateSegment; label: string }[] = [
  { key: "today",     label: "Today"     },
  { key: "yesterday", label: "Yesterday" },
  { key: "week",      label: "Last 7 days" },
  { key: "month",     label: "Last 30 days" },
  { key: "custom",    label: "Custom"    },
];

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(rows: OrderLogRow[], label: string) {
  const headers = ["Order ID","Status","Table","Floor","Customer","Phone","Item Details","Total Qty","Amount","Created At","Turnaround"];
  const lines = rows.map(r => [
    orderId(r.id), r.status,
    r.table_number ? `Table ${r.table_number}` : "—",
    r.floor_name ?? "—",
    r.customer_name ?? "—",
    r.customer_phone ?? "—",
    r.items.map(i => `${i.name} x${i.quantity}`).join("; "),
    r.total_qty,
    r.order_total,
    new Date(r.created_at).toLocaleString(),
    r.turnaround_s !== null ? `${Math.round(r.turnaround_s / 60)}m` : "—",
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `orders-${label}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OrderLog({ restaurantId }: Props) {
  const [rows,          setRows]          = useState<OrderLogRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [sortKey,       setSortKey]       = useState<SortKey>("created_at");
  const [sortDir,       setSortDir]       = useState<SortDir>("desc");
  const [selectedOrder, setSelectedOrder] = useState<OrderLogRow | null>(null);
  const [page,          setPage]          = useState(1);

  // ── Date segment state ─────────────────────────────────────────────────────
  const [dateSegment,   setDateSegment]   = useState<DateSegment>("today");
  const [customFrom,    setCustomFrom]    = useState(toInputDate(new Date()));
  const [customTo,      setCustomTo]      = useState(toInputDate(new Date()));
  const [showCustom,    setShowCustom]    = useState(false);
  const [showFilters,   setShowFilters]   = useState(false);
  const customRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);
  const loadRef    = useRef<() => Promise<void>>(undefined);
  // Refs so load() always reads the latest date range without needing to be in deps
  const dateSegmentRef = useRef(dateSegment);
  const customFromRef  = useRef(customFrom);
  const customToRef    = useRef(customTo);
  useEffect(() => { dateSegmentRef.current = dateSegment; }, [dateSegment]);
  useEffect(() => { customFromRef.current  = customFrom;  }, [customFrom]);
  useEffect(() => { customToRef.current    = customTo;    }, [customTo]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (customRef.current && !customRef.current.contains(e.target as Node)) setShowCustom(false);
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilters(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function load() {
    if (rows.length === 0) setLoading(true); else setRefreshing(true);
    const [rangeFrom, rangeTo] = getSegmentRange(dateSegmentRef.current, customFromRef.current, customToRef.current);
    const { data, error } = await supabase
      .from("orders")
      .select(`
        id, status, created_at, confirmed_at, preparing_at, ready_at, served_at,
        billed_at, total_amount, customer_name, customer_phone,
        table:tables(table_number, capacity, floor:floors(name)),
        waiter:users(name),
        order_items(id, quantity, price, menu_item:menu_items(name))
      `)
      .eq("restaurant_id", restaurantId)
      .gte("created_at", rangeFrom.toISOString())
      .lte("created_at", rangeTo.toISOString())
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) { setLoading(false); setRefreshing(false); return; }

    const mapped: OrderLogRow[] = (data ?? []).map((o: any) => {
      const ts  = (f: string | null) => f ? new Date(f).getTime() : null;
      const sec = (a: number | null, b: number | null) =>
        a !== null && b !== null ? Math.round((b - a) / 1000) : null;
      const created   = ts(o.created_at);
      const confirmed = ts(o.confirmed_at);
      const ready     = ts(o.ready_at);
      const served    = ts(o.served_at);
      const items = (o.order_items ?? []).map((oi: any) => ({
        id: oi.id, name: oi.menu_item?.name ?? "Item",
        quantity: oi.quantity, price: parseFloat(oi.price),
      }));
      const order_total = items.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
      return {
        id: o.id, status: o.status,
        table_number: o.table?.table_number ?? 0,
        floor_name: o.table?.floor?.name ?? null,
        capacity: o.table?.capacity ?? null,
        waiter_name: o.waiter?.name ?? null,
        customer_name: o.customer_name ?? null,
        customer_phone: o.customer_phone ?? null,
        item_count: items.length,
        total_qty: items.reduce((s: number, i: any) => s + i.quantity, 0),
        order_total, total_amount: parseFloat(o.total_amount) || order_total,
        billed_at: o.billed_at, created_at: o.created_at,
        confirmed_at: o.confirmed_at, preparing_at: o.preparing_at,
        ready_at: o.ready_at, served_at: o.served_at,
        wait_to_confirm_s: sec(created, confirmed),
        prep_time_s: sec(confirmed, ready),
        serve_time_s: sec(ready, served),
        turnaround_s: sec(created, served),
        items,
      };
    });
    setRows(mapped);
    setLoading(false);
    setRefreshing(false);
  }

  loadRef.current = load;
  useEffect(() => { loadRef.current?.(); }, [restaurantId]);
  // Re-fetch when date range changes (server-side filtering)
  useEffect(() => { setPage(1); loadRef.current?.(); }, [dateSegment, customFrom, customTo]);

  useEffect(() => {
    const client = getSupabaseClient();
    if (channelRef.current) { client.removeChannel(channelRef.current); channelRef.current = null; }
    const ch = client
      .channel(`orderlog:${restaurantId}`)
      .on("postgres_changes" as any,
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        (msg: any) => {
          if (msg.eventType === "INSERT") loadRef.current?.();
          else if (msg.eventType === "UPDATE" && msg.new?.id)
            setRows(prev => prev.map(r => r.id === msg.new.id ? {
              ...r,
              status: msg.new.status ?? r.status,
              billed_at: msg.new.billed_at ?? r.billed_at,
              total_amount: msg.new.total_amount ?? r.total_amount,
              confirmed_at: msg.new.confirmed_at ?? r.confirmed_at,
              preparing_at: msg.new.preparing_at ?? r.preparing_at,
              ready_at: msg.new.ready_at ?? r.ready_at,
              served_at: msg.new.served_at ?? r.served_at,
            } : r));
        })
      .subscribe();
    channelRef.current = ch;
    return () => { client.removeChannel(ch); channelRef.current = null; };
  }, [restaurantId]);

  useEffect(() => {
    if (!selectedOrder) return;
    const updated = rows.find(r => r.id === selectedOrder.id);
    if (updated) setSelectedOrder(updated);
  }, [rows]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  // Server already filters by date range, so rows === rangeRows
  const rangeRows     = rows; // alias kept for JSX references below
  const totalRevenue  = rows.reduce((s, r) => s + r.order_total, 0);
  const avgOrderValue = rows.length ? totalRevenue / rows.length : 0;
  const pendingCount  = rows.filter(r =>
    ["pending","pending_waiter","confirmed","preparing","ready"].includes(r.status)
  ).length;

  // ── Filter + sort ──────────────────────────────────────────────────────────
  const filtered = rows
    .filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          r.id.toLowerCase().includes(q) ||
          orderId(r.id).toLowerCase().includes(q) ||
          String(r.table_number).includes(q) ||
          (r.customer_name?.toLowerCase().includes(q) ?? false) ||
          (r.customer_phone?.includes(q) ?? false) ||
          (r.waiter_name?.toLowerCase().includes(q) ?? false) ||
          (r.floor_name?.toLowerCase().includes(q) ?? false) ||
          r.items.some(i => i.name.toLowerCase().includes(q))
        );
      }
      return true;
    })
    .sort((a, b) => {
      let av: any = a[sortKey], bv: any = b[sortKey];
      if (av === null) av = sortDir === "asc" ? Infinity : -Infinity;
      if (bv === null) bv = sortDir === "asc" ? Infinity : -Infinity;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
    setPage(1);
  }

  function SortArrow({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="opacity-20 ml-0.5 text-[10px]">↕</span>;
    return <span className="ml-0.5 text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="space-y-4">

      {/* ── Date segment bar ───────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {DATE_SEGMENTS.map(({ key, label }) => (
          key === "custom" ? (
            <div key="custom" className="relative" ref={customRef}>
              <button
                onClick={() => { setDateSegment("custom"); setShowCustom(v => !v); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  dateSegment === "custom"
                    ? "bg-primary text-white border-primary"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Calendar className="h-3.5 w-3.5" />
                {dateSegment === "custom"
                  ? `${fmtDate(new Date(customFrom))} – ${fmtDate(new Date(customTo))}`
                  : "Custom"}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showCustom && (
                <div className="absolute top-full left-0 mt-1.5 z-30 bg-card border border-border rounded-lg shadow-lg p-4 flex flex-col gap-3 min-w-[220px]">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date Range</p>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-muted-foreground">From</label>
                    <input type="date" value={customFrom}
                      onChange={e => { setCustomFrom(e.target.value); setPage(1); }}
                      className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background outline-none focus:ring-1 focus:ring-primary" />
                    <label className="text-xs text-muted-foreground">To</label>
                    <input type="date" value={customTo}
                      onChange={e => { setCustomTo(e.target.value); setPage(1); }}
                      className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                  <button
                    onClick={() => setShowCustom(false)}
                    className="w-full py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
                  >Apply</button>
                </div>
              )}
            </div>
          ) : (
            <button
              key={key}
              onClick={() => { setDateSegment(key); setPage(1); setShowCustom(false); }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                dateSegment === key
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {label}
            </button>
          )
        ))}
        <span className="text-xs text-muted-foreground ml-1">
          {rangeRows.length} order{rangeRows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Tabs + toolbar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b border-border -mt-1">
        <div className="flex items-center overflow-x-auto">
          {TABS.map(({ key, label }) => {
            const count = key === "all" ? rangeRows.length : rangeRows.filter(r => r.status === key).length;
            return (
              <button
                key={key}
                onClick={() => { setStatusFilter(key); setPage(1); }}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                  statusFilter === key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
                <span className={cn(
                  "text-[11px] font-bold rounded-full px-1.5 py-0.5 leading-none min-w-[18px] text-center",
                  statusFilter === key ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pb-2 shrink-0">
          {/* Search */}
          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 w-52 border border-border">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search order ID, customer, table..."
              className="bg-transparent text-xs flex-1 outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button onClick={() => { setSearch(""); setPage(1); }}>
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>

          {/* Filters dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setShowFilters(v => !v)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                showFilters || statusFilter !== "all"
                  ? "bg-primary/10 border-primary text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              <Filter className="h-3.5 w-3.5" /> Filters
              {statusFilter !== "all" && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
            {showFilters && (
              <div className="absolute top-full right-0 mt-1.5 z-30 bg-card border border-border rounded-lg shadow-lg p-4 min-w-[180px] space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</p>
                <div className="flex flex-col gap-1">
                  {TABS.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => { setStatusFilter(key); setPage(1); setShowFilters(false); }}
                      className={cn(
                        "flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left",
                        statusFilter === key
                          ? "bg-primary text-white"
                          : "text-foreground hover:bg-muted"
                      )}
                    >
                      {label}
                      <span className={cn(
                        "text-[11px] rounded-full px-1.5 py-0.5 leading-none",
                        statusFilter === key ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                      )}>
                        {key === "all" ? rangeRows.length : rangeRows.filter(r => r.status === key).length}
                      </span>
                    </button>
                  ))}
                </div>
                {statusFilter !== "all" && (
                  <button
                    onClick={() => { setStatusFilter("all"); setPage(1); setShowFilters(false); }}
                    className="w-full text-xs text-muted-foreground hover:text-foreground py-1 text-center"
                  >
                    Clear filter
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Download CSV */}
          <button
            onClick={() => {
              const label = dateSegment === "custom"
                ? `${customFrom}_${customTo}`
                : dateSegment;
              exportCSV(filtered, label);
            }}
            title="Export CSV"
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
          </button>

          {/* Refresh */}
          <button onClick={() => load()} disabled={refreshing}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 py-4">
        {[
          { icon: ShoppingBag, bg: "bg-blue-50",   ic: "text-blue-500",   label: "Total Orders",     value: rangeRows.length,  sub: dateSegment === "today" ? "Today" : dateSegment === "yesterday" ? "Yesterday" : dateSegment === "week" ? "Last 7 days" : dateSegment === "month" ? "Last 30 days" : `${fmtDate(new Date(customFrom))} – ${fmtDate(new Date(customTo))}`, up: false },
          { icon: TrendingUp,  bg: "bg-green-50",  ic: "text-green-500",  label: "Total Revenue",    value: `₹${totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`, sub: `${rangeRows.filter(r => r.status === "served").length} served`, up: true },
          { icon: Receipt,     bg: "bg-purple-50", ic: "text-purple-500", label: "Avg. Order Value",  value: `₹${avgOrderValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`, sub: rangeRows.length ? `across ${rangeRows.length} orders` : "No orders", up: false },
          { icon: AlertCircle, bg: "bg-amber-50",  ic: "text-amber-500",  label: "Active Orders",   value: pendingCount, sub: pendingCount > 0 ? "Need attention" : "All clear", up: false },
        ].map(({ icon: Icon, bg, ic, label, value, sub, up }) => (
          <div key={label} className="bg-card rounded-lg border border-border p-4 flex items-center gap-4">
            <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-lg", bg)}>
              <Icon className={cn("h-6 w-6", ic)} />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-foreground leading-tight">{value}</p>
              <p className="text-xs font-semibold text-foreground mt-0.5">{label}</p>
              <p className={cn("text-[11px] mt-0.5", up ? "text-green-600" : "text-muted-foreground")}>
                {up ? "▲" : ""} {sub}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/20">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Order ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => toggleSort("table_number")}>
                  Table <SortArrow k="table_number" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Customer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Items</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => toggleSort("order_total")}>
                  Amount <SortArrow k="order_total" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => toggleSort("created_at")}>
                  Time <SortArrow k="created_at" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                    No orders match your filters
                  </td>
                </tr>
              ) : paginated.map(row => (
                <tr key={row.id}
                  className={cn(
                    "hover:bg-muted/20 transition-colors",
                    selectedOrder?.id === row.id && "bg-primary/5 hover:bg-primary/5"
                  )}
                >
                  {/* Order ID */}
                  <td className="px-4 py-3.5">
                    <p className="font-semibold text-sm text-foreground">{orderId(row.id)}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {row.table_number ? "Dine In" : "Take Away"}
                    </p>
                  </td>

                  {/* Table */}
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-foreground">
                      {row.table_number ? `Table ${String(row.table_number).padStart(2, "0")}` : "—"}
                    </p>
                    {row.floor_name && (
                      <p className="text-[11px] text-muted-foreground">Floor {row.floor_name}</p>
                    )}
                  </td>

                  {/* Customer */}
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-foreground">{row.customer_name ?? "—"}</p>
                    {row.customer_phone && (
                      <p className="text-[11px] text-muted-foreground">{row.customer_phone}</p>
                    )}
                    <button
                      onClick={() => setSelectedOrder(selectedOrder?.id === row.id ? null : row)}
                      className="text-[11px] text-primary hover:underline font-medium"
                    >
                      View Items
                    </button>
                  </td>

                  {/* Items */}
                  <td className="px-4 py-3.5 text-muted-foreground text-sm">
                    {row.total_qty} item{row.total_qty !== 1 ? "s" : ""}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3.5">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                      STATUS_BADGE[row.status] ?? "bg-gray-50 text-gray-500 border border-gray-200"
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[row.status] ?? "bg-gray-400")} />
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-3.5 text-right">
                    <span className="font-semibold text-foreground">
                      ₹{row.order_total.toLocaleString("en-IN")}
                    </span>
                  </td>

                  {/* Time */}
                  <td className="px-4 py-3.5">
                    <p className="text-foreground text-sm">{fmtAgo(row.created_at)}</p>
                    {row.turnaround_s !== null && (
                      <p className={cn("text-[11px]", row.turnaround_s > 1800 ? "text-red-500" : "text-muted-foreground")}>
                        {dur(row.turnaround_s)} total
                      </p>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3.5">
                    <button
                      onClick={() => setSelectedOrder(selectedOrder?.id === row.id ? null : row)}
                      className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors"
                    >
                      <span className="text-base leading-none tracking-widest">···</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-2 py-1 rounded border border-border text-xs hover:bg-muted disabled:opacity-40 transition-colors">‹</button>
            {(() => {
              // Show up to 5 page buttons centered around current page
              const delta = 2;
              const start = Math.max(1, Math.min(page - delta, totalPages - delta * 2));
              const end   = Math.min(totalPages, start + delta * 2);
              const pages: (number | "...")[] = [];
              if (start > 1) { pages.push(1); if (start > 2) pages.push("..."); }
              for (let i = start; i <= end; i++) pages.push(i);
              if (end < totalPages) { if (end < totalPages - 1) pages.push("..."); pages.push(totalPages); }
              return pages.map((p, i) =>
                p === "..." ? (
                  <span key={`ellipsis-${i}`} className="text-muted-foreground text-xs px-1">…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p as number)}
                    className={cn("px-2.5 py-1 rounded text-xs font-medium transition-colors",
                      page === p ? "bg-primary text-white" : "border border-border hover:bg-muted"
                    )}>{p}</button>
                )
              );
            })()}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-2 py-1 rounded border border-border text-xs hover:bg-muted disabled:opacity-40 transition-colors">›</button>
          </div>
          <span className="text-xs text-muted-foreground">
            Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)} to {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} orders
          </span>
          <span className="text-xs text-muted-foreground">{PAGE_SIZE} / page</span>
        </div>
      </div>

      {/* ── Detail drawer (portal) ──────────────────────────────── */}
      {typeof window !== "undefined" && createPortal(
        <>
          <div
            onClick={() => setSelectedOrder(null)}
            className={cn(
              "fixed inset-y-0 left-0 right-80 z-50 bg-black/40 transition-opacity duration-300",
              selectedOrder ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )}
          />
          <div className={cn(
            "fixed top-0 right-0 h-full w-80 z-60 bg-card border-l border-border shadow-elevated overflow-y-auto",
            "transition-transform duration-300 ease-in-out",
            selectedOrder ? "translate-x-0" : "translate-x-full"
          )}>
            {selectedOrder && (
              <OrderDetailPanel
                order={selectedOrder}
                onClose={() => setSelectedOrder(null)}
                onStatusChange={() => loadRef.current?.()}
              />
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// ── Order Detail Panel ────────────────────────────────────────────────────────

function OrderDetailPanel({
  order, onClose, onStatusChange,
}: {
  order: OrderLogRow;
  onClose: () => void;
  onStatusChange: () => void;
}) {
  const [actionLoading, setActionLoading] = useState<"advance" | "cancel" | null>(null);

  const canAdvance = !!NEXT_STATUS[order.status];
  const nextLabel  = NEXT_LABEL[order.status] ?? "Mark as Ready";

  async function handleAdvance() {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    setActionLoading("advance");
    const now = new Date().toISOString();
    const tsField: Record<string, string> = {
      confirmed:  "confirmed_at",
      preparing:  "preparing_at",
      ready:      "ready_at",
      served:     "served_at",
    };
    const update: Record<string, string> = { status: next };
    if (tsField[next]) update[tsField[next]] = now;
    await supabase.from("orders").update(update).eq("id", order.id);
    logAudit('order.status_changed', 'order', order.id, null, {
      old_status: order.status,
      new_status: next,
    });
    setActionLoading(null);
    onStatusChange();
  }

  async function handleCancel() {
    setActionLoading("cancel");
    await supabase.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    logAudit('order.cancelled', 'order', order.id, null, {
      old_status: order.status,
      new_status: 'cancelled',
    });
    setActionLoading(null);
    onStatusChange();
  }

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-start justify-between px-4 py-4 border-b border-border shrink-0">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Order Details</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="font-bold text-base text-foreground">{orderId(order.id)}</span>
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              STATUS_BADGE[order.status] ?? "bg-gray-50 text-gray-500 border border-gray-200"
            )}>
              {STATUS_LABEL[order.status] ?? order.status}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {order.table_number ? "Dine In" : "Take Away"}
            {order.table_number ? ` · Table ${order.table_number}` : ""}
            {order.floor_name ? ` · Floor ${order.floor_name}` : ""}
            {" · "}{fmtAgo(order.created_at)}
          </p>
        </div>
        <button onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors mt-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border">

        {/* Customer Details */}
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Customer Details</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{order.customer_name ?? "Guest"}</p>
                {order.customer_phone && (
                  <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
                )}
              </div>
            </div>
            {order.customer_phone && (
              <a
                href={`tel:${order.customer_phone}`}
                className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
                title={`Call ${order.customer_phone}`}
              >
                <Phone className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          {order.waiter_name && (
            <p className="text-xs text-muted-foreground mt-2">
              Waiter: <span className="text-foreground font-medium">{order.waiter_name}</span>
            </p>
          )}
        </div>

        {/* Order Items */}
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Order Items</p>
          <div className="space-y-3">
            {order.items.map(item => (
              <div key={item.id} className="flex items-center gap-3">
                {/* Item image placeholder */}
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                  <span className="text-[10px] font-bold text-muted-foreground text-center leading-tight px-1">
                    {item.name.slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.quantity} × ₹{item.price.toLocaleString("en-IN")}
                  </p>
                </div>
                <span className="text-sm font-semibold text-foreground shrink-0">
                  ₹{(item.quantity * item.price).toLocaleString("en-IN")}
                </span>
              </div>
            ))}
          </div>

          {/* Bill */}
          <div className="mt-4 pt-3 border-t border-border space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>₹{order.order_total.toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Taxes & Charges</span>
              <span>₹0.00</span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-border">
              <span className="text-foreground">Total Amount</span>
              <span className="text-primary">₹{order.order_total.toLocaleString("en-IN")}</span>
            </div>
          </div>
        </div>

        {/* Order Timeline */}
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Order Timeline</p>
          <div className="space-y-2.5">
            {[
              { label: "Order Placed",    time: order.created_at,   done: true,                 dot: "bg-primary"     },
              { label: "Reached Kitchen", time: order.confirmed_at,  done: !!order.confirmed_at, dot: "bg-blue-500"    },
              { label: "Preparing",       time: order.preparing_at,  done: !!order.preparing_at, dot: "bg-orange-500"  },
              { label: "Ready to Serve",  time: order.ready_at,      done: !!order.ready_at,     dot: "bg-green-500"   },
              { label: "Served",          time: order.served_at,     done: !!order.served_at,    dot: "bg-emerald-600" },
            ].map(({ label, time, done, dot }, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full shrink-0", done ? dot : "bg-border")} />
                  <span className={cn("text-xs font-medium", done ? "text-foreground" : "text-muted-foreground")}>
                    {label}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {time ? fmtAgo(time) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Timing breakdown (extra detail) */}
        {(order.prep_time_s !== null || order.turnaround_s !== null) && (
          <div className="px-4 py-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Timing</p>
            <div className="space-y-1.5">
              {[
                { label: "Wait → Confirm", value: order.wait_to_confirm_s, warn: 300  },
                { label: "Kitchen Prep",   value: order.prep_time_s,       warn: 900  },
                { label: "Serve Time",     value: order.serve_time_s,      warn: 300  },
                { label: "Total",          value: order.turnaround_s,      warn: 1800 },
              ].map(({ label, value, warn }) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={cn("font-medium",
                    value !== null && value > warn ? "text-red-500" : "text-foreground"
                  )}>
                    {dur(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 py-3 border-t border-border shrink-0 flex gap-2">
        {order.status !== "cancelled" && order.status !== "served" && (
          <button
            onClick={handleCancel}
            disabled={actionLoading === "cancel"}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-destructive border border-destructive/30 rounded-lg py-2.5 hover:bg-destructive/5 transition-colors disabled:opacity-50"
          >
            {actionLoading === "cancel"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <XCircle className="h-3.5 w-3.5" />
            }
            Cancel Order
          </button>
        )}
        {canAdvance && (
          <button
            onClick={handleAdvance}
            disabled={actionLoading === "advance"}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-primary rounded-lg py-2.5 hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {actionLoading === "advance"
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <CheckCircle2 className="h-3.5 w-3.5" />
            }
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

