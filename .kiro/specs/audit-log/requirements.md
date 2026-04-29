# Requirements Document

## Introduction

The Audit Log feature provides a tamper-evident, queryable record of every significant action taken across the qr-order platform. It covers all actor types — super admin, restaurant managers, staff (waiters, kitchen), and automated system processes (webhooks, payment callbacks, cron jobs). The log is stored in Supabase Postgres, surfaced in the manager dashboard and admin panel, and supports filtering, search, export, and optional alerting on sensitive events.

---

## Glossary

- **Audit_Log**: The system responsible for recording, storing, and surfacing immutable event records for all significant actions in the platform.
- **Audit_Entry**: A single immutable record in the audit log representing one discrete action.
- **Actor**: The entity that performed an action — one of: `admin`, `manager`, `staff` (waiter/kitchen), `system`, or `customer`.
- **Actor_ID**: The unique identifier of the Actor (Supabase auth user ID, staff user ID, or a fixed string such as `"system"` for automated processes).
- **Resource**: The entity that was acted upon (e.g., `order`, `menu_item`, `staff_member`, `webhook`, `coupon`, `plan`, `restaurant`, `table`, `floor`, `billing`).
- **Action**: A verb describing what was done to the Resource (e.g., `created`, `updated`, `deleted`, `status_changed`, `toggled`, `exported`).
- **Severity**: A classification of the event's sensitivity — one of `info`, `warning`, or `critical`.
- **Restaurant_Scope**: The restaurant to which an Audit_Entry belongs. Platform-level actions (admin actions) have a null restaurant scope.
- **Retention_Period**: The duration for which Audit_Entries are kept before automatic deletion.
- **Super_Admin**: The platform-level administrator who accesses the `/admin` panel.
- **Manager**: A restaurant-level user who accesses the `/manager/[restaurant_id]` dashboard.
- **Staff**: A waiter or kitchen user operating within a restaurant.
- **System**: Automated processes including webhook dispatch, payment callbacks (PhonePe, Stripe), and cron jobs.
- **Audit_Log_Viewer**: The UI component that displays, filters, and exports Audit_Entries.
- **Export**: A downloadable CSV or JSON file containing a filtered set of Audit_Entries.
- **Alert**: A real-time notification triggered when an Audit_Entry with `critical` Severity is created.

---

## Requirements

### Requirement 1: Audit Entry Creation

**User Story:** As a platform operator, I want every significant action to be automatically recorded in the audit log, so that I have a complete, reliable history of what happened and who did it.

#### Acceptance Criteria

1. WHEN any action listed in the Tracked Actions table (Requirement 2) occurs, THE Audit_Log SHALL create an Audit_Entry containing: `id` (UUID), `restaurant_id` (nullable), `actor_type` (enum: admin/manager/staff/system/customer), `actor_id`, `actor_name`, `action`, `resource_type`, `resource_id` (nullable), `resource_name` (nullable), `metadata` (JSONB with before/after snapshots where applicable), `severity` (info/warning/critical), `ip_address` (nullable), and `created_at` timestamp.
2. THE Audit_Log SHALL write Audit_Entries synchronously within the same request lifecycle so that a failed action does not produce a misleading log entry.
3. IF the Audit_Entry write fails, THEN THE Audit_Log SHALL not block or roll back the originating action, and SHALL emit a server-side error log with the failed entry payload.
4. THE Audit_Log SHALL assign Severity `critical` to: restaurant activation/deactivation, manager password changes, staff deletion, coupon creation/deletion, plan changes, and webhook secret rotation.
5. THE Audit_Log SHALL assign Severity `warning` to: staff creation/deactivation, webhook endpoint creation/deletion, billing plan upgrades/downgrades, and order cancellations.
6. THE Audit_Log SHALL assign Severity `info` to all remaining tracked actions.
7. THE Audit_Log SHALL record the `ip_address` of the HTTP request for all actions performed via the API layer.
8. WHEN an action is performed by an automated System process (webhook dispatch, payment callback, cron), THE Audit_Log SHALL set `actor_type` to `system` and `actor_id` to the process identifier (e.g., `"phonepe_webhook"`, `"stripe_webhook"`, `"cron_webhook_retries"`).

---

### Requirement 2: Tracked Actions

**User Story:** As a platform operator, I want a well-defined set of actions to be tracked, so that the audit log is comprehensive without being noisy.

#### Acceptance Criteria

1. THE Audit_Log SHALL track the following **Order** actions: `order.placed`, `order.status_changed` (with old and new status in metadata), `order.cancelled`, `order.billed`.
2. THE Audit_Log SHALL track the following **Menu** actions: `menu_item.created`, `menu_item.updated` (with changed fields in metadata), `menu_item.deleted`, `menu_item.availability_toggled`.
3. THE Audit_Log SHALL track the following **Staff** actions: `staff.created`, `staff.updated`, `staff.deleted`, `staff.deactivated`, `staff.password_changed`.
4. THE Audit_Log SHALL track the following **Restaurant & Settings** actions: `restaurant.activated`, `restaurant.deactivated`, `restaurant.settings_updated` (routing mode, geofencing, auto-confirm), `restaurant.details_updated` (name, logo, slug).
5. THE Audit_Log SHALL track the following **Table & Floor** actions: `table.created`, `table.updated`, `table.deleted`, `floor.created`, `floor.updated`, `floor.deleted`.
6. THE Audit_Log SHALL track the following **Webhook** actions: `webhook.created`, `webhook.updated`, `webhook.deleted`, `webhook.secret_rotated`, `webhook.test_sent`, `webhook.delivery_failed` (with endpoint URL and HTTP status in metadata).
7. THE Audit_Log SHALL track the following **Coupon** actions: `coupon.created`, `coupon.updated`, `coupon.deleted`, `coupon.validated` (with restaurant_id and result in metadata).
8. THE Audit_Log SHALL track the following **Billing & Plan** actions: `billing.plan_changed` (with old and new plan in metadata), `billing.subscription_activated`, `billing.subscription_expired`, `billing.payment_succeeded`, `billing.payment_failed`.
9. THE Audit_Log SHALL track the following **Auth** actions: `auth.manager_login`, `auth.manager_logout`, `auth.password_changed` (admin-initiated), `auth.staff_login`.
10. THE Audit_Log SHALL track the following **Export** actions: `audit_log.exported` (with filter parameters in metadata).

---

### Requirement 3: Access Control for Viewing Logs

**User Story:** As a manager, I want to view the audit log for my restaurant only, so that I can monitor activity without seeing other restaurants' data.

#### Acceptance Criteria

1. THE Audit_Log_Viewer SHALL enforce that a Manager can only query Audit_Entries where `restaurant_id` matches their own restaurant ID.
2. THE Audit_Log_Viewer SHALL enforce that the Super_Admin can query Audit_Entries across all restaurants, including platform-level entries where `restaurant_id` is null.
3. THE Audit_Log_Viewer SHALL enforce that Staff (waiter/kitchen) roles have no access to the Audit_Log_Viewer.
4. IF a Manager attempts to query Audit_Entries outside their restaurant scope, THEN THE Audit_Log_Viewer SHALL return an empty result set and log the attempt as a `warning` Audit_Entry.
5. THE Audit_Log_Viewer SHALL use Supabase Row Level Security (RLS) policies as the enforcement layer so that direct database access also respects access boundaries.

---

### Requirement 4: Filtering and Search

**User Story:** As a manager or admin, I want to filter and search the audit log, so that I can quickly find relevant events during an investigation.

#### Acceptance Criteria

1. THE Audit_Log_Viewer SHALL support filtering Audit_Entries by: date range (`created_at` from/to), `actor_type`, `actor_id`, `action`, `resource_type`, `resource_id`, and `severity`.
2. THE Audit_Log_Viewer SHALL support free-text search across `actor_name`, `resource_name`, and the `metadata` JSONB field.
3. WHEN multiple filters are applied simultaneously, THE Audit_Log_Viewer SHALL return only Audit_Entries that satisfy all active filters (AND logic).
4. THE Audit_Log_Viewer SHALL return results in reverse chronological order by default.
5. THE Audit_Log_Viewer SHALL support pagination with a configurable page size of 25, 50, or 100 entries per page.
6. WHEN a filter yields zero results, THE Audit_Log_Viewer SHALL display a clear empty state message rather than an error.
7. THE Audit_Log_Viewer SHALL display the total count of matching entries alongside the paginated results.

---

### Requirement 5: Retention Policy

**User Story:** As a platform operator, I want audit logs to be retained for a defined period and then automatically purged, so that storage costs remain predictable and compliance requirements are met.

#### Acceptance Criteria

1. THE Audit_Log SHALL retain Audit_Entries with Severity `critical` for a minimum of 365 days.
2. THE Audit_Log SHALL retain Audit_Entries with Severity `warning` for a minimum of 90 days.
3. THE Audit_Log SHALL retain Audit_Entries with Severity `info` for a minimum of 30 days.
4. WHEN an Audit_Entry's age exceeds its Severity-based Retention_Period, THE Audit_Log SHALL delete it during the next scheduled purge run.
5. THE Audit_Log SHALL execute the purge process via a Supabase scheduled function or cron job that runs once every 24 hours.
6. WHEN the purge process runs, THE Audit_Log SHALL itself create an Audit_Entry of action `audit_log.purged` with `actor_type` `system`, recording the count of deleted entries per severity level in metadata.
7. THE Audit_Log SHALL NOT delete Audit_Entries that are referenced by an active export job or flagged for legal hold.

---

### Requirement 6: Export

**User Story:** As a manager or admin, I want to export audit log entries to CSV or JSON, so that I can share records with stakeholders or import them into external tools.

#### Acceptance Criteria

1. THE Audit_Log_Viewer SHALL allow a Manager or Super_Admin to export the currently filtered set of Audit_Entries as a CSV file.
2. THE Audit_Log_Viewer SHALL allow a Super_Admin to export the currently filtered set of Audit_Entries as a JSON file.
3. WHEN an export is requested, THE Audit_Log SHALL cap the export at 10,000 entries per request and notify the user if the result set exceeds this limit.
4. THE Audit_Log SHALL record an `audit_log.exported` Audit_Entry whenever an export is triggered, including the applied filters and entry count in metadata.
5. WHEN a CSV export is generated, THE Audit_Log_Viewer SHALL include the columns: `id`, `created_at`, `actor_type`, `actor_name`, `action`, `resource_type`, `resource_name`, `severity`, `ip_address`.
6. WHEN a JSON export is generated, THE Audit_Log_Viewer SHALL include all Audit_Entry fields including the full `metadata` JSONB object.

---

### Requirement 7: Alerting on Critical Events

**User Story:** As a manager, I want to be notified immediately when a critical action occurs in my restaurant, so that I can respond to potential security or operational issues in real time.

#### Acceptance Criteria

1. WHEN an Audit_Entry with Severity `critical` is created for a restaurant, THE Audit_Log SHALL dispatch an in-app notification to all Manager users of that restaurant within 5 seconds of the entry being written.
2. WHERE email notifications are enabled for a restaurant, THE Audit_Log SHALL send an email alert to the Manager's registered email address for each `critical` Audit_Entry.
3. THE Audit_Log SHALL include in each alert: the action performed, the actor name and type, the affected resource, and the timestamp.
4. IF the in-app notification dispatch fails, THEN THE Audit_Log SHALL retry delivery up to 3 times with a 10-second interval before marking the notification as failed.
5. THE Audit_Log SHALL NOT send duplicate alerts for the same Audit_Entry ID regardless of retry attempts.
6. WHERE a Manager has configured a webhook endpoint, THE Audit_Log SHALL also deliver `critical` Audit_Entries to that endpoint using the existing webhook dispatch infrastructure.

---

### Requirement 8: Immutability and Integrity

**User Story:** As a platform operator, I want audit log entries to be immutable once written, so that the log can be trusted as an accurate historical record.

#### Acceptance Criteria

1. THE Audit_Log SHALL store Audit_Entries in a Postgres table with no `UPDATE` or `DELETE` permissions granted to the application service role, enforced via Supabase RLS and table-level grants.
2. THE Audit_Log SHALL use an append-only insert pattern — no API endpoint or application code path SHALL modify or delete an existing Audit_Entry outside of the scheduled retention purge.
3. THE Audit_Log SHALL generate each Audit_Entry `id` as a UUID v4 at the database level using `gen_random_uuid()` to prevent client-side ID manipulation.
4. THE Audit_Log SHALL record `created_at` using `now()` at the database level (not supplied by the client) to prevent timestamp manipulation.
5. IF a direct database modification of an Audit_Entry is attempted outside the purge process, THEN THE Audit_Log SHALL reject the operation via a Postgres trigger that raises an exception.

---

### Requirement 9: Performance

**User Story:** As a manager, I want the audit log viewer to load quickly even when there are thousands of entries, so that investigations are not slowed down by the UI.

#### Acceptance Criteria

1. THE Audit_Log SHALL maintain a Postgres index on `(restaurant_id, created_at DESC)` to support the primary query pattern.
2. THE Audit_Log SHALL maintain a Postgres index on `(restaurant_id, severity, created_at DESC)` to support severity-filtered queries.
3. THE Audit_Log SHALL maintain a Postgres index on `(resource_type, resource_id)` to support resource-scoped lookups.
4. WHEN the Audit_Log_Viewer executes a filtered query with a date range of 30 days or less, THE Audit_Log SHALL return the first page of results within 500ms under normal load.
5. THE Audit_Log SHALL use cursor-based or keyset pagination rather than `OFFSET`-based pagination to maintain consistent performance as the table grows.

---

### Requirement 10: Admin Panel Integration

**User Story:** As a super admin, I want to view platform-wide audit logs from the admin panel, so that I can monitor cross-restaurant activity and investigate platform-level events.

#### Acceptance Criteria

1. THE Audit_Log_Viewer SHALL be accessible from the Admin Panel as a dedicated "Audit Log" tab alongside the existing Restaurants, Coupons, and Plans tabs.
2. WHEN the Super_Admin views the Audit_Log_Viewer in the Admin Panel, THE Audit_Log_Viewer SHALL display Audit_Entries across all restaurants with a `restaurant_name` column.
3. THE Audit_Log_Viewer SHALL allow the Super_Admin to filter by `restaurant_id` to scope the view to a single restaurant.
4. THE Audit_Log_Viewer SHALL highlight Audit_Entries with Severity `critical` using a visually distinct style (e.g., red badge) and Severity `warning` with a distinct style (e.g., amber badge).
5. THE Audit_Log_Viewer SHALL display the most recent 50 Audit_Entries by default when first opened, without requiring the Super_Admin to apply any filters.

---

### Requirement 11: Manager Dashboard Integration

**User Story:** As a manager, I want to access the audit log from my dashboard, so that I can review activity for my restaurant without leaving the management interface.

#### Acceptance Criteria

1. THE Audit_Log_Viewer SHALL be accessible from the Manager Dashboard as a navigation item in the "Account" section.
2. WHEN a Manager opens the Audit_Log_Viewer, THE Audit_Log_Viewer SHALL display only Audit_Entries scoped to their restaurant.
3. THE Audit_Log_Viewer SHALL display the most recent 25 Audit_Entries by default when first opened.
4. THE Audit_Log_Viewer SHALL show a summary banner at the top of the view displaying the count of `critical` and `warning` entries in the last 24 hours.
5. WHEN a Manager clicks on an Audit_Entry row, THE Audit_Log_Viewer SHALL expand the row to show the full `metadata` payload in a readable format.
