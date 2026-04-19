"use client";

import { useEffect, useState, useRef, Fragment } from "react";
import { Loader2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getSupabaseClient } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = { restaurantId: string };

type OrderLogRow = {
  id: string;
  status: string;
  // Table
  table_number: number;
  floor_name: string | null;
  capacity: number | null;
  // Waiter
  waiter_name: string | null;
  // Items
  item_count: number;
  total_qty: number;
  order_total: number;
  total_amount: number;
  billed_at: string | null;
  // Timestamps
  created_at: string;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  // Computed durations (seconds)
  wait_to_confirm_s: number | null;   // created → confirmed  (waiter response time)
  prep_time_s: number | null;         // confirmed → ready    (kitchen prep)
  serve_time_s: number | null;        // ready → served       (waiter delivery)
  turnaround_s: number | null;        // created → served     (total)
};

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function dur(seconds: number | null) {
  if (seconds === null || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

const STATUS_COLORS: Record<string, string> = {
  pending:        "bg-amber-100 text-amber-800",
  pending_waiter: "bg-purple-100 text-purple-800",
  confirmed:      "bg-blue-100 text-blue-800",
  preparing:      "bg-orange-100 text-orange-800",
  ready:          "bg-green-100 text-green-800",
  served:         "bg-gray-100 text-gray-700",
};

const STATUS_LABEL: Record<string, string> = {
  pending:        "Pending",
  pending_waiter: "Awaiting Waiter",
  confirmed:      "Confirmed",
  preparing:      "Preparing",
  ready:          "Ready",
  served:         "Served",
};

type SortKey = "created_at" | "table_number" | "turnaround_s" | "order_total";
type SortDir = "asc" | "desc";

// ── main component ────────────────────────────────────────────────────────────

export default function OrderLog({ restaurantId }: Props) {
  const [rows, setRows] = useState<OrderLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);
  const loadRef = useRef<() => Promise<void>>(undefined);

  async function load() {
    if (rows.length === 0) setLoading(true); else setRefreshing(true);
    const { data, error } = await supabase
      .from("orders")
      .select(`
        id, status, created_at, confirmed_at, preparing_at, ready_at, served_at,
        billed_at, total_amount,
        table:tables(table_number, capacity, floor:floors(name)),
        waiter:users(name),
        order_items(id, quantity, price)
      `)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Error loading order log:", error.message);
      setLoading(false);
      return;
    }

    const mapped: OrderLogRow[] = (data ?? []).map((o: any) => {
      const created  = o.created_at  ? new Date(o.created_at).getTime()  : null;
      const confirmed = o.confirmed_at ? new Date(o.confirmed_at).getTime() : null;
      const preparing = o.preparing_at ? new Date(o.preparing_at).getTime() : null;
      const ready    = o.ready_at    ? new Date(o.ready_at).getTime()    : null;
      const served   = o.served_at   ? new Date(o.served_at).getTime()   : null;

      const sec = (a: number | null, b: number | null) =>
        a !== null && b !== null ? Math.round((b - a) / 1000) : null;

      const items: any[] = o.order_items ?? [];
      const order_total = items.reduce((sum: number, i: any) => sum + i.price * i.quantity, 0);

      return {
        id: o.id,
        status: o.status,
        table_number: o.table?.table_number ?? "?",
        floor_name: o.table?.floor?.name ?? null,
        capacity: o.table?.capacity ?? null,
        waiter_name: o.waiter?.name ?? null,
        item_count: items.length,
        total_qty: items.reduce((s: number, i: any) => s + i.quantity, 0),
        order_total,
        total_amount: parseFloat(o.total_amount) || order_total,
        billed_at: o.billed_at,
        created_at: o.created_at,
        confirmed_at: o.confirmed_at,
        preparing_at: o.preparing_at,
        ready_at: o.ready_at,
        served_at: o.served_at,
        wait_to_confirm_s: sec(created, confirmed),
        prep_time_s:       sec(confirmed, ready),
        serve_time_s:      sec(ready, served),
        turnaround_s:      sec(created, served),
      };
    });

    setRows(mapped);
    setLoading(false);
    setRefreshing(false);
  }

  // Keep loadRef always pointing to the latest load function
  loadRef.current = load;

  // Initial load + re-load when restaurantId changes
  useEffect(() => {
    loadRef.current?.();
  }, [restaurantId]);

  // Patch a single row in-place.
  // For status/timestamp fields we use the full postgres_changes row.
  // For waiter_name we re-fetch since it's a join not in the raw row.
  function patchRow(updated: Record<string, any>) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === updated.id);
      if (idx === -1) {
        // New order — full reload to get joined data
        loadRef.current?.();
        return prev;
      }
      const old = prev[idx];

      const confirmed_at  = updated.confirmed_at  ?? old.confirmed_at;
      const preparing_at  = updated.preparing_at  ?? old.preparing_at;
      const ready_at      = updated.ready_at      ?? old.ready_at;
      const served_at     = updated.served_at     ?? old.served_at;

      const created   = old.created_at ? new Date(old.created_at).getTime() : null;
      const confirmed = confirmed_at   ? new Date(confirmed_at).getTime()   : null;
      const ready     = ready_at       ? new Date(ready_at).getTime()       : null;
      const served    = served_at      ? new Date(served_at).getTime()      : null;

      const sec = (a: number | null, b: number | null) =>
        a !== null && b !== null ? Math.round((b - a) / 1000) : null;

      const patched: OrderLogRow = {
        ...old,
        status:        updated.status       ?? old.status,
        confirmed_at,
        preparing_at,
        ready_at,
        served_at,
        billed_at:     updated.billed_at    ?? old.billed_at,
        total_amount:  updated.total_amount ?? old.total_amount,
        wait_to_confirm_s: sec(created, confirmed),
        prep_time_s:       sec(confirmed, ready),
        serve_time_s:      sec(ready, served),
        turnaround_s:      sec(created, served),
      };

      // If waiter_id changed, we need the waiter name — do a background fetch
      if (updated.waiter_id !== undefined) {
        // Fetch just this order to get the joined waiter name
        supabase
          .from("orders")
          .select("id, waiter:users(name)")
          .eq("id", updated.id)
          .single()
          .then(({ data }) => {
            if (data) {
              setRows((r) =>
                r.map((row) =>
                  row.id === updated.id
                    ? { ...row, waiter_name: (data as any).waiter?.name ?? null }
                    : row
                )
              );
            }
          });
      }

      const next = [...prev];
      next[idx] = patched;
      return next;
    });
  }

  // Real-time subscription
  useEffect(() => {
    const client = getSupabaseClient();

    if (channelRef.current) {
      client.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = client
      .channel(`manager:${restaurantId}`)
      // postgres_changes gives us the full updated row including all timestamps
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        (msg: any) => {
          if (msg.eventType === "INSERT") {
            // New order — full reload to get joined data (table name, waiter name, items)
            loadRef.current?.();
          } else if (msg.eventType === "UPDATE" && msg.new?.id) {
            // Full row available — patch in-place
            patchRow(msg.new);
          }
        }
      )
      // Broadcast as a secondary signal (catches cases where postgres_changes is slow)
      .on("broadcast", { event: "order_changed" }, (msg: any) => {
        const p = msg.payload;
        if (!p?.id) return;
        if (p.event === "INSERT") {
          loadRef.current?.();
        }
        // For UPDATE we rely on postgres_changes which has full row data
      })
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") loadRef.current?.();
      });

    channelRef.current = channel;

    return () => {
      client.removeChannel(channel);
      channelRef.current = null;
    };
  }, [restaurantId]);

  // ── filter + sort ──────────────────────────────────────────────────────────

  const filtered = rows
    .filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          String(r.table_number).includes(q) ||
          (r.waiter_name?.toLowerCase().includes(q) ?? false) ||
          (r.floor_name?.toLowerCase().includes(q) ?? false) ||
          r.id.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let av: any = a[sortKey];
      let bv: any = b[sortKey];
      if (av === null) av = sortDir === "asc" ? Infinity : -Infinity;
      if (bv === null) bv = sortDir === "asc" ? Infinity : -Infinity;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="opacity-30">↕</span>;
    return sortDir === "asc" ? <span>↑</span> : <span>↓</span>;
  }

  const statuses = ["all", "pending", "pending_waiter", "confirmed", "preparing", "ready", "served"];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Order Log</h2>
          <p className="text-sm text-muted-foreground">
            Full lifecycle view — {rows.length} orders
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
          <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search table, waiter, floor, order ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <div className="flex gap-1 flex-wrap">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              )}
            >
              {s === "all" ? "All" : STATUS_LABEL[s] ?? s}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed">
          <p className="text-sm text-muted-foreground">No orders match your filters</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-8"></th>
                <th
                  className="text-left px-3 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap"
                  onClick={() => toggleSort("table_number")}
                >
                  Table <SortIcon k="table_number" />
                </th>
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                <th
                  className="text-left px-3 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap"
                  onClick={() => toggleSort("created_at")}
                >
                  Placed <SortIcon k="created_at" />
                </th>
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Waiter</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Wait→Confirm</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Kitchen Prep</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Serve Time</th>
                <th
                  className="text-right px-3 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap"
                  onClick={() => toggleSort("turnaround_s")}
                >
                  Total <SortIcon k="turnaround_s" />
                </th>
                <th
                  className="text-right px-3 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap"
                  onClick={() => toggleSort("order_total")}
                >
                  Amount <SortIcon k="order_total" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className={cn(
                      "hover:bg-muted/30 cursor-pointer transition-colors",
                      expandedId === row.id && "bg-muted/20"
                    )}
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  >
                    {/* Expand toggle */}
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {expandedId === row.id
                        ? <ChevronUp className="h-3.5 w-3.5" />
                        : <ChevronDown className="h-3.5 w-3.5" />}
                    </td>

                    {/* Table */}
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                      <span>Table {row.table_number}</span>
                      {row.floor_name && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{row.floor_name}</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2.5">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium", STATUS_COLORS[row.status] ?? "bg-gray-100 text-gray-700")}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                    </td>

                    {/* Placed */}
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                      <span className="text-foreground font-medium">{fmt(row.created_at)}</span>
                      <span className="ml-1.5 text-xs">{fmtDate(row.created_at)}</span>
                    </td>

                    {/* Waiter */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {row.waiter_name
                        ? <span>{row.waiter_name}</span>
                        : <span className="text-muted-foreground text-xs">Unassigned</span>}
                    </td>

                    {/* Wait → Confirm */}
                    <td className={cn("px-3 py-2.5 text-right tabular-nums whitespace-nowrap",
                      row.wait_to_confirm_s !== null && row.wait_to_confirm_s > 300 ? "text-red-600 font-medium" : "")}>
                      {dur(row.wait_to_confirm_s)}
                    </td>

                    {/* Kitchen Prep */}
                    <td className={cn("px-3 py-2.5 text-right tabular-nums whitespace-nowrap",
                      row.prep_time_s !== null && row.prep_time_s > 900 ? "text-orange-600 font-medium" : "")}>
                      {dur(row.prep_time_s)}
                    </td>

                    {/* Serve Time */}
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {dur(row.serve_time_s)}
                    </td>

                    {/* Total */}
                    <td className={cn("px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap",
                      row.turnaround_s !== null && row.turnaround_s > 1800 ? "text-red-600" : "")}>
                      {dur(row.turnaround_s)}
                    </td>

                    {/* Amount */}
                    <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                      ₹{row.order_total.toFixed(2)}
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expandedId === row.id && (
                    <tr key={`${row.id}-detail`} className="bg-muted/10">
                      <td colSpan={10} className="px-4 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                          {/* Timeline */}
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                              Order Timeline
                            </p>
                            <ol className="relative border-l border-border ml-2 space-y-3">
                              {[
                                { label: "Order Placed",      time: row.created_at,   color: "bg-gray-400" },
                                { label: "Waiter Confirmed",  time: row.confirmed_at,  color: "bg-blue-500" },
                                { label: "Kitchen Started",   time: row.preparing_at,  color: "bg-orange-500" },
                                { label: "Food Ready",        time: row.ready_at,      color: "bg-green-500" },
                                { label: "Served to Table",   time: row.served_at,     color: "bg-emerald-600" },
                                { label: "Billed",            time: row.billed_at,     color: "bg-purple-500" },
                              ].map(({ label, time, color }, idx) => (
                                <li key={`${row.id}-timeline-${idx}`} className="ml-4">
                                  <span className={cn("absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-background", color, !time && "opacity-30")} />
                                  <div className="flex items-baseline gap-2">
                                    <span className={cn("text-sm font-medium", !time && "text-muted-foreground")}>{label}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {time ? `${fmtDate(time)} ${fmt(time)}` : "—"}
                                    </span>
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </div>

                          {/* Order Details */}
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                              Order Details
                            </p>
                            <div className="space-y-1.5 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Order ID</span>
                                <span className="font-mono text-xs">{row.id.slice(0, 8).toUpperCase()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Table</span>
                                <span>Table {row.table_number}{row.floor_name ? ` · ${row.floor_name}` : ""}</span>
                              </div>
                              {row.capacity && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Capacity</span>
                                  <span>{row.capacity} seats</span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Attended by</span>
                                <span>{row.waiter_name ?? "—"}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Items ordered</span>
                                <span>{row.total_qty} item{row.total_qty !== 1 ? "s" : ""}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Order total</span>
                                <span className="font-semibold">₹{row.order_total.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Billed</span>
                                <span>{row.billed_at ? `${fmtDate(row.billed_at)} ${fmt(row.billed_at)}` : "Not billed"}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-1">
        <span className="text-red-600 font-medium">Red duration</span> = slow (&gt;5min confirm / &gt;15min prep / &gt;30min total)
        <span className="text-orange-600 font-medium">Orange</span> = kitchen taking &gt;15min
      </div>
    </div>
  );
}
