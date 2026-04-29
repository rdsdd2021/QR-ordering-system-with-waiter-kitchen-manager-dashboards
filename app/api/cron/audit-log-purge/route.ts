/**
 * GET /api/cron/audit-log-purge
 *
 * Purges expired audit log entries based on severity-driven retention periods:
 *   - critical: 365 days
 *   - warning:  90 days
 *   - info:     30 days
 *
 * The actual deletion is performed inside a Postgres function
 * (`purge_expired_audit_logs`) that sets `SET LOCAL app.audit_purge_active = 'true'`
 * before deleting, satisfying the immutability trigger guard.
 *
 * Triggered by Vercel Cron daily at 02:00 UTC.
 * Protected by CRON_SECRET env var.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

  // Call the Postgres function that handles the transaction internally.
  // The function sets SET LOCAL app.audit_purge_active = 'true' before deleting,
  // which is the only permitted deletion path through the immutability trigger.
  const { data, error } = await supabase.rpc("purge_expired_audit_logs");

  if (error) {
    console.error("[cron/audit-log-purge] purge failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const deleted = data as { critical: number; warning: number; info: number };

  // Write an audit entry recording the purge operation
  try {
    await writeAuditLog({
      action:        "audit_log.purged",
      actor_type:    "system",
      actor_id:      "cron_audit_purge",
      actor_name:    "Audit Log Purge Cron",
      resource_type: "audit_log",
      metadata:      deleted,
    });
  } catch (auditErr) {
    // Non-blocking — a failed audit write must never block the primary operation
    console.error("[cron/audit-log-purge] writeAuditLog failed:", auditErr);
  }

  console.log(
    `[cron/audit-log-purge] purged critical=${deleted.critical} warning=${deleted.warning} info=${deleted.info}`
  );

  return NextResponse.json({ success: true, deleted });
}
