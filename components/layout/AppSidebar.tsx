"use client";

import { cn } from "@/lib/utils";
import { useState, useRef } from "react";
import { X, Crown, HeadphonesIcon, ChevronDown, ChevronRight, Camera, LogOut } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Restaurant } from "@/types/database";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  badge?: number | string;
  children?: NavItem[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

interface AppSidebarProps {
  restaurant: Restaurant;
  navGroups: NavGroup[];
  activeTab: string;
  onNavigate: (tab: string) => void;
  onClose?: () => void;
  planLabel?: string;
  planRenewal?: string;
  profileName?: string;
  profileRole?: string;
  onManagePlan?: () => void;
  onSignOut?: () => void;
  onLogoUpload?: (file: File) => Promise<void>;
}

// ── Restaurant avatar / logo ──────────────────────────────────────────────────

function RestaurantLogo({
  name, logoUrl, onUpload,
}: {
  name: string;
  logoUrl?: string | null;
  onUpload?: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;
    setUploading(true);
    try { await onUpload(file); } finally { setUploading(false); }
    // reset so same file can be re-selected
    e.target.value = "";
  }

  return (
    <div className="relative group shrink-0">
      <div className="h-10 w-10 rounded-lg overflow-hidden bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-white font-bold text-sm">{name.slice(0, 2).toUpperCase()}</span>
        )}
      </div>
      {onUpload && (
        <>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="absolute inset-0 rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            title="Upload logo"
          >
            <Camera className="h-3.5 w-3.5 text-white" />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleChange}
          />
        </>
      )}
    </div>
  );
}

// ── Nav item ──────────────────────────────────────────────────────────────────

function NavItemButton({
  item, active, onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-150 text-left group",
        active
          ? "nav-active"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
      <span className="flex-1 truncate font-medium">{item.label}</span>
      {item.badge !== undefined && (
        <span className={cn(
          "text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none",
          active ? "bg-primary text-white" : "bg-muted-foreground/20 text-muted-foreground"
        )}>
          {item.badge}
        </span>
      )}
      {active && !item.badge && <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />}
    </button>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export function AppSidebar({
  restaurant, navGroups, activeTab, onNavigate, onClose,
  planLabel = "Free Plan", planRenewal, profileName, profileRole,
  onManagePlan, onSignOut, onLogoUpload,
}: AppSidebarProps) {
  const isPro = planLabel.toLowerCase().includes("pro");
  const [showPlanCard, setShowPlanCard] = useState(true);
  const [showSupportCard, setShowSupportCard] = useState(true);

  return (
    <aside className="flex h-full w-64 flex-col bg-card border-r border-border">

      {/* ── Restaurant info ───────────────────────────────────────── */}
      <div className="px-3 pt-4 pb-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 p-2">
          <RestaurantLogo
            name={restaurant.name}
            logoUrl={restaurant.logo_url}
            onUpload={onLogoUpload}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate leading-tight">{restaurant.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">ID: {restaurant.id.slice(0, 12)}</p>
          </div>
          {onClose ? (
            <button onClick={onClose} className="lg:hidden text-muted-foreground hover:text-foreground p-1 shrink-0">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
        </div>
        {/* Plan badge */}
        <div className="mt-2 px-2">
          <span className={isPro ? "plan-badge-pro" : "plan-badge-free"}>
            {isPro && "✦ "}{planLabel}
          </span>
        </div>
      </div>

      {/* ── Navigation ───────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 select-none">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItemButton
                  key={item.key}
                  item={item}
                  active={activeTab === item.key}
                  onClick={() => onNavigate(item.key)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Pro plan upsell / renewal ─────────────────────────────── */}
      {showPlanCard && (isPro ? (
        <div className="mx-3 mb-3 rounded-xl bg-gradient-to-br from-primary/10 to-orange/10 border border-primary/20 p-3 shrink-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Crown className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary flex-1">You&apos;re on Pro Plan</span>
            <button onClick={() => setShowPlanCard(false)} className="text-primary/50 hover:text-primary transition-colors p-0.5 rounded">
              <X className="h-3 w-3" />
            </button>
          </div>
          {planRenewal && (
            <p className="text-[11px] text-muted-foreground mb-2">Your plan renews on<br /><span className="font-medium text-foreground">{planRenewal}</span></p>
          )}
          {onManagePlan && (
            <button
              onClick={onManagePlan}
              className="w-full text-xs font-semibold text-primary border border-primary/40 rounded-lg py-1.5 hover:bg-primary hover:text-white transition-colors"
            >
              Manage Plan
            </button>
          )}
        </div>
      ) : (
        <div className="mx-3 mb-3 rounded-xl bg-muted/60 border border-border p-3 shrink-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="text-xs font-semibold text-foreground flex-1">Upgrade to Pro</p>
            <button onClick={() => setShowPlanCard(false)} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
              <X className="h-3 w-3" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">Unlimited tables & menu items</p>
          {onManagePlan && (
            <button
              onClick={onManagePlan}
              className="w-full text-xs font-semibold bg-primary text-white rounded-lg py-1.5 hover:bg-primary/90 transition-colors"
            >
              Upgrade Now
            </button>
          )}
        </div>
      ))}

      {/* ── Support ──────────────────────────────────────────────── */}
      {showSupportCard && (
        <div className="border-t border-border p-3 shrink-0">
          <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
            <HeadphonesIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground">Need Help?</p>
              <p className="text-[10px] text-muted-foreground">We&apos;re here to help you</p>
            </div>
            <button onClick={() => setShowSupportCard(false)} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded shrink-0">
              <X className="h-3 w-3" />
            </button>
          </div>
          <button className="w-full text-xs font-medium text-muted-foreground border border-border rounded-lg py-1.5 hover:bg-muted hover:text-foreground transition-colors">
            Contact Support
          </button>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────── */}
      <div className="px-3 py-3 border-t border-border shrink-0 space-y-1">
        {onSignOut && (
          <button
            onClick={onSignOut}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        )}
        <p className="text-[10px] text-muted-foreground/60 text-center pt-1">© 2025 QR Order · All rights reserved</p>
      </div>
    </aside>
  );
}
