# Quick Wins Bugfix Design

## Overview

This document formalizes the design for 12 high-impact, low-effort fixes in the `qr-order` Next.js + Supabase restaurant QR ordering application. The bugs span four categories:

- **Security**: Client-supplied prices accepted (QW-2), no webhook replay protection (QW-5), plan limits enforced only client-side (QW-10)
- **Reliability**: Cron jobs never scheduled (QW-1), non-atomic order creation (QW-11), inactive webhook endpoints still retried (QW-9)
- **Data integrity**: Item names not snapshotted on order_items (QW-4), "free" plan misnomer throughout schema and code (QW-10), yearly price stored as per-month equivalent instead of annual total (QW-7)
- **Observability / UX**: No health endpoint (QW-3), no quantity validation (QW-6), no subscription expiry warning (QW-7), no error boundaries (QW-8), no error monitoring (QW-12)

**Critical coupling**: QW-2 (server-side prices), QW-4 (name snapshot), and QW-11 (atomic order creation) are tightly coupled and must be implemented together as a single `place_order_atomic` Postgres RPC. Implementing any one of them as a patch to the existing 3-step flow and then replacing that flow would discard the patch.

The fix strategy is: minimal, targeted changes that address each bug condition without altering unaffected code paths. Every fix is validated by a two-phase testing approach — first surface counterexamples on unfixed code, then verify the fix and confirm preservation.

---

## Glossary

- **Bug_Condition (C)**: The specific input or state that triggers a defect — formally expressed as `isBugCondition(input)` returning `true`
- **Property (P)**: The desired correct behavior when the bug condition holds — expressed as `expectedBehavior(result)` returning `true`
- **Preservation**: Existing correct behavior for inputs where the bug condition does NOT hold — must be unchanged by the fix
- **F**: The original (unfixed) function or code path
- **F'**: The fixed function or code path
- **Counterexample**: A concrete input that demonstrates the bug on unfixed code
- **`place_order_atomic`**: New Postgres RPC that atomically handles order creation, server-side price fetching, and name snapshotting (QW-2 + QW-4 + QW-11)
- **`isBugCondition_QWn`**: Pseudocode predicate identifying inputs that trigger bug QW-n
- **`deleted_at`**: Soft-delete timestamp column to be added to `menu_items`; `NULL` means active, non-NULL means archived
- **`reminder_sent_at`**: JSONB column on `subscriptions` tracking which reminder milestones (7d, 3d, 0d) have been sent this cycle
- **`trialing`**: The correct plan value for restaurants on a free trial — replaces the misnomer `'free'` throughout the schema and codebase
- **`get_restaurant_plan()`**: SECURITY DEFINER Postgres function, granted to anon, returns the current plan for a restaurant
- **`get_plan_limits()`**: Postgres function, granted to anon, returns plan limits JSON for a given plan string
- **`get_initial_order_status()`**: SECURITY DEFINER Postgres function, returns `'pending'` or `'pending_waiter'` based on restaurant routing mode
- **`retryDelivery()`**: TypeScript function in `lib/webhooks.ts` that retries a failed webhook delivery
- **`verifyWebhookSignature()`**: New utility function in `lib/webhooks.ts` for webhook consumers to verify incoming requests
- **Grace period**: 3-day window after `current_period_end` during which `past_due` subscriptions retain Pro access before the paywall activates


---

## Bug Details

### QW-1 — Cron Jobs Never Scheduled

**Bug Condition**: `vercel.json` contains only `{}` — no `crons` key. Neither `/api/cron/audit-log-purge` nor `/api/cron/webhook-retries` is ever triggered by Vercel's scheduler. The `pg_cron` extension (v1.6.4) is already installed and active in Supabase with 2 existing jobs, making it the preferred scheduling mechanism for DB-level tasks.

```
FUNCTION isBugCondition_QW1(config)
  INPUT: config — contents of vercel.json
  OUTPUT: boolean
  RETURN NOT config.hasKey("crons")
END FUNCTION
```

**Examples**:
- `vercel.json = {}` → `purge_expired_audit_logs()` never runs → audit log table grows unbounded
- `vercel.json = {}` → webhook retry queue never drains → failed deliveries stay in `retrying` state forever
- After adding `crons` to `vercel.json` → Vercel triggers `/api/cron/audit-log-purge` daily at 02:00 UTC
- `pg_cron` job `SELECT public.purge_expired_audit_logs()` scheduled at `0 2 * * *` → runs inside Postgres with no Vercel plan dependency

---

### QW-2 — Client-Supplied Prices Accepted

**Bug Condition**: `POST /api/orders` passes `item.price` from the request body directly as `base_price` to `calculate_item_prices_batch()`. The actual price from `menu_items` is never fetched server-side.

```
FUNCTION isBugCondition_QW2(request)
  INPUT: request — POST /api/orders body
  OUTPUT: boolean
  RETURN request.items.any(item =>
    item.price != menuItems[item.menu_item_id].price
  )
END FUNCTION
```

**Examples**:
- `{ menu_item_id: "abc", price: 0, quantity: 1 }` → order item inserted at ₹0
- `{ menu_item_id: "abc", price: 999999, quantity: 1 }` → order item inserted at ₹9,99,999
- Correct request with `price: 150` matching DB → order created normally (preserved)

**Note**: This bug is fixed as part of `place_order_atomic` (QW-11), which fetches prices from `menu_items` inside the RPC.

---

### QW-3 — No Health Check Endpoint

**Bug Condition**: No route exists at `/api/health`. Uptime monitors, load balancers, and deployment pipelines receive 404.

```
FUNCTION isBugCondition_QW3(request)
  INPUT: request — GET /api/health
  OUTPUT: boolean
  RETURN routeDoesNotExist("/api/health")
END FUNCTION
```

**Examples**:
- `GET /api/health` → 404 Not Found (bug)
- After fix: `GET /api/health` with Supabase reachable → `{ status: "ok", db: "ok", timestamp: "..." }` with HTTP 200
- After fix: `GET /api/health` with Supabase unreachable → `{ status: "error", db: "error", timestamp: "..." }` with HTTP 503

---

### QW-4 — Item Names Not Snapshotted; Menu Items Hard-Deleted

**Bug Condition A (name)**: `order_items` has no `name` column. Historical orders display the current name from `menu_items` via JOIN, which changes when items are renamed or becomes unavailable when items are deleted.

**Bug Condition B (delete)**: `deleteMenuItem()` in `lib/api.ts` issues a hard `DELETE`. If the item has order history, the FK constraint (`ON DELETE RESTRICT` on `order_items.menu_item_id`) blocks deletion with an error. No soft-delete mechanism exists.

**Bug Condition C (filter gaps)**: When `deleted_at` is added, `getMenuItems()` and `getAllMenuItems()` have no `deleted_at IS NULL` filter. The two public SELECT RLS policies use `USING (is_available = true)` with no `deleted_at` check. The existing index `(restaurant_id, is_available)` does not cover `deleted_at`.

```
FUNCTION isBugCondition_QW4_name(orderItem)
  INPUT: orderItem — a row in order_items
  OUTPUT: boolean
  RETURN orderItem.name IS NULL
     AND menuItems[orderItem.menu_item_id].name != originalNameAtOrderTime
END FUNCTION

FUNCTION isBugCondition_QW4_delete(itemId)
  INPUT: itemId — a menu_items row id
  OUTPUT: boolean
  RETURN deleteMenuItem(itemId) ISSUES hard DELETE
     AND NOT softDeleteSupported()
END FUNCTION
```

**Examples**:
- Item "Paneer Tikka" renamed to "Paneer Masala" → historical orders now show "Paneer Masala" (wrong)
- Item deleted after orders exist → FK error, deletion blocked, no graceful alternative
- After fix: new orders capture `name = "Paneer Tikka"` at insert time; rename doesn't affect history
- After fix: `deleteMenuItem()` sets `deleted_at = now()`, item hidden from customer menu, archived section shows it with Restore button

---

### QW-5 — Webhook Timestamp Not Validated (Replay Attack)

**Bug Condition**: `lib/webhooks.ts` adds `X-Webhook-Timestamp` to outgoing requests via `signPayload()`, but no `verifyWebhookSignature()` utility exists for consumers to check timestamp freshness. A captured valid request can be replayed indefinitely.

```
FUNCTION isBugCondition_QW5(headers)
  INPUT: headers — incoming webhook request headers
  OUTPUT: boolean
  RETURN abs(now() - parseISO(headers["X-Webhook-Timestamp"])) > 300 seconds
     AND noTimestampValidationPerformed()
END FUNCTION
```

**Examples**:
- Attacker replays a captured `order.placed` webhook 10 minutes later → accepted (bug)
- After fix: `verifyWebhookSignature(secret, body, headers)` returns `{ valid: false, reason: "Timestamp too old" }` for requests > 5 minutes old
- Fresh request with valid signature and recent timestamp → `{ valid: true }` (preserved)

---

### QW-6 — No Server-Side Quantity Validation

**Bug Condition**: `POST /api/orders` does not validate `item.quantity`. Zero, negative, non-integer, and excessively large quantities are passed through to the database.

```
FUNCTION isBugCondition_QW6(item)
  INPUT: item — order item from request body
  OUTPUT: boolean
  RETURN NOT isInteger(item.quantity)
      OR item.quantity < 1
      OR item.quantity > 99
END FUNCTION
```

**Examples**:
- `{ quantity: 0 }` → order item with zero quantity inserted (bug)
- `{ quantity: -5 }` → negative quantity inserted (bug)
- `{ quantity: 1.5 }` → non-integer quantity inserted (bug)
- `{ quantity: 1000 }` → no upper-bound check (bug)
- After fix: any of the above → HTTP 400 with descriptive message, no rows inserted
- `{ quantity: 3 }` → valid, order created normally (preserved)

---

### QW-7 — Yearly Price Undercharge, Missing Renewal Reminders, Incorrect Labels

**Bug Condition A (price)**: `plans.yearly_paise` stores the per-month equivalent (79900 = ₹799) instead of the full annual charge. PhonePe charges this amount for a full year, resulting in a ~92% undercharge.

**Bug Condition B (savings badge)**: `BillingPanel.tsx` calculates savings as `Math.round((1 - proYearlyPaise / proMonthlyPaise) * 100)`. After fixing `yearly_paise` from 79900 → 958800, this formula produces a large negative number.

**Bug Condition C (no reminder)**: No in-app warning is shown when `current_period_end` is within 7 days. No `reminder_sent_at` tracking exists on `subscriptions`.

**Bug Condition D (grace period)**: `useSubscription.ts` treats `past_due` as immediately expired (`isExpired = true`), with no 3-day grace period.

**Bug Condition E (labels)**: `BillingPanel.tsx` shows "Free" for trialing users in the Current Plan section. The yearly CTA shows `/mo` implying recurring billing when PhonePe charges the full annual amount upfront.

```
FUNCTION isBugCondition_QW7_yearlyPrice(plan)
  INPUT: plan — a row from the plans table
  OUTPUT: boolean
  RETURN plan.yearly_paise < (plan.monthly_paise * 9)
END FUNCTION

FUNCTION isBugCondition_QW7_gracePeriod(subscription)
  INPUT: subscription — a subscriptions row
  OUTPUT: boolean
  RETURN subscription.status = "past_due"
     AND now() <= subscription.current_period_end + INTERVAL '3 days'
     AND isExpiredFlagSet(subscription.restaurant_id) = true
END FUNCTION
```

**Examples**:
- Manager selects yearly Pro → charged ₹799 for a full year instead of ₹9,588 (bug)
- After price fix: savings badge shows `Math.round((1 - (958800/12) / 99900) * 100)` = 20% (correct)
- `past_due` subscription, 1 day after `current_period_end` → paywall shown immediately (bug)
- After grace period fix: paywall only activates after `current_period_end + 3 days`
- `canceled` subscription → paywall shown immediately (correct, no grace period for cancellations)

---

### QW-8 — No React Error Boundaries

**Bug Condition**: None of the 12 tab components in `ManagerClient.tsx` are wrapped in an `ErrorBoundary`. A rendering error in any one section crashes the entire manager dashboard.

```
FUNCTION isBugCondition_QW8(component)
  INPUT: component — a React component rendered in ManagerClient.tsx
  OUTPUT: boolean
  RETURN component.throwsRenderError()
     AND NOT wrappedInErrorBoundary(component)
END FUNCTION
```

**Examples**:
- `Analytics` throws during render due to malformed data → entire dashboard goes blank (bug)
- After fix: `Analytics` error is caught by its `ErrorBoundary`, shows section-level fallback, all other tabs remain functional
- `MenuManager` renders normally → no change in behavior (preserved)

---

### QW-9 — Inactive Webhook Endpoints Still Retried

**Bug Condition**: `retryDelivery()` in `lib/webhooks.ts` fetches `endpoint.is_active` but never checks it before calling `dispatchToUrl()`. Inactive endpoints receive HTTP requests on every retry.

```
FUNCTION isBugCondition_QW9(delivery)
  INPUT: delivery — webhook delivery record with joined endpoint
  OUTPUT: boolean
  RETURN delivery.endpoint.is_active = false
END FUNCTION
```

**Examples**:
- Endpoint disabled by manager → `retryDelivery()` still dispatches HTTP request (bug)
- Endpoint auto-disabled after 10 failures → next cron run still dispatches (bug)
- After fix: `is_active = false` → delivery marked `dead`, no HTTP dispatch, early return
- `is_active = true` → retry proceeds normally (preserved)

---

### QW-10 — Plan Limits Enforced Only Client-Side; "Free" Plan Misnomer

**Bug Condition A (limits)**: `createTable()` and `createMenuItem()` in `lib/api.ts` perform no plan limit check. A manager who bypasses the UI (or uses the Supabase client directly) can exceed trial limits.

**Bug Condition B (misnomer)**: The `subscriptions` table uses `plan = 'free'` as a default/pending state, but no "free plan" product exists. Trial restaurants have `plan = 'pro', status = 'trialing'`. The 2 abandoned checkout rows have `plan = 'free'`. The `get_plan_limits()` function has a `WHEN 'free'` branch. `useSubscription.ts` falls back to `{ plan: "free" }`. UI strings say "Free plan limit reached".

```
FUNCTION isBugCondition_QW10_tables(restaurantId)
  INPUT: restaurantId
  OUTPUT: boolean
  RETURN currentTableCount(restaurantId) >= get_plan_limits(
           get_restaurant_plan(restaurantId)
         ).max_tables
END FUNCTION

FUNCTION isBugCondition_QW10_misnomer(value)
  INPUT: value — any plan string, UI label, or DB value
  OUTPUT: boolean
  RETURN value = "free" OR value CONTAINS "Free plan"
END FUNCTION
```

**Examples**:
- Trial restaurant at 5 tables calls `createTable()` via Supabase client directly → 6th table created (bug)
- After fix: `createTable()` calls `get_restaurant_plan()` + `get_plan_limits()`, returns error if at limit
- `subscriptions` row with `plan = 'free'` → `get_plan_limits('free')` falls to ELSE clause (bug)
- After fix: `plan = 'trialing'`, `get_plan_limits('trialing')` returns `{ max_tables: 5, max_menu_items: 20 }`
- Pro restaurant at 3 tables → `createTable()` succeeds (preserved)

---

### QW-11 — Non-Atomic Order Creation (Combined with QW-2 and QW-4)

**Bug Condition**: The 3-step order creation flow in `/api/orders/route.ts` is not atomic. If `order_items` INSERT (step 3) fails after `orders` INSERT (step 1) succeeds, an orphaned `orders` row is left with no items. Similarly, if `calculate_item_prices_batch()` (step 2) fails after step 1, the order row may be orphaned.

```
FUNCTION isBugCondition_QW11(orderCreation)
  INPUT: orderCreation — execution of the 3-step order creation flow
  OUTPUT: boolean
  RETURN orderCreation.step3_failed = true
     AND orderCreation.step1_succeeded = true
END FUNCTION
```

**Examples**:
- `order_items` INSERT fails due to FK violation → orphaned `orders` row, customer sees 500 error, DB has partial data (bug)
- After fix: `place_order_atomic` RPC wraps all steps in one transaction → failure at any step rolls back everything, no orphaned rows
- Valid order with all items → `place_order_atomic` returns order id, all items inserted with name snapshot and server-side prices (preserved)

---

### QW-12 — No Error Monitoring

**Bug Condition**: No external error monitoring service is configured. Unhandled exceptions in API routes and client components are invisible to the development team.

```
FUNCTION isBugCondition_QW12(exception)
  INPUT: exception — any unhandled error
  OUTPUT: boolean
  RETURN NOT reportedToExternalMonitoring(exception)
END FUNCTION
```

**Examples**:
- API route throws unhandled exception → logged to Vercel console only, no alert, no context (bug)
- After fix: Sentry captures exception with route, user, and restaurant context


---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A valid `POST /api/orders` request with correct item ids and quantities SHALL continue to create the order and return the order id
- A webhook delivery that succeeds on the first attempt SHALL continue to be marked `success` with `failure_count` reset to 0
- A webhook endpoint with `is_active = true` and a delivery due for retry SHALL continue to have the HTTP request dispatched
- A manager's dashboard SHALL continue to render normally when no rendering errors occur
- A Pro-plan manager creating a table or menu item below the plan limit SHALL continue to be allowed without a plan limit error
- Cron routes called with a valid `Authorization` header SHALL continue to execute their handlers and return 200
- Cron routes called without a valid secret SHALL continue to return 401 Unauthorized
- `order_items` rows SHALL continue to store `menu_item_id`, `quantity`, and `price` alongside the new `name` column
- A webhook receiver processing a request with a valid, recent timestamp and correct signature SHALL continue to accept it
- Menu items with `deleted_at IS NULL` SHALL continue to appear on the customer ordering page and in MenuManager exactly as before
- A manager on a monthly Pro plan renewing SHALL continue to be charged `monthly_paise` (99900 = ₹999) — monthly price is correct and unchanged
- A restaurant on an active Pro subscription SHALL be unaffected by the `'free'` → `'trialing'` schema migration — Pro restaurants have `plan = 'pro'`
- A subscription with `status = 'past_due'` and `now() <= current_period_end + 3 days` SHALL continue to grant Pro access during the grace period
- A manager on a trial plan with fewer than 5 tables SHALL continue to be allowed to create tables — the limit check only blocks at or above the limit
- The `menu_items` "Managers can manage menu items" FOR ALL RLS policy SHALL remain unchanged — managers need unrestricted read access to see archived items
- Existing `reminder_sent_at` behavior is additive — existing subscription rows get `'{}'` by default, no existing functionality is affected

**Scope:**
All inputs that do NOT match the bug conditions above are completely unaffected by these fixes. Specifically:
- Orders placed with correct client-supplied prices (matching DB) continue to work — the RPC fetches from DB and the result is the same
- Webhook retries for active endpoints continue to dispatch normally
- Dashboard tabs that render without errors continue to render without any error boundary overhead visible to the user
- Plan limit checks only add a pre-flight RPC call; the actual insert path is unchanged for users within limits


---

## Hypothesized Root Cause

### QW-1 — Cron Jobs Never Scheduled
1. **Missing `vercel.json` configuration**: `vercel.json` is `{}` — the `crons` array was never added. The API route handlers exist (`/api/cron/audit-log-purge`, `/api/cron/webhook-retries`) but are never triggered.
2. **No pg_cron job for audit purge**: `purge_expired_audit_logs()` exists in Postgres but was never scheduled via `cron.schedule()`.
3. **pg_net not installed**: Scheduling the webhook-retries Edge Function via pg_cron requires `pg_net` for HTTP calls, which is not installed. The Vercel cron fallback is the pragmatic path for webhook retries.

### QW-2 — Client-Supplied Prices
1. **Trust of client input**: The original `placeOrder()` in `lib/api.ts` and the `/api/orders/route.ts` handler both pass `item.price` from the request body directly as `base_price` to `calculate_item_prices_batch()`. No server-side price lookup was ever implemented.
2. **Architectural gap**: The price fetch was intended to happen client-side (from the menu page), but the API route never validates that the submitted prices match the database.

### QW-3 — No Health Endpoint
1. **Never implemented**: No `/api/health` route was created. This is a missing feature, not a regression.

### QW-4 — Name Not Snapshotted; No Soft Delete
1. **Schema omission**: `order_items` was designed with only `menu_item_id` (FK), `quantity`, and `price`. A `name` column was never added.
2. **Hard delete only**: `deleteMenuItem()` issues a hard `DELETE`. The FK constraint `ON DELETE RESTRICT` on `order_items.menu_item_id` blocks deletion of items with order history, but no soft-delete alternative was provided.
3. **Filter gaps**: `getMenuItems()` and `getAllMenuItems()` filter only on `is_available` — when `deleted_at` is added, these queries need an additional `.is('deleted_at', null)` filter.
4. **RLS gap**: The two public SELECT policies use `USING (is_available = true)` — they need `AND deleted_at IS NULL` to prevent archived items from being readable by anon users who query by ID.

### QW-5 — No Timestamp Validation
1. **Sender-only implementation**: `signPayload()` adds `X-Webhook-Timestamp` to outgoing requests, but no `verifyWebhookSignature()` utility was provided for consumers. The timestamp is present but never checked on the receiving end.

### QW-6 — No Quantity Validation
1. **Missing input validation**: `/api/orders/route.ts` validates `restaurantId`, `tableId`, and `items` array presence, and validates `partySize`, but never validates individual item `quantity` values.

### QW-7 — Yearly Price / Reminders / Labels
1. **Yearly price stored as per-month equivalent**: `plans.yearly_paise = 79900` was set as the per-month equivalent (₹799/mo), not the full annual charge (₹9,588). PhonePe charges the stored value as a one-time payment.
2. **Savings formula uses raw yearly_paise**: `Math.round((1 - proYearlyPaise / proMonthlyPaise) * 100)` compares the full annual amount to the monthly amount — after the price fix this produces a large negative number. The correct formula divides `yearly_paise` by 12 first.
3. **No reminder infrastructure**: No `reminder_sent_at` column exists on `subscriptions`. No Edge Function or cron job queries for expiring subscriptions.
4. **Grace period not implemented**: `useSubscription.ts` treats `past_due` as immediately expired. The 3-day grace period was never coded.
5. **"Free" label**: `BillingPanel.tsx` hardcodes `<span>Free</span>` for trialing users. The `isTrial` branch was not updated when the trial concept was introduced.

### QW-8 — No Error Boundaries
1. **Never implemented**: `ManagerClient.tsx` renders all 12 tab components directly without any `ErrorBoundary` wrapper. React class-based error boundaries were never added to the project.

### QW-9 — Inactive Endpoints Retried
1. **Missing guard**: `retryDelivery()` fetches `endpoint.is_active` in the SELECT query but never checks its value before calling `dispatchToUrl()`. The check was likely intended but omitted.

### QW-10 — Client-Side-Only Plan Limits; "Free" Misnomer
1. **UI-only enforcement**: Plan limit checks in `MenuManager.tsx` and `TablesManager.tsx` use `useSubscription` to gate the "Add" button. The underlying `createTable()` and `createMenuItem()` functions in `lib/api.ts` have no server-side check.
2. **Schema design artifact**: `plan = 'free'` was used as a default/pending state before the trial concept was fully designed. The correct model is `plan = 'pro', status = 'trialing'` for trial restaurants, but the `'free'` value was never cleaned up from the schema, functions, or UI strings.

### QW-11 — Non-Atomic Order Creation
1. **Sequential multi-step flow**: The order creation in `/api/orders/route.ts` performs three separate Supabase calls: INSERT orders, RPC calculate_item_prices_batch, INSERT order_items. Each step can fail independently, leaving partial data.
2. **No transaction wrapper**: The Next.js API route cannot wrap multiple Supabase calls in a single Postgres transaction. A Postgres RPC is required for atomicity.

### QW-12 — No Error Monitoring
1. **Never configured**: Sentry (or equivalent) was never added to the project. `@sentry/nextjs` is not in `package.json`.


---

## Correctness Properties

Property 1: Bug Condition — Atomic Order Creation with Server-Side Prices and Name Snapshot (QW-2 + QW-4 + QW-11)

_For any_ order creation request where the bug condition holds (client-supplied prices differ from DB prices, OR the 3-step flow would leave an orphaned row on failure), the fixed `place_order_atomic` RPC SHALL: (a) fetch actual prices from `menu_items` server-side, (b) snapshot item names at insert time, (c) execute all inserts in a single atomic transaction so that failure at any step leaves no orphaned rows, and (d) return the new order id on success.

**Validates: Requirements 2.3, 2.4, 4.1, 4.2, 11.1, 11.2, 11.3**

---

Property 2: Preservation — Valid Orders Unaffected by Atomicity Fix (QW-11)

_For any_ order creation request where the bug condition does NOT hold (all items exist in DB, no step fails), the fixed `place_order_atomic` RPC SHALL produce the same observable result as the original 3-step flow: an order id is returned, `orders` and `order_items` rows are created with correct prices and quantities.

**Validates: Requirements 3.1, 3.11**

---

Property 3: Bug Condition — Inactive Webhook Endpoints Not Retried (QW-9)

_For any_ call to `retryDelivery(deliveryId)` where `endpoint.is_active = false` (isBugCondition_QW9 returns true), the fixed function SHALL mark the delivery status as `dead`, skip the HTTP dispatch entirely, and return early without calling `dispatchToUrl()`.

**Validates: Requirements 9.1**

---

Property 4: Preservation — Active Endpoint Retry Behavior Unchanged (QW-9)

_For any_ call to `retryDelivery(deliveryId)` where `endpoint.is_active = true` (isBugCondition_QW9 returns false), the fixed function SHALL produce exactly the same behavior as the original function: dispatch the HTTP request, update the delivery record, and update endpoint stats.

**Validates: Requirements 3.2, 3.3**

---

Property 5: Bug Condition — Plan Limits Enforced Server-Side (QW-10)

_For any_ call to `createTable()` or `createMenuItem()` in `lib/api.ts` where the restaurant is at or above its plan limit (isBugCondition_QW10_tables/items returns true), the fixed function SHALL return an error and perform no database insert, regardless of whether the caller bypasses the UI.

**Validates: Requirements 10.1, 10.2**

---

Property 6: Preservation — Pro-Plan and Below-Limit Creation Unaffected (QW-10)

_For any_ call to `createTable()` or `createMenuItem()` where the restaurant is below its plan limit (isBugCondition_QW10 returns false), the fixed function SHALL produce the same result as the original: the row is created and the new record is returned.

**Validates: Requirements 3.7, 3.8, 3.20**

---

Property 7: Bug Condition — Quantity Validation Rejects Invalid Items (QW-6)

_For any_ `POST /api/orders` request containing at least one item where `quantity` is not an integer, is less than 1, or is greater than 99 (isBugCondition_QW6 returns true), the fixed handler SHALL return HTTP 400 with a descriptive error message and insert no rows into `orders` or `order_items`.

**Validates: Requirements 6.1**

---

Property 8: Preservation — Valid Quantities Pass Through Unchanged (QW-6)

_For any_ `POST /api/orders` request where all item quantities are integers in [1, 99] (isBugCondition_QW6 returns false for all items), the fixed handler SHALL produce the same result as the original: the order is created and the order id is returned.

**Validates: Requirements 3.1**

---

Property 9: Bug Condition — Soft Delete Replaces Hard Delete (QW-4)

_For any_ call to `deleteMenuItem(itemId)` (isBugCondition_QW4_delete returns true), the fixed function SHALL perform a soft delete (UPDATE `deleted_at = now()`) instead of a hard DELETE, leaving the row in the table with `deleted_at IS NOT NULL`.

**Validates: Requirements 4.3, 4.7**

---

Property 10: Preservation — Active Menu Items Unaffected by Soft Delete (QW-4)

_For any_ menu item where `deleted_at IS NULL`, the fixed `getMenuItems()` and `getAllMenuItems()` functions SHALL continue to return that item exactly as before — the `deleted_at IS NULL` filter is additive and does not change results for active items.

**Validates: Requirements 3.13, 3.19**

---

Property 11: Bug Condition — Yearly Price Corrected (QW-7)

_For any_ plan row where `yearly_paise < monthly_paise * 9` (isBugCondition_QW7_yearlyPrice returns true), the fixed migration SHALL update `yearly_paise` to the full annual charge: Pro from 79900 → 958800, Business from 159900 → 1918800.

**Validates: Requirements 7.2, 7.3**

---

Property 12: Preservation — Monthly Pricing Unchanged (QW-7)

_For any_ checkout request that does NOT use yearly billing (isBugCondition_QW7_yearlyPrice does not apply), the fixed code SHALL charge `monthly_paise` unchanged (99900 = ₹999 for Pro).

**Validates: Requirements 3.15, 3.16**

---

Property 13: Bug Condition — Grace Period for past_due Subscriptions (QW-7)

_For any_ subscription where `status = 'past_due'` AND `now() <= current_period_end + 3 days` (isBugCondition_QW7_gracePeriod returns true), the fixed `isExpired` derivation in `useSubscription.ts` SHALL return `false`, granting continued Pro access during the grace window.

**Validates: Requirements 7.9, 3.18**

---

Property 14: Preservation — Canceled Subscriptions Immediately Expired (QW-7)

_For any_ subscription where `status = 'canceled'`, the fixed `isExpired` derivation SHALL return `true` immediately — no grace period applies to deliberate cancellations.

**Validates: Requirements 7.9**

---

Property 15: Bug Condition — "trialing" Replaces "free" Throughout (QW-10)

_For any_ location in the schema, functions, TypeScript types, or UI strings where `'free'` or `"Free plan"` appears as a plan value or label (isBugCondition_QW10_misnomer returns true), the fix SHALL replace it with `'trialing'` / `"Trial"` / `"Trial limit"` as appropriate.

**Validates: Requirements 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.10**

---

Property 16: Preservation — Pro Subscriptions Unaffected by Plan Rename (QW-10)

_For any_ subscription row where `plan = 'pro'`, the migration SHALL leave the row unchanged. The `isPro` derivation in `useSubscription.ts` (`plan === "pro" && (isActive || isTrial)`) SHALL continue to work correctly.

**Validates: Requirements 3.17, 10.12**


---

## Fix Implementation

### Changes Required

#### QW-1 — Schedule Cron Jobs

**File**: `vercel.json`
**Specific Changes**:
1. Add `crons` array with two entries: `{ "path": "/api/cron/audit-log-purge", "schedule": "0 2 * * *" }` and `{ "path": "/api/cron/webhook-retries", "schedule": "*/5 * * * *" }` (every 5 minutes — Vercel Hobby allows daily; Pro allows more frequent; adjust to plan)

**File**: New Supabase migration
**Specific Changes**:
1. Schedule `purge_expired_audit_logs()` via pg_cron: `SELECT cron.schedule('audit-log-purge', '0 2 * * *', 'SELECT public.purge_expired_audit_logs()')` — runs entirely inside Postgres, no Vercel dependency

**Note on webhook-retries**: `pg_net` is not installed. The Vercel cron fallback (`/api/cron/webhook-retries`) is the pragmatic path. The existing route handler already contains the retry logic. The `vercel.json` entry is sufficient.

---

#### QW-2 + QW-4 + QW-11 — Atomic Order Creation (Combined)

**File**: New Supabase migration — `place_order_atomic` RPC
**Specific Changes**:
1. Create `place_order_atomic(p_restaurant_id UUID, p_table_id UUID, p_items JSONB, p_customer_name TEXT, p_customer_phone TEXT, p_party_size INT)` as `SECURITY INVOKER` (RLS applies)
2. Inside the function: call `get_initial_order_status(p_restaurant_id)` to derive order status
3. Fetch actual prices from `menu_items WHERE id = ANY(item_ids) AND restaurant_id = p_restaurant_id` — reject with EXCEPTION if any item not found
4. Fetch floor price multiplier from `tables → floors`
5. INSERT `orders` row with derived status
6. INSERT `order_items` rows with `name` snapshot from step 3 and server-side prices from steps 3–4
7. Return the new order id
8. All steps run in one implicit transaction — any failure rolls back everything

**File**: `app/api/orders/route.ts`
**Specific Changes**:
1. Remove the 3-step order creation flow (INSERT orders, RPC calculate_item_prices_batch, INSERT order_items)
2. Remove the routing mode fetch (now handled inside RPC)
3. Replace with single `supabase.rpc('place_order_atomic', { p_restaurant_id, p_table_id, p_items: JSON.stringify(items.map(i => ({ menu_item_id, quantity }))), p_customer_name, p_customer_phone, p_party_size })`
4. Keep all pre-checks: rate limiting, party size validation, quantity validation (QW-6), `check_table_has_unpaid_orders`
5. Deprecate `calculate_item_prices_batch()` — document as unused but do not delete

---

#### QW-3 — Health Endpoint

**File**: `app/api/health/route.ts` (new)
**Specific Changes**:
1. Create GET handler
2. Attempt a lightweight Supabase query (e.g., `supabase.from('restaurants').select('id').limit(1)`)
3. Return `{ status: "ok", db: "ok", timestamp: new Date().toISOString() }` with HTTP 200 on success
4. Return `{ status: "error", db: "error", timestamp: new Date().toISOString() }` with HTTP 503 on failure

---

#### QW-4 — Soft Delete + Name Snapshot + Filter Gaps

**File**: New Supabase migration
**Specific Changes**:
1. `ALTER TABLE menu_items ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL`
2. `CREATE INDEX menu_items_active_idx ON public.menu_items (restaurant_id, is_available) WHERE deleted_at IS NULL`
3. Update "Public can read available menu items" RLS policy: `USING (is_available = true AND deleted_at IS NULL)`
4. Update "Anyone can read available menu items" RLS policy: `USING (is_available = true AND deleted_at IS NULL)`
5. Add `name TEXT` column to `order_items` (nullable for backward compat with existing rows)
6. Update `top_selling_items` view to use `COALESCE(oi.name, mi.name) AS item_name` — prefers snapshot, falls back to current name for pre-fix orders

**File**: `lib/api.ts`
**Specific Changes**:
1. `getMenuItems()`: add `.is('deleted_at', null)` filter
2. `getAllMenuItems()`: add `.is('deleted_at', null)` filter
3. `deleteMenuItem()`: replace hard DELETE with `UPDATE SET deleted_at = now()` — keep webhook and audit log calls, update event to `menu.item_archived`
4. Add `getArchivedMenuItems(restaurantId)`: query `WHERE deleted_at IS NOT NULL`
5. Add `restoreMenuItem(itemId)`: `UPDATE SET deleted_at = null`

**File**: `types/database.ts`
**Specific Changes**:
1. Add `deleted_at: string | null` to `MenuItem` type
2. Update `Database.public.Tables.menu_items.Row` to include `deleted_at`

**File**: `components/manager/MenuManager.tsx`
**Specific Changes**:
1. Add "Archived Items" collapsible section below the active items table
2. Fetch archived items via `getArchivedMenuItems(restaurantId)`
3. Add "Restore" button per row that calls `restoreMenuItem(itemId)` and reloads

---

#### QW-5 — Webhook Signature Verification Utility

**File**: `lib/webhooks.ts`
**Specific Changes**:
1. Add `verifyWebhookSignature(secret: string, body: string, headers: Record<string, string>): Promise<{ valid: boolean; reason?: string }>` function
2. Check `X-Webhook-Timestamp` presence; return `{ valid: false, reason: "Missing timestamp" }` if absent
3. Parse timestamp, compute age in seconds; return `{ valid: false, reason: "Timestamp too old or too far in future" }` if `|age| > 300`
4. Compute expected HMAC-SHA256 signature using `signPayload(secret, body, timestamp)`
5. Compare to `X-Webhook-Signature` header (strip `sha256=` prefix); return `{ valid: false, reason: "Invalid signature" }` on mismatch
6. Return `{ valid: true }` on success

---

#### QW-6 — Quantity Validation

**File**: `app/api/orders/route.ts`
**Specific Changes**:
1. After the existing `items` array check, add: `for (const item of items) { if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) { return NextResponse.json({ error: "Each item quantity must be an integer between 1 and 99" }, { status: 400 }); } }`

---

#### QW-7 — Yearly Price, Reminders, Labels, Grace Period

**File**: New Supabase migration
**Specific Changes**:
1. `UPDATE plans SET yearly_paise = 958800 WHERE id = 'pro'` (₹799/mo × 12 = ₹9,588)
2. `UPDATE plans SET yearly_paise = 1918800 WHERE id = 'business'` (₹1,599/mo × 12 = ₹19,188)
3. `ALTER TABLE subscriptions ADD COLUMN reminder_sent_at JSONB DEFAULT '{}'`

**File**: New Supabase Edge Function — `subscription-reminders`
**Specific Changes**:
1. Query `subscriptions WHERE status = 'active' AND current_period_end <= now() + INTERVAL '7 days'`
2. For each row, check `reminder_sent_at` JSONB for `'7d'`, `'3d'`, `'0d'` keys
3. Send in-app notification data (store in a notifications table or trigger Realtime broadcast)
4. Update `reminder_sent_at = jsonb_set(reminder_sent_at, '{7d}', to_jsonb(now()))` etc.
5. Schedule via Supabase dashboard (daily at 09:00 IST) or pg_cron if pg_net is enabled

**File**: `hooks/useSubscription.ts`
**Specific Changes**:
1. Update `isExpired` derivation: `past_due` only triggers expiry after grace period: `subscription?.status === "past_due" && now() > new Date(subscription.current_period_end).getTime() + 3 * 24 * 60 * 60 * 1000`
2. Change `Plan` type from `"free" | "pro"` to `"trialing" | "pro"`
3. Rename `FREE_LIMITS` to `TRIAL_LIMITS`
4. Update fallback: `{ plan: "trialing", status: "active", ... }`

**File**: `components/manager/BillingPanel.tsx`
**Specific Changes**:
1. Fix savings badge formula: `Math.round((1 - (proYearlyPaise / 12) / proMonthlyPaise) * 100)`
2. Fix yearly CTA label: show full annual amount, e.g. `"Upgrade — ₹9,588/yr"` instead of `₹799/mo`
3. Fix Current Plan price for trialing users: show `"Trial"` instead of `"Free"`
4. Add dismissible expiry warning banner: show when `isPro && !isExpired && daysUntilExpiry <= 7`, with link to Billing tab

**File**: `app/manager/[restaurant_id]/ManagerClient.tsx`
**Specific Changes**:
1. Compute `daysUntilExpiry` from `subscription.current_period_end`
2. Render dismissible banner above tab content when `isPro && !isExpired && daysUntilExpiry <= 7`

---

#### QW-8 — Error Boundaries

**File**: `components/ErrorBoundary.tsx` (new)
**Specific Changes**:
1. Create React class component `ErrorBoundary` with `componentDidCatch` and `getDerivedStateFromError`
2. Render `children` normally when no error; render section-level fallback UI with "Something went wrong" message and a "Try again" button that resets state

**File**: `app/manager/[restaurant_id]/ManagerClient.tsx`
**Specific Changes**:
1. Import `ErrorBoundary`
2. Wrap each of the 12 tab components individually: `TableSessions`, `OrderLog`, `Analytics`, `MenuManager`, `TablesManager`, `FloorsManager`, `StaffManager`, `WebhooksManager`, `BillingPanel`, `SettingsPanel`, `RestaurantDetails`, `CategoryTagManager`

---

#### QW-9 — Skip Retry for Inactive Endpoints

**File**: `lib/webhooks.ts`
**Specific Changes**:
1. In `retryDelivery()`, after fetching `ep`, add: `if (!ep.is_active) { await supabase.from("webhook_deliveries").update({ status: "dead", error_message: "Endpoint is inactive" }).eq("id", deliveryId); return { ok: false, error: "Endpoint is inactive" }; }`

---

#### QW-10 — Server-Side Plan Limits + Rename "free" to "trialing"

**File**: New Supabase migration
**Specific Changes**:
1. `ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_plan_check` (or equivalent)
2. `ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN ('trialing', 'pro'))`
3. `ALTER TABLE subscriptions ALTER COLUMN plan SET DEFAULT 'trialing'`
4. `UPDATE subscriptions SET plan = 'trialing' WHERE plan = 'free'` (migrates 2 abandoned checkout rows)
5. Update `get_plan_limits()`: rename `WHEN 'free'` → `WHEN 'trialing'`
6. Update `get_restaurant_plan()`: change `COALESCE(s.plan, 'free')` → `COALESCE(s.plan, 'trialing')` and final `RETURN COALESCE(v_plan, 'free')` → `RETURN COALESCE(v_plan, 'trialing')`

**File**: `lib/api.ts`
**Specific Changes**:
1. `createTable()`: before INSERT, call `get_restaurant_plan()` + `get_plan_limits()` RPCs; count current tables; return `null` with error log if `count >= max_tables`
2. `createMenuItem()`: same pattern with `max_menu_items`

**File**: `app/api/phonepe/checkout/route.ts`
**Specific Changes**:
1. Replace `plan = 'free', status = 'incomplete'` with `plan = 'trialing', status = 'incomplete'`

**File**: `components/manager/TablesManager.tsx`, `components/manager/MenuManager.tsx`, `components/layout/AppSidebar.tsx`
**Specific Changes**:
1. Replace all "Free plan" strings with "Trial" / "Trial limit" / "Your trial is limited to..."
2. Verify `AppSidebar.tsx` string-matching logic still works after label changes (strings must still contain "pro" or "trial" as substrings)

---

#### QW-12 — Error Monitoring

**File**: `package.json` + Sentry configuration files
**Specific Changes**:
1. Install `@sentry/nextjs` with pinned version
2. Run `npx @sentry/wizard@latest -i nextjs` or manually create `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
3. Add `SENTRY_DSN` to environment variables
4. Configure `withSentryConfig` in `next.config.js`
5. Add restaurant and user context to Sentry scope in API routes where available


---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach for each bug:
1. **Exploratory / Bug Condition Checking**: Write tests that demonstrate the bug on UNFIXED code. Run them first to confirm the root cause. If tests pass unexpectedly on unfixed code, re-examine the hypothesis.
2. **Fix Checking + Preservation Checking**: After implementing the fix, verify that (a) all buggy inputs now produce correct behavior, and (b) all non-buggy inputs continue to produce the same result as before.

Property-based testing (PBT) is used for preservation checking because it generates many test cases automatically across the input domain, catching edge cases that manual unit tests miss.

---

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each bug BEFORE implementing the fix.

**Test Cases**:

1. **QW-2 Price Manipulation** (will fail on unfixed code):
   - Submit `POST /api/orders` with `price: 0` for a menu item that costs ₹150 in DB
   - Assert: order item is inserted at ₹0 (demonstrates the bug)
   - Expected counterexample: `order_items.price = 0` when `menu_items.price = 150`

2. **QW-6 Zero Quantity** (will fail on unfixed code):
   - Submit `POST /api/orders` with `quantity: 0`
   - Assert: request returns 400 (will fail — currently returns 200 and inserts)
   - Expected counterexample: HTTP 200 with `order_items.quantity = 0`

3. **QW-9 Inactive Endpoint Retry** (will fail on unfixed code):
   - Call `retryDelivery(id)` for a delivery whose endpoint has `is_active = false`
   - Assert: no HTTP request dispatched (will fail — currently dispatches)
   - Expected counterexample: `dispatchToUrl()` called despite `is_active = false`

4. **QW-10 Plan Limit Bypass** (will fail on unfixed code):
   - Call `createTable()` directly when restaurant is at 5-table trial limit
   - Assert: returns error (will fail — currently inserts)
   - Expected counterexample: 6th table created, `tableCount = 6`

5. **QW-11 Orphaned Order** (will fail on unfixed code):
   - Mock `order_items` INSERT to fail after `orders` INSERT succeeds
   - Assert: no orphaned `orders` row (will fail — orphan is left)
   - Expected counterexample: `orders` row exists with no `order_items`

6. **QW-4 Name Drift** (will fail on unfixed code):
   - Place an order, rename the menu item, query historical order
   - Assert: `order_items` shows original name (will fail — shows new name via JOIN)
   - Expected counterexample: historical order shows renamed item name

7. **QW-7 Yearly Price** (will fail on unfixed code):
   - Query `plans WHERE id = 'pro'`
   - Assert: `yearly_paise >= monthly_paise * 9` (will fail — 79900 < 99900 * 9)
   - Expected counterexample: `yearly_paise = 79900`, `monthly_paise * 9 = 899100`

---

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the expected behavior.

```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
```

**Key fix checks**:
- `place_order_atomic` with mismatched client prices → prices in `order_items` match `menu_items`
- `place_order_atomic` with simulated step-3 failure → no orphaned `orders` row, transaction rolled back
- `place_order_atomic` → `order_items.name` equals `menu_items.name` at time of insert
- `POST /api/orders` with `quantity: 0` → HTTP 400
- `retryDelivery()` with `is_active = false` → delivery status = `"dead"`, no HTTP dispatch
- `createTable()` at trial limit → returns null/error, table count unchanged
- `get_plan_limits('trialing')` → `{ max_tables: 5, max_menu_items: 20 }`
- `plans.yearly_paise` for Pro → 958800 (≥ 99900 * 9)
- `isExpired` for `past_due` within 3 days of `current_period_end` → `false`
- `deleteMenuItem()` → `deleted_at IS NOT NULL`, row still in table
- `verifyWebhookSignature()` with timestamp > 5 minutes old → `{ valid: false }`

---

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the same result as the original.

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Key preservation checks**:

1. **Order Creation Preservation** (QW-11): Generate random valid order inputs (valid item ids, quantities 1–99, correct prices) → `place_order_atomic` returns an order id, `order_items` count matches input items count
2. **Webhook Retry Preservation** (QW-9): Generate random delivery records with `is_active = true` → `retryDelivery()` dispatches HTTP request, updates delivery record
3. **Plan Limit Preservation** (QW-10): Generate random `createTable()` calls for Pro restaurants → all succeed regardless of table count
4. **Menu Item Filter Preservation** (QW-4): Generate random active menu items (`deleted_at IS NULL`) → `getMenuItems()` and `getAllMenuItems()` return them unchanged
5. **Monthly Price Preservation** (QW-7): Monthly checkout requests → charged `monthly_paise = 99900`, unchanged
6. **Quantity Validation Preservation** (QW-6): Generate random valid quantities (integers 1–99) → orders created normally
7. **Webhook Signature Preservation** (QW-5): Generate requests with valid signatures and timestamps within 5 minutes → `verifyWebhookSignature()` returns `{ valid: true }`

---

### Unit Tests

- `verifyWebhookSignature()`: test all branches — missing timestamp, stale timestamp, future timestamp, invalid signature, valid request
- `retryDelivery()` with `is_active = false`: assert delivery marked `dead`, no HTTP call
- `createTable()` at limit: assert error returned, no DB insert
- `createMenuItem()` at limit: assert error returned, no DB insert
- `POST /api/orders` quantity validation: test `quantity = 0`, `-1`, `1.5`, `100`, `99` (valid), `1` (valid)
- `place_order_atomic` RPC: test with valid items, test with non-existent menu_item_id (should error), test with items from wrong restaurant (should error)
- `isExpired` derivation: test `past_due` within grace period, `past_due` after grace period, `canceled` (immediate), `active` (not expired)
- `get_plan_limits('trialing')`: assert returns `{ max_tables: 5, max_menu_items: 20 }`
- `get_plan_limits('pro')`: assert returns `{ max_tables: 999, max_menu_items: 999 }`
- `deleteMenuItem()`: assert soft delete (UPDATE), not hard DELETE
- `ErrorBoundary`: render a component that throws, assert fallback UI shown, assert sibling components unaffected

---

### Property-Based Tests

- **Order atomicity**: For any valid order input, `place_order_atomic` either succeeds completely (order + all items) or fails completely (no rows) — never partial
- **Price integrity**: For any order input, `order_items.price` always equals `menu_items.price * floor_multiplier` — never uses client-supplied price
- **Name snapshot**: For any order input, `order_items.name` always equals `menu_items.name` at the time of the RPC call
- **Quantity bounds**: For any item with `quantity` outside [1, 99], `POST /api/orders` always returns 400
- **Plan limit enforcement**: For any `createTable()` call where `tableCount >= max_tables`, the function always returns an error and never inserts
- **Soft delete filter**: For any `getMenuItems()` or `getAllMenuItems()` call, the result never contains items with `deleted_at IS NOT NULL`
- **Webhook timestamp**: For any `verifyWebhookSignature()` call with `|age| > 300s`, `valid` is always `false`
- **Grace period**: For any `past_due` subscription with `now() <= current_period_end + 3 days`, `isExpired` is always `false`

---

### Integration Tests

- Full order placement flow: customer submits order via UI → `place_order_atomic` called → order and items created with correct prices and names → Realtime broadcast received by kitchen dashboard
- Webhook retry flow: delivery marked `retrying` → cron runs → `retryDelivery()` called → active endpoint receives HTTP request; inactive endpoint does not
- Plan limit flow: trial restaurant at 5 tables → "Add Table" button disabled in UI → direct `createTable()` call also blocked → upgrade to Pro → `createTable()` succeeds
- Soft delete flow: manager archives menu item → item disappears from customer menu → item appears in "Archived Items" section → manager restores → item reappears on customer menu
- Subscription expiry warning: set `current_period_end` to 3 days from now → warning banner appears in dashboard → dismiss → banner gone for session
- Error boundary: inject a render error into `Analytics` tab → error boundary fallback shown for Analytics → all other tabs render normally
- Health endpoint: `GET /api/health` → 200 with `{ status: "ok", db: "ok" }` in staging environment
