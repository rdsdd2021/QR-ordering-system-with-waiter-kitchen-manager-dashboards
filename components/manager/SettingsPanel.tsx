"use client";

import { useState } from "react";
import { Check, Loader2, MapPin, Navigation } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";
import { updateRestaurantRoutingMode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import UpgradeBanner from "@/components/manager/UpgradeBanner";

type Props = {
  restaurantId: string;
  currentRoutingMode: "direct_to_kitchen" | "waiter_first";
  geofencingEnabled?: boolean;
  geoLatitude?: number | null;
  geoLongitude?: number | null;
  geoRadiusMeters?: number;
};

export default function SettingsPanel({
  restaurantId,
  currentRoutingMode,
  geofencingEnabled: initGeoEnabled = false,
  geoLatitude: initLat = null,
  geoLongitude: initLng = null,
  geoRadiusMeters: initRadius = 100,
}: Props) {
  const router = useRouter();

  // ── Routing mode ───────────────────────────────────────────────────
  const [routingMode, setRoutingMode] = useState(currentRoutingMode);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingSaved, setRoutingSaved] = useState(false);

  // ── Geo-fencing ────────────────────────────────────────────────────
  const [geoEnabled, setGeoEnabled] = useState(initGeoEnabled);
  const [geoLat, setGeoLat] = useState(initLat?.toString() ?? "");
  const [geoLng, setGeoLng] = useState(initLng?.toString() ?? "");
  const [geoRadius, setGeoRadius] = useState(initRadius.toString());
  const [geoSaving, setGeoSaving] = useState(false);
  const [geoSaved, setGeoSaved] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [detectingLocation, setDetectingLocation] = useState(false);

  // ── Routing save ───────────────────────────────────────────────────
  async function handleRoutingSave() {
    setRoutingSaving(true);
    setRoutingSaved(false);
    const success = await updateRestaurantRoutingMode(restaurantId, routingMode);
    if (success) {
      setRoutingSaved(true);
      router.refresh();
      setTimeout(() => setRoutingSaved(false), 3000);
    } else {
      alert("Failed to update routing settings");
    }
    setRoutingSaving(false);
  }

  // ── Geo-fencing save ───────────────────────────────────────────────
  async function handleGeoSave() {
    setGeoError(null);
    setGeoSaving(true);
    setGeoSaved(false);

    const lat = geoLat ? parseFloat(geoLat) : null;
    const lng = geoLng ? parseFloat(geoLng) : null;
    const radius = parseInt(geoRadius) || 100;

    if (geoEnabled && (!lat || !lng)) {
      setGeoError("Please set the restaurant coordinates before enabling geo-fencing.");
      setGeoSaving(false);
      return;
    }

    if (lat && (lat < -90 || lat > 90)) {
      setGeoError("Latitude must be between -90 and 90.");
      setGeoSaving(false);
      return;
    }
    if (lng && (lng < -180 || lng > 180)) {
      setGeoError("Longitude must be between -180 and 180.");
      setGeoSaving(false);
      return;
    }

    const { error } = await supabase
      .from("restaurants")
      .update({
        geofencing_enabled: geoEnabled,
        geo_latitude: lat,
        geo_longitude: lng,
        geo_radius_meters: radius,
      })
      .eq("id", restaurantId);

    if (error) {
      setGeoError(error.message);
    } else {
      setGeoSaved(true);
      router.refresh();
      setTimeout(() => setGeoSaved(false), 3000);
    }
    setGeoSaving(false);
  }

  // ── Auto-detect restaurant location ───────────────────────────────
  function detectLocation() {
    if (!navigator.geolocation) {
      setGeoError("Your browser doesn't support geolocation.");
      return;
    }
    setDetectingLocation(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLat(pos.coords.latitude.toFixed(7));
        setGeoLng(pos.coords.longitude.toFixed(7));
        setDetectingLocation(false);
      },
      () => {
        setGeoError("Could not detect location. Please enter coordinates manually.");
        setDetectingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  const routingChanged = routingMode !== currentRoutingMode;

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ── Subscription ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Subscription</h2>
          <p className="text-sm text-muted-foreground">Your current plan and billing</p>
        </div>
        <UpgradeBanner restaurantId={restaurantId} />
      </section>

      {/* ── Order Routing ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Order Routing</h2>
          <p className="text-sm text-muted-foreground">
            Control how orders flow when customers place them
          </p>
        </div>

        <Card className="p-6 space-y-4">
          {[
            {
              value: "direct_to_kitchen" as const,
              label: "Direct to Kitchen",
              desc: "Orders go straight to kitchen immediately. Best for fast-casual or counter service.",
            },
            {
              value: "waiter_first" as const,
              label: "Waiter First",
              desc: "Waiter must accept the order before kitchen sees it. Best for full-service restaurants.",
            },
          ].map(({ value, label, desc }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border-2 p-4 transition-colors",
                routingMode === value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
              )}
              onClick={() => setRoutingMode(value)}
            >
              <input
                type="radio"
                name="routing"
                value={value}
                checked={routingMode === value}
                onChange={() => setRoutingMode(value)}
                className="mt-1 h-4 w-4 cursor-pointer"
              />
              <div>
                <p className="font-semibold">{label}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </label>
          ))}

          {routingChanged && (
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setRoutingMode(currentRoutingMode)}>
                Cancel
              </Button>
              <Button onClick={handleRoutingSave} disabled={routingSaving}>
                {routingSaving ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                ) : routingSaved ? (
                  <><Check className="mr-2 h-4 w-4" />Saved!</>
                ) : "Save Changes"}
              </Button>
            </div>
          )}
          {routingSaved && !routingChanged && (
            <p className="text-sm text-green-600">✓ Routing settings saved</p>
          )}
        </Card>
      </section>

      {/* ── Geo-fencing ───────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Geo-fencing</h2>
          <p className="text-sm text-muted-foreground">
            Optionally restrict ordering to customers physically inside the restaurant
          </p>
        </div>

        <Card className="p-6 space-y-5">
          {/* Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Enable geo-fencing</p>
              <p className="text-sm text-muted-foreground">
                Customers outside the radius won't be able to place orders
              </p>
            </div>
            <Switch
              checked={geoEnabled}
              onCheckedChange={setGeoEnabled}
            />
          </div>

          {/* Coordinates */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Restaurant Location</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={detectLocation}
                disabled={detectingLocation}
                className="h-7 text-xs"
              >
                {detectingLocation ? (
                  <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Detecting…</>
                ) : (
                  <><Navigation className="h-3 w-3 mr-1.5" />Use my location</>
                )}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="geo-lat" className="text-xs text-muted-foreground">Latitude</Label>
                <Input
                  id="geo-lat"
                  value={geoLat}
                  onChange={(e) => setGeoLat(e.target.value)}
                  placeholder="e.g. 12.9716"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="geo-lng" className="text-xs text-muted-foreground">Longitude</Label>
                <Input
                  id="geo-lng"
                  value={geoLng}
                  onChange={(e) => setGeoLng(e.target.value)}
                  placeholder="e.g. 77.5946"
                  className="font-mono text-sm"
                />
              </div>
            </div>

            {geoLat && geoLng && (
              <a
                href={`https://www.google.com/maps?q=${geoLat},${geoLng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <MapPin className="h-3 w-3" />
                Verify on Google Maps
              </a>
            )}
          </div>

          {/* Radius */}
          <div className="space-y-1.5">
            <Label htmlFor="geo-radius">Allowed Radius (metres)</Label>
            <div className="flex items-center gap-3">
              <Input
                id="geo-radius"
                type="number"
                min="10"
                max="5000"
                value={geoRadius}
                onChange={(e) => setGeoRadius(e.target.value)}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">
                {parseInt(geoRadius) >= 1000
                  ? `${(parseInt(geoRadius) / 1000).toFixed(1)} km`
                  : `${geoRadius} m`}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Recommended: 50–200m for indoor dining, 500m+ for large venues
            </p>
          </div>

          {geoError && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {geoError}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button onClick={handleGeoSave} disabled={geoSaving}>
              {geoSaving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              ) : geoSaved ? (
                <><Check className="mr-2 h-4 w-4" />Saved!</>
              ) : "Save Geo-fencing"}
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
