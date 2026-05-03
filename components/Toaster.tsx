"use client";

/**
 * Toaster — renders the active toast stack.
 * Place once in the layout, outside any scroll containers.
 *
 * Toasts stack from the bottom-right on desktop, bottom-center on mobile.
 * Each toast slides in from the bottom and fades out when dismissed.
 */

import { X, CheckCircle2, AlertTriangle, XCircle, Info, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast, type Toast, type ToastVariant } from "@/hooks/useToast";

// ── Variant config ────────────────────────────────────────────────────────────

const VARIANT_STYLES: Record<
  ToastVariant,
  { container: string; icon: React.ReactNode }
> = {
  default: {
    container: "bg-card border-border text-foreground",
    icon: <Bell className="h-4 w-4 text-muted-foreground shrink-0" />,
  },
  success: {
    container:
      "bg-green-50 dark:bg-green-950/60 border-green-200 dark:border-green-800 text-green-900 dark:text-green-100",
    icon: <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />,
  },
  warning: {
    container:
      "bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100",
    icon: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />,
  },
  error: {
    container:
      "bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100",
    icon: <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />,
  },
  info: {
    container:
      "bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100",
    icon: <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />,
  },
};

// ── Single toast ──────────────────────────────────────────────────────────────

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const variant = toast.variant ?? "default";
  const { container, icon } = VARIANT_STYLES[variant];
  const displayIcon = toast.icon ?? icon;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 w-full max-w-sm rounded-xl border px-4 py-3 shadow-lg",
        "animate-in slide-in-from-bottom-3 fade-in duration-300",
        container
      )}
    >
      <span className="mt-0.5">{displayIcon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-snug">{toast.title}</p>
        {toast.description && (
          <p className="text-xs mt-0.5 opacity-80 leading-snug">{toast.description}</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity mt-0.5"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Toaster ───────────────────────────────────────────────────────────────────

export default function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className={cn(
        "fixed z-[9999] flex flex-col gap-2 pointer-events-none",
        // Bottom-right on desktop, bottom-center on mobile
        "bottom-4 right-4 left-4",
        "sm:left-auto sm:w-auto sm:max-w-sm"
      )}
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
