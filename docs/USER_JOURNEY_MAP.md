# User Journey Map
## QR Order — Restaurant QR Ordering & Management SaaS

| Field | Value |
|-------|-------|
| Document version | 1.0 |
| Last updated | April 22, 2026 |
| Personas covered | Customer · Waiter · Kitchen · Manager · Restaurant Owner |

> This document maps what each user **does**, **thinks**, and **feels** at every stage of their interaction with QR Order — including where things go wrong.

---

## How to Read This Document

Each journey is structured as:

```
Stage → Action → Touchpoint → Emotion → Pain Points → Opportunities
```

- **Stage** — the phase the user is in
- **Action** — what they physically do
- **Touchpoint** — which screen, feature, or system they interact with
- **Emotion** — how they feel (😊 positive · 😐 neutral · 😟 friction · 😤 frustration)
- **Pain points** — where friction or failure can occur
- **Opportunities** — where the product can do better

---

## Table of Contents

1. [Journey 1 — Customer (First Visit)](#1-journey-1--customer-first-visit)
2. [Journey 2 — Customer (Returning, Same Session)](#2-journey-2--customer-returning-same-session)
3. [Journey 3 — Waiter (Daily Shift)](#3-journey-3--waiter-daily-shift)
4. [Journey 4 — Kitchen Staff (During Service)](#4-journey-4--kitchen-staff-during-service)
5. [Journey 5 — Manager (Full Day)](#5-journey-5--manager-full-day)
6. [Journey 6 — Restaurant Owner (Onboarding)](#6-journey-6--restaurant-owner-onboarding)
7. [Cross-Role Journey — One Order, All Perspectives](#7-cross-role-journey--one-order-all-perspectives)
8. [Emotional Arc Summary](#8-emotional-arc-summary)

---

## 1. Journey 1 — Customer (First Visit)

**Persona:** Sneha, 22 — college student dining out for the first time at this restaurant  
**Goal:** Order food and eat without waiting for a waiter  
**Device:** Smartphone (Android/iOS, any browser)  
**Entry point:** QR code sticker on the table

---

### Stage 1 — Discovery

| | Detail |
|-|--------|
| **Action** | Sneha sits down, notices the QR code on the table |
| **Touchpoint** | Physical QR code sticker on table |
| **Emotion** | 😊 Curious, slightly unsure if she needs to download an app |
| **System** | No system interaction yet |

**Pain points:**
- QR code sticker is dirty, torn, or poorly printed → camera can't scan it
- No instruction text near the QR code explaining what it does

**Opportunities:**
- Add a short label under the QR: *"Scan to order — no app needed"*
- Ensure QR stickers are laminated and replaced regularly

---

### Stage 2 — Menu Load

| | Detail |
|-|--------|
| **Action** | Opens camera, scans QR, browser opens automatically |
| **Touchpoint** | `/r/[restaurant_id]/t/[table_id]` — customer ordering page |
| **Emotion** | 😊 Relieved it opened in browser, no download needed |
| **System** | Server checks: restaurant `is_active`, table exists, fetches menu items |

**Pain points:**
- Slow mobile connection → page takes > 3 seconds → Sneha thinks it's broken
- Restaurant is deactivated (`is_active=false`) → 404 page with no explanation
- Table ID is invalid → 404 with no helpful message

**Opportunities:**
- Show a skeleton loading state immediately so the page feels responsive
- Replace generic 404 with a friendly message: *"This table isn't set up yet — ask your waiter"*
- Cache menu items for faster repeat loads

---

### Stage 3 — Geo-fence Check (if enabled)

| | Detail |
|-|--------|
| **Action** | Browser asks for location permission |
| **Touchpoint** | Browser native permission dialog |
| **Emotion** | 😐 Confused why a menu app needs her location |
| **System** | `useGeofence()` — checks distance from restaurant coordinates |

**Pain points:**
- Sneha denies location → cart is blocked, she can't order at all
- No explanation of *why* location is needed
- She's sitting inside the restaurant but GPS puts her 150m away → blocked

**Opportunities:**
- Show a clear explanation before the permission prompt: *"We need your location to confirm you're at the restaurant"*
- Provide a fallback: *"Can't share location? Ask your waiter to place the order"*
- Make geo-fence radius slightly generous (200m default instead of 100m)

---

### Stage 4 — Browsing the Menu

| | Detail |
|-|--------|
| **Action** | Scrolls through menu items, reads descriptions, looks at images |
| **Touchpoint** | Menu tab — `MenuItemCard` components |
| **Emotion** | 😊 Engaged, comparing options |
| **System** | `useRealtimeMenu()` — live updates if manager changes availability |

**Pain points:**
- No categories or filters → hard to find specific items in a long menu
- Item images missing (no `image_url`) → plain text cards feel cheap
- An item she wants shows as available but gets marked unavailable mid-browse → disappears without warning
- Floor price multiplier shown but not explained → *"Why is this ₹120 when it says ₹100?"*

**Opportunities:**
- Category/tag filtering on the customer menu page (currently only in manager dashboard)
- Show a toast when an item becomes unavailable: *"Butter Chicken is no longer available"*
- Explain floor pricing with a tooltip: *"Rooftop premium: 1.2× base price"*

---

### Stage 5 — Adding to Cart

| | Detail |
|-|--------|
| **Action** | Taps "Add" on items, adjusts quantities |
| **Touchpoint** | `MenuItemCard` → `CartDrawer` (bottom sheet) |
| **Emotion** | 😊 Satisfying, quick |
| **System** | `useCart()` — in-memory state |

**Pain points:**
- Cart is in-memory only → accidental page refresh clears everything
- No visual confirmation that item was added (just a badge count change)
- Can't add a note/customization to an item (e.g. *"no onions"*)

**Opportunities:**
- Persist cart to `sessionStorage` so refresh doesn't lose it
- Brief animation or toast on "Add" for tactile feedback
- Add an optional "special instructions" text field per item

---

### Stage 6 — Placing the Order (First Time)

| | Detail |
|-|--------|
| **Action** | Opens cart drawer, taps "Place Order", fills in name + phone + party size |
| **Touchpoint** | `CartDrawer` → info step form |
| **Emotion** | 😐 Slight friction — didn't expect to enter details |
| **System** | `placeOrder()` → billing safety check → order INSERT → order_items INSERT |

**Pain points:**
- Form appears unexpectedly — Sneha thought she was done after tapping "Place Order"
- Phone number is required but she's hesitant to share it
- No explanation of why name/phone is needed
- If `check_table_has_unpaid_orders` returns true → generic "error" step with no clear message
- If `calculate_item_prices_batch` RPC fails → order placed at wrong price silently

**Opportunities:**
- Show the info form upfront (before cart) so it's not a surprise
- Add a brief note: *"We use your phone to track your order and bill"*
- Make party size optional (it already is) but visually de-emphasize it
- Show a specific message for table-occupied error: *"This table has an open bill. Please ask your waiter."*

---

### Stage 7 — Order Confirmation

| | Detail |
|-|--------|
| **Action** | Sees success screen for 2.5 seconds, cart clears, returns to menu |
| **Touchpoint** | `CartDrawer` — success step |
| **Emotion** | 😊 Relieved, satisfied |
| **System** | `setTimeout` → `onOrderSuccess()` → `clearCart()` → step resets to "cart" |

**Pain points:**
- 2.5 second success screen is too brief — Sneha might miss it
- No order ID or reference shown on the success screen
- After success, she's back on the menu tab — she has to manually switch to "Orders" to track

**Opportunities:**
- Auto-switch to the "Orders" tab after successful placement
- Show order ID or a short reference number on the success screen
- Keep success screen visible until user taps "Track Order" or "Order More"

---

### Stage 8 — Tracking Order Status

| | Detail |
|-|--------|
| **Action** | Switches to "Orders" tab, watches status update |
| **Touchpoint** | `OrderStatusTracker` — real-time status bar |
| **Emotion** | 😊 Reassured, knows food is coming |
| **System** | `useRealtimeOrderStatus()` → channel: `customer:{restaurant_id}:{table_id}` |

**Pain points:**
- If real-time channel drops, status stops updating — Sneha thinks something went wrong
- Status labels ("Confirmed", "Preparing") may not be intuitive to all customers
- No estimated time shown — she doesn't know if "Preparing" means 5 minutes or 30

**Opportunities:**
- Show a "Last updated X seconds ago" indicator
- Add friendly labels: *"Kitchen received your order"*, *"Chef is cooking"*, *"Almost ready!"*
- Show average prep time based on historical data (future feature)

---

### Stage 9 — Receiving Food & Waiting for Bill

| | Detail |
|-|--------|
| **Action** | Food arrives (waiter marks "Served"), Sneha waits for the bill |
| **Touchpoint** | Order status shows "Served" |
| **Emotion** | 😊 Happy eating, then 😐 waiting for bill |
| **System** | Manager generates bill → `billed_at` set → session clears |

**Pain points:**
- No notification when the bill is ready — she has to keep checking
- No way to request the bill from the app — must flag down a waiter
- After billing, the "Orders" tab goes blank — no receipt or summary shown

**Opportunities:**
- Add a "Request Bill" button that notifies the waiter/manager
- Show a final receipt summary after `billed_at` is set
- Send a push notification or in-page alert when bill is generated (future)

---

## 2. Journey 2 — Customer (Returning, Same Session)

**Persona:** Sneha — same visit, wants to order dessert after finishing her main course  
**Goal:** Place a second order quickly without re-entering details

---

| Stage | Action | Touchpoint | Emotion | Notes |
|-------|--------|------------|---------|-------|
| **Return to menu** | Switches back to "Menu" tab | Menu tab | 😊 | Familiar now |
| **Add items** | Adds dessert items to cart | `MenuItemCard` | 😊 | Same as before |
| **Place order** | Taps "Place Order" | `CartDrawer` | 😊 Delighted | No form shown — `savedCustomerInfo` from `sessionStorage` skips directly to `submitOrder()` |
| **Confirmation** | Sees success screen | Success step | 😊 | Fast, frictionless |
| **Track** | Checks Orders tab | `OrderStatusTracker` | 😊 | Both orders visible |

**What works well:** The session memory (name + phone stored in `sessionStorage`) makes repeat orders seamless — this is a key UX win.

**Pain points:**
- If Sneha opens the QR link in a new browser tab, `sessionStorage` is lost → form appears again
- If she closes and reopens the same tab, `sessionStorage` persists — but this isn't obvious to her

**Opportunities:**
- Consider `localStorage` with a TTL (e.g. 4 hours) so session survives tab closes within a dining window
- Show a subtle "Ordering as Sneha" indicator so she knows her info is saved

---

## 3. Journey 3 — Waiter (Daily Shift)

**Persona:** Priya, 24 — waiter starting her lunch shift  
**Goal:** Manage her assigned tables, serve orders efficiently, close out tables at end of shift

---

### Stage 1 — Start of Shift / Login

| | Detail |
|-|--------|
| **Action** | Opens browser on her phone, navigates to the app, logs in |
| **Touchpoint** | `/login` — email + password form |
| **Emotion** | 😐 Routine, slightly tedious |
| **System** | `supabase.auth.signInWithPassword()` → `useAuth()` loads profile → redirect to `/waiter/[id]` |

**Pain points:**
- Has to type email + password every shift — no "remember me" option
- If she accidentally goes to `/` (landing page) she has to find the login link

**Opportunities:**
- Add "Remember me" / persistent session option
- Redirect logged-in users away from `/login` automatically (already handled by `AuthRedirect`)

---

### Stage 2 — Dashboard Overview

| | Detail |
|-|--------|
| **Action** | Sees two sections: "My Orders" (empty) and "Available Orders" |
| **Touchpoint** | `/waiter/[restaurant_id]` — `WaiterClient` |
| **Emotion** | 😊 Clear, simple layout |
| **System** | `useWaiterOrders()` — fetches orders, subscribes to `waiter:{restaurant_id}` channel |

**Pain points:**
- If real-time channel hasn't connected yet, she might see stale data for a few seconds
- No indication of how many tables are currently occupied

**Opportunities:**
- Show a "Live" / "Connecting..." indicator clearly
- Add a table overview strip at the top showing occupied vs. free

---

### Stage 3 — New Order Arrives (Direct-to-Kitchen Mode)

| | Detail |
|-|--------|
| **Action** | A new order appears in "Available Orders" with a highlight |
| **Touchpoint** | `WaiterOrderCard` — real-time update |
| **Emotion** | 😊 Notified without checking |
| **System** | `broadcast_order_changes` trigger → `waiter:{restaurant_id}` channel → card appears |

**Action:** Priya taps "Take Order"

| | Detail |
|-|--------|
| **Touchpoint** | `WaiterOrderCard` → `takeOrder()` → `assign_order_to_waiter()` RPC |
| **Emotion** | 😊 Claimed it before another waiter |
| **System** | Advisory lock on `table_id` — atomic assignment. Opens `table_session` if none exists. |

**Pain points:**
- Two waiters see the same order simultaneously — one taps "Take" and the other gets a silent failure
- No feedback to the waiter who lost the race — the card just disappears

**Opportunities:**
- Show a toast: *"Order already taken by [name]"* when assignment fails
- Briefly flash the card before it disappears so the waiter knows what happened

---

### Stage 4 — New Order Arrives (Waiter-First Mode)

| | Detail |
|-|--------|
| **Action** | Order appears as `pending_waiter` in "Available Orders" |
| **Touchpoint** | `WaiterOrderCard` — "Accept Order" button |
| **Emotion** | 😐 Extra step, but gives her control |
| **System** | `accept_order_atomic()` RPC → `pending_waiter → confirmed` → kitchen now sees it |

**Pain points:**
- If Priya is busy and doesn't accept quickly, the customer is waiting with no status update
- No timeout or escalation if an order sits in `pending_waiter` too long

**Opportunities:**
- Add a timer on `pending_waiter` orders showing how long they've been waiting
- Alert manager if an order hasn't been accepted within X minutes

---

### Stage 5 — Serving Food

| | Detail |
|-|--------|
| **Action** | Kitchen marks order "Ready" → Priya sees it in "My Orders" |
| **Touchpoint** | `WaiterOrderCard` — "Mark Served" button |
| **Emotion** | 😊 Clear signal to go deliver |
| **System** | Real-time update → status = `ready` → Priya taps "Mark Served" → `updateOrderStatus('served')` |

**Pain points:**
- No audio/vibration alert when an order becomes "Ready" — she might miss it if not looking at the screen
- If she marks served before actually delivering (accidentally), there's no undo

**Opportunities:**
- Add a browser notification or vibration when an order becomes "Ready"
- Add a brief confirmation dialog before "Mark Served": *"Confirm you've delivered this order?"*

---

### Stage 6 — End of Shift / Table Closeout

| | Detail |
|-|--------|
| **Action** | All orders at her tables are served, manager bills them, table session closes |
| **Touchpoint** | Manager generates bill → `close_table_session()` |
| **Emotion** | 😊 Clean handoff |
| **System** | `billed_at` set → session `closed_at` set → table shows as free |

**Pain points:**
- Priya has no visibility into whether the manager has billed her tables — she has to ask
- If the manager forgets to close the session, the table stays "occupied" in her view

**Opportunities:**
- Show a "Billed" badge on served orders in her dashboard
- Auto-close table session when all orders are billed (currently manual)

---

## 4. Journey 4 — Kitchen Staff (During Service)

**Persona:** Arjun, 30 — head cook, uses a tablet mounted near his station  
**Goal:** See all incoming orders clearly, prepare them in order, mark them done

---

### Stage 1 — Start of Service / Login

| | Detail |
|-|--------|
| **Action** | Opens browser on tablet, logs in |
| **Touchpoint** | `/login` → redirect to `/kitchen/[restaurant_id]` |
| **Emotion** | 😐 Routine |
| **System** | Role = `kitchen` → `redirectToDashboard()` → `/kitchen/[id]` |

**Pain points:**
- Tablet browser may have cached a stale session — he sees yesterday's orders briefly
- No "kiosk mode" — browser chrome (address bar, tabs) is visible and distracting

**Opportunities:**
- Add a "full screen / kiosk" button that hides browser chrome
- Show a clear "Service started at [time]" header

---

### Stage 2 — Viewing the Order Queue

| | Detail |
|-|--------|
| **Action** | Sees all active orders in a card grid |
| **Touchpoint** | `KitchenClient` → `OrderCard` components |
| **Emotion** | 😊 Clear, large text, easy to read from a distance |
| **System** | `getKitchenOrders()` → orders with status `pending`, `confirmed`, `preparing`, `ready` |

**Pain points:**
- No sorting control — orders are newest-first by default, but Arjun wants oldest-first (FIFO)
- No way to filter by status — all statuses mixed together
- If there are 20+ orders, the grid becomes overwhelming

**Opportunities:**
- Default to oldest-first (FIFO) for kitchen — this matches how a real kitchen works
- Add status filter tabs: All / Pending / Preparing / Ready
- Add a count badge per status in the header

---

### Stage 3 — New Order Arrives

| | Detail |
|-|--------|
| **Action** | New order card appears with a pulsing highlight |
| **Touchpoint** | `OrderCard` — 4-second highlight animation |
| **Emotion** | 😊 Hard to miss |
| **System** | `on_order_item_insert` trigger → broadcast → `newOrderIds` set → CSS animation |

**Pain points:**
- No sound alert — in a noisy kitchen, visual-only is easy to miss
- If multiple orders arrive simultaneously, the highlight is on all of them — hard to distinguish new from old

**Opportunities:**
- Add an optional audio chime for new orders (browser Audio API)
- Show a "NEW" badge that persists until Arjun taps "Confirm"

---

### Stage 4 — Advancing Order Status

| | Detail |
|-|--------|
| **Action** | Taps "Confirm" → "Preparing" → "Ready" as he works through the order |
| **Touchpoint** | `OrderCard` action button |
| **Emotion** | 😊 One tap per stage, very fast |
| **System** | `advanceStatus()` → optimistic update → `updateOrderStatus()` → DB trigger validates transition |

**Pain points:**
- Accidental tap on "Confirm" or "Preparing" — no undo, no confirmation dialog
- If the DB rejects the transition (e.g. wrong status), the optimistic update rolls back — card flickers
- "Ready" status has no action button — Arjun has no way to know if the waiter has picked it up

**Opportunities:**
- Add a subtle confirmation for destructive-feeling actions (e.g. hold-to-confirm)
- Show a "Waiting for waiter" label on `ready` orders
- Auto-remove `served` orders from the queue (currently they're excluded from the fetch, so this works — but confirm it's clear)

---

### Stage 5 — End of Service

| | Detail |
|-|--------|
| **Action** | All orders are marked "Ready", queue empties |
| **Touchpoint** | Empty state on kitchen dashboard |
| **Emotion** | 😊 Satisfying |
| **System** | No active orders → empty state shown |

**Pain points:**
- No summary of the day's orders — how many did he prepare? How fast?
- No way to log off from the kitchen display without navigating away

**Opportunities:**
- Add an end-of-service summary: orders completed, avg prep time
- Add a visible "Sign Out" button (currently in the header but small)

---

## 5. Journey 5 — Manager (Full Day)

**Persona:** Ravi, 38 — restaurant owner, manages from his phone and occasionally a laptop  
**Goal:** Keep the restaurant running smoothly, handle billing, monitor performance

---

### Stage 1 — Morning Setup

| | Detail |
|-|--------|
| **Action** | Logs in, checks that menu items are correct, toggles availability for sold-out items |
| **Touchpoint** | `/manager/[id]` → Menu Items tab |
| **Emotion** | 😊 In control |
| **System** | `getMenuItems()` → toggle `is_available` → real-time broadcast to customer pages |

**Pain points:**
- No bulk toggle — if 5 items are sold out, he has to toggle each one individually
- No "daily specials" feature — can't schedule availability by time

**Opportunities:**
- Add bulk select + toggle availability
- Add a "mark as sold out today" quick action that resets at midnight

---

### Stage 2 — During Service — Live Tables

| | Detail |
|-|--------|
| **Action** | Monitors Live Tables tab — sees which tables are occupied, what's ordered, who's serving |
| **Touchpoint** | `TableSessions` component |
| **Emotion** | 😊 Real-time visibility without walking the floor |
| **System** | Supabase realtime channel `manager:{restaurant_id}` — subscribes to `orders` table changes and refreshes silently |

**UI features (implemented):**
- Stat bar: Active Tables · Bill Ready · Awaiting Attention · Today's Revenue · Avg. Order Value
- Floor tabs filter tiles by floor; "All Floors" shows everything
- Grid / List view toggle
- Table tile states: `free` · `active` · `bill-ready` · `awaiting` · `billed`
- Selecting a tile opens a detail panel on the right
- `BillDialog` triggered from tile or detail panel

**Pain points:**
- No floor plan view — tables are listed, not laid out spatially
- Can't see which waiter is assigned to which table at a glance
- If a table session isn't opened (waiter forgot), the table shows as "free" even if occupied
- Filters button is present but not yet functional

**Opportunities:**
- Add a visual floor map (drag-and-drop table layout) — future feature
- Show waiter name prominently on each occupied table card
- Add a "Mark as occupied" manual override for the manager
- Wire up the Filters button (by status, waiter, floor)

---

### Stage 3 — Billing a Table

| | Detail |
|-|--------|
| **Action** | Customer asks for the bill → Ravi taps "Bill (N)" on the table card |
| **Touchpoint** | `TableSessions` → `generate_bill()` RPC |
| **Emotion** | 😊 Fast, one tap |
| **System** | `generate_bill()` → sets `total_amount` + `billed_at` for each served order |

**Pain points:**
- Can only bill orders with `status = 'served'` — if waiter forgot to mark served, Ravi is stuck
- No way to apply a discount from the Live Tables view — must go to Order Log
- No receipt printout — must be done manually
- Billing multiple orders at a table requires multiple taps (one per order)

**Opportunities:**
- Add a manager override to force-bill regardless of status
- Integrate discount input directly into the billing flow
- Add a "Bill All" button that bills all served orders at a table in one action

---

### Stage 4 — Handling a Problem Order

| | Detail |
|-|--------|
| **Action** | Customer complains about a wrong item — Ravi needs to cancel or modify the order |
| **Touchpoint** | Order Log tab |
| **Emotion** | 😟 Frustrated — no cancel/edit option exists |
| **System** | No cancellation flow. Status machine only moves forward. |

**Pain points:**
- No order cancellation for managers
- No way to flag an order as "disputed"

**Opportunities:**
- Add a manager-only "Cancel Order" action with a reason field
- Add an `order.cancelled` status to the state machine

**Implemented:**
- ✅ Managers can place new orders from the table detail panel in `TableSessions` (uses `getMenuItems()` + `placeOrder()`)

---

### Stage 5 — End of Day — Analytics

| | Detail |
|-|--------|
| **Action** | Reviews Analytics tab — revenue, top items, staff performance |
| **Touchpoint** | `Analytics` component |
| **Emotion** | 😊 Insightful |
| **System** | Aggregation queries on `orders`, `order_items`, `order_status_logs` |

**Pain points:**
- No date range picker — analytics may show all-time data by default
- No export to CSV/PDF for accounting
- No comparison view (this week vs. last week)

**Opportunities:**
- Add date range filter (today / this week / this month / custom)
- Add CSV export for orders and revenue
- Add week-over-week comparison charts

---

### Stage 6 — Staff Management

| | Detail |
|-|--------|
| **Action** | Creates a new waiter account for a new hire |
| **Touchpoint** | Staff tab → `StaffManager` → `POST /api/staff/create` |
| **Emotion** | 😊 Simple form |
| **System** | Creates Supabase Auth user + `users` row |

**Pain points:**
- Temporary password is shown once — if Ravi doesn't share it immediately, it's lost
- No password reset flow for staff — Ravi has to delete and recreate the account
- No way to see when a staff member last logged in

**Opportunities:**
- Send a welcome email with login credentials automatically
- Add a "Reset Password" button that triggers Supabase password reset email
- Show "Last active" timestamp per staff member

---

## 6. Journey 6 — Restaurant Owner (Onboarding)

**Persona:** Ravi — discovering QR Order for the first time, wants to get his restaurant live  
**Goal:** Sign up, set up the restaurant, and place the first test order — all in one session

---

### Stage 1 — Discovery

| | Detail |
|-|--------|
| **Action** | Lands on the homepage (`/`) from a Google search or referral |
| **Touchpoint** | Landing page — pricing section, feature list |
| **Emotion** | 😊 Interested, evaluating |
| **System** | Static page, no auth |

**Pain points:**
- No live demo or video walkthrough — he has to imagine how it works
- Pricing is shown (₹799/month) but no comparison to competitors

**Opportunities:**
- Add a 60-second demo video on the homepage
- Add a "Try it live" button that opens a demo restaurant QR page

---

### Stage 2 — Account Creation (Step 1)

| | Detail |
|-|--------|
| **Action** | Clicks "Get Started", enters email + password + name |
| **Touchpoint** | `/onboarding` — Step 1: Account |
| **Emotion** | 😊 Simple form |
| **System** | `supabase.auth.signUp()` → fallback to `signInWithPassword()` if already registered |

**Pain points:**
- If email confirmation is enabled in Supabase, he gets stuck — must check inbox before continuing
- No social login (Google/GitHub) — email/password only
- Password requirements not shown until he submits and fails

**Opportunities:**
- Disable email confirmation for onboarding (or handle it gracefully with a clear message)
- Add Google OAuth as an alternative
- Show password requirements inline as he types

---

### Stage 3 — Restaurant Setup (Step 2)

| | Detail |
|-|--------|
| **Action** | Enters restaurant name, clicks "Continue" |
| **Touchpoint** | `/onboarding` — Step 2: Restaurant |
| **Emotion** | 😊 Fast, one field |
| **System** | `POST /api/onboard` → `onboard_restaurant()` RPC → creates restaurant + floor + 5 tables + manager user + subscription |

**Pain points:**
- Only one field (restaurant name) — feels too simple, he wonders if he missed something
- No confirmation of what was created (5 tables, Main Floor, etc.)
- If the RPC fails, he sees a generic error with no recovery path

**Opportunities:**
- Show a summary after creation: *"We've set up: 1 floor, 5 tables, your manager account"*
- Add optional fields: restaurant type, city, phone number
- Show a specific error message if restaurant name is already taken

---

### Stage 4 — Plan Selection (Step 3)

| | Detail |
|-|--------|
| **Action** | Sees Free vs Pro comparison, optionally enters a coupon code |
| **Touchpoint** | `/onboarding` — Step 3: Plan |
| **Emotion** | 😐 Decision point — evaluating value |
| **System** | `CouponInput` → `POST /api/coupons/validate` → live price update |

**Path A — Chooses Free:**

| | Detail |
|-|--------|
| **Action** | Clicks "Start Free" |
| **Touchpoint** | `skipToFree()` → redirect to `/manager/[id]` |
| **Emotion** | 😊 Low commitment, easy |

**Path B — Chooses Pro:**

| | Detail |
|-|--------|
| **Action** | Clicks "Upgrade to Pro" |
| **Touchpoint** | `POST /api/stripe/checkout` → redirect to Stripe hosted checkout |
| **Emotion** | 😐 Leaving the app, slight trust concern |
| **System** | Stripe checkout → card entry → `checkout.session.completed` webhook → subscription updated |

**Pain points (Path B):**
- Redirecting to Stripe feels like leaving the product — some users drop off here
- If Stripe checkout fails or times out, he's redirected back with no clear error
- 7-day trial is mentioned but not prominently featured — he might not realize he can try Pro for free

**Opportunities:**
- Emphasize the free trial more: *"Try Pro free for 7 days — no credit card charged today"*
- Add a progress indicator so he knows he's almost done
- Handle Stripe return URL with a success/failure state

---

### Stage 5 — First Login to Manager Dashboard

| | Detail |
|-|--------|
| **Action** | Arrives at `/manager/[id]` for the first time |
| **Touchpoint** | Manager dashboard — Live Tables tab (default) |
| **Emotion** | 😊 Excited, but slightly overwhelmed by all the tabs |
| **System** | Full dashboard loads with empty state (no orders yet) |

**Pain points:**
- No onboarding checklist or guided tour — he doesn't know where to start
- Empty states are plain — no call-to-action to add menu items or print QR codes
- He has to discover the QR code URL himself (Tables tab → table row)

**Opportunities:**
- Add a "Getting Started" checklist: ✅ Add menu items → ✅ Print QR codes → ✅ Create staff accounts
- Add a "Setup Guide" banner that dismisses after completion
- Make QR code generation more prominent on first visit

---

### Stage 6 — First Test Order

| | Detail |
|-|--------|
| **Action** | Adds a few menu items, opens the QR URL on his phone, places a test order |
| **Touchpoint** | Menu Items tab → customer ordering page |
| **Emotion** | 😊 Satisfying to see it work end-to-end |
| **System** | Full order flow — order appears in Live Tables and kitchen display |

**Pain points:**
- He has to manually copy the QR URL — no "Open QR page" button in the dashboard
- Test orders pollute his order history and analytics

**Opportunities:**
- Add a "Preview as Customer" button that opens the ordering page in a new tab
- Add a "Test Mode" flag that excludes test orders from analytics

---

## 7. Cross-Role Journey — One Order, All Perspectives

This maps a single order from placement to billing, showing what each role experiences simultaneously.

**Scenario:** Sneha (customer) at Table 3, Priya (waiter), Arjun (kitchen), Ravi (manager)  
**Routing mode:** Waiter-first

---

```
TIME    CUSTOMER (Sneha)              WAITER (Priya)               KITCHEN (Arjun)          MANAGER (Ravi)
──────  ────────────────────────────  ───────────────────────────  ───────────────────────  ──────────────────────────
T+0:00  Scans QR, menu loads          —                            —                        —

T+0:45  Adds items to cart            —                            —                        —

T+1:30  Places order                  —                            —                        —
        Enters name + phone
        ↓
        Order created: pending_waiter

T+1:31  Status: "Order Placed"        NEW ORDER appears in         (Order NOT visible yet   Live Tables: Table 3
        (waiting...)                  "Available Orders"           — waiter-first mode)     shows 1 pending order
                                      Status: pending_waiter

T+1:45  (still waiting)               Taps "Accept Order"          —                        —
                                      accept_order_atomic()
                                      ↓
                                      Status: confirmed
                                      waiter_id = Priya
                                      table_session opened

T+1:46  Status: "Confirmed" ✓         Order moves to               NEW ORDER appears!       Live Tables: Table 3
        (kitchen has it)              "My Orders"                  Status: confirmed        shows confirmed order
                                                                   Highlighted for 4s

T+2:00  (waiting)                     (serving other tables)       Taps "Preparing"         —
                                                                   Status: preparing

T+2:01  Status: "Preparing" 🍳        —                            —                        —
        (chef is cooking)

T+8:00  (waiting)                     —                            Taps "Ready"             —
                                                                   Status: ready

T+8:01  Status: "Ready!" 🔔           "Ready" badge on             Order shows as ready     Live Tables: Table 3
        (almost here)                 Table 3 order                (no more actions)        shows ready order

T+8:30  (food arrives)                Delivers food                —                        —
                                      Taps "Mark Served"
                                      Status: served
                                      served_at = now()

T+8:31  Status: "Served" ✅           Order disappears from        Order disappears from    Live Tables: Table 3
        (eating)                      "My Orders"                  kitchen queue            shows "Bill (1)" button

T+25:00 (finished eating,             —                            —                        Taps "Bill (1)"
         waiting for bill)                                                                  generate_bill()
                                                                                            total_amount set
                                                                                            billed_at = now()

T+25:01 Orders tab goes blank         —                            —                        Table 3 shows as free
        (session cleared)                                                                   table_session closed
```

---

### What Each Role Felt

| Role | High Point | Low Point |
|------|-----------|-----------|
| **Sneha** | Placing the second order with no form | Waiting for the bill with no notification |
| **Priya** | Seeing "Ready" without running to the kitchen | Racing another waiter to claim an order |
| **Arjun** | Clean queue, one-tap status updates | No audio alert for new orders |
| **Ravi** | Real-time floor visibility from his phone | Can't bill until waiter marks served |

---

## 8. Emotional Arc Summary

### Customer Arc

```
Scan QR    Browse     Add to cart   Place order   Track status   Food arrives   Wait for bill
  😊  →     😊   →      😊      →   😐 (form)  →    😊       →     😊       →    😐 (waiting)
```

**Biggest drop:** The info form on first order placement. Unexpected friction.  
**Biggest win:** Real-time status tracking — removes anxiety about "where's my food?"

---

### Waiter Arc

```
Login    See queue    Claim order    Accept (waiter-first)    Serve food    Table closes
  😐  →    😊     →     😊       →        😐 (extra step)  →    😊      →     😊
```

**Biggest drop:** Waiter-first mode adds a step that feels unnecessary in a busy service.  
**Biggest win:** Knowing exactly which orders are ready without running to the kitchen.

---

### Kitchen Arc

```
Login    See queue    New order arrives    Confirm    Preparing    Ready    Queue empties
  😐  →    😊     →       😊           →    😊    →     😊     →   😊   →      😊
```

**Biggest drop:** No audio alert — visual-only in a noisy kitchen.  
**Biggest win:** Clean, simple interface with no unnecessary complexity.

---

### Manager Arc

```
Morning setup   Live tables   Billing   Problem order   Analytics   Staff mgmt
     😊       →     😊      →   😊   →     😤 (no cancel) →  😊    →    😐
```

**Biggest drop:** No order cancellation or modification — forces manual workarounds.  
**Biggest win:** Real-time floor visibility without physically walking the restaurant.

---

### Owner Onboarding Arc

```
Homepage   Sign up   Restaurant setup   Plan choice   Dashboard   First order
   😊    →   😊    →       😊         →    😐 (Stripe) →   😐 (no guide) →  😊
```

**Biggest drop:** Arriving at the dashboard with no guided setup — doesn't know where to start.  
**Biggest win:** Restaurant is live and taking orders in under 10 minutes.

---

## Key Opportunities Summary

| Priority | Opportunity | Affects |
|----------|-------------|---------|
| 🔴 High | Auto-switch to Orders tab after placing order | Customer |
| 🔴 High | "Request Bill" button in customer app | Customer |
| 🔴 High | Audio alert for new orders in kitchen | Kitchen |
| 🔴 High | Onboarding checklist / setup guide for new managers | Manager / Owner |
| 🔴 High | Order cancellation flow for managers | Manager |
| 🟡 Medium | Persist cart to sessionStorage (survive refresh) | Customer |
| 🟡 Medium | Toast when order claim fails (race condition) | Waiter |
| 🟡 Medium | "Bill All" atomic action for multi-order tables | Manager |
| 🟡 Medium | Welcome email with credentials for new staff | Manager / Waiter / Kitchen |
| 🟡 Medium | Friendly 404 pages with helpful context | Customer |
| 🟢 Low | "Preview as Customer" button in manager dashboard | Manager |
| 🟢 Low | Bulk menu item availability toggle | Manager |
| 🟢 Low | End-of-service summary for kitchen | Kitchen |
| 🟢 Low | "Last active" timestamp for staff members | Manager |

---

*User Journey Map v1.0 — QR Order. April 22, 2026.*
