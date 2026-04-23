"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  RefreshCw, Loader2, User, Users, Clock,
  LayoutGrid, List, X, Receipt, Plus, Printer,
  ChevronDown, ChevronUp, Bell,
  MoreHorizontal, Filter, Minus, Search, ShoppingCart,
} from "lucide-react";
import { supabase, getSupabaseClient } from "@/lib/supabase";
import { getTableAvailability, getFloors, getMenuItems, placeOrder } from "@/lib/api";
import { cn } from "@/lib/utils";
import BillDialog from "@/components/manager/BillDialog";
import type { MenuItem } from "@/types/database";

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
  session_end: string | null;
  all_served: boolean;
  is_billed: boolean;
  session_key: string;
};

type TableTile = {
  table_id: string;
  table_number: number;
  floor_id: string | null;
  floor_name: string | null;
  capacity: number | null;
  session: TableSession | null;
};

type Floor = { id: string; name: string };
type TileState = "free" | "active" | "bill-ready" | "awaiting" | "billed";

// ── State helpers ─────────────────────────────────────────────────────────────

function getTileState(session: TableSession | null): TileState {
  if (!session) return "free";
  if (session.is_billed) return "billed";
  const hasServed = session.orders.some((o) => o.status === "served" && !o.billed_at);
  const allServedOrBilled = session.orders.every((o) => o.status === "served" || !!o.billed_at);
  if (hasServed && allServedOrBilled) return "bill-ready";
  const hasAwaiting = session.orders.some((o) =>
    o.status === "pending" || o.status === "pending_waiter"
  );
  if (hasAwaiting) return "awaiting";
  return "active";
}

const STATE_LABEL: Record<TileState, string> = {
  free: "Free",
  active: "Active",
  "bill-ready": "Bill Ready",
  awaiting: "Awaiting",
  billed: "Billed",
};

const STATE_BADGE: Record<TileState, string> = {
  free:        "bg-transparent text-muted-foreground border border-border",
  active:      "bg-blue-50 text-blue-600 border border-blue-200",
  "bill-ready":"bg-green-50 text-green-600 border border-green-200",
  awaiting:    "bg-amber-50 text-amber-600 border border-amber-200",
  billed:      "bg-gray-50 text-gray-400 border border-gray-200",
};

const STATE_DOT: Record<TileState, string> = {
  free:        "bg-gray-300",
  active:      "bg-blue-500",
  "bill-ready":"bg-green-500",
  awaiting:    "bg-amber-500",
  billed:      "bg-gray-300",
};

const STATE_CARD: Record<TileState, string> = {
  free:        "bg-card border-border",
  active:      "bg-card border-blue-200",
  "bill-ready":"bg-card border-green-300",
  awaiting:    "bg-card border-amber-200",
  billed:      "bg-card border-border opacity-60",
};

const STATUS_COLORS: Record<string, string> = {
  pending:        "bg-amber-100 text-amber-700",
  pending_waiter: "bg-purple-100 text-purple-700",
  confirmed:      "bg-blue-100 text-blue-700",
  preparing:      "bg-orange-100 text-orange-700",
  ready:          "bg-green-100 text-green-700",
  served:         "bg-gray-100 text-gray-500",
};

const STATUS_LABEL: Record<string, string> = {
  pending:        "Pending",
  pending_waiter: "Awaiting Waiter",
  confirmed:      "Confirmed",
  preparing:      "Preparing",
  ready:          "Ready",
  served:         "Served",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(iso: string | null) {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchData(restaurantId: string) {
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
    const sessionKey = isBilled
      ? `${tableId}-${new Date(o.billed_at).toISOString().split("T")[0]}`
      : tableId;
    const map = isBilled ? pastMap : activeMap;
    if (!map.has(sessionKey)) {
      map.set(sessionKey, {
        table_id: tableId, table_number: tableNumber,
        floor_name: floorName, floor_id: floorId,
        customer_name: o.customer_name, customer_phone: o.customer_phone,
        party_size: o.party_size, waiter_name: waiterName,
        orders: [], session_total: 0, session_start: o.created_at,
        session_end: isBilled ? o.billed_at : null,
        all_served: false, is_billed: isBilled, session_key: sessionKey,
      });
    }
    const session = map.get(sessionKey)!;
    session.orders.push(orderRow);
    session.session_total += orderTotal;
    if (o.created_at < session.session_start) session.session_start = o.created_at;
    if (isBilled && o.billed_at && (!session.session_end || o.billed_at > session.session_end))
      session.session_end = o.billed_at;
    if (!session.customer_name && o.customer_name) session.customer_name = o.customer_name;
    if (!session.customer_phone && o.customer_phone) session.customer_phone = o.customer_phone;
    if (!session.party_size && o.party_size) session.party_size = o.party_size;
    if (!session.waiter_name && waiterName) session.waiter_name = waiterName;
  }
  for (const s of activeMap.values())
    s.all_served = s.orders.every((o) => o.status === "served" || !!o.billed_at);

  const tiles: TableTile[] = (tableRows as any[]).map((t) => ({
    table_id: t.table_id, table_number: t.table_number,
    floor_id: t.floor_id ?? null, floor_name: t.floor_name ?? null,
    capacity: t.capacity ?? null, session: activeMap.get(t.table_id) ?? null,
  }));

  return {
    tiles,
    floors: (floorData as any[]).map((f: any) => ({ id: f.id, name: f.name })),
    active: [...activeMap.values()].sort((a, b) => a.table_number - b.table_number),
    past:   [...pastMap.values()].sort((a, b) =>
      new Date(b.session_end ?? b.session_start).getTime() -
      new Date(a.session_end ?? a.session_start).getTime()
    ),
  };
}

// ── Add Order Modal ───────────────────────────────────────────────────────────

function AddOrderModal({
  restaurantId,
  session,
  onClose,
  onSuccess,
}: {
  restaurantId: string;
  session: TableSession;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [menuItems, setMenuItems]   = useState<MenuItem[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [cart, setCart]             = useState<Record<string, number>>({});
  const [search, setSearch]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    getMenuItems(restaurantId).then((items) => {
      setMenuItems(items);
      setLoadingMenu(false);
    });
  }, [restaurantId]);

  const filtered = menuItems.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  const cartTotal = Object.entries(cart).reduce((sum, [id, qty]) => {
    const item = menuItems.find((m) => m.id === id);
    return sum + (item ? item.price * qty : 0);
  }, 0);

  const cartCount = Object.values(cart).reduce((s, q) => s + q, 0);

  function adjust(id: string, delta: number) {
    setCart((prev) => {
      const next = { ...prev, [id]: (prev[id] ?? 0) + delta };
      if (next[id] <= 0) delete next[id];
      return next;
    });
  }

  async function handleSubmit() {
    const items = Object.entries(cart).map(([menu_item_id, quantity]) => {
      const item = menuItems.find((m) => m.id === menu_item_id)!;
      return { menu_item_id, quantity, price: item.price };
    });
    if (!items.length) return;
    setSubmitting(true);
    setError(null);
    const result = await placeOrder({
      restaurantId,
      tableId: session.table_id,
      items,
      customerName: session.customer_name ?? undefined,
      customerPhone: session.customer_phone ?? undefined,
      partySize: session.party_size ?? undefined,
    });
    setSubmitting(false);
    if (result === "UNPAID_ORDERS_EXIST") {
      setError("This table already has unpaid orders from a different customer.");
    } else if (!result) {
      setError("Failed to place order. Please try again.");
    } else {
      onSuccess();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card rounded-2xl border border-border shadow-elevated w-full max-w-md flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-bold text-base text-foreground">Add Order</h2>
            <p className="text-xs text-muted-foreground">
              Table {String(session.table_number).padStart(2, "0")} · {session.customer_name ?? "Guest"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search menu…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Menu list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loadingMenu ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No items found</p>
          ) : (
            filtered.map((item) => {
              const qty = cart[item.id] ?? 0;
              return (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">₹{item.price.toLocaleString("en-IN")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {qty > 0 ? (
                      <>
                        <button
                          onClick={() => adjust(item.id, -1)}
                          className="h-6 w-6 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="text-sm font-bold w-4 text-center">{qty}</span>
                      </>
                    ) : null}
                    <button
                      onClick={() => adjust(item.id, 1)}
                      className="h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-border shrink-0 space-y-3">
          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <ShoppingCart className="h-3.5 w-3.5" />
              {cartCount} item{cartCount !== 1 ? "s" : ""}
            </span>
            <span className="font-bold text-foreground">₹{cartTotal.toLocaleString("en-IN")}</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={cartCount === 0 || submitting}
            className="w-full bg-primary text-white font-semibold text-sm rounded-xl py-2.5 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Place Order
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Grid layout ───────────────────────────────────────────────────────────────
// Fixed-width cards (max 220px each) centered in the canvas.
// On mobile always 2 equal columns filling the width.

function GridLayout({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div className="w-full">
      {/* Mobile: 2 equal cols filling full width */}
      <div className="grid grid-cols-2 gap-3 md:hidden" style={{ gridAutoRows: "1fr" }}>
        {children}
      </div>
      {/* Desktop: fixed-width cards, centered, never overflow */}
      <div className="hidden md:flex justify-center w-full overflow-hidden">
        <div
          className="grid gap-3 w-full"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 220px))`,
            gridAutoRows: "1fr",
            maxWidth: `${cols * 220 + (cols - 1) * 12}px`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
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
  const [selectedTile,   setSelectedTile]   = useState<TableTile | null>(null);
  const [billDialogSession, setBillDialogSession] = useState<TableSession | null>(null);
  const [cols,           setCols]           = useState<number>(() => {
    if (typeof window === "undefined") return 4;
    return parseInt(localStorage.getItem("ts_cols") ?? "4", 10);
  });
  const [rowsPerPage,    setRowsPerPage]    = useState<number>(() => {
    if (typeof window === "undefined") return 3;
    return parseInt(localStorage.getItem("ts_rows") ?? "3", 10);
  });
  const [currentPage,    setCurrentPage]    = useState<number>(1);
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);
  const [addOrderSession, setAddOrderSession] = useState<TableSession | null>(null);
  // tableId → timestamp of last reminder sent (for cooldown + visual feedback)
  const [reminderSent, setReminderSent] = useState<Record<string, number>>({});

  async function load(silent = false) {
    if (!silent) setLoading(true); else setRefreshing(true);
    const result = await fetchData(restaurantId);
    setTiles(result.tiles);
    setFloors(result.floors);
    setActiveSessions(result.active);
    setPastSessions(result.past);
    setLoading(false);
    setRefreshing(false);
  }

  const sendReminder = useCallback(async (session: TableSession) => {
    const now = Date.now();
    const last = reminderSent[session.table_id] ?? 0;
    if (now - last < 30_000) return; // 30s cooldown
    setReminderSent((prev) => ({ ...prev, [session.table_id]: now }));
    // Broadcast reminder over the realtime channel so waiter/kitchen can react
    try {
      const client = getSupabaseClient();
      await client.channel(`restaurant:${restaurantId}`).send({
        type: "broadcast",
        event: "table_reminder",
        payload: {
          table_id: session.table_id,
          table_number: session.table_number,
          customer_name: session.customer_name,
          sent_at: new Date().toISOString(),
        },
      });
    } catch {
      // Non-critical — visual feedback is already shown
    }
  }, [restaurantId, reminderSent]);

  useEffect(() => { load(); }, [restaurantId]);

  // Persist cols/rows to localStorage
  useEffect(() => { localStorage.setItem("ts_cols", String(cols)); }, [cols]);
  useEffect(() => { localStorage.setItem("ts_rows", String(rowsPerPage)); }, [rowsPerPage]);

  useEffect(() => {
    const client = getSupabaseClient();
    if (channelRef.current) { client.removeChannel(channelRef.current); channelRef.current = null; }
    const channel = client
      .channel(`manager:${restaurantId}`)
      .on("postgres_changes" as any,
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        () => load(true))
      .subscribe();
    channelRef.current = channel;
    return () => { client.removeChannel(channel); channelRef.current = null; };
  }, [restaurantId]);

  // Keep selectedTile in sync with live data
  useEffect(() => {
    if (!selectedTile) return;
    const updated = tiles.find((t) => t.table_id === selectedTile.table_id);
    if (updated) setSelectedTile(updated);
  }, [tiles]);

  // Floor tabs
  const floorIdsWithTables = new Set(tiles.map((t) => t.floor_id).filter(Boolean));
  const floorTabs = [
    { id: "all", label: "All Floors", count: tiles.length },
    ...floors
      .filter((f) => floorIdsWithTables.has(f.id))
      .map((f) => ({
        id: f.id,
        label: f.name,
        count: tiles.filter((t) => t.floor_id === f.id).length,
      })),
  ];

  const visibleTiles = tiles.filter((t) => {
    if (activeFloor === "all") return true;
    return t.floor_id === activeFloor;
  });

  const pageSize    = cols * rowsPerPage;
  const totalPages  = Math.max(1, Math.ceil(visibleTiles.length / pageSize));
  const pagedTiles  = viewMode === "grid"
    ? visibleTiles.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : visibleTiles;

  // Stats
  const activeTables   = activeSessions.length;
  const billReadyCount = tiles.filter((t) => getTileState(t.session) === "bill-ready").length;
  const awaitingCount  = tiles.filter((t) => getTileState(t.session) === "awaiting").length;
  const todayRevenue   = pastSessions.reduce((s, p) => s + p.session_total, 0);
  const avgOrderValue  = activeSessions.length
    ? activeSessions.reduce((s, a) => s + a.session_total, 0) / activeSessions.length
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-full">
      {/* ── Left: main content ─────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* Bill Dialog */}
        {billDialogSession && (
          <BillDialog
            session={billDialogSession}
            open={!!billDialogSession}
            onClose={() => setBillDialogSession(null)}
            onBilled={() => load(true)}
          />
        )}

        {/* Add Order Modal — portaled to body so it sits above the drawer */}
        {addOrderSession && typeof window !== "undefined" && createPortal(
          <AddOrderModal
            restaurantId={restaurantId}
            session={addOrderSession}
            onClose={() => setAddOrderSession(null)}
            onSuccess={() => load(true)}
          />,
          document.body
        )}

        {/* ── Stat cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-5 w-5 fill-blue-500"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>}
            iconBg="bg-blue-50"
            label="Active Tables"
            value={activeTables}
            sub="Live orders in progress"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-5 w-5 fill-green-500"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
            iconBg="bg-green-50"
            label="Bill Ready"
            value={billReadyCount}
            sub="Ready for checkout"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-5 w-5 fill-amber-500"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>}
            iconBg="bg-amber-50"
            label="Awaiting Attention"
            value={awaitingCount}
            sub="Need waiter attention"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-5 w-5 fill-primary"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>}
            iconBg="bg-primary/10"
            label="Today's Revenue"
            value={`₹${todayRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
            sub={`From ${pastSessions.length} sessions`}
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-5 w-5 fill-purple-500"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>}
            iconBg="bg-purple-50"
            label="Avg. Order Value"
            value={`₹${avgOrderValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
            sub="Across all tables"
          />
        </div>

        {/* ── Toolbar ────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Floor tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {floorTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveFloor(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  activeFloor === tab.id
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {tab.label}
                <span className={cn(
                  "text-[11px] font-bold rounded-full px-1.5 py-0.5 leading-none",
                  activeFloor === tab.id ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                )}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
            {/* View toggle */}
            <div className="flex items-center rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors",
                  viewMode === "grid" ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Grid
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-l border-border transition-colors",
                  viewMode === "list" ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"
                )}
              >
                <List className="h-3.5 w-3.5" /> List
              </button>
            </div>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
              <Filter className="h-3.5 w-3.5" /> Filters
            </button>

            {/* Columns selector — desktop only */}
            {viewMode === "grid" && (
              <div className="hidden md:flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Cols</span>
                <div className="flex items-center gap-0.5">
                  {[2, 3, 4, 5, 6].map(n => (
                    <button
                      key={n}
                      onClick={() => { setCols(n); setCurrentPage(1); }}
                      className={cn(
                        "h-5 w-5 rounded text-[11px] font-bold transition-colors",
                        cols === n ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"
                      )}
                    >{n}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Rows selector — desktop only */}
            {viewMode === "grid" && (
              <div className="hidden md:flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Rows</span>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => { setRowsPerPage(n); setCurrentPage(1); }}
                      className={cn(
                        "h-5 w-5 rounded text-[11px] font-bold transition-colors",
                        rowsPerPage === n ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"
                      )}
                    >{n}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Grid ───────────────────────────────────────────── */}
        {viewMode === "grid" && (
          <GridLayout cols={cols}>
            {pagedTiles.map((tile) => (
              <TableCard
                key={tile.table_id}
                tile={tile}
                selected={selectedTile?.table_id === tile.table_id}
                onClick={() => setSelectedTile(
                  selectedTile?.table_id === tile.table_id ? null : tile
                )}
                onBill={(s) => setBillDialogSession(s)}
                onReminder={sendReminder}
                reminderSent={reminderSent}
              />
            ))}
          </GridLayout>
        )}

        {/* ── List ───────────────────────────────────────────── */}
        {viewMode === "list" && (
          <div className="space-y-2">
            {visibleTiles.map((tile) => (
              <TableListRow
                key={tile.table_id}
                tile={tile}
                selected={selectedTile?.table_id === tile.table_id}
                onClick={() => setSelectedTile(
                  selectedTile?.table_id === tile.table_id ? null : tile
                )}
                onBill={(s) => setBillDialogSession(s)}
              />
            ))}
          </div>
        )}

        {/* ── Pagination ─────────────────────────────────────── */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border">
          <span className="hidden sm:block">
            Showing {Math.min((currentPage - 1) * pageSize + 1, visibleTiles.length)}–{Math.min(currentPage * pageSize, visibleTiles.length)} of {visibleTiles.length} tables
          </span>
          <div className="flex items-center gap-1 mx-auto sm:mx-0">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
            >‹</button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setCurrentPage(p)}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  currentPage === p ? "bg-primary text-white" : "border border-border hover:bg-muted"
                )}
              >{p}</button>
            ))}
            {totalPages > 5 && <span className="px-1">...</span>}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
            >›</button>
          </div>
          {viewMode === "grid" && (
            <span className="hidden sm:block text-muted-foreground">{cols} cols × {rowsPerPage} rows</span>
          )}
        </div>
      </div>

      {/* ── Detail drawer — portal-rendered so it covers the full viewport ── */}
      {typeof window !== "undefined" && createPortal(
        <>
          {/* Backdrop — covers full viewport including sidebar */}
          <div
            onClick={() => setSelectedTile(null)}
            className={cn(
              "fixed inset-y-0 left-0 right-80 z-50 bg-black/40 transition-opacity duration-300",
              selectedTile ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )}
          />
          {/* Drawer panel */}
          <div
            className={cn(
              "fixed top-0 right-0 h-full w-80 z-60 bg-card border-l border-border shadow-elevated overflow-y-auto",
              "transition-transform duration-300 ease-in-out",
              selectedTile ? "translate-x-0" : "translate-x-full"
            )}
          >
            {selectedTile && (
              <TableDetailPanel
                tile={selectedTile}
                onClose={() => setSelectedTile(null)}
                onBill={(s) => setBillDialogSession(s)}
                onAddOrder={(s) => setAddOrderSession(s)}
              />
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, iconBg, label, value, sub }: {
  icon: React.ReactNode; iconBg: string;
  label: string; value: string | number; sub: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex items-start gap-3 card-shadow">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", iconBg)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-foreground leading-tight">{value}</p>
        <p className="text-xs font-semibold text-foreground mt-0.5">{label}</p>
        <p className="text-[11px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

// ── Table Card (grid) ─────────────────────────────────────────────────────────

function TableCard({ tile, selected, onClick, onBill, onReminder, reminderSent }: {
  tile: TableTile; selected: boolean;
  onClick: () => void; onBill: (s: TableSession) => void;
  onReminder: (s: TableSession) => void;
  reminderSent: Record<string, number>;
}) {
  const state   = getTileState(tile.session);
  const session = tile.session;
  const isFree  = state === "free";
  const totalItems = session?.orders.reduce(
    (s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0
  ) ?? 0;

  const justReminded = session
    ? Date.now() - (reminderSent[session.table_id] ?? 0) < 30_000
    : false;

  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-xl border-2 p-3 cursor-pointer transition-all duration-150 select-none flex flex-col",
        STATE_CARD[state],
        selected && "ring-2 ring-primary ring-offset-1"
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full shrink-0", STATE_DOT[state])} />
            <span className="font-bold text-base text-foreground leading-none">
              {String(tile.table_number).padStart(2, "0")}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {tile.floor_name ?? "No Floor"} · {tile.capacity ?? "—"} Seats
          </p>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", STATE_BADGE[state])}>
            {STATE_LABEL[state]}
          </span>
          <button
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground p-0.5"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Free table */}
      {isFree ? (
        <div className="flex flex-col items-center justify-center flex-1 py-4 gap-2">
          <svg viewBox="0 0 64 40" className="w-16 h-10 text-muted-foreground/30 fill-current">
            <rect x="8" y="12" width="48" height="6" rx="3"/>
            <rect x="12" y="18" width="4" height="14" rx="2"/>
            <rect x="48" y="18" width="4" height="14" rx="2"/>
            <rect x="4" y="6" width="8" height="8" rx="2"/>
            <rect x="52" y="6" width="8" height="8" rx="2"/>
          </svg>
          <p className="text-[11px] text-muted-foreground">Available for guests</p>
          <button
            onClick={(e) => { e.stopPropagation(); }}
            className="text-[11px] font-semibold text-primary hover:underline"
          >
            Start Session
          </button>
        </div>
      ) : (
        <div className="flex flex-col flex-1">
          {/* Customer */}
          {session?.customer_name && (
            <div className="flex items-center gap-1.5 mb-1">
              <User className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-foreground truncate">{session.customer_name}</span>
            </div>
          )}
          {/* Orders + items */}
          <div className="flex items-center gap-1.5 mb-1">
            <Receipt className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">
              {session?.orders.length ?? 0} Order{(session?.orders.length ?? 0) !== 1 ? "s" : ""} · {totalItems} items
            </span>
          </div>
          {/* Time */}
          <div className="flex items-center gap-1.5 mb-2">
            <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">{fmt(session?.session_start ?? null)}</span>
          </div>
          {/* Total + action */}
          <div className="flex items-center justify-between mt-1 pt-2 border-t border-border">
            <span className="font-bold text-sm text-foreground">
              ₹{(session?.session_total ?? 0).toLocaleString("en-IN")}
            </span>
            {state === "bill-ready" ? (
              <button
                onClick={(e) => { e.stopPropagation(); if (session) onBill(session); }}
                className="text-[11px] font-semibold text-green-600 border border-green-300 rounded-lg px-2 py-0.5 hover:bg-green-50 transition-colors"
              >
                View Bill
              </button>
            ) : state === "awaiting" ? (
              <button
                onClick={(e) => { e.stopPropagation(); if (session) onReminder(session); }}
                disabled={justReminded}
                className={cn(
                  "text-[11px] font-semibold border rounded-lg px-2 py-0.5 transition-colors flex items-center gap-1",
                  justReminded
                    ? "text-green-600 border-green-300 bg-green-50 cursor-default"
                    : "text-amber-600 border-amber-300 hover:bg-amber-50"
                )}
              >
                <Bell className={cn("h-2.5 w-2.5", justReminded && "animate-pulse")} />
                {justReminded ? "Sent!" : "Send Reminder"}
              </button>
            ) : (
              <span className="text-muted-foreground">···</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Table List Row ────────────────────────────────────────────────────────────

function TableListRow({ tile, selected, onClick, onBill }: {
  tile: TableTile; selected: boolean;
  onClick: () => void; onBill: (s: TableSession) => void;
}) {
  const state   = getTileState(tile.session);
  const session = tile.session;

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-4 rounded-xl border-2 bg-card px-4 py-3 cursor-pointer transition-all",
        STATE_CARD[state],
        selected && "ring-2 ring-primary ring-offset-1"
      )}
    >
      <div className="flex items-center gap-2 w-24 shrink-0">
        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", STATE_DOT[state])} />
        <span className="font-bold text-foreground">Table {String(tile.table_number).padStart(2, "0")}</span>
      </div>
      <span className="text-xs text-muted-foreground w-24 shrink-0">{tile.floor_name ?? "—"}</span>
      <span className="text-xs text-muted-foreground flex-1 truncate">
        {session?.customer_name ?? (state === "free" ? "Available" : "—")}
      </span>
      <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0", STATE_BADGE[state])}>
        {STATE_LABEL[state]}
      </span>
      <span className="font-bold text-sm text-foreground w-24 text-right shrink-0">
        {session ? `₹${session.session_total.toLocaleString("en-IN")}` : "—"}
      </span>
      {state === "bill-ready" && session && (
        <button
          onClick={(e) => { e.stopPropagation(); onBill(session); }}
          className="text-[11px] font-semibold text-green-600 border border-green-300 rounded-lg px-2 py-0.5 hover:bg-green-50 shrink-0"
        >
          View Bill
        </button>
      )}
    </div>
  );
}

// ── Table Detail Panel (right sidebar) ───────────────────────────────────────

function TableDetailPanel({ tile, onClose, onBill, onAddOrder }: {
  tile: TableTile;
  onClose: () => void;
  onBill: (s: TableSession) => void;
  onAddOrder: (s: TableSession) => void;
}) {
  const session = tile.session;
  const state   = getTileState(session);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  const totalOrders = session?.orders.length ?? 0;
  const totalItems  = session?.orders.reduce(
    (s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0
  ) ?? 0;

  return (
    <div className="bg-card rounded-xl border border-border card-shadow flex flex-col h-fit sticky top-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-base text-foreground">
              Table {String(tile.table_number).padStart(2, "0")}
            </span>
            <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", STATE_BADGE[state])}>
              {STATE_LABEL[state]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tile.floor_name ?? "No Floor"} · {tile.capacity ?? "—"} Seats
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!session || state === "free" ? (
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center gap-2">
          <svg viewBox="0 0 64 40" className="w-16 h-10 text-muted-foreground/30 fill-current">
            <rect x="8" y="12" width="48" height="6" rx="3"/>
            <rect x="12" y="18" width="4" height="14" rx="2"/>
            <rect x="48" y="18" width="4" height="14" rx="2"/>
          </svg>
          <p className="text-sm text-muted-foreground">No active session</p>
          <p className="text-xs text-muted-foreground">Table is available for guests</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {/* Customer details */}
          <div className="px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customer Details</p>
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{session.customer_name ?? "Guest"}</p>
                {session.customer_phone && (
                  <p className="text-xs text-muted-foreground">{session.customer_phone}</p>
                )}
              </div>
              {session.party_size && (
                <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  {session.party_size}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Since {fmt(session.session_start)}
              <span className="text-muted-foreground/60">({fmtDuration(session.session_start)})</span>
            </div>
          </div>

          {/* Actions */}
          <div className="px-4 py-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Actions</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => session && onAddOrder(session)}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold border border-border rounded-lg py-1.5 hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Add Order
              </button>
              <button
                onClick={() => onBill(session)}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold border border-border rounded-lg py-1.5 hover:bg-muted transition-colors"
              >
                <Printer className="h-3.5 w-3.5" /> Print Bill
              </button>
              <button className="p-1.5 border border-border rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Orders in session */}
          <div className="px-4 py-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Orders in this session ({totalOrders})
            </p>
            <div className="space-y-1.5">
              {session.orders.map((order) => (
                <div key={order.id} className="rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",
                        STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600"
                      )}>
                        {STATUS_LABEL[order.status] ?? order.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        #{order.id.slice(0, 8).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-bold text-foreground">₹{order.order_total.toFixed(0)}</span>
                      {expandedOrder === order.id
                        ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
                        : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      }
                    </div>
                  </button>
                  {expandedOrder === order.id && (
                    <div className="border-t border-border bg-muted/30 px-3 py-2 space-y-1">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex justify-between text-xs text-muted-foreground">
                          <span>{item.quantity}× {item.name}</span>
                          <span>₹{(item.quantity * item.price).toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Session summary */}
          <div className="px-4 py-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Session Summary</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Total Orders</p>
                <p className="font-bold text-foreground">{totalOrders}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Items</p>
                <p className="font-bold text-foreground">{totalItems}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Session Total</p>
                <p className="font-bold text-primary">₹{session.session_total.toLocaleString("en-IN")}</p>
              </div>
            </div>
          </div>

          {/* Recent activity */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Activity</p>
              <button className="text-[11px] text-primary font-medium hover:underline">View All</button>
            </div>
            <div className="space-y-1.5">
              {session.orders.slice(0, 4).map((order) => (
                <div key={order.id} className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATE_DOT[state])} />
                  <span className="text-xs text-muted-foreground flex-1 truncate">
                    Order #{order.id.slice(0, 8).toUpperCase()} placed
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">{fmt(order.created_at)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Close session CTA */}
          <div className="px-4 py-3">
            <button
              onClick={() => onBill(session)}
              className="w-full bg-primary text-white font-semibold text-sm rounded-xl py-2.5 hover:bg-primary/90 transition-colors"
            >
              Close Session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
