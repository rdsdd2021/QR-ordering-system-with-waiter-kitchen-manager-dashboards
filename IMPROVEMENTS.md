# QR Order - Improvement Suggestions and Current Pitfalls

A candid technical review based on a full audit of the codebase, live database schema, RLS policies, triggers, and all UI components. Every item here has been verified against the actual code.

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

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [Security Vulnerabilities](#security-vulnerabilities)
3. [Architecture and Scalability Pitfalls](#architecture-and-scalability-pitfalls)
4. [Data Integrity Gaps](#data-integrity-gaps)
5. [Missing Core Features](#missing-core-features)
6. [Operational Gaps](#operational-gaps)
7. [Code Quality](#code-quality)
8. [UX and Product Gaps](#ux-and-product-gaps)
9. [Quick Wins](#quick-wins)
10. [Summary](#summary)

---

## Critical Issues

These are broken or will cause real problems in production right now.

### 1. Cron jobs are never running

vercel.json is empty ({}). The two cron jobs documented in the README are never scheduled on Vercel. This means:

- Failed webhook deliveries stuck in retrying status are never retried automatically
- Audit logs are never purged and will grow indefinitely (currently 171 rows, will grow forever)
- CRON_SECRET is set but never used

Fix: Add to vercel.json:
`json
{
  "crons": [
    { "path": "/api/cron/audit-log-purge", "schedule": "0 2 * * *" },
    { "path": "/api/cron/webhook-retries", "schedule": "* * * * *" }
  ]
}
`

### 2. Order placement trusts client-provided prices

In app/api/orders/route.ts, the items array from the request body includes a price field passed directly as base_price to calculate_item_prices_batch(). The RPC does (v_item->>base_price)::NUMERIC * v_multiplier - it never fetches from menu_items. A malicious customer can send price: 0 for every item and place an order for free.

Fix: Before calling the RPC, fetch actual prices from menu_items WHERE id = ANY(item_ids) AND restaurant_id = restaurantId. Never trust client-provided prices.

### 3. Order placement is not atomic

The order creation in /api/orders makes three separate DB calls without a transaction:
1. INSERT into orders
2. RPC calculate_item_prices_batch
3. INSERT into order_items

If step 3 fails (e.g. a menu item was deleted between steps 1 and 3), an orphaned orders row exists with no items. This order is visible to kitchen/waiter with nothing to prepare, and the customer gets an error but the order was created.

Fix: Wrap the entire order creation in a Postgres function (RPC) that runs atomically. This also eliminates the round-trip overhead of 3 separate DB calls.

### 4. No subscription auto-renewal

PhonePe Standard Checkout is a one-time payment. There is no recurring billing mechanism. When current_period_end passes, the restaurant loses access silently - no automatic renewal, no reminder email, no grace period beyond the past_due status.

Fix: Either integrate PhonePe Subscriptions API for recurring billing, or implement renewal reminders (7 days before, 3 days before, on expiry day) and a grace period (e.g. 3 days past_due before downgrading to free).

### 5. No idempotency on order placement

If a customer network drops after the server creates the order but before the response arrives, a retry creates a duplicate order. There is no idempotency key mechanism anywhere in the codebase.

Fix: Accept an optional idempotencyKey in the request body (UUID generated client-side). Store it on the order row and return the existing order if the same key is submitted again.

---

## Security Vulnerabilities

### 1. Client-provided prices (see Critical Issues #2)

### 2. Rate limiter is not distributed

lib/rate-limit.ts uses an in-memory Map. On Vercel, each serverless function instance has its own memory. With multiple concurrent instances (which Vercel scales to automatically under load), rate limits are not shared across instances. A determined attacker can bypass the 10 orders/minute limit by hitting different instances.

Fix: Replace with a distributed rate limiter backed by Redis (e.g. Upstash Redis with @upstash/ratelimit). This is a one-day change.

### 3. JWT decoded without signature verification

lib/server-auth.ts explicitly decodes the JWT payload without verifying the signature. The security relies entirely on the DB lookup. A forged token with a valid sub UUID would authenticate as that user if that UUID exists in the users table.

The code comment acknowledges this: "A forged token with a non-existent sub will simply return null from the DB" - but it does not address the case where the attacker knows a valid UUID.

Fix: Verify the JWT signature locally using the Supabase JWT secret (SUPABASE_JWT_SECRET), or use supabase.auth.getUser(token) with a short-lived in-memory cache keyed on token hash to avoid the network call overhead.

### 4. Customer phone numbers stored in plain text

orders.customer_phone is stored unencrypted. This is PII. If the database is compromised, all customer phone numbers are exposed. There are also two indexes on customer_phone which makes it trivially searchable.

Fix: Hash phone numbers for lookup (SHA-256 with a pepper), or encrypt them at rest. At minimum, document this as a known data handling decision and add it to the privacy policy.

### 5. No webhook replay attack protection

The webhook signature includes a timestamp (X-Webhook-Timestamp), but the receiving end never checks that the timestamp is recent. An attacker who intercepts a valid webhook payload could replay it hours later.

Fix: In the signature verification step on the consumer side, reject requests where X-Webhook-Timestamp is more than 5 minutes old.

### 6. Plan limits enforced client-side only

Plan limits (max tables, max menu items, analytics access) are enforced only client-side via useSubscription(). There are no server-side checks in any API route before creating a table or menu item. A manager can bypass these by making direct API calls to Supabase.

Fix: Add server-side plan limit checks in the relevant API routes, or enforce via Postgres RLS policies that check the restaurant subscription status.

### 7. SSRF protection is IP-based only

validateWebhookUrl() blocks private IP ranges by regex, but does not protect against DNS rebinding attacks where a public hostname resolves to a private IP at request time.

Fix: Resolve the hostname before making the request and check the resolved IP against the blocklist. Or use a dedicated egress proxy that enforces network-level restrictions.

---

## Architecture and Scalability Pitfalls

### 1. Analytics RPC recomputes everything on every request

get_analytics_summary() runs 8 CTEs on every analytics page load. The DB already has views (daily_sales, top_selling_items, avg_preparation_time, avg_serving_time, avg_turnaround_time, menu_item_ratings, waiter_availability, table_availability) but the analytics RPC does not use them - it recomputes everything inline. With large datasets this will be slow, and there is no caching.

Fix: Cache analytics results with a 5-minute TTL (Redis or a DB cache table). Invalidate on new billed orders. For the 30-day range, pre-compute nightly. Consider using the existing views as building blocks.

### 2. No background job queue

Webhook dispatch uses fire-and-forget (dispatchAll.catch(...)). If the serverless function terminates before dispatch completes (Vercel has a 10-second default timeout on hobby plans), deliveries are silently dropped. The delivery record is created first so the cron retry would pick it up - but only if cron is configured (see Critical Issue #1).

Fix: Use a proper job queue (Inngest, Trigger.dev, or Upstash QStash) for webhook dispatch.

### 3. Admin page loads all data on every request

app/admin/page.tsx fetches all restaurants, all subscriptions, and all orders on every page load with force-dynamic. With 100+ restaurants this will be slow and expensive.

Fix: Add pagination to the restaurants query. Cache subscription data. Use ISR with a short revalidation period.

### 4. No read replica or caching layer

Every request hits the primary Supabase Postgres instance. High-traffic customer ordering pages (menu fetch, order status) could cause read contention.

Fix: Enable Supabase read replicas for read-heavy queries. Add a CDN cache for menu data (menus change infrequently).

### 5. Realtime channel tokens are static

CHANNEL_SECRET is static. If it leaks, all channel names become guessable permanently. There is no mechanism to rotate it without redeploying.

Fix: Generate per-session channel tokens server-side with a short TTL (e.g. 1 hour), passed as props to client components. Rotate CHANNEL_SECRET periodically.

---

## Data Integrity Gaps

### 1. Menu item name not snapshotted in order_items

order_items stores menu_item_id and price (snapshotted at order time), but not the item name. If a menu item is renamed or deleted, historical orders lose their item names in the UI. The top_selling_items view joins back to menu_items.name, which will break if items are deleted.

Fix: Add a name column to order_items and populate it at order creation time.

### 2. No soft deletes

Menu items, staff, and floors are hard-deleted. Deleting a menu item that appears in historical orders is currently blocked by ON DELETE RESTRICT on order_items.menu_item_id - meaning you cannot delete any menu item that has ever been ordered. This is a usability problem.

Fix: Add deleted_at TIMESTAMPTZ to menu_items, users, and floors. Filter WHERE deleted_at IS NULL in queries.

### 3. No order item quantity validation server-side

The order placement API accepts any quantity value from the client. There is no server-side check that quantity is a reasonable number.

Fix: Add server-side validation: quantity must be an integer between 1 and 99.

### 4. Billing address stored in localStorage only

The billing address in BillingPanel.tsx is stored in localStorage keyed by restaurantId. It is lost if the user clears browser data, switches browsers, or logs in from a different device.

Fix: Store billing address in the restaurants table or a separate billing_profiles table.

### 5. No price history

When a menu item price changes, there is no record of what the price was before. This makes it impossible to audit pricing changes or understand why historical orders have different prices.

Fix: Add a menu_item_price_history table, or use a Postgres audit trigger on menu_items.price.

### 6. Webhook retry does not check if endpoint is still active

In retryDelivery() in lib/webhooks.ts, the endpoint is fetched but its is_active status is not checked before dispatching. A disabled endpoint could still receive retried deliveries from the cron job.

Fix: Add a check in retryDelivery(): if endpoint.is_active === false, mark the delivery as dead and return early.

---

## Missing Core Features

### 1. Item modifiers and customizations

Customers cannot customize orders (e.g. no onions, extra cheese, spice level). This is a fundamental feature for most restaurants and a common reason customers abandon QR ordering.

Fix: Add an order_item_modifiers table. Add a modifiers JSONB field to menu_items defining available options and their prices. Display modifier selection in the cart drawer.

### 2. Email notifications

There are no email notifications anywhere in the system:
- No order confirmation to customer
- No billing receipt after payment
- No subscription expiry warning (restaurants silently lose access)
- No new staff account welcome email
- No critical alert email to manager

Fix: Integrate Resend or SendGrid. Start with billing receipts and subscription expiry warnings (highest business impact).

### 3. No recurring billing

See Critical Issues #4. Restaurants must manually re-subscribe when their plan expires.

### 4. No tax / GST support

There is no tax calculation, no GST number field, and no tax line on receipts. This is a legal requirement for Indian businesses issuing invoices.

Fix: Add tax_rate to restaurants (or floors). Calculate tax in bill_table(). Add tax breakdown to receipts. Add GST number field to restaurant profile.

### 5. No item availability scheduling

Menu items are either available or not. There is no way to schedule items (e.g. breakfast items only 7am-11am, lunch specials 12pm-3pm).

Fix: Add available_from TIME and available_until TIME to menu_items. Filter in the customer ordering page based on current time.

### 6. No split billing

A table cannot split the bill between multiple customers. The entire table is billed as one.

Fix: Add a split bill flow in BillDialog that allows assigning orders to sub-bills.

### 7. Reviews UI exists in DB but not in the product

The reviews table exists with rating (1-5) and comment fields, RLS policies are set up, and the menu_item_ratings view is built. But there is no UI for customers to leave reviews or for managers to view them.

Fix: Add a post-order review prompt on the customer page. Add a reviews section to the manager analytics dashboard.

### 8. No printer / KDS integration

There is no integration with kitchen display systems (KDS) or receipt printers. Kitchen staff must use the web dashboard.

Fix: The webhook system already supports order.placed events with full order details. Document how to connect a KDS via webhooks. For receipt printing, add a print-optimized bill view.

### 9. No customer accounts

Customer identity is based solely on phone number stored in sessionStorage. There are no persistent customer accounts, no loyalty points, no saved preferences.

Fix: Add optional customer account creation (phone OTP verification). Store order history server-side linked to the account.

### 10. No multi-location support

A restaurant owner with multiple branches must create separate accounts for each. There is no concept of a restaurant group or parent organization.

Fix: Add an organizations table. Allow one owner to manage multiple restaurants under one login.

### 11. No estimated wait time for customers

Customers have no idea how long their order will take. The avg_preparation_time and avg_turnaround_time views exist in the DB but are not surfaced to customers.

Fix: Show estimated wait time on the order status tracker based on the restaurant average prep time.

### 12. No order modification after placement

Customers can cancel pending orders (this is implemented), but cannot add items or change quantities. They must place a new order, which creates a separate order row and complicates billing.

Fix: Allow order modification while status is pending or pending_waiter. Add an Edit Order button on the customer page.

---

## Operational Gaps

### 1. No error monitoring

There is no Sentry, Datadog, or equivalent error tracking. Errors are only visible in Vercel function logs, which are not searchable or alertable. Production bugs can go unnoticed for days.

Fix: Add Sentry with @sentry/nextjs. Capture unhandled exceptions in API routes and client components. Set up alerts for error rate spikes.

### 2. No health check endpoint

There is no /api/health endpoint. Uptime monitors cannot verify the service is running.

Fix: Add GET /api/health that checks Supabase connectivity and returns { status: ok, db: ok, timestamp: ... }.

### 3. No staging environment

There is no documented staging environment. Changes go directly from development to production.

Fix: Create a Supabase staging project. Add a Vercel preview environment with staging env vars. Use Vercel branch deployments for PRs.

### 4. No database migration versioning

The supabase/ directory has multiple overlapping SQL files (COMPLETE_MIGRATION.sql, MASTER_MIGRATION.sql, migration_advanced_features.sql). It is unclear which files to run, in what order, and what the current schema version is.

Fix: Use Supabase CLI with versioned migrations (supabase/migrations/YYYYMMDDHHMMSS_description.sql). Track applied migrations in the supabase_migrations table.

### 5. No CI/CD pipeline

There is no documented CI/CD pipeline. No automated tests run before deployment.

Fix: Add a GitHub Actions workflow that runs npm test and npm run build on every PR. Block merges if tests fail.

### 6. No database backup strategy documented

There is no documented backup strategy beyond Supabase default daily backups (which require a paid plan).

Fix: Document the backup strategy. Enable Point-in-Time Recovery (PITR) on the Supabase project. Test restore procedures quarterly.

### 7. No observability / APM

There is no distributed tracing, no request latency tracking, no slow query monitoring.

Fix: Add Vercel Analytics for frontend performance. Enable Supabase query performance insights. Add structured logging to API routes.

---

## Code Quality

### 1. Large components need splitting

Analytics.tsx is 782 lines and contains chart components, data fetching, and business logic all in one file. BillingPanel.tsx is similarly large.

Fix: Extract chart components (RevenueChart, HourlyChart, DonutChart) into components/charts/. Extract data fetching into custom hooks (useAnalytics, useBilling).

### 2. No React error boundaries

There are no error boundaries in the component tree. A rendering error in the kitchen dashboard will crash the entire page, taking down the kitchen display.

Fix: Wrap each major dashboard section in an ErrorBoundary component that shows a refresh fallback.

### 3. Minimal test coverage

The lib/__tests__/ directory exists but test coverage is minimal. There are no tests for:
- API route handlers
- Database functions (order status transitions, billing)
- The coupon validation logic
- The rate limiter

Fix: Add unit tests for all lib/ utilities. Add integration tests for critical API routes. Aim for 80% coverage on business-critical paths.

### 4. Remaining as any casts despite strict mode

strict: true is already enabled in tsconfig.json. However, several places still use as any casts (e.g. in useKitchenOrders.ts and useWaiterOrders.ts for postgres_changes event types) to work around missing Supabase Realtime TypeScript types.

Fix: Replace as any casts with proper type definitions. Create a typed wrapper for postgres_changes events.

### 5. No input sanitization beyond basic checks

Customer-provided strings (customer_name, customer_phone, restaurantName) are trimmed but not sanitized for XSS. While Supabase parameterizes queries, the data is displayed in the manager dashboard.

Fix: Sanitize all user-provided strings before storing. Use a library like DOMPurify for any HTML rendering.

---

## UX and Product Gaps

### 1. No visual floor plan view

TablesManager shows table status (free/occupied) as cards with badges and summary counts. However, there is no spatial floor plan view showing table layout. For restaurants with many tables across multiple floors, navigating the card grid is slow.

Fix: Add an optional floor plan canvas view where managers can drag tables to positions and see occupancy at a glance.

### 2. No offline support / PWA

If a customer loses connectivity mid-order, the cart is lost. Kitchen and waiter dashboards go blank with no indication of why.

Fix: Add a service worker for the customer ordering page to cache the menu and allow offline cart management. Add a You are offline banner to staff dashboards with a reconnect button.

### 3. No multi-language support

The entire UI is in English. For Indian restaurants, Hindi and regional language support would significantly expand the addressable market.

Fix: Add i18n support using next-intl. Start with Hindi and the top 3 regional languages by restaurant location.

### 4. No allergen or dietary information

Menu items have tags (veg, non_veg, spicy) but no structured allergen information. This is increasingly important for customer safety and legal compliance.

Fix: Add an allergens JSONB field to menu_items. Display allergen badges on the customer ordering page.

### 5. Billing address lost on browser clear

The billing address is stored in localStorage only. See Data Integrity Gaps #4.

### 6. No subscription renewal reminder in the UI

When a subscription is about to expire, there is no in-app banner or notification. Managers only discover the expiry when they lose access.

Fix: Show a banner in the manager dashboard when current_period_end is within 7 days. Link directly to the billing tab.

---

## Quick Wins

Low-effort, high-impact improvements that can be done in a day or less:

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | Add cron jobs to vercel.json | 5 min | Critical - webhooks and audit purge start working |
| 2 | Fetch menu item prices server-side in /api/orders | 2 hours | Critical - prevents free orders |
| 3 | Add GET /api/health endpoint | 30 min | Enables uptime monitoring |
| 4 | Add Sentry error tracking | 1 hour | Immediate visibility into production errors |
| 5 | Add name column to order_items | 1 hour | Preserves item names in historical orders |
| 6 | Add webhook timestamp replay protection | 1 hour | Closes a security gap |
| 7 | Add quantity validation in /api/orders | 30 min | Prevents absurd order quantities |
| 8 | Add subscription expiry warning banner in manager dashboard | 2 hours | Reduces churn from silent expiry |
| 9 | Wrap dashboard sections in error boundaries | 2 hours | Prevents full-page crashes |
| 10 | Add is_active check before retrying webhook deliveries | 30 min | Stops retrying to disabled endpoints |
| 11 | Add server-side plan limit check in table/menu creation | 3 hours | Closes client-side bypass |
| 12 | Wrap order creation in an atomic Postgres RPC | 4 hours | Eliminates orphaned orders |

---

## Summary

| Category | Issues Found | Critical |
|----------|-------------|---------|
| Critical Issues | 5 | 5 |
| Security | 7 | 2 |
| Architecture | 5 | 0 |
| Data Integrity | 6 | 0 |
| Missing Features | 12 | 1 |
| Operational | 7 | 1 |
| Code Quality | 5 | 0 |
| UX/Product | 6 | 0 |
| **Total** | **53** | **9** |

The most urgent items are: fixing vercel.json (cron jobs), server-side price validation, atomic order placement, and subscription renewal. Everything else is important but not immediately breaking.

