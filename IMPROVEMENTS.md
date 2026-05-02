# QR Order — Improvement Suggestions and Current Pitfalls

A candid technical review based on a full audit of the codebase, live database schema, RLS policies, triggers, Postgres functions, views, edge functions, and all UI components. Every item here has been verified against the actual live database and source code.

> **Last updated:** May 2026 — Quick Wins (QW-1 through QW-12) have been implemented. New sections added: Database Security Advisories (from live Supabase linter), Performance Advisories, and Next Quick Wins (QW-13 through QW-20).

---

## What Is Already Well-Built

Before the issues, it is worth noting what is done right:

- Order state machine enforced at DB level (trigger blocks invalid transitions)
- Audit logs are immutable (trigger prevents UPDATE/DELETE)
- Call Waiter button fully implemented on customer page with Realtime broadcast and sound notification on manager dashboard
- Order cancellation available to customers while order is still pending/pending_waiter
- Dark mode works across the entire app including the customer ordering page (next-themes with system default)
- Table availability (free/occupied) shown in real time in TablesManager with summary counts
- Waiter auto-assignment has 3 tiers with race condition safety (SELECT FOR UPDATE)
- Webhook HMAC-SHA256 signatures with SSRF protection on private IP ranges
- Coupon usage uses advisory locks for concurrency safety
- JWT auth decoded locally (no network call) with DB verification
- Comprehensive indexes on all hot query paths
- Rate limiting on order placement (per-table and per-IP)
- Geo-fencing with soft fallback (permission denied shows warning, does not hard-block)
- Realtime reconnection with silent background refresh on tab visibility change
- strict: true enabled in tsconfig.json
- table_availability and waiter_availability views used in lib/api.ts
- ✅ **NEW:** Atomic order creation via `place_order_atomic` Postgres RPC (server-side prices, name snapshot, no orphaned rows)
- ✅ **NEW:** Soft delete for menu items with Archived Items section and Restore functionality
- ✅ **NEW:** Server-side plan limit enforcement in `createTable()` and `createMenuItem()`
- ✅ **NEW:** React error boundaries on all 12 manager dashboard tabs
- ✅ **NEW:** Webhook timestamp replay protection via `verifyWebhookSignature()` utility
- ✅ **NEW:** Sentry error monitoring configured (DSN required — see Operational section)
- ✅ **NEW:** `subscription-reminders` Edge Function deployed and active (ACTIVE status confirmed in Supabase)
- ✅ **NEW:** `subscriptions.reminder_sent_at` JSONB column with deduplication logic
- ✅ **NEW:** `subscriptions.plan` constraint updated to `trialing`/`pro` (no more `free`)
- ✅ **NEW:** `place_order_atomic` is SECURITY INVOKER (correct — does not run as superuser)
- ✅ **NEW:** `get_plan_limits` is SECURITY INVOKER (correct — no privilege escalation)

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [Security Vulnerabilities](#security-vulnerabilities)
3. [Database Security Advisories (Live Linter)](#database-security-advisories-live-linter)
4. [Architecture and Scalability Pitfalls](#architecture-and-scalability-pitfalls)
5. [Database Performance Advisories (Live Linter)](#database-performance-advisories-live-linter)
6. [Data Integrity Gaps](#data-integrity-gaps)
7. [Missing Core Features](#missing-core-features)
8. [Operational Gaps](#operational-gaps)
9. [Code Quality](#code-quality)
10. [UX and Product Gaps](#ux-and-product-gaps)
11. [Quick Wins](#quick-wins)
12. [Summary](#summary)

---

## Critical Issues

### ~~1. Cron jobs are never running~~ ✅ FIXED (QW-1)

~~vercel.json is empty ({}).~~

**Fixed:** `vercel.json` now has a `"crons"` array with two entries:
- `/api/cron/audit-log-purge` — daily at 02:00 UTC
- `/api/cron/webhook-retries` — daily at 02:00 UTC (Hobby plan limit; upgrade to Pro for `*/5 * * * *`)

Additionally, `purge_expired_audit_logs()` is now scheduled via `pg_cron` (job ID 3, `0 2 * * *`, active) — runs entirely inside Postgres with no Vercel plan dependency.

---

### ~~2. Order placement trusts client-provided prices~~ ✅ FIXED (QW-2)

~~items array from the request body includes a price field passed directly as base_price.~~

**Fixed:** `/api/orders/route.ts` now calls `place_order_atomic` RPC which fetches actual prices from `menu_items` server-side. The `item.price` field from the request body is intentionally not passed to the RPC. A malicious `price: 0` payload is ignored.

---

### ~~3. Order placement is not atomic~~ ✅ FIXED (QW-11)

~~Three separate DB calls without a transaction.~~

**Fixed:** The entire order creation is now a single `place_order_atomic` Postgres RPC (SECURITY INVOKER). All steps — status derivation, price fetch, floor multiplier, INSERT orders, INSERT order_items — run in one implicit transaction. Any failure rolls back everything. No orphaned rows possible.

---

### 4. No subscription auto-renewal

PhonePe Standard Checkout is a one-time payment. There is no recurring billing mechanism. When `current_period_end` passes, the restaurant loses access silently.

**Partial mitigation implemented (QW-7):**
- ✅ In-app expiry warning banner shown in manager dashboard when ≤7 days to expiry (dismissible, links to Billing tab)
- ✅ `subscription-reminders` Supabase Edge Function deployed — broadcasts in-app Realtime notifications at 7d/3d/0d milestones with deduplication via `reminder_sent_at` JSONB column
- ✅ 3-day grace period for `past_due` subscriptions before paywall activates
- ✅ Yearly price corrected: Pro `yearly_paise` updated from 79900 (₹799) to 958800 (₹9,588 full annual charge)
- ✅ BillingPanel savings badge formula fixed (~20% shown correctly)
- ✅ Yearly CTA shows full annual amount ("Upgrade — ₹9,588/yr") not misleading "/mo"
- ✅ Trial users see "Trial" not "Free" in Current Plan section

**Still needed:** PhonePe Subscriptions API integration for true recurring billing. Email notifications via Resend/SendGrid for renewal reminders.

---

### 5. No idempotency on order placement

If a customer network drops after the server creates the order but before the response arrives, a retry creates a duplicate order.

**Status: Open.** Accept an optional `idempotencyKey` UUID in the request body. Store it on the order row and return the existing order if the same key is submitted again.

---

## Security Vulnerabilities

### ~~1. Client-provided prices~~ ✅ FIXED (QW-2)

See Critical Issues #2.

---

### 2. Rate limiter is not distributed

`lib/rate-limit.ts` uses an in-memory Map. On Vercel, each serverless function instance has its own memory. Rate limits are not shared across instances.

**Status: Open.** Replace with Upstash Redis + `@upstash/ratelimit`.

---

### 3. JWT decoded without signature verification

`lib/server-auth.ts` decodes the JWT payload without verifying the signature. Security relies entirely on the DB lookup.

**Status: Open.** Verify JWT signature using `SUPABASE_JWT_SECRET`, or use `supabase.auth.getUser(token)` with a short-lived in-memory cache.

---

### 4. Customer phone numbers stored in plain text

`orders.customer_phone` is stored unencrypted. This is PII.

**Status: Open.** Hash phone numbers for lookup (SHA-256 with a pepper), or encrypt at rest.

---

### ~~5. No webhook replay attack protection~~ ✅ FIXED (QW-5)

~~The receiving end never checks that X-Webhook-Timestamp is recent.~~

**Fixed:** `verifyWebhookSignature(secret, body, headers)` utility added to `lib/webhooks.ts`. Rejects requests where `|now - X-Webhook-Timestamp| > 300 seconds`. Returns `{ valid: false, reason: "Timestamp too old or too far in future" }`. Webhook consumers can import and use this function.

---

### ~~6. Plan limits enforced client-side only~~ ✅ FIXED (QW-10)

~~No server-side checks before creating a table or menu item.~~

**Fixed:** `createTable()` and `createMenuItem()` in `lib/api.ts` now call `get_restaurant_plan()` + `get_plan_limits()` RPCs and check `count >= max` before any INSERT. A manager bypassing the UI via direct Supabase client calls is now blocked at the function level.

---

### 7. SSRF protection is IP-based only

`validateWebhookUrl()` blocks private IP ranges by regex but does not protect against DNS rebinding attacks.

**Status: Open.** Resolve the hostname before making the request and check the resolved IP against the blocklist.

---

### 8. `subscription-reminders` Edge Function has no JWT verification

The deployed `subscription-reminders` Edge Function has `verify_jwt: false`. It is callable by anyone who knows the URL without any authentication.

**Status: Open.** Either enable `verify_jwt: true` and call it with a service-role token from a cron trigger, or add a shared secret header check inside the function body. Currently any unauthenticated HTTP POST to the function URL will trigger subscription reminder processing.

---

### 9. `anon` role can call 30+ SECURITY DEFINER functions directly

Supabase security linter (live, verified May 2026) flags 30+ `SECURITY DEFINER` functions as callable by the `anon` role via `/rest/v1/rpc/`. This includes sensitive functions like `bill_table`, `accept_order_atomic`, `assign_order_to_waiter`, `generate_bill`, `get_analytics_summary`, `onboard_restaurant`, `record_coupon_usage`, `search_audit_logs`, and `validate_coupon`.

**Status: Open.** For each function, either:
- Revoke `EXECUTE` from `anon` role: `REVOKE EXECUTE ON FUNCTION public.bill_table FROM anon;`
- Or switch to `SECURITY INVOKER` where the function's own RLS policies are sufficient
- Or move internal-only functions out of the public schema

Priority: `bill_table`, `accept_order_atomic`, `generate_bill`, `onboard_restaurant`, `record_coupon_usage`, `search_audit_logs`.

---

### 10. All Postgres functions missing `SET search_path`

Every public function (43 total) is flagged by the Supabase security linter for mutable `search_path`. Without `SET search_path = public, pg_temp`, a malicious user with schema-creation rights could shadow built-in functions via a rogue schema.

**Status: Open.** Add `SET search_path = public, pg_temp` to every function definition. This is a migration that touches all functions but each change is a one-liner.

---

### 11. 8 views defined with SECURITY DEFINER property

All 8 public views (`avg_turnaround_time`, `daily_sales`, `top_selling_items`, `table_availability`, `waiter_availability`, `menu_item_ratings`, `avg_serving_time`, `avg_preparation_time`) are flagged as `SECURITY DEFINER` views. These enforce the view creator's permissions rather than the querying user's RLS policies, which can expose data to users who should not see it.

**Status: Open.** Recreate views without `SECURITY DEFINER` and ensure the underlying table RLS policies are sufficient. See [Supabase docs](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view).

---

### 12. Leaked password protection disabled in Supabase Auth

HaveIBeenPwned.org integration is disabled. Staff and manager accounts can be created with known-compromised passwords.

**Status: Open.** Enable in Supabase Dashboard → Authentication → Password Security → "Check for leaked passwords".

---

### 13. Two duplicate INSERT policies on `orders` table

`orders` has two overlapping INSERT policies: `"Anyone can create orders"` (WITH CHECK true, roles: anon+authenticated) and `"Public can insert orders"` (WITH CHECK true, roles: all). Both are permissive and redundant. Postgres evaluates both on every INSERT.

**Status: Open.** Drop one of the two policies. Keep `"Anyone can create orders"` and drop `"Public can insert orders"`, or consolidate into a single policy.

---

### 14. `reviews` INSERT policy allows unrestricted inserts

`authenticated_can_create_reviews` has `WITH CHECK (true)` — any authenticated user can insert a review for any menu item at any restaurant.

**Status: Open.** Add `WITH CHECK (EXISTS (SELECT 1 FROM menu_items WHERE id = menu_item_id AND restaurant_id = <user's restaurant>))` or require a valid order history for the reviewer.

---

## Database Security Advisories (Live Linter)

These are confirmed findings from the Supabase security linter run against the live database in May 2026.

### Summary of live security findings

| Severity | Count | Category |
|----------|-------|----------|
| ERROR | 8 | SECURITY_DEFINER views |
| WARN | 30+ | Functions callable by `anon` as SECURITY DEFINER |
| WARN | 30+ | Functions callable by `authenticated` as SECURITY DEFINER |
| WARN | 43 | Functions with mutable `search_path` |
| WARN | 2 | Permissive INSERT policies always true (orders, reviews) |
| WARN | 2 | Public storage buckets allow full listing (menu-images, restaurant-logos) |
| WARN | 1 | Leaked password protection disabled |

**Storage bucket listing:** Both `menu-images` and `restaurant-logos` buckets have broad SELECT policies that allow clients to list all files. This is unnecessary for URL-based image access and may expose internal file structure. Remove the broad SELECT policy from `storage.objects` for these buckets — public URL access does not require it.

---

## Architecture and Scalability Pitfalls

### 1. Analytics RPC recomputes everything on every request

`get_analytics_summary()` runs 8 CTEs on every analytics page load with no caching. Confirmed from live DB: the function is `STABLE SECURITY DEFINER` and scans `orders`, `order_items`, `menu_items`, and `users` tables on every call. For a restaurant with 116+ orders and 141+ order items (current live counts), this is already measurable. At 10,000+ orders it becomes a bottleneck.

**Status: Open.** Cache results with a 5-minute TTL (Redis or a DB cache table). Pre-compute nightly for 30-day ranges. Also note: `get_analytics_summary` is callable by `anon` as SECURITY DEFINER (see Security #9) — fix that first.

---

### 2. No background job queue

Webhook dispatch uses fire-and-forget. If the serverless function terminates before dispatch completes, deliveries are silently dropped.

**Status: Open.** Use Inngest, Trigger.dev, or Upstash QStash for webhook dispatch.

---

### 3. Admin page loads all data on every request

`app/admin/page.tsx` fetches all restaurants, subscriptions, and orders on every load.

**Status: Open.** Add pagination. Cache subscription data. Use ISR.

---

### 4. No read replica or caching layer

Every request hits the primary Supabase Postgres instance.

**Status: Open.** Enable Supabase read replicas. Add CDN cache for menu data.

---

### 5. Realtime channel tokens are static

`CHANNEL_SECRET` is static with no rotation mechanism.

**Status: Open.** Generate per-session channel tokens server-side with a short TTL.

---

## Database Performance Advisories (Live Linter)

These are confirmed findings from the Supabase performance linter run against the live database in May 2026.

### 1. Missing indexes on 5 foreign keys

The following foreign keys have no covering index, causing sequential scans on JOINs and cascading deletes:

| Table | Foreign Key | Impact |
|-------|-------------|--------|
| `order_items` | `order_items_menu_item_id_fkey` | Every analytics query joining order_items → menu_items does a seq scan |
| `order_status_logs` | `order_status_logs_changed_by_fkey` | Audit log queries by actor are slow |
| `orders` | `orders_table_id_fkey` | `table_availability` view and `bill_table()` scan all orders per table |
| `restaurants` | `restaurants_owner_id_fkey` | Auth lookup for owner is unindexed |
| `subscriptions` | `subscriptions_pending_coupon_id_fkey` | Coupon join is unindexed |

**Fix (QW-13):** Single migration:
```sql
CREATE INDEX CONCURRENTLY idx_order_items_menu_item_id ON order_items(menu_item_id);
CREATE INDEX CONCURRENTLY idx_order_status_logs_changed_by ON order_status_logs(changed_by);
CREATE INDEX CONCURRENTLY idx_orders_table_id ON orders(table_id);
CREATE INDEX CONCURRENTLY idx_restaurants_owner_id ON restaurants(owner_id);
CREATE INDEX CONCURRENTLY idx_subscriptions_pending_coupon_id ON subscriptions(pending_coupon_id);
```

---

### 2. RLS policies re-evaluate `auth.*` functions per row (25 policies)

25 RLS policies across 14 tables call `auth.uid()` or `current_setting()` directly in the `USING` clause. Postgres re-evaluates these for every row scanned, which is O(n) auth calls per query. Affected tables: `tables`, `menu_items`, `orders`, `order_items`, `order_status_logs`, `users`, `floors`, `subscriptions`, `restaurants`, `table_sessions`, `coupons`, `coupon_usages`, `webhook_endpoints`, `webhook_deliveries`, `food_categories`, `food_tags`, `menu_item_categories`, `menu_item_tags`, `plans`, `payment_transactions`, `audit_logs`.

**Fix (QW-14):** Replace `auth.uid()` with `(SELECT auth.uid())` in all affected policies. The subquery form is evaluated once per query, not once per row. This is a significant performance improvement at scale.

Example:
```sql
-- Before (slow):
USING (restaurant_id = get_user_restaurant_id())
-- After (fast):
USING (restaurant_id = (SELECT get_user_restaurant_id()))
```

---

### 3. Duplicate indexes on `order_items` and `orders`

- `order_items`: `idx_order_items_order_id` and `order_items_order_id_idx` are identical
- `orders`: `idx_orders_status_restaurant` and `orders_status_restaurant_id_idx` are identical

Each duplicate wastes storage and slows down writes (every INSERT/UPDATE maintains both indexes).

**Fix:** Drop one from each pair:
```sql
DROP INDEX CONCURRENTLY idx_order_items_order_id;
DROP INDEX CONCURRENTLY orders_status_restaurant_id_idx;
```

---

### 4. Multiple permissive RLS policies on same table/role/action

14 tables have multiple permissive policies for the same role and action. Postgres evaluates all permissive policies and ORs the results — every extra policy adds overhead. Worst offenders:

- `menu_items`: 4 SELECT policies for `authenticated` role
- `orders`: 2 INSERT + 2 SELECT + 2 UPDATE policies for `authenticated`
- `coupons`, `food_categories`, `food_tags`, `menu_item_categories`, `menu_item_tags`, `plans`, `restaurants`, `tables`, `users`: 2+ SELECT policies

**Fix:** Consolidate overlapping policies into single policies with combined conditions. For example, merge `"Anyone can read available menu items"` and `"Public can read available menu items"` into one.

---

### 5. Unused indexes (10 confirmed)

The following indexes have never been used and are candidates for removal:

| Index | Table |
|-------|-------|
| `idx_subscriptions_stripe_customer` | `subscriptions` |
| `idx_webhook_deliveries_event_id` | `webhook_deliveries` |
| `idx_users_email` | `users` |
| `idx_reviews_created` | `reviews` |
| `idx_users_active` | `users` |
| `orders_status_restaurant_id_idx` | `orders` (also a duplicate) |
| `idx_coupons_active` | `coupons` |
| `idx_mic_category` | `menu_item_categories` |
| `idx_mit_tag` | `menu_item_tags` |
| `idx_audit_logs_resource` | `audit_logs` |
| `menu_items_active_idx` | `menu_items` |

Note: `menu_items_active_idx` was added by QW-4 but has not been used yet — likely because the query planner prefers the existing restaurant_id index. Monitor before dropping.

---

## Data Integrity Gaps

### ~~1. Menu item name not snapshotted in order_items~~ ✅ FIXED (QW-4)

~~order_items stores menu_item_id but not the item name.~~

**Fixed:** `name TEXT` column added to `order_items` (nullable for backward compat). `place_order_atomic` RPC snapshots `menu_items.name` at insert time. Historical orders now show the original name even after renames. The `top_selling_items` view updated to use `COALESCE(oi.name, mi.name)` — prefers snapshot, falls back to current name for pre-fix orders.

---

### ~~2. No soft deletes~~ ✅ FIXED (QW-4)

~~Menu items are hard-deleted. Deleting an item with order history is blocked by FK constraint.~~

**Fixed:**
- `deleted_at TIMESTAMPTZ DEFAULT NULL` added to `menu_items`
- `deleteMenuItem()` now performs a soft delete (`UPDATE SET deleted_at = now()`) instead of hard DELETE
- `getMenuItems()` and `getAllMenuItems()` filter `WHERE deleted_at IS NULL`
- Two public SELECT RLS policies updated: `USING (is_available = true AND deleted_at IS NULL)`
- Partial index `menu_items_active_idx` created on `(restaurant_id, is_available) WHERE deleted_at IS NULL`
- MenuManager now has a collapsible "Archived Items" section with per-row Restore buttons
- Webhook event renamed from `menu.item_deleted` to `menu.item_archived`

**Note:** Soft deletes for `users` and `floors` are still open.

---

### ~~3. No order item quantity validation server-side~~ ✅ FIXED (QW-6)

~~The order placement API accepts any quantity value from the client.~~

**Fixed:** `/api/orders/route.ts` validates each item before calling `place_order_atomic`. Returns HTTP 400 with a descriptive message if any item has `quantity` that is not an integer, is < 1, or is > 99. No rows are inserted on validation failure.

---

### 4. Billing address stored in localStorage only

The billing address in BillingPanel.tsx is stored in localStorage. Lost on browser clear or device switch.

**Status: Open.** Store in `restaurants` table or a `billing_profiles` table.

---

### 5. No price history

No record of menu item price changes over time.

**Status: Open.** Add `menu_item_price_history` table or a Postgres audit trigger on `menu_items.price`.

---

### ~~6. Webhook retry does not check if endpoint is still active~~ ✅ FIXED (QW-9)

~~A disabled endpoint could still receive retried deliveries.~~

**Fixed:** `retryDelivery()` in `lib/webhooks.ts` now checks `ep.is_active` before calling `dispatchToUrl()`. If `is_active === false`: delivery is marked `dead` with `error_message: "Endpoint is inactive"` and the function returns early. No HTTP request is dispatched.

---

## Missing Core Features

### 1. Item modifiers and customizations

Customers cannot customize orders (no onions, extra cheese, spice level).

**Status: Open.** Add `order_item_modifiers` table and `modifiers JSONB` field to `menu_items`.

---

### 2. Email notifications

No email notifications anywhere in the system.

**Partial mitigation:** In-app subscription expiry reminders via Realtime broadcast (QW-7). Full email integration still open.

**Status: Open.** Integrate Resend or SendGrid. Priority: billing receipts and subscription expiry warnings.

---

### 3. No recurring billing

See Critical Issues #4.

---

### 4. No tax / GST support

No tax calculation, no GST number field, no tax line on receipts. Confirmed: `bill_table()` function applies discount proration but has no tax calculation step. The `total_amount` stored on orders is pre-tax.

**Status: Open.** Add `tax_rate` to restaurants. Calculate tax in `bill_table()`. Add GST number field.

---

### 5. No item availability scheduling

No way to schedule items by time of day.

**Status: Open.** Add `available_from TIME` and `available_until TIME` to `menu_items`.

---

### 6. No split billing

**Status: Open.**

---

### 7. Reviews UI exists in DB but not in the product

`reviews` table (0 rows, confirmed live), `menu_item_ratings` view, and RLS policies exist. No customer or manager UI. The `authenticated_can_create_reviews` INSERT policy has `WITH CHECK (true)` — any authenticated user can insert a review for any menu item at any restaurant (see Security #14).

**Status: Open.** Add post-order review prompt. Add reviews section to analytics dashboard. Fix the INSERT policy before launching.

---

### 8. No printer / KDS integration

**Status: Open.** Webhook system already supports `order.placed` events. Document KDS integration via webhooks.

---

### 9. No customer accounts

Customer identity based solely on phone number in sessionStorage.

**Status: Open.** Add optional customer account creation with phone OTP.

---

### 10. No multi-location support

One owner with multiple branches must create separate accounts.

**Status: Open.** Add `organizations` table.

---

### 11. No estimated wait time for customers

`avg_preparation_time` and `avg_turnaround_time` views exist but are not surfaced to customers.

**Status: Open.** Show estimated wait time on order status tracker.

---

### 12. No order modification after placement

Customers can cancel but cannot add items or change quantities.

**Status: Open.** Allow modification while status is `pending` or `pending_waiter`.

---

## Operational Gaps

### ~~1. No error monitoring~~ ✅ FIXED (QW-12)

~~No Sentry or equivalent error tracking.~~

**Fixed:** `@sentry/nextjs@10` installed and configured. `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` created. `next.config.ts` wrapped with `withSentryConfig`. Only activates in production (`NODE_ENV === "production"`).

**Action required:** Add your DSN to `NEXT_PUBLIC_SENTRY_DSN` in `.env.local` and in Vercel environment variables. Get a DSN at [sentry.io](https://sentry.io) → New Project → Next.js.

---

### ~~2. No health check endpoint~~ ✅ FIXED (QW-3)

~~No /api/health endpoint.~~

**Fixed:** `GET /api/health` returns `{ status: "ok", db: "ok", timestamp }` with HTTP 200 when Supabase is reachable, or `{ status: "error", db: "error", timestamp }` with HTTP 503 when unreachable. Uses `force-dynamic` to prevent caching.

---

### 3. No staging environment

Changes go directly from development to production.

**Status: Open.** Create a Supabase staging project. Add Vercel preview environment with staging env vars.

---

### 4. No database migration versioning

Multiple overlapping SQL files with unclear application order.

**Partial mitigation:** New migrations from the quick-wins spec are in `supabase/migrations/` with timestamped filenames. Legacy files still exist.

**Status: Open.** Migrate all legacy SQL files to versioned Supabase CLI migrations.

---

### 5. No CI/CD pipeline

No automated tests run before deployment.

**Status: Open.** Add GitHub Actions workflow: `npm test` + `npm run build` on every PR.

---

### 6. No database backup strategy documented

**Status: Open.** Enable PITR on Supabase. Document restore procedures.

---

### 7. No observability / APM

No distributed tracing, no request latency tracking, no slow query monitoring.

**Status: Open.** Add Vercel Analytics. Enable Supabase query performance insights.

---

## Code Quality

### 1. Large components need splitting

`Analytics.tsx` (782 lines), `BillingPanel.tsx` are large monoliths.

**Status: Open.** Extract chart components and data fetching hooks.

---

### ~~2. No React error boundaries~~ ✅ FIXED (QW-8)

~~A rendering error in the kitchen dashboard will crash the entire page.~~

**Fixed:** `components/ErrorBoundary.tsx` created as a React class component with `getDerivedStateFromError`, `componentDidCatch`, and a "Try again" reset button. All 12 manager dashboard tabs in `ManagerClient.tsx` are individually wrapped in `<ErrorBoundary label="...">`. A crash in one section (e.g. Analytics) shows a section-level fallback; all other tabs remain functional.

---

### 3. Minimal test coverage

No tests for API route handlers, database functions, coupon validation, or rate limiter.

**Partial mitigation:** Property-based tests added for all quick-wins bug conditions and preservation properties (54 tests total in `__tests__/`).

**Status: Open.** Add unit tests for all `lib/` utilities. Add integration tests for critical API routes. Aim for 80% coverage on business-critical paths.

---

### 4. Remaining `as any` casts despite strict mode

Several places use `as any` to work around missing Supabase Realtime TypeScript types.

**Status: Open.** Create typed wrappers for `postgres_changes` events.

---

### 5. No input sanitization beyond basic checks

Customer-provided strings are trimmed but not sanitized for XSS.

**Status: Open.** Use DOMPurify for any HTML rendering of user-provided content.

---

## UX and Product Gaps

### 1. No visual floor plan view

TablesManager shows table status as cards. No spatial floor plan view.

**Status: Open.**

---

### 2. No offline support / PWA

Cart lost on connectivity drop. Staff dashboards go blank.

**Status: Open.** Add service worker for customer ordering page.

---

### 3. No multi-language support

UI is English only.

**Status: Open.** Add i18n with `next-intl`. Start with Hindi.

---

### 4. No allergen or dietary information

Tags exist (veg, non_veg, spicy) but no structured allergen data.

**Status: Open.** Add `allergens JSONB` to `menu_items`.

---

### 5. Billing address lost on browser clear

See Data Integrity Gaps #4.

---

### ~~6. No subscription renewal reminder in the UI~~ ✅ FIXED (QW-7)

~~No in-app banner when subscription is about to expire.~~

**Fixed:** Two-layer reminder system:
1. **ManagerClient.tsx** — amber dismissible banner above all tab content when Pro subscription expires within 7 days. Links directly to Billing tab.
2. **BillingPanel.tsx** — additional expiry warning banner within the Billing section itself.
3. **subscription-reminders Edge Function** — deployed to Supabase, broadcasts Realtime notifications at 7d/3d/0d milestones with deduplication. Schedule daily at 09:00 IST via Supabase dashboard.

---

## Quick Wins

| # | Fix | Effort | Impact | Status |
|---|-----|--------|--------|--------|
| 1 | Add cron jobs to vercel.json | 5 min | Critical - webhooks and audit purge start working | ✅ Done |
| 2 | Fetch menu item prices server-side in /api/orders | 2 hours | Critical - prevents free orders | ✅ Done |
| 3 | Add GET /api/health endpoint | 30 min | Enables uptime monitoring | ✅ Done |
| 4 | Add Sentry error tracking | 1 hour | Immediate visibility into production errors | ✅ Done (add DSN) |
| 5 | Add name column to order_items | 1 hour | Preserves item names in historical orders | ✅ Done |
| 6 | Add webhook timestamp replay protection | 1 hour | Closes a security gap | ✅ Done |
| 7 | Add quantity validation in /api/orders | 30 min | Prevents absurd order quantities | ✅ Done |
| 8 | Add subscription expiry warning banner in manager dashboard | 2 hours | Reduces churn from silent expiry | ✅ Done |
| 9 | Wrap dashboard sections in error boundaries | 2 hours | Prevents full-page crashes | ✅ Done |
| 10 | Add is_active check before retrying webhook deliveries | 30 min | Stops retrying to disabled endpoints | ✅ Done |
| 11 | Add server-side plan limit check in table/menu creation | 3 hours | Closes client-side bypass | ✅ Done |
| 12 | Wrap order creation in an atomic Postgres RPC | 4 hours | Eliminates orphaned orders | ✅ Done |
| 13 | Add missing FK indexes (5 tables) | 30 min | Fixes seq scans on order_items, orders, restaurants | 🔴 Open |
| 14 | Fix RLS auth.uid() per-row re-evaluation (25 policies) | 2 hours | Major query performance improvement at scale | 🔴 Open |
| 15 | Drop duplicate indexes on order_items and orders | 15 min | Reduces write overhead, saves storage | 🔴 Open |
| 16 | Revoke anon EXECUTE on sensitive SECURITY DEFINER functions | 2 hours | Closes direct RPC access for unauthenticated callers | 🔴 Open |
| 17 | Add SET search_path to all 43 Postgres functions | 3 hours | Closes search_path injection vector | 🔴 Open |
| 18 | Enable JWT verification on subscription-reminders Edge Function | 15 min | Prevents unauthenticated trigger of reminder processing | 🔴 Open |
| 19 | Enable leaked password protection in Supabase Auth | 5 min | Blocks known-compromised passwords for staff accounts | 🔴 Open |
| 20 | Consolidate duplicate RLS policies on menu_items and orders | 2 hours | Reduces per-query policy evaluation overhead | 🔴 Open |

**QW-1 through QW-12 are complete. QW-13 through QW-20 are the next recommended batch.**

---

## Summary

| Category | Issues Found | Critical | Open | Fixed |
|----------|-------------|---------|------|-------|
| Critical Issues | 5 | 5 | 2 | 3 |
| Security | 14 | 3 | 11 | 3 |
| DB Security Advisories (live) | 7 groups | 1 | 7 | 0 |
| Architecture | 5 | 0 | 5 | 0 |
| DB Performance Advisories (live) | 5 groups | 0 | 5 | 0 |
| Data Integrity | 6 | 0 | 3 | 3 |
| Missing Features | 12 | 1 | 12 | 0 |
| Operational | 7 | 1 | 5 | 2 |
| Code Quality | 5 | 0 | 3 | 2 |
| UX/Product | 6 | 0 | 5 | 1 |
| **Total** | **72** | **10** | **58** | **14** |

**14 issues resolved by the quick-wins implementation.** The most urgent remaining items are:

1. **QW-13** — Add 5 missing FK indexes (30 min, high performance impact)
2. **QW-14** — Fix RLS `auth.uid()` per-row re-evaluation (2 hours, major scale improvement)
3. **QW-15** — Drop duplicate indexes (15 min, free write performance)
4. **QW-16** — Revoke `anon` EXECUTE on sensitive SECURITY DEFINER functions (2 hours, security)
5. **QW-18** — Enable JWT verification on `subscription-reminders` Edge Function (15 min, security)
6. **QW-19** — Enable leaked password protection in Supabase Auth (5 min, security)
7. Order placement idempotency (prevents duplicate orders on network retry)
8. Distributed rate limiting via Upstash Redis (replaces in-memory Map)
9. JWT signature verification in `lib/server-auth.ts`
10. Email notifications for billing events via Resend/SendGrid
