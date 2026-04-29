/**
 * Audit Log utility — core types, severity mapping, and helper functions.
 *
 * All API routes import `writeAuditLog` from this module to record significant
 * actions. Severity is derived automatically from the action string; callers
 * never supply it.
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActorType = 'admin' | 'manager' | 'staff' | 'system' | 'customer';
export type Severity  = 'info' | 'warning' | 'critical';

/**
 * The shape callers pass to `writeAuditLog`.
 * `severity` is intentionally absent — it is derived from `action` automatically.
 */
export interface AuditEntry {
  restaurant_id?:  string | null;
  actor_type:      ActorType;
  actor_id:        string;
  actor_name:      string;
  action:          string;           // e.g. 'staff.created'
  resource_type:   string;           // e.g. 'staff_member'
  resource_id?:    string | null;
  resource_name?:  string | null;
  metadata?:       Record<string, unknown>;
  ip_address?:     string | null;
}

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

const CRITICAL_ACTIONS = new Set([
  'restaurant.activated',
  'restaurant.deactivated',
  'auth.password_changed',
  'staff.deleted',
  'coupon.created',
  'coupon.deleted',
  'billing.plan_changed',
  'webhook.secret_rotated',
]);

const WARNING_ACTIONS = new Set([
  'staff.created',
  'staff.deactivated',
  'webhook.created',
  'webhook.deleted',
  'billing.subscription_activated',
  'billing.subscription_expired',
  'order.cancelled',
]);

/**
 * Derive severity from an action string.
 * Pure function — no side effects.
 *
 * Requirements: 1.4, 1.5, 1.6
 */
export function getSeverity(action: string): Severity {
  if (CRITICAL_ACTIONS.has(action)) return 'critical';
  if (WARNING_ACTIONS.has(action))  return 'warning';
  return 'info';
}

// ---------------------------------------------------------------------------
// IP extraction
// ---------------------------------------------------------------------------

/**
 * Extract the client IP from a Next.js request.
 * Checks X-Forwarded-For first (takes the first IP if comma-separated),
 * then X-Real-IP, then falls back to null.
 *
 * Requirements: 1.7
 */
export function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  return null;
}

// ---------------------------------------------------------------------------
// Cursor helpers (keyset pagination)
// ---------------------------------------------------------------------------

/**
 * Encode a keyset pagination cursor from a `created_at` ISO string and a UUID.
 * Format: `{created_at}_{id}`
 */
export function encodeCursor(createdAt: string, id: string): string {
  return `${createdAt}_${id}`;
}

/**
 * Decode a keyset pagination cursor back into its component parts.
 * Splits on the last `_` to separate the UUID from the timestamp.
 * Returns null if the cursor is malformed.
 */
export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  const lastUnderscore = cursor.lastIndexOf('_');
  if (lastUnderscore === -1) return null;

  const createdAt = cursor.slice(0, lastUnderscore);
  const id        = cursor.slice(lastUnderscore + 1);

  if (!createdAt || !id) return null;

  return { createdAt, id };
}

// ---------------------------------------------------------------------------
// writeAuditLog
// ---------------------------------------------------------------------------

/**
 * Write a single audit entry to the `audit_logs` table.
 *
 * - Uses a fresh service-role Supabase client on every call (never the anon client).
 * - Derives `severity` automatically from `entry.action` — callers must not supply it.
 * - Never throws: errors are logged server-side and the function returns `null`.
 * - After a successful critical insert, fires `dispatchCriticalAlert` fire-and-forget.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.8, 8.3, 8.4
 */
export async function writeAuditLog(entry: AuditEntry): Promise<string | null> {
  // Import here to avoid a circular dependency at module load time.
  // audit-alert.ts is created in task 3; this forward import is intentional.
  const { dispatchCriticalAlert } = await import("@/lib/audit-alert");

  const severity = getSeverity(entry.action);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { data, error } = await supabase
      .from("audit_logs")
      .insert({
        restaurant_id: entry.restaurant_id ?? null,
        actor_type:    entry.actor_type,
        actor_id:      entry.actor_id,
        actor_name:    entry.actor_name,
        action:        entry.action,
        resource_type: entry.resource_type,
        resource_id:   entry.resource_id   ?? null,
        resource_name: entry.resource_name ?? null,
        metadata:      entry.metadata      ?? {},
        severity,
        ip_address:    entry.ip_address    ?? null,
        // `id` and `created_at` are intentionally omitted — set by the database
      })
      .select("id")
      .single();

    if (error) {
      console.error("[audit-log] write failed", { error, entry });
      return null;
    }

    const id: string = data.id;

    if (severity === "critical") {
      // Fire-and-forget — do not await; a dispatch failure must not affect the caller
      dispatchCriticalAlert(id, { ...entry, severity: "critical" }).catch(
        (err) => console.error("[audit-log] dispatchCriticalAlert failed", { err, id })
      );
    }

    return id;
  } catch (error) {
    console.error("[audit-log] write failed", { error, entry });
    return null;
  }
}
