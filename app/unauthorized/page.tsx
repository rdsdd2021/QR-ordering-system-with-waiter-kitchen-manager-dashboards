"use client";

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ShieldOff, ArrowRight, LogOut } from "lucide-react";

export default function UnauthorizedPage() {
  const { signOut, redirectToDashboard, profile } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border bg-destructive/5">
          <ShieldOff className="h-7 w-7 text-destructive" />
        </div>

        <div className="space-y-1.5">
          <h1 className="text-xl font-bold">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            You don't have permission to view this page.
          </p>
        </div>

        {profile && (
          <div className="rounded-xl border bg-muted/40 px-4 py-3 text-left space-y-1">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="text-sm font-medium">{profile.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{profile.role}</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button onClick={redirectToDashboard} className="w-full gap-2">
            Go to my dashboard
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button onClick={signOut} variant="outline" className="w-full gap-2">
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
