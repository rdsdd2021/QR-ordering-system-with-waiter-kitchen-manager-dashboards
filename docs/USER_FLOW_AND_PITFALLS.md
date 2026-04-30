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
10. [Flow 8 — Subscription & Payments](#10-flow-8--subscription--payments)
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

**Auth architecture:** `AuthProvider` (from `contexts/AuthContext`) wraps the entire app in `app/layout.tsx`. It initialises a Supabase auth session listener on mount and exposes `useAuth()` to all client components. The context provides: `user`, `profile`, `loading`, `error`, `signIn`, `signUp`, `signOut`, `redirectToDashboard`, and boolean helpers `isAuthenticated`, `isManager`, `isWaiter`, `isKitchen`.

---

## 2. User Roles

| Role | Auth Required | Scope | Key Permissions |
|------|--------------|-------|-----------------|
| Customer | No | Public | Place orders, track status, view history |
| Waiter | Yes | Restaurant-scoped | Accept/serve orders, manage table sessions |
| Kitchen | Yes | Restaurant-scoped | View queue, advance order status |
| Manager | Yes | Restaurant-scoped | Full CRUD on menu, tables, staff, billing, settings |
| Super Admin | PIN → `/api/admin/proxy` (secret kept server-side) | Platform-wide | Toggle restaurants, manage coupons |

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
- ~~The `NEXT_PUBLIC_ADMIN_PIN` is exposed to the client bundle.~~ **Fixed (G4)** — PIN verification is now handled server-side via `POST /api/admin/verify-pin`. The browser sends only the PIN; the server compares it against `ADMIN_PIN` (or `NEXT_PUBLIC_ADMIN_PIN` as a fallback during migration) and returns `{ ok: true }` or `401`. The endpoint is rate-limited to 5 attempts per IP per minute to prevent brute-force. Remove `NEXT_PUBLIC_ADMIN_PIN` from the environment once `ADMIN_PIN` is set.
- `ownerName` is required but only validated client-side. Empty strings can reach the API if JS is bypassed.

---

## 4. Flow 2 — Staff Login & Dashboard Routing

**Route:** `/login`

```
1. Enter email + password
2. supabase.auth.signInWithPassword()  ← called via AuthContext.signIn()
3. AuthContext.loadUserProfile() fetches profile from users table (WHERE auth_id = auth.uid())
   └─ AuthProvider (mounted in app/layout.tsx) keeps this in sync via onAuthStateChange listener
4. redirectToDashboard() switches on profile.role:
   - manager  → /manager/[restaurant_id]
   - waiter   → /waiter/[restaurant_id]
   - kitchen  → /kitchen/[restaurant_id]
   - no profile → /onboarding
```

**`AuthRedirect` component** wraps pages that should not be accessible when logged in (e.g. `/login`, `/onboarding`). It resolves the session and applies the following logic:

```
session exists?
  No  → render page (guest)
  Yes → has users row?
          No  → sign out → redirect to /login?error=account_incomplete
          Yes → has restaurant_id?
                  No  → allowNoRestaurant=true  → render page (let through for onboarding)
                        allowNoRestaurant=false → redirect to /onboarding
                  Yes → redirect to role dashboard:
                          manager  → /manager/[restaurant_id]
                          waiter   → /waiter/[restaurant_id]
                          kitchen  → /kitchen/[restaurant_id]
                          other    → /onboarding
```

### Variations

- **New auth user with no users row (broken/partial account):** `AuthRedirect` signs the user out and redirects to `/login?error=account_incomplete`. This prevents an infinite redirect loop and surfaces a clear error. Occurs when staff creation partially failed (auth user created but no `users` row inserted).
- **Logged-in user with no restaurant on `/onboarding`:** `allowNoRestaurant=true` is set on the onboarding page, so the user is allowed through to complete setup. On any other protected page (`allowNoRestaurant=false`), they are redirected to `/onboarding`.
- **Inactive user (`is_active = false`):** `loadUserProfile` selects `is_active` and signs out deactivated users immediately, returning `{ deactivated: true }`. `signIn` checks this flag and returns an error — deactivated users cannot log in.
- **Super admin:** `is_super_admin = true` users are not redirected to `/admin` automatically — they must navigate there manually and enter the PIN.

### Pitfalls

- `useAuth()` uses `maybeSingle()` — the `users.auth_id` column now has a `UNIQUE` constraint (`users_auth_id_unique`), so duplicate rows for the same `auth_id` are prevented at the DB level.
- Auth state is client-side only. There is no server-side session validation on dashboard pages. `AuthRedirect` handles the "valid JWT but no `users` row" case by signing the user out and redirecting to `/login?error=account_incomplete`, but pages that do not use `AuthRedirect` (e.g. direct deep-links to dashboard routes) may still show a loading spinner indefinitely in this scenario.
- Staff created via `/api/staff/create` get a temporary password. There is no forced password-change flow.

---

## 5. Flow 3 — Customer Ordering (QR Scan)

**Route:** `/r/[restaurant_id]/t/[table_id]`

### Pre-checks (server-side, page.tsx)

```
1. getRestaurant(restaurant_id)
   └─ If null → 404 (not-found.tsx)
   └─ If is_active=false → friendly "Restaurant is currently closed" screen
        (shows restaurant name, table number, and a message to check back later)
2. getTable(restaurant_id, table_id)
   └─ If null → 404
3. getMenuItems(restaurant_id) — only is_available=true items
4. Floor info fetched for price_multiplier display
```

### Table Occupancy Check (client-side)

```
On mount (gated on sessionLoaded from useCustomerSession):
  useCustomerSession() reads sessionStorage and sets sessionLoaded=true in the same effect.
  OrderPageClient waits for sessionLoaded before running the occupancy check, so
  customerInfo is always up-to-date when the check fires.

  checkTableHasUnpaidOrders(table_id)
  └─ If true AND customerInfo is null (no session for this browser)
     → tableOccupied = true → shows "Table is occupied" screen
  └─ If true AND customerInfo is set (this browser owns the session)
     → normal flow
  └─ If false → normal flow
```

### Geo-fencing (if enabled)

```
useGeofence() calls browser navigator.geolocation.getCurrentPosition()
  └─ status: 'checking' | 'inside' | 'outside' | 'error' | 'disabled'
  └─ If 'outside' (status === "denied", provably outside radius) → cart "Add" buttons are disabled
  └─ If 'error' (permission denied) → shows a soft amber warning but does NOT block ordering
  └─ If geofencing_enabled=false → skipped entirely

Options: { enableHighAccuracy: true, timeout: 10s, maximumAge: 10s }
  └─ maximumAge: 10s — browser cached position older than 10 s triggers a fresh GPS fix
     (previously 60 s; reduced to avoid stale location allowing entry from outside the fence)
```

### Menu Browsing

```
- Menu items displayed as cards (MenuItemCard)
- Real-time updates via useRealtimeMenu() → channel: manager:{restaurant_id}
  - INSERT → adds item to list
  - UPDATE → patches name/price/availability in place
  - DELETE → removes from list; calls invalidateCartItem(itemId) before removal
            (invalidates the cart item and fires onItemInvalidated callback so the UI can show a warning banner)
- Unavailable items hidden (is_available=false filtered server-side)
- Tags shown as badges (veg, spicy, bestseller, etc.)
- Floor price_multiplier shown as info badge if > 1.0
```

### Cart & Order Placement

```
Tab: "Menu" (default) | "Orders"

Cart state managed by useCart(priceMultiplier, tableId, onItemInvalidated?) — persisted to
sessionStorage under the key `cart_{tableId}` so the cart survives page refreshes within the
same tab. The `priceMultiplier` (floor's `price_multiplier`, default 1.0) is passed in so the
cart's `totalPrice` matches the floor-adjusted prices shown on `MenuItemCard`.
When `tableId` is not provided (e.g. manager add-order modal), the hook falls back to
in-memory only (no persistence).
The optional `onItemInvalidated(itemId)` callback is fired when a cart item is removed via
`invalidateCartItem()` — used to surface a toast/banner to the customer.

Add to cart → CartDrawer (bottom sheet, expandable)

On "Place Order":
  Case A — No saved customer info (first order):
    → Step "info": collect name (required), phone (required), party size (optional)
    → Validate: name non-empty, phone non-empty, party_size in range 1–50 (enforced in handleInfoSubmit)
    → submitOrder()

  Case B — Saved customer info (sessionStorage):
    → Skip form, call submitOrder() directly

submitOrder():
  1. POST /api/orders (server-side route — enforces rate limiting)
     └─ If HTTP 429 → shows error step immediately (rate limit exceeded)
     └─ If non-2xx → id = null (treated as failure)
     └─ On network error → id = null
     └─ On success → id = data.result
  2. /api/orders internally calls placeOrder() → lib/api.ts:
     a. check_table_has_unpaid_orders(table_id, customer_phone)
        └─ If true → returns 'UNPAID_ORDERS_EXIST' → shows error step
     b. getRestaurant() → determine routing mode
     c. INSERT into orders (status = 'pending' or 'pending_waiter')
     d. calculate_item_prices_batch() RPC → applies floor multiplier
        └─ Falls back to fetching floor multiplier directly from DB if RPC fails
        └─ If DB fetch also fails, order is aborted (returns null) — no silent base-price fallback
     e. INSERT into order_items
  3. On success → save customer info to sessionStorage
               → show success screen (2.5s) → clear cart → back to menu
```

### Order Status Tracking

```
Tab: "Orders"
  - useCustomerSession() loads active orders from sessionStorage
    └─ Query: billed_at IS NULL AND status != 'cancelled'
       Cancelled orders are excluded — they do not appear in the customer's active order list
  - useRealtimeOrderStatus() subscribes to channel: customer:{restaurant_id}:{table_id}
  - OrderStatusTracker shows visual progress bar:
    pending → confirmed → preparing → ready → served
    (cancelled is a terminal state — order is excluded from the active list entirely)
  - Customers can cancel orders in 'pending' or 'pending_waiter' status via a Cancel button
    in OrderStatusTracker. The DB RLS policy 'customers_can_cancel_pending_orders' enforces this.
  - Session clears from sessionStorage when all orders have billed_at set
    (cancelled orders are excluded from this check — they never block session clear)
```

### Variations

- **Multiple orders same session:** Customer can place additional orders. The billing safety check uses `customer_phone` to scope — same phone = same customer = allowed. Different phone = blocked.
- **No phone number:** If customer skips phone, billing safety check uses `null` phone — any unpaid order at the table blocks them.
- **Menu item deleted mid-session:** Real-time DELETE removes it from the displayed list. If the item is in the cart, `useRealtimeMenu()` calls `invalidateCartItem(itemId)` on `useCart`, which removes it from the cart and fires `onItemInvalidated` so the UI can show an amber warning banner. This prevents the FK constraint failure that would otherwise occur at `order_items` INSERT.
- **Floor pricing:** `calculate_item_prices_batch()` applies `floor.price_multiplier`. If the table has no `floor_id`, multiplier defaults to 1.0. The same multiplier is passed to `useCart(priceMultiplier)` so the cart total shown to the customer is consistent with per-item prices before the order is submitted.

### Pitfalls

- Cart is persisted to `sessionStorage` (key: `cart_{tableId}`) and survives page refreshes within the same tab. It is cleared on successful order placement or when `tableId` is not provided.
- `tableOccupied` check is resolved via a one-shot `useEffect` after the first render cycle — no arbitrary delay. Fast loads will not flash the normal UI before the occupied screen appears.
- Geo-fencing relies on browser geolocation. `geoBlocked` only triggers when `status === "denied"` (provably outside the radius). If the user denies permission (`status === "error"`), a soft amber warning is shown but ordering is not blocked.
- `sessionStorage` is tab-scoped. Opening the QR link in a new tab loses the session — the table will appear occupied to the new tab.
- If `calculate_item_prices_batch()` RPC is unavailable, the floor multiplier is fetched directly from the DB. If that also fails, the order is aborted (returns null) — no silent base-price fallback.
- `party_size` is validated in `CartDrawer.handleInfoSubmit` (range 1–50). A DB CHECK constraint `orders_party_size_check` also enforces this range server-side.
- Menu items with `is_available=false` are hidden from customers but can still be in the DB. If a manager marks an item unavailable after a customer adds it to cart, the cart still shows it — the order will succeed (price is stored at order time), but the kitchen will see an item that's technically unavailable.
- **Rate limiting (G5):** Order submission goes through `POST /api/orders` (server-side) rather than calling `placeOrder()` directly from the client. This allows the server to enforce rate limiting. If the server returns HTTP 429, `CartDrawer` transitions to the error step immediately — no retry is attempted. The customer must wait before trying again.

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
  └─ INSERT → fetches single order directly (no artificial delay — queries the order row
               immediately; order_items are joined in the same select)
             → concurrent fetches for the same order are deduplicated via fetchingRef
               (if a fetch is already in-flight for an order ID, the duplicate is dropped)
             → upserts into list; prepends if new, patches if already present
             → 4s highlight animation via newOrderIds set
  └─ UPDATE → if order is on the board:
               - status still kitchen-relevant → patches status in-place
               - status left kitchen scope (e.g. served/cancelled) → removes from board
             if order is NOT on the board and new status is kitchen-relevant
               (e.g. pending_waiter → confirmed) → full re-fetch + upsert with highlight
               (also deduplicated via fetchingRef)
```

### Header Controls

The kitchen header (sticky, top of screen) provides:

- **Restaurant name + staff name** — identity confirmation at a glance.
- **Live / Offline indicator** — green "Live" (Wifi icon) when the real-time channel is connected; red "Offline" (WifiOff icon) when disconnected.
- **Refresh button** — triggers a full re-fetch of all kitchen orders. Use when the real-time channel drops.
- **Mute / Unmute button** — toggles notification sounds (Volume2 / VolumeX icon). Mute state is persisted to `localStorage` under `notification_sounds_muted` and survives page reloads. See [Notification Sounds & Vibration](#notification-sounds--vibration) for sound details.
- **Sign Out button** — ends the session.

### Order Actions

```
Each OrderCard shows action button based on current status:
  pending    → "Confirm"   → status: confirmed
  confirmed  → "Preparing" → status: preparing
  preparing  → "Ready"     → status: ready
  ready      → (no action — waiter marks served)
  cancelled  → (no action — terminal state, grey card style)

Kitchen can also reject orders from 'pending' or 'confirmed' status:
  pending / confirmed → "Reject" button → status: cancelled
  ORDER_STATUS_TRANSITIONS allows 'cancelled' from 'pending', 'pending_waiter', and 'confirmed'.
  The DB trigger validate_order_status_transition was updated to match.
  The order is removed from the board optimistically and set to 'cancelled' in the DB.

advanceStatus():
  1. Capture actual previous status from state inside the setOrders callback (atomic)
  2. Optimistic update (instant UI)
  3. updateOrderStatus() → PATCH orders.status
  4. On failure → rollback to the captured previous status
  5. On success → real-time subscription confirms; no re-apply to avoid double-render flicker
```

### Variations

- **Direct-to-kitchen mode:** Orders arrive as `pending` — kitchen sees them immediately.
- **Waiter-first mode:** Orders arrive as `pending_waiter` — kitchen does NOT see them until waiter accepts. When the waiter accepts, the status transitions to `confirmed` and the UPDATE handler detects the order is not yet on the board, triggering a full re-fetch so the kitchen sees it with a 4s highlight.
- **New order highlight:** New orders get a pulsing border for 4 seconds via `newOrderIds` set.
- **Urgency coloring:** Active orders (not `ready`/`served`/`pending_waiter`) change border color based on age — amber border + tint at ≥12 minutes, red border + tint at ≥20 minutes. Cards re-render every 60 seconds to keep urgency state current. The urgency class takes precedence over the status-based border color.
- **Cancelled card style:** `cancelled` has a dedicated grey card style in `statusConfig` (no action button) in both `OrderCard` (kitchen) and `WaiterOrderCard` (waiter). Cancelled orders are normally removed from the board by the real-time UPDATE handler, but if one appears (e.g. race condition before removal), it renders gracefully rather than falling back to undefined.

### Pitfalls

- **Kitchen reject:** Kitchen staff can cancel (reject) an order from `pending` or `confirmed` status using the reject button on each `OrderCard`. `STATUS_CONFIG` has `canReject: true` for those two statuses; the button is hidden for all others. `KitchenClient` passes `rejectOrder` (from `useKitchenOrders`) as the `onReject` prop. The order is removed from the board optimistically and set to `cancelled` in the DB.
- If the real-time channel drops, new orders won't appear until manual refresh. The "Refresh" button triggers a full re-fetch.
- `advanceStatus()` captures the actual previous status from state inside the `setOrders` updater callback (atomic). The static `getPreviousStatus()` helper has been removed. Rollbacks use the real prior status rather than a derived guess. A concurrent update that changes the status between the capture and the rollback could still result in a stale rollback value.
- `fetchingRef` deduplicates concurrent `fetchAndUpsertOrder` calls for the same order ID — if a fetch is already in-flight, the duplicate is silently dropped rather than triggering a second full re-fetch.

---

## 7. Flow 5 — Waiter Dashboard

**Route:** `/waiter/[restaurant_id]`

**Protected by:** `ProtectedRoute` (role = `waiter`)

```
On load:
  useWaiterOrders(restaurant_id, currentWaiterId)
  └─ Fetches all relevant orders for this waiter
  └─ Returns isConnected flag for real-time connection status

Real-time:
  Subscribes to channel: waiter:{restaurant_id}
  Event: order_changed
  
  Connection indicator:
    - isConnected = true → Shows "Live" with Wifi icon (green)
    - isConnected = false → Shows "Offline" with WifiOff icon (red)

  On INSERT event:
    - Fetches the full order by ID
    - If order is assigned to another waiter → skip (never shown)
    - If order is unassigned → checks whether the table has an open session owned by
      another waiter (query: table_sessions WHERE table_id=order.table_id AND closed_at IS NULL)
      - If session.waiter_id belongs to another waiter → skip; the auto-assign trigger
        will assign the order shortly and the UPDATE event will handle visibility
      - Otherwise → add to list (prepend)

  On UPDATE event:
    - If order exists in local state:
        - billed_at is set → remove from list (billing is terminal for the waiter board)
        - status = 'served' or 'cancelled' → remove from list (terminal state)
        - waiter_id changed to another waiter → remove from list (reassigned)
        - otherwise → update status/waiter_id in place
    - If order does NOT exist in local state:
        - waiter_id = currentWaiterId AND billed_at is NOT set AND status is not
          'served'/'cancelled' → fetch full order and add to list (newly assigned)
        - Guard: orders that are already billed, served, or cancelled are never
          re-added even if a late assignment event arrives
```

### Two Sections

```
"My Orders"
  └─ orders WHERE waiter_id = currentWaiterId
  └─ Excludes: status IN ('served', 'cancelled')
  └─ Actions: Mark Served (status: ready → served)

"Available to Accept" / "Needs Attention" / "Ready to Serve"  (label varies by mode)
  └─ orders WHERE waiter_id IS NULL
     AND (
       status IN ('pending_waiter', 'ready')
       OR status = 'confirmed'  -- broadcast mode only
     )
  └─ Actions:
     - "Take Order" (assign to self, open table session)
     - "Accept Order" (pending_waiter → confirmed, waiter_first mode only)
```

Section label by mode:
- `waiter_first` + `broadcast` assignment → **"Available to Accept"**
- `waiter_first` + other assignment → **"Needs Attention"**
- `direct_to_kitchen` → **"Ready to Serve"**

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

- **Direct-to-kitchen mode:** Waiters still see orders in "Ready to Serve" (status=`confirmed` or `ready`) to mark served. They don't need to accept.
- **Waiter-first mode (non-broadcast):** Waiters see `pending_waiter` orders in "Needs Attention" and must accept before kitchen sees them.
- **Waiter-first mode (broadcast):** Waiters see both `pending_waiter` and `confirmed`-but-unassigned orders in "Available to Accept". Any waiter can claim an unassigned confirmed order via "Take Order".
- **Auto-assignment:** `auto_assign_waiter_from_session` trigger fires on order INSERT — if the table already has an open `table_session` with a `waiter_id`, the new order is automatically assigned to that waiter.

### Pitfalls

- Two waiters can both see the same "Available" order simultaneously. `assign_order_to_waiter()` uses an advisory lock, so only one will succeed — the other gets an error shown as a red error banner below the header in `WaiterClient`.
- A waiter who is `is_active=false` can still log in and see orders. No active-status enforcement in the dashboard.
- `markServed` now checks `currentOrder.status !== "ready"` before the optimistic update. If the order is not ready, it sets an error message and returns early. On DB failure, it rolls back and shows "Could not mark order as served. Please try again."

---

## 8. Flow 6 — Manager Dashboard

**Route:** `/manager/[restaurant_id]`

**Protected by:** `ProtectedRoute` (role = `manager`)

The dashboard has a sidebar nav (desktop) and bottom nav (mobile) with 4 groups. Nav groups are built dynamically via `buildNavGroups(pendingCount, onOrdersBadgeClick)` — the **Orders** item shows a live badge with the count of pending orders; the badge is hidden when there are none. When the badge is visible, clicking it invokes `onOrdersBadgeClick` (e.g. to jump directly to the Orders tab).

**Tab navigation is URL-synced.** All tab changes (sidebar, mobile bottom nav, "Manage Plan" shortcut, and the Orders badge click) go through `handleTabChange(tab)`, which calls both `setActiveTab(tab)` and `router.replace(?tab=<tab>)`. This means the active tab is reflected in the URL query string (`?tab=sessions`, `?tab=menu`, etc.), enabling deep-linking and browser back/forward navigation. On initial load, the active tab is read from `searchParams.get("tab")`, defaulting to `"sessions"` if absent.

**AppHeader** (`components/layout/AppHeader.tsx`) is shared across all role dashboards (manager, waiter, kitchen) and provides:

- **Page title + description** — rendered in the left section of the header.
- **Profile dropdown** — clicking the avatar/name reveals a dropdown with the user's name, role, and a **Sign Out** button that calls the `onSignOut` prop.
- **Sidebar footer Sign Out** — `AppSidebar` also renders a **Sign Out** button at the bottom of the sidebar (below the nav links) when `onSignOut` is provided, giving desktop users a persistent, always-visible sign-out option without opening the header dropdown.
- **Theme toggle** — switches between light and dark mode.

> Note: The command palette (`⌘K`), notification bell, and `ChevronDown` on the profile button were removed. Navigation is handled exclusively by the sidebar. The `notificationCount` and `onNavigate` props no longer exist on `AppHeader`.

### Operations Group

**Live Tables (`sessions` tab)**
```
TableSessions component
Props:
  restaurantId          — required; scopes all data fetching and realtime subscriptions
  billReadyFilter?      — optional boolean; when true, activates the "bill-ready only" filter on mount
  onBillReadyFilterClear? — optional callback; called immediately after the filter is applied so the
                            parent can reset its own state (prevents re-triggering on re-renders)

- Shows all tables in grid view, filterable by floor
- Grid layout is configurable: Cols selector (2–6 columns) and Rows selector (1–5 rows per page)
  - Changing either resets to page 1
  - On mobile (< md breakpoint) the grid is always 2 columns regardless of the Cols selector; the selector only takes effect on md+ screens
- Each table tile has one of five states:
    free        — no active session (or all orders at the table are cancelled)
    active      — session open, orders in progress
    awaiting    — session has pending/pending_waiter orders needing attention
    bill-ready  — all orders served and unbilled; ready to generate bill
    billed      — all orders billed (session closing)
  Note: cancelled orders are excluded when building the session map. A table whose
  only orders are all cancelled will not appear as "active" — it shows as "free".
- Each occupied table shows: waiter name, order count, total amount, session duration
- Selecting a tile opens a detail panel with customer info, order list, and "Generate Bill" action
- "Generate Bill" button → generate_bill() for all served orders at that table
- Managers can place new orders directly from the table detail panel via the "Add Order" modal:
  - Opens a full-screen modal scoped to the selected table session
  - Loads all available menu items via `getMenuItems()`
  - Supports live search/filter across menu items
  - Manager builds a cart (increment/decrement per item), sees running total
  - On submit: calls `placeOrder()` with the session's `customer_name`, `customer_phone`, and `party_size` pre-filled
  - Error case: if another customer has unpaid orders at the table (`UNPAID_ORDERS_EXIST`), an inline error is shown and the order is not placed
  - On success: modal closes and the table session refreshes (`load(true)`)
- Past sessions collapsible section shows billed history per table
```

**Order Log (`orderlog` tab)**
```
OrderLog component
- Fetches one page (PAGE_SIZE rows) at a time from the DB — server-side pagination.
  Date range, status filter, and sort order are applied server-side where possible:
    - Date range: `.gte`/`.lte` on `created_at`
    - Status filter: `.eq("status", ...)` (skipped when "all" is selected)
    - Sort: DB column for created_at and total_amount; table_number and turnaround_s
      fall back to created_at server-side (those are computed/joined fields)
  Full joins: tables → floors, waiter (users), order_items → menu_items
  Response includes `count: "exact"` so the total row count is known without
  fetching all rows.
- Computes derived fields client-side:
    wait_to_confirm_s, prep_time_s, serve_time_s, turnaround_s
- Billing fields mapped from DB onto each row:
    discount_amount (numeric, default 0), discount_note (text | null),
    payment_method ('cash' | 'card' | 'upi' | null)
    These are set at billing time and available in the order detail drawer.
- Session fields (session_id, session_opened_at) are always null in the row
    data — the table_sessions join was removed from the main query. Session
    summary data for the detail drawer is fetched separately on demand (see
    "Table Session block" below) and is not part of the paginated row data.
- SORT_COLUMN map translates client SortKey values to DB column names

Order ID format: #ORD-XXXX (first 4 chars of UUID, uppercased)

Stat cards (top of view):
  - Total Orders, Total Revenue, Avg. Order Value, Pending Orders
  - Computed directly from `rows` (server already scopes rows to the selected date range; no secondary client-side date filtering needed)
  - Sub-labels are dynamic:
      Total Orders  → shows the active date segment label (e.g. "Today", "Last 7 days",
                       or "MMM D – MMM D" for custom ranges)
      Total Revenue → shows count of served orders in the range
      Avg. Order Value → shows "across N orders" or "No orders"
      Pending Orders   → shows "Need attention" or "All clear"

Status tabs:
  All | Preparing | Ready | Served | Cancelled
  - Each tab shows a live count badge
  - Selecting a tab filters the table; resets to page 1
  - Note: "Awaiting" (pending_waiter) tab removed; cancelled orders now
    have a dedicated tab

Date filter toolbar:
  - Segments: Today | Yesterday | Last 7 days | Last 30 days | Custom
  - Custom range: two date inputs (from / to), applied on selection
  - Filters are applied server-side (`.gte`/`.lte` on `created_at`)
  - Changing the date range resets to page 1 and triggers a fresh server fetch
  - Helper functions: startOfDay / endOfDay / getSegmentRange / fmtDate / toInputDate
    (defined in OrderLog.tsx)

Search & sort toolbar:
  - Free-text search across: order ID, table number, floor name,
    waiter name, customer name, customer phone, item names
  - Search is applied client-side against the current page's rows
  - Sortable columns: Table, Amount, Time (created_at)
  - Sort toggles asc/desc; defaults to created_at DESC
  - Changing sort resets to page 1 and triggers a fresh server fetch

Pagination:
  - PAGE_SIZE rows per page, server-side (DB `.range()` call)
  - Total count comes from Supabase `count: "exact"` — reflects the full
    filtered dataset, not just the current page
  - Shows page range and total count

Real-time:
  - Subscribes to postgres_changes on orders table
    (filter: restaurant_id=eq.{restaurantId})
  - INSERT → full re-fetch of the current page (to get joined data and updated count)
  - UPDATE → targeted single-order re-fetch via `refetchOrder(orderId)`:
      fetches the one changed row with all joins so waiter_name, floor_name,
      and order_items are always fresh (not just raw orders columns)
  - selectedOrder kept in sync: `refetchOrder` also updates the drawer if open

Order detail drawer:
  - Slides in from the right (portal into document.body)
  - Backdrop click closes it
  - Renders OrderDetailPanel (inline component in OrderLog.tsx)
  - Stays in sync: if the selected order's status changes via real-time,
    the drawer reflects the update immediately
  - Action buttons (bottom of panel):
      "Cancel Order" — always visible (destructive, red border)
      Advance action — shown for pending/pending_waiter/confirmed/preparing/ready:
        pending / pending_waiter → "Confirm Order"
        confirmed               → "Start Preparing"
        preparing               → "Mark as Ready"
        ready                   → "Mark as Served"
      No advance action shown for served or cancelled orders
  - Table Session block (shown when order has a billed_at):
      Displayed as a bordered card below the billing timestamp row.
      Header: "Table Session" label + short session ID (first 8 chars of UUID,
        uppercased, monospace) when session_id is present.
      Body: fetches a session summary (sessionSummary) asynchronously on open;
        shows a spinner while loading (sessionLoading).
      When sessionSummary is available, shows:
        - Session opened time (HH:MM)
        - Orders in session count (only shown when > 1)
        - All Items breakdown (always shown):
            header: "All Items (N total)" where N is the sum of all item quantities
            items are merged across all sibling orders by name+price (duplicates
              aggregated into a single row with combined quantity)
            each row: "{qty}× {name}" on the left, line total (qty × price) on the right
            falls back to "No items recorded for this session" when items list is empty
        - Session gross total (sum of all order_totals in the session)
        - Discount row (only shown when total_discount > 0):
            label uses discount_note if present, otherwise "Discount applied"
            icon: Tag (lucide)
        - Session net total (gross − discount); green when 0, primary colour otherwise
        - Payment method row (only shown when set):
            icon: Smartphone (UPI) / CreditCard (card) / Banknote (cash)
      When sessionSummary is null (no data or no session_id), falls back to
        plain text: "Billed as part of table session"
```

Status badge colours (display label → colour):
  pending        → amber  [label: "New Order"]
  pending_waiter → purple [label: "Awaiting Waiter"]
  confirmed      → blue
  preparing      → orange
  ready          → green
  served         → blue (same as confirmed)
  cancelled      → red

**Analytics (`analytics` tab)**
```
Analytics component
- Date range selector: today / last 7 days / last 30 days
- KPI cards: total revenue, total orders, avg order value — each with % delta vs. prior period
- SVG area chart for revenue or orders over the selected period — real data points shown as filled circles; estimated/projected segments rendered as a dashed line with reduced opacity
- Top 6 menu items by quantity sold (with revenue) — aggregated server-side by the get_analytics_summary RPC
- Hourly traffic SVG bar chart (real data scoped to selected range, peak hour highlighted in orange; bar colour intensity scales with relative order volume; header shows total orders + peak hour summary; legend shows Peak/High/Low traffic indicators)
- Waiter performance cards: orders handled, revenue generated, and avg revenue per order — scoped to selected date range; empty state shown as a dashed placeholder when no waiter data exists for the period
- Payment method split: cash / UPI / card (donut chart + breakdown) — scoped to selected date range
- Order status distribution (donut chart) — scoped to selected date range
- Average prep / serve / turnaround times from getPerformanceMetrics()
- Hourly traffic uses real data only; hours with no orders render as zero (no baseline blending); empty state renders a dashed bordered placeholder with "No order data in this period"
- Range tab switches are debounced by 300 ms to prevent duplicate in-flight requests
```

> **Architecture:** All analytics aggregation is performed server-side via a single `get_analytics_summary(p_restaurant_id, p_range_start, p_range_end, p_prev_start, p_prev_end)` Postgres RPC. This replaces the previous approach of 9 parallel client-side Supabase queries. The RPC returns a single JSON object with keys: `curr_sales`, `prev_sales`, `top_items`, `daily_data`, `waiter_stats`, `payment_split`, `status_counts`, `hourly_traffic`. If the RPC returns an error the load function logs it and returns early — no partial state is applied.

> **Note:** All scoping (date range, restaurant) is enforced inside the RPC. Hourly traffic hours with no orders render as zero bars. The `get_analytics_summary` RPC must exist in the database; if it is missing the component will log an RPC error and show no data (no silent fallback to raw queries).

### Menu Group

**Menu Items (`menu` tab)**
```
MenuManager component
- List all menu items (including unavailable) in an expanded table with columns:
  Item name + thumbnail | Price | Description | Image | Categories | Tags | Available | Actions
- Add item: name, price, description, image_url, tags, is_available
- Edit item inline: clicking the edit (pencil) icon on a row expands it into an editable
  row in-place — no modal. Fields: name, price, description, image upload, category
  multi-select (pill toggles), tag multi-select (pill toggles). Save (✓) / Cancel (✗)
  buttons in the Actions cell. Availability toggle remains live during inline edit.
- Toggle availability (is_available) — toggle switch visible in both view and edit rows
- Delete item (blocked if referenced by existing order_items — FK constraint)
- Image upload via <ImageUpload> component (see Shared UI Components below)
- Real-time: menu changes broadcast to customer pages instantly
- State updates: after add/edit, the local items list is NOT patched optimistically.
  The postgres_changes Realtime subscription reloads the list when the DB write lands.
```

**Bulk Edit mode (button inside Menu Items tab)**
```
Triggered by the "Bulk Edit" button in the Menu Items tab header (only shown when items exist).
- On enter: fetches categories and tags for every item in parallel via getMenuItemCategories /
  getMenuItemTags, then sets bulkEdits Map and flips bulkMode=true. A blue info banner is shown.
- All rows switch to the shared renderEditRow layout simultaneously (same inline fields as
  single-row edit: name, price, description, image upload, category pill-toggles, tag
  pill-toggles, availability toggle).
- "Save All" button calls saveAllBulk(): iterates all items in parallel, calling updateMenuItem
  + setMenuItemCategories + setMenuItemTags per row. On completion, bulkMode is cleared.
- "Cancel" discards all unsaved changes and returns to read-only view.
- While saving, all inputs are disabled and a spinner replaces the Save All label.
- Pitfall: saveAllBulk fires all updates in parallel — if the menu is very large this can
  produce many concurrent DB writes. No per-row error recovery; a failed row is silently
  skipped (saving flag is reset but the row is not highlighted).
- Single inline edit (Edit icon per row) is unavailable while bulk mode is active; entering
  bulk mode clears any open single-row edits.
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
- Delete floor: prompts confirmation, then calls deleteFloor(floorId)
  → If the delete fails (e.g. tables still assigned to the floor), shows an alert:
    "Failed to delete floor. Make sure all tables are unassigned first."
  → fetchFloors() is only called on success, so the list stays consistent on failure
```

### Team & Setup Group

**Staff (`staff` tab)**
```
StaffManager component
- List all staff (waiters + kitchen); each card shows name, role, active orders, and last-active time (derived from `last_action_at` — displayed as "just now / Xm ago / Xh ago / date")
- Active order count excludes `cancelled` orders and orders with `billed_at` set — only genuinely in-progress orders (not served, not cancelled, not billed) are counted toward a staff member's busy/available status
- Orders are fetched via the `orders_waiter_id_fkey` foreign key relation to ensure only orders assigned to that waiter are included
- Create staff: POST /api/staff/create
  → Creates Supabase Auth user with temp password
  → Creates users row (role, restaurant_id, auth_id)
- Edit staff: PATCH /api/staff/update
  → Updates name and/or email in the users table
  → If email changes, also updates the Supabase Auth account via service role key (best-effort; profile update is not rolled back if auth update fails)
  → Scoped to the restaurant via restaurantId + userId ownership check
- Toggle is_active (soft disable)
- Delete staff: `DELETE /api/staff/delete` — removes the `users` row then deletes the Supabase Auth account via the service role key; scoped to the restaurant to prevent cross-tenant deletes; manager accounts are blocked from deletion via this route; fires `staff.deactivated` webhook event (non-blocking) with `{ user_id, role }` payload
```

**Table Setup (`tables` tab)**
```
TablesManager component
- Add/remove tables
- Set table capacity
- Assign floor
- Generate QR code URL per table
- QR URL format: /r/[restaurant_id]/t/[table_id]
- Plan limit enforced via useSubscription(restaurantId):
    atLimit = !isPro && tables.length >= limits.max_tables
    → "Add Table" button disabled and UpgradeBanner shown when atLimit is true
    → Free plan: max_tables=5; Pro/trialing: unlimited
```

### Restaurant Group

**Details (`details` tab)**
```
RestaurantDetails component
- Edit restaurant name
- Edit slug (URL-friendly identifier)
- Upload restaurant logo via <ImageUpload> component (bucket: restaurant-logos, path: {restaurant_id}/logo.{ext}); saved to restaurants.logo_url
```

**Settings (`settings` tab)**
```
SettingsPanel component
- Order routing mode: direct_to_kitchen | waiter_first
  Switching to 'direct_to_kitchen' calls updateRestaurantRoutingMode(), which also invokes
  the migrate_pending_waiter_orders(restaurant_id) RPC to migrate any orphaned
  'pending_waiter' orders to 'pending' so they appear in the kitchen queue immediately.
- Geo-fencing: enable/disable, set lat/lng/radius, auto-detect via browser geolocation
- Auto-confirm Orders: enable/disable; set delay in minutes (1–60); new orders in "New" status
  are automatically confirmed after the configured delay
- Activity Log: "View Activity Log" button opens a centered modal Dialog (80 vw × 85 vh) containing AuditLogPanel,
  showing a tamper-evident record of all significant actions in the restaurant (scoped to the
  manager's own restaurant_id). Supports date range presets, severity/actor/action filters,
  free-text search, pagination, and CSV export.
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
- Analytics data is fetched via a single `get_analytics_summary` Postgres RPC. Performance on large datasets depends on the RPC's internal query plan and indexes — if the RPC is missing or errors, the component logs the error and shows no data.
- Staff deletion goes through `DELETE /api/staff/delete` (service role key). The `users` row is deleted first; the Supabase Auth account is then deleted best-effort. If the auth deletion fails, a warning is logged server-side but the operation still returns success — the profile row is already gone so the orphaned auth account will land on `/onboarding` if it tries to log in.
- Staff email edits go through `PATCH /api/staff/update` (service role key). The `users` table is updated first; the Supabase Auth email is then synced best-effort. If the auth update fails it is logged server-side but the API still returns success — the staff member's login email may temporarily differ from their profile email until manually corrected.
- The QR code URL is stored as `qr_code_url` in the `tables` table but is just a plain URL string — there is no actual QR image generation in the DB. The frontend must generate the QR image from this URL.
- Changing `order_routing_mode` takes effect immediately for new orders only — `getRestaurant` no longer caches results, so every call fetches fresh data from the database. When switching to `direct_to_kitchen`, `migrate_pending_waiter_orders(restaurant_id)` is called automatically to migrate any orphaned `pending_waiter` orders to `pending` so they appear in the kitchen queue.
- Changing `waiter_assignment_mode` takes effect immediately for the next order — `getRestaurant` always reads from the database directly so no cache invalidation step is required.
- The routing mode Cancel button resets to `savedRoutingMode` (the last successfully persisted value), not `currentRoutingMode`. This ensures that cancelling an unsaved change always restores the actual saved state, even if the local state was mutated before saving.

### Shared UI Components

**`<ImageUpload>` (`components/ui/ImageUpload.tsx`)**

Reusable image picker used wherever an image URL needs to be captured (menu items, categories/tags, restaurant logo).

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `value` | `string` | — | Current image URL; empty string = no image |
| `onChange` | `(url: string) => void` | — | Called with public URL after upload, or `""` on remove |
| `bucket` | `string` | `"menu-images"` | Supabase Storage bucket name |
| `folder` | `string` | `"uploads"` | Path prefix inside the bucket |
| `className` | `string` | — | Optional wrapper class |

- Accepts drag-and-drop or click-to-browse.
- Validates: image MIME type only, max 5 MB.
- Uploads via `supabase.storage.from(bucket).upload(path, file, { upsert: true })`.
- Path format: `{folder}/{timestamp}-{random}.{ext}` — unique per upload, no collisions.
- Displays a 96×96 px preview with an ×-button to clear the URL.
- Shows inline error text on validation or upload failure.

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
  └─ Called after ALL non-cancelled orders at the table are billed
     (cancelled orders are excluded from this check and never block session close)
```

### Billing Flow

```
Manager: Live Tables tab → "Bill (N)" button → BillDialog

BillDialog (components/manager/BillDialog.tsx):
  - Shows unbilled orders, payment method selector, and optional discount input
  - If any orders are not yet in 'served' status (nonServedCount > 0):
    → Shows "Manager override" checkbox (amber warning banner)
    → Label: "Manager override — bill N unserved order(s)"
    → Sub-text: "These orders will be marked as served automatically before billing.
                 Use this when a customer leaves before the waiter marks the order served."
    → forceOverride state (default: false)
    → When checked, bill_table() is called with force=true
    → When unchecked (default), only served orders are billed; unserved orders are skipped
  - Billing is atomic: BillDialog calls billTable(tableId, options) — a single atomic RPC
    (bill_table) that acquires row locks, bills all orders in one transaction, and closes
    the session. No per-order looping.

bill_table(table_id, { force?, paymentMethod?, discountAmount? }) RPC:
  1. Acquires row locks on all unbilled orders for the table
  2. If force=false (default): skips non-served orders
     If force=true: auto-advances non-served orders to 'served' before billing
  3. For each order: calculates total, sets total_amount and billed_at
  4. Closes the table session atomically
  5. Returns billing summary

generate_bill(order_id, { force? }) RPC (also available standalone):
  1. If force=false (default): checks order.status = 'served' (throws if not)
     If force=true: auto-advances non-served orders to 'served' before billing
  2. Calculates total: SUM(order_items.quantity * order_items.price)
  3. Sets orders.total_amount = calculated_total (net after discount)
  4. Sets orders.billed_at = now()
  5. Returns: order_id, total_amount, billed_at, success=true

After billing:
  - billed_at is set → order excluded from "unpaid" checks
  - When ALL non-cancelled orders at a table have billed_at set:
    → close_table_session() is called automatically
    → Customer sessionStorage session clears
    → Table shows as "free" in Live Tables
  - Cancelled orders are excluded from this check — they never block session close

Revenue dashboard (TableSessions):
  - Uses total_amount (net after discount) from the DB for billed orders
  - Does not recompute gross from items client-side

Per-order billing breakdown (TableSessions — order item list):
  - When an order has billed_at set, a breakdown section is shown below the item list:
      Subtotal  — gross sum of (price × quantity) for all items, computed client-side
      Discount  — shown only when discount_amount > 0; displays discount_note if present
      Net       — order_total (net after discount); highlighted green when 0 with a
                  "(Fully Discounted)" label when discount_amount > 0
  - This breakdown is display-only and does not affect stored values.

State update strategy (OrderBilling component):
  - No optimistic update is applied after billing succeeds.
  - The postgres_changes Realtime subscription on the orders table
    triggers a full re-fetch of both unbilled and billed order lists.
  - This ensures the UI always reflects the true DB state, at the cost
    of a small delay between billing and list refresh.
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

- `generate_bill()` requires `status = 'served'` by default. If a waiter forgets to mark an order served, the manager can pass `force=true` to auto-advance it to served before billing.
- Billing is atomic: `BillDialog` calls `billTable(tableId, options)` — a single `bill_table` RPC that acquires row locks and bills all orders in one transaction. There is no per-order looping.
- `total_amount` stored in the DB is the net amount after discount. The revenue dashboard (`TableSessions`) reads `total_amount` directly from the DB for billed orders — no client-side gross recomputation.
- Session close is triggered when all **non-cancelled** orders are billed. Cancelled orders are ignored. If any pending/preparing/ready/served order remains unbilled, the session stays open.
- Cancelled orders are also excluded when building the active session map in `TableSessions`. An unbilled cancelled order does not count toward a table's active session — a table with only cancelled orders (and no other unbilled orders) will appear as "free" rather than "active".
- If `close_table_session()` is not called after billing, the table remains "occupied" in the Live Tables view indefinitely.

---

## 10. Flow 8 — Subscription & Payments

### Plans

| Plan | Monthly Price | Yearly Price | Limits | Self-serve? |
|------|--------------|--------------|--------|-------------|
| Starter | ₹499/month | ₹399/month | 5 tables, 1 staff account | No — downgrade via support |
| Pro | ₹999/month | ₹799/month | 20 tables, 5 staff accounts, priority support | Yes |
| Business | ₹1,999/month | ₹1,599/month | 50 tables, 15 staff accounts, custom roles | No — contact sales |
| Enterprise | Custom | Custom | Unlimited tables & staff, dedicated account manager, API access | No — contact sales |

Yearly billing saves ~20% vs monthly. Business and Enterprise plans require contacting sales. Downgrading from Pro to Starter is not self-serve — users must contact support.

The `BillingPanel` component (`components/manager/BillingPanel.tsx`) renders the full billing page in the manager dashboard. Plan definitions (name, tagline, prices, features, CTA type) are fetched from the `plans` table via the `usePlans` hook (`/api/plans`) rather than being hardcoded in the component — icons are mapped client-side by plan `id` via `PLAN_ICONS`. It includes:
- Plan selector cards with monthly/yearly toggle (switching cycle resets any applied coupon). The price label on each card reflects the selected cycle: yearly billing shows "/mo (billed yearly)" while monthly billing shows "/month".
- Coupon input on the Pro card (for non-paid users — free, trialing, or expired); discount preview only shown when coupon actually reduces the price. Active paid Pro subscribers do not see the coupon input.
- Billing history table (from `payment_transactions`) — loads up to 50 rows, shows 4 by default with a "View All / Show Less" toggle
- Invoice download generates a formatted HTML `.html` receipt client-side (no server round-trip); includes plan, amount, status, and transaction ID in a styled monospace layout
- Right sidebar: current plan summary, payment method, editable billing address, support link

**Plan availability & CTA behaviour:**

| Plan | CTA | Action |
|------|-----|--------|
| Starter | "Contact Support" | Opens `mailto:support@qrorder.in?subject=Downgrade%20Request` — downgrade is not self-serve |
| Pro | "Upgrade — ₹X/mo" | Initiates PhonePe checkout with the selected billing cycle |
| Business | "Contact Sales" | Opens `mailto:support@qrorder.in` — not yet purchasable |
| Enterprise | "Contact Sales" | Opens `mailto:support@qrorder.in` |

The billing cycle (`monthly` / `yearly`) is passed to `startUpgrade()` so the correct PhonePe plan key (`pro_monthly` / `pro_yearly`) is used. An optional `planOverride` parameter can be passed to bypass the billing-cycle logic and use a specific plan key directly (e.g. for custom or legacy plans).

**Billing address:** Editable inline via a text input in the sidebar. On save, the value is persisted to `localStorage` under the key `billing_address_{restaurantId}` — it is not stored in the database.

**Payment method button:**
- Non-Pro users: clicking "Add Payment Method" triggers the Pro upgrade flow directly.
- Pro users: clicking "Update Payment Method" opens a support email (PhonePe does not support saved payment methods).

### Payment Providers

The platform supports two payment providers:

- **Stripe** — international cards, used globally
- **PhonePe** — UPI-based payments, targeted at Indian restaurants

PhonePe configuration is in `lib/phonepe.ts` and uses the official `pg-sdk-node` SDK (`StandardCheckoutClient`):

```
getPhonePeClient() → StandardCheckoutClient.getInstance(clientId, clientSecret, clientVersion, env)
  ↳ Resets the SDK singleton (_client = undefined) before each call so getInstance always
    picks up the current env credentials (the SDK checks === undefined, not null)
  clientId      → PHONEPE_CLIENT_ID env var
  clientSecret  → PHONEPE_CLIENT_SECRET env var
  clientVersion → PHONEPE_CLIENT_VERSION env var (default: 1)
  env           → PHONEPE_ENV=production → Env.PRODUCTION
                → otherwise             → Env.SANDBOX

PHONEPE_PLANS.pro_monthly:
  amountPaise: 99900  (₹999/month)

PHONEPE_PLANS.pro_yearly:
  amountPaise: 958800  (₹799/month × 12, billed annually)

PHONEPE_PLANS.pro:
  amountPaise: 99900  (same as pro_monthly)
```

Checksum generation and webhook verification are handled internally by the SDK — no manual SHA256/X-VERIFY logic is needed.

### Upgrade Flow (Stripe)

```
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

### Upgrade Flow (PhonePe)

```
BillingPanel → "Upgrade — ₹X/mo" (Pro card)

POST /api/phonepe/checkout:
  1. Validate coupon (if provided) via validate_coupon() RPC
     - plan key is normalised to base plan before validation:
       "pro_monthly" / "pro_yearly" → "pro"  (strips _monthly / _yearly suffix)
  2. Apply discount → compute finalAmountPaise
  3. Generate merchantOrderId (uuid)
  4. Resolve plan key from billing cycle (or planOverride if provided):
       planOverride        → use directly
       billing='monthly'  → PHONEPE_PLANS.pro_monthly (₹999/month)
       billing='yearly'   → PHONEPE_PLANS.pro_yearly  (₹799/month × 12)
  5. Call PhonePe SDK: standardCheckout.initiatePayment(request)
  6. Store pending transaction on subscriptions row (conditional):
     - If existing subscription status is NOT 'trialing':
         upsert subscriptions (plan='free', status='incomplete', phonepe_transaction_id, pending_coupon_id)
     - If existing subscription status IS 'trialing' (user upgrading mid-trial):
         update only phonepe_transaction_id and pending_coupon_id — preserves the trialing status so the
         user's active trial is not clobbered before payment completes. The webhook/verify step will
         upgrade the row to status='active' once payment succeeds.
  7. Insert payment_transactions row:
     - status='pending', amount_paise, coupon_code
     - coupon_duration_days (if coupon has a duration override — used by /verify and webhook to extend current_period_end)
  8. Return checkout URL

Client (useSubscription.startUpgrade):
  - Signature: startUpgrade(returnUrl, couponCode?, billingCycle?, planOverride?)
  - planOverride (optional): if provided, used as the plan key directly, bypassing billingCycle logic
  - Otherwise resolves plan key from billingCycle: 'monthly' → pro_monthly, 'yearly' → pro_yearly
  - returnUrl is set to /api/phonepe/popup-callback?orderId=<merchantOrderId> (not the caller's page)
  - Opens checkout URL in a narrow 400×750 popup window (mobile-sized so PhonePe renders its mobile payment UI)
  - Falls back to full-page redirect if the popup is blocked by the browser
  - Listens for a `postMessage` from the popup (type: 'PHONEPE_CALLBACK'):
      → Popup calls /api/phonepe/verify with the orderId to confirm payment server-side
      → Posts { type, orderId, success } to window.opener, then closes itself
      → Parent receives the message, calls verify, and updates local state

POST /api/phonepe/verify (popup flow — no webhook dependency):
  → Calls PhonePe SDK getOrderStatus(merchantOrderId)
  → On COMPLETED:
       - Reads payment_transactions: plan, coupon_code, coupon_duration_days
       - Computes current_period_end (monthly/yearly + coupon duration_days if set)
       - Upserts subscriptions: plan='pro', status='active', trial_used=true, pending_coupon_id=null
       - Updates payment_transactions.status = 'completed'
       - Reads subscriptions.pending_coupon_id, then calls record_coupon_usage() RPC if set
  → Returns { upgraded: true/false, state }

PhonePe Webhook → POST /api/phonepe/webhook:
  → Verify callback via SDK
  → Resolve restaurant_id: first from DB lookup by merchantOrderId;
    if not found, falls back to payload.metaInfo.udf1
  → On success: upsert subscriptions (status='active')
               record_coupon_usage() if coupon applied
  → On failure (renewal failed for active Pro): update subscriptions.status = 'past_due'
  → On failure (first-time payment failure): update subscriptions.status = 'incomplete'
```

### Plan Limit Enforcement

```
useSubscription(restaurantId):
  └─ Fetches subscriptions row on mount
  └─ Subscribes to a Supabase Realtime channel — listens for UPDATE events on `subscriptions`
     where `restaurant_id=eq.{restaurantId}`. The channel name is unique per effect run:
     `subscription:{restaurantId}:{n}` where `n` is a module-level counter (`_channelCounter`)
     incremented on each call. This avoids "cannot add callbacks after subscribe()" errors
     even in React Strict Mode (which double-invokes effects in development).
     When a webhook (Stripe/PhonePe) updates the row, the hook updates state immediately
     without a page reload. Channel is removed on unmount.
  └─ get_plan_limits() RPC returns: { max_tables, max_menu_items }
  └─ Free: max_tables=5, max_menu_items=20
  └─ Pro: max_tables=null (unlimited), max_menu_items=null
  └─ Returns: { isPro, isTrial, isActive, isExpired, trialEndsAt, subscription, limits, startUpgrade }
    - isActive: true when subscription.status === 'active' (paid, not trialing)
    - isTrial: true when subscription.status === 'trialing'
    - isExpired: true when subscription.status is any terminal non-active state:
                 'expired' | 'incomplete' | 'past_due' | 'canceled'
                 All four statuses fire the paywall and show the upgrade prompt.
    - isPro: true when plan === 'pro' AND (isActive OR isTrial) — trialing users get full Pro access
    - trialEndsAt: subscription.current_period_end when trialing, otherwise null

Manager UI checks limits before allowing:
  - Adding a new table
  - Adding a new menu item
  → Shows UpgradeBanner if at limit

UpgradeBanner fetches the Pro plan price dynamically from `/api/plans` on mount
(looks for the plan with `id === 'pro'` and reads `monthly_paise`). Falls back to
₹999/month (99900 paise) if the fetch fails. This means the displayed price always
reflects the current value in the `plans` table — no hardcoded price in the component.

Manager dashboard header displays a plan label and renewal info derived from useSubscription:
  - isTrial=true     → label: "Free Trial",     renewal: "Trial ends <date>" (from trialEndsAt)
  - isPro=true       → label: "Pro Plan",        renewal: formatted current_period_end
  - isExpired=true   → label: "Trial Expired",   renewal: none
  - otherwise        → label: "Free Plan",        renewal: none
```

### Pitfalls

- Stripe webhook requires raw body — Next.js App Router must not parse the body before signature verification. The route uses `req.text()` correctly, but any middleware that parses JSON will break this.
- `STRIPE_WEBHOOK_SECRET` must match the signing secret for the specific webhook endpoint in Stripe Dashboard. Local testing requires `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
- If the webhook fires but `restaurant_id` is missing from `session.metadata`, the subscription is not updated. This can happen if the checkout session was created without metadata (e.g. direct Stripe Dashboard test).
- Trial period means the subscription status is `trialing`, not `active`. `useSubscription` correctly treats `trialing` as Pro (`isPro = plan === 'pro' && (isActive || isTrial)`). Code that checks `status === 'active'` directly (bypassing the hook) will still incorrectly block trialing users.
- `past_due` and `canceled` subscriptions are treated as expired (`isExpired = true`) — the paywall fires and the manager sees the upgrade prompt. The webhook failure branch now distinguishes: `past_due` is set for active Pro subscriptions where renewal failed; `incomplete` is set for first-time payment failures. If you need a grace period before locking out `past_due` users, that logic must be added to `useSubscription` before the `isExpired` derivation.
- `useSubscription` opens a Realtime channel (name: `subscription:{restaurantId}:{n}`) to reflect webhook-driven plan changes instantly. `n` is a module-level counter (`_channelCounter`) incremented on each effect run, guaranteeing a unique name even in React Strict Mode where effects are double-invoked in development. If Supabase Realtime is disabled or the `subscriptions` table is not in the publication, the UI will only update on the next full page load.
- PhonePe credentials (`PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET`) must never be exposed client-side. All SDK calls happen server-side only via `getPhonePeClient()`. Credentials are read inside the function (not at module load time) so they are always fresh — do not hoist them to module scope.
- `getPhonePeClient()` resets `StandardCheckoutClient._client = undefined` before calling `getInstance()` to force the SDK to reinitialise with the current env credentials on every call. The SDK's singleton check uses `=== undefined` (not `=== null`), so setting it to `null` would not trigger reinitialisation.
- Set `PHONEPE_ENV=production` to switch PhonePe from the sandbox to the live API. Omitting the variable defaults to sandbox.
- The PhonePe checkout opens in a popup window. If the browser blocks popups (common in Safari or with strict popup blockers), the flow falls back to a full-page redirect. In that case the `postMessage` is never received and the UI only updates after the next page load or manual refresh.
- `/api/phonepe/popup-callback` receives `orderId` and `upgrade` query params from PhonePe. It posts `{ type: 'PHONEPE_CALLBACK', orderId, success }` to the parent window via `postMessage`, then closes itself. The parent must listen for this message and call `/api/phonepe/verify` to confirm the payment server-side. If `window.opener` is null (e.g. full-page redirect fallback), the postMessage is skipped and the popup just closes after a short delay.
- `/api/phonepe/popup-callback` is used as the `returnUrl` passed to PhonePe. This route must exist and return a valid HTML response. If it is missing, PhonePe will land on a 404 inside the popup.

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
| `duration_days` | int (nullable) | If set, overrides the default billing period length when the coupon is applied (e.g. 7 for a 7-day trial). Passed through to `payment_transactions.coupon_duration_days` and used by both `/api/phonepe/verify` (popup flow) and the webhook to extend `current_period_end`. |

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
- Called from Stripe webhook (`checkout.session.completed`) and PhonePe webhook (on success)
  → Ensures usage is only recorded after successful payment
```

### Admin Management (`/admin` → Coupons tab)

```
GET  /api/admin/coupons       → list all coupons
POST /api/admin/coupons       → create coupon
PATCH /api/admin/coupons/[id] → update coupon
DELETE /api/admin/coupons/[id] → delete coupon
```

All admin coupon routes require a valid `Authorization: Bearer <ADMIN_SECRET>` header server-side (validated via `lib/admin-auth.ts`). The browser never sends the secret directly — `CouponManager` calls `POST /api/admin/proxy` with the admin PIN, and the proxy attaches the secret before forwarding to the actual endpoint. Requests without a matching secret receive `401 Unauthorized`. The service role client is used internally to bypass RLS.

#### Plans API (`/api/admin/plans`)

```
GET  /api/admin/plans       → list all plans (ordered by sort_order, including inactive)
POST /api/admin/plans       → create a new plan (body inserted into plans table, returns 201)
PATCH /api/admin/plans/[id] → update allowed fields on a plan
DELETE /api/admin/plans/[id] → delete a plan
```

All routes use the service role key (bypass RLS). The `GET` response includes all plans regardless of `is_active`. The `POST` body must be a valid `plans` row object. `PATCH` only updates fields in the allowlist: `name`, `tagline`, `monthly_paise`, `yearly_paise`, `features`, `unavailable`, `is_active`, `is_highlighted`, `cta`, `sort_order`.

#### Plan Manager UI (`components/admin/PlanManager`)

The **Plans** tab in the admin panel renders `PlanManager`, a lazy-loaded CRUD interface for the `plans` table.

**Loading:** Plans are not fetched on mount — the admin must click **"Load Plans"** to trigger the initial `GET /api/admin/plans` fetch. This avoids unnecessary DB calls when the admin is on a different tab. The request is routed through `POST /api/admin/proxy` with the admin PIN (consistent with all other admin API calls).

**Plan table columns:** Sort handle (decorative), Plan name + ID slug + tagline, Monthly price, Yearly price, CTA type badge, Highlighted star, Active toggle, Edit/Delete actions.

**Create plan form fields:**

| Field | Notes |
|-------|-------|
| Plan ID | Slug (e.g. `pro`). Auto-lowercased, spaces → underscores. Only shown on create, not edit. |
| Name | Display name |
| Sort Order | Integer; controls display order on pricing page |
| Tagline | Short description shown under the plan name |
| Monthly Price (₹) | Input in rupees; stored as paise (×100). `0` = Custom/Contact. |
| Yearly Price (₹/mo) | Input in rupees per month; stored as paise. Billed annually. |
| Features | Newline-separated list of included features |
| Unavailable Features | Newline-separated list shown greyed out (not included in plan) |
| CTA Type | `choose` (self-serve PhonePe checkout), `contact` (mailto sales), `downgrade_unsupported` (mailto support) |
| Highlighted | Shows a "recommended" badge on the pricing page |
| Active | Controls visibility on the public `/api/plans` endpoint |

**Inline active toggle:** Clicking the toggle icon sends `PATCH /api/admin/plans/[id]` with `{ is_active: !current }` and patches the row in local state on success.

**Delete:** Requires a `window.confirm()` prompt. Sends `DELETE /api/admin/plans/[id]`. Removes the row from local state on success. Will fail at the DB level if the plan is referenced by active subscriptions (FK constraint).

**Pricing display:** `monthly_paise === 0` renders as `"Custom"` rather than `₹0`. Same for `yearly_paise`.

**Loading:** Coupons are fetched automatically on mount via `useEffect` — no manual trigger required. A "Loading coupons…" message is shown while the request is in flight. This differs from `PlanManager`, which requires an explicit button click to load.

The coupon table displays: Code, Discount, Bonus Days, Plans, Usage, Expires, Status, and Actions. The **Bonus Days** column shows the `duration_days` value (e.g. `+30d`) when set, or `—` when null.

The create/edit form includes an optional **Bonus Days** field (`duration_days`). When set, this extends the subscription period by that many days upon coupon redemption (passed through `payment_transactions.coupon_duration_days` to the webhook). Applicable plans are drawn from `["starter", "pro", "business"]`.

### Pitfalls

- Coupon `value` for `flat` type is stored in **paise** (smallest currency unit), not rupees. A ₹100 discount = `value: 10000`. The frontend must divide by 100 for display.
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
  3. Dispatch to up to 10 endpoints concurrently — NON-BLOCKING
     HTTP calls are detached from the caller immediately:
       - On Vercel Edge/Node runtimes: registered via waitUntil so the
         runtime keeps the function alive until all dispatches complete.
       - On other runtimes: detached via a void promise (fire-and-forget).
     fireEvent() returns immediately without awaiting delivery outcomes.
  4. Per endpoint:
     a. Create webhook_deliveries row (status='pending')
     b. POST to endpoint URL with headers:
        X-Webhook-Signature: sha256=HMAC-SHA256(secret, timestamp.body)
        X-Webhook-Timestamp: ISO-8601
        X-Webhook-Event: event type
        X-Webhook-ID: event UUID
     c. Timeout: 8 seconds
     d. Payload size check: if payload > 64 KB, strip array fields from data
        and add _truncated: true; only hard-fail if truncated version is still > 64 KB
     e. Success (2xx) → status='success', reset failure_count
     f. Failure → status='retrying', schedule next retry
        Retry schedule: 1m → 5m → 30m → 2h (5 total attempts)
        Automatic retries run via cron every minute ("* * * * *")
     g. After 5 failures → status='dead'
     h. After 10 consecutive endpoint failures → auto-disable endpoint
```

### Internal Trigger Endpoint

```
POST /api/webhooks/trigger
  Auth: Bearer token (user session) — manager, waiter, or kitchen staff only
  Body: { restaurantId: string; event: WebhookEventType; data: Record<string, unknown> }

  1. Decodes JWT locally (no outbound Auth call) via `getUserFromToken()` in `lib/server-auth.ts`
  2. Looks up caller's restaurant_id from users table (service role)
  3. Rejects if bodyRestaurantId doesn't match the caller's restaurant_id (403)
  4. Validates event type against WEBHOOK_EVENTS enum
  5. Calls fireEvent() asynchronously — does NOT block the response
  6. Returns { queued: true } immediately

Called by lib/api.ts after mutations (order placed, menu changes, etc.)
```

### Direct Webhook Firing (Order Status Changes)

Order status transitions fire webhooks directly from `updateOrderStatus()` in `lib/api.ts` — bypassing the `/api/webhooks/trigger` HTTP route. After a successful DB update, the function looks up the order's `restaurant_id` and calls `triggerWebhook()` asynchronously (non-blocking).

Mapped status → event:

| Status | Event |
|--------|-------|
| `confirmed` | `order.confirmed` |
| `preparing` | `order.preparing` |
| `ready` | `order.ready` |
| `served` | `order.served` |
| `cancelled` | `order.cancelled` |

Payload for most status events: `{ order_id, table_id, status, previous_status }`

**`order.confirmed` rich payload** — fetches full order context from the DB (orders, tables, floors, menu_items, restaurants) and sends a structured object:

```jsonc
{
  "order_id": "<uuid>",
  "status": "confirmed",
  "created_at": "<ISO-8601>",
  "total_amount": 450.00,
  "restaurant": {
    "id": "<uuid>",
    "name": "My Restaurant",
    "slug": "my-restaurant"
  },
  "table": {
    "id": "<uuid>",
    "table_number": 4,
    "floor": "Ground Floor",   // null if no floor assigned
    "capacity": 4              // null if not set
  },
  "customer": {
    "name": "Alice",           // null if not collected
    "phone": "+91...",         // null if not collected
    "party_size": 2            // null if not collected
  },
  "waiter": {
    "id": "<uuid>"
  },
  "order_items": [
    {
      "name": "Paneer Tikka",
      "description": "...",    // null if not set
      "tags": ["veg"],         // null if not set
      "quantity": 2,
      "unit_price": 150.00,
      "subtotal": 300.00
    }
  ]
}
```

The payload is assembled asynchronously and non-blocking — if the DB fetch fails, the webhook is silently skipped (non-fatal).

Note: `order.placed` and `order.billed` are not fired from this path — they are triggered separately at order creation and billing time.

### Direct Webhook Firing (Billing)

`order.billed` and `payment.method_recorded` are fired from `billOrder()` in `lib/api.ts` after the `generate_bill` RPC succeeds and served-but-unbilled items are confirmed. Both calls are non-blocking (`triggerWebhook()` is not awaited).

**`order.billed`** — always fired when a bill is generated:

| Field | Value |
|-------|-------|
| `order_id` | The billed order UUID |
| `table_id` | The table UUID |
| `gross_amount` | `total_amount` from the RPC result (float) |
| `net_amount` | `net_amount` from the RPC result, falls back to `gross_amount` if absent |
| `payment_method` | `options.paymentMethod` if provided, otherwise `null` |
| `discount_amount` | `options.discountAmount` if provided, otherwise `0` |

**`payment.method_recorded`** — fired only when `options.paymentMethod` is set:

| Field | Value |
|-------|-------|
| `order_id` | The billed order UUID |
| `payment_method` | The recorded payment method string |
| `amount` | Same as `net_amount` above |

### Retry Flow

```
Automatic retries:
  Cron job at /api/cron/webhook-retries runs every minute ("* * * * *").
  On each run, it finds deliveries in 'retrying' status with next_retry_at <= now()
  and re-dispatches them.

Manual retry:
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

### Menu Event Payloads

All three menu events share the same payload shape:

| Field | Type | Notes |
|-------|------|-------|
| `item_id` | string (uuid) | The menu item UUID |
| `name` | string \| null | Item name |
| `price` | number \| null | Item price |
| `description` | string \| null | Item description |
| `tags` | string[] \| null | Item tags (e.g. `["veg", "spicy"]`) |

For `menu.item_deleted`, the item details (`name`, `price`, `description`, `tags`) are fetched from the DB immediately before deletion so they are available in the payload even though the record no longer exists by the time the webhook fires.

### Pitfalls

- Webhook secret is only shown once at creation. If lost, the only option is to rotate it. `SecretModal` now requires a checkbox confirmation ("I have copied and securely stored the signing secret") before the **Done** button becomes active, reducing the risk of accidental dismissal without saving the secret. A dedicated **Copy secret** button with clipboard feedback is provided, and an amber warning banner is shown at the top of the modal.
- SSRF protection is enforced at two layers: the URL input field rejects private/loopback addresses (`localhost`, `127.x`, `10.x`, `192.168.x`, `172.16–31.x`, `0.0.0.0`) and non-public hostnames client-side before submission; the server also blocks these at dispatch time. Webhooks cannot be tested against local servers without a tunnel (ngrok, etc.).
- Payload size is capped at 64 KB. Before hard-failing, `dispatchToUrl` strips array fields from `data` and adds `_truncated: true`. Only fails if the truncated version is still too large.
- The retry cron runs every minute (`"* * * * *"`). Retries are automatic — no manual trigger required.
- `fireEvent()` detaches dispatch immediately (non-blocking). On Vercel runtimes it uses `waitUntil` to keep the function alive; on other runtimes it uses a detached promise. `fireEvent()` returns immediately without awaiting delivery outcomes. Errors are logged server-side but not surfaced to the caller.

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
| `auto_confirm_minutes` | int (nullable) | If set, orders are automatically confirmed after this many minutes. `null` disables auto-confirm. |
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
| `auth_id` | uuid (nullable, unique) → auth.users | `UNIQUE` constraint `users_auth_id_unique` prevents duplicate rows per auth user |
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
| `status` | text | `pending` \| `pending_waiter` \| `confirmed` \| `preparing` \| `ready` \| `served` \| `cancelled` |
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
| `status` | text | `active` \| `trialing` \| `expired` \| `past_due` \| `canceled` \| `incomplete` |
| `phonepe_transaction_id` | text (unique, nullable) | PhonePe transaction reference |
| `phonepe_subscription_id` | text (unique, nullable) | PhonePe subscription reference (if applicable) |
| `current_period_end` | timestamptz (nullable) | |
| `trial_used` | boolean | Whether this restaurant has already consumed its free trial; prevents repeat trials |
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

### `payment_transactions`

Audit log of every payment attempt initiated via PhonePe checkout. One row is inserted at checkout initiation (`status='pending'`) and updated by the webhook on success or failure.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `restaurant_id` | uuid → restaurants | |
| `merchant_order_id` | text (unique) | PhonePe order reference (uuid generated at checkout) |
| `plan` | text | `pro` (plan being purchased) |
| `amount_paise` | int | Final amount after any coupon discount |
| `status` | text | `pending` \| `success` \| `failed` |
| `coupon_code` | text (nullable) | Coupon applied at checkout, if any |
| `created_at` | timestamptz | |

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
| `generate_bill` | `(p_order_id, p_force boolean DEFAULT false)` | Requires status=`served` by default. When `p_force=true`, auto-advances non-served orders to `served` before billing. Sets `total_amount` + `billed_at`. Returns order details. |

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
| `kitchen:{restaurant_id}:{reconnectKey}` | Kitchen dashboard | Order INSERT/UPDATE via `postgres_changes` (auth-gated by RLS, requires valid JWT) |
| `waiter:{restaurant_id}` | Waiter dashboard | Order INSERT/UPDATE via `postgres_changes` (auth-gated by RLS, requires valid JWT) |
| `manager:{restaurant_id}` | Manager dashboard | Order INSERT/UPDATE, menu changes |
| `customer:{restaurant_id}:{table_id}` | Customer order tracker | Order UPDATE for that table |

> **Kitchen channel note:** `useKitchenOrders` subscribes to `kitchen:{restaurantId}:{reconnectKey}` (no HMAC token in the Supabase channel name). The DB trigger broadcasts to `kitchen:{restaurantId}` — the reconnect key suffix is appended client-side to force a fresh subscription on reconnect. Security for the kitchen feed relies on the `postgres_changes` subscription, which is auth-gated by RLS and requires a valid session JWT. The public `.on("broadcast", ...)` handlers have been removed from `useKitchenOrders` and `useWaiterOrders` — both hooks now use `postgres_changes` only.

### Broadcast Mechanism

```
PostgreSQL trigger (broadcast_order_changes / broadcast_order_on_items_insert)
  → calls realtime.send(channel, event, payload)
  → payload: { event: 'INSERT'|'UPDATE', id, restaurant_id, table_id, status, waiter_id, created_at }

Client (useManagerRealtime / customer pages):
  supabase.channel(channelName)
    .on('broadcast', { event: 'order_changed' }, handler)
    .subscribe()

Kitchen and waiter clients (useKitchenOrders / useWaiterOrders):
  Use postgres_changes only — the public broadcast handlers have been removed.
  supabase.channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handler)
    .subscribe()

On INSERT (kitchen):
  → Re-fetch single order (getKitchenOrders filtered by id) to get full joined data
  → Prepend to orders list
  → Add to newOrderIds set (4s highlight animation)

On INSERT (waiter):
  → Re-fetch single order by ID
  → If order is assigned to another waiter → skip
  → If order is unassigned → check table_sessions for an open session owned by another waiter
    - If found → skip (auto-assign trigger will assign it; UPDATE event handles visibility)
    - Otherwise → prepend to orders list

On UPDATE:
  → Patch existing order status in-place
  → Optimistic update already applied — this is the confirmation
```

### Fallback

```
useKitchenOrders and useWaiterOrders use postgres_changes as the primary (and only) subscription:
  supabase.channel(...)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handler)
  The public broadcast listener has been removed from both hooks.
```

### Notification Sounds & Vibration

`useNotificationSounds` (`hooks/useNotificationSounds.ts`) provides synthesised audio alerts and vibration patterns for real-time events. No audio files are required — tones are generated via the Web Audio API and work offline.

| Event | Sound | Vibration pattern |
|-------|-------|-------------------|
| `newOrder` | Double high-pitched square-wave beep (880 Hz) | `[200, 100, 200]` |
| `orderReady` | Ascending two-tone chime (C5 → G5) | `[300, 100, 300, 100, 300]` |
| `orderUpdate` | Single soft sine blip (660 Hz) | `[100]` |
| `waiterCall` | Triple short triangle-wave beeps (740 Hz) | `[100, 80, 100, 80, 100]` |

**Integration:** `useKitchenOrders` and `useWaiterOrders` accept an optional `notify?: (event: NotificationEvent) => void` callback. The kitchen and waiter dashboard components call `useNotificationSounds()` and pass `notify` down to the hooks, which invoke it on relevant real-time events (e.g. new order arrival, order ready).

**Mute state** is persisted to `localStorage` under the key `notification_sounds_muted` and survives page reloads. The hook returns `{ notify, muted, toggleMute }`.

**Browser notes:**
- `AudioContext` is created lazily on first use to satisfy browser autoplay policies (requires a prior user gesture).
- Vibration uses `navigator.vibrate()` — silently ignored on iOS and desktop browsers.
- `AudioContext` is closed on component unmount to release resources.

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

- The kitchen and waiter real-time feeds now use `postgres_changes` only (auth-gated by RLS, requires valid session JWT). The public `.on("broadcast", ...)` handlers have been removed from `useKitchenOrders` and `useWaiterOrders`. Cross-restaurant isolation is enforced by the `restaurant_id` filter on the `postgres_changes` subscription.
- On INSERT events, `useWaiterOrders` checks `table_sessions` to see if the new unassigned order's table already has an open session owned by another waiter. If so, the order is skipped — it will be auto-assigned by the DB trigger and appear via the subsequent UPDATE event. This prevents a brief flash of the order in the "Available" section before assignment completes. The check adds one extra DB query per INSERT for unassigned orders.
- If the Supabase Realtime connection drops, `useKitchenOrders` auto-reconnects: on `CHANNEL_ERROR` it retries after 5 s; on `CLOSED` it retries after 3 s. On successful `SUBSCRIBED`, it immediately re-fetches all orders to catch any events missed during the outage.
- `useKitchenOrders` listens to the `visibilitychange` event. When the page becomes visible again (e.g. a tablet waking from sleep or a browser tab being foregrounded), it triggers a silent refresh to catch any orders missed while the tab was hidden. If the channel reference is gone at that point, it also increments `reconnectKey` to force a fresh subscription.
- The `on_order_item_insert` trigger fires on the FIRST `order_items` INSERT for an order. If the batch insert fails after the first item, the broadcast fires with incomplete item data.
- `REPLICA IDENTITY FULL` must be set on `orders`, `menu_items`, `order_items` for postgres_changes to include old row data. If not set, UPDATE events won't include the previous values.

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
| A1 | Cart persisted per-tab in `sessionStorage` | Refresh preserves cart; new tab = new cart | Cart keyed by `cart_{tableId}` — cleared on order success or when `tableId` absent |
| A2 | `sessionStorage` is tab-scoped | New tab = new session = table appears occupied | Customer must use same tab throughout |
| A3 | ~~Staff with no `users` row loops to `/onboarding`~~ | ~~Confusing UX~~ | **Fixed** — `AuthRedirect` now signs the user out and redirects to `/login?error=account_incomplete` instead of looping |
| A4 | ~~`is_active=false` users can still log in~~ | ~~Soft-disabled staff can access dashboards~~ | **Fixed** — `loadUserProfile` selects `is_active`, signs out deactivated users immediately, returns `{ deactivated: true }`; `signIn` checks this and returns an error |
| A5 | ~~Duplicate `users` rows for same `auth_id`~~ | ~~`maybeSingle()` returns first silently~~ | **Fixed** — `UNIQUE` constraint `users_auth_id_unique` added to `users.auth_id` |

### Ordering

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| B1 | ~~Cart items not removed when menu item deleted~~ | ~~Order fails at DB level (FK RESTRICT)~~ | **Fixed** — `useRealtimeMenu` DELETE handler calls `invalidateCartItem(itemId)` before removing from list; amber warning banner shown |
| B2 | ~~Geo-fence blocks ordering if permission denied~~ | ~~Customer physically present but blocked~~ | **Fixed** — `geoBlocked` only triggers on `status === "denied"` (provably outside radius); `status === "error"` (permission denied) shows soft amber warning but does not block ordering |
| B3 | ~~`tableOccupied` check has 300ms delay~~ | ~~Brief flash of normal UI~~ | **Fixed** — `useCustomerSession` now exposes `sessionLoaded` (set in the same effect that reads sessionStorage); `OrderPageClient` gates the occupancy check on `sessionLoaded` instead of a one-shot `useEffect` workaround, guaranteeing `customerInfo` is correct when the check fires |
| B4 | ~~Floor pricing silently falls back to base price~~ | ~~Customer charged wrong amount~~ | **Fixed** — fallback now fetches floor multiplier directly from DB; if that also fails, order is aborted (returns null) |
| B5 | ~~No order cancellation for customers~~ | ~~Customer must contact staff~~ | **Fixed** — customers can cancel orders in `pending` or `pending_waiter` status via Cancel button in `OrderStatusTracker`; DB RLS policy `customers_can_cancel_pending_orders` enforces this |
| B6 | ~~`party_size` is optional and client-validated~~ | ~~Analytics may have gaps~~ | **Fixed** — `CartDrawer` validates party_size (1–50) in `handleInfoSubmit`; DB CHECK constraint `orders_party_size_check` enforces the range |

### Order Status & Routing

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| C1 | ~~Kitchen reject partially implemented~~ | ~~Stuck orders if item unavailable~~ | **Resolved** — `onReject` wired in `KitchenClient`; reject button rendered for `pending`/`confirmed` orders; `ORDER_STATUS_TRANSITIONS` and DB trigger updated to allow `cancelled` from `pending`, `pending_waiter`, and `confirmed` |
| C2 | Changing routing mode to `direct_to_kitchen` left orphaned `pending_waiter` orders | In-flight orders stuck in waiter queue | **Fixed** — `updateRestaurantRoutingMode` now calls `migrate_pending_waiter_orders(restaurant_id)` RPC to migrate orphaned orders to `pending` |
| C3 | Waiter rollback uses `getPreviousStatus()` | May set wrong status on concurrent update | **Fixed** — `advanceStatus` now captures `previousStatus` inside the synchronous `setOrders` callback (atomic); `getPreviousStatus()` helper removed |
| C4 | Two waiters can race to claim same order | One silently fails | Advisory lock protects DB; error now shown as a red error banner below the header in `WaiterClient` |
| C5 | `markServed` doesn't pre-check status | DB trigger throws, UI shows generic error | **Fixed** — `markServed` now checks `currentOrder.status !== "ready"` before optimistic update; sets error message and returns early if not ready; on failure rolls back and shows "Could not mark order as served. Please try again." |

### Billing

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| D1 | ~~`generate_bill()` requires `status=served`~~ | ~~Manager cannot bill unserved orders~~ | **Resolved** — `BillDialog` shows a manager override checkbox when `nonServedCount > 0`; checking it calls `bill_table()` with `force=true`, auto-advancing unserved orders to `served` before billing |
| D2 | ~~`discount_amount` not subtracted from `total_amount`~~ | ~~Frontend must calculate net~~ | **Fixed** — `total_amount` in the DB is now the net amount after discount; revenue dashboard reads it directly |
| D3 | ~~Table stays "occupied" if session not closed~~ | ~~Live Tables view shows stale data~~ | **Fixed** — `close_table_session` now only closes when ALL non-cancelled orders are billed (not just served ones); cancelled orders are excluded from the check |
| D4 | ~~Billing is per-order, not per-table~~ | ~~Multiple clicks needed for multi-order tables~~ | **Fixed** — `BillDialog` now calls `billTable(tableId, options)` (single atomic `bill_table` RPC); acquires row locks, bills all orders in one transaction, closes session |

### Subscriptions & Stripe

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| E1 | `trialing` status not treated as `active` in some checks | Pro features may be blocked during trial | **Fixed** — `useSubscription` now uses `isPro = plan==='pro' && (isActive \|\| isTrial)`; `AdminClient` `proCount` now includes `trialing` restaurants. Direct `status='active'` checks elsewhere still need auditing. |
| E2 | `past_due` not auto-downgraded to free | Pro features accessible despite failed payment | **Fixed** — webhook failure branch now sets `past_due` for active Pro subscriptions (renewal failed) vs `incomplete` for first-time failures; `isExpired` covers `past_due` and `canceled` |
| E3 | Stripe webhook body parsing | Any JSON-parsing middleware breaks signature verification | Must use `req.text()` |
| E4 | Missing `restaurant_id` in Stripe/PhonePe metadata | Subscription not updated | **Fixed** — PhonePe webhook now reads `payload.metaInfo.udf1` as a fallback `restaurant_id` when the DB lookup misses |

### Webhooks

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| F1 | No automatic retry execution | Retries only happen on manual trigger | **Fixed** — cron schedule changed from `"0 1 * * *"` (daily) to `"* * * * *"` (every minute); retries now run automatically |
| F2 | `fireEvent()` is synchronous in API routes | Slow endpoints delay API response (up to 80s for 10 endpoints) | **Fixed** — `fireEvent` now detaches dispatch immediately; uses `waitUntil` on Vercel runtimes, falls back to detached promise on others |
| F3 | Payload capped at 64 KB | Large orders silently fail | **Fixed** — before hard-failing, `dispatchToUrl` strips array fields from `data` and adds `_truncated: true`; only fails if truncated version is still too large |
| F4 | Secret shown only once | If lost, must rotate | **Fixed** — `SecretModal` now requires a checkbox confirmation before Done button is enabled; dedicated Copy button with clipboard feedback; amber warning banner shown at top |
| F5 | ~~Channel names not authenticated for broadcast~~ | ~~Any client can subscribe to the broadcast channel~~ | **Fixed** — kitchen and waiter hooks now use only `postgres_changes` (auth-gated by RLS, requires valid JWT); public `.on("broadcast", ...)` handlers removed from `useKitchenOrders` and `useWaiterOrders` |

### RLS & Security

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| G1 | `orders` public UPDATE with `qual: true` | Anyone can update any order status | Mitigated by DB trigger but not fully secure |
| G2 | `order_items` public INSERT | Anyone can add items to any order | No restaurant scoping |
| G3 | `restaurants` INSERT by any authenticated user | Orphaned restaurants possible | Bypasses onboarding RPC |
| G4 | ~~`NEXT_PUBLIC_ADMIN_PIN` in client bundle~~ | ~~PIN is visible in browser~~ | **Fixed** — PIN verified server-side via `POST /api/admin/verify-pin` (rate-limited 5/min/IP). Set `ADMIN_PIN` env var (non-public); `NEXT_PUBLIC_ADMIN_PIN` accepted as fallback during migration only. |
| G5 | No rate limiting on order placement | Spam orders possible | No throttle on `/r/[id]/t/[id]` |

### Real-time

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| H1 | ~~No auto-reconnect on channel drop~~ | ~~Staff miss orders until manual refresh~~ | **Fixed** — `useKitchenOrders` retries on `CHANNEL_ERROR` (3 s) and `CLOSED` (1 s); re-fetches orders on `SUBSCRIBED` to recover missed events. Offline state is debounced (2 s) so transient `CHANNEL_ERROR`/`CLOSED` events during normal reconnect cycles no longer flash an error banner. |
| H2 | `on_order_item_insert` fires on first item only | Broadcast may have incomplete items if batch fails mid-way | Partial order data in real-time payload |
| H3 | `REPLICA IDENTITY FULL` required | postgres_changes fallback broken without it | Must be set per table in Supabase |

### Order Log

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| I2 | ~~Stat card trend values are hardcoded (`+8.2% vs yesterday`)~~ | ~~Misleading — not computed from real data~~ | **Fixed** — sub-labels now derived from `rangeRows`: date segment label, served count, order count, or "All clear" |
| I3 | ~~Order Log fetches up to 300 rows client-side~~ | ~~Large restaurants may miss older orders~~ | **Fixed** — server-side pagination via DB `.range()` + `count: "exact"`; status filter and sort applied server-side; search remains client-side against the current page |
| I3a | ~~Date-filter badge showed `rangeRows.length` (current page only)~~ | ~~Count was wrong on any page > 1~~ | **Fixed** — badge now uses `totalCount` (server-side total for the active filters) |
| I4 | ~~Real-time UPDATE patches `msg.new` fields directly onto the row~~ | ~~Joined fields (waiter_name, items, floor_name) are NOT updated on UPDATE events~~ | **Fixed** — UPDATE events now trigger `refetchOrder(orderId)`, a targeted single-row re-fetch with full joins |
| I5 | "Cancel Order" and advance-status buttons in detail panel have no API call wired up | Buttons render but clicking them does nothing | Implementation pending |

---

*Document generated: April 22, 2026. Based on live Supabase schema inspection + full codebase analysis.*
