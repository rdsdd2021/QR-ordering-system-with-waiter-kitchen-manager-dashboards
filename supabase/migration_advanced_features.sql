-- ============================================================================
-- ADVANCED RESTAURANT MANAGEMENT FEATURES
-- ============================================================================
-- Adds: Menu enhancements, Floor-based pricing, Table management, 
--       Waiter management, Time tracking, Performance metrics
-- ============================================================================

-- ============================================================================
-- 1. FLOORS (Floor-based pricing)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.floors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  price_multiplier NUMERIC(3, 2) NOT NULL DEFAULT 1.0 CHECK (price_multiplier > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.floors IS 'Restaurant floors/sections with different pricing (e.g., AC Hall, Rooftop)';
COMMENT ON COLUMN public.floors.price_multiplier IS 'Price multiplier for this floor (e.g., 1.0 = normal, 1.2 = 20% premium)';

CREATE INDEX idx_floors_restaurant ON public.floors (restaurant_id);

-- ============================================================================
-- 2. MENU ENHANCEMENTS
-- ============================================================================

-- Add new columns to menu_items
ALTER TABLE public.menu_items 
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN public.menu_items.image_url IS 'URL to menu item image (Supabase Storage)';
COMMENT ON COLUMN public.menu_items.tags IS 'Tags like veg, non_veg, spicy, bestseller, etc.';
COMMENT ON COLUMN public.menu_items.description IS 'Item description';

-- Create reviews table
CREATE TABLE IF NOT EXISTS public.reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id  UUID NOT NULL REFERENCES public.menu_items (id) ON DELETE CASCADE,
  rating        INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reviews IS 'Customer reviews for menu items';

CREATE INDEX idx_reviews_menu_item ON public.reviews (menu_item_id);
CREATE INDEX idx_reviews_created ON public.reviews (created_at DESC);

-- ============================================================================
-- 3. TABLE MANAGEMENT ENHANCEMENTS
-- ============================================================================

-- Add new columns to tables
ALTER TABLE public.tables 
  ADD COLUMN IF NOT EXISTS floor_id UUID REFERENCES public.floors (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 4 CHECK (capacity > 0),
  ADD COLUMN IF NOT EXISTS qr_code_url TEXT;

COMMENT ON COLUMN public.tables.floor_id IS 'Floor/section this table belongs to';
COMMENT ON COLUMN public.tables.capacity IS 'Seating capacity';
COMMENT ON COLUMN public.tables.qr_code_url IS 'URL to QR code image';

CREATE INDEX idx_tables_floor ON public.tables (floor_id);

-- ============================================================================
-- 4. WAITER MANAGEMENT
-- ============================================================================

-- Add is_active column to users
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.users.is_active IS 'Whether user is active (can take orders, login, etc.)';

CREATE INDEX idx_users_active ON public.users (is_active) WHERE is_active = true;

-- ============================================================================
-- 5. TIME TRACKING (Performance Metrics)
-- ============================================================================

-- Add timestamp columns to orders
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preparing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS served_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.confirmed_at IS 'When order was confirmed by kitchen';
COMMENT ON COLUMN public.orders.preparing_at IS 'When kitchen started preparing';
COMMENT ON COLUMN public.orders.ready_at IS 'When order was marked ready';
COMMENT ON COLUMN public.orders.served_at IS 'When order was served to customer';

CREATE INDEX idx_orders_timestamps ON public.orders (created_at, confirmed_at, preparing_at, ready_at, served_at);

-- ============================================================================
-- 6. PRICING LOGIC FUNCTION
-- ============================================================================

-- Function to calculate final price with floor multiplier
CREATE OR REPLACE FUNCTION calculate_item_price(
  p_menu_item_id UUID,
  p_table_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  base_price NUMERIC;
  multiplier NUMERIC := 1.0;
BEGIN
  -- Get base price from menu item
  SELECT price INTO base_price
  FROM menu_items
  WHERE id = p_menu_item_id;
  
  IF base_price IS NULL THEN
    RAISE EXCEPTION 'Menu item not found: %', p_menu_item_id;
  END IF;
  
  -- Get floor multiplier if table has a floor
  SELECT COALESCE(f.price_multiplier, 1.0) INTO multiplier
  FROM tables t
  LEFT JOIN floors f ON t.floor_id = f.id
  WHERE t.id = p_table_id;
  
  -- Return final price
  RETURN base_price * multiplier;
END;
$$;

COMMENT ON FUNCTION calculate_item_price IS 
  'Calculates final price for menu item based on table floor multiplier';

-- ============================================================================
-- 7. TIME TRACKING TRIGGER
-- ============================================================================

-- Automatically update timestamps when status changes
CREATE OR REPLACE FUNCTION update_order_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only update if status actually changed
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  
  -- Set timestamp based on new status
  CASE NEW.status
    WHEN 'confirmed' THEN
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
    WHEN 'preparing' THEN
      NEW.preparing_at := COALESCE(NEW.preparing_at, now());
    WHEN 'ready' THEN
      NEW.ready_at := COALESCE(NEW.ready_at, now());
    WHEN 'served' THEN
      NEW.served_at := COALESCE(NEW.served_at, now());
    ELSE
      -- No timestamp update for other statuses
  END CASE;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_order_timestamps_trigger ON public.orders;
CREATE TRIGGER update_order_timestamps_trigger
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION update_order_timestamps();

-- ============================================================================
-- 8. PERFORMANCE METRICS VIEWS
-- ============================================================================

-- View: Average preparation time (confirmed → ready)
CREATE OR REPLACE VIEW avg_preparation_time AS
SELECT 
  o.restaurant_id,
  AVG(EXTRACT(EPOCH FROM (o.ready_at - o.confirmed_at))) as avg_prep_seconds,
  COUNT(*) as order_count
FROM orders o
WHERE o.confirmed_at IS NOT NULL 
  AND o.ready_at IS NOT NULL
GROUP BY o.restaurant_id;

COMMENT ON VIEW avg_preparation_time IS 
  'Average time from order confirmation to ready (in seconds)';

-- View: Average serving time (ready → served)
CREATE OR REPLACE VIEW avg_serving_time AS
SELECT 
  o.restaurant_id,
  AVG(EXTRACT(EPOCH FROM (o.served_at - o.ready_at))) as avg_serve_seconds,
  COUNT(*) as order_count
FROM orders o
WHERE o.ready_at IS NOT NULL 
  AND o.served_at IS NOT NULL
GROUP BY o.restaurant_id;

COMMENT ON VIEW avg_serving_time IS 
  'Average time from ready to served (in seconds)';

-- View: Average turnaround time (created → served)
CREATE OR REPLACE VIEW avg_turnaround_time AS
SELECT 
  o.restaurant_id,
  AVG(EXTRACT(EPOCH FROM (o.served_at - o.created_at))) as avg_turnaround_seconds,
  COUNT(*) as order_count
FROM orders o
WHERE o.created_at IS NOT NULL 
  AND o.served_at IS NOT NULL
GROUP BY o.restaurant_id;

COMMENT ON VIEW avg_turnaround_time IS 
  'Average time from order creation to served (in seconds)';

-- View: Menu item ratings
CREATE OR REPLACE VIEW menu_item_ratings AS
SELECT 
  mi.id as menu_item_id,
  mi.restaurant_id,
  mi.name as item_name,
  COUNT(r.id) as review_count,
  AVG(r.rating) as avg_rating,
  MIN(r.rating) as min_rating,
  MAX(r.rating) as max_rating
FROM menu_items mi
LEFT JOIN reviews r ON mi.id = r.menu_item_id
GROUP BY mi.id, mi.restaurant_id, mi.name;

COMMENT ON VIEW menu_item_ratings IS 
  'Aggregated ratings for each menu item';

-- View: Table availability status
CREATE OR REPLACE VIEW table_availability AS
SELECT 
  t.id as table_id,
  t.restaurant_id,
  t.table_number,
  t.capacity,
  f.name as floor_name,
  f.price_multiplier,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM orders o 
      WHERE o.table_id = t.id 
        AND o.status IN ('pending', 'confirmed', 'preparing', 'ready')
    ) THEN 'occupied'
    ELSE 'free'
  END as status
FROM tables t
LEFT JOIN floors f ON t.floor_id = f.id;

COMMENT ON VIEW table_availability IS 
  'Real-time table availability (free/occupied based on active orders)';

-- View: Waiter availability status
CREATE OR REPLACE VIEW waiter_availability AS
SELECT 
  u.id as waiter_id,
  u.name as waiter_name,
  u.restaurant_id,
  u.is_active,
  COUNT(o.id) as active_orders,
  CASE 
    WHEN NOT u.is_active THEN 'inactive'
    WHEN COUNT(o.id) = 0 THEN 'available'
    ELSE 'busy'
  END as status
FROM users u
LEFT JOIN orders o ON u.id = o.waiter_id 
  AND o.status IN ('pending', 'confirmed', 'preparing', 'ready')
WHERE u.role = 'waiter'
GROUP BY u.id, u.name, u.restaurant_id, u.is_active;

COMMENT ON VIEW waiter_availability IS 
  'Real-time waiter availability (available/busy/inactive based on active orders)';

-- ============================================================================
-- 9. RLS POLICIES FOR NEW TABLES
-- ============================================================================

-- Enable RLS
ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Floors policies
CREATE POLICY "anyone_can_read_floors"
ON floors FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "managers_can_manage_floors"
ON floors FOR ALL
TO authenticated
USING (
  restaurant_id IN (
    SELECT restaurant_id FROM users 
    WHERE auth_id = auth.uid() AND role = 'manager'
  )
);

-- Reviews policies (anyone can read, authenticated can create)
CREATE POLICY "anyone_can_read_reviews"
ON reviews FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "authenticated_can_create_reviews"
ON reviews FOR INSERT
TO authenticated
WITH CHECK (true);

-- Grant access to views
GRANT SELECT ON avg_preparation_time TO authenticated;
GRANT SELECT ON avg_serving_time TO authenticated;
GRANT SELECT ON avg_turnaround_time TO authenticated;
GRANT SELECT ON menu_item_ratings TO authenticated;
GRANT SELECT ON table_availability TO authenticated, anon;
GRANT SELECT ON waiter_availability TO authenticated;

-- ============================================================================
-- 10. SAMPLE DATA
-- ============================================================================

-- Insert sample floors for demo restaurant
INSERT INTO public.floors (restaurant_id, name, price_multiplier) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Ground Floor', 1.0),
  ('11111111-1111-1111-1111-111111111111', 'AC Hall', 1.2),
  ('11111111-1111-1111-1111-111111111111', 'Rooftop', 1.5)
ON CONFLICT DO NOTHING;

-- Update existing tables with floor assignments
UPDATE public.tables 
SET 
  floor_id = (SELECT id FROM floors WHERE name = 'Ground Floor' AND restaurant_id = '11111111-1111-1111-1111-111111111111'),
  capacity = 4,
  qr_code_url = '/api/qr/' || id
WHERE restaurant_id = '11111111-1111-1111-1111-111111111111';

-- Add tags to existing menu items
UPDATE public.menu_items 
SET tags = ARRAY['veg', 'popular']
WHERE name = 'Margherita Pizza';

UPDATE public.menu_items 
SET tags = ARRAY['non_veg', 'bestseller']
WHERE name = 'Chicken Burger';

UPDATE public.menu_items 
SET tags = ARRAY['veg', 'healthy']
WHERE name = 'Caesar Salad';

UPDATE public.menu_items 
SET tags = ARRAY['veg', 'beverage']
WHERE name = 'Masala Chai';

UPDATE public.menu_items 
SET tags = ARRAY['veg', 'dessert', 'popular']
WHERE name = 'Chocolate Lava Cake';

-- Insert sample reviews
INSERT INTO public.reviews (menu_item_id, rating, comment) 
SELECT id, 5, 'Absolutely delicious!' 
FROM menu_items 
WHERE name = 'Margherita Pizza'
ON CONFLICT DO NOTHING;

INSERT INTO public.reviews (menu_item_id, rating, comment) 
SELECT id, 4, 'Great taste, good portion size' 
FROM menu_items 
WHERE name = 'Chicken Burger'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 11. VERIFICATION
-- ============================================================================

SELECT 
  '✅ Advanced features migration completed!' as status,
  (SELECT COUNT(*) FROM floors) as floors,
  (SELECT COUNT(*) FROM reviews) as reviews,
  (SELECT COUNT(*) FROM menu_items WHERE tags IS NOT NULL) as items_with_tags;

-- Show performance metrics (will be empty until orders are processed)
SELECT 
  'Performance Metrics' as category,
  (SELECT COUNT(*) FROM avg_preparation_time) as prep_time_records,
  (SELECT COUNT(*) FROM avg_serving_time) as serve_time_records,
  (SELECT COUNT(*) FROM avg_turnaround_time) as turnaround_records;

-- Show availability status
SELECT 
  'Availability Status' as category,
  (SELECT COUNT(*) FROM table_availability WHERE status = 'free') as free_tables,
  (SELECT COUNT(*) FROM table_availability WHERE status = 'occupied') as occupied_tables,
  (SELECT COUNT(*) FROM waiter_availability WHERE status = 'available') as available_waiters;

-- ============================================================================
-- NEXT STEPS:
-- 1. Update frontend to use calculate_item_price() when creating orders
-- 2. Display floor-based pricing in customer menu
-- 3. Add manager UI for floors, tables, and waiter management
-- 4. Show performance metrics in manager dashboard
-- 5. Display real-time availability status
-- ============================================================================
