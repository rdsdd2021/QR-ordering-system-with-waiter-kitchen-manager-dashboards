# QR Order — Restaurant Management SaaS

QR-based ordering platform. Customers scan a table QR code, browse the menu, and place orders. Staff manage everything in real time across kitchen, waiter, and manager dashboards.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Environment Variables](#environment-variables)
3. [Project Structure](#project-structure)
4. [Routes](#routes)
5. [Database Schema](#database-schema)
6. [Order Flow](#order-flow)
7. [Real-time System](#real-time-system)
8. [Coupon System](#coupon-system)
9. [SaaS & Subscriptions](#saas--subscriptions)
10. [Admin Panel](#admin-panel)
11. [Feature Reference](#feature-reference)
12. [Deployment](#deployment)
13. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Demo credentials (staff login at `/login`):**
```
Manager:  manager@demo.com  / password123
Waiter:   waiter@demo.com   / password123
Kitchen:  kitchen@demo.com  / password123
```

**Demo customer ordering:**
```
http://localhost:3000/r/11111111-1111-1111-1111-111111111111/t/22222222-2222-2222-2222-222222222222
```

---

## Environment Variables

Create `.env.local` in the project root:

```env
# Supabase (from Dashboard → Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# Service role key — server-side only, NEVER expose to client
# Required for: admin panel, onboarding API, Stripe webhook
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Stripe (from https://dashboard.stripe.com/apikeys)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...

# Admin panel PIN (change this!)
NEXT_PUBLIC_ADMIN_PIN=change_me
```

---

## Project Structure

```
app/
├── page.tsx                          # Landing page with pricing
├── onboarding/                       # New restaurant signup (3-step: account → restaurant → plan)
├── login/                            # Staff login
├── admin/                            # Super-admin panel (/admin)
├── manager/[restaurant_id]/          # Manager dashboard
├── kitchen/[restaurant_id]/          # Kitchen display
├── waiter/[restaurant_id]/           # Waiter app
├── r/[restaurant_id]/t/[table_id]/   # Customer ordering page
├── unauthorized/                     # Access denied
└── api/
    ├── onboard/                      # POST: create restaurant + defaults
    ├── coupons/validate/             # POST: validate a coupon code
    ├── stripe/checkout/              # POST: create Stripe checkout session (with coupon + 7-day trial)
    ├── stripe/webhook/               # POST: handle Stripe events + record coupon usage
    └── admin/
        ├── toggle-restaurant/        # POST: activate/deactivate restaurant
        └── coupons/                  # GET/POST: list/create coupons
            └── [id]/                 # PATCH/DELETE: edit/delete coupon

components/
├── manager/
│   ├── TableSessions.tsx
│   ├── MenuManager.tsx
│   ├── OrderLog.tsx
│   ├── Analytics.tsx
│   ├── TablesManager.tsx
│   ├── FloorsManager.tsx
│   ├── StaffManager.tsx
│   ├── SettingsPanel.tsx             # Routing mode + geo-fencing
│   └── UpgradeBanner.tsx             # Upgrade CTA with coupon input
├── admin/
│   └── CouponManager.tsx             # Full coupon CRUD UI
├── kitchen/
│   ├── OrderCard.tsx
│   └── OrderItemList.tsx
├── waiter/
│   └── WaiterOrderCard.tsx
├── PricingSection.tsx                # Homepage single-plan pricing card
├── CouponInput.tsx                   # Reusable coupon code input component
├── CartDrawer.tsx
├── OrderStatusTracker.tsx
├── MenuItemCard.tsx
└── ProtectedRoute.tsx

hooks/
├── useAuth.ts
├── useCart.ts
├── useCustomerSession.ts
├── useKitchenOrders.ts
├── useWaiterOrders.ts
├── useManagerRealtime.ts
├── useRealtimeMenu.ts
├── useRealtimeOrderStatus.ts
├── useGeofence.ts
└── useSubscription.ts                # Plan + limits + Stripe upgrade (accepts coupon code)

lib/
├── supabase.ts
├── api.ts
├── stripe.ts                         # STRIPE_PLANS with price + trialDays
└── utils.ts
```

---

## Routes

| URL | Who | Description |
|-----|-----|-------------|
| `/` | Public | Landing page with pricing |
| `/onboarding` | New owners | Create account + restaurant + choose plan |
| `/login` | Staff | Email/password login |
| `/admin` | Super admin | Platform management (PIN-gated) |
| `/manager/[id]` | Manager | Full dashboard |
| `/kitchen/[id]` | Kitchen staff | Order queue |
| `/waiter/[id]` | Waiters | Order assignment + serving |
| `/r/[id]/t/[table_id]` | Customers | Menu + ordering |
| `/unauthorized` | — | Access denied |

---

## Database Schema

### Core tables

| Table | Key columns |
|-------|-------------|
| `restaurants` | `id`, `name`, `owner_id`, `order_routing_mode`, `is_active`, `geofencing_enabled`, `geo_latitude`, `geo_longitude`, `geo_radius_meters` |
| `floors` | `id`, `restaurant_id`, `name`, `price_multiplier` |
| `tables` | `id`, `restaurant_id`, `floor_id`, `table_number`, `capacity`, `qr_code_url` |
| `menu_items` | `id`, `restaurant_id`, `name`, `price`, `is_available`, `image_url`, `tags`, `description` |
| `users` | `id`, `restaurant_id`, `auth_id`, `name`, `role`, `email`, `is_active` |
| `orders` | `id`, `restaurant_id`, `table_id`, `waiter_id`, `status`, `total_amount`, `billed_at`, `confirmed_at`, `preparing_at`, `ready_at`, `served_at` |
| `order_items` | `id`, `order_id`, `menu_item_id`, `quantity`, `price` |
| `order_status_logs` | `id`, `order_id`, `old_status`, `new_status`, `changed_by`, `created_at` |
| `subscriptions` | `id`, `restaurant_id`, `plan`, `status`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_end` |
| `coupons` | `id`, `code`, `type`, `value`, `max_uses`, `used_count`, `expires_at`, `is_active`, `applicable_plans`, `stripe_coupon_id` |
| `coupon_usages` | `id`, `coupon_id`, `restaurant_id`, `used_at` |

### Order status machine

```
pending ──────────────────────────────────────────► confirmed
pending_waiter ──(waiter accepts)──────────────────► confirmed
confirmed ─────────────────────────────────────────► preparing
preparing ─────────────────────────────────────────► ready
ready ─────────────────────────────────────────────► served
served ────────────────────────────────────────────► (billed)
```

- `direct_to_kitchen` routing: new orders start as `pending`
- `waiter_first` routing: new orders start as `pending_waiter`

### Key DB functions

| Function | Purpose |
|----------|---------|
| `onboard_restaurant(auth_id, name, email, owner_name)` | Creates restaurant + floor + 5 tables + manager user in one transaction |
| `validate_coupon(code, plan, restaurant_id)` | Validates coupon — checks active, expiry, usage limit, plan match, per-restaurant reuse |
| `record_coupon_usage(coupon_id, restaurant_id)` | Atomically increments used_count (advisory lock, idempotent) |
| `generate_bill(order_id)` | Calculates total, sets `billed_at` |
| `calculate_item_price(menu_item_id, table_id)` | Applies floor `price_multiplier` to base price |
| `validate_order_status_transition()` | Trigger: enforces state machine |
| `update_order_timestamps()` | Trigger: sets `confirmed_at`, `preparing_at`, etc. |
| `broadcast_order_changes()` | Trigger: sends real-time events to all channels |

---

## Order Flow

### Customer flow
1. Scan QR → `/r/[restaurant_id]/t/[table_id]`
2. Browse menu (real-time availability updates)
3. Add to cart → "Place order"
4. **First order:** enter name, phone, optional guest count
5. **Subsequent orders (same session):** skips form, places immediately
6. Track order status live in "My Orders" tab
7. Session clears when all orders at the table are billed

### Billing safety
When a table has unpaid orders, new customers scanning the same QR code are blocked from placing additional orders. `placeOrder()` returns `'UNPAID_ORDERS_EXIST'` and the cart drawer shows a clear error message.

### Auto-waiter assignment
When a new order is placed at a table that already has an active waiter, the new order is automatically assigned to that same waiter via the `auto_assign_table_waiter` BEFORE INSERT trigger.

### Floor pricing
`calculate_item_price()` multiplies the base menu item price by the floor's `price_multiplier`. Example: Rooftop floor with `1.2x` → ₹100 item becomes ₹120.

### Waiter authentication
Each waiter sees only their own orders. The waiter ID comes from `useAuth()` → `profile.id` (the authenticated user's DB profile), not a hardcoded value.

### Order assignment (race condition safe)
Order assignment uses atomic RPC calls (`assign_order_to_waiter`, `accept_order_atomic`) with table session locking to prevent two waiters from claiming the same order simultaneously.

---

## Real-time System

### Channels

| Channel | Subscribers | Events |
|---------|-------------|--------|
| `kitchen:{restaurant_id}` | Kitchen dashboard | `order_changed` |
| `waiter:{restaurant_id}` | Waiter dashboard | `order_changed` |
| `manager:{restaurant_id}` | Manager dashboard | `order_changed`, `menu_changed` |
| `customer:{restaurant_id}:{table_id}` | Customer page | `order_changed` |

### How it works

1. Customer places order → `orders` INSERT
2. `broadcast_order_on_items_insert` trigger fires after first `order_items` row
3. Broadcasts INSERT to `kitchen:`, `waiter:`, `manager:` channels
4. Status updates → `broadcast_order_changes` trigger → broadcasts UPDATE to all dashboards

---

## Coupon System

### Overview
Flexible discount system with percentage or flat discounts, expiry, usage limits, plan targeting, and Stripe integration.

### DB tables
- `coupons` — stores all coupon definitions
- `coupon_usages` — tracks which restaurant used which coupon (unique constraint prevents reuse)

### Coupon fields
| Field | Description |
|-------|-------------|
| `code` | Uppercase unique code (e.g. `LAUNCH20`) |
| `type` | `percentage` or `flat` |
| `value` | Percentage (0–100) or flat amount in rupees |
| `max_uses` | NULL = unlimited |
| `expires_at` | NULL = never expires |
| `applicable_plans` | Array e.g. `['pro']` |
| `stripe_coupon_id` | Cached Stripe coupon ID |

### Validation rules (server-side only)
1. Code exists
2. `is_active = true`
3. Not expired
4. `used_count < max_uses` (if set)
5. Plan is in `applicable_plans`
6. Restaurant hasn't used it before

### Stripe integration
On checkout, the backend:
1. Validates the coupon via `validate_coupon()`
2. Creates or retrieves a Stripe coupon (cached in `stripe_coupon_id`)
3. Applies it to the checkout session via `discounts: [{ coupon: stripeCouponId }]`
4. On `checkout.session.completed` webhook → calls `record_coupon_usage()` atomically

### Admin management
`/admin` → Coupons tab → full CRUD: create, edit, toggle active, delete.

### Frontend
- Homepage pricing card: no coupon input (no restaurantId yet)
- Onboarding step 3 (Plan): coupon input with live price update
- Manager Settings → Subscription: coupon input in UpgradeBanner

---

## SaaS & Subscriptions

### Pricing
- **Pro Plan**: ₹799/month
- **Trial**: 7-day free trial on all new subscriptions (no credit card required)

### Onboarding flow
1. `/onboarding` step 1 → create account (email/password)
2. Step 2 → name restaurant → `POST /api/onboard`
3. Step 3 → choose plan (apply coupon, upgrade to Pro or skip to Starter)
4. Creates: restaurant + Main Floor + 5 tables + manager profile + subscription row

### Stripe setup
1. Create product "QR Order Pro" in Stripe Dashboard
2. Add monthly price (₹799) → copy Price ID → set `STRIPE_PRO_PRICE_ID`
3. Add webhook endpoint: `https://yourdomain.com/api/stripe/webhook`
4. Events to enable: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
5. Copy signing secret → set `STRIPE_WEBHOOK_SECRET`

**Local testing:**
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

### Enforcing plan limits
```tsx
const { limits } = useSubscription(restaurantId);
if (tables.length >= limits.max_tables) {
  // show <UpgradeBanner restaurantId={restaurantId} />
}
```

---

## Admin Panel

URL: `/admin`

Protected by `NEXT_PUBLIC_ADMIN_PIN`. Requires `SUPABASE_SERVICE_ROLE_KEY` for full access.

### Restaurants tab
- Stats: total restaurants, active count, pro subscribers, total orders
- Table: all restaurants with plan, subscription status, order count
- Toggle active/inactive per restaurant

### Coupons tab
- Create coupons: code, type (% or flat), value, expiry, max uses, applicable plans
- List all coupons with usage count, status, expiry
- Edit, toggle active/inactive, delete

When a restaurant is deactivated (`is_active = false`), customer ordering pages return 404 and staff dashboards become inaccessible.

---

## Feature Reference

### Geo-fencing
Manager → Settings → Geo-fencing. Set coordinates + radius. Customers outside the radius cannot add to cart.

### Order routing modes
- **Direct to kitchen**: `status = 'pending'`
- **Waiter first**: `status = 'pending_waiter'` — waiter must accept before kitchen sees it

### Table sessions (billing)
Manager → Tables tab groups all unbilled orders per table. "Bill (N)" bills all served orders at once. Pass `force=true` to auto-advance non-served orders before billing. Session closes when all non-cancelled orders are billed.

### QR codes
Each table has a unique QR at `/r/[restaurant_id]/t/[table_id]`. Generate/print from Manager → Table Setup.

---

## Deployment

### Vercel

```bash
npm i -g vercel
vercel --prod
```

Add all env vars in Vercel Dashboard → Project → Settings → Environment Variables. Mark `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` as server-only.

### Next.js configuration (`next.config.ts`)

Key settings applied:

| Setting | Value | Effect |
|---------|-------|--------|
| `images.formats` | `["image/avif", "image/webp"]` | Serves modern image formats — reduces image payload ~50% |
| `images.remotePatterns` | `images.unsplash.com`, `*.supabase.co`, `*.supabase.in` | Allows Next.js `<Image>` to optimise images from Unsplash (placeholders) and Supabase Storage (menu item uploads / restaurant logos) |
| `experimental.optimizePackageImports` | `lucide-react`, `@radix-ui/react-icons` | Tree-shakes icon packages — only bundles icons that are actually imported |
| `poweredByHeader` | `false` | Removes the `X-Powered-By: Next.js` response header |
| `allowedDevOrigins` | `192.168.31.33` | Allows local-network device access to the dev server for mobile testing |

If you add new image sources (e.g. a CDN or a different Supabase project), add them to `remotePatterns` in `next.config.ts`.

### Supabase project setup
1. Create project at [supabase.com](https://supabase.com)
2. Run migration files in `supabase/` via SQL Editor (in order)
3. Enable Realtime for: `orders`, `order_items`, `menu_items`, `users`, `subscriptions`
4. Run `supabase/setup_auth_users.sql` to link auth users to profiles

---

## Troubleshooting

### Real-time not working
```sql
-- Check REPLICA IDENTITY FULL
SELECT relname, relreplident FROM pg_class
WHERE relname IN ('orders', 'menu_items', 'order_items');
-- Should show 'f' for all three

-- Check realtime publication
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

### Orders showing no items in waiter/kitchen
The broadcast fires on `order_items` INSERT to ensure items exist. Check the `on_order_item_insert` trigger exists on `order_items`.

### Admin toggle not working
`SUPABASE_SERVICE_ROLE_KEY` is required — the anon key cannot update `is_active` due to RLS.

### Coupon not applying
- Check `is_active = true` and not expired in the `coupons` table
- Check `applicable_plans` includes the plan being purchased
- Check `coupon_usages` — the restaurant may have already used it
- Stripe coupon errors appear in server logs at `[stripe/checkout]`

### Customer info form showing on every order
Customer info is stored in `sessionStorage` keyed by `tableId`. Clears when all orders are billed. Check `billed_at` is being set by `generate_bill()`.

### Floor pricing not applying
Check the table has a `floor_id` set and the floor has `price_multiplier != 1.0`.

### Auth redirect loop
User has no profile in `users` table — complete the onboarding flow to create it.

### Waiter seeing wrong orders
Each waiter's ID comes from `useAuth()` → `profile.id`. If a waiter sees another's orders, check their auth profile is correctly linked via `auth_id` in the `users` table.
