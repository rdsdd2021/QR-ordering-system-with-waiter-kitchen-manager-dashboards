-- =============================================================================
-- SEGMENT 1: Extensions, Types, and Core Tables
-- =============================================================================

-- Extensions (only the ones we explicitly use beyond Supabase defaults)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- ENUM TYPES
-- -----------------------------------------------------------------------------

CREATE TYPE public.discount_type AS ENUM ('percentage', 'flat');

-- -----------------------------------------------------------------------------
-- TABLE: restaurants
-- -----------------------------------------------------------------------------

CREATE TABLE public.restaurants (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text        NOT NULL,
  order_routing_mode   text        NOT NULL DEFAULT 'direct_to_kitchen'
                         CHECK (order_routing_mode = ANY (ARRAY['direct_to_kitchen', 'waiter_first'])),
  geofencing_enabled   boolean     NOT NULL DEFAULT false,
  geo_latitude         numeric,
  geo_longitude        numeric,
  geo_radius_meters    integer     NOT NULL DEFAULT 100,
  owner_id             uuid        REFERENCES auth.users(id),
  is_active            boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  slug                 text        UNIQUE,
  logo_url             text,
  auto_confirm_minutes integer
);

COMMENT ON TABLE  public.restaurants                    IS 'Registered restaurants using the QR ordering system.';
COMMENT ON COLUMN public.restaurants.order_routing_mode IS 'Controls order routing: direct_to_kitchen (orders go straight to kitchen) or waiter_first (waiter must accept before kitchen sees it)';
COMMENT ON COLUMN public.restaurants.geofencing_enabled IS 'When true, customers must be within geo_radius_meters to place orders';
COMMENT ON COLUMN public.restaurants.geo_latitude       IS 'Restaurant latitude for geo-fencing';
COMMENT ON COLUMN public.restaurants.geo_longitude      IS 'Restaurant longitude for geo-fencing';
COMMENT ON COLUMN public.restaurants.geo_radius_meters  IS 'Allowed radius in meters around the restaurant (default 100m)';
COMMENT ON COLUMN public.restaurants.owner_id           IS 'auth.users id of the restaurant owner';
COMMENT ON COLUMN public.restaurants.is_active          IS 'Super-admin can deactivate a restaurant';
COMMENT ON COLUMN public.restaurants.slug               IS 'Optional URL-friendly identifier';

-- -----------------------------------------------------------------------------
-- TABLE: users
-- -----------------------------------------------------------------------------

CREATE TABLE public.users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  role           text        NOT NULL CHECK (role = ANY (ARRAY['waiter', 'manager', 'kitchen'])),
  restaurant_id  uuid        NOT NULL REFERENCES public.restaurants(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  auth_id        uuid        REFERENCES auth.users(id),
  email          text,
  is_active      boolean     NOT NULL DEFAULT true,
  is_super_admin boolean     NOT NULL DEFAULT false
);

COMMENT ON TABLE  public.users                IS 'System users with role-based access to restaurant operations.';
COMMENT ON COLUMN public.users.is_active      IS 'Whether user is active (can take orders, login, etc.)';
COMMENT ON COLUMN public.users.is_super_admin IS 'Platform-level admin, not restaurant-scoped';

-- -----------------------------------------------------------------------------
-- TABLE: floors
-- -----------------------------------------------------------------------------

CREATE TABLE public.floors (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid        NOT NULL REFERENCES public.restaurants(id),
  name             text        NOT NULL,
  price_multiplier numeric     NOT NULL DEFAULT 1.0 CHECK (price_multiplier > 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.floors                  IS 'Restaurant floors/sections with different pricing (e.g., AC Hall, Rooftop)';
COMMENT ON COLUMN public.floors.price_multiplier IS 'Price multiplier for this floor (e.g., 1.0 = normal, 1.2 = 20% premium)';

-- -----------------------------------------------------------------------------
-- TABLE: tables
-- -----------------------------------------------------------------------------

CREATE TABLE public.tables (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid    NOT NULL REFERENCES public.restaurants(id),
  table_number  integer NOT NULL,
  floor_id      uuid    REFERENCES public.floors(id),
  capacity      integer DEFAULT 4 CHECK (capacity > 0),
  qr_code_url   text,
  UNIQUE (restaurant_id, table_number)
);

COMMENT ON TABLE  public.tables             IS 'Physical tables inside a restaurant, each with a unique table number.';
COMMENT ON COLUMN public.tables.floor_id    IS 'Floor/section this table belongs to';
COMMENT ON COLUMN public.tables.capacity    IS 'Seating capacity';
COMMENT ON COLUMN public.tables.qr_code_url IS 'URL to QR code image';

-- -----------------------------------------------------------------------------
-- TABLE: menu_items
-- -----------------------------------------------------------------------------

CREATE TABLE public.menu_items (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid    NOT NULL REFERENCES public.restaurants(id),
  name          text    NOT NULL,
  price         numeric NOT NULL CHECK (price >= 0),
  is_available  boolean NOT NULL DEFAULT true,
  image_url     text,
  tags          text[]  DEFAULT '{}',
  description   text
);

COMMENT ON TABLE  public.menu_items           IS 'Menu items offered by a restaurant. Only items with is_available = true are shown to customers.';
COMMENT ON COLUMN public.menu_items.image_url IS 'URL to menu item image (Supabase Storage)';
COMMENT ON COLUMN public.menu_items.tags      IS 'Tags like veg, non_veg, spicy, bestseller, etc.';
COMMENT ON COLUMN public.menu_items.description IS 'Item description';

-- -----------------------------------------------------------------------------
-- TABLE: orders
-- -----------------------------------------------------------------------------

CREATE TABLE public.orders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid        NOT NULL REFERENCES public.restaurants(id),
  table_id        uuid        NOT NULL REFERENCES public.tables(id),
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status = ANY (ARRAY['pending','pending_waiter','confirmed','preparing','ready','served'])),
  created_at      timestamptz NOT NULL DEFAULT now(),
  waiter_id       uuid        REFERENCES public.users(id),
  total_amount    numeric     DEFAULT 0 CHECK (total_amount >= 0),
  billed_at       timestamptz,
  confirmed_at    timestamptz,
  preparing_at    timestamptz,
  ready_at        timestamptz,
  served_at       timestamptz,
  customer_name   text,
  customer_phone  text,
  party_size      integer,
  payment_method  text        CHECK (payment_method IS NULL OR payment_method = ANY (ARRAY['cash','card','upi'])),
  discount_amount numeric     DEFAULT 0 CHECK (discount_amount >= 0),
  discount_note   text
);

COMMENT ON TABLE  public.orders                IS 'Customer orders placed via QR code. Status starts as pending.';
COMMENT ON COLUMN public.orders.status         IS 'Order status: pending (direct routing), pending_waiter (awaiting waiter), confirmed, preparing, ready, served';
COMMENT ON COLUMN public.orders.waiter_id      IS 'Waiter assigned to handle this order. Null means unassigned.';
COMMENT ON COLUMN public.orders.total_amount   IS 'Total order amount calculated from order_items (quantity * price). Updated when bill is generated.';
COMMENT ON COLUMN public.orders.billed_at      IS 'Timestamp when bill was generated. NULL means not yet billed.';
COMMENT ON COLUMN public.orders.confirmed_at   IS 'When order was confirmed by kitchen';
COMMENT ON COLUMN public.orders.preparing_at   IS 'When kitchen started preparing';
COMMENT ON COLUMN public.orders.ready_at       IS 'When order was marked ready';
COMMENT ON COLUMN public.orders.served_at      IS 'When order was served to customer';
COMMENT ON COLUMN public.orders.customer_name  IS 'Customer name collected at order placement';
COMMENT ON COLUMN public.orders.customer_phone IS 'Customer phone number collected at order placement';
COMMENT ON COLUMN public.orders.party_size     IS 'Number of people at the table';
COMMENT ON COLUMN public.orders.payment_method IS 'How the bill was paid: cash, card, or upi';
COMMENT ON COLUMN public.orders.discount_amount IS 'Manual discount applied at billing time';
COMMENT ON COLUMN public.orders.discount_note  IS 'Reason for discount (e.g. loyalty, manager override)';

-- -----------------------------------------------------------------------------
-- TABLE: order_items
-- -----------------------------------------------------------------------------

CREATE TABLE public.order_items (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid    NOT NULL REFERENCES public.orders(id),
  menu_item_id uuid    NOT NULL REFERENCES public.menu_items(id),
  quantity     integer NOT NULL CHECK (quantity > 0),
  price        numeric NOT NULL CHECK (price >= 0)
);

COMMENT ON TABLE public.order_items IS 'Individual line items within an order. Price is stored at time of order to preserve history.';

-- -----------------------------------------------------------------------------
-- TABLE: order_status_logs
-- -----------------------------------------------------------------------------

CREATE TABLE public.order_status_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid        NOT NULL REFERENCES public.orders(id),
  old_status text,
  new_status text        NOT NULL,
  changed_by uuid        REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.order_status_logs IS 'Audit trail of all order status changes with user attribution.';

-- -----------------------------------------------------------------------------
-- TABLE: table_sessions
-- -----------------------------------------------------------------------------

CREATE TABLE public.table_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id),
  table_id      uuid        NOT NULL REFERENCES public.tables(id),
  waiter_id     uuid        NOT NULL REFERENCES public.users(id),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  UNIQUE (table_id, closed_at)
);

-- -----------------------------------------------------------------------------
-- TABLE: reviews
-- -----------------------------------------------------------------------------

CREATE TABLE public.reviews (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid        NOT NULL REFERENCES public.menu_items(id),
  rating       integer     NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reviews IS 'Customer reviews for menu items';

-- -----------------------------------------------------------------------------
-- TABLE: food_categories
-- -----------------------------------------------------------------------------

CREATE TABLE public.food_categories (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id),
  parent_id     uuid        REFERENCES public.food_categories(id),
  name          text        NOT NULL,
  description   text,
  image_url     text,
  color         text,
  sort_order    integer     NOT NULL DEFAULT 0,
  is_suggestion boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.food_categories               IS 'Hierarchical food categories per restaurant. parent_id = null means top-level.';
COMMENT ON COLUMN public.food_categories.is_suggestion IS 'Whether this was seeded from a global suggestion template';

-- -----------------------------------------------------------------------------
-- TABLE: food_tags
-- -----------------------------------------------------------------------------

CREATE TABLE public.food_tags (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id),
  name          text        NOT NULL,
  description   text,
  image_url     text,
  color         text,
  sort_order    integer     NOT NULL DEFAULT 0,
  is_suggestion boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.food_tags IS 'Custom food tags per restaurant (e.g. Veg, Spicy, Bestseller)';

-- -----------------------------------------------------------------------------
-- TABLE: menu_item_categories
-- -----------------------------------------------------------------------------

CREATE TABLE public.menu_item_categories (
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id),
  category_id  uuid NOT NULL REFERENCES public.food_categories(id),
  PRIMARY KEY (menu_item_id, category_id)
);

-- -----------------------------------------------------------------------------
-- TABLE: menu_item_tags
-- -----------------------------------------------------------------------------

CREATE TABLE public.menu_item_tags (
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id),
  tag_id       uuid NOT NULL REFERENCES public.food_tags(id),
  PRIMARY KEY (menu_item_id, tag_id)
);

-- -----------------------------------------------------------------------------
-- TABLE: category_suggestions (global templates)
-- -----------------------------------------------------------------------------

CREATE TABLE public.category_suggestions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  image_url   text,
  color       text,
  parent_name text
);

-- -----------------------------------------------------------------------------
-- TABLE: tag_suggestions (global templates)
-- -----------------------------------------------------------------------------

CREATE TABLE public.tag_suggestions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  image_url   text,
  color       text
);

-- -----------------------------------------------------------------------------
-- TABLE: coupons
-- -----------------------------------------------------------------------------

CREATE TABLE public.coupons (
  id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text              NOT NULL UNIQUE,
  type             public.discount_type NOT NULL,
  value            numeric           NOT NULL CHECK (value > 0),
  max_uses         integer           CHECK (max_uses IS NULL OR max_uses > 0),
  used_count       integer           NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at       timestamptz,
  is_active        boolean           NOT NULL DEFAULT true,
  applicable_plans text[]            NOT NULL DEFAULT ARRAY['pro'],
  created_at       timestamptz       NOT NULL DEFAULT now(),
  updated_at       timestamptz       NOT NULL DEFAULT now(),
  duration_days    integer
);

COMMENT ON TABLE  public.coupons                  IS 'Discount coupons for subscription plans';
COMMENT ON COLUMN public.coupons.code             IS 'Uppercase coupon code, unique';
COMMENT ON COLUMN public.coupons.value            IS 'Discount value: percentage (0-100) or flat amount in smallest currency unit (paise)';
COMMENT ON COLUMN public.coupons.applicable_plans IS 'Plans this coupon applies to, e.g. {pro, growth}';

-- -----------------------------------------------------------------------------
-- TABLE: coupon_usages
-- -----------------------------------------------------------------------------

CREATE TABLE public.coupon_usages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id     uuid        NOT NULL REFERENCES public.coupons(id),
  restaurant_id uuid        NOT NULL REFERENCES public.restaurants(id),
  used_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, restaurant_id)
);

COMMENT ON TABLE public.coupon_usages IS 'Tracks which restaurants have used which coupons';

-- -----------------------------------------------------------------------------
-- TABLE: subscriptions
-- -----------------------------------------------------------------------------

CREATE TABLE public.subscriptions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id           uuid        NOT NULL UNIQUE REFERENCES public.restaurants(id),
  plan                    text        NOT NULL DEFAULT 'free' CHECK (plan = ANY (ARRAY['free','pro'])),
  status                  text        NOT NULL DEFAULT 'active'
                            CHECK (status = ANY (ARRAY['active','trialing','past_due','canceled','incomplete'])),
  phonepe_customer_id     text        UNIQUE,
  phonepe_subscription_id text        UNIQUE,
  current_period_end      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  phonepe_transaction_id  text,
  pending_coupon_id       uuid        REFERENCES public.coupons(id),
  trial_used              boolean     NOT NULL DEFAULT false
);

COMMENT ON TABLE public.subscriptions IS 'PhonePe subscription state per restaurant';

-- -----------------------------------------------------------------------------
-- TABLE: payment_transactions
-- -----------------------------------------------------------------------------

CREATE TABLE public.payment_transactions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid        NOT NULL REFERENCES public.restaurants(id),
  merchant_order_id   text        NOT NULL UNIQUE,
  plan                text        NOT NULL DEFAULT 'pro',
  amount_paise        integer     NOT NULL,
  status              text        NOT NULL DEFAULT 'pending',
  coupon_code         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  coupon_duration_days integer
);

-- -----------------------------------------------------------------------------
-- TABLE: plans
-- -----------------------------------------------------------------------------

CREATE TABLE public.plans (
  id            text        PRIMARY KEY,
  name          text        NOT NULL,
  tagline       text        NOT NULL DEFAULT '',
  monthly_paise integer     NOT NULL DEFAULT 0,
  yearly_paise  integer     NOT NULL DEFAULT 0,
  features      text[]      NOT NULL DEFAULT '{}',
  unavailable   text[]      NOT NULL DEFAULT '{}',
  is_active     boolean     NOT NULL DEFAULT true,
  is_highlighted boolean    NOT NULL DEFAULT false,
  cta           text        NOT NULL DEFAULT 'choose',
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- TABLE: webhook_endpoints
-- -----------------------------------------------------------------------------

CREATE TABLE public.webhook_endpoints (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid        NOT NULL REFERENCES public.restaurants(id),
  name             text        NOT NULL,
  url              text        NOT NULL CHECK (url LIKE 'https://%'),
  secret           text        NOT NULL,
  events           text[]      NOT NULL DEFAULT '{}',
  is_active        boolean     NOT NULL DEFAULT true,
  failure_count    integer     NOT NULL DEFAULT 0,
  disabled_reason  text,
  last_triggered_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- TABLE: webhook_deliveries
-- -----------------------------------------------------------------------------

CREATE TABLE public.webhook_deliveries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id   uuid        NOT NULL REFERENCES public.webhook_endpoints(id),
  event_id      uuid        NOT NULL DEFAULT gen_random_uuid(),
  event_type    text        NOT NULL,
  payload       jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'pending'
                  CHECK (status = ANY (ARRAY['pending','retrying','success','failed','dead'])),
  http_status   integer,
  response_body text,
  error_message text,
  attempt       integer     NOT NULL DEFAULT 1,
  max_attempts  integer     NOT NULL DEFAULT 5,
  duration_ms   integer,
  next_retry_at timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
