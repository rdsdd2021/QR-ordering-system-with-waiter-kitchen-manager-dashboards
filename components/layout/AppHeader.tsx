"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import {
  Menu, Search, Bell, ChevronDown, Command,
  LogOut, User, X,
  LayoutGrid, ClipboardList, UtensilsCrossed, Users, Settings,
  BarChart3, Layers, Table2, Store, Webhook, Tags, CreditCard,
} from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  onMenuToggle?: () => void;
  profileName?: string;
  profileRole?: string;
  notificationCount?: number;
  className?: string;
  onSignOut?: () => void;
  onNavigate?: (tab: string) => void;
}

// ── Command palette items ─────────────────────────────────────────────────────

const SEARCH_ITEMS = [
  { key: "sessions",   label: "Dashboard",          icon: LayoutGrid,    group: "Operations" },
  { key: "orderlog",   label: "Orders",             icon: ClipboardList, group: "Operations" },
  { key: "analytics",  label: "Analytics",          icon: BarChart3,     group: "Operations" },
  { key: "menu",       label: "Menu",               icon: UtensilsCrossed, group: "Menu"     },
  { key: "categories", label: "Categories",         icon: Tags,          group: "Menu"       },
  { key: "floors",     label: "Tables",             icon: Table2,        group: "Menu"       },
  { key: "staff",      label: "Staff",              icon: Users,         group: "Team"       },
  { key: "tables",     label: "Table Setup",        icon: Layers,        group: "Team"       },
  { key: "details",    label: "Restaurant Details", icon: Store,         group: "Account"    },
  { key: "billing",    label: "Billing",            icon: CreditCard,    group: "Account"    },
  { key: "settings",   label: "Settings",           icon: Settings,      group: "Account"    },
  { key: "webhooks",   label: "Integrations",       icon: Webhook,       group: "Account"    },
];

// ── Profile avatar ────────────────────────────────────────────────────────────

function ProfileAvatar({ name }: { name: string }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
      <span className="text-white text-xs font-bold">{initials}</span>
    </div>
  );
}

// ── Command palette ───────────────────────────────────────────────────────────

function CommandPalette({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate?: (tab: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const filtered = query.trim()
    ? SEARCH_ITEMS.filter(i =>
        i.label.toLowerCase().includes(query.toLowerCase()) ||
        i.group.toLowerCase().includes(query.toLowerCase())
      )
    : SEARCH_ITEMS;

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && filtered[cursor]) { select(filtered[cursor].key); }
    if (e.key === "Escape") onClose();
  }

  function select(key: string) {
    onNavigate?.(key);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 bg-card rounded-xl border border-border shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={handleKey}
            placeholder="Search pages..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No results</p>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  onClick={() => select(item.key)}
                  onMouseEnter={() => setCursor(i)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left",
                    cursor === i ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-[10px] text-muted-foreground/60">{item.group}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground">
          <span><kbd className="border border-border rounded px-1">↑↓</kbd> navigate</span>
          <span><kbd className="border border-border rounded px-1">↵</kbd> open</span>
          <span><kbd className="border border-border rounded px-1">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

// ── Profile dropdown ──────────────────────────────────────────────────────────

function ProfileDropdown({
  name,
  role,
  onSignOut,
  onClose,
}: {
  name: string;
  role: string;
  onSignOut?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
      {/* User info */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground capitalize">{role}</p>
      </div>

      {/* Actions */}
      <div className="py-1">
        <button
          onClick={() => { onSignOut?.(); onClose(); }}
          className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

// ── Main header ───────────────────────────────────────────────────────────────

export function AppHeader({
  title, description, actions, onMenuToggle,
  profileName = "User", profileRole = "Manager",
  notificationCount = 0, className, onSignOut, onNavigate,
}: AppHeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(v => !v);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    if (profileOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [profileOpen]);

  return (
    <>
      <header className={cn(
        "flex h-14 items-center gap-3 border-b border-border bg-card px-4 shrink-0",
        className
      )}>
        {/* Mobile menu toggle */}
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="lg:hidden text-muted-foreground hover:text-foreground p-1 -ml-1"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        {/* Page title */}
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-base text-foreground leading-tight">{title}</h1>
          {description && (
            <p className="text-xs text-muted-foreground hidden sm:block">{description}</p>
          )}
        </div>

        {/* Search bar */}
        <button
          onClick={() => setSearchOpen(true)}
          className="hidden md:flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 w-52 lg:w-64 border border-border hover:border-primary/40 transition-colors"
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground flex-1 text-left">Search anything...</span>
          <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60 font-mono">
            <Command className="h-2.5 w-2.5" />
            <span>K</span>
          </div>
        </button>

        {/* Actions slot */}
        {actions && <div className="hidden sm:flex items-center gap-2">{actions}</div>}

        {/* Theme toggle */}
        <ThemeToggle />

        {/* Notifications — only show badge if there are real notifications */}
        <button className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
          <Bell className="h-4.5 w-4.5" />
          {notificationCount > 0 && (
            <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center leading-none">
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </button>

        {/* Profile dropdown */}
        <div ref={profileRef} className="relative">
          <button
            onClick={() => setProfileOpen(v => !v)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted transition-colors"
          >
            <ProfileAvatar name={profileName} />
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold text-foreground leading-tight">{profileName}</p>
              <p className="text-[10px] text-muted-foreground">{profileRole}</p>
            </div>
            <ChevronDown className={cn(
              "hidden sm:block h-3 w-3 text-muted-foreground transition-transform",
              profileOpen && "rotate-180"
            )} />
          </button>

          {profileOpen && (
            <ProfileDropdown
              name={profileName}
              role={profileRole}
              onSignOut={onSignOut}
              onClose={() => setProfileOpen(false)}
            />
          )}
        </div>
      </header>

      {/* Command palette */}
      <CommandPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={onNavigate}
      />
    </>
  );
}
