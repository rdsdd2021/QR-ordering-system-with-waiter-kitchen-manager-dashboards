"use client";

import { useEffect, useRef, useState } from "react";
import {
  Receipt, ChevronDown, ChevronUp, RefreshCw, Loader2,
  User, Phone, Users, Clock, CheckCircle2, LayoutGrid, List,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getSupabaseClient } from "@/lib/supabase";
import { getTableAvailability, getFloors } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import BillDialog from "@/components/manager/BillDialog";

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
  table_id: string;
  table_number: number;
  floor_name: string | null;
  floor_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  party_size: number | null;
  waiter_name: string | null;
  orders: OrderRow[];
  session_total: number;
  session_start: string;
  session_end: string | null;   // billed_at of the latest billed order
  all_served: boolean;
  is_billed: boolean;
  /** Unique key for past sessions: table_id + ISO date of billed_at */
  session_key: string;
};

type TableTile = {
  table_id: string;
  table_number: number;
  floor_id: string | null;
  floor_name: string | null;
  capacity: number | null;
  // live session data (null = free)
  session: TableSession | null;
};

type Floor = { id: string; name: string };

// ── Table tile state ──────────────────────────────────────────────────────────

type TileState = "free" | "active" | "ready" | "billed";

function getTileState(session: TableSession | null): TileState {
  if (!session) return "free";
  if (session.is_billed) return "billed";
  const servable = session.orders.filter((o) => o.status === "served" && !o.billed_at).length;
  if (servable > 0 && session.orders.every((o) => o.status === "served" || !!o.billed_at)) return "ready";
  return "active";
}

const TILE_STYLES: Record<TileState, string> = {
  free:   "bg-muted/40 border-border text-muted-foreground hover:bg-muted/70",
  active: "bg-blue-50 border-blue-300 text-blue-900 hover:bg-blue-100",
  ready:  "bg-green-50 border-green-400 text-green-900 hover:bg-green-100",
  billed: "bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100",
};

const TILE_DOT: Record<TileState, string> = {
  free:   "bg-gray-300",
  active: "bg-blue-500",
  ready:  "bg-green-500",
  billed: "bg-gray-300",
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

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchData(restaurantId: string): Promise<{
  tiles: TableTile[];
  floors: Floor[];
  active: TableSession[];
  past: TableSession[];
}> {
  // Fetch all tables + active orders in parallel
  const [tableRows, orderData, floorData] = await Promise.all([
    getTableAvailability(restaurantId),
    supabase
      .from("orders")
      .select(`
        id, status, created_at, billed_at,
        customer_name, customer_phone, party_size, total_amount,
        table:tables(id, table_number, floor_id, floor:floors(id, name)),
        waiter:users(name),
        order_items(id, quantity, price, menu_item:menu_items(name))
      `)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(300),
    getFloors(restaurantId),
  ]);

  const orders = (orderData.data ?? []) as any[];

  // Build session maps
  const activeMap = new Map<string, TableSession>();
  const pastMap   = new Map<string, TableSession>();

  for (const o of orders) {
    const tableId     = o.table?.id ?? "";
    const tableNumber = o.table?.table_number ?? 0;
    const floorName   = o.table?.floor?.name ?? null;
    const floorId     = o.table?.floor_id ?? o.table?.floor?.id ?? null;
    const waiterName  = o.waiter?.name ?? null;
    const items       = (o.order_items ?? []).map((oi: any) => ({
      id: oi.id, name: oi.menu_item?.name ?? "Item",
      quantity: oi.quantity, price: parseFloat(oi.price),
    }));
    const orderTotal = items.reduce((s: number, i: any) => s + i.price * i.quantity, 0);

    const orderRow: OrderRow = {
      id: o.id, status: o.status, created_at: o.created_at, billed_at: o.billed_at,
      customer_name: o.customer_name, customer_phone: o.customer_phone,
      party_size: o.party_size, order_total: orderTotal, items,
    };

    const isBilled = !!o.billed_at;
    
    // For past sessions, group by table + date of billed_at (each visit is a separate session)
    let sessionKey: string;
    if (isBilled) {
      const billedDate = new Date(o.billed_at).toISOString().split("T")[0]; // YYYY-MM-DD
      sessionKey = `${tableId}-${billedDate}`;
    } else {
      sessionKey = tableId; // Active sessions: one per table
    }
    
    const map = isBilled ? pastMap : activeMap;

    if (!map.has(sessionKey)) {
      map.set(sessionKey, {
        table_id: tableId, table_number: tableNumber,
        floor_name: floorName, floor_id: floorId,
        customer_name: o.customer_name, customer_phone: o.customer_phone,
        party_size: o.party_size, waiter_name: waiterName,
        orders: [], session_total: 0, session_start: o.created_at,
        session_end: isBilled ? o.billed_at : null,
        all_served: false, is_billed: isBilled,
        session_key: sessionKey,
      });
    }

    const session = map.get(sessionKey)!;
    session.orders.push(orderRow);
    session.session_total += orderTotal;
    if (o.created_at < session.session_start) session.session_start = o.created_at;
    if (isBilled && o.billed_at && (!session.session_end || o.billed_at > session.session_end)) {
      session.session_end = o.billed_at;
    }
    if (!session.customer_name && o.customer_name) session.customer_name = o.customer_name;
    if (!session.customer_phone && o.customer_phone) session.customer_phone = o.customer_phone;
    if (!session.party_size && o.party_size) session.party_size = o.party_size;
    if (!session.waiter_name && waiterName) session.waiter_name = waiterName;
  }

  for (const s of activeMap.values()) {
    s.all_served = s.orders.every((o) => o.status === "served" || !!o.billed_at);
  }

  // Build tiles — one per physical table
  const tiles: TableTile[] = (tableRows as any[]).map((t) => ({
    table_id:    t.table_id,
    table_number:t.table_number,
    floor_id:    t.floor_id ?? null,
    floor_name:  t.floor_name ?? null,
    capacity:    t.capacity ?? null,
    session:     activeMap.get(t.table_id) ?? null,
  }));

  const sortByTable = (a: TableSession, b: TableSession) => a.table_number - b.table_number;
  const sortByEndDesc = (a: TableSession, b: TableSession) => {
    const aEnd = a.session_end ?? a.session_start;
    const bEnd = b.session_end ?? b.session_start;
    return new Date(bEnd).getTime() - new Date(aEnd).getTime();
  };

  return {
    tiles,
    floors: (floorData as any[]).map((f: any) => ({ id: f.id, name: f.name })),
    active: [...activeMap.values()].sort(sortByTable),
    past:   [...pastMap.values()].sort(sortByEndDesc), // Most recent first
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TableSessions({ restaurantId }: Props) {
  const [tiles,          setTiles]          = useState<TableTile[]>([]);
  const [floors,         setFloors]         = useState<Floor[]>([]);
  const [activeSessions, setActiveSessions] = useState<TableSession[]>([]);
  const [pastSessions,   setPastSessions]   = useState<TableSession[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [viewMode,       setViewMode]       = useState<"grid" | "list">("grid");
  const [activeFloor,    setActiveFloor]    = useState<string>("all");
  const [showPast,       setShowPast]       = useState(false);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [billDialogSession, setBillDialogSession] = useState<TableSession | null>(null);
  const [selectedTile,   setSelectedTile]   = useState<TableTile | null>(null);

  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const result = await fetchData(restaurantId);
    setTiles(result.tiles);
    setFloors(result.floors);
    setActiveSessions(result.active);
    setPastSessions(result.past);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { load(); }, [restaurantId]);

  useEffect(() => {
    const client = getSupabaseClient();
    if (channelRef.current) { client.removeChannel(channelRef.current); channelRef.current = null; }
    const channel = client
      .channel(`manager:${restaurantId}`)
      .on("postgres_changes" as any,
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        () => load(true)
      )
      .on("broadcast", { event: "order_changed" }, () => load(true))
      .subscribe((s: string) => { if (s === "SUBSCRIBED") load(true); });
    channelRef.current = channel;
    return () => { client.removeChannel(channel); channelRef.current = null; };
  }, [restaurantId]);

  // Keep selectedTile in sync with live data
  useEffect(() => {
    if (!selectedTile) return;
    const updated = tiles.find((t) => t.table_id === selectedTile.table_id);
    if (updated) setSelectedTile(updated);
  }, [tiles]);

  function toggleTable(tableId: string) {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      next.has(tableId) ? next.delete(tableId) : next.add(tableId);
      return next;
    });
  }

  // Floor tabs: only show floors that actually have tables assigned
  const floorIdsWithTables = new Set(tiles.map((t) => t.floor_id).filter(Boolean));
  const hasUnassigned = tiles.some((t) => !t.floor_id);
  const floorTabs: Array<{ id: string; label: string }> = [
    { id: "all", label: "All" },
    ...floors.filter((f) => floorIdsWithTables.has(f.id)).map((f) => ({ id: f.id, label: f.name })),
    ...(hasUnassigned ? [{ id: "none", label: "No Floor" }] : []),
  ];

  const visibleTiles = tiles.filter((t) => {
    if (activeFloor === "all") return true;
    if (activeFloor === "none") return !t.floor_id;
    return t.floor_id === activeFloor;
  });

  const activeCount = activeSessions.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Bill Dialog */}
      {billDialogSession && (
        <BillDialog
          session={billDialogSession}
          open={!!billDialogSession}
          onClose={() => setBillDialogSession(null)}
          onBilled={() => load(true)}
        />
      )}

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Table Sessions</h2>
          <p className="text-sm text-muted-foreground">
            {activeCount} active table{activeCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load()} disabled={refreshing}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
          {/* View toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors",
                viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Grid
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors border-l",
                viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              <List className="h-3.5 w-3.5" />
              List
            </button>
          </div>
        </div>
      </div>

      {/* ── Grid View ────────────────────────────────────────────── */}
      {viewMode === "grid" && (
        <div className="space-y-4">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {(["free", "active", "ready", "billed"] as TileState[]).map((state) => (
              <span key={state} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-2.5 w-2.5 rounded-full", TILE_DOT[state])} />
                {state === "free" ? "Free" : state === "active" ? "Active" : state === "ready" ? "Ready to bill" : "Billed"}
              </span>
            ))}
          </div>

          {/* Floor tabs */}
          {floorTabs.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              {floorTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveFloor(tab.id)}
                  className={cn(
                    "px-3 py-1 rounded-full text-sm font-medium transition-colors",
                    activeFloor === tab.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Table grid */}
          {visibleTiles.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-xl border border-dashed">
              <p className="text-sm text-muted-foreground">No tables in this section</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
              {visibleTiles.map((tile) => (
                <TableTileCard
                  key={tile.table_id}
                  tile={tile}
                  selected={selectedTile?.table_id === tile.table_id}
                  onClick={() => setSelectedTile(
                    selectedTile?.table_id === tile.table_id ? null : tile
                  )}
                />
              ))}
            </div>
          )}

          {/* Selected tile detail panel */}
          {selectedTile && (
            <TileDetailPanel
              tile={selectedTile}
              onBill={(session) => setBillDialogSession(session)}
              onClose={() => setSelectedTile(null)}
            />
          )}

          {/* Past sessions toggle */}
          {(() => {
            const filtered = selectedTile
              ? pastSessions.filter((s) => s.table_id === selectedTile.table_id)
              : pastSessions;
            const label = selectedTile
              ? `Table ${selectedTile.table_number} past sessions (${filtered.length})`
              : `Past sessions (${pastSessions.length})`;
            return (
              <div>
                <button
                  onClick={() => setShowPast((v) => !v)}
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPast ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {label}
                </button>
                {showPast && (
                  <div className="mt-3">
                    <PastSessionsTable sessions={filtered} />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── List View ────────────────────────────────────────────── */}
      {viewMode === "list" && (
        <div className="space-y-4">
          {activeSessions.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-xl border border-dashed">
              <p className="text-sm text-muted-foreground">No active tables right now</p>
            </div>
          ) : (
            activeSessions.map((session) => (
              <SessionCard
                key={session.table_id}
                session={session}
                expanded={expandedTables.has(session.table_id)}
                onToggle={() => toggleTable(session.table_id)}
                onBill={() => setBillDialogSession(session)}
              />
            ))
          )}

          <div>
            <button
              onClick={() => setShowPast((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPast ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Past sessions ({pastSessions.length})
            </button>
            {showPast && (
              <div className="mt-3">
                <PastSessionsTable sessions={pastSessions} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Past Sessions Table ───────────────────────────────────────────────────────

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function PastSessionsTable({ sessions }: { sessions: TableSession[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground pl-1 py-2">No past sessions</p>;
  }

  return (
    <div className="rounded-xl border overflow-hidden divide-y">
      {sessions.map((session) => {
        const isExpanded = expandedKey === session.session_key;
        const totalItems = session.orders.reduce(
          (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0
        );

        return (
          <div key={session.session_key}>
            {/* Summary row */}
            <button
              className="w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedKey(isExpanded ? null : session.session_key)}
            >
              {/* Top line: table + total + expand chevron */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-sm shrink-0">
                    Table {session.table_number}
                  </span>
                  {session.floor_name && (
                    <span className="text-xs text-muted-foreground truncate">· {session.floor_name}</span>
                  )}
                  <span className="flex items-center gap-1 text-xs text-green-600 font-medium shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                    Billed
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold text-sm tabular-nums">
                    ₹{session.session_total.toFixed(2)}
                  </span>
                  {isExpanded
                    ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  }
                </div>
              </div>

              {/* Second line: customer + waiter */}
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="h-3 w-3 shrink-0" />
                  {session.customer_name ?? <span className="italic">Guest</span>}
                  {session.party_size ? ` · ${session.party_size} guests` : ""}
                </span>
                {session.waiter_name && (
                  <span className="text-xs text-muted-foreground">
                    👤 {session.waiter_name}
                  </span>
                )}
                {session.customer_phone && (
                  <span className="text-xs text-muted-foreground">{session.customer_phone}</span>
                )}
              </div>

              {/* Third line: orders count + billed at */}
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {session.orders.length} order{session.orders.length !== 1 ? "s" : ""} · {totalItems} items
                </span>
                <span className="text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 inline mr-0.5" />
                  {fmtDateTime(session.session_end)}
                </span>
              </div>
            </button>

            {/* Expanded: order breakdown */}
            {isExpanded && (
              <div className="bg-muted/20 border-t divide-y">
                {session.orders.map((order) => (
                  <div key={order.id} className="px-5 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="font-mono text-xs text-muted-foreground shrink-0">
                          #{order.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className={cn(
                          "px-2 py-0.5 rounded text-xs font-medium shrink-0",
                          STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-700"
                        )}>
                          {STATUS_LABEL[order.status] ?? order.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {fmtDateTime(order.created_at)}
                        </span>
                      </div>
                      <span className="text-sm font-semibold tabular-nums shrink-0">
                        ₹{order.order_total.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1.5 pl-2 space-y-0.5">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex justify-between text-xs text-muted-foreground">
                          <span>{item.quantity}× {item.name}</span>
                          <span>₹{(item.quantity * item.price).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Table Tile Card ───────────────────────────────────────────────────────────

function TableTileCard({
  tile,
  selected,
  onClick,
}: {
  tile: TableTile;
  selected: boolean;
  onClick: () => void;
}) {
  const state = getTileState(tile.session);
  const servableCount = tile.session?.orders.filter(
    (o) => o.status === "served" && !o.billed_at
  ).length ?? 0;
  const activeOrderCount = tile.session?.orders.filter(
    (o) => !o.billed_at && o.status !== "served"
  ).length ?? 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-xl border-2 p-2 aspect-square transition-all text-center",
        TILE_STYLES[state],
        selected && "ring-2 ring-primary ring-offset-2"
      )}
    >
      {/* Status dot */}
      <span className={cn("absolute top-1.5 right-1.5 h-2 w-2 rounded-full", TILE_DOT[state])} />

      {/* Table number */}
      <span className="font-bold text-xl leading-none">
        {tile.table_number}
      </span>
      <span className="text-[10px] mt-0.5 opacity-60">Table</span>

      {/* Sub-info */}
      {state === "active" && activeOrderCount > 0 && (
        <span className="mt-1 text-[10px] font-medium bg-blue-200 text-blue-800 rounded px-1.5 py-0.5 leading-tight">
          {activeOrderCount} order{activeOrderCount !== 1 ? "s" : ""}
        </span>
      )}
      {state === "ready" && (
        <span className="mt-1 text-[10px] font-medium bg-green-200 text-green-800 rounded px-1.5 py-0.5 leading-tight">
          Bill ready
        </span>
      )}
      {state === "free" && tile.capacity && (
        <span className="mt-1 text-[10px] opacity-40">{tile.capacity} seats</span>
      )}
      {state === "billed" && (
        <span className="mt-1 text-[10px] opacity-40">Billed</span>
      )}
    </button>
  );
}

// ── Tile Detail Panel ─────────────────────────────────────────────────────────

function TileDetailPanel({
  tile,
  onBill,
  onClose,
}: {
  tile: TableTile;
  onBill: (session: TableSession) => void;
  onClose: () => void;
}) {
  const session = tile.session;
  const state   = getTileState(session);

  const servableCount = session?.orders.filter(
    (o) => o.status === "served" && !o.billed_at
  ).length ?? 0;

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden animate-in slide-in-from-top-2 duration-150">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", TILE_DOT[state])} />
          <span className="font-semibold">
            Table {tile.table_number}
            {tile.floor_name ? ` · ${tile.floor_name}` : ""}
          </span>
          {state === "free" && (
            <Badge variant="secondary" className="text-xs">Free</Badge>
          )}
          {state === "active" && (
            <Badge className="bg-blue-100 text-blue-800 text-xs border-0">Active</Badge>
          )}
          {state === "ready" && (
            <Badge className="bg-green-100 text-green-800 text-xs border-0">Ready to bill</Badge>
          )}
          {state === "billed" && (
            <Badge variant="secondary" className="text-xs">Billed</Badge>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
        >
          ×
        </button>
      </div>

      {/* Free table */}
      {!session || state === "free" ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          No active orders at this table
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Customer info */}
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {session.customer_name && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                {session.customer_name}
              </span>
            )}
            {session.customer_phone && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                {session.customer_phone}
              </span>
            )}
            {session.party_size && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {session.party_size} guests
              </span>
            )}
            {session.waiter_name && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                {session.waiter_name}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Since {fmt(session.session_start)}
            </span>
          </div>

          {/* Orders */}
          <div className="rounded-lg border divide-y">
            {session.orders.map((order) => (
              <div key={order.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium shrink-0",
                    STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-700"
                  )}>
                    {STATUS_LABEL[order.status] ?? order.status}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    #{order.id.slice(0, 6).toUpperCase()}
                  </span>
                  <span className="text-xs text-muted-foreground">{fmt(order.created_at)}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums shrink-0">
                  ₹{order.order_total.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {/* Total + bill action */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Session total</p>
              <p className="text-xl font-bold tabular-nums">₹{session.session_total.toFixed(2)}</p>
            </div>
            {servableCount > 0 && (
              <Button onClick={() => onBill(session)}>
                <Receipt className="h-4 w-4 mr-2" />
                Generate Bill
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Session Card (list view) ──────────────────────────────────────────────────

function SessionCard({
  session, expanded, onToggle, onBill, isPast = false,
}: {
  session: TableSession;
  expanded: boolean;
  onToggle: () => void;
  onBill: () => void;
  isPast?: boolean;
}) {
  const servableCount = session.orders.filter((o) => o.status === "served" && !o.billed_at).length;
  const activeCount   = session.orders.filter((o) => !["served"].includes(o.status)).length;

  return (
    <div className={cn("rounded-xl border bg-card shadow-sm overflow-hidden", isPast && "opacity-70")}>
      <div
        className="flex items-start justify-between gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-base">Table {session.table_number}</span>
            {session.floor_name && (
              <span className="text-xs text-muted-foreground">· {session.floor_name}</span>
            )}
            {isPast ? (
              <Badge variant="secondary" className="text-xs">Billed</Badge>
            ) : activeCount > 0 ? (
              <Badge className="bg-orange-100 text-orange-800 text-xs border-0">{activeCount} in progress</Badge>
            ) : servableCount > 0 ? (
              <Badge className="bg-green-100 text-green-800 text-xs border-0">Ready to bill</Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
            {session.customer_name && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" />{session.customer_name}
              </span>
            )}
            {session.customer_phone && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" />{session.customer_phone}
              </span>
            )}
            {session.party_size && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />{session.party_size} guests
              </span>
            )}
            {session.waiter_name && (
              <span className="text-xs text-muted-foreground">👤 {session.waiter_name}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />Since {fmt(session.session_start)}
            </span>
            <span className="text-xs text-muted-foreground">
              {session.orders.length} order{session.orders.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="font-bold text-lg tabular-nums">₹{session.session_total.toFixed(2)}</span>
          {!isPast && servableCount > 0 && (
            <Button size="sm" onClick={(e) => { e.stopPropagation(); onBill(); }} className="h-8">
              <Receipt className="h-3.5 w-3.5 mr-1.5" />Bill ({servableCount})
            </Button>
          )}
          {isPast && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />Billed
            </span>
          )}
          <button className="text-muted-foreground mt-1">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t divide-y">
          {session.orders.map((order) => (
            <OrderRowItem key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Order row inside session card ─────────────────────────────────────────────

function OrderRowItem({ order }: { order: OrderRow }) {
  const [showItems, setShowItems] = useState(false);
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={() => setShowItems((v) => !v)}>
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn("px-2 py-0.5 rounded text-xs font-medium shrink-0", STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-700")}>
            {STATUS_LABEL[order.status] ?? order.status}
          </span>
          <span className="text-xs text-muted-foreground font-mono">#{order.id.slice(0, 6).toUpperCase()}</span>
          <span className="text-xs text-muted-foreground">{fmt(order.created_at)}</span>
          {order.billed_at && <span className="text-xs text-green-600">✓ Billed {fmt(order.billed_at)}</span>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm font-semibold tabular-nums">₹{order.order_total.toFixed(2)}</span>
          {showItems ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
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
