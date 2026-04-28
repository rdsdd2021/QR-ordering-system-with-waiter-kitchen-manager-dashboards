# Product Requirements Document (PRD)
## QR Order — Restaurant QR Ordering & Management SaaS

| Field | Value |
|-------|-------|
| Document version | 1.0 |
| Status | Living document |
| Last updated | April 27, 2026 |
| Author | Engineering Team |

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Vision & Goals](#2-vision--goals)
3. [Target Users & Personas](#3-target-users--personas)
4. [Scope — What We're Building](#4-scope--what-were-building)
5. [Feature Requirements](#5-feature-requirements)
6. [User Stories](#6-user-stories)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Success Metrics](#8-success-metrics)
9. [Out of Scope (v1)](#9-out-of-scope-v1)
10. [Risks & Assumptions](#10-risks--assumptions)
11. [Open Questions](#11-open-questions)

---

## 1. Problem Statement

### The Pain

Running a restaurant involves constant coordination between customers, waiters, and the kitchen. The traditional process is broken in several ways:

- **Customers** wait to flag down a waiter just to place an order or ask for the bill
- **Waiters** spend time taking orders manually, re-reading handwritten notes to the kitchen, and running back and forth for status updates
- **Kitchen staff** receive unclear or incomplete orders, leading to mistakes and delays
- **Managers** have no real-time visibility into what's happening on the floor — they rely on end-of-day reports that are already stale

Paper menus are expensive to reprint, can't show real-time availability, and offer no analytics. Existing POS systems are expensive, require hardware, and have steep learning curves.

### The Opportunity

Every customer already has a smartphone. A QR code on the table is all that's needed to replace the entire order-taking process — no app download, no login, no hardware.

---

## 2. Vision & Goals

**Vision:** Make QR-based ordering the default for every restaurant — from a 5-table café to a 50-table fine dining venue — with zero hardware investment and a 10-minute setup.

### Goals

| Goal | Metric |
|------|--------|
| Reduce time-to-order for customers | Customer places order in < 2 minutes from QR scan |
| Eliminate order miscommunication | Zero orders lost between customer → kitchen |
| Give managers real-time floor visibility | Live table status always accurate |
| Make onboarding frictionless | Restaurant live in < 10 minutes |
| Build a sustainable SaaS business | Paid conversion from free tier |

---

## 3. Target Users & Personas

### Persona 1 — The Restaurant Owner / Manager

**Name:** Ravi, 38  
**Role:** Owns a mid-size restaurant (15–30 tables)  
**Goals:**
- Reduce staff overhead without sacrificing service quality
- Know what's happening on the floor without being physically present
- Get insights on which dishes sell, peak hours, and staff performance

**Pain points:**
- Spends ₹5,000–₹15,000/month on printed menus that go out of date
- Has no idea which waiter is underperforming until a customer complains
- End-of-day cash reconciliation is manual and error-prone

**Tech comfort:** Moderate. Uses WhatsApp, Zomato dashboard, basic spreadsheets.

---

### Persona 2 — The Waiter

**Name:** Priya, 24  
**Role:** Full-time waiter at a busy café  
**Goals:**
- Handle more tables without feeling overwhelmed
- Avoid running to the kitchen to check order status
- Know exactly which orders are ready to serve

**Pain points:**
- Customers flag her down constantly asking "where's my food?"
- Handwritten orders sometimes get misread by the kitchen
- No way to know if a table is ready to be cleared

**Tech comfort:** High. Uses smartphone daily, comfortable with apps.

---

### Persona 3 — The Kitchen Staff

**Name:** Arjun, 30  
**Role:** Head cook at a restaurant  
**Goals:**
- See all incoming orders clearly, in order of arrival
- Know which orders are urgent vs. just placed
- Mark orders done without leaving the kitchen

**Pain points:**
- Paper tickets get lost or misread
- No visibility into how many orders are queued up
- Has to shout across the kitchen to communicate status

**Tech comfort:** Low-moderate. Prefers large text, simple buttons, no complex navigation.

---

### Persona 4 — The Customer

**Name:** Sneha, 22  
**Role:** College student dining out  
**Goals:**
- Order quickly without waiting for a waiter
- Know when food is coming
- Split the bill easily (future)

**Pain points:**
- Waiting 10 minutes just to place an order
- No idea if the kitchen received the order
- Has to hunt down a waiter to ask for the bill

**Tech comfort:** Very high. Expects mobile-first, instant experience.

---

### Persona 5 — The Platform Admin

**Name:** Internal team member  
**Role:** Manages the SaaS platform  
**Goals:**
- Activate/deactivate restaurants
- Manage discount coupons for sales campaigns
- Monitor platform health

**Pain points:**
- No visibility into which restaurants are active vs. churned
- Manual coupon management is error-prone

---

## 4. Scope — What We're Building

QR Order is a **multi-tenant SaaS platform** with five distinct interfaces:

| Interface | Who uses it | Access |
|-----------|-------------|--------|
| Customer ordering page | Diners | Public (no login), via QR code |
| Kitchen display | Kitchen staff | Login required |
| Waiter app | Waiters | Login required |
| Manager dashboard | Restaurant owners/managers | Login required |
| Admin panel | Platform team | PIN-gated |

The platform is **web-only** (no native app). All interfaces are mobile-responsive.

---

## 5. Feature Requirements

Features are categorized as **Must Have (MVP)**, **Should Have**, or **Nice to Have**.

---

### 5.1 Customer Ordering

| # | Feature | Priority | Description |
|---|---------|----------|-------------|
| C1 | QR code scan → menu | Must Have | Each table has a unique QR. Scanning opens the menu instantly — no app download, no login. |
| C2 | Browse menu | Must Have | View all available items with name, price, description, image, and tags (Veg/Non-veg/Spicy etc.) |
| C3 | Add to cart | Must Have | Add items, adjust quantity, remove items. Cart persists within the session. |
| C4 | Place order | Must Have | Customer enters name + phone (first order only). Subsequent orders in the same session skip the form. |
| C5 | Real-time order tracking | Must Have | Customer sees live status: Placed → Confirmed → Preparing → Ready → Served |
| C6 | Multiple orders per session | Should Have | Customer can place additional orders at the same table without re-entering info |
| C7 | Order history by phone | Should Have | Customer can look up past orders at `/history` using their phone number. The page POSTs to `POST /api/customer/history` with `{ phone }` in the request body (avoids exposing phone numbers in URL query params). |
| C8 | Geo-fencing | Should Have | Optionally restrict ordering to customers physically inside the restaurant |
| C9 | Floor-based pricing | Should Have | Items on premium floors (e.g. rooftop) automatically priced with a multiplier |
| C10 | Table occupancy guard | Must Have | If another customer has unpaid orders at the table, new customers are blocked from ordering |
| C11 | Call waiter | Should Have | Customer can broadcast a "call waiter" signal from the ordering page. Sends a Supabase broadcast event (`call_waiter`) on the `restaurant:{id}` channel with `table_id`, `table_number`, and optional `customer_name`. Button is disabled for 60 seconds after use to prevent spam. Non-blocking — failure is silently swallowed. |
| C12 | Estimated wait time | Should Have | After placing an order, the cart drawer fetches `getPerformanceMetrics()` and displays an estimated wait time (derived from `avgPrepSeconds`) with a `Clock` icon. Addresses the customer pain point of not knowing how long "Preparing" will take. |

---

### 5.2 Kitchen Display

| # | Feature | Priority | Description |
|---|---------|----------|-------------|
| K1 | Live order queue | Must Have | See all active orders (pending → ready) in real time |
| K2 | Order details | Must Have | Each order shows: table number, items + quantities, time placed |
| K3 | Advance order status | Must Have | One-tap buttons: Confirm → Preparing → Ready |
| K4 | New order highlight | Should Have | New orders visually highlighted for 4 seconds |
| K5 | Real-time updates | Must Have | No page refresh needed — new orders appear instantly |
| K6 | Waiter-first mode support | Should Have | Kitchen only sees orders after waiter has accepted them |
| K7 | Bulk mark ready | Should Have | "All Ready" button in the Preparing column header marks all preparing orders as ready in one tap (visible only when ≥ 2 orders are preparing) |

---

### 5.3 Waiter App

| # | Feature | Priority | Description |
|---|---------|----------|-------------|
| W1 | View available orders | Must Have | See unassigned orders that need attention |
| W2 | Take/accept orders | Must Have | Claim an order (assign to self), open table session |
| W3 | Accept pending orders (waiter-first) | Should Have | In waiter-first mode, accept `pending_waiter` orders before kitchen sees them |
| W4 | Mark order served | Must Have | Mark ready orders as served after delivery to table |
| W5 | My orders section | Must Have | See only orders assigned to the current waiter |
| W6 | Real-time updates | Must Have | New orders and status changes appear without refresh |

---

### 5.4 Manager Dashboard

| # | Feature | Priority | Description |
|---|---------|----------|-------------|
| M1 | Live tables view | Must Have | See all tables: occupied/free, active orders, waiter assigned |
| M2 | Generate bill | Must Have | Bill all served orders at a table. Records total_amount + billed_at. |
| M3 | Payment method recording | Should Have | Record how the bill was paid: cash / card / UPI |
| M4 | Manual discount | Should Have | Apply a discount amount + reason at billing time |
| M5 | Order log | Must Have | Full history of all orders with filters by status and date |
| M6 | Analytics | Should Have | Revenue over time, top items, avg prep time, waiter performance |
| M7 | Menu management | Must Have | Add/edit/delete menu items. Toggle availability. Upload images. Bulk-import items via CSV upload. Bulk-edit all existing items at once via the "Bulk Edit" button in the Menu Items tab. |
| M8 | Categories & tags | Should Have | Organize menu items into hierarchical categories and tags |
| M9 | Floor management | Should Have | Create floors with price multipliers. Assign tables to floors. |
| M10 | Table setup | Must Have | Add/remove tables, set capacity, generate QR codes |
| M11 | Staff management | Must Have | Create waiter/kitchen accounts, toggle active/inactive, delete |
| M12 | Order routing mode | Must Have | Switch between direct-to-kitchen and waiter-first per restaurant |
| M13 | Geo-fencing settings | Nice to Have | Set restaurant coordinates + radius for customer location check |
| M14 | Subscription management | Must Have | View current plan, upgrade/downgrade plan, apply coupon, view billing history |
| M18 | Upgrade banner on sessions tab | Should Have | When a restaurant is not on Pro and not in a trial, an inline upgrade banner is shown at the top of the Live Tables (sessions) tab. The banner displays Pro plan features, a coupon input, dynamic pricing, and a CTA to start the 7-day free trial or upgrade directly. Hidden once the restaurant is on an active Pro subscription. |
| M15 | Webhooks | Nice to Have | Register HTTPS endpoints to receive real-time event notifications |
| M16 | Restaurant details | Must Have | Edit restaurant name and slug. Upload a logo image (stored in Supabase `restaurant-logos` bucket, `{restaurant_id}/logo.{ext}`); `logo_url` is saved to the `restaurants` table and the page reloads to reflect the new logo. |
| M17 | Manager-initiated orders | Should Have | Manager can place a new order on behalf of a customer directly from the Live Tables detail panel. Opens an "Add Order" modal with menu search, cart, and running total. Uses the same `placeOrder()` API as the customer ordering page, pre-filling session customer info. |

---

### 5.5 Onboarding

| # | Feature | Priority | Description |
|---|---------|----------|-------------|
| O1 | Self-serve signup | Must Have | Owner creates account with email + password |
| O2 | Restaurant creation | Must Have | Name restaurant. System auto-creates: 1 floor, 5 tables, manager profile, free subscription |
| O3 | Plan selection | Must Have | Choose Starter, Pro, Business, or Enterprise. Apply coupon. Redirect to PhonePe/Stripe for paid plans. |
| O4 | 7-day free trial | Must Have | Pro plan includes 7-day trial, no credit card required |

---

### 5.6 Subscription & Billing (SaaS)

| # | Feature | Priority | Description |
|---|---------|----------|-------------|
| S1 | Starter plan | Must Have | ₹499/month (₹399/month yearly). 5 tables, 1 staff account. |
| S2 | Pro plan | Must Have | ₹999/month (₹799/month yearly). 20 tables, 5 staff accounts, priority support. |
| S2b | Business plan | Should Have | ₹1,999/month (₹1,599/month yearly). 50 tables, 15 staff accounts, custom roles. |
| S2c | Enterprise plan | Should Have | Custom pricing. Unlimited tables & staff, dedicated account manager, API access. Contact sales. |
| S3 | Stripe checkout | Must Have | Hosted Stripe checkout with coupon support |
| S4 | Subscription webhooks | Must Have | Handle Stripe events: completed, updated, deleted, payment_failed |
| S5 | Plan limit enforcement | Must Have | Block adding tables/items beyond plan limits. Show upgrade prompt. |
| S6 | Coupon system | Should Have | Percentage or flat discounts. Expiry, usage limits, per-restaurant reuse prevention. |
| S7 | PhonePe payments | Should Have | UPI-based subscription payments via PhonePe for Indian restaurants. Uses `pg-sdk-node` SDK (`StandardCheckoutClient`) via `lib/phonepe.ts`. Supports production and sandbox environments via `PHONEPE_ENV`. |

---

### 5.7 Admin Panel

| # | Feature | Priority | Description |
|---|---------|----------|-------------|
| A1 | Restaurant list | Must Have | View all restaurants with plan, status, order count |
| A2 | Toggle restaurant active | Must Have | Deactivate a restaurant (blocks customer ordering + staff access) |
| A3 | Coupon CRUD | Must Have | Create, edit, toggle, delete discount coupons |
| A4 | Platform stats | Should Have | Total restaurants, active count, pro subscribers, total orders |
| A5 | Plan CRUD | Should Have | Create, edit, toggle active, delete pricing plans. Manage name, tagline, monthly/yearly prices (in paise), features list, CTA type, highlighted flag, and sort order. |

---

## 6. User Stories

### Customer

> **As a customer**, I want to scan a QR code on my table and immediately see the menu, so I don't have to wait for a waiter to bring it.

> **As a customer**, I want to add items to a cart and place my order from my phone, so I can order at my own pace without flagging down a waiter.

> **As a customer**, I want to see my order status update in real time, so I know when my food is being prepared and when it's ready.

> **As a customer returning to the same table**, I want to place a second order without re-entering my name and phone, so the process is faster.

> **As a customer**, I want to be told clearly if the table is already occupied by another party, so I don't accidentally place an order on someone else's tab.

---

### Waiter

> **As a waiter**, I want to see all unassigned orders that need my attention, so I can claim them and start serving.

> **As a waiter in waiter-first mode**, I want to accept or reject incoming orders before the kitchen sees them, so I can verify the table is actually occupied.

> **As a waiter**, I want to mark an order as served once I've delivered it to the table, so the manager can generate the bill.

> **As a waiter**, I want to see only my own assigned orders in "My Orders", so I'm not confused by other waiters' tables.

---

### Kitchen Staff

> **As a kitchen staff member**, I want to see all incoming orders in a clear queue with table number and items, so I know exactly what to prepare.

> **As a kitchen staff member**, I want to mark an order as "Preparing" and then "Ready" with a single tap, so I don't have to leave my station.

> **As a kitchen staff member**, I want new orders to appear on my screen automatically, so I never miss an order.

---

### Manager

> **As a manager**, I want to see which tables are occupied and what orders are active right now, so I can manage the floor without walking around.

> **As a manager**, I want to generate a bill for a table with one click after all orders are served, so checkout is fast.

> **As a manager**, I want to add, edit, and toggle menu items from my phone, so I can update the menu in real time without reprinting anything.

> **As a manager**, I want to create waiter and kitchen accounts, so my staff can log in and use their dashboards.

> **As a manager**, I want to see analytics on revenue, top dishes, and staff performance, so I can make informed decisions.

> **As a manager**, I want to choose between "direct to kitchen" and "waiter first" order routing, so I can match the system to how my restaurant operates.

> **As a manager on the free plan**, I want to see a clear upgrade prompt when I hit the table or menu item limit, so I know what I need to do to grow.

> **As a manager whose trial has expired or who is on the free plan**, I want to see an upgrade banner directly on the Live Tables tab with pricing, features, and a coupon field, so I can upgrade without navigating away from my main workflow.

---

### Restaurant Owner (Onboarding)

> **As a new restaurant owner**, I want to sign up, name my restaurant, and be ready to take orders in under 10 minutes, so I can start using the system immediately.

> **As a new restaurant owner**, I want to try the Pro plan free for 7 days without entering a credit card, so I can evaluate it before committing.

> **As a new restaurant owner**, I want to apply a discount coupon during signup, so I can take advantage of a promotion.

---

### Platform Admin

> **As a platform admin**, I want to deactivate a restaurant that violates terms, so their customers and staff can no longer use the system.

> **As a platform admin**, I want to create and manage discount coupons, so I can run sales campaigns for new signups.

---

## 7. Non-Functional Requirements

### Performance

| Requirement | Target |
|-------------|--------|
| Customer menu page load | < 2 seconds on 4G |
| Order placement end-to-end | < 3 seconds |
| Real-time order update latency | < 1 second after DB change |
| Dashboard initial load | < 3 seconds |

### Reliability

- System must handle concurrent orders from multiple tables simultaneously without data loss
- Order status transitions must be atomic — no partial updates
- Real-time channels must recover gracefully from dropped connections
- Stripe webhook processing must be idempotent — duplicate events must not double-charge or double-record

### Security

- All staff routes protected by Supabase Auth JWT
- Customer ordering requires no authentication (by design)
- RLS policies enforce restaurant-scoped data access for all staff
- Webhook payloads signed with HMAC-SHA256 — receivers can verify authenticity
- Admin API routes protected by `ADMIN_SECRET` bearer token (validated server-side via `lib/admin-auth.ts`). The browser never sees `ADMIN_SECRET` — the admin panel sends only the PIN to `POST /api/admin/proxy`, which validates the PIN and forwards requests to admin endpoints with the secret attached server-side.
- Stripe webhook signature verified before processing any event

### Scalability

- Multi-tenant architecture — each restaurant's data is isolated by `restaurant_id`
- Database indexes on all high-frequency query paths (orders by restaurant, status, table)
- Real-time channels scoped per restaurant — no cross-tenant broadcast

### Accessibility & UX

- Customer ordering page must work on any smartphone browser (no app install)
- Kitchen display optimized for large text and one-tap actions (used in noisy, fast-paced environments)
- All dashboards mobile-responsive
- No page refresh required for real-time updates on any dashboard
- Dark/light mode theming support with system preference detection (via `next-themes`)

### Data Integrity

- Order prices stored at time of order (snapshot) — menu price changes don't affect existing orders
- Order status transitions enforced at DB level via trigger (`validate_order_status_transition`)
- Billing safety check prevents new orders when a table has unpaid bills
- Coupon usage recorded atomically with advisory lock — no double-use possible

---

## 8. Success Metrics

### Activation

| Metric | Target | How measured |
|--------|--------|--------------|
| Time from signup to first order placed | < 10 minutes | `orders.created_at` - `restaurants.created_at` |
| Onboarding completion rate | > 80% | Users who reach `/manager/[id]` after signup |
| Menu items added in first session | ≥ 5 | `menu_items` count per restaurant after 24h |

### Engagement

| Metric | Target | How measured |
|--------|--------|--------------|
| Orders per restaurant per day | ≥ 10 (active restaurants) | `orders` count grouped by restaurant + day |
| Daily active restaurants | Growing week-over-week | Restaurants with ≥ 1 order in last 24h |
| Average order value | ≥ ₹300 | `AVG(total_amount)` on billed orders |
| Real-time adoption | > 90% of orders tracked live | Orders with status changes after placement |

### Retention

| Metric | Target | How measured |
|--------|--------|--------------|
| Week-1 retention | > 60% | Restaurants with orders in week 2 |
| Month-1 retention | > 40% | Restaurants with orders in month 2 |
| Churn rate | < 5%/month | Subscription cancellations |

### Revenue

| Metric | Target | How measured |
|--------|--------|--------------|
| Free → Pro conversion | > 15% | Subscriptions with plan=`pro` / total |
| Trial → Paid conversion | > 40% | `trialing` → `active` transitions |
| Monthly Recurring Revenue (MRR) | Growing | `COUNT(pro subscriptions) × ₹799` |

### Current Baseline (from live DB)

- 7 restaurants onboarded, all on free plan
- 15 total orders placed, avg order value ≈ ₹494
- 7 orders billed, 7 active orders in progress
- Most active restaurant: "The Restaurant" (10 orders, 5 staff, waiter-first mode)

---

## 9. Out of Scope (v1)

These are explicitly not being built in the current version. They are documented here to prevent scope creep.

| Feature | Reason deferred |
|---------|----------------|
| Native mobile app (iOS/Android) | Web-first is sufficient. App adds distribution overhead. |
| In-app payment processing | Restaurants handle cash/card/UPI at the table. No digital payment gateway for customers. |
| Customer accounts / loyalty program | Adds auth complexity. Phone-based history is sufficient for v1. |
| Multi-language menu | Localization adds significant complexity. English-first for now. |
| Inventory management | Out of scope — separate problem domain. |
| Table reservation / booking | Different product. Not part of the ordering flow. |
| Printer integration (receipt/KOT) | Hardware dependency. Kitchen display replaces paper KOT. |
| Customer-facing bill splitting | Complex UX. Deferred to v2. |
| Automated retry execution for webhooks | No background job infrastructure yet. Manual retry only. |
| SMS/WhatsApp order notifications | Third-party integration cost. Real-time web tracking is sufficient. |
| Multi-location restaurant chains | Single restaurant per account for now. |
| Custom domain per restaurant | Infrastructure complexity. All on shared domain. |

---

## 10. Risks & Assumptions

### Assumptions

| # | Assumption |
|---|-----------|
| A1 | Customers have a smartphone with a working camera and browser |
| A2 | Restaurant has stable WiFi or mobile data for staff dashboards |
| A3 | Kitchen staff are comfortable using a tablet or phone at their station |
| A4 | Restaurant owners are willing to manage their menu digitally |
| A5 | Supabase Realtime is reliable enough for production order tracking |
| A6 | ₹799/month is an acceptable price point for Indian restaurant owners |

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | Real-time channel drops during peak hours | Medium | High | `useKitchenOrders` auto-reconnects (3 s on error, 1 s on close) and re-fetches on reconnect. Manual refresh button retained as fallback. |
| R2 | Customer refuses to enter phone number | Medium | Medium | Phone is required for billing safety scoping. Consider making it optional with a trade-off. |
| R3 | Kitchen staff find the interface too complex | Low | High | Kitchen UI is intentionally minimal — large text, one-tap actions only. |
| R4 | Stripe payment failure during onboarding | Low | Medium | Free plan available as fallback. Stripe errors shown clearly. |
| R5 | Restaurant deactivated mid-service | Low | High | Admin deactivation is immediate. No grace period currently. Customers scanning QR codes will see a friendly "Restaurant is currently closed" screen instead of a 404. |
| R6 | Two customers scan same QR simultaneously | Medium | Medium | Billing safety check + sessionStorage scoping handles this. |
| R7 | Menu item deleted while in customer cart | Low | Medium | Order fails at DB level. Customer sees generic error. No graceful recovery. |
| R8 | Geo-fencing blocks legitimate customers | Medium | Medium | Customers can request staff to place order manually. Geo-fence is optional. |
| R9 | `orders` public UPDATE RLS policy | High | High | Any unauthenticated user can update order status. Needs to be tightened. |
| R10 | Free plan limits too restrictive for small restaurants | Medium | Medium | 5 tables + 20 items covers most small cafés. Monitor feedback. |

---

## 11. Open Questions

| # | Question | Owner | Status |
|---|---------|-------|--------|
| Q1 | Should phone number be optional for customers? What's the fallback for billing safety? | Product | Open |
| Q2 | Should inactive staff (`is_active=false`) be blocked at login, not just at the data layer? | Engineering | Open |
| Q3 | Should `past_due` subscriptions be automatically downgraded to free after a grace period? | Product | Open |
| Q4 | Should the admin panel be protected by proper auth instead of a PIN? | Engineering | Resolved — API routes use `ADMIN_SECRET` bearer token auth. The secret is kept server-side; the browser sends only the PIN to `/api/admin/proxy`, which forwards requests with the secret attached. |
| Q5 | Should webhook retries be executed automatically by a cron job? | Engineering | Open |
| Q6 | Should managers be able to force-bill an order that isn't in `served` status? | Product | Open |
| Q7 | Should cart state persist across page refreshes (localStorage)? | Product | Open |
| Q8 | What happens when a restaurant hits the free plan limit mid-service? Should existing orders still go through? | Product | Open |
| Q9 | Should there be a grace period before a restaurant is deactivated by admin? | Product | Open |
| Q10 | Is ₹799/month the right price point? Should there be a per-table pricing model instead? | Business | Open |

---

*PRD v1.0 — QR Order. Based on live system analysis as of April 22, 2026.*
