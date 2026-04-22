"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { AppSidebar, type NavGroup } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import type { Restaurant } from "@/types/database";
import type { ReactNode } from "react";

interface DashboardShellProps {
  restaurant: Restaurant;
  navGroups: NavGroup[];
  activeTab: string;
  onNavigate: (tab: string) => void;
  pageTitle: string;
  pageDescription?: string;
  headerActions?: ReactNode;
  mobileNav?: ReactNode;
  children: ReactNode;
  planLabel?: string;
  planRenewal?: string;
  profileName?: string;
  profileRole?: string;
  notificationCount?: number;
  onManagePlan?: () => void;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  onLogoUpload?: (file: File) => Promise<void>;
}

const MAX_WIDTH_MAP = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
  "2xl": "max-w-7xl",
  full: "max-w-full",
};

export function DashboardShell({
  restaurant, navGroups, activeTab, onNavigate,
  pageTitle, pageDescription, headerActions, mobileNav,
  children, planLabel, planRenewal, profileName, profileRole,
  notificationCount, onManagePlan, maxWidth = "xl", onLogoUpload,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={cn(
        "fixed inset-y-0 left-0 lg:static lg:translate-x-0 transition-transform duration-200",
        "z-50 lg:z-auto",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <AppSidebar
          restaurant={restaurant}
          navGroups={navGroups}
          activeTab={activeTab}
          onNavigate={(tab) => { onNavigate(tab); setSidebarOpen(false); }}
          onClose={() => setSidebarOpen(false)}
          planLabel={planLabel}
          planRenewal={planRenewal}
          profileName={profileName}
          profileRole={profileRole}
          onManagePlan={onManagePlan}
          onLogoUpload={onLogoUpload}
        />
      </div>

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <AppHeader
          title={pageTitle}
          description={pageDescription}
          actions={headerActions}
          onMenuToggle={() => setSidebarOpen(true)}
          profileName={profileName}
          profileRole={profileRole}
          notificationCount={notificationCount}
        />

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-background">
          <div className={cn(
            "mx-auto pb-24 lg:pb-8 px-6 py-5",
            MAX_WIDTH_MAP[maxWidth]
          )}>
            {children}
          </div>
        </main>

        {/* Mobile bottom nav */}
        {mobileNav && (
          <nav className="lg:hidden border-t border-border bg-card shrink-0">
            {mobileNav}
          </nav>
        )}
      </div>
    </div>
  );
}
