"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Store, User, Mail, Lock, ArrowRight, CheckCircle2, QrCode, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseClient } from "@/lib/supabase";
import Link from "next/link";
import { cn } from "@/lib/utils";
import CouponInput, { type CouponResult } from "@/components/CouponInput";
import AuthRedirect from "@/components/AuthRedirect";

type Step = "account" | "restaurant" | "plan" | "loading" | "done";

const PRO_FEATURES  = ["Unlimited tables & menu items", "Advanced analytics", "Floor-based pricing", "Priority support", "Geo-fencing"];

export default function OnboardingPage() {
  return (
    <AuthRedirect allowNoRestaurant>
      <OnboardingForm />
    </AuthRedirect>
  );
}

function OnboardingForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("account");

  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [ownerName, setOwnerName]       = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [error, setError]               = useState("");
  const [busy, setBusy]                 = useState(false);
  const [newRestaurantId, setNewRestaurantId] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [proPricePaise, setProPricePaise] = useState(99900);

  // Fetch pro plan price from DB on mount
  useEffect(() => {
    fetch("/api/plans").then(r => r.json()).then((plans: Array<{id: string; monthly_paise: number}>) => {
      const pro = plans.find(p => p.id === "pro");
      if (pro) setProPricePaise(pro.monthly_paise);
    }).catch(() => {});
  }, []);

  const discountedPaise = coupon
    ? coupon.type === "percentage"
      ? proPricePaise - Math.round((proPricePaise * coupon.value) / 100)
      : Math.max(0, proPricePaise - Math.round(coupon.value * 100))
    : proPricePaise;
  const finalPrice = `₹${(discountedPaise / 100).toFixed(0)}`;

  async function handleUpgrade() {
    if (!newRestaurantId) return;
    setUpgrading(true);
    const res = await fetch("/api/phonepe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId: newRestaurantId,
        returnUrl: `${window.location.origin}/manager/${newRestaurantId}`,
        plan: "pro_monthly",
        couponCode: coupon?.code,
      }),
    });
    const { url, error: checkoutError } = await res.json();
    if (checkoutError) { alert(checkoutError); setUpgrading(false); return; }
    window.location.href = url;
  }

  function skipToFree() {
    if (newRestaurantId) router.push(`/manager/${newRestaurantId}`);
  }

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    const supabase = getSupabaseClient();

    // Step 1: Try to sign up
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });

    if (signUpError) {
      // Already registered — just sign in
      if (signUpError.message.toLowerCase().includes("already registered")) {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) { setError(signInError.message); setBusy(false); return; }
      } else {
        setError(signUpError.message); setBusy(false); return;
      }
    }

    // Step 2: Always sign in to get a real session (handles email confirmation being disabled)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("Account created! Please check your inbox for a confirmation email, then return here to sign in.");
      setBusy(false); return;
    }

    // Step 3: Check if this user already has a restaurant
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: profile } = await supabase
        .from("users")
        .select("role, restaurant_id")
        .eq("auth_id", session.user.id)
        .maybeSingle();

      if (profile?.restaurant_id) {
        // Already onboarded — redirect to dashboard
        if (profile.role === "manager") { router.push(`/manager/${profile.restaurant_id}`); return; }
        if (profile.role === "waiter")  { router.push(`/waiter/${profile.restaurant_id}`);  return; }
        if (profile.role === "kitchen") { router.push(`/kitchen/${profile.restaurant_id}`); return; }
      }
    }

    setBusy(false);
    setStep("restaurant");
  }

  async function handleRestaurantSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true); setStep("loading");
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setError("Not authenticated."); setStep("restaurant"); setBusy(false); return; }

    const res = await fetch("/api/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authId: session.user.id,
        email: session.user.email,
        restaurantName,
        ownerName: ownerName || session.user.email?.split("@")[0] || "Owner",
      }),
    });
    const { restaurantId, error: onboardError } = await res.json();
    if (onboardError) { setError(onboardError); setStep("restaurant"); setBusy(false); return; }
    setNewRestaurantId(restaurantId);
    setStep("plan");
  }

  if (step === "loading") return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary">
        <Loader2 className="h-6 w-6 animate-spin text-primary-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">Setting up your restaurant…</p>
    </div>
  );

  if (step === "done") return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500">
        <CheckCircle2 className="h-6 w-6 text-white" />
      </div>
      <p className="font-semibold">You're all set!</p>
      <p className="text-sm text-muted-foreground">Redirecting to your dashboard…</p>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-5/12 bg-primary/5 border-r flex-col justify-between p-12">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <QrCode className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold">QR Order</span>
        </div>
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Start taking orders in minutes</h2>
            <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
              Set up your restaurant, add your menu, and share QR codes with your tables. That's it.
            </p>
          </div>
          <div className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Free trial includes</p>
            {PRO_FEATURES.map(f => (
              <div key={f} className="flex items-center gap-2.5 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                {f}
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">7-day free trial · No credit card required</p>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <QrCode className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">QR Order</span>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-3">
            {(["account", "restaurant", "plan"] as const).map((s, i) => {
              const steps: Step[] = ["account", "restaurant", "plan"];
              const currentIdx = steps.indexOf(step as any);
              const thisIdx = i;
              const done = currentIdx > thisIdx;
              const active = step === s;
              return (
                <div key={s} className="flex items-center gap-2 flex-1">
                  <div className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0 transition-colors",
                    done   ? "bg-green-500 text-white" :
                    active ? "bg-primary text-primary-foreground" :
                             "bg-muted text-muted-foreground"
                  )}>
                    {done ? "✓" : i + 1}
                  </div>
                  <span className={cn("text-xs capitalize", active ? "font-medium" : "text-muted-foreground")}>{s}</span>
                  {i < 2 && <div className="flex-1 h-px bg-border" />}
                </div>
              );
            })}
          </div>

          {/* Step 1 */}
          {step === "account" && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
                <p className="mt-1 text-sm text-muted-foreground">You'll use this to log in to your dashboard</p>
              </div>
              <form onSubmit={handleAccountSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="owner-name">Your name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="owner-name" value={ownerName} onChange={e => setOwnerName(e.target.value)}
                      placeholder="John Smith" className="pl-9 h-10" required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@restaurant.com" className="pl-9 h-10" required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="Min 6 characters" className="pl-9 h-10" minLength={6} required />
                  </div>
                </div>
                {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full h-10 font-semibold" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Already have an account?{" "}
                  <Link href="/login" className="text-primary hover:underline font-medium">Sign in</Link>
                </p>
              </form>
            </div>
          )}

          {/* Step 2 */}
          {step === "restaurant" && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Name your restaurant</h1>
                <p className="mt-1 text-sm text-muted-foreground">We'll create 5 tables and a default floor to get you started</p>
              </div>
              <form onSubmit={handleRestaurantSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="restaurant-name">Restaurant name</Label>
                  <div className="relative">
                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="restaurant-name" value={restaurantName} onChange={e => setRestaurantName(e.target.value)}
                      placeholder="The Grand Café" className="pl-9 h-10" required />
                  </div>
                </div>
                {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full h-10 font-semibold" disabled={busy || !restaurantName.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create restaurant <ArrowRight className="ml-2 h-4 w-4" /></>}
                </Button>
              </form>
            </div>
          )}

          {/* Step 3 — Plan selection */}
          {step === "plan" && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Activate your free trial</h1>
                <p className="mt-1 text-sm text-muted-foreground">7 days free, then ₹{(proPricePaise / 100).toFixed(0)}/month. Cancel anytime.</p>
              </div>

              {/* Pro card */}
              <div className="rounded-xl border-2 border-primary bg-primary/5 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-primary" /> Pro
                    </p>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-xl font-bold">{finalPrice}</span>
                      {coupon && discountedPaise < proPricePaise && (
                        <span className="text-sm text-muted-foreground line-through">₹{(proPricePaise / 100).toFixed(0)}</span>
                      )}
                      <span className="text-sm text-muted-foreground">/month</span>
                    </div>
                  </div>
                  <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">Recommended</span>
                </div>
                <ul className="space-y-1.5">
                  {PRO_FEATURES.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <CouponInput
                  plan="pro"
                  restaurantId={newRestaurantId!}
                  planPricePaise={proPricePaise}
                  onApply={setCoupon}
                />
                <Button className="w-full" onClick={handleUpgrade} disabled={upgrading}>
                  <Zap className="h-4 w-4 mr-2" />
                  {upgrading ? "Redirecting to payment…" : `Start 7-day free trial — ${finalPrice}/month after`}
                </Button>
              </div>

              {/* Skip option */}
              <button
                onClick={skipToFree}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2 underline-offset-2 hover:underline"
              >
                Skip for now, continue with free plan →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
