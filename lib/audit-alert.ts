/**
 * Audit Alert dispatcher — sends in-app notifications for critical audit events.
 *
 * Called fire-and-forget from `writeAuditLog` after a successful critical insert.
 * Deduplicates via the `audit_notifications` unique constraint on `audit_log_id`.
 * Retries up to 3 times with 10-second intervals before marking the notification failed.
 */
import { createClient } from "@supabase/supabase-js";
import type { AuditEntry } from "@/lib/audit-log";

// ---------------------------------------------------------------------------
// dispatchCriticalAlert
// ---------------------------------------------------------------------------

/**
 * Dispatch a critical alert for the given audit entry.
 *
 * 1. Checks `audit_notifications` for an existing row with the same `audit_log_id`;
 *    if found, returns early (silent deduplication).
 * 2. Inserts a `pending` row into `audit_notifications`.
 * 3. Broadcasts an in-app notification via Supabase Realtime on
 *    `critical-alerts:{restaurant_id}`.
 * 4. Retries up to 3 times with 10-second intervals on failure.
 * 5. After 3 failures: marks the row `failed` and logs the error.
 * 6. On success: marks the row `delivered` and sets `delivered_at`.
 *
 * Requirements: 7.1, 7.3, 7.4, 7.5
 */
export async function dispatchCriticalAlert(
  entryId: string,
  entry: AuditEntry & { severity: 'critical' }
): Promise<void> {
  // If there is no restaurant to notify, skip dispatch entirely.
  if (!entry.restaurant_id) {
    return;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ------------------------------------------------------------------
  // Step 1: Deduplication check — return early if already dispatched
  // ------------------------------------------------------------------
  const { data: existing } = await supabase
    .from("audit_notifications")
    .select("id")
    .eq("audit_log_id", entryId)
    .maybeSingle();

  if (existing) {
    // A notification row already exists for this audit entry — silent skip.
    return;
  }

  // ------------------------------------------------------------------
  // Step 2: Insert a pending notification row
  // ------------------------------------------------------------------
  const { error: insertError } = await supabase
    .from("audit_notifications")
    .insert({
      audit_log_id:  entryId,
      restaurant_id: entry.restaurant_id,
      status:        "pending",
      attempts:      0,
    });

  if (insertError) {
    // If the insert fails due to a race-condition duplicate (unique constraint),
    // treat it as a silent skip — another process already handled this entry.
    console.error("[audit-alert] failed to insert pending notification", {
      error: insertError,
      entryId,
    });
    return;
  }

  // ------------------------------------------------------------------
  // Step 3 + 4: Broadcast with up to 3 retries (10-second intervals)
  // ------------------------------------------------------------------
  const MAX_ATTEMPTS = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const channel = supabase.channel(`critical-alerts:${entry.restaurant_id}`);

      await channel.send({
        type:    "broadcast",
        event:   "critical_alert",
        payload: {
          action:        entry.action,
          actor_name:    entry.actor_name,
          actor_type:    entry.actor_type,
          resource_type: entry.resource_type,
          resource_name: entry.resource_name ?? null,
          created_at:    new Date().toISOString(),
        },
      });

      // ------------------------------------------------------------------
      // Step 6: Success — mark delivered
      // ------------------------------------------------------------------
      await supabase
        .from("audit_notifications")
        .update({
          status:       "delivered",
          delivered_at: new Date().toISOString(),
          attempts:     attempt,
        })
        .eq("audit_log_id", entryId);

      return; // Done — exit the retry loop
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < MAX_ATTEMPTS) {
        // Wait 10 seconds before the next attempt
        await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 5: All 3 attempts failed — mark failed and log
  // ------------------------------------------------------------------
  console.error("[audit-alert] all dispatch attempts failed", {
    entryId,
    error: lastError?.message,
  });

  await supabase
    .from("audit_notifications")
    .update({
      status:     "failed",
      last_error: lastError?.message ?? "Unknown error",
      attempts:   MAX_ATTEMPTS,
    })
    .eq("audit_log_id", entryId);
}
