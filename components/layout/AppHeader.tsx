"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { Menu, LogOut } from "lucide-react";
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
  className?: string;
  onSignOut?: () => void;
}

// ── Profile avatar ────────────────────────────────────────────────────────────

function ProfileAvatar({ name }: { name: string }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
      <span className="text-primary-foreground text-xs font-bold">{initials}</span>
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
    <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-semibold text-foreground truncate">{name}</p>
        <p className="text-xs text-muted-foreground capitalize">{role}</p>
      </div>
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
  className, onSignOut,
}: AppHeaderProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

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

      {/* Actions slot */}
      {actions && <div className="hidden sm:flex items-center gap-2">{actions}</div>}

      {/* Theme toggle */}
      <ThemeToggle />

      {/* Profile dropdown */}
      <div ref={profileRef} className="relative">
        <button
          onClick={() => setProfileOpen(v => !v)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted transition-colors"
        >
          <ProfileAvatar name={profileName} />
          <div className="hidden sm:block text-left">
            <p className="text-xs font-semibold text-foreground leading-tight">{profileName}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{profileRole}</p>
          </div>
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
  );
}
