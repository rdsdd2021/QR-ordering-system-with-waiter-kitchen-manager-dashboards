# QR Order — User Flow, Variations & Pitfalls

> Complete reference for all user journeys, system behaviour, database internals, and known edge cases.
> Generated from live codebase + Supabase MCP inspection.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [User Roles](#2-user-roles)
3. [Flow 1 — Restaurant Owner Onboarding](#3-flow-1--restaurant-owner-onboarding)
4. [Flow 2 — Staff Login & Dashboard Routing](#4-flow-2--staff-login--dashboard-routing)
5. [Flow 3 — Customer Ordering (QR Scan)](#5-flow-3--customer-ordering-qr-scan)
6. [Flow 4 — Kitchen Dashboard](#6-flow-4--kitchen-dashboard)
7. [Flow 5 — Waiter Dashboard](#7-flow-5--waiter-dashboard)
8. [Flow 6 — Manager Dashboard](#8-flow-6--manager-dashboard)
9. [Flow 7 — Billing & Table Sessions](#9-flow-7--billing--table-sessions)
10. [Flow 8 — Subscription & Stripe](#10-flow-8--subscription--stripe)
11. [Flow 9 — Coupon System](#11-flow-9--coupon-system)
12. [Flow 10 — Webhooks](#12-flow-10--webhooks)
13. [Database Schema (Live)](#13-database-schema-live)
14. [RPC Functions](#14-rpc-functions)
15. [Triggers](#15-triggers)
16. [Real-time System](#16-real-time-system)
17. [RLS Policies](#17-rls-policies)
18. [Known Pitfalls & Edge Cases](#18-known-pitfalls--edge-cases)

---

## 1. System Overview

QR Order is a multi-tenant SaaS restaurant ordering platform. Customers scan a table QR code, browse the menu, and place orders. Staff manage everything in real time across three role-specific dashboards.

```
Customer (no login)
  └─ Scans QR → /r/[restaurant_id]/t/[table_id]
  └─ Browses menu, adds to cart, places order

Kitchen Staff (login required)
  └─ /kitchen/[restaurant_id]
  └─ Sees incoming orders, marks preparing → ready

Waiter (login required)
  └─ /waiter/[restaurant_id]
  └─ Accepts orders (waiter_first mode), marks served

Manager (login required)
  └─ /manager/[restaurant_id]
  └─ Full control: menu, tables, staff, billing, analytics, settings

Super Admin (PIN-gated)
  └─ /admin
  └─ Platform-wide: toggle restaurants, manage coupons
```

**Tech stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Supabase (Postgres + Auth + Realtime), Stripe.

---

## 2. User Roles

| Role | Auth Required | Scope | Key Permissions |
|------|--------------|-------|-----------------|
| Customer | No | Public | Place orders, track status, view history |
| Waiter | Yes | Restaurant-scoped | Accept/serve orders, manage table sessions |
| Kitchen | Yes | Restaurant-scoped | View queue, advance order status |
| Manager | Yes | Restaurant-scoped | Full CRUD on menu, tables, staff, billing, settings |
| Super Admin | PIN only | Platform-wide | Toggle restaurants, manage coupons |

Role is stored in `users.role` (enum: `waiter`, `manager`, `kitchen`). Super admin is `users.is_super_admin = true`.

---

## 3. Flow 1 — Restaurant Owner Onboarding

**Route:** `/onboarding`

### Steps

```
Step 1: Account
  ├─ Enter email + password + owner name
  ├─ Supabase Auth signUp() called
  ├─ If "already registered" error → falls back to signIn()
  ├─ Always calls signInWithPassword() after to get a real session
  └─ If email confirmation required → shows message, stops here

Step 2: Restaurant
  ├─ Enter restaurant name
  └─ POST /api/onboard → calls onboard_restaurant() RPC
     Creates atomically:
       - restaurants row (with is_active=true, order_routing_mode='direct_to_kitchen')
       - floors row ("Main Floor", price_multiplier=1.0)
       - 5 tables (table_number 1–5, linked to Main Floor)
       - users row (role='manager', linked to auth user)
       - subscriptions row (plan='free', status='active')

Step 3: Plan
  ├─ Shows Free vs Pro comparison
  ├─ Optional coupon input (live price preview)
  ├─ "Upgrade to Pro" → POST /api/stripe/checkout → redirect to Stripe
  └─ "Start Free" → redirect to /manager/[restaurant_id]
```

### Variations

- **Returning user (already has restaurant):** `/api/onboard` checks `users.auth_id` first — if restaurant already exists, returns existing `restaurant_id` without creating duplicates.
- **Email confirmation enabled:** After signUp, signIn fails → user sees "check your inbox" message. They must confirm then return to `/onboarding` to sign in.
- **Coupon applied at onboarding:** Coupon is validated client-side via `/api/coupons/validate`, price preview updates live. Actual usage is only recorded after Stripe `checkout.session.completed` webhook fires.

### Pitfalls

- If `onboard_restaurant()` RPC fails mid-transaction (e.g. DB constraint), the auth user is created but has no restaurant. User is stuck — re-visiting `/onboarding` will re-attempt the RPC since `existing?.restaurant_id` will be null.
- The `NEXT_PUBLIC_ADMIN_PIN` is exposed to the client bundle. It should be treated as a weak gate only.
- `ownerName` is required but only validated client-side. Empty strings can reach the API if JS is bypassed.

---

## 4. Flow 2 — Staff Login & Dashboard Routing

**Route:** `/login`

```
1. Enter email + password
2. supabase.auth.signInWithPassword()
3. useAuth() loads profile from users table (WHERE auth_id = auth.uid())
4. redirectToDashboard() switches on profile.role:
   - manager  → /manager/[restaurant_id]
   - waiter   → /waiter/[restaurant_id]
   - kitchen  → /kitchen/[restaurant_id]
   - no profile → /onboarding
```

### Variations

- **New auth user with no users row:** `profile` is null → redirected to `/onboarding`. This happens if staff creation partially failed.
- **Inactive user (`is_active = false`):** No special redirect — they can still log in. The dashboard will load but RLS will block data access for most queries. This is a known gap (see Pitfalls).
- **Super admin:** `is_super_admin = true` users are not redirected to `/admin` automatically — they must navigate there manually and enter the PIN.

### Pitfalls

- `useAuth()` uses `maybeSingle()` — if a user has multiple rows in `users` (duplicate auth_id), only the first is returned silently.
- Auth state is client-side only. There is no server-side session validation on dashboard pages — a user with a valid JWT but a deleted `users` row will see a loading spinner indefinitely.
- Staff created via `/api/staff/create` get a temporary password. There is no forced password-change flow.

---

## 5. Flow 3 — Customer Ordering (QR Scan)

**Route:** `/r/[restaurant_id]/t/[table_id]`

### Pre-checks (server-side, page.tsx)

```
1. getRestaurant(restaurant_id)
   └─ If null or is_active=false → 404 (not-found.tsx)
2. getTable(restaurant_id, table_id)
   └─ If null → 404
3. getMenuItems(restaurant_id) — only is_available=true items
4. Floor info fetched for price_multiplier display
```

### Table Occupancy Check (client-side)

```
On mount (300ms delay to let sessionStorage load):
  checkTableHasUnpaidOrders(table_id)
  └─ If true AND no sessionStorage key for this table
     → tableOccupied = true → shows "Table is occupied" screen
  └─ If true AND sessionStorage key exists
     → this browser owns the session → normal flow
  └─ If false → normal flow
```

### Geo-fencing (if enabled)

```
useGeofence() calls browser navigator.geolocation.getCurrentPosition()
  └─ status: 'checking' | 'inside' | 'outside' | 'error' | 'disabled'
  └─ If 'outside' → cart "Add" buttons are disabled
  └─ If 'error' (permission denied) → cart is blocked with message
  └─ If geofencing_enabled=false → skipped entirely
```

### Menu Browsing

```
- Menu items displayed as cards (MenuItemCard)
- Real-time updates via useRealtimeMenu() → channel: manager:{restaurant_id}
  - INSERT → adds item to list
  - UPDATE → patches name/price/availability in place
  - DELETE → removes from list
- Unavailable items hidden (is_available=false filtered server-side)
- Tags shown as badges (veg, spicy, bestseller, etc.)
- Floor price_multiplier shown as info badge if > 1.0
```

### Cart & Order Placement

```
Tab: "Menu" (default) | "Orders"

Cart state managed by useCart() — in-memory only (no persistence).

Add to cart → CartDrawer (bottom sheet, expandable)

On "Place Order":
  Case A — No saved customer info (first order):
    → Step "info": collect name (required), phone (required), party size (optional)
    → Validate: name non-empty, phone non-empty
    → submitOrder()

  Case B — Saved customer info (sessionStorage):
    → Skip form, call submitOrder() directly

submitOrder():
  1. placeOrder() → lib/api.ts
  2. check_table_has_unpaid_orders(table_id, customer_phone)
     └─ If true → returns 'UNPAID_ORDERS_EXIST' → shows error step
  3. getRestaurant() → determine routing mode
  4. INSERT into orders (status = 'pending' or 'pending_waiter')
  5. calculate_item_prices_batch() RPC → applies floor multiplier
     └─ Falls back to base prices if RPC fails
  6. INSERT into order_items
  7. On success → save customer info to sessionStorage
               → show success screen (2.5s) → clear cart → back to menu
```

### Order Status Tracking

```
Tab: "Orders"
  - useCustomerSession() loads active orders from sessionStorage
  - useRealtimeOrderStatus() subscribes to channel: customer:{restaurant_id}:{table_id}
  - OrderStatusTracker shows visual progress bar:
    pending → confirmed → preparing → ready → served
  - Session clears from sessionStorage when all orders have billed_at set
```

### Variations

- **Multiple orders same session:** Customer can place additional orders. The billing safety check uses `customer_phone` to scope — same phone = same customer = allowed. Different phone = blocked.
- **No phone number:** If customer skips phone, billing safety check uses `null` phone — any unpaid order at the table blocks them.
- **Menu item deleted mid-session:** Real-time DELETE removes it from the displayed list. Items already in cart are NOT removed — they will fail at `order_items` INSERT if `menu_item_id` no longer exists (FK constraint).
- **Floor pricing:** `calculate_item_prices_batch()` applies `floor.price_multiplier`. If the table has no `floor_id`, multiplier defaults to 1.0.

### Pitfalls

- Cart is in-memory only. Refreshing the page clears the cart.
- `tableOccupied` check has a 300ms delay — fast users could see a flash of the normal UI before the occupied screen appears.
- Geo-fencing relies on browser geolocation. If the user denies permission, they are blocked from ordering even if physically present.
- `sessionStorage` is tab-scoped. Opening the QR link in a new tab loses the session — the table will appear occupied to the new tab.
- If `calculate_item_prices_batch()` RPC is unavailable, orders are placed at base prices (no floor multiplier). This is a silent fallback — no error shown to customer.
- Menu items with `is_available=false` are hidden from customers but can still be in the DB. If a manager marks an item unavailable after a customer adds it to cart, the cart still shows it — the order will succeed (price is stored at order time), but the kitchen will see an item that's technically unavailable.

---

## 6. Flow 4 — Kitchen Dashboard

**Route:** `/kitchen/[restaurant_id]`

**Protected by:** `ProtectedRoute` (role = `kitchen`)

```
On load:
  getKitchenOrders(restaurant_id)
  └─ Fetches orders WHERE status IN ('pending','confirmed','preparing','ready')
  └─ Excludes 'pending_waiter' (not yet accepted by waiter)
  └─ Excludes 'served' (completed)
  └─ Joins: tables, waiter, order_items → menu_items

Real-time:
  useKitchenOrders() subscribes to channel: kitchen:{restaurant_id}
  Event: order_changed
  └─ INSERT → re-fetches single order to get full joined data
             → prepends to list with 4s highlight animation
  └─ UPDATE → patches status in-place (optimistic update already applied)
```

### Order Actions

```
Each OrderCard shows action button based on current status:
  pending    → "Confirm"   → status: confirmed
  confirmed  → "Preparing" → status: preparing
  preparing  → "Ready"     → status: ready
  ready      → (no action — waiter marks served)

advanceStatus():
  1. Optimistic update (instant UI)
  2. updateOrderStatus() → PATCH orders.status
  3. On failure → rollback to previous status
```

### Variations

- **Direct-to-kitchen mode:** Orders arrive as `pending` — kitchen sees them immediately.
- **Waiter-first mode:** Orders arrive as `pending_waiter` — kitchen does NOT see them until waiter accepts (status becomes `confirmed`).
- **New order highlight:** New orders get a pulsing border for 4 seconds via `newOrderIds` set.

### Pitfalls

- Kitchen has no way to cancel or reject an order — only advance it forward.
- If the real-time channel drops, new orders won't appear until manual refresh. The "Refresh" button triggers a full re-fetch.
- `getPreviousStatus()` for rollback is a simple reverse lookup — if the DB has a different status than expected (concurrent update), the rollback may set a wrong status.

---

## 7. Flow 5 — Waiter Dashboard

**Route:** `/waiter/[restaurant_id]`

**Protected by:** `ProtectedRoute` (role = `waiter`)

```
On load:
  useWaiterOrders(restaurant_id, currentWaiterId)
  └─ Fetches all relevant orders for this waiter

Real-time:
  Subscribes to channel: waiter:{restaurant_id}
  Event: order_changed
```

### Two Sections

```
"My Orders"
  └─ orders WHERE waiter_id = currentWaiterId
  └─ Actions: Mark Served (status: ready → served)

"Available Orders"
  └─ orders WHERE waiter_id IS NULL
     AND status IN ('pending_waiter', 'confirmed', 'ready')
  └─ Actions:
     - "Take Order" (assign to self, open table session)
     - "Accept Order" (pending_waiter → confirmed, waiter_first mode only)
```

### Order Actions

```
takeOrder(orderId):
  assign_order_to_waiter() RPC
  └─ Atomic: sets waiter_id, opens table_session if none exists
  └─ Race-condition safe (advisory lock on table_id)

acceptOrder(orderId):
  accept_order_atomic() RPC
  └─ pending_waiter → confirmed
  └─ Also assigns waiter_id atomically

markServed(orderId):
  updateOrderStatus(orderId, 'served')
  └─ Triggers update_order_timestamps → sets served_at
```

### Variations

- **Direct-to-kitchen mode:** Waiters still see orders in "Available" (status=`confirmed` or `ready`) to mark served. They don't need to accept.
- **Waiter-first mode:** Waiters see `pending_waiter` orders in "Available" and must accept before kitchen sees them.
- **Auto-assignment:** `auto_assign_waiter_from_session` trigger fires on order INSERT — if the table already has an open `table_session` with a `waiter_id`, the new order is automatically assigned to that waiter.

### Pitfalls

- Two waiters can both see the same "Available" order simultaneously. `assign_order_to_waiter()` uses an advisory lock, so only one will succeed — the other gets an error (currently silent in UI).
- A waiter who is `is_active=false` can still log in and see orders. No active-status enforcement in the dashboard.
- `markServed` does not check if the order is actually `ready` first — the status transition trigger `validate_order_status_transition` enforces this at DB level and will throw an error, but the UI shows no specific message.

---

## 8. Flow 6 — Manager Dashboard

**Route:** `/manager/[restaurant_id]`

**Protected by:** `ProtectedRoute` (role = `manager`)

The dashboard has a sidebar nav (desktop) and bottom nav (mobile) with 4 groups:

### Operations Group

**Live Tables (`sessions` tab)**
```
TableSessions component
- Shows all tables grouped by status (occupied / free)
- Each occupied table shows: waiter name, order count, total amount
- "Bill (N)" button → generate_bill() for all served orders at that table
- "Close Session" → close_table_session() RPC
```

**Order Log (`orderlog` tab)**
```
OrderLog component
- Full history of all orders for the restaurant
- Filterable by status, date range
- Shows: table, waiter, items, total, timestamps
- Real-time updates via useManagerRealtime()
```

**Analytics (`analytics` tab)**
```
Analytics component
- Revenue over time (daily/weekly/monthly)
- Top menu items by order count
- Average prep time, serve time, turnaround
- Waiter performance metrics
- Uses PerformanceMetrics type from DB
```

### Menu Group

**Menu Items (`menu` tab)**
```
MenuManager component
- List all menu items (including unavailable)
- Add item: name, price, description, image_url, tags, is_available
- Edit item inline
- Toggle availability (is_available)
- Delete item (blocked if referenced by existing order_items — FK constraint)
- Image upload to Supabase Storage
- Real-time: menu changes broadcast to customer pages instantly
```

**Categories & Tags (`categories` tab)**
```
CategoryTagManager component
- Create hierarchical food categories (parent/child)
- Create food tags (Veg, Spicy, Bestseller, etc.)
- Assign color + image to categories/tags
- "Suggestions" tab: pick from global category_suggestions / tag_suggestions templates
- Link categories/tags to menu items via menu_item_categories / menu_item_tags junction tables
```

**Floors (`floors` tab)**
```
FloorsManager component
- Create floors/sections (e.g. "Ground Floor", "Rooftop", "AC Hall")
- Set price_multiplier per floor (e.g. 1.2 = 20% premium)
- Assign tables to floors
- Default "Main Floor" created at onboarding (multiplier=1.0)
```

### Team & Setup Group

**Staff (`staff` tab)**
```
StaffManager component
- List all staff (waiters + kitchen)
- Create staff: POST /api/staff/create
  → Creates Supabase Auth user with temp password
  → Creates users row (role, restaurant_id, auth_id)
- Toggle is_active (soft disable)
- Delete staff (removes users row + auth user)
```

**Table Setup (`tables` tab)**
```
TablesManager component
- Add/remove tables
- Set table capacity
- Assign floor
- Generate QR code URL per table
- QR URL format: /r/[restaurant_id]/t/[table_id]
```

### Restaurant Group

**Details (`details` tab)**
```
RestaurantDetails component
- Edit restaurant name
- Edit slug (URL-friendly identifier)
```

**Settings (`settings` tab)**
```
SettingsPanel component
- Order routing mode: direct_to_kitchen | waiter_first
- Geo-fencing: enable/disable, set lat/lng/radius
- Subscription info: current plan, period end
- UpgradeBanner: shown on free plan, includes coupon input
```

**Webhooks (`webhooks` tab)**
```
WebhooksManager component
- Create webhook endpoint: name, URL (must be HTTPS), select events
- Secret shown ONCE on creation (whsec_... format)
- Test endpoint: sends test ping event
- View delivery history per endpoint
- Retry failed deliveries
- Rotate secret
- Auto-disabled after 10 consecutive failures
```

### Pitfalls

- Deleting a menu item that has existing `order_items` rows will fail silently (FK constraint `ON DELETE RESTRICT`). The UI should show an error but may not in all cases.
- Analytics queries can be slow on large datasets — no pagination or query limits are enforced.
- Staff deletion removes the `users` row but the Supabase Auth user may persist if the API call partially fails. This leaves an orphaned auth account that can still attempt login (will get "no profile" → redirect to onboarding).
- The QR code URL is stored as `qr_code_url` in the `tables` table but is just a plain URL string — there is no actual QR image generation in the DB. The frontend must generate the QR image from this URL.
- Changing `order_routing_mode` takes effect immediately for new orders only. In-flight `pending_waiter` orders are not retroactively changed.

---

## 9. Flow 7 — Billing & Table Sessions

### Table Session Lifecycle

```
open_table_session(restaurant_id, table_id, waiter_id)
  └─ Called when waiter takes/accepts first order at a table
  └─ Creates table_sessions row (opened_at=now(), closed_at=null)
  └─ Only one open session per table at a time (enforced by RPC)

close_table_session(session_id)
  └─ Sets closed_at=now()
  └─ Called after all orders at the table are billed
```

### Billing Flow

```
Manager: Live Tables tab → "Bill (N)" button

generate_bill(order_id) RPC:
  1. Checks order.status = 'served' (throws if not)
  2. Calculates total: SUM(order_items.quantity * order_items.price)
  3. Sets orders.total_amount = calculated_total
  4. Sets orders.billed_at = now()
  5. Returns: order_id, total_amount, billed_at, success=true

After billing:
  - billed_at is set → order excluded from "unpaid" checks
  - When ALL served orders at a table have billed_at set:
    → Customer sessionStorage session clears
    → Table shows as "free" in Live Tables
```

### Payment Method & Discount

```
orders.payment_method: 'cash' | 'card' | 'upi' (nullable)
orders.discount_amount: numeric (default 0)
orders.discount_note: text (reason for discount)

These are set at billing time by the manager.
No automated payment processing — purely manual recording.
```

### Pitfalls

- `generate_bill()` requires `status = 'served'`. If a waiter forgets to mark an order served, the manager cannot bill it. There is no manager override to force-bill.
- Billing is per-order, not per-table. A table with 3 orders requires 3 separate `generate_bill()` calls (the "Bill (N)" button loops through them).
- `discount_amount` is stored but not subtracted from `total_amount` automatically — the frontend must calculate the net amount for display.
- If `close_table_session()` is not called after billing, the table remains "occupied" in the Live Tables view indefinitely.

---

## 10. Flow 8 — Subscription & Stripe

### Plans

| Plan | Price | Limits |
|------|-------|--------|
| Free | ₹0 | 5 tables, 20 menu items |
| Pro | ₹799/month | Unlimited tables & menu items |

7-day free trial on all new Pro subscriptions (no credit card required during trial).

### Upgrade Flow

```
Manager Settings → UpgradeBanner → "Upgrade to Pro"
  OR
Onboarding Step 3 → "Upgrade to Pro"

POST /api/stripe/checkout:
  1. Validate coupon (if provided) via validate_coupon() RPC
  2. Create/retrieve Stripe customer
  3. Create Stripe checkout session:
     - price: STRIPE_PRO_PRICE_ID
     - trial_period_days: 7
     - discounts: [{ coupon: stripe_coupon_id }] (if coupon)
     - metadata: { restaurant_id, coupon_id }
  4. Return checkout URL → redirect

Stripe Checkout → user enters card → completes payment

Stripe Webhook → POST /api/stripe/webhook:
  checkout.session.completed:
    → upsert subscriptions (plan='pro', status=stripeSub.status)
    → record_coupon_usage() if coupon_id in metadata

  customer.subscription.updated:
    → upsert subscriptions (plan based on status)

  customer.subscription.deleted:
    → upsert subscriptions (plan='free', status='canceled')

  invoice.payment_failed:
    → update subscriptions.status = 'past_due'
```

### Plan Limit Enforcement

```
useSubscription(restaurantId):
  └─ Fetches subscriptions row
  └─ get_plan_limits() RPC returns: { max_tables, max_menu_items }
  └─ Free: max_tables=5, max_menu_items=20
  └─ Pro: max_tables=null (unlimited), max_menu_items=null

Manager UI checks limits before allowing:
  - Adding a new table
  - Adding a new menu item
  → Shows UpgradeBanner if at limit
```

### Pitfalls

- Stripe webhook requires raw body — Next.js App Router must not parse the body before signature verification. The route uses `req.text()` correctly, but any middleware that parses JSON will break this.
- `STRIPE_WEBHOOK_SECRET` must match the signing secret for the specific webhook endpoint in Stripe Dashboard. Local testing requires `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
- If the webhook fires but `restaurant_id` is missing from `session.metadata`, the subscription is not updated. This can happen if the checkout session was created without metadata (e.g. direct Stripe Dashboard test).
- Trial period means the subscription status is `trialing`, not `active`. The `get_restaurant_plan()` function treats `trialing` as Pro — but any code checking `status = 'active'` directly will incorrectly treat trialing users as free.
- `past_due` subscriptions are not downgraded to free automatically — only `canceled` or `deleted` events trigger a plan downgrade.

---

## 11. Flow 9 — Coupon System

### Coupon Fields (live from DB)

| Column | Type | Notes |
|--------|------|-------|
| `code` | text (unique) | Uppercase, e.g. `LAUNCH20` |
| `type` | enum: `percentage` \| `flat` | |
| `value` | numeric | % (0–100) or flat in paise |
| `max_uses` | int (nullable) | null = unlimited |
| `used_count` | int | Incremented atomically |
| `expires_at` | timestamptz (nullable) | null = never expires |
| `is_active` | boolean | Admin can toggle |
| `applicable_plans` | text[] | e.g. `{pro}` |
| `stripe_coupon_id` | text (nullable) | Cached Stripe coupon ID |

### Validation Rules (server-side, `validate_coupon()` RPC)

```
1. Code exists in coupons table
2. is_active = true
3. expires_at IS NULL OR expires_at > now()
4. max_uses IS NULL OR used_count < max_uses
5. plan IS IN applicable_plans
6. Restaurant has NOT used this coupon before (coupon_usages unique constraint)
```

### Usage Recording (`record_coupon_usage()` RPC)

```
- Uses pg_advisory_lock(coupon_id hash) for race-condition safety
- Idempotent: checks coupon_usages before inserting
- Increments coupons.used_count atomically
- Called ONLY from Stripe webhook (checkout.session.completed)
  → Ensures usage is only recorded after successful payment
```

### Admin Management (`/admin` → Coupons tab)

```
GET  /api/admin/coupons       → list all coupons
POST /api/admin/coupons       → create coupon
PATCH /api/admin/coupons/[id] → update coupon
DELETE /api/admin/coupons/[id] → delete coupon
```

All admin coupon routes require `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS).

### Pitfalls

- Coupon `value` for `flat` type is stored in **paise** (smallest currency unit), not rupees. A ₹100 discount = `value: 10000`. The frontend must divide by 100 for display.
- `stripe_coupon_id` is cached — if a coupon's value is edited in the DB but the Stripe coupon is not updated, the old discount will be applied at checkout.
- Deleting a coupon that has `coupon_usages` rows will fail (FK constraint). Admin must deactivate instead of delete.
- The per-restaurant reuse check is in `validate_coupon()` but NOT in `record_coupon_usage()`. If `validate_coupon()` is bypassed (direct API call), a restaurant could use a coupon twice.

---

## 12. Flow 10 — Webhooks

**Route:** Manager → Webhooks tab

### Endpoint Lifecycle

```
Create endpoint:
  - Name, URL (must be HTTPS, no private IPs)
  - Select events to subscribe to
  - Secret generated: whsec_[32 random bytes hex]
  - Secret shown ONCE — not retrievable after creation

Test endpoint:
  POST /api/webhooks/[id]/test
  → Fires 'test' event with sample payload

Rotate secret:
  POST /api/webhooks/[id]/rotate-secret
  → Generates new secret, old secret immediately invalid
```

### Event Dispatch (`lib/webhooks.ts`)

```
fireEvent(restaurantId, eventType, data):
  1. Fetch active endpoints subscribed to this event
  2. Build WebhookPayload: { id, event, restaurant_id, timestamp, data }
  3. Dispatch to up to 10 endpoints concurrently
  4. Per endpoint:
     a. Create webhook_deliveries row (status='pending')
     b. POST to endpoint URL with headers:
        X-Webhook-Signature: sha256=HMAC-SHA256(secret, timestamp.body)
        X-Webhook-Timestamp: ISO-8601
        X-Webhook-Event: event type
        X-Webhook-ID: event UUID
     c. Timeout: 8 seconds
     d. Success (2xx) → status='success', reset failure_count
     e. Failure → status='retrying', schedule next retry
        Retry schedule: 1m → 5m → 30m → 2h (5 total attempts)
     f. After 5 failures → status='dead'
     g. After 10 consecutive endpoint failures → auto-disable endpoint
```

### Retry Flow

```
POST /api/webhooks/[id]/retry:
  retryDelivery(deliveryId):
  1. Fetch delivery + endpoint
  2. Check attempt < max_attempts (5)
  3. Re-dispatch with same payload (stable event_id)
  4. Update delivery record
  5. On success: reset endpoint failure_count
```

### Supported Events

| Group | Events |
|-------|--------|
| Orders | `order.placed`, `order.confirmed`, `order.preparing`, `order.ready`, `order.served`, `order.billed`, `order.cancelled` |
| Tables | `table.session_opened`, `table.session_closed` |
| Menu | `menu.item_created`, `menu.item_updated`, `menu.item_deleted` |
| Staff | `staff.created`, `staff.deactivated` |
| Payment | `payment.method_recorded` |
| Test | `test` |

### Pitfalls

- Webhook secret is only shown once at creation. If lost, the only option is to rotate it.
- SSRF protection blocks private IPs and localhost. Webhooks cannot be tested against local servers without a tunnel (ngrok, etc.).
- Payload size is capped at 64 KB. Large order payloads (many items) could be truncated.
- The retry scheduler is not a background job — retries only happen when `/api/webhooks/[id]/retry` is called manually or by an external cron. There is no automatic retry execution built in.
- `fireEvent()` is called from API routes synchronously. If webhook dispatch is slow (up to 8s timeout × 10 endpoints), it can delay the API response.

---

## 13. Database Schema (Live)

> Sourced directly from Supabase MCP. All tables have RLS enabled.

### `restaurants` (7 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | gen_random_uuid() |
| `name` | text | |
| `slug` | text (unique, nullable) | URL-friendly identifier |
| `is_active` | boolean | Default true. Super-admin toggle. |
| `order_routing_mode` | text | `direct_to_kitchen` \| `waiter_first` |
| `geofencing_enabled` | boolean | Default false |
| `geo_latitude` | numeric (nullable) | |
| `geo_longitude` | numeric (nullable) | |
| `geo_radius_meters` | int | Default 100 |
| `owner_id` | uuid (nullable) → auth.users | |
| `created_at` | timestamptz | |

### `floors` (9 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `restaurant_id` | uuid → restaurants | |
| `name` | text | e.g. "Main Floor", "Rooftop" |
| `price_multiplier` | numeric | Default 1.0, must be > 0 |
| `created_at` | timestamptz | |

### `tables` (35 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `restaurant_id` | uuid → restaurants | |
| `floor_id` | uuid (nullable) → floors | |
| `table_number` | int | Unique per restaurant |
| `capacity` | int (nullable) | Default 4, must be > 0 |
| `qr_code_url` | text (nullable) | URL string only, no image stored |

### `menu_items` (8 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `restaurant_id` | uuid → restaurants | |
| `name` | text | |
| `price` | numeric | Must be >= 0 |
| `is_available` | boolean | Default true |
| `image_url` | text (nullable) | Supabase Storage URL |
| `tags` | text[] | Default `{}` |
| `description` | text (nullable) | |

### `users` (16 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | |
| `role` | text | `waiter` \| `manager` \| `kitchen` |
| `restaurant_id` | uuid → restaurants | |
| `auth_id` | uuid (nullable) → auth.users | |
| `email` | text (nullable) | |
| `is_active` | boolean | Default true |
| `is_super_admin` | boolean | Default false. Platform-level admin. |
| `created_at` | timestamptz | |

### `orders` (15 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `restaurant_id` | uuid → restaurants | |
| `table_id` | uuid → tables | |
| `waiter_id` | uuid (nullable) → users | Auto-assigned by trigger |
| `status` | text | `pending` \| `pending_waiter` \| `confirmed` \| `preparing` \| `ready` \| `served` |
| `total_amount` | numeric | Default 0. Set by generate_bill(). |
| `billed_at` | timestamptz (nullable) | Set by generate_bill(). |
| `confirmed_at` | timestamptz (nullable) | Set by trigger |
| `preparing_at` | timestamptz (nullable) | Set by trigger |
| `ready_at` | timestamptz (nullable) | Set by trigger |
| `served_at` | timestamptz (nullable) | Set by trigger |
| `customer_name` | text (nullable) | Collected at order placement |
| `customer_phone` | text (nullable) | Used for billing safety scoping |
| `party_size` | int (nullable) | |
| `payment_method` | text (nullable) | `cash` \| `card` \| `upi` |
| `discount_amount` | numeric | Default 0 |
| `discount_note` | text (nullable) | |
| `created_at` | timestamptz | |

### `order_items` (29 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `order_id` | uuid → orders | ON DELETE CASCADE |
| `menu_item_id` | uuid → menu_items | ON DELETE RESTRICT |
| `quantity` | int | Must be > 0 |
| `price` | numeric | Stored at order time (snapshot) |

### `order_status_logs` (23 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `order_id` | uuid → orders | ON DELETE CASCADE |
| `old_status` | text (nullable) | |
| `new_status` | text | |
| `changed_by` | uuid (nullable) → users | |
| `created_at` | timestamptz | |

### `table_sessions` (2 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `restaurant_id` | uuid → restaurants | |
| `table_id` | uuid → tables | |
| `waiter_id` | uuid → users | |
| `opened_at` | timestamptz | |
| `closed_at` | timestamptz (nullable) | null = session still open |

### `subscriptions` (7 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `restaurant_id` | uuid (unique) → restaurants | One per restaurant |
| `plan` | text | `free` \| `pro` |
| `status` | text | `active` \| `trialing` \| `past_due` \| `canceled` \| `incomplete` |
| `stripe_customer_id` | text (unique, nullable) | |
| `stripe_subscription_id` | text (unique, nullable) | |
| `current_period_end` | timestamptz (nullable) | |
| `created_at` / `updated_at` | timestamptz | |

### `coupons` (1 row)

See [Flow 9 — Coupon System](#11-flow-9--coupon-system) for full field reference.

### `coupon_usages` (0 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `coupon_id` | uuid → coupons | |
| `restaurant_id` | uuid → restaurants | |
| `used_at` | timestamptz | |

Unique constraint on `(coupon_id, restaurant_id)` — prevents a restaurant from using the same coupon twice.

### `webhook_endpoints` (1 row) / `webhook_deliveries` (1 row)

See [Flow 10 — Webhooks](#12-flow-10--webhooks) for full field reference.

### `food_categories` (9 rows)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `restaurant_id` | uuid → restaurants | |
| `parent_id` | uuid (nullable) → food_categories | Self-referential for hierarchy |
| `name` | text | |
| `description` / `image_url` / `color` | text (nullable) | |
| `sort_order` | int | Default 0 |
| `is_suggestion` | boolean | True if seeded from global template |
| `created_at` | timestamptz | |

### `food_tags` (5 rows)

Same structure as `food_categories` minus `parent_id`.

### Junction Tables

- `menu_item_categories (menu_item_id, category_id)` — PK is composite
- `menu_item_tags (menu_item_id, tag_id)` — PK is composite

### Global Suggestion Templates (read-only)

- `category_suggestions` (24 rows) — global category templates
- `tag_suggestions` (16 rows) — global tag templates

---

## 14. RPC Functions

> All functions are `SECURITY DEFINER` unless noted. Sourced from live DB.

### Onboarding

| Function | Signature | Description |
|----------|-----------|-------------|
| `onboard_restaurant` | `(p_auth_id, p_name, p_email, p_owner_name)` | Creates restaurant + Main Floor + 5 tables + manager user + subscription in one transaction |
| `create_default_subscription` | `(restaurant_id)` | Called by `on_restaurant_created` trigger. Creates free subscription row. |

### Order Management

| Function | Signature | Description |
|----------|-----------|-------------|
| `get_initial_order_status` | `(p_restaurant_id)` | Returns `pending` or `pending_waiter` based on `order_routing_mode` |
| `validate_order_status_transition` | trigger function | Enforces state machine. Raises exception on invalid transition. |
| `update_order_timestamps` | trigger function | Sets `confirmed_at`, `preparing_at`, `ready_at`, `served_at` on status change |
| `log_order_status_change` | trigger function | Inserts row into `order_status_logs` on every status change |
| `calculate_order_total` | `(p_order_id)` | Returns SUM(quantity * price) for all order_items |
| `generate_bill` | `(p_order_id)` | Requires status=`served`. Sets `total_amount` + `billed_at`. Returns order details. |

### Pricing

| Function | Signature | Description |
|----------|-----------|-------------|
| `calculate_item_price` | `(menu_item_id, table_id)` | Returns base_price × floor.price_multiplier. Returns base_price if no floor. |
| `calculate_item_prices_batch` | `(p_items jsonb, p_table_id)` | Batch version of above. Used at order placement. |

### Waiter Assignment

| Function | Signature | Description |
|----------|-----------|-------------|
| `auto_assign_waiter_from_session` | trigger function (BEFORE INSERT on orders) | If table has open session, sets `waiter_id` automatically |
| `auto_assign_table_waiter` | trigger function (BEFORE INSERT on orders) | Secondary auto-assign trigger |
| `assign_order_to_waiter` | `(order_id, waiter_id)` | Atomic assignment with advisory lock on table_id. Opens table session if none exists. |
| `accept_order_atomic` | `(order_id, waiter_id)` | Atomically transitions `pending_waiter → confirmed` and assigns waiter |

### Table Sessions

| Function | Signature | Description |
|----------|-----------|-------------|
| `open_table_session` | `(restaurant_id, table_id, waiter_id)` | Creates session. Only one open session per table. |
| `close_table_session` | `(session_id)` | Sets `closed_at = now()` |

### Billing Safety

| Function | Signature | Description |
|----------|-----------|-------------|
| `check_table_has_unpaid_orders` | `(p_table_id, p_customer_phone?)` | Returns true if table has orders with `billed_at IS NULL`. Scoped by phone if provided. |
| `get_table_unpaid_orders` | `(p_table_id)` | Returns list of unpaid orders at a table |

### Coupon System

| Function | Signature | Description |
|----------|-----------|-------------|
| `validate_coupon` | `(code, plan, restaurant_id)` | Full validation: active, expiry, usage limit, plan match, per-restaurant reuse |
| `record_coupon_usage` | `(p_coupon_id, p_restaurant_id)` | Atomic increment with advisory lock. Idempotent. |

### Auth & Access

| Function | Signature | Description |
|----------|-----------|-------------|
| `get_current_user_restaurant` | `()` | Returns `restaurant_id` for the current auth user |
| `get_user_restaurant_id` | `(auth_id)` | Returns `restaurant_id` for a given auth user |
| `get_user_role` | `(auth_id)` | Returns role for a given auth user |
| `user_has_role` | `(auth_id, role)` | Boolean check |
| `get_restaurant_plan` | `(restaurant_id)` | Returns current plan (`free` or `pro`) |
| `get_plan_limits` | `(plan)` | Returns `{ max_tables, max_menu_items }` |

### Real-time Broadcast

| Function | Signature | Description |
|----------|-----------|-------------|
| `broadcast_order_changes` | trigger function (AFTER INSERT/UPDATE on orders) | Sends to `kitchen:`, `waiter:`, `manager:`, `customer:` channels |
| `broadcast_order_on_items_insert` | trigger function (AFTER INSERT on order_items) | Fires broadcast after first item inserted (ensures items exist in payload) |
| `broadcast_order_change` | `(order_id)` | Manual broadcast trigger |

---

## 15. Triggers

> Sourced from live DB.

| Trigger | Table | Timing | Event | Function |
|---------|-------|--------|-------|----------|
| `validate_order_status_transition` | orders | BEFORE | INSERT, UPDATE | Enforces status state machine |
| `update_order_timestamps_trigger` | orders | BEFORE | INSERT, UPDATE | Sets confirmed_at, preparing_at, etc. |
| `auto_assign_waiter_from_session` | orders | BEFORE | INSERT | Auto-assigns waiter from open table session |
| `auto_assign_table_waiter_trigger` | orders | BEFORE | INSERT | Secondary waiter auto-assign |
| `log_order_status_change` | orders | AFTER | INSERT, UPDATE | Writes to order_status_logs |
| `orders_broadcast_trigger` | orders | AFTER | INSERT, UPDATE | Broadcasts to real-time channels |
| `on_order_item_insert` | order_items | AFTER | INSERT | Fires broadcast after items are inserted |
| `on_restaurant_created` | restaurants | AFTER | INSERT | Creates default subscription row |
| `trg_coupons_updated_at` | coupons | BEFORE | UPDATE | Sets updated_at = now() |
| `trg_webhook_endpoints_updated_at` | webhook_endpoints | BEFORE | UPDATE | Sets updated_at = now() |

### Trigger Execution Order on Order INSERT

```
1. BEFORE: validate_order_status_transition  → validates status
2. BEFORE: auto_assign_waiter_from_session   → sets waiter_id from open session
3. BEFORE: auto_assign_table_waiter_trigger  → secondary waiter assignment
4. BEFORE: update_order_timestamps_trigger   → sets timestamp fields
5. Row is inserted
6. AFTER:  log_order_status_change           → writes audit log
7. AFTER:  orders_broadcast_trigger          → broadcasts to channels
   (broadcast is suppressed here — waits for order_items)
8. order_items INSERT
9. AFTER:  on_order_item_insert              → fires full broadcast with items
```

---

## 16. Real-time System

### Channels

| Channel | Subscribers | Trigger |
|---------|-------------|---------|
| `kitchen:{restaurant_id}` | Kitchen dashboard | Order INSERT/UPDATE |
| `waiter:{restaurant_id}` | Waiter dashboard | Order INSERT/UPDATE |
| `manager:{restaurant_id}` | Manager dashboard | Order INSERT/UPDATE, menu changes |
| `customer:{restaurant_id}:{table_id}` | Customer order tracker | Order UPDATE for that table |

### Broadcast Mechanism

```
PostgreSQL trigger (broadcast_order_changes / broadcast_order_on_items_insert)
  → calls realtime.send(channel, event, payload)
  → payload: { event: 'INSERT'|'UPDATE', id, restaurant_id, table_id, status, waiter_id, created_at }

Client (useKitchenOrders / useWaiterOrders / useManagerRealtime):
  supabase.channel(channelName)
    .on('broadcast', { event: 'order_changed' }, handler)
    .subscribe()

On INSERT:
  → Re-fetch single order (getKitchenOrders filtered by id) to get full joined data
  → Prepend to orders list
  → Add to newOrderIds set (4s highlight animation)

On UPDATE:
  → Patch existing order status in-place
  → Optimistic update already applied — this is the confirmation
```

### Fallback

```
useKitchenOrders also subscribes to postgres_changes as fallback:
  supabase.channel(...)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handler)
```

### Real-time for Menu (Customer Page)

```
useRealtimeMenu() subscribes to manager:{restaurant_id}
  Event: menu_changed
  Payload: { event: 'INSERT'|'UPDATE'|'DELETE', ...item fields }
  → Updates menuItems state in-place
```

### Real-time for Order Status (Customer Page)

```
useRealtimeOrderStatus() subscribes to customer:{restaurant_id}:{table_id}
  Event: order_changed
  → Updates activeOrders status in useCustomerSession
```

### Pitfalls

- Real-time channels are public (no auth token required). Any client that knows the channel name can subscribe. This is intentional for the kitchen/customer MVP but means order data is not private.
- If the Supabase Realtime connection drops, the UI shows "Offline" indicator but does not auto-reconnect — user must manually refresh.
- The `on_order_item_insert` trigger fires on the FIRST `order_items` INSERT for an order. If the batch insert fails after the first item, the broadcast fires with incomplete item data.
- `REPLICA IDENTITY FULL` must be set on `orders`, `menu_items`, `order_items` for postgres_changes to include old row data. If not set, UPDATE events won't include the previous values.
- Channel names are not authenticated — a customer at table A could subscribe to `customer:{restaurant_id}:{table_B}` and see another table's order updates.

---

## 17. RLS Policies

> Sourced from live DB. All tables have RLS enabled.

### Key Policy Summary

**`restaurants`**
- Public SELECT: only `is_active = true`
- Super admins SELECT: all restaurants (via `is_super_admin = true`)
- Manager UPDATE: own restaurant only
- INSERT: any authenticated user (used during onboarding)

**`menu_items`**
- Public/anon SELECT: only `is_available = true`
- Authenticated SELECT: all items for own restaurant (including unavailable)
- Manager ALL: full CRUD for own restaurant

**`orders`**
- Public INSERT: anyone can create orders (no auth required — customers)
- Public SELECT: all orders visible (no restriction — intentional for customer tracking)
- Public UPDATE: anyone can update order status (⚠️ see Pitfalls)
- Authenticated UPDATE: kitchen/waiter/manager for own restaurant

**`order_items`**
- Public INSERT: anyone can insert (customers placing orders)
- Public SELECT: all order_items visible

**`users`**
- Authenticated SELECT: own row (`auth_id = auth.uid()`) OR same restaurant
- Manager INSERT/UPDATE/DELETE: staff in own restaurant

**`subscriptions`**
- Manager SELECT: own restaurant only
- No public access

**`webhook_endpoints`**
- Manager ALL: own restaurant only
- Service role ALL: unrestricted (for webhook dispatch)

**`webhook_deliveries`**
- Manager SELECT: own restaurant's endpoints only
- Service role ALL: unrestricted

**`food_categories` / `food_tags`**
- Public SELECT: all (needed for customer menu display)
- Manager ALL: own restaurant only

**`table_sessions`**
- Staff SELECT: own restaurant
- Waiter INSERT: open sessions
- Staff UPDATE: close sessions

### Critical RLS Gaps

1. **`orders` public UPDATE policy** — `qual: true` means ANY unauthenticated user can update ANY order's status. This is a significant security gap. The DB-level trigger `validate_order_status_transition` provides some protection, but a malicious actor could mark orders as `served` without being a waiter.

2. **`order_items` public INSERT** — Any unauthenticated user can insert order items for any `order_id`. Combined with the public order INSERT, there is no validation that the `order_id` belongs to the correct restaurant.

3. **`restaurants` INSERT by any authenticated user** — Any logged-in user can create a restaurant row directly (bypassing the onboarding RPC). This could create orphaned restaurants without a subscription row.

---

## 18. Known Pitfalls & Edge Cases

### Authentication & Sessions

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| A1 | Cart is in-memory only | Refresh clears cart | No localStorage/sessionStorage persistence for cart |
| A2 | `sessionStorage` is tab-scoped | New tab = new session = table appears occupied | Customer must use same tab throughout |
| A3 | Staff with no `users` row loops to `/onboarding` | Confusing UX | Happens if staff creation partially fails |
| A4 | `is_active=false` users can still log in | Soft-disabled staff can access dashboards | No login-time check against `is_active` |
| A5 | Duplicate `users` rows for same `auth_id` | `maybeSingle()` returns first silently | No unique constraint on `users.auth_id` |

### Ordering

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| B1 | Cart items not removed when menu item deleted | Order fails at DB level (FK RESTRICT) | No real-time cart invalidation |
| B2 | Geo-fence blocks ordering if permission denied | Customer physically present but blocked | No fallback for denied geolocation |
| B3 | `tableOccupied` check has 300ms delay | Brief flash of normal UI | Race condition on fast loads |
| B4 | Floor pricing silently falls back to base price | Customer charged wrong amount | If `calculate_item_prices_batch` RPC fails |
| B5 | No order cancellation for customers | Customer must contact staff | No cancel flow exists |
| B6 | `party_size` is optional and not validated | Analytics may have gaps | No minimum/maximum enforced |

### Order Status & Routing

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| C1 | Kitchen cannot cancel/reject orders | Stuck orders if item unavailable | Only forward transitions allowed |
| C2 | Changing routing mode affects only new orders | In-flight `pending_waiter` orders not migrated | No migration logic |
| C3 | Waiter rollback uses `getPreviousStatus()` | May set wrong status on concurrent update | Simple reverse lookup, not DB-aware |
| C4 | Two waiters can race to claim same order | One silently fails | Advisory lock protects DB but UI shows no error |
| C5 | `markServed` doesn't pre-check status | DB trigger throws, UI shows generic error | No client-side status validation |

### Billing

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| D1 | `generate_bill()` requires `status=served` | Manager cannot bill unserved orders | No manager override |
| D2 | `discount_amount` not subtracted from `total_amount` | Frontend must calculate net | DB stores gross total only |
| D3 | Table stays "occupied" if session not closed | Live Tables view shows stale data | `close_table_session()` must be called manually |
| D4 | Billing is per-order, not per-table | Multiple clicks needed for multi-order tables | No "bill all" atomic operation |

### Subscriptions & Stripe

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| E1 | `trialing` status not treated as `active` in some checks | Pro features may be blocked during trial | Code checking `status='active'` directly |
| E2 | `past_due` not auto-downgraded to free | Pro features accessible despite failed payment | Only `canceled`/`deleted` triggers downgrade |
| E3 | Stripe webhook body parsing | Any JSON-parsing middleware breaks signature verification | Must use `req.text()` |
| E4 | Missing `restaurant_id` in Stripe metadata | Subscription not updated | Can happen with manual Stripe test events |
| E5 | Cached `stripe_coupon_id` not updated on edit | Old discount applied | Must delete/recreate Stripe coupon on value change |

### Webhooks

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| F1 | No automatic retry execution | Retries only happen on manual trigger | No background job / cron |
| F2 | `fireEvent()` is synchronous in API routes | Slow endpoints delay API response (up to 80s for 10 endpoints) | Should be async/queued |
| F3 | Payload capped at 64 KB | Large orders silently fail | No partial payload fallback |
| F4 | Secret shown only once | If lost, must rotate | No recovery option |
| F5 | Channel names not authenticated | Any client can subscribe to any channel | Real-time data is public |

### RLS & Security

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| G1 | `orders` public UPDATE with `qual: true` | Anyone can update any order status | Mitigated by DB trigger but not fully secure |
| G2 | `order_items` public INSERT | Anyone can add items to any order | No restaurant scoping |
| G3 | `restaurants` INSERT by any authenticated user | Orphaned restaurants possible | Bypasses onboarding RPC |
| G4 | `NEXT_PUBLIC_ADMIN_PIN` in client bundle | PIN is visible in browser | Weak gate — not production-safe |
| G5 | No rate limiting on order placement | Spam orders possible | No throttle on `/r/[id]/t/[id]` |

### Real-time

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| H1 | No auto-reconnect on channel drop | Staff miss orders until manual refresh | Must add reconnect logic |
| H2 | `on_order_item_insert` fires on first item only | Broadcast may have incomplete items if batch fails mid-way | Partial order data in real-time payload |
| H3 | `REPLICA IDENTITY FULL` required | postgres_changes fallback broken without it | Must be set per table in Supabase |

---

*Document generated: April 22, 2026. Based on live Supabase schema inspection + full codebase analysis.*
