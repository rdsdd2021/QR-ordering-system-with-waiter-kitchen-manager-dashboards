"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

type Props = {
  children: React.ReactNode;
  requiredRole?: "manager" | "waiter" | "kitchen";
  restaurantId?: string;
};

export default function ProtectedRoute({ children, requiredRole, restaurantId }: Props) {
  const router = useRouter();
  const { isAuthenticated, profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    // Not authenticated - redirect to login
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }

    // Check role if required
    if (requiredRole && profile?.role !== requiredRole) {
      router.push("/unauthorized");
      return;
    }

    // Check restaurant access if required
    if (restaurantId && profile?.restaurant_id !== restaurantId) {
      router.push("/unauthorized");
      return;
    }
  }, [isAuthenticated, profile, loading, requiredRole, restaurantId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (requiredRole && profile?.role !== requiredRole) {
    return null;
  }

  if (restaurantId && profile?.restaurant_id !== restaurantId) {
    return null;
  }

  return <>{children}</>;
}
