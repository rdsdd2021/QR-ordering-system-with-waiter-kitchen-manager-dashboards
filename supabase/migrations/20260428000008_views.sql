-- =============================================================================
-- SEGMENT 8: Views (Analytics & Operational)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- table_availability
-- Shows each table with its floor info and live occupancy status
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.table_availability AS
SELECT
  t.id              AS table_id,
  t.restaurant_id,
  t.table_number,
  t.capacity,
  t.qr_code_url,
  t.floor_id,
  f.name            AS floor_name,
  f.price_multiplier,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM orders o
      WHERE o.table_id = t.id
        AND o.status <> 'served'
        AND o.billed_at IS NULL
    ) THEN 'occupied'
    ELSE 'free'
  END AS status
FROM tables t
LEFT JOIN floors f ON t.floor_id = f.id;

-- -----------------------------------------------------------------------------
-- waiter_availability
-- Shows each waiter with their active order count and availability status
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.waiter_availability AS
SELECT
  u.id            AS waiter_id,
  u.name          AS waiter_name,
  u.restaurant_id,
  u.is_active,
  count(o.id)     AS active_orders,
  CASE
    WHEN NOT u.is_active    THEN 'inactive'
    WHEN count(o.id) = 0    THEN 'available'
    ELSE                         'busy'
  END AS status
FROM users u
LEFT JOIN orders o
  ON u.id = o.waiter_id
  AND o.status = ANY (ARRAY['pending','confirmed','preparing','ready'])
WHERE u.role = 'waiter'
GROUP BY u.id, u.name, u.restaurant_id, u.is_active;

-- -----------------------------------------------------------------------------
-- daily_sales
-- Aggregated daily revenue per restaurant (billed orders only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.daily_sales AS
SELECT
  restaurant_id,
  date(billed_at)  AS sale_date,
  count(*)         AS total_orders,
  sum(total_amount) AS total_sales
FROM orders
WHERE billed_at IS NOT NULL
GROUP BY restaurant_id, date(billed_at);

-- -----------------------------------------------------------------------------
-- top_selling_items
-- Ranked menu items by quantity sold and revenue (billed orders only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.top_selling_items AS
SELECT
  o.restaurant_id,
  mi.id              AS menu_item_id,
  mi.name            AS item_name,
  sum(oi.quantity)   AS total_quantity,
  sum(oi.quantity::numeric * oi.price) AS total_revenue
FROM order_items oi
JOIN orders     o  ON oi.order_id     = o.id
JOIN menu_items mi ON oi.menu_item_id = mi.id
WHERE o.billed_at IS NOT NULL
GROUP BY o.restaurant_id, mi.id, mi.name;

-- -----------------------------------------------------------------------------
-- menu_item_ratings
-- Aggregated review stats per menu item
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.menu_item_ratings AS
SELECT
  mi.id            AS menu_item_id,
  mi.restaurant_id,
  mi.name          AS item_name,
  count(r.id)      AS review_count,
  avg(r.rating)    AS avg_rating,
  min(r.rating)    AS min_rating,
  max(r.rating)    AS max_rating
FROM menu_items mi
LEFT JOIN reviews r ON mi.id = r.menu_item_id
GROUP BY mi.id, mi.restaurant_id, mi.name;

-- -----------------------------------------------------------------------------
-- avg_preparation_time
-- Average seconds from confirmed → ready per restaurant
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.avg_preparation_time AS
SELECT
  restaurant_id,
  avg(EXTRACT(epoch FROM (ready_at - confirmed_at))) AS avg_prep_seconds,
  count(*) AS order_count
FROM orders o
WHERE confirmed_at IS NOT NULL
  AND ready_at IS NOT NULL
GROUP BY restaurant_id;

-- -----------------------------------------------------------------------------
-- avg_serving_time
-- Average seconds from ready → served per restaurant
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.avg_serving_time AS
SELECT
  restaurant_id,
  avg(EXTRACT(epoch FROM (served_at - ready_at))) AS avg_serve_seconds,
  count(*) AS order_count
FROM orders o
WHERE ready_at IS NOT NULL
  AND served_at IS NOT NULL
GROUP BY restaurant_id;

-- -----------------------------------------------------------------------------
-- avg_turnaround_time
-- Average seconds from order created → served per restaurant
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.avg_turnaround_time AS
SELECT
  restaurant_id,
  avg(EXTRACT(epoch FROM (served_at - created_at))) AS avg_turnaround_seconds,
  count(*) AS order_count
FROM orders o
WHERE created_at IS NOT NULL
  AND served_at IS NOT NULL
GROUP BY restaurant_id;
