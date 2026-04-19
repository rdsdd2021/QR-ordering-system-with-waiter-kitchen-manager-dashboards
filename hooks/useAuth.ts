"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import type { User } from "@/types/database";

type AuthState = {
  user: SupabaseUser | null;
  profile: User | null;
  loading: boolean;
  error: string | null;
};

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadUserProfile(session.user);
      } else {
        setState({ user: null, profile: null, loading: false, error: null });
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadUserProfile(session.user);
      } else {
        setState({ user: null, profile: null, loading: false, error: null });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadUserProfile(user: SupabaseUser) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, name, role, restaurant_id, email, auth_id, created_at")
        .eq("auth_id", user.id)
        .maybeSingle();

      if (error) throw error;

      setState({
        user,
        profile: data as User,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error("Error loading user profile:", err);
      setState({
        user,
        profile: null,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load profile",
      });
    }
  }

  async function signIn(email: string, password: string) {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        await loadUserProfile(data.user);
        return { success: true };
      }

      return { success: false, error: "No user returned" };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Sign in failed";
      setState((prev) => ({ ...prev, loading: false, error }));
      return { success: false, error };
    }
  }

  async function signUp(email: string, password: string, name: string, role: string, restaurantId?: string) {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      // 1. Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error("No user returned from signup");

      // 2. Create user profile only if restaurantId is provided
      // (onboarding flow creates the profile via the onboard API instead)
      if (restaurantId) {
        const { error: profileError } = await supabase.from("users").insert({
          auth_id: authData.user.id,
          email,
          name,
          role,
          restaurant_id: restaurantId,
        });
        if (profileError) throw profileError;
      }

      await loadUserProfile(authData.user);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Sign up failed";
      setState((prev) => ({ ...prev, loading: false, error }));
      return { success: false, error };
    }
  }

  async function signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      setState({ user: null, profile: null, loading: false, error: null });
      router.push("/login");
    } catch (err) {
      console.error("Error signing out:", err);
    }
  }

  function redirectToDashboard() {
    if (!state.profile) {
      // No profile means new user — send to onboarding
      router.push("/onboarding");
      return;
    }

    const { role, restaurant_id } = state.profile;

    switch (role) {
      case "manager":
        router.push(`/manager/${restaurant_id}`);
        break;
      case "waiter":
        router.push(`/waiter/${restaurant_id}`);
        break;
      case "kitchen":
        router.push(`/kitchen/${restaurant_id}`);
        break;
      default:
        router.push("/onboarding");
    }
  }

  return {
    user: state.user,
    profile: state.profile,
    loading: state.loading,
    error: state.error,
    signIn,
    signUp,
    signOut,
    redirectToDashboard,
    isAuthenticated: !!state.user,
    isManager: state.profile?.role === "manager",
    isWaiter: state.profile?.role === "waiter",
    isKitchen: state.profile?.role === "kitchen",
  };
}
