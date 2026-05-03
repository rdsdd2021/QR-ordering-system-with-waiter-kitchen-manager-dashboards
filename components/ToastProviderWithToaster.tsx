"use client";

/**
 * ToastProviderWithToaster
 *
 * Wraps ToastProvider and Toaster in a single client component boundary.
 * This is required in Next.js App Router — if ToastProvider and Toaster
 * are rendered as separate client components from a server component,
 * they get isolated React trees and don't share the same context instance.
 * Wrapping them together in one client component fixes this.
 */

import { ToastProvider } from "@/hooks/useToast";
import Toaster from "@/components/Toaster";
import type { ReactNode } from "react";

export default function ToastProviderWithToaster({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <Toaster />
    </ToastProvider>
  );
}
