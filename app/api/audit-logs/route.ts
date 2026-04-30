/**
 * GET /api/audit-logs
 *
 * Query audit log entries with filtering, free-text search, and keyset pagination.
 *
 * Access control:
 *   - Admin (Bearer ADMIN_SECRET): can query across all restaurants; may pass `restaurant_id` to scope
 *   - Manager (Bearer Supabase JWT): scoped to their own restaurant_id only
 *   - Staff (waiter/kitchen): 403 Forbidden
 *   - Unauthenticated: 401 Unauthorized
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 9.4, 9.5
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateAdminRequest } from "@/lib/admin-auth";
import { writeAuditLog, decodeCursor, encodeCursor, getClientIp } from "@/lib/audit-log";
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
// Valid page sizes
// ---------------------------------------------------------------------------

const VALID_PAGE_SIZES = new Set([25, 50, 100]);

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // ── 1. Authentication & Authorization ──────────────────────────────────────

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

  // ── 2. Parse query parameters ───────────────────────────────────────────────

  const sp = req.nextUrl.searchParams;

  const from         = sp.get("from")          ?? undefined;
  const to           = sp.get("to")            ?? undefined;
  const actorType    = sp.get("actor_type")    ?? undefined;
  const actorId      = sp.get("actor_id")      ?? undefined;
  const action       = sp.get("action")        ?? undefined;
  const resourceType = sp.get("resource_type") ?? undefined;
  const resourceId   = sp.get("resource_id")   ?? undefined;
  const severity     = sp.get("severity")      ?? undefined;
  const q            = sp.get("q")             ?? undefined;
  const cursorParam  = sp.get("cursor")        ?? undefined;

  // page_size: default 25, must be 25 | 50 | 100
  const pageSizeRaw = parseInt(sp.get("page_size") ?? "25", 10);
  const pageSize    = VALID_PAGE_SIZES.has(pageSizeRaw) ? pageSizeRaw : 25;

  // restaurant_id: admin-only filter
  const requestedRestaurantId = sp.get("restaurant_id") ?? undefined;

  // ── 3. Access control for restaurant_id ────────────────────────────────────

  let effectiveRestaurantId: string | null = null;

  if (isAdmin) {
    // Admin can optionally scope to a specific restaurant
    effectiveRestaurantId = requestedRestaurantId ?? null;
  } else {
    // Manager: always scoped to their own restaurant
    effectiveRestaurantId = managerRestaurantId!;

    // If the manager passed a different restaurant_id, return empty + log warning
    if (requestedRestaurantId && requestedRestaurantId !== managerRestaurantId) {
      // Fire-and-forget warning audit entry
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
        console.error("[audit-logs] failed to write unauthorized_access_attempt", err)
      );

      return NextResponse.json({
        entries:     [],
        total_count: 0,
        next_cursor: null,
        has_more:    false,
      });
    }
  }

  // ── 4. Decode cursor ────────────────────────────────────────────────────────

  let cursorData: { createdAt: string; id: string } | null = null;
  if (cursorParam) {
    cursorData = decodeCursor(cursorParam);
    // Malformed cursor — treat as no cursor (first page)
  }

  // ── 5. Build and execute queries ────────────────────────────────────────────

  try {
    const supabase = getServiceClient();

    // Shared RPC params (used for both search and count functions)
    const rpcParams = {
      p_restaurant_id:   effectiveRestaurantId ?? undefined,
      p_from:            from,
      p_to:              to,
      p_actor_type:      actorType,
      p_actor_id:        actorId,
      p_action:          action,
      p_resource_type:   resourceType,
      p_resource_id:     resourceId,
      p_severity:        severity,
      p_q:               q,
    };

    // ── 5a. Total count query ─────────────────────────────────────────────────
    const { data: countData, error: countError } = await supabase.rpc(
      "count_audit_logs",
      rpcParams
    );

    if (countError) {
      console.error("[audit-logs] count query failed", countError);
      return NextResponse.json(
        { error: "Failed to query audit logs", code: "QUERY_ERROR" },
        { status: 500 }
      );
    }

    const count = Number(countData ?? 0);

    // ── 5b. Data query (with cursor and pagination) ───────────────────────────
    const { data: entries, error: dataError } = await supabase.rpc(
      "search_audit_logs",
      {
        ...rpcParams,
        p_cursor_ts:  cursorData?.createdAt ?? undefined,
        p_cursor_id:  cursorData?.id        ?? undefined,
        p_page_size:  pageSize,
      }
    );

    if (dataError) {
      console.error("[audit-logs] data query failed", dataError);
      return NextResponse.json(
        { error: "Failed to query audit logs", code: "QUERY_ERROR" },
        { status: 500 }
      );
    }

    // ── 6. Build pagination metadata ──────────────────────────────────────────

    const hasMore   = (entries?.length ?? 0) === pageSize;
    const lastEntry = entries && entries.length > 0 ? entries[entries.length - 1] : null;
    const nextCursor = hasMore && lastEntry
      ? encodeCursor(lastEntry.created_at, lastEntry.id)
      : null;

    return NextResponse.json({
      entries:     entries ?? [],
      total_count: count ?? 0,
      next_cursor: nextCursor,
      has_more:    hasMore,
    });
  } catch (err) {
    console.error("[audit-logs] unexpected error", err);
    return NextResponse.json(
      { error: "Failed to query audit logs", code: "QUERY_ERROR" },
      { status: 500 }
    );
  }
}
