"use client";

import { useState } from "react";
import { Check, Loader2, Store, Link, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateRestaurantDetails } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import type { Restaurant } from "@/types/database";

// Fire-and-forget audit log via /api/audit
async function logAudit(
  action: string,
  resourceType: string,
  resourceId?: string | null,
  resourceName?: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, resource_type: resourceType, resource_id: resourceId, resource_name: resourceName, metadata }),
    });
  } catch { /* non-blocking */ }
}

type Props = {
  restaurant: Restaurant;
};

export default function RestaurantDetails({ restaurant }: Props) {
  const router = useRouter();

  const [name, setName] = useState(restaurant.name);
  const [slug, setSlug] = useState(restaurant.slug ?? "");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameChanged = name.trim() !== restaurant.name;
  const slugChanged = (slug.trim() || null) !== (restaurant.slug ?? null);
  const hasChanges = nameChanged || slugChanged;

  // Sanitise slug as the user types — lowercase, alphanumeric + hyphens only
  function handleSlugChange(value: string) {
    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  }

  function handleReset() {
    setName(restaurant.name);
    setSlug(restaurant.slug ?? "");
    setError(null);
  }

  async function handleSave() {
    setError(null);

    if (!name.trim()) {
      setError("Restaurant name cannot be empty.");
      return;
    }

    setSaving(true);
    const result = await updateRestaurantDetails(restaurant.id, {
      name: name.trim(),
      slug: slug.trim() || null,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error ?? "Failed to save changes.");
      return;
    }

    setSaved(true);
    router.refresh(); // re-fetch server data so header updates
    setTimeout(() => setSaved(false), 3000);
    logAudit('restaurant.details_updated', 'restaurant', restaurant.id, name.trim(), {
      name: name.trim(),
      slug: slug.trim() || null,
    });
  }

  const qrBaseUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/r/${restaurant.id}`
      : `/r/${restaurant.id}`;

  return (
    <div className="space-y-8 max-w-2xl">
      {/* ── Restaurant Identity ──────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Restaurant Details</h2>
          <p className="text-sm text-muted-foreground">
            Basic information shown to customers and staff
          </p>
        </div>

        <Card className="p-6 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="restaurant-name" className="flex items-center gap-1.5">
              <Store className="h-3.5 w-3.5 text-muted-foreground" />
              Restaurant Name
            </Label>
            <Input
              id="restaurant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Grand Spice"
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              Shown in the header of every customer-facing page.
            </p>
          </div>

          {/* Slug */}
          <div className="space-y-1.5">
            <Label htmlFor="restaurant-slug" className="flex items-center gap-1.5">
              <Link className="h-3.5 w-3.5 text-muted-foreground" />
              URL Slug
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                optional
              </span>
            </Label>
            <div className="flex items-center gap-0">
              <span className="inline-flex h-9 items-center rounded-l-md border border-r-0 bg-muted px-3 text-xs text-muted-foreground select-none">
                /r/
              </span>
              <Input
                id="restaurant-slug"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="my-restaurant"
                maxLength={60}
                className="rounded-l-none font-mono text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens only. Used as a human-readable alias — QR codes always use the ID-based URL and are unaffected by slug changes.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Actions */}
          {hasChanges && (
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={handleReset} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          )}
          {saved && !hasChanges && (
            <p className="flex items-center gap-1.5 text-sm text-green-600">
              <Check className="h-4 w-4" /> Changes saved
            </p>
          )}
        </Card>
      </section>

      {/* ── QR / Ordering URL ────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Ordering URL</h2>
          <p className="text-sm text-muted-foreground">
            The base URL embedded in your table QR codes
          </p>
        </div>

        <Card className="p-6 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Current base URL</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">
                {qrBaseUrl}
              </code>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => navigator.clipboard.writeText(qrBaseUrl)}
              >
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Each table's QR code appends <code className="font-mono">/t/[table-id]</code> to this URL.
            </p>
          </div>

          <div className="rounded-md border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 px-4 py-3">
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              <strong>Note:</strong> Changing the restaurant name does not change the QR code URLs. Your existing QR codes will continue to work.
            </p>
          </div>
        </Card>
      </section>

      {/* ── Restaurant ID ────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Restaurant ID</h2>
          <p className="text-sm text-muted-foreground">
            Unique identifier used in API calls and QR codes
          </p>
        </div>

        <Card className="p-6">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs font-mono text-muted-foreground break-all">
              {restaurant.id}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => navigator.clipboard.writeText(restaurant.id)}
            >
              Copy
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
