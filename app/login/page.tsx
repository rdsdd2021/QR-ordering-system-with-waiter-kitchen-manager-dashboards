"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, QrCode, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import AuthRedirect from "@/components/AuthRedirect";

export default function LoginPage() {
  return (
    <AuthRedirect>
      <LoginForm />
    </AuthRedirect>
  );
}

function LoginForm() {
  const { signIn, redirectToDashboard } = useAuth();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Show error passed via query param (e.g. from AuthRedirect on broken accounts)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "account_incomplete") {
      setLoginError("Your staff account setup is incomplete. Please ask your manager to re-create your account.");
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setSubmitting(true);
    const result = await signIn(email, password);
    if (result.success) {
      redirectToDashboard();
    } else {
      setLoginError(result.error || "Login failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left panel — decorative, hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary/5 border-r items-center justify-center p-12">
        <div className="max-w-sm space-y-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary">
            <QrCode className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">QR Order</h2>
            <p className="mt-2 text-muted-foreground leading-relaxed">
              Manage your restaurant, menu, staff, and orders — all from one dashboard.
            </p>
          </div>
          <div className="space-y-3">
            {["Real-time kitchen display", "Waiter order management", "Analytics & billing", "QR code generation"].map(f => (
              <div key={f} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <QrCode className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">QR Order</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@restaurant.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={submitting}
                className="h-10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={submitting}
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                {loginError}
              </div>
            )}

            <Button type="submit" className="w-full h-10 font-semibold" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            New restaurant?{" "}
            <Link href="/onboarding" className="font-medium text-primary hover:underline">
              Get started free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
