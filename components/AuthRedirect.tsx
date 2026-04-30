"use client";

/**
 * AuthRedirect
 *
 * Wrap pages that should NOT be accessible when logged in (login, onboarding).
 * Shows nothing while auth resolves, then either redirects to dashboard
 * or renders children if the user is a guest.
 *
 * allowNoRestaurant: if true, a logged-in user with no restaurant is still
 * allowed through (used by onboarding so they can complete setup).
 *
 * A3 fix: if a user has a valid auth session but no matching users row
 * (partial staff creation failure), we sign them out and send them to /login
 * with an error message rather than looping through /onboarding.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Props = { children: React.ReactNode; allowNoRestaurant?: boolean };

export default function AuthRedirect({ children, allowNoRestaurant = false }: Props) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "guest" | "redirecting">("checking");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { setState("guest"); return; }

      const { data } = await supabase
        .from("users")
        .select("role, restaurant_id")
        .eq("auth_id", session.user.id)
        .maybeSingle();

      // Auth session exists but no users row — broken/partial account.
      // Sign out and redirect to login so the user isn't stuck in a loop.
      if (!data) {
        await supabase.auth.signOut();
        setState("redirecting");
        router.replace("/login?error=account_incomplete");
        return;
      }

      // Has a users row but no restaurant yet — let through if caller allows it (onboarding)
      if (!data.restaurant_id) {
        if (allowNoRestaurant) {
          setState("guest");
        } else {
          setState("redirecting");
          router.replace("/onboarding");
        }
        return;
      }

      // Has a restaurant — redirect to dashboard
      setState("redirecting");
      const dest =
        data.role === "manager" ? `/manager/${data.restaurant_id}` :
        data.role === "waiter"  ? `/waiter/${data.restaurant_id}`  :
        data.role === "kitchen" ? `/kitchen/${data.restaurant_id}` :
        "/onboarding";
      router.replace(dest);
    });
  }, [allowNoRestaurant, router]);

  // Render nothing while checking or redirecting — no flash
  if (state !== "guest") return null;

  return <>{children}</>;
}
