# QR Order

A multi-tenant SaaS platform for QR-based restaurant ordering. Customers scan a table QR code, browse the menu, and place orders from their phone - no app needed. Staff manage everything in real time across kitchen, waiter, and manager dashboards.

Built with **Next.js 16**, **Supabase** (Postgres + Realtime + Auth), **PhonePe** payments, deployed on **Vercel**.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Tech Stack](#tech-stack)
3. [Environment Variables](#environment-variables)
4. [Project Structure](#project-structure)
5. [Routes](#routes)
6. [Database Schema](#database-schema)
7. [Row-Level Security](#row-level-security)
8. [Database Functions and Triggers](#database-functions-and-triggers)
9. [Order Flow](#order-flow)
10. [Real-time System](#real-time-system)
11. [Payment and Subscriptions](#payment-and-subscriptions)
12. [Coupon System](#coupon-system)
13. [Webhook System](#webhook-system)
14. [Audit Log System](#audit-log-system)
15. [Admin Panel](#admin-panel)
16. [Analytics](#analytics)
17. [Feature Reference](#feature-reference)
18. [Cron Jobs](#cron-jobs)
19. [Deployment](#deployment)
20. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000

**Staff login at /login:**
```text
Manager:  manager@demo.com  / password123
Waiter:   waiter@demo.com   / password123
Kitchen:  kitchen@demo.com  / password123
```

**Run tests:**
```bash
npm test
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2 (React 19, App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (Radix UI) |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth (email/password) |
| Real-time | Supabase Realtime (WebSocket broadcast + postgres_changes) |
| Storage | Supabase Storage (menu images, logos) |
| Payments | PhonePe Standard Checkout (pg-sdk-node) |
| Hosting | Vercel |
| Testing | Vitest + React Testing Library |
| Icons | Lucide React (tree-shaken) |
| Animation | Motion (Framer Motion v12) |

---

## Environment Variables

Create .env.local in qr-order/:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key   # server-side only

# PhonePe
PHONEPE_CLIENT_ID=your_client_id
PHONEPE_CLIENT_SECRET=your_client_secret
PHONEPE_CLIENT_VERSION=1
PHONEPE_ENV=production                            # or: sandbox
PHONEPE_WEBHOOK_USERNAME=your_webhook_username
PHONEPE_WEBHOOK_PASSWORD=your_webhook_password

# Admin
ADMIN_SECRET=your_admin_secret                    # server-side API route auth
NEXT_PUBLIC_ADMIN_PIN=your_admin_pin              # shown in PIN input UI

# Security
CHANNEL_SECRET=your_channel_secret               # makes Realtime channel names unguessable
CRON_SECRET=your_cron_secret                     # Vercel cron job auth

# App
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

| Variable | Required | Purpose |
|----------|----------|---------|
| NEXT_PUBLIC_SUPABASE_URL | Yes | All Supabase clients |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Yes | Client-side queries, order placement |
| SUPABASE_SERVICE_ROLE_KEY | Yes | All server-side API routes (bypasses RLS) |
| PHONEPE_CLIENT_ID | Yes | PhonePe checkout + webhook validation |
| PHONEPE_CLIENT_SECRET | Yes | PhonePe checkout + webhook validation |
| PHONEPE_CLIENT_VERSION | Yes | PhonePe SDK version |
| PHONEPE_ENV | Yes | production or sandbox |
| PHONEPE_WEBHOOK_USERNAME | Yes | Webhook callback auth |
| PHONEPE_WEBHOOK_PASSWORD | Yes | Webhook callback auth |
| ADMIN_SECRET | Yes | /api/admin/* route authentication |
| NEXT_PUBLIC_ADMIN_PIN | Yes | Admin UI PIN gate |
| CHANNEL_SECRET | No | HMAC token appended to Realtime channel names |
| CRON_SECRET | No | Cron job endpoint authentication |
| NEXT_PUBLIC_APP_URL | No | Absolute URL construction |

---

## Project Structure

```
app/
├── page.tsx                              # Landing page (hero, features, pricing)
├── onboarding/                           # 3-step signup: account → restaurant → plan
├── login/                                # Staff email/password login
├── admin/                                # Super-admin panel (PIN-gated)
├── demo/                                 # Demo/preview page
├── history/                              # Customer order history (by phone number)
├── manager/[restaurant_id]/              # Manager dashboard (tabbed)
├── kitchen/[restaurant_id]/              # Kitchen display system
├── waiter/[restaurant_id]/               # Waiter app
├── r/[restaurant_id]/t/[table_id]/       # Customer ordering page
├── terms/ privacy/ refunds/ shipping/    # Legal pages
├── unauthorized/                         # Access denied
└── api/
    ├── onboard/                          # POST: create restaurant + defaults
    ├── orders/                           # POST: place order (rate-limited)
    ├── floors/                           # GET: list floors
    ├── plans/                            # GET: list active plans
    ├── coupons/validate/                 # POST: validate coupon code
    ├── customer/history/                 # POST: order history by phone
    ├── staff/create|update|delete|toggle-active/
    ├── phonepe/checkout/                 # POST: create PhonePe checkout session
    ├── phonepe/popup-callback/           # POST: PhonePe popup callback
    ├── phonepe/verify/                   # POST: verify PhonePe payment
    ├── phonepe/webhook/                  # POST: PhonePe payment webhook
    ├── webhooks/                         # GET/POST: manage webhook endpoints
    │   └── [id]/deliveries|test|retry|rotate-secret/
    ├── audit/                            # POST: write audit log (client-side)
    ├── audit-logs/                       # GET: query audit logs (paginated)
    │   └── download/                     # POST: export as CSV
    ├── cron/audit-log-purge/             # GET: purge old audit logs (daily)
    ├── cron/webhook-retries/             # GET: retry failed webhooks (every minute)
    └── admin/
        ├── verify-pin/                   # POST: verify admin PIN server-side
        ├── proxy/                        # POST: proxy admin requests
        ├── toggle-restaurant/            # POST: activate/deactivate restaurant
        ├── change-password/              # POST: change manager password
        ├── coupons/ [id]/                # CRUD: coupon management
        └── plans/ [id]/                  # CRUD: plan management

components/
├── manager/
│   ├── Analytics.tsx                    # Revenue charts, top items, waiter stats
│   ├── AuditLogPanel.tsx                # Audit trail with filtering
│   ├── BillingPanel.tsx                 # Plan selection, billing history, invoices
│   ├── BillDialog.tsx                   # Bill a table with payment method + discount
│   ├── CategoryTagManager.tsx           # Food categories and tags CRUD
│   ├── FloorsManager.tsx                # Floor CRUD with price multipliers
│   ├── MenuManager.tsx                  # Menu CRUD, bulk upload, categories/tags
│   ├── OrderLog.tsx                     # Order history with filtering
│   ├── RestaurantDetails.tsx            # Restaurant name, logo, slug
│   ├── SettingsPanel.tsx                # Routing mode, geo-fencing, auto-confirm
│   ├── StaffManager.tsx                 # Staff CRUD, role assignment, deactivation
│   ├── TableSessions.tsx                # Billing interface (bill tables)
│   ├── TablesManager.tsx                # Table CRUD, QR generation
│   ├── UpgradeBanner.tsx                # Upgrade CTA with coupon input
│   └── WebhooksManager.tsx             # Webhook CRUD, delivery history, test events
├── admin/
│   ├── AuditLogAdmin.tsx                # Platform-wide audit logs
│   ├── CouponManager.tsx                # Coupon CRUD
│   └── PlanManager.tsx                  # Plan CRUD
├── kitchen/
│   ├── OrderCard.tsx
│   └── OrderItemList.tsx
├── waiter/
│   └── WaiterOrderCard.tsx
├── CartDrawer.tsx
├── CartBadge.tsx
├── CouponInput.tsx                      # Reusable coupon code input with live validation
├── MenuItemCard.tsx
├── MenuSkeleton.tsx
├── OrderStatusTracker.tsx
├── PricingSection.tsx
├── ProtectedRoute.tsx
├── AuthRedirect.tsx
├── ThemeProvider.tsx
└── ThemeToggle.tsx

hooks/
├── useAuth.ts                           # Auth state, sign in/out, role helpers
├── useCart.ts                           # Cart state management
├── useCustomerSession.ts                # Customer session (name, phone, party size)
├── useGeofence.ts                       # Location-based ordering restriction
├── useKitchenOrders.ts                  # Kitchen real-time order board
├── useNotificationSounds.ts             # Web Audio API sounds + vibration
├── usePlans.ts                          # Fetch and cache subscription plans
├── useRealtimeMenu.ts                   # Real-time menu availability updates
├── useSubscription.ts                   # Plan status, limits, upgrade flow
└── useWaiterOrders.ts                   # Waiter real-time order board

lib/
├── admin-auth.ts                        # ADMIN_SECRET validation for API routes
├── api.ts                               # Supabase query helpers (getRestaurant, etc.)
├── audit-alert.ts                       # Critical audit event dispatcher
├── audit-log.ts                         # writeAuditLog, severity mapping, cursor helpers
├── batchCreateMenuItems.ts              # Bulk menu item creation
├── channel-token.ts                     # HMAC channel token for secure Realtime
├── csvParser.ts                         # CSV parsing for bulk menu upload
├── phonepe.ts                           # PhonePe SDK client factory
├── rate-limit.ts                        # In-memory rate limiter for API routes
├── server-auth.ts                       # JWT decode + DB lookup (no network call)
├── supabase.ts                          # Supabase client instances
├── utils.ts                             # cn() and other utilities
└── webhooks.ts                          # Webhook dispatch engine, HMAC signing, retry

types/
├── database.ts                          # TypeScript types mirroring DB schema
└── webhooks.ts                          # Webhook event types, payload shapes

supabase/
├── COMPLETE_MIGRATION.sql               # Full schema + RLS + functions (run this)
├── MASTER_MIGRATION.sql                 # Alternative master migration
├── migration_advanced_features.sql      # Advanced features migration
├── migration_realtime_complete.sql      # Realtime triggers migration
├── fix_order_assignment.sql             # Order assignment fix
└── setup_auth_users.sql                 # Link auth users to profiles
```

---

## Routes

| URL | Who | Description |
|-----|-----|-------------|
| / | Public | Landing page with features and pricing |
| /onboarding | New owners | 3-step signup: account, restaurant name, plan |
| /login | Staff | Email/password login |
| /admin | Super admin | Platform management (PIN-gated) |
| /demo | Public | Demo/preview |
| /history | Customers | Order history lookup by phone number |
| /manager/[id] | Manager | Full dashboard (orders, menu, tables, staff, analytics, billing, webhooks, audit) |
| /kitchen/[id] | Kitchen staff | Real-time order queue |
| /waiter/[id] | Waiters | Order assignment and serving |
| /r/[id]/t/[table_id] | Customers | Menu browsing and ordering |
| /terms /privacy /refunds /shipping | Public | Legal pages |
| /unauthorized | — | Access denied |

---

## Database Schema

All tables have RLS enabled. The live database currently holds 16 restaurants, 81 tables, 107 orders, 35 users, 171 audit log entries, and 64 webhook deliveries.

### Core tables

| Table | Key columns | Notes |
|-------|-------------|-------|
| restaurants | id, name, slug, owner_id, is_active, order_routing_mode, waiter_assignment_mode, geofencing_enabled, geo_latitude, geo_longitude, geo_radius_meters, auto_confirm_minutes, logo_url | order_routing_mode: direct_to_kitchen or waiter_first. waiter_assignment_mode: auto_assign or broadcast |
| floors | id, restaurant_id, name, price_multiplier | Multiplier defaults to 1.0. Rooftop at 1.2x makes a Rs.100 item Rs.120 |
| tables | id, restaurant_id, floor_id, table_number, capacity, qr_code_url | Unique on (restaurant_id, table_number) |
| menu_items | id, restaurant_id, name, price, is_available, image_url, tags[], description | tags is a text array |
| food_categories | id, restaurant_id, parent_id, name, color, sort_order, is_suggestion | Hierarchical. parent_id = null means top-level |
| food_tags | id, restaurant_id, name, color, sort_order | Custom tags per restaurant |
| menu_item_categories | menu_item_id, category_id | Many-to-many join |
| menu_item_tags | menu_item_id, tag_id | Many-to-many join |
| category_suggestions | id, name, parent_name | Global templates shown during category creation |
| tag_suggestions | id, name | Global tag templates |
| users | id, restaurant_id, auth_id, name, role, email, is_active, is_super_admin | role: waiter, manager, or kitchen |
| orders | id, restaurant_id, table_id, waiter_id, status, total_amount, billed_at, confirmed_at, preparing_at, ready_at, served_at, customer_name, customer_phone, party_size, payment_method, discount_amount, discount_note | payment_method: cash, card, or upi |
| order_items | id, order_id, menu_item_id, quantity, price | Price stored at order time |
| order_status_logs | id, order_id, old_status, new_status, changed_by, created_at | Full audit trail of every status change |
| table_sessions | id, restaurant_id, table_id, waiter_id, opened_at, closed_at | Unique on (table_id, closed_at) - one open session per table |
| reviews | id, menu_item_id, rating (1-5), comment, created_at | Customer reviews for menu items |

### Billing tables

| Table | Key columns | Notes |
|-------|-------------|-------|
| subscriptions | id, restaurant_id, plan, status, phonepe_transaction_id, current_period_end, trial_used, pending_coupon_id | plan: free or pro. status: active, trialing, past_due, canceled, incomplete |
| plans | id, name, tagline, monthly_paise, yearly_paise, features[], unavailable[], is_active, is_highlighted, cta, sort_order | Admin-managed. cta: choose, contact, or downgrade_unsupported |
| payment_transactions | id, restaurant_id, merchant_order_id, plan, amount_paise, status, coupon_code, coupon_duration_days | One row per PhonePe checkout attempt |
| coupons | id, code, type, value, max_uses, used_count, expires_at, is_active, applicable_plans[], duration_days | type: percentage or flat |
| coupon_usages | id, coupon_id, restaurant_id, used_at | Unique on (coupon_id, restaurant_id) |

### Webhook tables

| Table | Key columns | Notes |
|-------|-------------|-------|
| webhook_endpoints | id, restaurant_id, name, url, secret, events[], is_active, failure_count, disabled_reason, last_triggered_at | URL must be HTTPS. Auto-disabled after 10 consecutive failures |
| webhook_deliveries | id, endpoint_id, event_id, event_type, payload, status, http_status, response_body, error_message, attempt, max_attempts, duration_ms, next_retry_at, delivered_at | status: pending, retrying, success, failed, dead. Max 5 attempts |

### Audit tables

| Table | Key columns | Notes |
|-------|-------------|-------|
| audit_logs | id, restaurant_id, actor_type, actor_id, actor_name, action, resource_type, resource_id, resource_name, metadata, severity, ip_address, created_at | Immutable - UPDATE/DELETE blocked by trigger. severity: info, warning, critical |
| audit_notifications | id, audit_log_id, restaurant_id, status, attempts, last_error, delivered_at | In-app notifications for critical events. Unique on audit_log_id |

### Order status machine

`
pending        ──────────────────────────────► confirmed ──► preparing ──► ready ──► served ──► (billed)
pending_waiter ──(waiter accepts)────────────► confirmed
any active     ──────────────────────────────► cancelled
`

- direct_to_kitchen routing: new orders start as pending
- waiter_first routing: new orders start as pending_waiter
- cancelled is a terminal state - no further transitions
- Enforced at DB level by the validate_order_status_transition trigger

### Plan limits

| Plan | Max tables | Max menu items | Analytics | Advanced features |
|------|-----------|----------------|-----------|-------------------|
| free | 5 | 20 | No | No |
| pro | 999 | 999 | Yes | Yes |

---

## Row-Level Security

Every table has RLS enabled. Policies are enforced by Postgres - the anon key cannot bypass them.

### Key policies

| Table | Who can read | Who can write |
|-------|-------------|---------------|
| restaurants | Anyone (active only); managers see own; super-admins see all | Managers update own; service role creates |
| tables | Anyone (public read) | Managers manage own restaurant tables |
| menu_items | Anyone (available items); staff see all own restaurant items | Managers manage own restaurant menu |
| orders | Anyone (public read) | Anyone can INSERT; kitchen/waiter/manager can UPDATE; customers can cancel pending orders |
| order_items | Anyone (public read) | Anyone can INSERT for unbilled orders |
| users | Authenticated users see own profile + same restaurant colleagues | Managers insert/update/delete own restaurant staff |
| floors | Anyone (public read) | Managers manage own restaurant floors |
| food_categories | Anyone (public read) | Managers manage own restaurant categories |
| food_tags | Anyone (public read) | Managers manage own restaurant tags |
| subscriptions | Managers read own restaurant subscription | Service role only |
| plans | Anyone reads active plans | Service role only |
| coupons | Anyone reads active coupons | Service role only |
| coupon_usages | Service role only | Service role only |
| payment_transactions | Managers read own restaurant transactions | Service role only |
| webhook_endpoints | Managers manage own restaurant endpoints | Managers + service role |
| webhook_deliveries | Managers read own restaurant deliveries | Service role full access |
| audit_logs | Managers read own restaurant logs | Service role only (via writeAuditLog) |
| audit_notifications | No direct user access | Service role only |
| table_sessions | Restaurant staff read own | Waiters open; staff close |

### Helper DB functions used in policies

- get_current_user_restaurant() - returns the restaurant_id for the authenticated user
- get_user_role() - returns the role for the authenticated user
- user_has_role(required_role) - checks if the authenticated user has a specific role

### Admin bypass

All /api/admin/* routes use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS entirely. These routes are protected by ADMIN_SECRET header validation in lib/admin-auth.ts.

---

## Database Functions and Triggers

### Core functions

| Function | Returns | Purpose |
|----------|---------|---------|
| onboard_restaurant(auth_id, name, email, owner_name) | jsonb | Creates restaurant + Main Floor + 5 tables + manager user + 7-day trial subscription in one atomic transaction. Idempotent. |
| get_initial_order_status(restaurant_id) | text | Returns pending or pending_waiter based on the restaurant routing mode |
| calculate_item_price(menu_item_id, table_id) | numeric | Applies floor price_multiplier to base menu item price |
| calculate_item_prices_batch(items, table_id) | jsonb | Batch version of calculate_item_price for order placement |
| calculate_order_total(order_id) | numeric | Sums quantity * price for all order_items |
| generate_bill(order_id, payment_method, discount_amount, discount_note, force) | record | Calculates total, applies discount, sets billed_at. force=true auto-advances non-served orders |
| bill_table(table_id, payment_method, discount_amount, discount_note, force) | jsonb | Bills all unbilled orders at a table. Prorates discount across orders by their share of gross total. Closes table session when all orders billed |
| check_table_has_unpaid_orders(table_id, customer_phone) | boolean | Returns true if table has unbilled non-cancelled orders from a different customer |
| get_table_unpaid_orders(table_id) | record set | Returns all unbilled non-cancelled orders at a table |
| open_table_session(restaurant_id, table_id, waiter_id) | uuid | Opens a table session or updates waiter on existing open session |
| close_table_session(table_id) | void | Closes session only if no unbilled non-cancelled orders remain |
| assign_order_to_waiter(order_id, waiter_id) | boolean | Atomically assigns waiter with row lock. Fails if already assigned |
| accept_order_atomic(order_id, waiter_id) | boolean | Atomically accepts a pending_waiter order, assigns waiter, opens table session |
| validate_coupon(code, plan, restaurant_id) | jsonb | Validates coupon: active, not expired, usage limit, plan match, per-restaurant reuse. Normalizes pro_monthly/pro_yearly to pro |
| record_coupon_usage(coupon_id, restaurant_id) | boolean | Atomically records coupon use with advisory lock. Idempotent via ON CONFLICT DO NOTHING |
| get_analytics_summary(restaurant_id, range_start, range_end, prev_start, prev_end) | jsonb | Single RPC returning all analytics: curr_sales, prev_sales, top_items, daily_data, waiter_stats, payment_split, status_counts, hourly_traffic |
| get_restaurant_plan(restaurant_id) | text | Returns current plan (free or pro) for a restaurant |
| get_plan_limits(plan) | jsonb | Returns max_tables, max_menu_items, analytics, advanced_features for a plan |
| search_audit_logs(...filters, cursor, page_size) | record set | Keyset-paginated audit log search with full-text search on actor_name, resource_name, metadata |
| count_audit_logs(...filters) | bigint | Count matching audit logs (used for pagination total) |
| purge_expired_audit_logs() | jsonb | Deletes audit logs past retention: critical=365d, warning=90d, info=30d. Sets app.audit_purge_active=true to bypass immutability trigger |
| auto_confirm_pending_orders() | void | Advances pending orders older than auto_confirm_minutes to confirmed |
| migrate_pending_waiter_orders(restaurant_id) | integer | Migrates pending_waiter orders to pending (used when switching routing mode) |

### Triggers

| Trigger | Table | Timing | Function | Purpose |
|---------|-------|--------|----------|---------|
| validate_order_status_transition | orders | BEFORE INSERT/UPDATE | validate_order_status_transition() | Enforces the order state machine. Raises exception on invalid transitions |
| update_order_timestamps_trigger | orders | BEFORE INSERT/UPDATE | update_order_timestamps() | Sets confirmed_at, preparing_at, ready_at, served_at when status changes |
| auto_assign_waiter_from_session | orders | BEFORE INSERT | auto_assign_waiter_from_session() | Tier 1: assigns waiter from open table session |
| auto_assign_table_waiter_trigger | orders | BEFORE INSERT | auto_assign_table_waiter() | Tier 2: inherits waiter from another active order on same table. Tier 3: assigns least-busy active waiter. Skipped in broadcast mode |
| trg_auto_assign_waiter_on_confirm | orders | BEFORE UPDATE | auto_assign_waiter_on_confirm() | Assigns least-busy waiter when order status changes to confirmed and no waiter is set (auto_assign mode only) |
| log_order_status_change | orders | AFTER INSERT/UPDATE | log_order_status_change() | Inserts a row into order_status_logs on every status change |
| orders_broadcast_trigger | orders | AFTER INSERT/UPDATE | broadcast_order_changes() | Broadcasts order_changed event to kitchen, waiter, manager, and customer Realtime channels |
| on_order_item_insert | order_items | AFTER INSERT | broadcast_order_on_items_insert() | Broadcasts INSERT event to kitchen, waiter, manager channels after order_items are committed (ensures items exist before kitchen sees the order) |
| on_restaurant_created | restaurants | AFTER INSERT | create_default_subscription() | Creates a 7-day trialing Pro subscription for every new restaurant |
| audit_logs_immutability_guard | audit_logs | BEFORE UPDATE/DELETE | audit_logs_immutable() | Blocks all UPDATE and DELETE on audit_logs. DELETE is only allowed when app.audit_purge_active = true |
| trg_coupons_updated_at | coupons | BEFORE UPDATE | update_coupon_updated_at() | Sets updated_at = now() |
| plans_updated_at | plans | BEFORE UPDATE | set_updated_at() | Sets updated_at = now() |
| trg_webhook_endpoints_updated_at | webhook_endpoints | BEFORE UPDATE | set_updated_at() | Sets updated_at = now() |

### Waiter auto-assignment tiers

When a new order is inserted with no waiter_id, three triggers fire in sequence:

1. auto_assign_waiter_from_session (Tier 1): checks for an open table_session and assigns that waiter
2. auto_assign_table_waiter (Tier 2): if no session, inherits waiter from another active unbilled order at the same table
3. auto_assign_table_waiter (Tier 3): if still unassigned, picks the least-busy active waiter (fewest non-cancelled, unbilled, non-served orders)

In broadcast mode (waiter_assignment_mode = broadcast), all auto-assignment is skipped and the order is visible to all waiters until one accepts it.

---

## Order Flow

### Customer flow

1. Scan QR code at table -> /r/[restaurant_id]/t/[table_id]
2. Server-side: validates restaurant is active, table exists, fetches menu + floor info in parallel
3. If restaurant.is_active = false: shows "Restaurant is currently closed" screen
4. Browse menu (real-time availability updates via useRealtimeMenu)
5. Add items to cart (geo-fence check if enabled)
6. First order at table: enter name, phone number, optional party size
7. Subsequent orders (same session): skips form, places immediately
8. POST /api/orders (rate-limited: 10/min per table, 30/hour per IP)
9. Server checks for unpaid orders from a different customer (check_table_has_unpaid_orders)
10. If UNPAID_ORDERS_EXIST: cart drawer shows error, order blocked
11. Order inserted with status = pending (direct_to_kitchen) or pending_waiter (waiter_first)
12. calculate_item_prices_batch applies floor price multiplier
13. order_items inserted -> on_order_item_insert trigger broadcasts to kitchen/waiter/manager
14. Customer tracks order status live in "My Orders" tab
15. Session clears when all orders at the table are billed

### Rate limiting

Orders are rate-limited server-side in /api/orders using an in-memory store (lib/rate-limit.ts):
- 10 orders per minute per table (prevents table spam)
- 30 orders per hour per IP (prevents cross-table abuse)
- Store purges expired entries every 100 requests to prevent memory growth
- Returns HTTP 429 with Retry-After header on limit exceeded

### Billing flow

1. Manager -> Tables tab -> sees all unbilled orders grouped by table
2. Click "Bill" -> BillDialog opens
3. Select payment method (cash / card / upi)
4. Optional: apply discount amount + note
5. bill_table() RPC: prorates discount across orders by their share of gross total, sets billed_at, payment_method, discount_amount on each order
6. If force=true: auto-advances non-served orders to served before billing
7. Table session closes when all orders are billed
8. Downloadable HTML receipt generated client-side

### Floor pricing

calculate_item_price() multiplies the base menu item price by the floor price_multiplier.
Example: Rooftop floor with 1.2x -> Rs.100 item becomes Rs.120.
The batch version (calculate_item_prices_batch) is called during order placement.

### Order assignment (race condition safe)

- assign_order_to_waiter() uses SELECT FOR UPDATE to lock the order row
- accept_order_atomic() locks the order row and opens a table session atomically
- unique_active_session index on (table_id, closed_at) prevents two open sessions per table
- If two waiters try to accept the same order simultaneously, one gets an exception

---

## Real-time System

### Channels

| Channel | Subscribers | Events |
|---------|-------------|--------|
| kitchen:{restaurant_id} | Kitchen dashboard | order_changed (INSERT + UPDATE) |
| waiter:{restaurant_id} | Waiter dashboard | order_changed (INSERT + UPDATE) |
| manager:{restaurant_id} | Manager dashboard | order_changed (INSERT + UPDATE) |
| customer:{restaurant_id}:{table_id} | Customer page | order_changed (status + total_amount) |
| critical-alerts:{restaurant_id} | Manager dashboard | critical_alert (audit events) |

### Channel security

Channel names include a 12-character HMAC-SHA256 token derived from CHANNEL_SECRET + scope + id.
This makes channel names unguessable - a client that only knows the restaurant UUID cannot subscribe to kitchen:{id}:{token} without knowing CHANNEL_SECRET.
Falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY in development.

### How order broadcasts work

1. Customer places order -> orders INSERT
2. on_order_item_insert trigger fires after each order_items INSERT
3. Broadcasts INSERT event to kitchen, waiter, manager channels (fires on every item insert for reliability)
4. Status updates -> orders_broadcast_trigger -> broadcast_order_changes() -> broadcasts UPDATE to all channels
5. Customer channel receives only id, status, total_amount (minimal payload)

### Reconnection handling

Both useKitchenOrders and useWaiterOrders implement:
- Automatic reconnect on CHANNEL_ERROR (5s backoff) and CLOSED (3s backoff)
- Silent background refresh on reconnect (no skeleton flash)
- Page visibility change handler: refreshes and reconnects when tab becomes visible again
- Deduplication of concurrent fetches for the same order via fetchingRef Set
- Optimistic updates with rollback on failure

### Server-side auth for API routes

lib/server-auth.ts decodes the JWT payload locally (no network call to Supabase Auth) to extract the sub claim, then looks up the user in the users table via the service role client. This avoids 10-second timeouts caused by outbound HTTPS calls to the Auth server.

---

## Payment and Subscriptions

### Pricing

Plans are stored in the plans table and managed via the admin panel. Current pricing:
- Pro Monthly: Rs.999/month
- Pro Yearly: Rs.799/month billed annually (save ~20%)
- Trial: 7-day free trial on all new signups (no credit card required, full Pro access)

### Onboarding flow

1. /onboarding step 1: create account (email/password via Supabase Auth)
2. Step 2: name restaurant -> POST /api/onboard -> onboard_restaurant() RPC
   - Creates: restaurant + Main Floor + 5 tables + manager user profile + 7-day trialing subscription
   - Idempotent: returns existing restaurant_id if already onboarded
3. Step 3: choose plan
   - Apply coupon code (live price update)
   - Click "Start 7-day free trial" -> POST /api/phonepe/checkout
   - Or skip to free plan

### PhonePe checkout flow

1. Manager clicks "Upgrade" -> POST /api/phonepe/checkout
2. Server validates plan from DB (must have cta = choose)
3. Server validates coupon if provided (validate_coupon RPC)
4. Calculates final amount: base_price - discount (minimum Rs.1)
5. Creates PhonePe StandardCheckoutPayRequest with:
   - merchantOrderId: SUB-{uuid} (unique per attempt)
   - metaInfo.udf1: restaurantId (fallback for webhook recovery)
   - metaInfo.udf2: couponDbId
6. Stores pending transaction in payment_transactions
7. Updates subscription to incomplete (unless currently trialing)
8. Returns PhonePe checkout URL
9. Client redirects to PhonePe payment page
10. On completion: PhonePe calls POST /api/phonepe/webhook

### PhonePe webhook flow

1. POST /api/phonepe/webhook receives callback
2. Validates callback signature using PHONEPE_WEBHOOK_USERNAME + PHONEPE_WEBHOOK_PASSWORD
3. Looks up subscription by phonepe_transaction_id
4. Fallback: if lookup misses, recovers restaurantId from metaInfo.udf1 (race condition safety)
5. Fetches payment_transactions row to get plan and coupon_duration_days
6. On payment success:
   - Updates subscription: plan=pro, status=active, current_period_end = now + 30 days (or + coupon_duration_days)
   - Records coupon usage atomically (record_coupon_usage RPC)
   - Updates payment_transactions status to completed
   - Writes audit log: billing.subscription_activated
7. On payment failure:
   - Distinguishes renewal failure (past_due) from first-time failure (incomplete)
   - Writes audit log: billing.subscription_expired
8. Subscription update triggers Realtime broadcast -> useSubscription hook updates UI

### Subscription states

| Status | Meaning | Access |
|--------|---------|--------|
| trialing | 7-day free trial | Full Pro access |
| active | Paid subscription | Full Pro access |
| past_due | Renewal payment failed | Temporary access |
| incomplete | First-time payment failed | No Pro access |
| canceled | Subscription canceled | No Pro access |

### Billing panel (Manager -> Billing tab)

- Monthly/yearly billing toggle
- Plan cards loaded from DB (excludes free tier)
- Coupon input on Pro card for non-paid users
- Billing history table with downloadable HTML receipts
- Current plan status with renewal date
- Payment method display (PhonePe)
- Billing address (stored in localStorage per restaurant)

---

## Coupon System

### Overview

Flexible discount system with percentage or flat discounts, expiry, usage limits, plan targeting, and optional bonus subscription days.

### Coupon fields

| Field | Description |
|-------|-------------|
| code | Uppercase unique code (e.g. LAUNCH20) |
| type | percentage or flat |
| value | Percentage (0-100) or flat amount in rupees |
| max_uses | NULL = unlimited |
| expires_at | NULL = never expires |
| applicable_plans | Array e.g. {pro} |
| duration_days | Bonus days added to subscription period on redemption |

### Validation rules (server-side only, via validate_coupon RPC)

1. Code exists (case-insensitive, trimmed)
2. is_active = true
3. Not expired (expires_at < now)
4. used_count < max_uses (if set)
5. Plan is in applicable_plans (normalizes pro_monthly/pro_yearly to pro)
6. Restaurant has not used this coupon before (coupon_usages unique constraint)

### Usage recording (record_coupon_usage RPC)

- Uses pg_advisory_xact_lock keyed on coupon_id to prevent concurrent over-use
- Re-validates usage limit under lock
- INSERT ... ON CONFLICT DO NOTHING for idempotency
- Only increments used_count when a new row was actually inserted

### Admin management

/admin -> Coupons tab -> full CRUD: create, edit, toggle active, delete.

### Frontend integration

- Onboarding step 3 (Plan): coupon input with live price update
- Manager Billing tab: coupon input on Pro plan card for non-paid users
- CouponInput component: calls POST /api/coupons/validate, shows discount preview

---

## Webhook System

### Overview

Restaurants can register HTTPS endpoints to receive real-time event notifications. The system supports 16 event types, HMAC-SHA256 signatures, automatic retries, and delivery tracking.

### Supported events

| Group | Events |
|-------|--------|
| Orders | order.placed, order.confirmed, order.preparing, order.ready, order.served, order.billed, order.cancelled |
| Tables | table.session_opened, table.session_closed |
| Menu | menu.item_created, menu.item_updated, menu.item_deleted |
| Staff | staff.created, staff.deactivated |
| Payment | payment.method_recorded |
| Test | test |

### Payload format

Every webhook delivery sends a JSON payload:

`json
{
  "id": "stable-event-uuid",
  "event": "order.placed",
  "restaurant_id": "uuid",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "data": { ... event-specific data ... }
}
`

The id field is stable across retries - the same event always has the same id.

### Signature verification

Each request includes:
- X-Webhook-Signature: sha256={HMAC-SHA256 of timestamp.body}
- X-Webhook-Timestamp: ISO-8601 timestamp
- X-Webhook-Event: event type
- X-Webhook-ID: event id
- User-Agent: QROrder-Webhooks/1.0

Verify: HMAC-SHA256(secret, timestamp + "." + body) == signature

### Retry schedule

Failed deliveries are retried up to 5 times total:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

After 5 failed attempts, delivery status becomes dead.

### Auto-disable

An endpoint is automatically disabled (is_active = false) after 10 consecutive failures. The disabled_reason field records why. Re-enable via Manager -> Settings -> Webhooks.

### Security

- URLs must be HTTPS (private/loopback addresses blocked - SSRF protection)
- Secrets are shown only once on creation (never returned again)
- Rotate secrets via /api/webhooks/[id]/rotate-secret
- Payload size capped at 64 KB; large array fields truncated with _truncated: true notice
- Dispatch timeout: 8 seconds per attempt

### Managing webhooks

Manager -> Settings -> Webhooks tab:
- Create endpoint: name, HTTPS URL, select events
- View delivery history with HTTP status, response body, duration
- Send test event
- Retry failed deliveries manually
- Rotate secret

## Audit Log System

### Overview

Every significant action is recorded in audit_logs with actor, resource, severity, IP address, and arbitrary metadata. Logs are immutable - they cannot be updated or deleted except via the scheduled purge cron job.

### Severity levels

| Severity | Actions | Retention |
|----------|---------|-----------|
| critical | restaurant.activated, restaurant.deactivated, auth.password_changed, staff.deleted, coupon.created, coupon.deleted, billing.plan_changed, webhook.secret_rotated | 365 days |
| warning | staff.created, staff.deactivated, webhook.created, webhook.deleted, billing.subscription_activated, billing.subscription_expired, order.cancelled | 90 days |
| info | All other actions | 30 days |

Severity is derived automatically from the action string in lib/audit-log.ts - callers never supply it.

### Critical alerts

When a critical audit event is written, dispatchCriticalAlert() fires fire-and-forget:
1. Checks audit_notifications for deduplication (unique on audit_log_id)
2. Inserts a pending notification row
3. Broadcasts critical_alert event on critical-alerts:{restaurant_id} Realtime channel
4. Retries up to 3 times with 10-second intervals on failure
5. Marks notification delivered or failed

### Querying audit logs

GET /api/audit-logs supports:
- Filtering: from, to, actor_type, actor_id, action, resource_type, resource_id, severity
- Free-text search (q): searches actor_name, resource_name, metadata
- Keyset pagination: cursor parameter (encoded as {created_at}_{id})
- Page sizes: 25, 50, or 100 entries

Access control:
- Admin (Bearer ADMIN_SECRET): can query all restaurants or scope to one
- Manager (Bearer JWT): scoped to own restaurant only
- Staff (waiter/kitchen): 403 Forbidden
- Unauthorized access attempts are themselves logged as audit events

### Immutability

The audit_logs_immutability_guard trigger blocks all UPDATE and DELETE operations.
The only permitted deletion path is via the purge_expired_audit_logs() function which sets
SET LOCAL app.audit_purge_active = true before deleting.

### Exporting

POST /api/audit-logs/download exports filtered audit logs as a CSV file.

---

## Admin Panel

URL: /admin

Protected by a PIN verified server-side via POST /api/admin/verify-pin (ADMIN_SECRET env var).
The PIN value is never embedded in the browser bundle.
Requires SUPABASE_SERVICE_ROLE_KEY for full access (bypasses RLS to see inactive restaurants).

### Restaurants tab

- Stats: total restaurants, active count, pro subscribers, total orders
- Table: all restaurants with plan, subscription status, order count, created date
- Toggle active/inactive per restaurant (confirmation dialog)
- Change manager password per restaurant
- When deactivated: customer ordering pages show "closed" screen; staff dashboards become inaccessible

### Coupons tab

- Create coupons: code, type (% or flat), value, expiry, max uses, applicable plans, duration days
- List all coupons with usage count, status, expiry
- Edit, toggle active/inactive, delete

### Plans tab

- Create and manage subscription plans
- Set name, tagline, monthly/yearly price (in paise), features list, unavailable features
- Control CTA type: choose (self-serve), contact (sales), downgrade_unsupported
- Toggle highlighted (shows "Recommended" badge)
- Set sort order

### Audit Log tab

- Platform-wide audit log viewer
- Filter by restaurant, actor type, action, severity, date range
- Free-text search
- Keyset pagination

---

## Analytics

Manager -> Analytics tab. Powered by a single get_analytics_summary() RPC call.

### Metrics

| Metric | Description |
|--------|-------------|
| Total Revenue | Sum of total_amount for billed orders in period |
| Total Orders | Count of billed orders in period |
| Avg Order Value | Total Revenue / Total Orders |
| Avg Turnaround | Average time from order created to served (from order_status_logs) |

All KPIs show period-over-period % change vs the previous equivalent period.

### Charts

- Revenue bar chart: daily revenue for today / last 7 days / last 30 days. Hover for details
- Order status donut: breakdown of all orders by status in the period
- Top 6 selling items: quantity sold + revenue with progress bars
- Payment methods donut: cash / card / upi split
- Waiter stats table: orders handled + revenue generated per waiter
- Hourly traffic bar chart: 24-hour order distribution in IST timezone. Peak hour highlighted in orange

### Range selection

Toggle between Today, 7 Days, and 30 Days. Range changes are debounced 300ms to avoid rapid API calls.

---

## Feature Reference

### Geo-fencing

Manager -> Settings -> Geo-fencing. Set restaurant coordinates + radius (default 100m).
Customers outside the radius cannot add items to cart.
Uses browser Geolocation API with Haversine distance calculation.
Status: idle -> checking -> allowed/denied/error.
If coordinates not set but geo-fencing enabled: allows by default.

### Order routing modes

- direct_to_kitchen: new orders start as pending, immediately visible to kitchen
- waiter_first: new orders start as pending_waiter, waiter must accept before kitchen sees it

Switch routing mode in Manager -> Settings. Switching from waiter_first to direct_to_kitchen
calls migrate_pending_waiter_orders() to advance any stuck pending_waiter orders.

### Waiter assignment modes

- auto_assign: orders are automatically assigned to the least-busy active waiter (3-tier system)
- broadcast: orders are visible to all waiters until one accepts (pending_waiter status)

### Auto-confirm

Manager -> Settings -> Auto-confirm minutes. When set, pending orders older than N minutes
are automatically advanced to confirmed by the auto_confirm_pending_orders() function.

### Table sessions

A table session tracks which waiter is serving a table. Sessions open when a waiter accepts
or is assigned an order. Sessions close when all orders at the table are billed.
Only one open session per table at a time (unique index on (table_id, closed_at)).

### QR codes

Each table has a unique QR at /r/[restaurant_id]/t/[table_id].
Generate and print from Manager -> Tables tab.

### Floor pricing

Floors have a price_multiplier (default 1.0). Tables assigned to a floor inherit its multiplier.
Prices are calculated at order placement time via calculate_item_prices_batch().
Example: AC Hall at 1.0x, Rooftop at 1.2x, VIP at 1.5x.

### Staff management

Manager -> Staff tab:
- Create staff: POST /api/staff/create creates Supabase Auth user + users table row atomically
  (rolls back auth user if DB insert fails)
- Edit name, email, role
- Deactivate: sets is_active = false. Deactivated staff are signed out on next request
- Delete: removes auth user + users row

### Menu management

Manager -> Menu tab:
- Add/edit/delete items with name, price, description, image, categories, tags
- Toggle availability (real-time update to customer pages)
- Bulk upload via CSV
- Hierarchical food categories (parent/child)
- Custom food tags with colors
- Category and tag suggestions from global templates

### Customer order history

GET /history: customers enter their phone number to view past orders grouped by table sessions.
POST /api/customer/history: uses POST to avoid exposing phone numbers in URL query params.

### Notification sounds

Kitchen and waiter dashboards play audio notifications using the Web Audio API (no audio files needed):
- newOrder: double high-pitched beep + [200,100,200]ms vibration
- orderReady: ascending two-tone chime + [300,100,300,100,300]ms vibration
- orderUpdate: single soft blip + [100]ms vibration
- waiterCall: triple short beeps + [100,80,100,80,100]ms vibration

Mute state persisted to localStorage. AudioContext created lazily on first user interaction
to satisfy browser autoplay policies.

---

## Cron Jobs

Two cron jobs run on Vercel. Both are protected by CRON_SECRET (passed as Authorization: Bearer header).

### Audit log purge

- Endpoint: GET /api/cron/audit-log-purge
- Schedule: daily at 02:00 UTC
- Action: calls purge_expired_audit_logs() RPC which deletes:
  - critical logs older than 365 days
  - warning logs older than 90 days
  - info logs older than 30 days
- Writes an audit_log.purged audit entry with counts of deleted rows

### Webhook retries

- Endpoint: GET /api/cron/webhook-retries
- Schedule: every minute
- Action: finds webhook_deliveries with status=retrying and next_retry_at <= now
- Processes up to 50 due deliveries, 10 concurrently
- Calls retryDelivery() for each, which re-dispatches and updates delivery status
- On permanent failure (all 5 attempts exhausted): writes webhook.delivery_failed audit entry

To configure cron jobs on Vercel, add to vercel.json:

`json
{
  "crons": [
    { "path": "/api/cron/audit-log-purge", "schedule": "0 2 * * *" },
    { "path": "/api/cron/webhook-retries", "schedule": "* * * * *" }
  ]
}
`

---

## Deployment

### Vercel

`ash
npm i -g vercel
vercel --prod
`

Add all env vars in Vercel Dashboard -> Project -> Settings -> Environment Variables.
Mark SUPABASE_SERVICE_ROLE_KEY, PHONEPE_CLIENT_SECRET, ADMIN_SECRET as server-only (not exposed to browser).

### Next.js configuration (next.config.ts)

| Setting | Value | Effect |
|---------|-------|--------|
| images.formats | ["image/avif", "image/webp"] | Serves modern image formats - reduces image payload ~50% |
| images.remotePatterns | images.unsplash.com, *.supabase.co, *.supabase.in | Allows Next.js Image to optimise images from Unsplash and Supabase Storage |
| experimental.optimizePackageImports | lucide-react, @radix-ui/react-icons | Tree-shakes icon packages - only bundles icons that are actually imported |
| poweredByHeader | false | Removes the X-Powered-By: Next.js response header |
| allowedDevOrigins | 192.168.31.33 | Allows local-network device access to the dev server for mobile testing |

### Supabase project setup

1. Create project at supabase.com
2. Run supabase/COMPLETE_MIGRATION.sql in SQL Editor (sets up schema, RLS, functions, triggers)
3. Run supabase/migration_realtime_complete.sql for Realtime triggers
4. Enable Realtime for tables: orders, order_items, menu_items, users, subscriptions, restaurants, tables, floors
5. Run supabase/setup_auth_users.sql to link auth users to profiles
6. Set REPLICA IDENTITY FULL on realtime tables:
   ALTER TABLE orders REPLICA IDENTITY FULL;
   ALTER TABLE order_items REPLICA IDENTITY FULL;
   ALTER TABLE menu_items REPLICA IDENTITY FULL;

### PhonePe setup

1. Register at PhonePe Business Dashboard
2. Get Client ID, Client Secret, Webhook credentials
3. Set webhook endpoint: https://yourdomain.com/api/phonepe/webhook
4. Add credentials to environment variables
5. Set PHONEPE_ENV=production for live payments, sandbox for testing

---

## Troubleshooting

### Real-time not working

`sql
-- Check REPLICA IDENTITY FULL
SELECT relname, relreplident FROM pg_class
WHERE relname IN (''orders'', ''menu_items'', ''order_items'');
-- Should show ''f'' for all three

-- Check realtime publication
SELECT tablename FROM pg_publication_tables WHERE pubname = ''supabase_realtime'';
`

### Orders not appearing in kitchen/waiter

The broadcast fires on order_items INSERT to ensure items exist before the kitchen sees the order.
Check the on_order_item_insert trigger exists on order_items.

### Admin toggle not working

SUPABASE_SERVICE_ROLE_KEY is required - the anon key cannot update is_active due to RLS.

### Coupon not applying

- Check is_active = true and not expired in the coupons table
- Check applicable_plans includes the plan being purchased
- Check coupon_usages - the restaurant may have already used it
- Coupon errors appear in server logs at [phonepe/checkout]

### Customer info form showing on every order

Customer info is stored in sessionStorage keyed by tableId. Clears when all orders are billed.
Check billed_at is being set by bill_table() or generate_bill().

### Floor pricing not applying

Check the table has a floor_id set and the floor has price_multiplier != 1.0.

### Auth redirect loop

User has no profile in users table - complete the onboarding flow to create it.

### Waiter seeing wrong orders

Each waiter ID comes from useAuth() -> profile.id. If a waiter sees another waiter orders,
check their auth profile is correctly linked via auth_id in the users table.

### Webhook deliveries stuck in retrying

Check the cron job is configured in vercel.json and CRON_SECRET is set.
Manually trigger: GET /api/cron/webhook-retries with Authorization: Bearer {CRON_SECRET}.

### Admin PIN not working

ADMIN_SECRET env var must be set server-side. The PIN is verified via POST /api/admin/verify-pin
which compares against ADMIN_SECRET. NEXT_PUBLIC_ADMIN_PIN is only used for the UI input field.

### Subscription not updating after payment

PhonePe webhook must be configured to POST to https://yourdomain.com/api/phonepe/webhook.
Check PHONEPE_WEBHOOK_USERNAME and PHONEPE_WEBHOOK_PASSWORD match the PhonePe dashboard settings.
Check server logs at [phonepe/webhook] for validation errors.

### Audit logs not appearing

writeAuditLog() requires SUPABASE_SERVICE_ROLE_KEY. Check server logs for [audit-log] write failed.
Audit logs are written server-side only - client-side calls go through POST /api/audit.

