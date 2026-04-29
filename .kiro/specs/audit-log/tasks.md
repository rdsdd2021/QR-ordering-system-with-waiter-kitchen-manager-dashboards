# Implementation Plan: Audit Log

## Overview

Implement a tamper-evident, queryable audit log for the qr-order platform. The work is ordered bottom-up: database schema first, then the core utility library, then API routes, then UI components, and finally property-based and integration tests. Each step is immediately usable by the next.

## Tasks

- [x] 1. Database schema — `audit_logs` and `audit_notifications` tables
  - Create the `audit_logs` table with all columns defined in the design (`id`, `restaurant_id`, `actor_type`, `actor_id`, `actor_name`, `action`, `resource_type`, `resource_id`, `resource_name`, `metadata`, `severity`, `ip_address`, `created_at`)
  - Add all five indexes: `idx_audit_logs_restaurant_time`, `idx_audit_logs_restaurant_severity_time`, `idx_audit_logs_resource`, `idx_audit_logs_cursor`, `idx_audit_logs_time`
  - Enable RLS on `audit_logs` and create the `manager_read_own_restaurant` SELECT policy
  - Create the `audit_logs_immutable()` trigger function and attach the `audit_logs_immutability_guard` trigger (BEFORE UPDATE OR DELETE)
  - Create the `audit_notifications` table with its unique constraint on `audit_log_id`
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 3.5_

- [x] 2. Core audit utility — `lib/audit-log.ts`
  - [x] 2.1 Implement types, severity mapping, and helper functions
    - Export `ActorType`, `Severity`, and `AuditEntry` TypeScript types
    - Implement `getSeverity(action: string): Severity` using the `CRITICAL_ACTIONS` and `WARNING_ACTIONS` sets from the design
    - Implement `getClientIp(req: NextRequest): string | null` checking `X-Forwarded-For`, then `X-Real-IP`, then returning null
    - _Requirements: 1.4, 1.5, 1.6, 1.7_

  - [ ]* 2.2 Write property test for `getSeverity` (Property 2)
    - Install `fast-check` as a dev dependency (`npm install --save-dev fast-check`)
    - Create `qr-order/lib/__tests__/audit-log.property.test.ts`
    - **Property 2: Severity Assignment Correctness** — for any action string in the full tracked-action set, `getSeverity` returns exactly one of `'info'`, `'warning'`, `'critical'` consistent with the mapping table
    - **Validates: Requirements 1.4, 1.5, 1.6**

  - [x] 2.3 Implement `writeAuditLog`
    - Create a service-role Supabase client inside the function (never reuse the anon client)
    - Derive `severity` via `getSeverity` before inserting — callers never supply it
    - Wrap the insert in try/catch: on failure log `console.error('[audit-log] write failed', { error, entry })` and return `null`; on success return the inserted row `id`
    - After a successful insert where `severity === 'critical'`, call `dispatchCriticalAlert` fire-and-forget (import from `lib/audit-alert.ts`)
    - _Requirements: 1.1, 1.2, 1.3, 1.8, 8.3, 8.4_

  - [ ]* 2.4 Write unit tests for `writeAuditLog`
    - Create `qr-order/lib/__tests__/audit-log.test.ts`
    - Test: insert payload shape matches `AuditEntry` fields (mock Supabase service client)
    - Test: when DB insert fails, function returns `null` and does not throw
    - Test: `getClientIp` extracts IP from `X-Forwarded-For`, `X-Real-IP`, and falls back to null
    - _Requirements: 1.2, 1.3, 1.7_

  - [ ]* 2.5 Write property test for `writeAuditLog` field completeness (Property 1)
    - **Property 1: Audit Entry Field Completeness** — for any valid `AuditEntry` input, the inserted row has all required fields non-null and non-empty (`id`, `actor_type`, `actor_id`, `actor_name`, `action`, `resource_type`, `severity`, `created_at`)
    - Use a mocked Supabase client that captures the insert payload
    - **Validates: Requirements 1.1, 8.3, 8.4**

  - [ ]* 2.6 Write property test for UUID validity (Property 14)
    - **Property 14: UUID Validity** — for any entry creation call, the `id` returned matches the UUID v4 regex `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`
    - **Validates: Requirements 8.3**

- [x] 3. Alert dispatcher — `lib/audit-alert.ts`
  - [x] 3.1 Implement `dispatchCriticalAlert`
    - Check `audit_notifications` for an existing row with the same `audit_log_id` (unique constraint deduplication); if found, return early
    - Insert a `pending` row into `audit_notifications`
    - Dispatch an in-app notification via Supabase Realtime broadcast on channel `critical-alerts:{restaurant_id}`
    - Retry up to 3 times with 10-second intervals on failure; after 3 failures update the row to `status = 'failed'` and log the error
    - On success update the row to `status = 'delivered'` and set `delivered_at`
    - _Requirements: 7.1, 7.3, 7.4, 7.5_

  - [ ]* 3.2 Write unit tests for `dispatchCriticalAlert`
    - Test: alert payload contains all required fields (`action`, `actor_name`, `actor_type`, `resource_type`, `resource_name`, `created_at`)
    - Test: duplicate dispatch for the same entry ID is silently skipped
    - Test: after 3 failures the notification row is marked `failed`
    - _Requirements: 7.3, 7.4, 7.5_

  - [ ]* 3.3 Write property test for alert content completeness (Property 12)
    - **Property 12: Alert Content Completeness** — for any critical audit entry, the alert payload contains all required fields
    - **Validates: Requirements 7.3**

  - [ ]* 3.4 Write property test for alert idempotency (Property 13)
    - **Property 13: Alert Idempotency** — calling dispatch multiple times with the same entry ID results in at most one delivered notification
    - **Validates: Requirements 7.5**

- [x] 4. Checkpoint — core library complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Query API route — `app/api/audit-logs/route.ts`
  - [x] 5.1 Implement `GET /api/audit-logs`
    - Authenticate the caller: resolve manager `restaurant_id` from the Bearer token (same pattern as `app/api/webhooks/route.ts`); for admin requests validate via `validateAdminRequest`
    - Enforce access control: managers are scoped to their own `restaurant_id`; if a manager passes a different `restaurant_id`, return an empty result set and write a `warning` audit entry with action `audit_log.unauthorized_access_attempt`
    - Apply all query parameters: `from`, `to`, `actor_type`, `actor_id`, `action`, `resource_type`, `resource_id`, `severity`, `q` (free-text across `actor_name`, `resource_name`, `metadata`), `page_size` (25/50/100, default 25), `cursor` (keyset format `{created_at}_{id}`), `restaurant_id` (admin only)
    - Return `{ entries, total_count, next_cursor, has_more }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 9.4, 9.5_

  - [ ]* 5.2 Write unit tests for the query route
    - Test: manager cannot see entries from another restaurant (returns empty set)
    - Test: unauthorized access attempt is logged as a `warning` entry
    - Test: multiple filters are applied with AND logic
    - Test: results are ordered `created_at DESC, id DESC`
    - _Requirements: 3.1, 3.4, 4.3, 4.4_

  - [ ]* 5.3 Write property test for manager access scoping (Property 3)
    - **Property 3: Manager Access Scoping** — for any manager with a given `restaurant_id`, query results contain only entries where `entry.restaurant_id === manager.restaurant_id`
    - **Validates: Requirements 3.1, 3.4**

  - [ ]* 5.4 Write property test for staff access denial (Property 4)
    - **Property 4: Staff Access Denial** — for any staff user (waiter/kitchen), any request to the audit log endpoints returns 401 or 403
    - **Validates: Requirements 3.3**

  - [ ]* 5.5 Write property test for filter AND logic (Property 5)
    - **Property 5: Filter AND Logic** — for any combination of active filters, every returned entry satisfies all active filters simultaneously
    - **Validates: Requirements 4.1, 4.3**

  - [ ]* 5.6 Write property test for result ordering (Property 6)
    - **Property 6: Result Ordering** — for any result set with two or more entries, `entries[i].created_at >= entries[i+1].created_at`; ties broken by `id DESC`
    - **Validates: Requirements 4.4**

  - [ ]* 5.7 Write property test for pagination completeness (Property 7)
    - **Property 7: Pagination Completeness and Non-Overlap** — iterating all pages yields every matching entry exactly once
    - **Validates: Requirements 4.5, 9.5**

  - [ ]* 5.8 Write property test for total count accuracy (Property 8)
    - **Property 8: Total Count Accuracy** — `total_count` equals the actual number of entries satisfying the active filters, regardless of page or cursor
    - **Validates: Requirements 4.7**

- [x] 6. Export API route — `app/api/audit-logs/export/route.ts`
  - [x] 6.1 Implement `GET /api/audit-logs/export`
    - Reuse the same auth and filter logic as the query route
    - Cap at 10,000 entries; if the result set exceeds this, include a `X-Export-Truncated: true` header
    - For `format=csv`: build a CSV string with columns `id`, `created_at`, `actor_type`, `actor_name`, `action`, `resource_type`, `resource_name`, `severity`, `ip_address`; return with `Content-Disposition: attachment; filename="audit-log.csv"`
    - For `format=json` (admin only): return all fields including `metadata`; return with `Content-Disposition: attachment; filename="audit-log.json"`
    - After generating the export, call `writeAuditLog` with action `audit_log.exported`, including applied filters and entry count in `metadata`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 6.2 Write unit tests for the export route
    - Test: CSV contains exactly the required columns in the correct order
    - Test: JSON export includes `metadata` field
    - Test: export is capped at 10,000 entries
    - Test: `audit_log.exported` entry is written with correct filter metadata
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 6.3 Write property test for CSV column completeness (Property 10)
    - **Property 10: CSV Export Column Completeness** — for any set of audit entries, the CSV contains all required columns and each row has correct values
    - **Validates: Requirements 6.1, 6.5**

  - [ ]* 6.4 Write property test for export self-logging (Property 11)
    - **Property 11: Export Self-Logging** — for any export operation, an `audit_log.exported` entry is created with the applied filter parameters and entry count
    - **Validates: Requirements 6.4**

- [x] 7. Purge cron route — `app/api/cron/audit-log-purge/route.ts`
  - [x] 7.1 Implement `GET /api/cron/audit-log-purge`
    - Protect with `CRON_SECRET` (same pattern as `app/api/cron/webhook-retries/route.ts`)
    - Open a Supabase transaction, set `SET LOCAL app.audit_purge_active = 'true'`, then delete entries where age exceeds the severity-based retention period (`critical` > 365 days, `warning` > 90 days, `info` > 30 days)
    - Count deleted rows per severity level
    - Write an `audit_log.purged` audit entry with `actor_type = 'system'`, `actor_id = 'cron_audit_purge'`, and deleted counts per severity in `metadata`
    - Register the cron in `vercel.json` with schedule `0 2 * * *` (daily at 02:00 UTC)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 7.2 Write unit tests for the purge route
    - Test: entries older than their retention threshold are deleted
    - Test: entries within their retention period are not deleted
    - Test: `audit_log.purged` entry is written with correct counts
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6_

  - [ ]* 7.3 Write property test for retention purge correctness (Property 9)
    - **Property 9: Retention Purge Correctness** — for any set of entries with known `severity` and `created_at`, the purge deletes exactly those entries whose age exceeds the retention period for their severity, leaving all others untouched
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 8. Checkpoint — all API routes complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Instrument existing API routes with `writeAuditLog` calls
  - [x] 9.1 Staff routes (`app/api/staff/create`, `update`, `delete`)
    - Add `writeAuditLog` after the primary operation succeeds in each route
    - `staff.created` (warning), `staff.updated` (info), `staff.deleted` (critical), `staff.deactivated` (warning)
    - Include `ip_address` via `getClientIp(req)`, `actor_type: 'manager'`, and relevant `metadata` (changed fields for updates)
    - _Requirements: 2.3, 1.7_

  - [x] 9.2 Admin toggle-restaurant route (`app/api/admin/toggle-restaurant`)
    - Add `writeAuditLog` for `restaurant.activated` (critical) and `restaurant.deactivated` (critical)
    - Set `actor_type: 'admin'`, `actor_id: 'admin'`, `actor_name: 'Super Admin'`
    - _Requirements: 2.4, 1.4_

  - [x] 9.3 Admin change-password route (`app/api/admin/change-password`)
    - Add `writeAuditLog` for `auth.password_changed` (critical)
    - _Requirements: 2.9, 1.4_

  - [x] 9.4 Webhook routes (`app/api/webhooks` and `app/api/webhooks/[id]`)
    - Add `writeAuditLog` for `webhook.created` (warning), `webhook.updated` (info), `webhook.deleted` (warning), `webhook.secret_rotated` (critical), `webhook.test_sent` (info)
    - _Requirements: 2.6, 1.4, 1.5_

  - [x] 9.5 Billing / payment routes (`app/api/phonepe/*`, `app/api/stripe/*`)
    - Add `writeAuditLog` for `billing.payment_succeeded` (info), `billing.payment_failed` (warning), `billing.plan_changed` (critical), `billing.subscription_activated` (warning), `billing.subscription_expired` (warning)
    - Set `actor_type: 'system'` with appropriate `actor_id` (e.g., `'phonepe_webhook'`, `'stripe_webhook'`)
    - _Requirements: 2.8, 1.8_

  - [x] 9.6 Coupon routes (`app/api/admin/coupons`)
    - Add `writeAuditLog` for `coupon.created` (critical), `coupon.updated` (info), `coupon.deleted` (critical), `coupon.validated` (info)
    - _Requirements: 2.7, 1.4_

  - [x] 9.7 Cron webhook-retries route (`app/api/cron/webhook-retries`)
    - Add `writeAuditLog` for `webhook.delivery_failed` (info) when a delivery permanently fails after all retries
    - Set `actor_type: 'system'`, `actor_id: 'cron_webhook_retries'`
    - _Requirements: 2.6, 1.8_

- [x] 10. Checkpoint — all instrumentation complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Manager UI component — `components/manager/AuditLogPanel.tsx`
  - [x] 11.1 Build the base table and filter bar
    - Create `AuditLogPanel` as a React client component accepting `{ restaurantId: string }`
    - Implement the date range selector (today / yesterday / last 7 days / last 30 days / custom)
    - Implement the filter bar: severity, actor_type, action, resource_type, free-text search (`q`)
    - Fetch from `GET /api/audit-logs` with the active filters; display results in a paginated table (default 25 per page)
    - Show severity badges: `critical` in red, `warning` in amber, `info` in muted
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 10.4, 11.2, 11.3_

  - [x] 11.2 Add summary banner, expandable rows, and CSV export
    - Add a summary banner showing count of `critical` and `warning` entries in the last 24 hours
    - Make each row expandable to show the full `metadata` payload in a readable format (JSON pretty-print or key-value list)
    - Add a CSV export button that calls `GET /api/audit-logs/export?format=csv` with the current filters
    - Show a clear empty state message when filters yield zero results
    - _Requirements: 4.6, 6.1, 11.4, 11.5_

  - [x] 11.3 Add real-time updates via Supabase Realtime
    - Subscribe to the `audit_logs` Postgres changes channel scoped to `restaurant_id`
    - Prepend new entries to the top of the table without a full page reload
    - Unsubscribe on component unmount
    - _Requirements: 7.1_

  - [x] 11.4 Wire `AuditLogPanel` into `ManagerClient.tsx`
    - Add `"auditlog"` to the `Tab` union type
    - Add an "Audit Log" nav item under the "Account" group in `buildNavGroups` (use the `ScrollText` icon from lucide-react)
    - Add `PAGE_META` entry for the new tab
    - Render `<AuditLogPanel restaurantId={restaurant.id} />` when `activeTab === 'auditlog'`
    - _Requirements: 11.1_

- [x] 12. Admin UI component — `components/admin/AuditLogAdmin.tsx`
  - [x] 12.1 Build `AuditLogAdmin` extending `AuditLogPanel` features
    - Create `AuditLogAdmin` as a React client component accepting `{ pin: string }`
    - Reuse the same filter bar and table from `AuditLogPanel` but fetch via the admin proxy (`adminFetch`)
    - Add a `restaurant_name` column to the table
    - Add a restaurant filter dropdown to scope the view to a single restaurant
    - Add a JSON export button (admin only) calling `GET /api/audit-logs/export?format=json`
    - Default to showing the most recent 50 entries across all restaurants on first open
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 12.2 Wire `AuditLogAdmin` into `AdminClient.tsx`
    - Add `"auditlog"` to the `activeTab` union type in `AdminClient.tsx`
    - Add an "Audit Log" tab button alongside Restaurants, Coupons, Plans
    - Update `handleTabChange` to accept the new tab value
    - Render `<AuditLogAdmin pin={pin} />` when `activeTab === 'auditlog'`
    - _Requirements: 10.1_

- [x] 13. Final checkpoint — full feature wired end-to-end
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- All `writeAuditLog` calls must be wrapped in try/catch at the call site — a failed write must never block the originating action (Requirement 1.3)
- Property tests use **fast-check** with a minimum of 100 iterations per property; each test file includes a comment `// Feature: audit-log, Property N: <Title>`
- The immutability trigger allows DELETE only when `app.audit_purge_active = 'true'` is set in the session — the purge cron must use `SET LOCAL` inside a transaction
- Cursor format for keyset pagination: `{created_at ISO string}_{uuid}` — encode/decode helpers should live in `lib/audit-log.ts`
- The `audit_notifications` unique constraint on `audit_log_id` is the primary deduplication guard for alerts; the application layer checks it before inserting
