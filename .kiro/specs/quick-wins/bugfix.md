# Bugfix Requirements Document

## Introduction

This document captures requirements for 12 high-impact, low-effort fixes ("quick wins") in the `qr-order` Next.js + Supabase restaurant QR ordering application. The issues span security vulnerabilities (price manipulation, webhook replay attacks, client-side-only plan enforcement), reliability gaps (missing cron scheduling, non-atomic order creation, inactive webhook retries), missing observability (no health endpoint, no error monitoring), and UX gaps (no subscription expiry warning, no error boundaries, missing historical item names).

Most fixes are independent and can be shipped in isolation. **Exception: QW-2 (server-side prices), QW-4 (name snapshot), and QW-11 (atomic order creation) are tightly coupled and must be implemented together as a single `place_order_atomic` Postgres RPC.**

---

## Bug Analysis

### Current Behavior (Defect)

**QW-1 — Cron jobs never run**

1.1 WHEN the application is deployed to Vercel THEN the system never schedules `/api/cron/audit-log-purge` or `/api/cron/webhook-retries` because `vercel.json` contains only `{}`

1.2 WHEN `CRON_SECRET` is set in the environment THEN the system never passes it as an `Authorization` header to the cron routes because no Vercel cron configuration exists to trigger them

1.3 WHEN the project is on Vercel's Hobby plan THEN cron jobs are limited to once per day — the `webhook-retries` schedule of `* * * * *` (every minute) requires a Vercel Pro plan or higher. Note: `pg_cron` extension is already installed and active in the Supabase project (v1.6.4) with 2 existing jobs running — this is the preferred scheduling mechanism and has no Vercel plan dependency

---

**QW-2 — Client-supplied prices accepted for order items**

2.1 WHEN a customer submits a POST `/api/orders` request with `price: 0` for every item THEN the system passes that value directly as `base_price` to `calculate_item_prices_batch()` and inserts order items at zero cost

2.2 WHEN a malicious actor crafts a request body with arbitrary `price` values THEN the system uses those prices without cross-checking them against the `menu_items` table, allowing orders to be placed at any price the attacker chooses

---

**QW-3 — No health check endpoint**

3.1 WHEN an uptime monitor, load balancer, or deployment pipeline requests a health check THEN the system returns a 404 because no `/api/health` route exists

---

**QW-4 — Item names not stored on order_items; menu items hard-deleted**

4.1 WHEN a menu item is renamed after an order is placed THEN the system displays the new name for historical order rows because `order_items` stores only `menu_item_id`, not the name at time of order

4.2 WHEN a menu item is deleted after an order is placed THEN the system cannot display any name for that order item because the foreign key target no longer exists

4.3 WHEN a manager attempts to delete a menu item that has ever been ordered THEN the system blocks the deletion with a foreign key constraint error (`ON DELETE RESTRICT` on `order_items.menu_item_id`), giving no graceful alternative

4.4 WHEN a manager wants to retire a menu item from the active menu THEN the system provides no archive or soft-delete mechanism — the only option is hard delete, which is blocked if the item has order history

4.5 WHEN `deleted_at` is added to `menu_items` THEN `getMenuItems()` in `lib/api.ts` (used by the customer ordering page) has no `deleted_at IS NULL` filter — archived items will appear on the customer menu

4.6 WHEN `deleted_at` is added to `menu_items` THEN `getAllMenuItems()` in `lib/api.ts` (used by MenuManager) has no `deleted_at IS NULL` filter — archived items will appear in the manager's active item list

4.7 WHEN `deleted_at` is added to `menu_items` THEN the `MenuItem` TypeScript type in `types/database.ts` has no `deleted_at` field — TypeScript errors will occur everywhere `MenuItem` is used

4.8 WHEN `deleted_at` is added to `menu_items` THEN the two public SELECT RLS policies ("Public can read available menu items" and "Anyone can read available menu items") use `USING (is_available = true)` with no `deleted_at` check — an archived item with `is_available = true` remains readable by anon users who query by ID, bypassing the application-level filter

4.9 WHEN `deleted_at` is added to `menu_items` THEN the existing index `menu_items_restaurant_id_is_available_idx ON (restaurant_id, is_available)` does not cover `deleted_at` — queries filtering `WHERE restaurant_id = X AND is_available = true AND deleted_at IS NULL` will not use this index efficiently

---

**QW-5 — Webhook timestamp not validated (replay attack possible)**

5.1 WHEN a webhook receiver processes an incoming request THEN the system never checks whether `X-Webhook-Timestamp` is recent, so a captured valid request can be replayed indefinitely

---

**QW-6 — No server-side quantity validation**

6.1 WHEN a POST `/api/orders` request contains an item with `quantity: 0` THEN the system inserts an order item with zero quantity without returning a validation error

6.2 WHEN a POST `/api/orders` request contains an item with a non-integer or negative `quantity` THEN the system passes the value through to the database without validation

6.3 WHEN a POST `/api/orders` request contains an item with `quantity: 1000` THEN the system inserts the order item without any upper-bound check

---

**QW-7 — Subscription renewal: no warning, no autopay, and yearly price charged incorrectly**

7.1 WHEN a manager's Pro subscription `current_period_end` is within 7 days THEN the system displays no in-app warning, leaving the manager unaware that their subscription is about to lapse

7.2 WHEN a Pro subscription expires THEN the system provides no automatic renewal mechanism — PhonePe Standard Checkout is a one-time payment and no recurring billing is configured, so the restaurant loses access silently with no retry

7.3 WHEN a manager selects the yearly billing cycle and clicks "Upgrade" THEN the system charges `yearly_paise` from the `plans` table as the full payment amount. The DB currently stores `yearly_paise = 79900` (₹799) for the Pro plan — this is the intended *per-month equivalent*, not the full annual charge. The customer is therefore charged ₹799 for a full year instead of the correct ₹9,588 (₹799 × 12), representing a ~92% undercharge

7.4 WHEN `BillingPanel.tsx` displays the yearly CTA label THEN it shows `₹799/mo (billed yearly)` — the `/mo` label implies a monthly recurring charge, but PhonePe charges the full annual amount upfront in a single transaction, making the label misleading regardless of the price fix

7.5 WHEN a manager's subscription is within 7 days of expiry THEN the system shows no renewal prompt inside the dashboard, and no reminder is sent via any channel (email, SMS, or in-app)

7.6 WHEN `BillingPanel.tsx` displays the Current Plan section for a trialing user THEN it shows `<span>Free</span>` as the price — this label should reflect "Trial" not "Free"

7.7 WHEN `BillingPanel.tsx` displays the yearly savings badge THEN it calculates `Math.round((1 - proYearlyPaise / proMonthlyPaise) * 100)`. After fixing `yearly_paise` from 79900 → 958800, this formula produces a large negative number instead of the correct ~20% savings figure

---

**QW-8 — No React error boundaries in the manager dashboard**

8.1 WHEN a rendering error occurs in any dashboard section (e.g. `TableSessions`, `OrderLog`, `Analytics`) THEN the system crashes the entire manager dashboard page, showing a blank or broken UI to the manager

8.2 The manager dashboard in `ManagerClient.tsx` renders 12 tab components — `TableSessions`, `OrderLog`, `Analytics`, `MenuManager`, `TablesManager`, `FloorsManager`, `StaffManager`, `WebhooksManager`, `BillingPanel`, `SettingsPanel`, `RestaurantDetails`, `CategoryTagManager` — none of which are wrapped in an error boundary

---

**QW-9 — Inactive webhook endpoints are still retried**

9.1 WHEN `retryDelivery()` is called for a delivery whose endpoint has `is_active = false` THEN the system dispatches the HTTP request anyway, because the fetched `endpoint.is_active` value is never checked before calling `dispatchToUrl()`

---

**QW-10 — Plan limits enforced only client-side; "free plan" is a misnomer throughout the codebase**

10.1 WHEN a manager has reached the trial table limit (5 tables) and calls `createTable()` in `lib/api.ts` directly via the Supabase client THEN the system creates the table because `createTable()` performs no plan limit check. Note: there is no `/api/tables` route — the bypass is at the `lib/api.ts` level, not an API route

10.2 WHEN a manager has reached the trial menu item limit (20 items) and calls `createMenuItem()` in `lib/api.ts` directly via the Supabase client THEN the system creates the menu item because `createMenuItem()` performs no plan limit check. Note: there is no `/api/menu-items` route — the bypass is at the `lib/api.ts` level, not an API route

10.3 WHEN the `subscriptions` table is created THEN `plan` defaults to `'free'` and the CHECK constraint allows `'free'` as a valid plan value — but there is no "free plan" product. The value `'free'` is used as an internal fallback/pending state, not a real tier. Restaurants on trial have `plan = 'free', status = 'trialing'`, which is semantically wrong — trial is both the plan and the status

10.4 WHEN `/api/phonepe/checkout` initiates a payment THEN it sets `plan = 'free', status = 'incomplete'` on the subscription row as a pending state — meaning a restaurant mid-checkout appears to be on a "free plan"

10.5 WHEN `useSubscription` finds no subscription row for a restaurant THEN it falls back to `{ plan: "free", status: "active" }` — a non-existent restaurant subscription appears as an active free plan

10.6 WHEN the `get_restaurant_plan()` Postgres function finds no subscription THEN it returns `'free'` as the default plan value

10.7 WHEN `TablesManager`, `MenuManager`, and `AppSidebar` display plan limit messaging THEN they show "Free plan limit reached" and "Free plan is limited to X tables/items" — language that implies a free tier product that does not exist. The correct term is "Trial limit"

10.8 WHEN `AppSidebar.tsx` derives `isPro`/`isTrial` from the `planLabel` prop string THEN it uses string matching (`planLabel.toLowerCase().includes("pro")`) rather than the actual plan value from `useSubscription` — after label text changes, this string-matching logic must still correctly identify trial and pro states

---

**QW-11 — Order creation is not atomic**

11.1 WHEN the `order_items` INSERT (step 3 of order creation) fails after the `orders` INSERT (step 1) has already succeeded THEN the system leaves an orphaned `orders` row with no associated items, and returns a 500 error to the customer

11.2 WHEN `calculate_item_prices_batch()` (step 2) fails after the `orders` INSERT (step 1) has already succeeded THEN the system may leave an orphaned order row depending on the fallback path taken

---

**QW-12 — No error monitoring**

12.1 WHEN an unhandled exception occurs in an API route or client component THEN the system logs nothing to an external monitoring service, making silent failures invisible to the development team

---

### Expected Behavior (Correct)

**QW-1 — Cron jobs scheduled via pg_cron and Supabase Edge Functions**

2.1 WHEN the `purge_expired_audit_logs()` Postgres function needs to run daily THEN the system SHALL schedule it via `pg_cron` (already installed, v1.6.4): `SELECT cron.schedule('audit-log-purge', '0 2 * * *', 'SELECT public.purge_expired_audit_logs()')`. This runs entirely inside Postgres with no Vercel dependency

2.2 WHEN webhook deliveries need to be retried every minute THEN the system SHALL implement a `webhook-retries` Supabase Edge Function containing the retry logic (currently in TypeScript in `lib/webhooks.ts`), and schedule it via `pg_cron` using `pg_net` OR via Supabase's built-in Edge Function scheduling. Note: `pg_net` is not currently installed — if scheduling via pg_cron is required, `pg_net` must be enabled first. Alternative: keep the Vercel cron for webhook-retries only, and use pg_cron for audit-log-purge

2.3 WHEN `vercel.json` is updated THEN it SHALL include the `crons` entries as a fallback for any jobs not migrated to pg_cron, ensuring the existing API route handlers (`/api/cron/audit-log-purge`, `/api/cron/webhook-retries`) continue to work if called directly

---

**QW-2 — Prices fetched server-side**

2.3 WHEN a POST `/api/orders` request is received THEN the system SHALL fetch the actual `price` for each `menu_item_id` from the `menu_items` table WHERE `id = ANY(item_ids)` AND `restaurant_id = restaurantId` before calling `calculate_item_prices_batch()`

2.4 WHEN a menu item id in the order does not exist in `menu_items` for the given restaurant THEN the system SHALL reject the order with a 400 error

---

**QW-3 — Health endpoint**

3.1 WHEN GET `/api/health` is requested THEN the system SHALL return HTTP 200 with `{ status: "ok", db: "ok", timestamp: "<ISO string>" }` when Supabase is reachable

3.2 WHEN GET `/api/health` is requested and Supabase is unreachable THEN the system SHALL return HTTP 503 with `{ status: "error", db: "error", timestamp: "<ISO string>" }`

---

**QW-4 — Item name snapshot + soft delete for menu items**

4.1 WHEN an order is created THEN the system SHALL populate a `name` column on each `order_items` row with the menu item's name at the time of order placement

4.2 WHEN a menu item is subsequently renamed THEN the system SHALL CONTINUE TO display the original name stored on the `order_items` row for historical orders — no join to `menu_items` required for name display

4.3 WHEN a manager clicks "Archive" on a menu item THEN the system SHALL set `deleted_at = now()` on that `menu_items` row (soft delete) rather than issuing a hard `DELETE`

4.4 WHEN the customer ordering page fetches the menu THEN the system SHALL filter `WHERE deleted_at IS NULL` so archived items are never shown to customers. This requires updating `getMenuItems()` in `lib/api.ts` to add `.is(deleted_at, null)` alongside the existing `is_available = true` filter

4.5 WHEN the manager's MenuManager loads items THEN the system SHALL filter `WHERE deleted_at IS NULL` by default, showing only active items. This requires updating `getAllMenuItems()` in `lib/api.ts` to add `.is(deleted_at, null)`

4.6 WHEN a manager views the "Archived Items" section in MenuManager THEN the system SHALL display all items WHERE `deleted_at IS NOT NULL` for that restaurant, with a "Restore" action to set `deleted_at = NULL`

4.7 WHEN `deleteMenuItem()` in `lib/api.ts` is called THEN the function SHALL perform a soft delete (UPDATE `deleted_at = now()`) instead of a hard DELETE. Note: there is no `/api/menu-items` route — deletion goes through `lib/api.ts` directly. The enforcement must be in `lib/api.ts`, not at an API route layer. Note: the `on_menu_change` trigger fires on UPDATE — a soft delete will broadcast to `customer:{restaurantId}` and `manager:{restaurantId}` channels, causing the customer ordering page to reload its menu (which will then filter out the archived item). This is correct behavior

4.8 WHEN the `top_selling_items` view references item names THEN it SHALL be updated to prefer `oi.name` (the snapshotted name on `order_items`) over `mi.name` (the current name on `menu_items`) so that analytics correctly reflect the name at time of order, and archived items do not cause join gaps

4.9 WHEN `deleted_at TIMESTAMPTZ` is added to `menu_items` THEN the `MenuItem` TypeScript type in `types/database.ts` SHALL be updated to include `deleted_at: string | null` so that all existing usages of `MenuItem` remain type-safe

4.10 WHEN `deleted_at` is added to `menu_items` THEN the two public SELECT RLS policies SHALL be updated to add `AND deleted_at IS NULL` to their USING clauses:
- "Public can read available menu items": `USING (is_available = true AND deleted_at IS NULL)`
- "Anyone can read available menu items": `USING (is_available = true AND deleted_at IS NULL)`
The "Managers can manage menu items" FOR ALL policy does not need changing — managers need to read archived items to display the Archived Items section and to restore them

4.11 WHEN `deleted_at` is added to `menu_items` THEN a new partial index SHALL be created: `CREATE INDEX menu_items_active_idx ON public.menu_items (restaurant_id, is_available) WHERE deleted_at IS NULL`. This replaces the existing `menu_items_restaurant_id_is_available_idx` for active-item queries and keeps query performance equivalent to today

---

**QW-5 — Webhook timestamp replay protection (outbound webhook consumer utility)**

5.1 WHEN a webhook receiver verifies an incoming request from this system THEN the system SHALL provide a `verifyWebhookSignature(secret, body, headers)` utility function in `lib/webhooks.ts` that rejects the request if `X-Webhook-Timestamp` represents a time more than 5 minutes in the past or future. Note: this app is the *sender* of webhooks, not the receiver. The timestamp is already added to outgoing requests by `signPayload()`. This fix adds a verification utility that webhook *consumers* (restaurant integrations) can use, and documents it. The only inbound webhook this app receives is `/api/phonepe/webhook` which uses PhonePe's own signature scheme and is unaffected by this change

---

**QW-6 — Quantity validation**

6.1 WHEN a POST `/api/orders` request contains any item where `quantity` is not an integer, is less than 1, or is greater than 99 THEN the system SHALL return a 400 error with a descriptive message before inserting any rows

---

**QW-7 — Subscription renewal reminders, correct yearly pricing, and clear billing labels**

7.1 WHEN a manager views the dashboard and `subscription.current_period_end` is within 7 days and the subscription is active (`isPro = true`, `isExpired = false`) THEN the system SHALL display a dismissible warning banner linking directly to the Billing tab

7.2 WHEN `yearly_paise` is stored in the `plans` table THEN it SHALL represent the full annual charge in paise (e.g. Pro yearly = ₹799/mo × 12 = ₹9,588 = 958800 paise). The DB migration SHALL update `yearly_paise` for all paid plans: Pro from 79900 → 958800, Business from 159900 → 1918800

7.3 WHEN a manager selects yearly billing and clicks "Upgrade" THEN the system SHALL charge the full annual `yearly_paise` amount in a single PhonePe transaction (existing behavior is correct — only the stored value needs fixing)

7.4 WHEN `BillingPanel.tsx` displays the yearly plan price THEN it SHALL show the per-month equivalent (e.g. ₹799/mo) alongside the total annual charge (e.g. billed ₹9,588/yr) so the manager understands they are paying upfront for the full year

7.5 WHEN `BillingPanel.tsx` displays the yearly CTA button THEN it SHALL NOT show `/mo` alone — it SHALL show the full annual amount (e.g. "Upgrade — ₹9,588/yr") to accurately reflect what PhonePe will charge

7.6 WHEN `BillingPanel.tsx` displays the yearly savings badge THEN it SHALL calculate savings as `Math.round((1 - (yearly_paise / 12) / monthly_paise) * 100)` — dividing `yearly_paise` by 12 first to get the per-month equivalent before comparing to `monthly_paise`. The current formula `(1 - yearly_paise / monthly_paise)` produces a large negative number after the price fix

7.7 WHEN `BillingPanel.tsx` displays the Current Plan price for a trialing user THEN it SHALL show "Trial" (or "₹0 during trial") instead of the current "Free" label

7.8 WHEN a Pro subscription is within 7, 3, or 0 days of expiry THEN the system SHALL send renewal reminder notifications directing the manager to manually renew via the Billing tab. Implementation:
- A `subscription-reminders` Supabase Edge Function queries `subscriptions` for rows where `status = 'active'` AND `current_period_end` is within 7 days AND the relevant reminder has not yet been sent
- The Edge Function sends an in-app banner (already covered by 7.1) and optionally an email via Resend/SendGrid
- The Edge Function is scheduled daily via `pg_cron`: `SELECT cron.schedule('subscription-reminders', '0 9 * * *', 'SELECT net.http_post(...)')` — or via Supabase's built-in Edge Function scheduling if pg_net is not available
- Reminder tracking: add `reminder_sent_at JSONB DEFAULT '{}'` column to `subscriptions` table. The Edge Function sets `reminder_sent_at = jsonb_set(reminder_sent_at, '{7d}', to_jsonb(now()))` etc. to prevent duplicate sends. Valid keys: `'7d'`, `'3d'`, `'0d'`. Reset to `'{}'` when subscription renews

7.9 WHEN a subscription enters `past_due` status THEN the system SHALL apply a 3-day grace period during which the restaurant retains Pro access before the paywall activates. The grace period SHALL be implemented by updating the `isExpired` derivation in `useSubscription.ts` to check `past_due AND now() > current_period_end + 3 days` rather than treating `past_due` as immediately expired. Note: `canceled` status SHALL NOT receive a grace period — a deliberate cancellation takes effect immediately. Note: `'expired'` is not a valid DB status value — the valid terminal statuses are `past_due`, `canceled`, and `incomplete`

---

**QW-8 — Error boundaries**

8.1 WHEN a rendering error occurs in a major dashboard section THEN the system SHALL catch the error in an `ErrorBoundary` component, display a section-level error fallback with a refresh action, and leave all other dashboard sections functional

8.2 The following sections in `ManagerClient.tsx` SHALL each be individually wrapped in an `ErrorBoundary`: `TableSessions`, `OrderLog`, `Analytics`, `MenuManager`, `TablesManager`, `FloorsManager`, `StaffManager`, `WebhooksManager`, `BillingPanel`, `SettingsPanel`, `RestaurantDetails`, `CategoryTagManager`
---

**QW-9 — Skip retry for inactive endpoints**

9.1 WHEN `retryDelivery()` is called and `endpoint.is_active === false` THEN the system SHALL mark the delivery status as `dead`, skip the HTTP dispatch, and return early without calling `dispatchToUrl()`

---

**QW-10 — Server-side plan limit checks + rename "free" to "trialing" throughout**

10.1 WHEN `createTable()` in `lib/api.ts` is called THEN the function SHALL query the current table count for the restaurant and return an error if the count is at or above the plan's `max_tables` limit. The check SHALL use `>= max_tables` (not `>`). Implementation: call `supabase.rpc('get_restaurant_plan', { p_restaurant_id })` (SECURITY DEFINER, granted to anon — confirmed via live DB) then `supabase.rpc('get_plan_limits', { p_plan })` (granted to anon) — no new function needed. Note: `onboard_restaurant()` inserts exactly 5 tables at signup — a new trial restaurant starts at the limit, so the first `createTable()` call after onboarding is correctly blocked. Note: there is no `/api/tables` route — table creation goes through `lib/api.ts` directly

10.2 WHEN `createMenuItem()` in `lib/api.ts` is called THEN the function SHALL query the current menu item count for the restaurant and return an error if the count is at or above the plan's `max_menu_items` limit. The check SHALL use `>= max_menu_items`. Same implementation as 10.1 — use existing `get_restaurant_plan()` + `get_plan_limits()` RPCs. This also applies to the CSV bulk upload path (`batchCreateMenuItems` → `createMenuItem`) — bulk uploads will be blocked at the limit, which is correct behavior. Note: there is no `/api/menu-items` route — menu item creation goes through `lib/api.ts` directly

10.3 WHEN the `subscriptions` schema is migrated THEN the `plan` column CHECK constraint SHALL be updated from `('free','pro')` to `('trialing','pro')`, and the default SHALL change from `'free'` to `'trialing'`

10.4 WHEN `/api/phonepe/checkout` sets a pending subscription state THEN it SHALL use `plan = 'trialing', status = 'incomplete'` instead of `plan = 'free', status = 'incomplete'`

10.5 WHEN `useSubscription` falls back to a default subscription THEN it SHALL use `{ plan: "trialing", status: "active" }` instead of `{ plan: "free", status: "active" }`

10.6 WHEN `get_restaurant_plan()` returns a default plan THEN it SHALL return `'trialing'` instead of `'free'`

10.7 WHEN `get_plan_limits()` Postgres function is updated THEN the `WHEN 'free'` branch SHALL be renamed to `WHEN 'trialing'` so that `get_plan_limits('trialing')` returns the correct trial limits rather than falling through to the `ELSE` clause

10.8 WHEN `TablesManager`, `MenuManager`, and `AppSidebar` display plan limit messaging THEN they SHALL use "Trial limit" and "Your trial is limited to X tables/items" — never "Free plan"

10.9 WHEN `AppSidebar.tsx` derives `isPro`/`isTrial` from the `planLabel` prop string THEN the string-matching logic (`planLabel.toLowerCase().includes("pro")`, `.includes("trial")`) SHALL continue to work correctly after label text changes — verify that updated label strings still contain "pro" or "trial" as substrings so the sidebar badge and upsell card render correctly

10.10 WHEN the `Plan` TypeScript type is defined in `useSubscription.ts` THEN it SHALL be `"trialing" | "pro"` instead of `"free" | "pro"`, and the `FREE_LIMITS` constant SHALL be renamed `TRIAL_LIMITS`

10.11 WHEN the 2 existing `plan = 'free', status = 'incomplete'` subscription rows are migrated THEN they SHALL be updated to `plan = 'trialing'` to reflect abandoned checkout state

10.12 WHEN the `plan` column rename is applied THEN the `isPro` derivation in `useSubscription.ts` (`(plan === "pro") && (isActive || isTrial)`) SHALL NOT be changed. Confirmed via live DB: all trialing restaurants already have `plan = 'pro'` — trial is expressed via `status = 'trialing'`, not via the plan column. The only rows with `plan = 'free'` are the 2 abandoned checkouts. The `isPro` logic is correct as-is and is unaffected by this migration

---

**QW-11 — Atomic order creation (combined with QW-2 and QW-4)**

11.1 WHEN an order is created THEN the system SHALL execute the following steps inside a single Postgres RPC (`place_order_atomic`) that runs as one atomic transaction: (a) call `get_initial_order_status(p_restaurant_id)` internally to determine `'pending'` or `'pending_waiter'` based on routing mode — no need to pass this from the API route since `get_initial_order_status` is already a SECURITY DEFINER function callable from within the RPC; (b) fetch actual prices from `menu_items` WHERE `id = ANY(p_item_ids)` AND `restaurant_id = p_restaurant_id` — never trust client-supplied prices (QW-2); (c) apply the floor price multiplier; (d) INSERT the `orders` row with the derived status; (e) INSERT all `order_items` rows with the snapshotted item `name` from step (b) (QW-4); (f) return the new order id. A failure at any step SHALL roll back all prior steps with no orphaned rows

11.2 WHEN QW-2 (server-side prices), QW-4 (name snapshot), and QW-11 (atomicity) are implemented THEN they SHALL be implemented together as a single new Postgres RPC (`place_order_atomic`) replacing the existing 3-step flow in `/api/orders/route.ts`. Implementing QW-2 or QW-4 as patches to the existing flow and then replacing that flow with QW-11 would discard those patches — all three must land in one change

11.3 WHEN `place_order_atomic` is designed THEN the RPC SHALL be `SECURITY INVOKER` (default) so it runs as the calling user and RLS policies on `orders` and `order_items` continue to apply. The following pre-checks SHALL remain in `/api/orders/route.ts` and run before calling the RPC: rate limiting, party size validation, quantity validation (QW-6), `check_table_has_unpaid_orders`. The routing mode fetch is removed from the API route — the RPC handles it internally via `get_initial_order_status()`

11.4 WHEN `calculate_item_prices_batch()` is superseded by `place_order_atomic` THEN the old RPC becomes dead code. It SHALL be deprecated (documented as unused) but not deleted in this change, to avoid breaking any external integrations that may call it directly

---

**QW-12 — Error monitoring**

12.1 WHEN an unhandled exception occurs in an API route or client component THEN the system SHALL capture and report the error to Sentry with sufficient context (route, user, restaurant) for diagnosis

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a valid POST `/api/orders` request is submitted with correct item ids and quantities THEN the system SHALL CONTINUE TO create the order and return the order id

3.2 WHEN a webhook delivery succeeds on the first attempt THEN the system SHALL CONTINUE TO mark the delivery as `success` and reset the endpoint's `failure_count` to 0

3.3 WHEN a webhook endpoint has `is_active = true` and a delivery is due for retry THEN the system SHALL CONTINUE TO dispatch the HTTP request and update the delivery record

3.4 WHEN a manager's subscription is not within 7 days of expiry THEN the system SHALL CONTINUE TO display the dashboard without any expiry warning banner

3.5 WHEN a manager's subscription is expired (`isExpired = true`) THEN the system SHALL CONTINUE TO show the existing paywall overlay (the new banner is only for active subscriptions nearing expiry)

3.6 WHEN a rendering error occurs in one dashboard section THEN the system SHALL CONTINUE TO render all other dashboard sections normally

3.7 WHEN a Pro-plan manager creates a table below the plan limit THEN the system SHALL CONTINUE TO allow the creation without a plan limit error

3.8 WHEN a Pro-plan manager creates a menu item below the plan limit THEN the system SHALL CONTINUE TO allow the creation without a plan limit error

3.9 WHEN the cron routes are called with a valid `Authorization: Bearer <CRON_SECRET>` header THEN the system SHALL CONTINUE TO process the request normally

3.10 WHEN the cron routes are called without a valid secret THEN the system SHALL CONTINUE TO return 401 Unauthorized

3.11 WHEN `order_items` are inserted for a new order THEN the system SHALL CONTINUE TO store `menu_item_id`, `quantity`, and `price` alongside the new `name` column

3.12 WHEN a webhook receiver processes a request with a valid, recent timestamp and correct signature THEN the system SHALL CONTINUE TO accept and process the request normally

3.13 WHEN a menu item has `deleted_at IS NULL` THEN the system SHALL CONTINUE TO display it on the customer ordering page and in MenuManager exactly as before

3.14 WHEN a menu item is archived (soft-deleted) THEN the system SHALL CONTINUE TO resolve its name correctly in all historical order queries, analytics views, and webhook payloads via the `menu_item_id` FK — the row is never removed from the table

3.15 WHEN a manager on a monthly Pro plan renews THEN the system SHALL CONTINUE TO charge `monthly_paise` (99900 paise = ₹999) — the monthly price is correct and unchanged

3.16 WHEN a manager on a yearly plan has already paid the old incorrect yearly amount THEN the system SHALL NOT retroactively charge the difference — the fix applies only to new yearly transactions after the migration

3.17 WHEN a restaurant is on an active Pro subscription THEN renaming `'free'` to `'trialing'` in the schema SHALL NOT affect their subscription row — Pro restaurants have `plan = 'pro'` and are unaffected by this migration

3.18 WHEN a subscription has `status = 'past_due'` and `now() <= current_period_end + 3 days` THEN the system SHALL CONTINUE TO grant Pro access during the grace period — the paywall SHALL NOT activate until the grace period has elapsed

3.19 WHEN `deleted_at IS NULL` on a `menu_items` row THEN all existing queries, components, and TypeScript usages of `MenuItem` SHALL CONTINUE TO work without modification — the new `deleted_at` field is nullable and additive

3.20 WHEN a manager on a trial plan has fewer than 5 tables THEN `createTable()` SHALL CONTINUE TO allow creation — the limit check only blocks at or above the limit, not below it

3.21 WHEN the `menu_items` RLS policies are updated to add `AND deleted_at IS NULL` THEN the "Managers can manage menu items" FOR ALL policy SHALL remain unchanged — managers need unrestricted read access to see archived items in the Archived Items section

3.22 WHEN `reminder_sent_at` is added to `subscriptions` THEN existing subscription rows SHALL have `reminder_sent_at = '{}'` (empty JSONB) by default — no existing functionality is affected

---

## Bug Condition Pseudocode

### QW-1 — Cron Jobs Never Scheduled

```pascal
FUNCTION isBugCondition_QW1(config)
  INPUT: config — contents of vercel.json
  OUTPUT: boolean
  RETURN NOT config.hasKey("crons")
END FUNCTION

// Fix Checking
FOR ALL deployments WHERE isBugCondition_QW1(vercel.json) DO
  ASSERT cron("/api/cron/audit-log-purge") IS scheduled AT "0 2 * * *"
  ASSERT cron("/api/cron/webhook-retries") IS scheduled AT "* * * * *"
END FOR

// Preservation Checking
FOR ALL cronRequests WHERE validSecret(request) DO
  ASSERT F(request) = F'(request)  // handler behavior unchanged
END FOR
```

### QW-2 — Client-Supplied Prices

```pascal
FUNCTION isBugCondition_QW2(request)
  INPUT: request — POST /api/orders body
  OUTPUT: boolean
  RETURN request.items.any(item => item.price != menuItems[item.menu_item_id].price)
END FUNCTION

// Fix Checking
FOR ALL requests WHERE isBugCondition_QW2(request) DO
  result ← placeOrder'(request)
  ASSERT result.orderItems.all(item => item.price = menuItems[item.menu_item_id].price)
END FOR

// Preservation Checking
FOR ALL requests WHERE NOT isBugCondition_QW2(request) DO
  ASSERT F(request).orderId = F'(request).orderId
END FOR
```

### QW-5 — Webhook Timestamp Replay (Consumer Utility)

```pascal
FUNCTION verifyWebhookSignature(secret, body, headers)
  INPUT: secret — endpoint secret, body — raw request body string, headers — request headers
  OUTPUT: { valid: boolean, reason?: string }

  timestamp ← headers["X-Webhook-Timestamp"]
  IF timestamp IS NULL THEN RETURN { valid: false, reason: "Missing timestamp" }

  ageSeconds ← abs(now() - parseISO(timestamp)) in seconds
  IF ageSeconds > 300 THEN
    RETURN { valid: false, reason: "Timestamp too old or too far in future" }
  END IF

  expectedSig ← HMAC-SHA256(secret, timestamp + "." + body)
  actualSig   ← headers["X-Webhook-Signature"].replace("sha256=", "")
  IF expectedSig != actualSig THEN RETURN { valid: false, reason: "Invalid signature" }

  RETURN { valid: true }
END FUNCTION

// Fix Checking
FOR ALL calls TO verifyWebhookSignature WHERE ageSeconds > 300 DO
  ASSERT result.valid = false
END FOR

// Preservation Checking
FOR ALL calls WHERE ageSeconds <= 300 AND validSignature DO
  ASSERT result.valid = true
END FOR
```

### QW-6 — Invalid Quantity

```pascal
FUNCTION isBugCondition_QW6(item)
  INPUT: item — order item from request body
  OUTPUT: boolean
  RETURN NOT isInteger(item.quantity)
      OR item.quantity < 1
      OR item.quantity > 99
END FUNCTION

// Fix Checking
FOR ALL requests WHERE requests.items.any(isBugCondition_QW6) DO
  result ← placeOrder'(request)
  ASSERT result.status = 400
END FOR

// Preservation Checking
FOR ALL requests WHERE requests.items.all(item => NOT isBugCondition_QW6(item)) DO
  ASSERT F(request).orderId = F'(request).orderId
END FOR
```

### QW-9 — Inactive Endpoint Retried

```pascal
FUNCTION isBugCondition_QW9(delivery)
  INPUT: delivery — webhook delivery record with joined endpoint
  OUTPUT: boolean
  RETURN delivery.endpoint.is_active = false
END FUNCTION

// Fix Checking
FOR ALL deliveries WHERE isBugCondition_QW9(delivery) DO
  result ← retryDelivery'(delivery.id)
  ASSERT delivery.status = "dead"
  ASSERT noHttpRequestDispatched()
END FOR

// Preservation Checking
FOR ALL deliveries WHERE NOT isBugCondition_QW9(delivery) DO
  ASSERT F(delivery).httpDispatched = F'(delivery).httpDispatched
END FOR
```

### QW-10 — Client-Side-Only Plan Limits + Free Plan Misnomer

```pascal
FUNCTION isBugCondition_QW10_tables(restaurantId)
  INPUT: restaurantId — the restaurant being checked
  OUTPUT: boolean
  RETURN currentTableCount(restaurantId) >= get_plan_limits(get_restaurant_plan(restaurantId)).max_tables
END FUNCTION

// Fix Checking — lib/api.ts createTable() enforces limit
FOR ALL calls TO createTable(params) WHERE isBugCondition_QW10_tables(params.restaurantId) DO
  ASSERT result = error  // creation rejected before DB insert
  ASSERT tableCount(params.restaurantId) UNCHANGED
END FOR

// Fix Checking — "free" plan value eliminated from DB and code
FOR ALL subscriptionRows DO
  ASSERT subscriptionRow.plan != "free"
  ASSERT subscriptionRow.plan IN ("trialing", "pro")
END FOR

// Fix Checking — get_plan_limits handles 'trialing' explicitly
FOR ALL calls TO get_plan_limits("trialing") DO
  ASSERT result.max_tables = 5
  ASSERT result.max_menu_items = 20
END FOR

// Fix Checking — UI labels corrected
FOR ALL uiElements WHERE element.text CONTAINS "Free plan" DO
  ASSERT element.text CONTAINS "Trial"
  ASSERT NOT element.text CONTAINS "Free plan"
END FOR

// Preservation Checking — Pro plan unaffected
FOR ALL calls TO createTable(params) WHERE NOT isBugCondition_QW10_tables(params.restaurantId) DO
  ASSERT tableCreated = true
END FOR

FOR ALL subscriptions WHERE plan = "pro" DO
  ASSERT subscription.plan UNCHANGED AFTER MIGRATION
END FOR
```

### QW-11 — Non-Atomic Order Creation (combined with QW-2 and QW-4)

```pascal
FUNCTION isBugCondition_QW11(orderCreation)
  INPUT: orderCreation — execution of the 3-step order creation flow
  OUTPUT: boolean
  RETURN orderCreation.step3_failed = true AND orderCreation.step1_succeeded = true
END FUNCTION

// Fix Checking — atomic RPC, no orphaned rows on failure
FOR ALL orderCreations WHERE isBugCondition_QW11(orderCreation) DO
  result ← place_order_atomic(orderCreation.input)
  ASSERT noOrphanedOrderRow()
  ASSERT result.status = 500  // still an error, but no partial data
END FOR

// Fix Checking — routing mode derived internally (not passed from API route)
FOR ALL calls TO place_order_atomic(input) DO
  expectedStatus ← get_initial_order_status(input.restaurant_id)
  ASSERT insertedOrder.status = expectedStatus
END FOR

// Fix Checking — prices fetched from DB inside RPC (QW-2)
FOR ALL calls TO place_order_atomic(input) DO
  FOR ALL items IN input.items DO
    ASSERT orderItem.price = menuItems[item.menu_item_id].price * floorMultiplier
    // never uses input.items[i].price as the source of truth
  END FOR
END FOR

// Fix Checking — name snapshotted inside RPC (QW-4)
FOR ALL calls TO place_order_atomic(input) DO
  FOR ALL items IN result.order_items DO
    ASSERT items.name = menuItems[items.menu_item_id].name  // captured at insert time
  END FOR
END FOR

// Preservation Checking — valid orders still succeed
FOR ALL orderCreations WHERE NOT isBugCondition_QW11(orderCreation) DO
  ASSERT place_order_atomic(orderCreation.input).orderId IS NOT NULL
END FOR
```

### QW-7 — Yearly Price Undercharge and Missing Renewal Reminders

```pascal
FUNCTION isBugCondition_QW7_yearlyPrice(plan)
  INPUT: plan — a row from the plans table
  OUTPUT: boolean
  // yearly_paise should be the full annual charge ≈ monthly_paise * 12 * (1 - discount)
  // For Pro at 20% discount: 99900 * 12 * 0.8 = 958800
  // Bug: yearly_paise is stored as the per-month equivalent (79900) not the annual total
  RETURN plan.yearly_paise < (plan.monthly_paise * 9)
  // monthly * 9 is a safe lower bound — any genuine annual price with ≤25% discount exceeds this
END FUNCTION

// Fix Checking — yearly price corrected
FOR ALL plans WHERE plan.monthly_paise > 0 DO
  ASSERT plan.yearly_paise >= plan.monthly_paise * 9
  // Pro:      958800 >= 99900 * 9 = 899100  ✓
  // Business: 1918800 >= 159900 * 9 = 1439100 ✓
END FOR

FUNCTION isBugCondition_QW7_noReminder(subscription)
  INPUT: subscription — a subscriptions row
  OUTPUT: boolean
  RETURN subscription.status = "active"
     AND subscription.current_period_end IS NOT NULL
     AND daysUntil(subscription.current_period_end) <= 7
     AND noReminderSentThisCycle(subscription.restaurant_id)
END FUNCTION

// Fix Checking — reminder banner shown
FOR ALL subscriptions WHERE isBugCondition_QW7_noReminder(subscription) DO
  ASSERT reminderBannerShown(subscription.restaurant_id) = true
END FOR

FUNCTION isBugCondition_QW7_gracePeriod(subscription)
  INPUT: subscription — a subscriptions row
  OUTPUT: boolean
  // Bug: past_due immediately triggers paywall with no grace period
  // Note: canceled status does NOT get a grace period — deliberate cancellation is immediate
  RETURN subscription.status = "past_due"
     AND now() <= subscription.current_period_end + INTERVAL '3 days'
     AND isExpiredFlagSet(subscription.restaurant_id) = true
END FUNCTION

// Fix Checking — grace period respected for past_due only
FOR ALL subscriptions WHERE isBugCondition_QW7_gracePeriod(subscription) DO
  ASSERT isExpired(subscription) = false  // still has access during grace window
END FOR

// Fix Checking — canceled is immediately expired (no grace period)
FOR ALL subscriptions WHERE subscription.status = "canceled" DO
  ASSERT isExpired(subscription) = true
END FOR

// Preservation Checking — monthly pricing unchanged
FOR ALL checkoutRequests WHERE NOT request.plan.endsWith("_yearly") DO
  ASSERT chargedAmount = plans[basePlanId].monthly_paise
END FOR
```

### QW-4 — Item Name Not Snapshotted / No Soft Delete

```pascal
FUNCTION isBugCondition_QW4_name(orderItem)
  INPUT: orderItem — a row in order_items
  OUTPUT: boolean
  // Bug exists when the name column is absent and the joined menu_item is gone/renamed
  RETURN orderItem.name IS NULL AND menuItems[orderItem.menu_item_id].name != originalNameAtOrderTime
END FUNCTION

// Fix Checking — name snapshot
FOR ALL newOrders DO
  FOR ALL items IN newOrder.order_items DO
    ASSERT items.name = menuItems[items.menu_item_id].name  // captured at insert time
  END FOR
END FOR

// Fix Checking — deleteMenuItem() performs soft delete, not hard delete
FOR ALL calls TO deleteMenuItem(itemId) DO
  ASSERT menuItems[itemId].deleted_at IS NOT NULL  // row updated, not removed
  ASSERT NOT rowDeletedFromTable(menuItems, itemId) // hard DELETE never issued
END FOR

// Fix Checking — archived items hidden from active menu
FOR ALL menuFetches WHERE context = "customer_ordering" OR context = "manager_active_list" DO
  ASSERT ALL items IN result HAVE deleted_at IS NULL
END FOR

// Fix Checking — top_selling_items view uses snapshotted name
FOR ALL analyticsQueries USING top_selling_items DO
  ASSERT itemName = order_items.name  // not menu_items.name
END FOR

// Preservation Checking — active items unaffected
FOR ALL menuItems WHERE deleted_at IS NULL DO
  ASSERT visibleToCustomers(item) = true
  ASSERT visibleInMenuManager(item) = true
END FOR
```
