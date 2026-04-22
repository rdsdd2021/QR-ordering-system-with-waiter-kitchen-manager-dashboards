"use client";

import { cn } from "@/lib/utils";
import { Menu, Search, Bell, ChevronDown, Command } from "lucide-react";
import type { ReactNode } from "react";

interface AppHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  onMenuToggle?: () => void;
  profileName?: string;
  profileRole?: string;
  notificationCount?: number;
  className?: string;
}

function ProfileAvatar({ name }: { name: string }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
      <span className="text-white text-xs font-bold">{initials}</span>
    </div>
  );
}

export function AppHeader({
  title, description, actions, onMenuToggle,
  profileName = "User", profileRole = "Manager",
  notificationCount = 0, className,
}: AppHeaderProps) {
  return (
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

      {/* Search bar — desktop */}
      <div className="hidden md:flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 w-52 lg:w-64 border border-border">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground flex-1">Search anything...</span>
        <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60 font-mono">
          <Command className="h-2.5 w-2.5" />
          <span>K</span>
        </div>
      </div>

      {/* Actions slot */}
      {actions && <div className="hidden sm:flex items-center gap-2">{actions}</div>}

      {/* Notifications */}
      <button className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
        <Bell className="h-4.5 w-4.5" />
        {notificationCount > 0 && (
          <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {notificationCount > 9 ? "9+" : notificationCount}
          </span>
        )}
      </button>

      {/* Profile */}
      <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted transition-colors">
        <ProfileAvatar name={profileName} />
        <div className="hidden sm:block text-left">
          <p className="text-xs font-semibold text-foreground leading-tight">{profileName}</p>
          <p className="text-[10px] text-muted-foreground">{profileRole}</p>
        </div>
        <ChevronDown className="hidden sm:block h-3 w-3 text-muted-foreground" />
      </button>
    </header>
  );
}
