"use client";

import { useState } from "react";
import { Settings, UtensilsCrossed, BarChart3, LogOut, Layers, Users, Table2, LayoutList, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import ProtectedRoute from "@/components/ProtectedRoute";

type Props = { restaurant: Restaurant };

type Tab = "analytics" | "sessions" | "orderlog" | "menu" | "floors" | "tables" | "staff" | "settings" | "details";

const TABS: Array<{ key: Tab; label: string; icon: typeof UtensilsCrossed }> = [
  { key: "analytics", label: "Analytics",     icon: BarChart3 },
  { key: "sessions",  label: "Tables",        icon: LayoutList },
  { key: "orderlog",  label: "Order Log",     icon: LayoutList },
  { key: "menu",      label: "Menu",          icon: UtensilsCrossed },
  { key: "floors",    label: "Floors",        icon: Layers },
  { key: "tables",    label: "Table Setup",   icon: Table2 },
  { key: "staff",     label: "Staff",         icon: Users },
  { key: "details",   label: "Restaurant",    icon: Store },
  { key: "settings",  label: "Settings",      icon: Settings },
];

// Use different icons per tab
const TAB_ICONS: Record<Tab, typeof UtensilsCrossed> = {
  analytics: BarChart3,
  sessions:  LayoutList,
  orderlog:  LayoutList,
  menu:      UtensilsCrossed,
  floors:    Layers,
  tables:    Table2,
  staff:     Users,
  details:   Store,
  settings:  Settings,
};

function ManagerClientContent({ restaurant }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("sessions");
  const { signOut, profile } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-semibold tracking-tight">{restaurant.name}</h1>
              <p className="text-xs text-muted-foreground">
                Manager Dashboard • {profile?.name}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>

          <div className="mt-4 flex gap-1.5 overflow-x-auto pb-0.5">
            {TABS.map(({ key, label }) => {
              const Icon = TAB_ICONS[key];
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap",
                    activeTab === key
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="flex-1 p-4">
        {activeTab === "analytics" && <Analytics restaurantId={restaurant.id} />}
        {activeTab === "sessions"  && <TableSessions restaurantId={restaurant.id} />}
        {activeTab === "orderlog"  && <OrderLog restaurantId={restaurant.id} />}
        {activeTab === "menu"      && <MenuManager restaurantId={restaurant.id} />}
        {activeTab === "floors"    && <FloorsManager restaurantId={restaurant.id} />}
        {activeTab === "tables"    && <TablesManager restaurantId={restaurant.id} restaurantName={restaurant.name} />}
        {activeTab === "staff"     && <StaffManager restaurantId={restaurant.id} />}
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
      </main>
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
