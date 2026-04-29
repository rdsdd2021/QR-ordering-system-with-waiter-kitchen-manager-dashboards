/**
 * GET /api/cron/webhook-retries
 *
 * Processes webhook deliveries that are due for retry.
 * Triggered by Vercel Cron every minute.
 * Protected by CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { retryDelivery } from "@/lib/webhooks";
import { writeAuditLog } from "@/lib/audit-log";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  // Verify cron secret (set CRON_SECRET in env, Vercel passes it as Authorization header)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  // Find deliveries due for retry (status = retrying, next_retry_at <= now)
  // Also fetch endpoint details needed for audit logging on permanent failure
  const { data: due, error } = await supabase
    .from("webhook_deliveries")
    .select("id, attempt, max_attempts, endpoint_id, endpoint:webhook_endpoints(url, restaurant_id)")
    .eq("status", "retrying")
    .lte("next_retry_at", new Date().toISOString())
    .limit(50); // Process up to 50 per run

  if (error) {
    console.error("[cron/webhook-retries] query error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!due?.length) {
    return NextResponse.json({ processed: 0 });
  }

  // Process retries concurrently (capped at 10 at a time)
  const batch = due.slice(0, 10);
  const results = await Promise.allSettled(
    batch.map(async (d) => {
      const result = await retryDelivery(d.id);

      // A delivery permanently fails when this retry exhausts all remaining attempts
      // and the retry itself failed (retryDelivery sets status to "dead" in that case).
      // We detect this by checking if the next attempt number equals max_attempts
      // and the retry did not succeed.
      const nextAttempt = d.attempt + 1;
      const isPermanentFailure = !result.ok && nextAttempt >= d.max_attempts;

      if (isPermanentFailure) {
        // Fetch the updated delivery to get the final http_status and error_message
        const { data: finalDelivery } = await supabase
          .from("webhook_deliveries")
          .select("http_status, error_message, attempt")
          .eq("id", d.id)
          .single();

        const epRaw = Array.isArray(d.endpoint) ? d.endpoint[0] : d.endpoint;
        const ep = epRaw as { url: string; restaurant_id: string } | null | undefined;

        try {
          await writeAuditLog({
            restaurant_id: ep?.restaurant_id ?? null,
            actor_type: "system",
            actor_id: "cron_webhook_retries",
            actor_name: "Webhook Retry Cron",
            action: "webhook.delivery_failed",
            resource_type: "webhook",
            resource_id: d.endpoint_id,
            resource_name: ep?.url ?? null,
            metadata: {
              endpoint_url: ep?.url ?? null,
              http_status: finalDelivery?.http_status ?? null,
              error_message: finalDelivery?.error_message ?? null,
              attempt: finalDelivery?.attempt ?? nextAttempt,
            },
          });
        } catch (auditErr) {
          console.error("[cron/webhook-retries] audit log write failed", auditErr);
        }
      }

      return result;
    })
  );

  const succeeded = results.filter(r => r.status === "fulfilled" && r.value.ok).length;
  const failed    = results.length - succeeded;

  console.log(`[cron/webhook-retries] processed=${results.length} succeeded=${succeeded} failed=${failed}`);
  return NextResponse.json({ processed: results.length, succeeded, failed });
}
