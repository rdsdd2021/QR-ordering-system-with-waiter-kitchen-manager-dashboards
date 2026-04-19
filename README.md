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
8. [SaaS & Subscriptions](#saas--subscriptions)
9. [Admin Panel](#admin-panel)
10. [Feature Reference](#feature-reference)
11. [Deployment](#deployment)
12. [Troubleshooting](#troubleshooting)

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
├── page.tsx                          # Landing page → /onboarding or /login
├── onboarding/                       # New restaurant signup (2-step)
├── login/                            # Staff login
├── admin/                            # Super-admin panel (/admin)
├── manager/[restaurant_id]/          # Manager dashboard
├── kitchen/[restaurant_id]/          # Kitchen display
├── waiter/[restaurant_id]/           # Waiter app
├── r/[restaurant_id]/t/[table_id]/   # Customer ordering page
├── unauthorized/                     # Access denied
└── api/
    ├── onboard/                      # POST: create restaurant + defaults
    ├── stripe/checkout/              # POST: create Stripe checkout session
    ├── stripe/webhook/               # POST: handle Stripe events
    └── admin/toggle-restaurant/      # POST: activate/deactivate restaurant

components/
├── manager/
│   ├── TableSessions.tsx             # Unified billing + order view (grouped by table)
│   ├── MenuManager.tsx               # CRUD menu items
│   ├── OrderLog.tsx                  # Full order history with timings
│   ├── Analytics.tsx                 # Sales + performance metrics
│   ├── TablesManager.tsx             # Table setup + QR codes
│   ├── FloorsManager.tsx             # Floor/section management
│   ├── StaffManager.tsx              # Waiter CRUD + availability
│   ├── SettingsPanel.tsx             # Routing mode + geo-fencing + subscription
│   └── UpgradeBanner.tsx             # Free → Pro upgrade CTA
├── kitchen/
│   ├── OrderCard.tsx
│   └── OrderItemList.tsx
├── waiter/
│   └── WaiterOrderCard.tsx
├── CartDrawer.tsx                    # Cart + customer info form
├── OrderStatusTracker.tsx            # Customer-facing live order status
├── MenuItemCard.tsx
└── ProtectedRoute.tsx

hooks/
├── useAuth.ts                        # Auth state + profile loading
├── useCart.ts                        # Cart state
├── useCustomerSession.ts             # Customer info persistence + active orders
├── useKitchenOrders.ts               # Kitchen real-time orders
├── useWaiterOrders.ts                # Waiter real-time orders
├── useManagerRealtime.ts             # Manager dashboard real-time
├── useRealtimeMenu.ts                # Menu change subscriptions
├── useRealtimeOrderStatus.ts         # Customer order status
├── useGeofence.ts                    # Location-based ordering restriction
└── useSubscription.ts                # Plan + limits + Stripe upgrade

lib/
├── supabase.ts                       # Singleton Supabase client
├── api.ts                            # All data-fetching functions
├── stripe.ts                         # Server-side Stripe client
└── utils.ts
```

---

## Routes

| URL | Who | Description |
|-----|-----|-------------|
| `/` | Public | Landing page |
| `/onboarding` | New owners | Create account + restaurant |
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
| `users` | `id`, `restaurant_id`, `auth_id`, `name`, `role`, `email`, `is_active`, `is_super_admin` |
| `orders` | `id`, `restaurant_id`, `table_id`, `waiter_id`, `status`, `customer_name`, `customer_phone`, `party_size`, `total_amount`, `billed_at`, `confirmed_at`, `preparing_at`, `ready_at`, `served_at` |
| `order_items` | `id`, `order_id`, `menu_item_id`, `quantity`, `price` |
| `order_status_logs` | `id`, `order_id`, `old_status`, `new_status`, `changed_by`, `created_at` |
| `subscriptions` | `id`, `restaurant_id`, `plan`, `status`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_end` |

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
| `generate_bill(order_id)` | Calculates total, sets `billed_at` |
| `calculate_item_price(menu_item_id, table_id)` | Applies floor `price_multiplier` to base price |
| `get_restaurant_plan(restaurant_id)` | Returns `'free'` or `'pro'` |
| `get_plan_limits(plan)` | Returns JSON `{max_tables, max_menu_items, analytics, advanced_features}` |
| `validate_order_status_transition()` | Trigger: enforces state machine |
| `update_order_timestamps()` | Trigger: sets `confirmed_at`, `preparing_at`, etc. |
| `broadcast_order_changes()` | Trigger: sends real-time events to all channels |
| `broadcast_order_on_items_insert()` | Trigger: broadcasts INSERT after items are committed (avoids empty items bug) |
| `auto_assign_table_waiter()` | Trigger: auto-assigns active table waiter to new orders |
| `create_default_subscription()` | Trigger: creates free subscription on restaurant insert |

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

### Auto-waiter assignment
When a new order is placed at a table that already has an active waiter (unbilled order with `waiter_id`), the new order is automatically assigned to that same waiter via the `auto_assign_table_waiter` BEFORE INSERT trigger.

### Floor pricing
`calculate_item_price()` multiplies the base menu item price by the floor's `price_multiplier`. Called during order placement. Example: Rooftop floor with `1.2x` multiplier → ₹100 item becomes ₹120.

---

## Real-time System

### Channels

| Channel | Subscribers | Events |
|---------|-------------|--------|
| `kitchen:{restaurant_id}` | Kitchen dashboard | `order_changed` |
| `waiter:{restaurant_id}` | Waiter dashboard | `order_changed` |
| `manager:{restaurant_id}` | Manager dashboard | `order_changed`, `menu_changed` |
| `customer:{restaurant_id}:{table_id}` | Customer page | `order_changed` |

### Broadcast payload (order_changed)

```json
{
  "event": "INSERT | UPDATE | DELETE",
  "id": "order-uuid",
  "restaurant_id": "...",
  "table_id": "...",
  "status": "confirmed",
  "waiter_id": "...",
  "total_amount": 299.00,
  "created_at": "..."
}
```

### How it works

1. Customer places order → `orders` INSERT
2. `broadcast_order_on_items_insert` trigger fires after first `order_items` row (ensures items exist)
3. Broadcasts INSERT to `kitchen:`, `waiter:`, `manager:` channels
4. Kitchen/waiter hooks receive event → fetch full order with joins → add to state
5. Status updates → `broadcast_order_changes` trigger fires → broadcasts UPDATE
6. All dashboards patch the row in-place (no full reload)

### Replica identity
`orders`, `menu_items`, `order_items` all have `REPLICA IDENTITY FULL` — required for `postgres_changes` column filters to work.

### Supabase free tier limits
- 500 concurrent connections
- 100 messages/second per channel
- Max message size: 256KB

---

## SaaS & Subscriptions

### Plans

| Feature | Free | Pro |
|---------|------|-----|
| Tables | 5 | Unlimited |
| Menu items | 20 | Unlimited |
| Analytics | ❌ | ✅ |
| Advanced features | ❌ | ✅ |

### Onboarding flow
1. `/onboarding` → user creates account (email/password)
2. Names their restaurant
3. `POST /api/onboard` calls `onboard_restaurant()` DB function
4. Creates: restaurant + Main Floor + 5 tables + manager profile + free subscription
5. Redirects to `/manager/[restaurant_id]`

### Stripe setup
1. Create product "QR Order Pro" in Stripe Dashboard
2. Add monthly price → copy Price ID → set `STRIPE_PRO_PRICE_ID`
3. Add webhook endpoint: `https://yourdomain.com/api/stripe/webhook`
4. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
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

Protected by `NEXT_PUBLIC_ADMIN_PIN` (default: `admin123` — **change this**).

**Requires `SUPABASE_SERVICE_ROLE_KEY`** to see inactive restaurants and toggle them. Without it, a yellow warning banner appears and the toggle may fail.

Features:
- Stats: total restaurants, active count, pro subscribers, total orders
- Table: all restaurants with plan, subscription status, order count, created date
- Toggle active/inactive per restaurant (with confirmation dialog)
- Search by name or ID
- Lock button to re-show PIN screen

When a restaurant is deactivated (`is_active = false`):
- Hidden from all RLS SELECT policies
- Customer ordering pages return 404
- Staff dashboards become inaccessible

---

## Feature Reference

### Geo-fencing
Configure in Manager → Settings → Geo-fencing section.

- Toggle on/off per restaurant
- Set coordinates manually or click "Use my location"
- Set radius in metres (recommended: 50–200m for indoor dining)
- When enabled: customers outside the radius see an error and cannot add to cart

### Order routing modes
- **Direct to kitchen**: orders go straight to kitchen (`status = 'pending'`)
- **Waiter first**: waiter must accept before kitchen sees it (`status = 'pending_waiter'`)

Configure in Manager → Settings → Order Routing.

### Table sessions (billing)
Manager → Tables tab groups all unbilled orders from the same table into one session card.

- Shows customer name, phone, guest count, waiter, running total
- "Bill (N)" button bills all served orders for that table at once
- Past sessions (billed) collapsed by default

### QR codes
Each table has a unique QR code at `/r/[restaurant_id]/t/[table_id]`.

Generate/print from Manager → Table Setup → click QR icon on any table card.

---

## Deployment

### Vercel

```bash
npm i -g vercel
vercel --prod
```

Add all env vars in Vercel Dashboard → Project → Settings → Environment Variables.

Mark `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` as **server-only** (not exposed to browser).

### Supabase project setup
1. Create project at [supabase.com](https://supabase.com)
2. Run the migration files in `supabase/` via SQL Editor (in order)
3. Enable Realtime for tables: `orders`, `order_items`, `menu_items`, `users`, `subscriptions`
4. Create auth users for demo staff (Dashboard → Authentication → Users)
5. Run `supabase/setup_auth_users.sql` to link auth users to profiles

---

## Troubleshooting

### Real-time not working
1. Check `REPLICA IDENTITY FULL` is set:
   ```sql
   SELECT relname, relreplident FROM pg_class
   WHERE relname IN ('orders', 'menu_items', 'order_items');
   -- Should show 'f' (full) for all three
   ```
2. Check tables are in the realtime publication:
   ```sql
   SELECT tablename FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime';
   ```
3. Check triggers exist:
   ```sql
   SELECT tgname, tgrelid::regclass FROM pg_trigger
   WHERE tgname IN ('orders_broadcast_trigger', 'on_order_item_insert', 'auto_assign_table_waiter_trigger');
   ```

### Orders showing no items in waiter/kitchen
The broadcast fires on `order_items` INSERT (not `orders` INSERT) to ensure items exist when clients fetch. If items are missing, check the `on_order_item_insert` trigger exists on `order_items`.

### Waiter not seeing new orders
The `waiter:` channel was historically missing from the broadcast function. Verify `broadcast_order_changes()` sends to all four channels: `kitchen:`, `waiter:`, `manager:`, `customer:`.

### Admin toggle not working
`SUPABASE_SERVICE_ROLE_KEY` is required. The anon key cannot update `is_active` due to RLS. Get it from Supabase Dashboard → Settings → API → `service_role`.

### Customer info form showing on every order
Customer info is stored in `sessionStorage` keyed by `tableId`. It clears when all orders at the table are billed. If it keeps showing, check `billed_at` is being set correctly by `generate_bill()`.

### Floor pricing not applying
`calculate_item_price(menu_item_id, table_id)` must be called during order placement. Check the table has a `floor_id` set and the floor has a `price_multiplier` != 1.0.

### Auth redirect loop
If a user has no profile in the `users` table (new signup without completing onboarding), `redirectToDashboard()` sends them to `/onboarding`. Complete the onboarding flow to create the profile.
