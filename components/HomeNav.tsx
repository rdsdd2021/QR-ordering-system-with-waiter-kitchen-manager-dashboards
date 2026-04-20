"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function HomeNav() {
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { setLoading(false); return; }

      const { data } = await supabase
        .from("users")
        .select("role, restaurant_id")
        .eq("auth_id", session.user.id)
        .maybeSingle();

      if (data?.restaurant_id) {
        const dest =
          data.role === "manager" ? `/manager/${data.restaurant_id}` :
          data.role === "waiter"  ? `/waiter/${data.restaurant_id}`  :
          data.role === "kitchen" ? `/kitchen/${data.restaurant_id}` :
          "/onboarding";
        setDashboardUrl(dest);
      } else {
        setDashboardUrl("/onboarding");
      }
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (dashboardUrl) {
    return (
      <Link
        href={dashboardUrl}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Go to Dashboard
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/login"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
      >
        Sign in
      </Link>
      <Link
        href="/onboarding"
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Get started
      </Link>
    </div>
  );
}
