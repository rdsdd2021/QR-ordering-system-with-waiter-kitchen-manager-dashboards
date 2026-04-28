"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Store, Users, ShoppingCart, Zap, CheckCircle2, Search, ToggleLeft, ToggleRight, KeyRound, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import CouponManager from "@/components/admin/CouponManager";
import PlanManager from "@/components/admin/PlanManager";

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
  trial_used: boolean;
  updated_at: string;
};

type Props = {
  restaurants: Restaurant[];
  subscriptions: Subscription[];
  orderCounts: Record<string, number>;
  hasServiceRole: boolean;
};

const ADMIN_PIN = process.env.NEXT_PUBLIC_ADMIN_PIN ?? "admin123";

export default function AdminClient({ restaurants, subscriptions, orderCounts, hasServiceRole }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pin, setPin]           = useState("");
  const [authed, setAuthed]     = useState(false);
  const [pinError, setPinError] = useState(false);
  const [search, setSearch]     = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const [localRestaurants, setLocalRestaurants] = useState(restaurants);
  const [activeTab, setActiveTab] = useState<"restaurants" | "coupons" | "plans">(
    (searchParams.get("tab") as "restaurants" | "coupons" | "plans") ?? "restaurants"
  );
  const [confirmTarget, setConfirmTarget] = useState<Restaurant | null>(null);

  function handleTabChange(tab: "restaurants" | "coupons" | "plans") {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  }
  // Change password dialog
  const [pwTarget, setPwTarget] = useState<Restaurant | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwResult, setPwResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const subMap = Object.fromEntries(subscriptions.map((s) => [s.restaurant_id, s]));

  // Helper: call admin endpoints via server-side proxy (keeps ADMIN_SECRET out of browser)
  async function adminFetch(endpoint: string, method: string, body?: unknown) {
    const res = await fetch("/api/admin/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, endpoint, method, body }),
    });
    return res;
  }

  // ── PIN gate ─────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-sm p-6 space-y-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
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
  const totalOrders = Object.values(orderCounts).reduce((a, b) => a + b, 0);
  const proCount    = subscriptions.filter((s) => s.plan === "pro" && s.status === "active").length;
  const trialCount  = subscriptions.filter((s) => s.status === "trialing").length;
  const activeCount = localRestaurants.filter((r) => {
    const sub = subMap[r.id];
    const isExpired = sub?.status === "expired" || sub?.status === "incomplete";
    return r.is_active && !isExpired;
  }).length;

  // ── Toggle restaurant active state ────────────────────────────────────
  async function toggleActive(restaurant: Restaurant) {
    setToggling(restaurant.id);
    const res = await adminFetch("/api/admin/toggle-restaurant", "POST", {
      restaurantId: restaurant.id,
      isActive: !restaurant.is_active,
    });
    if (res.ok) {
      setLocalRestaurants((prev) =>
        prev.map((r) => r.id === restaurant.id ? { ...r, is_active: !r.is_active } : r)
      );
    }
    setToggling(null);
  }

  async function handleChangePassword() {
    if (!pwTarget || newPassword.length < 8) return;
    setPwLoading(true);
    setPwResult(null);
    const res = await adminFetch("/api/admin/change-password", "POST", {
      restaurantId: pwTarget.id,
      newPassword,
    });
    const data = await res.json();
    if (res.ok) {
      setPwResult({ ok: true, msg: `Password updated for ${data.managerEmail}` });
      setNewPassword("");
    } else {
      setPwResult({ ok: false, msg: data.error ?? "Failed to update password" });
    }
    setPwLoading(false);
  }

  const filtered = localRestaurants.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Confirm toggle AlertDialog */}
      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmTarget?.is_active ? "Deactivate" : "Activate"} restaurant?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.is_active
                ? `This will prevent all access to "${confirmTarget?.name}".`
                : `This will restore access to "${confirmTarget?.name}".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirmTarget?.is_active ? "bg-destructive hover:bg-destructive/90" : ""}
              onClick={() => {
                if (confirmTarget) toggleActive(confirmTarget);
                setConfirmTarget(null);
              }}
            >
              {confirmTarget?.is_active ? "Deactivate" : "Activate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change password dialog */}
      <AlertDialog open={!!pwTarget} onOpenChange={(open) => { if (!open) { setPwTarget(null); setPwResult(null); setNewPassword(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Change manager password
            </AlertDialogTitle>
            <AlertDialogDescription>
              Set a new password for the manager of <strong>{pwTarget?.name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                placeholder="New password (min 8 chars)"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setPwResult(null); }}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {pwResult && (
              <p className={cn("text-sm px-3 py-2 rounded-lg border", pwResult.ok
                ? "text-green-700 bg-green-50 border-green-200"
                : "text-destructive bg-destructive/5 border-destructive/20"
              )}>
                {pwResult.msg}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPwTarget(null); setPwResult(null); setNewPassword(""); }}>
              {pwResult?.ok ? "Close" : "Cancel"}
            </AlertDialogCancel>
            {!pwResult?.ok && (
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleChangePassword(); }}
                disabled={pwLoading || newPassword.length < 8}
              >
                {pwLoading ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : "Update password"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

        {!hasServiceRole && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ⚠️ <strong>SUPABASE_SERVICE_ROLE_KEY</strong> is not set. Inactive restaurants may not appear.
            Add it to <code className="font-mono text-xs">.env.local</code> for full admin access.
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Total Restaurants", value: localRestaurants.length, icon: Store,        color: "" },
            { label: "Active",            value: activeCount,             icon: CheckCircle2, color: "text-green-600" },
            { label: "Pro Subscribers",   value: proCount,                icon: Zap,          color: "text-primary" },
            { label: "On Trial",          value: trialCount,              icon: Zap,          color: "text-blue-500" },
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
          {(["restaurants", "coupons", "plans"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
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
          <div className="rounded-lg border overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Restaurant</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Sub Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Orders</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Active</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Password</th>
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
                        {(() => {
                          const isExpired = sub?.status === "expired" || sub?.status === "incomplete";
                          const isPaidPro = sub?.plan === "pro" && sub?.status === "active";
                          const isTrial   = sub?.status === "trialing";
                          return (
                            <Badge className={cn(
                              "text-xs",
                              isPaidPro  ? "bg-primary text-primary-foreground" :
                              isTrial    ? "bg-blue-500 text-white" :
                              isExpired  ? "bg-orange-100 text-orange-700 border border-orange-200" :
                              "bg-muted text-muted-foreground"
                            )}>
                              {isPaidPro ? "Pro" : isTrial ? "Trial" : isExpired ? "Expired" : "—"}
                            </Badge>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const status = sub?.status;
                          const isExpired = status === "expired" || status === "incomplete";
                          const label =
                            status === "active"    ? "Active" :
                            status === "trialing"  ? "Trial active" :
                            isExpired              ? "Trial expired" :
                            status === "past_due"  ? "Past due" :
                            status === "canceled"  ? "Canceled" :
                            "—";
                          const color =
                            status === "active"    ? "text-green-600" :
                            status === "trialing"  ? "text-blue-600"  :
                            isExpired              ? "text-orange-500":
                            status === "past_due"  ? "text-red-600"   :
                            "text-muted-foreground";
                          return (
                            <div>
                              <span className={cn("text-xs font-medium", color)}>{label}</span>
                              {sub?.current_period_end && (
                                <p className="text-[10px] text-muted-foreground">
                                  until {new Date(sub.current_period_end).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {orderCounts[r.id] ?? 0}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setConfirmTarget(r)}
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
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => { setPwTarget(r); setNewPassword(""); setPwResult(null); setShowPw(false); }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Change manager password"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No restaurants found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>)}

        {activeTab === "coupons" && (
          <CouponManager pin={pin} />
        )}

        {activeTab === "plans" && (
          <PlanManager pin={pin} />
        )}

      </main>
    </div>
  );
}
