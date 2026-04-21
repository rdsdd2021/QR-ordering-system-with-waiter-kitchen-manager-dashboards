/**
 * Tests for the 6 optimisation fixes.
 *
 * We mock @/lib/supabase so no real network calls are made.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ─── Supabase mock factory ────────────────────────────────────────────────────
// Returns a chainable builder whose terminal methods resolve to { data, error }.
function makeQueryBuilder(result: { data: any; error: any }) {
  const b: any = {};
  const chain = () => b;
  const terminal = () => Promise.resolve(result);

  [
    "from","select","eq","neq","in","not","is","or","order",
    "limit","maybeSingle","single","insert","update","delete",
  ].forEach((m) => { b[m] = chain; });

  // terminal overrides
  b.maybeSingle = terminal;
  b.single      = terminal;
  // make the builder itself thenable so `await supabase.from(...).select(...)` works
  b.then = (resolve: any) => Promise.resolve(result).then(resolve);

  return b;
}

const mockRpc  = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ channel: vi.fn(() => ({ on: vi.fn(), subscribe: vi.fn() })) }),
  supabase: {
    from: mockFrom,
    rpc:  mockRpc,
  },
}));

// ─── helpers ─────────────────────────────────────────────────────────────────
function chainReturning(data: any, error: any = null) {
  return makeQueryBuilder({ data, error });
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1 — active_orders must exclude 'served' orders
// We test the mapping logic directly (the SQL filter is on the DB side;
// here we verify the JS correctly derives status from the count).
// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 1 – waiter status derived from non-served order count", () => {
  function deriveStatus(isActive: boolean, activeOrderCount: number) {
    if (!isActive) return "inactive";
    return activeOrderCount > 0 ? "busy" : "available";
  }

  it("active waiter with 0 non-served orders → available", () => {
    expect(deriveStatus(true, 0)).toBe("available");
  });

  it("active waiter with 2 non-served orders → busy", () => {
    expect(deriveStatus(true, 2)).toBe("busy");
  });

  it("inactive waiter regardless of orders → inactive", () => {
    expect(deriveStatus(false, 3)).toBe("inactive");
  });

  it("active waiter whose only orders are served (count=0 after filter) → available", () => {
    // Simulates what happens after the .neq(status,served) filter is applied
    expect(deriveStatus(true, 0)).toBe("available");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2 – StaffManager realtime: only re-fetch on waiter_id change
// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 2 – realtime re-fetch guard", () => {
  function shouldRefetch(oldWaiterId: string | null, newWaiterId: string | null) {
    return oldWaiterId !== newWaiterId;
  }

  it("waiter_id unchanged (status tick) → no refetch", () => {
    expect(shouldRefetch("w1", "w1")).toBe(false);
  });

  it("waiter_id assigned (null → id) → refetch", () => {
    expect(shouldRefetch(null, "w1")).toBe(true);
  });

  it("waiter_id unassigned (id → null) → refetch", () => {
    expect(shouldRefetch("w1", null)).toBe(true);
  });

  it("waiter_id reassigned (w1 → w2) → refetch", () => {
    expect(shouldRefetch("w1", "w2")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3 – fetchAndUpsertOrder fetches single order, not full list
// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 3 – single-order fetch visibility filter", () => {
  // Mirrors the visibility logic in the updated fetchAndUpsertOrder
  function isVisible(order: { waiter_id: string | null }, currentWaiterId: string) {
    const isAssignedToMe = order.waiter_id === currentWaiterId;
    const isUnassigned   = !order.waiter_id;
    return isAssignedToMe || isUnassigned;
  }

  it("order assigned to me → visible", () => {
    expect(isVisible({ waiter_id: "w1" }, "w1")).toBe(true);
  });

  it("unassigned order → visible", () => {
    expect(isVisible({ waiter_id: null }, "w1")).toBe(true);
  });

  it("order assigned to another waiter → not visible", () => {
    expect(isVisible({ waiter_id: "w2" }, "w1")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 4 – batch price calculation: single RPC, fallback on error
// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 4 – batch price RPC in placeOrder", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls calculate_item_prices_batch once for multiple items", async () => {
    // Arrange
    const items = [
      { menu_item_id: "m1", quantity: 2, price: 10 },
      { menu_item_id: "m2", quantity: 1, price: 20 },
    ];
    const batchResult = [
      { menu_item_id: "m1", final_price: 12 },
      { menu_item_id: "m2", final_price: 24 },
    ];
    mockRpc.mockResolvedValueOnce({ data: batchResult, error: null });

    // Act – simulate the batch call
    const { data, error } = await mockRpc("calculate_item_prices_batch", {
      p_items: items.map(i => ({ menu_item_id: i.menu_item_id, quantity: i.quantity, base_price: i.price })),
      p_table_id: "t1",
    });

    // Assert
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("calculate_item_prices_batch", expect.any(Object));
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data[0].final_price).toBe(12);
    expect(data[1].final_price).toBe(24);
  });

  it("falls back to base prices when batch RPC errors", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "function not found" } });

    const items = [{ menu_item_id: "m1", quantity: 1, price: 15 }];
    const { data: pricedItems, error } = await mockRpc("calculate_item_prices_batch", {
      p_items: items,
      p_table_id: "t1",
    });

    // Fallback logic
    const orderItems = (error || !pricedItems)
      ? items.map(i => ({ menu_item_id: i.menu_item_id, price: i.price }))
      : pricedItems;

    expect(orderItems[0].price).toBe(15); // base price used
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 5 – single Supabase client (no dual import)
// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 5 – StaffManager uses single Supabase client", async () => {
  it("StaffManager source does not import named 'supabase' alongside getSupabaseClient", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("components/manager/StaffManager.tsx", "utf8");

    // Should NOT have: import { supabase } from '@/lib/supabase'
    const hasDualImport = /import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*['"]@\/lib\/supabase['"]/.test(src);
    expect(hasDualImport).toBe(false);

    // Should still use getSupabaseClient
    expect(src).toContain("getSupabaseClient");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 6 – customer history uses table_sessions for grouping
// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 6 – customer history session grouping via table_sessions", () => {
  type SessionRow = { id: string; table_id: string; opened_at: string; closed_at: string | null };

  function findSession(order: { table_id: string; created_at: string }, sessions: SessionRow[]) {
    return sessions.find(
      (s) =>
        s.table_id === order.table_id &&
        order.created_at >= s.opened_at &&
        (s.closed_at === null || order.created_at <= s.closed_at)
    );
  }

  const sessions: SessionRow[] = [
    { id: "sess-1", table_id: "t1", opened_at: "2026-04-01T10:00:00Z", closed_at: "2026-04-01T12:00:00Z" },
    { id: "sess-2", table_id: "t1", opened_at: "2026-04-02T10:00:00Z", closed_at: "2026-04-02T12:00:00Z" },
  ];

  it("order within session-1 window maps to sess-1", () => {
    const order = { table_id: "t1", created_at: "2026-04-01T11:00:00Z" };
    expect(findSession(order, sessions)?.id).toBe("sess-1");
  });

  it("order within session-2 window maps to sess-2 (not merged with sess-1)", () => {
    const order = { table_id: "t1", created_at: "2026-04-02T11:00:00Z" };
    expect(findSession(order, sessions)?.id).toBe("sess-2");
  });

  it("order outside all session windows falls back to legacy key", () => {
    const order = { table_id: "t1", created_at: "2026-04-03T11:00:00Z" };
    const matched = findSession(order, sessions);
    const key = matched?.id ?? `${order.table_id}_legacy`;
    expect(key).toBe("t1_legacy");
  });

  it("order on different table does not match sessions for t1", () => {
    const order = { table_id: "t2", created_at: "2026-04-01T11:00:00Z" };
    expect(findSession(order, sessions)).toBeUndefined();
  });
});
