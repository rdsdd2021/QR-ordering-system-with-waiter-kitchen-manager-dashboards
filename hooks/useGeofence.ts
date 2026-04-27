"use client";

/**
 * useGeofence
 *
 * Checks whether the customer's current location is within the
 * restaurant's allowed radius. Only runs when geofencing is enabled.
 *
 * Returns:
 *  - status: 'idle' | 'checking' | 'allowed' | 'denied' | 'error'
 *  - message: human-readable reason when denied or errored
 */

import { useEffect, useState } from "react";

export type GeofenceStatus = "idle" | "checking" | "allowed" | "denied" | "error";

type Props = {
  enabled: boolean;
  restaurantLat: number | null;
  restaurantLng: number | null;
  radiusMeters: number;
};

/** Haversine distance in metres between two lat/lng points. */
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useGeofence({ enabled, restaurantLat, restaurantLng, radiusMeters }: Props) {
  const [status, setStatus] = useState<GeofenceStatus>("idle");
  const [message, setMessage] = useState<string>("");
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("allowed");
      return;
    }

    if (!restaurantLat || !restaurantLng) {
      // Geo-fencing enabled but no coordinates set — allow by default
      setStatus("allowed");
      return;
    }

    if (!navigator.geolocation) {
      setStatus("error");
      setMessage("Your browser doesn't support location. Please use a modern browser.");
      return;
    }

    setStatus("checking");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dist = haversineMeters(
          pos.coords.latitude,
          pos.coords.longitude,
          restaurantLat,
          restaurantLng
        );
        setDistanceMeters(Math.round(dist));

        if (dist <= radiusMeters) {
          setStatus("allowed");
          setMessage("");
        } else {
          setStatus("denied");
          setMessage(
            `You appear to be ${Math.round(dist)}m away from the restaurant. ` +
            `You need to be within ${radiusMeters}m to place an order.`
          );
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("error");
          setMessage("Location access was denied. Please allow location access to place an order.");
        } else {
          setStatus("error");
          setMessage("Unable to determine your location. Please try again.");
        }
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 10_000 }
    );
  }, [enabled, restaurantLat, restaurantLng, radiusMeters]);

  return { status, message, distanceMeters };
}
