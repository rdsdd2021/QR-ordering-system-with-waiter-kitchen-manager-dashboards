"use client";

import { useState } from "react";
import {
  LayoutGrid, ClipboardList, UtensilsCrossed, Users, Settings,
  LogOut, ChevronRight, Menu, X, BarChart3, Layers, Table2, Store, Webhook,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import type { Restaurant } from "@/types/database";
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
import ProtectedRoute from "@/components/ProtectedRoute";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab =
  | "sessions" | "orderlog" | "analytics"
  | "menu" | "floors"
  | "staff" | "tables"
  | "details" | "settings" | "webhooks";

type NavGroup = {
  label: string;
  items: NavItem[];
};

type NavItem = {
  key: Tab;
  label: string;
  icon: React.ElementType;
  mobileLabel?: string;
};

// ── Navigation structure ──────────────────────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { key: "sessions",  label: "Live Tables",  icon: LayoutGrid,    mobileLabel: "Tables"  },
      { key: "orderlog",  label: "Order Log",    icon: ClipboardList, mobileLabel: "Orders"  },
      { key: "analytics", label: "Analytics",    icon: BarChart3,     mobileLabel: "Stats"   },
    ],
  },
  {
    label: "Menu",
    items: [
      { key: "menu",   label: "Menu Items", icon: UtensilsCrossed, mobileLabel: "Menu" },
      { key: "floors", label: "Floors",     icon: Layers },
    ],
  },
  {
    label: "Team & Setup",
    items: [
      { key: "staff",  label: "Staff",       icon: Users,  mobileLabel: "Staff" },
      { key: "tables", label: "Table Setup", icon: Table2 },
    ],
  },
  {
    label: "Restaurant",
    items: [
      { key: "details",  label: "Details",  icon: Store    },
      { key: "settings", label: "Settings", icon: Settings },
      { key: "webhooks", label: "Webhooks", icon: Webhook  },
    ],
  },
];

// Bottom nav shows only the 5 most-used items on mobile
const MOBILE_NAV: NavItem[] = [
  { key: "sessions",  label: "Tables",   icon: LayoutGrid    },
  { key: "orderlog",  label: "Orders",   icon: ClipboardList },
  { key: "menu",      label: "Menu",     icon: UtensilsCrossed },
  { key: "staff",     label: "Staff",    icon: Users         },
  { key: "settings",  label: "Settings", icon: Settings      },
];

// ── Page title map ────────────────────────────────────────────────────────────

const PAGE_TITLE: Record<Tab, string> = {
  sessions:  "Live Tables",
  orderlog:  "Order Log",
  analytics: "Analytics",
  menu:      "Menu Items",
  floors:    "Floors & Sections",
  staff:     "Staff",
  tables:    "Table Setup",
  details:   "Restaurant Details",
  settings:  "Settings",
  webhooks:  "Webhooks",
};

const PAGE_DESC: Record<Tab, string> = {
  sessions:  "Active table sessions and billing",
  orderlog:  "Full order lifecycle and timing",
  analytics: "Sales and performance metrics",
  menu:      "Manage your menu items",
  floors:    "Floors and pricing multipliers",
  staff:     "Waiter accounts and availability",
  tables:    "Table configuration and QR codes",
  details:   "Restaurant name and URL",
  settings:  "Order routing and geo-fencing",
  webhooks:  "Connect to external apps and services",
};

// ── Main component ────────────────────────────────────────────────────────────

type Props = { restaurant: Restaurant };

function ManagerClientContent({ restaurant }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("sessions");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { signOut, profile } = useAuth();

  function navigate(tab: Tab) {
    setActiveTab(tab);
    setSidebarOpen(false);
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">

      {/* ── Sidebar (desktop always visible, mobile as drawer) ─────── */}
      <>
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card transition-transform duration-200 lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          {/* Brand */}
          <div className="flex h-14 items-center gap-2.5 border-b px-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shrink-0">
              <Store className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm truncate leading-tight">{restaurant.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{profile?.name}</p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-muted-foreground hover:text-foreground p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Nav groups */}
          <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-5">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map(({ key, label, icon: Icon }) => {
                    const active = activeTab === key;
                    return (
                      <button
                        key={key}
                        onClick={() => navigate(key)}
                        className={cn(
                          "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors text-left",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{label}</span>
                        {active && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Sign out */}
          <div className="border-t p-3">
            <button
              onClick={signOut}
              className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Sign out
            </button>
          </div>
        </aside>
      </>

      {/* ── Main content area ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className="flex h-14 items-center gap-3 border-b bg-background/95 backdrop-blur px-4 shrink-0">
          {/* Mobile menu toggle */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-muted-foreground hover:text-foreground p-1 -ml-1"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Page title */}
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm leading-tight">{PAGE_TITLE[activeTab]}</h1>
            <p className="text-[11px] text-muted-foreground hidden sm:block">{PAGE_DESC[activeTab]}</p>
          </div>

          {/* Breadcrumb on desktop */}
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{restaurant.name}</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{PAGE_TITLE[activeTab]}</span>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-4 py-6 pb-24 lg:pb-6">
            {activeTab === "sessions"  && <TableSessions restaurantId={restaurant.id} />}
            {activeTab === "orderlog"  && <OrderLog restaurantId={restaurant.id} />}
            {activeTab === "analytics" && <Analytics restaurantId={restaurant.id} />}
            {activeTab === "menu"      && <MenuManager restaurantId={restaurant.id} />}
            {activeTab === "floors"    && <FloorsManager restaurantId={restaurant.id} />}
            {activeTab === "staff"     && <StaffManager restaurantId={restaurant.id} />}
            {activeTab === "tables"    && <TablesManager restaurantId={restaurant.id} restaurantName={restaurant.name} />}
            {activeTab === "details"   && <RestaurantDetails restaurant={restaurant} />}
            {activeTab === "settings"  && (
              <SettingsPanel
                restaurantId={restaurant.id}
                currentRoutingMode={restaurant.order_routing_mode || "direct_to_kitchen"}
                geofencingEnabled={restaurant.geofencing_enabled ?? false}
                geoLatitude={restaurant.geo_latitude ?? null}
                geoLongitude={restaurant.geo_longitude ?? null}
                geoRadiusMeters={restaurant.geo_radius_meters ?? 100}
              />
            )}
            {activeTab === "webhooks"  && <WebhooksManager restaurantId={restaurant.id} />}
          </div>
        </main>

        {/* ── Mobile bottom nav ──────────────────────────────────── */}
        <nav className="lg:hidden border-t bg-background/95 backdrop-blur shrink-0">
          <div className="flex">
            {MOBILE_NAV.map(({ key, label, icon: Icon }) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  onClick={() => navigate(key)}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

export default function ManagerClient({ restaurant }: Props) {
  return (
    <ProtectedRoute requiredRole="manager" restaurantId={restaurant.id}>
      <ManagerClientContent restaurant={restaurant} />
    </ProtectedRoute>
  );
}
