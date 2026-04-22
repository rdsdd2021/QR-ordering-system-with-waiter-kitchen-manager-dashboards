"use client";

import { useState } from "react";
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
import UpgradeBanner from "@/components/manager/UpgradeBanner";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSubscription } from "@/hooks/useSubscription";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab =
  | "sessions" | "orderlog" | "analytics"
  | "menu" | "floors" | "categories"
  | "staff" | "tables"
  | "details" | "settings" | "webhooks" | "billing";

// ── Navigation ────────────────────────────────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { key: "sessions",  label: "Dashboard",   icon: LayoutGrid    },
      { key: "orderlog",  label: "Orders",       icon: ClipboardList, badge: 12 },
      { key: "analytics", label: "Analytics",    icon: BarChart3     },
    ],
  },
  {
    label: "Menu",
    items: [
      { key: "menu",       label: "Menu",        icon: UtensilsCrossed },
      { key: "categories", label: "Categories",  icon: Tags            },
      { key: "floors",     label: "Tables",      icon: Table2          },
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
      { key: "details",  label: "Restaurant",  icon: Store      },
      { key: "billing",  label: "Billing",     icon: CreditCard },
      { key: "settings", label: "Settings",    icon: Settings   },
      { key: "webhooks", label: "Integrations",icon: Webhook    },
    ],
  },
];

const MOBILE_TABS: Tab[] = ["sessions", "orderlog", "menu", "staff", "settings"];

const PAGE_META: Record<Tab, { title: string; description: string }> = {
  sessions:   { title: "Dashboard",          description: "Live overview of your restaurant" },
  orderlog:   { title: "Orders",             description: "Full order history and management" },
  analytics:  { title: "Analytics",          description: "Sales and performance metrics" },
  menu:       { title: "Menu",               description: "Manage your menu items and availability" },
  categories: { title: "Categories",         description: "Organize items into categories and tags" },
  floors:     { title: "Tables",             description: "Floor plan and table management" },
  staff:      { title: "Staff",              description: "Manage your team accounts" },
  tables:     { title: "Table Setup",        description: "Configure tables and generate QR codes" },
  details:    { title: "Restaurant Details", description: "Edit your restaurant profile" },
  billing:    { title: "Billing",            description: "Subscription and payment management" },
  settings:   { title: "Settings",           description: "Order routing and preferences" },
  webhooks:   { title: "Integrations",       description: "Connect to external services" },
};

// ── Mobile bottom nav ─────────────────────────────────────────────────────────

function MobileBottomNav({ activeTab, onNavigate }: { activeTab: Tab; onNavigate: (t: Tab) => void }) {
  const items = NAV_GROUPS.flatMap(g => g.items).filter(i => MOBILE_TABS.includes(i.key as Tab));
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
  const [activeTab, setActiveTab] = useState<Tab>("sessions");
  const { signOut, profile } = useAuth();
  const { isPro, subscription } = useSubscription(restaurant.id);
  const meta = PAGE_META[activeTab];

  const planLabel = isPro ? "Pro Plan" : "Free Plan";
  const planRenewal = subscription?.current_period_end
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
      navGroups={NAV_GROUPS}
      activeTab={activeTab}
      onNavigate={(tab) => setActiveTab(tab as Tab)}
      pageTitle={meta.title}
      pageDescription={meta.description}
      planLabel={planLabel}
      planRenewal={planRenewal}
      profileName={profile?.name ?? "Manager"}
      profileRole="Manager"
      notificationCount={3}
      onManagePlan={() => setActiveTab("billing")}
      onLogoUpload={handleLogoUpload}
      maxWidth={activeTab === "sessions" || activeTab === "orderlog" ? "full" : "xl"}
      mobileNav={<MobileBottomNav activeTab={activeTab} onNavigate={setActiveTab} />}
    >
      {activeTab === "sessions"   && <TableSessions restaurantId={restaurant.id} />}
      {activeTab === "orderlog"   && <OrderLog restaurantId={restaurant.id} />}
      {activeTab === "analytics"  && <Analytics restaurantId={restaurant.id} />}
      {activeTab === "menu"       && <MenuManager restaurantId={restaurant.id} />}
      {activeTab === "categories" && <CategoryTagManager restaurantId={restaurant.id} />}
      {activeTab === "floors"     && <FloorsManager restaurantId={restaurant.id} />}
      {activeTab === "staff"      && <StaffManager restaurantId={restaurant.id} />}
      {activeTab === "tables"     && <TablesManager restaurantId={restaurant.id} restaurantName={restaurant.name} />}
      {activeTab === "details"    && <RestaurantDetails restaurant={restaurant} />}
      {activeTab === "billing"    && (
        <div className="space-y-8 max-w-2xl">
          <div>
            <h2 className="text-lg font-semibold">Billing</h2>
            <p className="text-sm text-muted-foreground">Manage your subscription and payment details</p>
          </div>
          <UpgradeBanner restaurantId={restaurant.id} />
        </div>
      )}
      {activeTab === "settings"   && (
        <SettingsPanel
          restaurantId={restaurant.id}
          currentRoutingMode={restaurant.order_routing_mode || "direct_to_kitchen"}
          geofencingEnabled={restaurant.geofencing_enabled ?? false}
          geoLatitude={restaurant.geo_latitude ?? null}
          geoLongitude={restaurant.geo_longitude ?? null}
          geoRadiusMeters={restaurant.geo_radius_meters ?? 100}
        />
      )}
      {activeTab === "webhooks"   && <WebhooksManager restaurantId={restaurant.id} />}
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
