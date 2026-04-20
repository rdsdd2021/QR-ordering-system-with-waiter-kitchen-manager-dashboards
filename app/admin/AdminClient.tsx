"use client";

import { useState } from "react";
import { Store, Users, ShoppingCart, Zap, CheckCircle2, XCircle, Search, ToggleLeft, ToggleRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import CouponManager from "@/components/admin/CouponManager";

type Restaurant = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  owner_id: string | null;
};

type Subscription = {
  restaurant_id: string;
  plan: string;
  status: string;
  current_period_end: string | null;
  updated_at: string;
};

type Props = {
  restaurants: Restaurant[];
  subscriptions: Subscription[];
  orderCounts: Record<string, number>;
  hasServiceRole: boolean;
};

// Simple PIN gate — replace with proper auth in production
const ADMIN_PIN = process.env.NEXT_PUBLIC_ADMIN_PIN ?? "admin123";

export default function AdminClient({ restaurants, subscriptions, orderCounts, hasServiceRole }: Props) {
  const [pin, setPin]         = useState("");
  const [authed, setAuthed]   = useState(false);
  const [pinError, setPinError] = useState(false);
  const [search, setSearch]   = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const [localRestaurants, setLocalRestaurants] = useState(restaurants);
  const [activeTab, setActiveTab] = useState<"restaurants" | "coupons">("restaurants");

  const subMap = Object.fromEntries(subscriptions.map((s) => [s.restaurant_id, s]));

  // ── PIN gate ─────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-sm p-6 space-y-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Store className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold">Admin Panel</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter admin PIN to continue</p>
          </div>
          <Input
            type="password"
            placeholder="Admin PIN"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setPinError(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (pin === ADMIN_PIN) setAuthed(true);
                else setPinError(true);
              }
            }}
            className={cn(pinError && "border-destructive")}
          />
          {pinError && <p className="text-xs text-destructive">Incorrect PIN</p>}
          <Button className="w-full" onClick={() => {
            if (pin === ADMIN_PIN) setAuthed(true);
            else setPinError(true);
          }}>
            Enter
          </Button>
        </Card>
      </div>
    );
  }

  // ── Stats ─────────────────────────────────────────────────────────────
  const totalOrders  = Object.values(orderCounts).reduce((a, b) => a + b, 0);
  const proCount     = subscriptions.filter((s) => s.plan === "pro" && s.status === "active").length;
  const activeCount  = localRestaurants.filter((r) => r.is_active).length;

  // ── Toggle restaurant active state ────────────────────────────────────
  async function toggleActive(restaurant: Restaurant) {
    setToggling(restaurant.id);
    const res = await fetch("/api/admin/toggle-restaurant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId: restaurant.id, isActive: !restaurant.is_active }),
    });
    if (res.ok) {
      setLocalRestaurants((prev) =>
        prev.map((r) => r.id === restaurant.id ? { ...r, is_active: !r.is_active } : r)
      );
    }
    setToggling(null);
  }

  const filtered = localRestaurants.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-bold text-lg">Super Admin</h1>
            <p className="text-xs text-muted-foreground">Platform management</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAuthed(false)}>Lock</Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* Service role warning */}
        {!hasServiceRole && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ⚠️ <strong>SUPABASE_SERVICE_ROLE_KEY</strong> is not set. Inactive restaurants may not appear.
            Add it to <code className="font-mono text-xs">.env.local</code> for full admin access.
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Restaurants", value: localRestaurants.length, icon: Store, color: "" },
            { label: "Active",            value: activeCount,             icon: CheckCircle2, color: "text-green-600" },
            { label: "Pro Subscribers",   value: proCount,                icon: Zap,          color: "text-primary" },
            { label: "Total Orders",      value: totalOrders,             icon: ShoppingCart, color: "" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="p-4">
              <div className="flex items-center gap-3">
                <Icon className={cn("h-5 w-5 text-muted-foreground", color)} />
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={cn("text-2xl font-bold", color)}>{value}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {(["restaurants", "coupons"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
                activeTab === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "restaurants" && (<>
        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search restaurants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Restaurant table */}
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Restaurant</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Sub Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Orders</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((r) => {
                const sub = subMap[r.id];
                return (
                  <tr key={r.id} className={cn("hover:bg-muted/30", !r.is_active && "opacity-50")}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{r.id.slice(0, 8).toUpperCase()}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={cn(
                        "text-xs",
                        sub?.plan === "pro" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      )}>
                        {sub?.plan ?? "free"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "text-xs font-medium",
                        sub?.status === "active" ? "text-green-600" :
                        sub?.status === "past_due" ? "text-red-600" :
                        "text-muted-foreground"
                      )}>
                        {sub?.status ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {orderCounts[r.id] ?? 0}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => {
                          const action = r.is_active ? "deactivate" : "activate";
                          if (confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} "${r.name}"? ${r.is_active ? "This will prevent all access to this restaurant." : "This will restore access."}`)) {
                            toggleActive(r);
                          }
                        }}
                        disabled={toggling === r.id}
                        className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        title={r.is_active ? "Click to deactivate" : "Click to activate"}
                      >
                        {toggling === r.id ? (
                          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : r.is_active ? (
                          <ToggleRight className="h-6 w-6 text-green-600" />
                        ) : (
                          <ToggleLeft className="h-6 w-6 text-muted-foreground" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No restaurants found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>)}

        {activeTab === "coupons" && (
          <CouponManager />
        )}

      </main>
    </div>
  );
}
