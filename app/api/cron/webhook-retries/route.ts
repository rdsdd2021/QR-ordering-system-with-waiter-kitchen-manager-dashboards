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
  const { data: due, error } = await supabase
    .from("webhook_deliveries")
    .select("id")
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
  const results = await Promise.allSettled(
    due.slice(0, 10).map(d => retryDelivery(d.id))
  );

  const succeeded = results.filter(r => r.status === "fulfilled" && r.value.ok).length;
  const failed    = results.length - succeeded;

  console.log(`[cron/webhook-retries] processed=${results.length} succeeded=${succeeded} failed=${failed}`);
  return NextResponse.json({ processed: results.length, succeeded, failed });
}
