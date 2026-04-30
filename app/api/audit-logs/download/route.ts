/**
 * GET /api/audit-logs/export
 *
 * Export audit log entries as CSV or JSON with the same auth and filter logic
 * as GET /api/audit-logs.
 *
 * Access control:
 *   - Admin (Bearer ADMIN_SECRET): can export across all restaurants; may pass `restaurant_id` to scope
 *   - Manager (Bearer Supabase JWT): scoped to their own restaurant_id only
 *   - Staff (waiter/kitchen): 403 Forbidden
 *   - Unauthenticated: 401 Unauthorized
 *
 * Format:
 *   - `format=csv` (default): columns id, created_at, actor_type, actor_name, action,
 *     resource_type, resource_name, severity, ip_address
 *   - `format=json` (admin only): all fields including metadata
 *
 * Export cap: 10,000 entries. If the result exceeds this, the response includes
 * `X-Export-Truncated: true` and only the first 10,000 entries are included.
 *
 * Self-logging: after generating the export, writes an `audit_log.exported` entry.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateAdminRequest } from "@/lib/admin-auth";
import { writeAuditLog, getClientIp } from "@/lib/audit-log";
import { getUserFromToken, extractBearerToken } from "@/lib/server-auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Resolve the authenticated manager's restaurant_id from a Bearer JWT.
 * Returns `{ restaurantId, userId, actorName }` on success, or `null` if the token
 * is missing / invalid / belongs to a non-manager user.
 * Returns `{ forbidden: true }` when the token is valid but the role is staff.
 */
async function resolveManagerAuth(req: NextRequest): Promise<
  | { restaurantId: string; userId: string; actorName: string }
  | { forbidden: true }
  | null
> {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) return null;

  const user = await getUserFromToken(token);
  if (!user) return null;

  // Staff roles are explicitly forbidden
  if (user.role === "waiter" || user.role === "kitchen") {
    return { forbidden: true };
  }

  if (user.role !== "manager" || !user.restaurant_id) return null;

  return {
    restaurantId: user.restaurant_id,
    userId: user.auth_id,
    actorName: user.name ?? "Manager",
  };
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  "id",
  "created_at",
  "actor_type",
  "actor_name",
  "action",
  "resource_type",
  "resource_name",
  "severity",
  "ip_address",
] as const;

/**
 * Escape a single CSV cell value.
 * Wraps in double quotes if the value contains commas, double quotes, or newlines.
 * Internal double quotes are escaped as `""`.
 */
export function escapeCsvValue(value: string | null | undefined): string {
  const str = value == null ? "" : String(value);
  // Need quoting if the value contains comma, double-quote, or newline
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert an array of audit log entries to a CSV string.
 * First row is the header; subsequent rows are data.
 */
export function buildCsv(entries: Record<string, unknown>[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = entries.map((entry) =>
    CSV_COLUMNS.map((col) => escapeCsvValue(entry[col] as string | null | undefined)).join(",")
  );
  return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Export cap
// ---------------------------------------------------------------------------

const EXPORT_CAP = 10_000;
const FETCH_LIMIT = EXPORT_CAP + 1; // fetch one extra to detect truncation

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    // ── 1. Authentication & Authorization ──────────────────────────────────

    const isAdmin = validateAdminRequest(req);

    let managerRestaurantId: string | null = null;
    let managerUserId: string | null = null;
    let managerActorName: string | null = null;

    if (!isAdmin) {
      const managerAuth = await resolveManagerAuth(req);

      if (managerAuth === null) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if ("forbidden" in managerAuth) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      managerRestaurantId = managerAuth.restaurantId;
      managerUserId = managerAuth.userId;
      managerActorName = managerAuth.actorName;
    }

    // ── 2. Parse query parameters ─────────────────────────────────────────

    const sp = req.nextUrl.searchParams;

    const format       = sp.get("format") ?? "csv";
    const from         = sp.get("from")          ?? undefined;
    const to           = sp.get("to")            ?? undefined;
    const actorType    = sp.get("actor_type")    ?? undefined;
    const actorId      = sp.get("actor_id")      ?? undefined;
    const action       = sp.get("action")        ?? undefined;
    const resourceType = sp.get("resource_type") ?? undefined;
    const resourceId   = sp.get("resource_id")   ?? undefined;
    const severity     = sp.get("severity")      ?? undefined;
    const q            = sp.get("q")             ?? undefined;

    // restaurant_id: admin-only filter
    const requestedRestaurantId = sp.get("restaurant_id") ?? undefined;

    // ── 3. Format validation ──────────────────────────────────────────────

    if (format !== "csv" && format !== "json") {
      return NextResponse.json(
        { error: "Invalid format. Use 'csv' or 'json'.", code: "INVALID_FORMAT" },
        { status: 400 }
      );
    }

    // JSON export is admin-only
    if (format === "json" && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── 4. Access control for restaurant_id ──────────────────────────────

    let effectiveRestaurantId: string | null = null;

    if (isAdmin) {
      effectiveRestaurantId = requestedRestaurantId ?? null;
    } else {
      effectiveRestaurantId = managerRestaurantId!;

      // If the manager passed a different restaurant_id, return empty + log warning
      if (requestedRestaurantId && requestedRestaurantId !== managerRestaurantId) {
        writeAuditLog({
          restaurant_id: managerRestaurantId,
          actor_type:    "manager",
          actor_id:      managerUserId!,
          actor_name:    managerActorName!,
          action:        "audit_log.unauthorized_access_attempt",
          resource_type: "audit_log",
          metadata: {
            attempted_restaurant_id: requestedRestaurantId,
          },
          ip_address: getClientIp(req),
        }).catch((err) =>
          console.error("[audit-logs/export] failed to write unauthorized_access_attempt", err)
        );

        // Return an empty export
        if (format === "csv") {
          const csv = buildCsv([]);
          return new NextResponse(csv, {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": 'attachment; filename="audit-log.csv"',
            },
          });
        } else {
          return new NextResponse(JSON.stringify([]), {
            headers: {
              "Content-Type": "application/json",
              "Content-Disposition": 'attachment; filename="audit-log.json"',
            },
          });
        }
      }
    }

    // ── 5. Build and execute query via RPC (supports metadata text search) ──

    const supabase = getServiceClient();

    const { data: rawEntries, error: dataError } = await supabase.rpc(
      "search_audit_logs",
      {
        p_restaurant_id: effectiveRestaurantId ?? undefined,
        p_from:          from,
        p_to:            to,
        p_actor_type:    actorType,
        p_actor_id:      actorId,
        p_action:        action,
        p_resource_type: resourceType,
        p_resource_id:   resourceId,
        p_severity:      severity,
        p_q:             q,
        p_page_size:     FETCH_LIMIT,
      }
    );

    if (dataError) {
      console.error("[audit-logs/export] data query failed", dataError);
      return NextResponse.json(
        { error: "Export failed", code: "EXPORT_ERROR" },
        { status: 500 }
      );
    }

    // ── 6. Apply export cap ───────────────────────────────────────────────

    const truncated = (rawEntries?.length ?? 0) > EXPORT_CAP;
    const entries = truncated
      ? (rawEntries ?? []).slice(0, EXPORT_CAP)
      : (rawEntries ?? []);

    const exportedCount = entries.length;

    // ── 7. Self-logging (fire-and-forget) ─────────────────────────────────

    const appliedFilters: Record<string, unknown> = {};
    if (from)                    appliedFilters.from = from;
    if (to)                      appliedFilters.to = to;
    if (actorType)               appliedFilters.actor_type = actorType;
    if (actorId)                 appliedFilters.actor_id = actorId;
    if (action)                  appliedFilters.action = action;
    if (resourceType)            appliedFilters.resource_type = resourceType;
    if (resourceId)              appliedFilters.resource_id = resourceId;
    if (severity)                appliedFilters.severity = severity;
    if (q)                       appliedFilters.q = q;
    if (effectiveRestaurantId)   appliedFilters.restaurant_id = effectiveRestaurantId;
    appliedFilters.format = format;

    writeAuditLog({
      restaurant_id: effectiveRestaurantId,
      actor_type:    isAdmin ? "admin" : "manager",
      actor_id:      isAdmin ? "admin" : managerUserId!,
      actor_name:    isAdmin ? "Super Admin" : managerActorName!,
      action:        "audit_log.exported",
      resource_type: "audit_log",
      metadata: {
        filters:       appliedFilters,
        entry_count:   exportedCount,
        truncated,
      },
      ip_address: getClientIp(req),
    }).catch((err) =>
      console.error("[audit-logs/export] failed to write audit_log.exported", err)
    );

    // ── 8. Build and return the response ──────────────────────────────────

    const responseHeaders: Record<string, string> = {};
    if (truncated) {
      responseHeaders["X-Export-Truncated"] = "true";
    }

    if (format === "csv") {
      const csv = buildCsv(entries as Record<string, unknown>[]);
      return new NextResponse(csv, {
        headers: {
          ...responseHeaders,
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="audit-log.csv"',
        },
      });
    } else {
      // JSON — all fields including metadata
      return new NextResponse(JSON.stringify(entries, null, 2), {
        headers: {
          ...responseHeaders,
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="audit-log.json"',
        },
      });
    }
  } catch (err) {
    console.error("[audit-logs/export] unexpected error", err);
    return NextResponse.json(
      { error: "Export failed", code: "EXPORT_ERROR" },
      { status: 500 }
    );
  }
}
