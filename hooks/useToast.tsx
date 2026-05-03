"use client";

/**
 * Lightweight in-app toast system.
 *
 * Usage:
 *   const { toast } = useToast();
 *   toast({ title: "Order confirmed!", variant: "success" });
 *
 * Variants: "default" | "success" | "warning" | "error" | "info"
 * Duration defaults to 4000ms. Pass duration: 0 for persistent toasts.
 */

import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  type ReactNode,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToastVariant = "default" | "success" | "warning" | "error" | "info";

export type Toast = {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number; // ms — 0 = persistent
  icon?: ReactNode;
};

type Action =
  | { type: "ADD"; toast: Toast }
  | { type: "REMOVE"; id: string };

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: Toast[], action: Action): Toast[] {
  switch (action.type) {
    case "ADD":
      // Keep max 5 toasts — drop oldest if over limit
      return [...state, action.toast].slice(-5);
    case "REMOVE":
      return state.filter((t) => t.id !== action.id);
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

type ToastContextValue = {
  toasts: Toast[];
  toast: (opts: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, []);

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "REMOVE", id });
  }, []);

  const toast = useCallback(
    (opts: Omit<Toast, "id">): string => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const duration = opts.duration ?? 4000;

      dispatch({ type: "ADD", toast: { ...opts, id, duration } });

      if (duration > 0) {
        setTimeout(() => dispatch({ type: "REMOVE", id }), duration);
      }

      return id;
    },
    []
  );

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const NO_OP_TOAST: ToastContextValue = {
  toasts: [],
  toast: () => "",
  dismiss: () => {},
};

export function useToast() {
  const ctx = useContext(ToastContext);
  // Return a no-op instead of throwing so components outside the provider
  // (e.g. during SSR or if provider is missing) degrade gracefully.
  return ctx ?? NO_OP_TOAST;
}
