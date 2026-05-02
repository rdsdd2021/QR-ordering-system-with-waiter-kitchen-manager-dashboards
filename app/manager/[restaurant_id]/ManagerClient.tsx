"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LayoutGrid, ClipboardList, UtensilsCrossed, Users, Settings,
  BarChart3, Layers, Table2, Store, Webhook, Tags, CreditCard,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { Restaurant } from "@/types/database";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { getSupabaseClient } from "@/lib/supabase";
import type { NavGroup } from "@/components/layout/AppSidebar";
import MenuManager from "@/components/manager/MenuManager";
import TableSessions from "@/components/manager/TableSessions";
import SettingsPanel from "@/components/manager/SettingsPanel";
import Analytics from "@/components/manager/Analytics";
import FloorsManager from "@/components/manager/FloorsManager";
import TablesManager from "@/components/manager/TablesManager";
import StaffManager from "@/components/manager/StaffManager";
import OrderLog from "@/components/manager/OrderLog";
import RestaurantDetails from "@/components/manager/RestaurantDetails";
import WebhooksManager from "@/components/manager/WebhooksManager";
import CategoryTagManager from "@/components/manager/CategoryTagManager";
import BillingPanel from "@/components/manager/BillingPanel";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Zap, Lock, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab =
  | "sessions" | "orderlog" | "analytics"
  | "menu" | "floors" | "categories"
  | "staff" | "tables"
  | "details" | "settings" | "webhooks" | "billing";

// ── Navigation ────────────────────────────────────────────────────────────────

function buildNavGroups(pendingCount: number, onOrdersBadgeClick: () => void): NavGroup[] {
  return [
    {
      label: "Operations",
      items: [
        { key: "sessions",  label: "Dashboard",   icon: LayoutGrid    },
        { key: "orderlog",  label: "Orders",       icon: ClipboardList, badge: pendingCount > 0 ? pendingCount : undefined, onBadgeClick: pendingCount > 0 ? onOrdersBadgeClick : undefined },
        { key: "analytics", label: "Analytics",    icon: BarChart3     },
      ],
    },
    {
      label: "Menu",
      items: [
        { key: "menu",       label: "Menu",        icon: UtensilsCrossed },
        { key: "categories", label: "Categories",  icon: Tags            },
        { key: "floors",     label: "Floors",      icon: Table2          },
      ],
    },
    {
      label: "Team & Setup",
      items: [
        { key: "staff",   label: "Staff",       icon: Users   },
        { key: "tables",  label: "Table Setup", icon: Layers  },
      ],
    },
    {
      label: "Account",
      items: [
        { key: "details",   label: "Restaurant",  icon: Store      },
        { key: "billing",   label: "Billing",     icon: CreditCard },
        { key: "settings",  label: "Settings",    icon: Settings   },
        { key: "webhooks",  label: "Integrations",icon: Webhook    },
      ],
    },
  ];
}

const MOBILE_TABS: Tab[] = ["sessions", "orderlog", "menu", "staff", "settings"];

const PAGE_META: Record<Tab, { title: string; description: string }> = {
  sessions:   { title: "Dashboard",          description: "Live overview of your restaurant" },
  orderlog:   { title: "Orders",             description: "Full order history and management" },
  analytics:  { title: "Analytics",          description: "Sales and performance metrics" },
  menu:       { title: "Menu",               description: "Manage your menu items and availability" },
  categories: { title: "Categories",         description: "Organize items into categories and tags" },
  floors:     { title: "Floors",             description: "Manage floors and table layout" },
  staff:      { title: "Staff",              description: "Manage your team accounts" },
  tables:     { title: "Table Setup",        description: "Configure tables and generate QR codes" },
  details:    { title: "Restaurant Details", description: "Edit your restaurant profile" },
  billing:    { title: "Billing & Subscription",  description: "Manage your plan, billing details and invoices" },
  settings:   { title: "Settings",           description: "Order routing, preferences & activity log" },
  webhooks:   { title: "Integrations",       description: "Connect to external services" },
};

// ── Mobile bottom nav ─────────────────────────────────────────────────────────

function MobileBottomNav({ activeTab, onNavigate, navGroups }: { activeTab: Tab; onNavigate: (t: Tab) => void; navGroups: NavGroup[] }) {
  const items = navGroups.flatMap(g => g.items).filter(i => MOBILE_TABS.includes(i.key as Tab));
  return (
    <div className="flex">
      {items.map(({ key, label, icon: Icon }) => {
        const active = activeTab === key;
        return (
          <button
            key={key}
            onClick={() => onNavigate(key as Tab)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = { restaurant: Restaurant };

function ManagerClientContent({ restaurant }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(
    (searchParams.get("tab") as Tab) ?? "sessions"
  );
  const [billReadyFilter, setBillReadyFilter] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  }
  const { signOut, profile } = useAuth();
  const { isPro, isTrial, isExpired, trialEndsAt, subscription } = useSubscription(restaurant.id);
  const meta = PAGE_META[activeTab];

  // Compute days until subscription expiry for the renewal warning banner
  const daysUntilExpiry: number | null = (() => {
    if (!subscription?.current_period_end) return null;
    const msLeft = new Date(subscription.current_period_end).getTime() - Date.now();
    return Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  })();

  // Live pending order count for the Orders nav badge
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    async function loadPending() {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurant.id)
        .in("status", ["pending", "pending_waiter", "confirmed", "preparing", "ready"]);
      setPendingCount(count ?? 0);
    }
    loadPending();
    const channel = supabase
      .channel(`manager-badge:${restaurant.id}:${Date.now()}`)
      .on("postgres_changes" as any,
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurant.id}` },
        loadPending)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [restaurant.id]);

  const navGroups = buildNavGroups(pendingCount, () => {
    handleTabChange("sessions");
    setBillReadyFilter(true);
  });

  const planLabel = isTrial ? "Trial" : isPro ? "Pro" : isExpired ? "Trial Expired" : "Trial Expired";
  const planRenewal = isTrial && trialEndsAt
    ? `Trial ends ${new Date(trialEndsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
    : subscription?.current_period_end
      ? new Date(subscription.current_period_end).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : undefined;

  async function handleLogoUpload(file: File) {
    const supabase = getSupabaseClient();
    const ext = file.name.split(".").pop();
    const path = `${restaurant.id}/logo.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("restaurant-logos")
      .upload(path, file, { upsert: true });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from("restaurant-logos").getPublicUrl(path);
    await supabase
      .from("restaurants")
      .update({ logo_url: data.publicUrl })
      .eq("id", restaurant.id);
    // Force a page refresh so the new logo is reflected in the server component
    window.location.reload();
  }

  return (
    <DashboardShell
      restaurant={restaurant}
      navGroups={navGroups}
      activeTab={activeTab}
      onNavigate={(tab) => handleTabChange(tab as Tab)}
      pageTitle={meta.title}
      pageDescription={meta.description}
      planLabel={planLabel}
      planRenewal={planRenewal}
      profileName={profile?.name ?? "Manager"}
      profileRole="Manager"
      notificationCount={pendingCount}
      onSignOut={signOut}
      onManagePlan={() => handleTabChange("billing")}
      onLogoUpload={handleLogoUpload}
      maxWidth={activeTab === "sessions" || activeTab === "orderlog" ? "full" : activeTab === "billing" ? "2xl" : "xl"}
      mobileNav={<MobileBottomNav activeTab={activeTab} onNavigate={handleTabChange} navGroups={navGroups} />}
    >
      {/* Expiry warning banner — shown when Pro subscription expires within 7 days */}
      {isPro && !isExpired && !bannerDismissed && daysUntilExpiry !== null && daysUntilExpiry <= 7 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 mb-4 text-sm text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Your Pro subscription expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? "s" : ""}.{" "}
              <button
                onClick={() => handleTabChange("billing")}
                className="underline underline-offset-2 font-medium hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
              >
                Go to Billing to renew.
              </button>
            </span>
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss expiry warning"
            className="shrink-0 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Expired paywall — only Billing and Restaurant Details remain accessible */}
      {isExpired && activeTab !== "billing" && activeTab !== "details" ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-6 px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
            <Lock className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold">Your trial has ended</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Upgrade to Pro to continue using your dashboard. Your data is safe and will be restored immediately after payment.
            </p>
          </div>
          <Button onClick={() => handleTabChange("billing")} size="lg" className="gap-2">
            <Zap className="h-4 w-4" />
            View Plans
          </Button>
        </div>
      ) : (
        <>
          {activeTab === "sessions"   && (
            <ErrorBoundary label="Dashboard">
              <TableSessions
                restaurantId={restaurant.id}
                billReadyFilter={billReadyFilter}
                onBillReadyFilterClear={() => setBillReadyFilter(false)}
              />
            </ErrorBoundary>
          )}
          {activeTab === "orderlog"   && <ErrorBoundary label="Orders"><OrderLog restaurantId={restaurant.id} /></ErrorBoundary>}
          {activeTab === "analytics"  && <ErrorBoundary label="Analytics"><Analytics restaurantId={restaurant.id} /></ErrorBoundary>}
          {activeTab === "menu"       && <ErrorBoundary label="Menu"><MenuManager restaurantId={restaurant.id} /></ErrorBoundary>}
          {activeTab === "categories" && <ErrorBoundary label="Categories"><CategoryTagManager restaurantId={restaurant.id} /></ErrorBoundary>}
          {activeTab === "floors"     && <ErrorBoundary label="Floors"><FloorsManager restaurantId={restaurant.id} /></ErrorBoundary>}
          {activeTab === "staff"      && <ErrorBoundary label="Staff"><StaffManager restaurantId={restaurant.id} /></ErrorBoundary>}
          {activeTab === "tables"     && <ErrorBoundary label="Table Setup"><TablesManager restaurantId={restaurant.id} restaurantName={restaurant.name} /></ErrorBoundary>}
          {activeTab === "details"    && <ErrorBoundary label="Restaurant Details"><RestaurantDetails restaurant={restaurant} /></ErrorBoundary>}
          {activeTab === "billing"    && (
            <ErrorBoundary label="Billing">
              <BillingPanel restaurantId={restaurant.id} restaurantName={restaurant.name} />
            </ErrorBoundary>
          )}
          {activeTab === "settings"   && (
            <ErrorBoundary label="Settings">
              <SettingsPanel
                restaurantId={restaurant.id}
                currentRoutingMode={restaurant.order_routing_mode || "direct_to_kitchen"}
                currentAssignmentMode={restaurant.waiter_assignment_mode || "auto_assign"}
                geofencingEnabled={restaurant.geofencing_enabled ?? false}
                geoLatitude={restaurant.geo_latitude ?? null}
                geoLongitude={restaurant.geo_longitude ?? null}
                geoRadiusMeters={restaurant.geo_radius_meters ?? 100}
                autoConfirmMinutes={restaurant.auto_confirm_minutes ?? null}
              />
            </ErrorBoundary>
          )}
          {activeTab === "webhooks"   && <ErrorBoundary label="Integrations"><WebhooksManager restaurantId={restaurant.id} /></ErrorBoundary>}
        </>
      )}
    </DashboardShell>
  );
}

export default function ManagerClient({ restaurant }: Props) {
  return (
    <ProtectedRoute requiredRole="manager" restaurantId={restaurant.id}>
      <ManagerClientContent restaurant={restaurant} />
    </ProtectedRoute>
  );
}
