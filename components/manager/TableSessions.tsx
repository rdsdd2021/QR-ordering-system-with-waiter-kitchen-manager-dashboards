"use client";

/**
 * TableSessions
 *
 * Replaces the separate Billing and Order Log tabs with a unified view.
 *
 * CONCEPT:
 * A "session" = all unbilled orders from the same table grouped together.
 * One table → one session card → multiple orders inside → one "Bill All" action.
 *
 * ACTIVE SESSIONS  — tables with at least one unbilled order
 * PAST SESSIONS    — recently billed sessions (collapsed by default)
 *
 * Real-time: patches in-place via postgres_changes, no full reload on updates.
 */

import { useEffect, useRef, useState, Fragment } from "react";
import {
  Receipt, ChevronDown, ChevronUp, RefreshCw, Loader2,
  User, Phone, Users, Clock, CheckCircle2
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getSupabaseClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { generateBill } from "@/lib/api";

type Props = { restaurantId: string };

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderRow = {
  id: string;
  status: string;
  created_at: string;
  billed_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  party_size: number | null;
  order_total: number;
  items: Array<{ id: string; name: string; quantity: number; price: number }>;
};

type TableSession = {
  // Table identity
  table_id: string;
  table_number: number;
  floor_name: string | null;
  // Session info (from first order with customer data)
  customer_name: string | null;
  customer_phone: string | null;
  party_size: number | null;
  waiter_name: string | null;
  // Orders in this session
  orders: OrderRow[];
  // Computed
  session_total: number;
  session_start: string;
  all_served: boolean;
  is_billed: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending:        "bg-amber-100 text-amber-800",
  pending_waiter: "bg-purple-100 text-purple-800",
  confirmed:      "bg-blue-100 text-blue-800",
  preparing:      "bg-orange-100 text-orange-800",
  ready:          "bg-green-100 text-green-800",
  served:         "bg-gray-100 text-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  pending:        "Pending",
  pending_waiter: "Awaiting Waiter",
  confirmed:      "Confirmed",
  preparing:      "Preparing",
  ready:          "Ready",
  served:         "Served",
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchSessions(restaurantId: string): Promise<{
  active: TableSession[];
  past: TableSession[];
}> {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id, status, created_at, billed_at,
      customer_name, customer_phone, party_size, total_amount,
      table:tables(id, table_number, floor:floors(name)),
      waiter:users(name),
      order_items(id, quantity, price, menu_item:menu_items(name))
    `)
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(300);

  if (error || !data) return { active: [], past: [] };

  // Group by table_id, split into unbilled (active) and billed (past)
  const activeMap = new Map<string, TableSession>();
  const pastMap   = new Map<string, TableSession>();

  for (const o of data as any[]) {
    const tableId     = o.table?.id ?? o.table_id;
    const tableNumber = o.table?.table_number ?? 0;
    const floorName   = o.table?.floor?.name ?? null;
    const waiterName  = o.waiter?.name ?? null;
    const items       = (o.order_items ?? []).map((oi: any) => ({
      id:       oi.id,
      name:     oi.menu_item?.name ?? "Item",
      quantity: oi.quantity,
      price:    parseFloat(oi.price),
    }));
    const orderTotal = items.reduce((s: number, i: any) => s + i.price * i.quantity, 0);

    const orderRow: OrderRow = {
      id:            o.id,
      status:        o.status,
      created_at:    o.created_at,
      billed_at:     o.billed_at,
      customer_name: o.customer_name,
      customer_phone:o.customer_phone,
      party_size:    o.party_size,
      order_total:   orderTotal,
      items,
    };

    const isBilled = !!o.billed_at;
    const map = isBilled ? pastMap : activeMap;

    if (!map.has(tableId)) {
      map.set(tableId, {
        table_id:      tableId,
        table_number:  tableNumber,
        floor_name:    floorName,
        customer_name: o.customer_name,
        customer_phone:o.customer_phone,
        party_size:    o.party_size,
        waiter_name:   waiterName,
        orders:        [],
        session_total: 0,
        session_start: o.created_at,
        all_served:    false,
        is_billed:     isBilled,
      });
    }

    const session = map.get(tableId)!;
    session.orders.push(orderRow);
    session.session_total += orderTotal;

    // Use earliest order time as session start
    if (o.created_at < session.session_start) session.session_start = o.created_at;

    // Use first available customer info
    if (!session.customer_name && o.customer_name) session.customer_name = o.customer_name;
    if (!session.customer_phone && o.customer_phone) session.customer_phone = o.customer_phone;
    if (!session.party_size && o.party_size) session.party_size = o.party_size;
    if (!session.waiter_name && waiterName) session.waiter_name = waiterName;
  }

  // Compute all_served for active sessions
  for (const session of activeMap.values()) {
    session.all_served = session.orders.every(
      (o) => o.status === "served" || o.status === "billed"
    );
  }

  const sortByTable = (a: TableSession, b: TableSession) =>
    a.table_number - b.table_number;

  return {
    active: [...activeMap.values()].sort(sortByTable),
    past:   [...pastMap.values()].sort(sortByTable),
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TableSessions({ restaurantId }: Props) {
  const [activeSessions, setActiveSessions] = useState<TableSession[]>([]);
  const [pastSessions,   setPastSessions]   = useState<TableSession[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [showPast,       setShowPast]       = useState(false);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [billingTable,   setBillingTable]   = useState<string | null>(null);

  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);
  const loadRef    = useRef<(silent?: boolean) => Promise<void>>(undefined);

  async function load(silent = false) {
    if (!silent) {
      if (activeSessions.length === 0 && pastSessions.length === 0) setLoading(true);
      else setRefreshing(true);
    }
    const { active, past } = await fetchSessions(restaurantId);
    setActiveSessions(active);
    setPastSessions(past);
    setLoading(false);
    setRefreshing(false);
  }

  loadRef.current = () => load(false);

  useEffect(() => { load(); }, [restaurantId]);

  // Real-time
  useEffect(() => {
    const client = getSupabaseClient();
    if (channelRef.current) { client.removeChannel(channelRef.current); channelRef.current = null; }

    const channel = client
      .channel(`manager:${restaurantId}`)
      .on("postgres_changes" as any,
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        () => { load(true); }
      )
      .on("broadcast", { event: "order_changed" }, () => { load(true); })
      .subscribe((s: string) => { if (s === "SUBSCRIBED") load(true); });

    channelRef.current = channel;
    return () => { client.removeChannel(channel); channelRef.current = null; };
  }, [restaurantId]);

  // ── Bill all served orders for a table ────────────────────────────
  async function handleBillSession(session: TableSession) {
    const servableOrders = session.orders.filter(
      (o) => o.status === "served" && !o.billed_at
    );
    if (servableOrders.length === 0) return;

    setBillingTable(session.table_id);

    // Bill each served order sequentially
    let allOk = true;
    for (const order of servableOrders) {
      const result = await generateBill(order.id);
      if (!result.success) { allOk = false; break; }
    }

    if (!allOk) alert("Some orders could not be billed. Please try again.");
    await load(true);
    setBillingTable(null);
  }

  function toggleTable(tableId: string) {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      next.has(tableId) ? next.delete(tableId) : next.add(tableId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Table Sessions</h2>
          <p className="text-sm text-muted-foreground">
            {activeSessions.length} active table{activeSessions.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={refreshing}>
          <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* ── Active sessions ──────────────────────────────────────────── */}
      {activeSessions.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed">
          <p className="text-sm text-muted-foreground">No active tables right now</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeSessions.map((session) => (
            <SessionCard
              key={session.table_id}
              session={session}
              expanded={expandedTables.has(session.table_id)}
              onToggle={() => toggleTable(session.table_id)}
              onBill={() => handleBillSession(session)}
              billing={billingTable === session.table_id}
            />
          ))}
        </div>
      )}

      {/* ── Past sessions ────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => setShowPast((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showPast ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Past sessions ({pastSessions.length})
        </button>

        {showPast && (
          <div className="mt-3 space-y-3">
            {pastSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground pl-6">No past sessions</p>
            ) : (
              pastSessions.map((session) => (
                <SessionCard
                  key={`past-${session.table_id}-${session.session_start}`}
                  session={session}
                  expanded={expandedTables.has(`past-${session.table_id}`)}
                  onToggle={() => toggleTable(`past-${session.table_id}`)}
                  onBill={() => {}}
                  billing={false}
                  isPast
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Session Card ──────────────────────────────────────────────────────────────

function SessionCard({
  session,
  expanded,
  onToggle,
  onBill,
  billing,
  isPast = false,
}: {
  session: TableSession;
  expanded: boolean;
  onToggle: () => void;
  onBill: () => void;
  billing: boolean;
  isPast?: boolean;
}) {
  const servableCount = session.orders.filter(
    (o) => o.status === "served" && !o.billed_at
  ).length;
  const activeCount = session.orders.filter(
    (o) => !["served"].includes(o.status)
  ).length;

  return (
    <div className={cn(
      "rounded-xl border bg-card shadow-sm overflow-hidden",
      isPast && "opacity-70"
    )}>
      {/* ── Card header ─────────────────────────────────────────────── */}
      <div
        className="flex items-start justify-between gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onToggle}
      >
        {/* Left: table + customer info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-base">
              Table {session.table_number}
            </span>
            {session.floor_name && (
              <span className="text-xs text-muted-foreground">· {session.floor_name}</span>
            )}
            {isPast ? (
              <Badge variant="secondary" className="text-xs">Billed</Badge>
            ) : activeCount > 0 ? (
              <Badge className="bg-orange-100 text-orange-800 text-xs border-0">
                {activeCount} in progress
              </Badge>
            ) : servableCount > 0 ? (
              <Badge className="bg-green-100 text-green-800 text-xs border-0">
                Ready to bill
              </Badge>
            ) : null}
          </div>

          {/* Customer info row */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
            {session.customer_name && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                {session.customer_name}
              </span>
            )}
            {session.customer_phone && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" />
                {session.customer_phone}
              </span>
            )}
            {session.party_size && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                {session.party_size} guests
              </span>
            )}
            {session.waiter_name && (
              <span className="text-xs text-muted-foreground">
                👤 {session.waiter_name}
              </span>
            )}
          </div>

          {/* Session meta */}
          <div className="flex items-center gap-3 mt-1.5">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Since {fmt(session.session_start)}
            </span>
            <span className="text-xs text-muted-foreground">
              {session.orders.length} order{session.orders.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Right: total + actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="font-bold text-lg tabular-nums">
            ₹{session.session_total.toFixed(2)}
          </span>

          {!isPast && servableCount > 0 && (
            <Button
              size="sm"
              onClick={(e) => { e.stopPropagation(); onBill(); }}
              disabled={billing}
              className="h-8"
            >
              {billing ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Billing…</>
              ) : (
                <><Receipt className="h-3.5 w-3.5 mr-1.5" />Bill ({servableCount})</>
              )}
            </Button>
          )}

          {isPast && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Billed
            </span>
          )}

          <button className="text-muted-foreground mt-1">
            {expanded
              ? <ChevronUp className="h-4 w-4" />
              : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── Expanded: order list ─────────────────────────────────────── */}
      {expanded && (
        <div className="border-t divide-y">
          {session.orders.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Individual order row inside a session ─────────────────────────────────────

function OrderRow({ order }: { order: OrderRow }) {
  const [showItems, setShowItems] = useState(false);

  return (
    <div className="px-4 py-3">
      <div
        className="flex items-center justify-between gap-3 cursor-pointer"
        onClick={() => setShowItems((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn(
            "px-2 py-0.5 rounded text-xs font-medium shrink-0",
            STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-700"
          )}>
            {STATUS_LABEL[order.status] ?? order.status}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            #{order.id.slice(0, 6).toUpperCase()}
          </span>
          <span className="text-xs text-muted-foreground">
            {fmt(order.created_at)}
          </span>
          {order.billed_at && (
            <span className="text-xs text-green-600">✓ Billed {fmt(order.billed_at)}</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm font-semibold tabular-nums">
            ₹{order.order_total.toFixed(2)}
          </span>
          {showItems
            ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </div>

      {showItems && (
        <div className="mt-2 pl-2 space-y-1">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-xs text-muted-foreground">
              <span>{item.quantity}× {item.name}</span>
              <span>₹{(item.quantity * item.price).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
