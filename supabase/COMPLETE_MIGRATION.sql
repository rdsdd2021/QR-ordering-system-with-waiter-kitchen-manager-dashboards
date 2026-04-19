-- ============================================================================
-- QR ORDER SYSTEM - COMPLETE DATABASE MIGRATION
-- ============================================================================
-- This is the ONLY migration file you need to run.
-- It includes: schema, order routing, roles, billing, auth, and RLS policies.
-- Run this once in Supabase SQL Editor to set up everything.
-- ============================================================================

-- ============================================================================
-- 1. CORE SCHEMA
-- ============================================================================

-- Restaurants
CREATE TABLE IF NOT EXISTS public.restaurants (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  order_routing_mode TEXT NOT NULL DEFAULT 'direct_to_kitchen'
    CHECK (order_routing_mode IN ('direct_to_kitchen', 'waiter_first'))
);
COMMENT ON TABLE public.restaurants IS 'Restaurants using the QR ordering system';
COMMENT ON COLUMN public.restaurants.order_routing_mode IS 
  'Controls order routing: direct_to_kitchen (orders go straight to kitchen) or waiter_first (waiter must accept first)';

-- Tables
CREATE TABLE IF NOT EXISTS public.tables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  table_number  INTEGER NOT NULL,
  UNIQUE (restaurant_id, table_number)
);
COMMENT ON TABLE public.tables IS 'Physical tables inside a restaurant, each with unique table number';

-- Menu Items
CREATE TABLE IF NOT EXISTS public.menu_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  price         NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  is_available  BOOLEAN NOT NULL DEFAULT true
);
COMMENT ON TABLE public.menu_items IS 'Menu items offered by a restaurant';

-- Users (Staff)
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('waiter', 'manager', 'kitchen')),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  auth_id       UUID REFERENCES auth.users(id),
  email         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.users IS 'System users with role-based access. Linked to Supabase Auth via auth_id';

-- Orders
CREATE TABLE IF NOT EXISTS public.orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  table_id      UUID NOT NULL REFERENCES public.tables (id) ON DELETE CASCADE,
  waiter_id     UUID REFERENCES public.users (id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'pending_waiter', 'confirmed', 'preparing', 'ready', 'served')),
  total_amount  NUMERIC(10, 2) DEFAULT 0 CHECK (total_amount >= 0),
  billed_at     TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.orders IS 'Customer orders placed via QR code';
COMMENT ON COLUMN public.orders.waiter_id IS 'Waiter assigned to handle this order';
COMMENT ON COLUMN public.orders.total_amount IS 'Total order amount calculated from order_items';
COMMENT ON COLUMN public.orders.billed_at IS 'Timestamp when bill was generated';

-- Order Items
CREATE TABLE IF NOT EXISTS public.order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES public.menu_items (id) ON DELETE RESTRICT,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  price        NUMERIC(10, 2) NOT NULL CHECK (price >= 0)
);
COMMENT ON TABLE public.order_items IS 'Individual line items within an order';

-- Order Status Logs (Audit Trail)
CREATE TABLE IF NOT EXISTS public.order_status_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES public.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.order_status_logs IS 'Audit trail of all order status changes';

-- ============================================================================
-- 2. INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tables_restaurant ON public.tables (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_available ON public.menu_items (restaurant_id, is_available);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_table ON public.orders (restaurant_id, table_id);
CREATE INDEX IF NOT EXISTS idx_orders_waiter ON public.orders (waiter_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_restaurant ON public.orders (status, restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orders_billed ON public.orders (restaurant_id, billed_at) WHERE billed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_served_unbilled ON public.orders (restaurant_id, status, billed_at) 
  WHERE status = 'served' AND billed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_users_restaurant_role ON public.users (restaurant_id, role);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users (auth_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_order_status_logs_order ON public.order_status_logs (order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_logs_created ON public.order_status_logs (created_at);

-- ============================================================================
-- 3. HELPER FUNCTIONS
-- ============================================================================

-- Get initial order status based on restaurant routing mode
CREATE OR REPLACE FUNCTION public.get_initial_order_status(p_restaurant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
  routing_mode TEXT;
BEGIN
  SELECT COALESCE(order_routing_mode, 'direct_to_kitchen')
  INTO routing_mode
  FROM public.restaurants
  WHERE id = p_restaurant_id;

  IF routing_mode = 'waiter_first' THEN
    RETURN 'pending_waiter';
  ELSE
    RETURN 'pending';
  END IF;
END;
$;

-- Calculate order total from order items
CREATE OR REPLACE FUNCTION public.calculate_order_total(p_order_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
  order_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(quantity * price), 0)
  INTO order_total
  FROM public.order_items
  WHERE order_id = p_order_id;
  
  RETURN order_total;
END;
$;

-- Generate bill for an order
CREATE OR REPLACE FUNCTION public.generate_bill(p_order_id UUID)
RETURNS TABLE(
  order_id UUID,
  total_amount NUMERIC,
  billed_at TIMESTAMPTZ,
  success BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
  calculated_total NUMERIC;
  order_status TEXT;
BEGIN
  SELECT status INTO order_status
  FROM public.orders
  WHERE id = p_order_id;
  
  IF order_status IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;
  
  IF order_status != 'served' THEN
    RAISE EXCEPTION 'Cannot bill order that is not served. Current status: %', order_status;
  END IF;
  
  calculated_total := public.calculate_order_total(p_order_id);
  
  UPDATE public.orders
  SET 
    total_amount = calculated_total,
    billed_at = now()
  WHERE id = p_order_id
  RETURNING 
    id,
    total_amount,
    billed_at,
    true
  INTO 
    order_id,
    total_amount,
    billed_at,
    success;
  
  RETURN NEXT;
END;
$;

-- Get current user's role
CREATE OR REPLACE FUNCTION get_user_role(user_id UUID DEFAULT NULL)
RETURNS TEXT AS $
  SELECT role FROM users 
  WHERE CASE 
    WHEN user_id IS NOT NULL THEN id = user_id
    ELSE auth_id = auth.uid()
  END
  LIMIT 1;
$ LANGUAGE SQL SECURITY DEFINER;

-- Get current user's restaurant_id
CREATE OR REPLACE FUNCTION get_user_restaurant_id(user_id UUID DEFAULT NULL)
RETURNS UUID AS $
  SELECT restaurant_id FROM users 
  WHERE CASE 
    WHEN user_id IS NOT NULL THEN id = user_id
    ELSE auth_id = auth.uid()
  END
  LIMIT 1;
$ LANGUAGE SQL SECURITY DEFINER;

-- Check if user has specific role
CREATE OR REPLACE FUNCTION user_has_role(user_id UUID, required_role TEXT)
RETURNS BOOLEAN AS $
  SELECT EXISTS (
    SELECT 1 FROM users 
    WHERE id = user_id AND role = required_role
  );
$ LANGUAGE SQL SECURITY DEFINER;

-- ============================================================================
-- 4. ORDER STATE MACHINE (Enforces Valid Status Transitions)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
  allowed_transitions JSONB := '{
    "pending": ["confirmed"],
    "pending_waiter": ["confirmed"],
    "confirmed": ["preparing"],
    "preparing": ["ready"],
    "ready": ["served"],
    "served": []
  }';
  allowed_next_statuses JSONB;
BEGIN
  -- Skip validation for INSERT
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Skip validation if status hasn't changed (e.g., just updating waiter_id)
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Get allowed next statuses
  allowed_next_statuses := allowed_transitions -> OLD.status;
  
  -- Check if transition is valid
  IF NOT (allowed_next_statuses ? NEW.status) THEN
    RAISE EXCEPTION 'Invalid status transition from % to %. Allowed transitions: %', 
      OLD.status, NEW.status, allowed_next_statuses;
  END IF;

  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS validate_order_status_transition ON public.orders;
CREATE TRIGGER validate_order_status_transition
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_order_status_transition();

-- ============================================================================
-- 5. ORDER STATUS LOGGING (Audit Trail)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    INSERT INTO public.order_status_logs (order_id, old_status, new_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.waiter_id);
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_status_logs (order_id, old_status, new_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, NEW.waiter_id);
  END IF;

  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS log_order_status_change ON public.orders;
CREATE TRIGGER log_order_status_change
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.log_order_status_change();

-- ============================================================================
-- 6. REAL-TIME BROADCAST (For Kitchen & Waiter Dashboards)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.broadcast_order_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
  event_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'INSERT';
  ELSIF TG_OP = 'UPDATE' THEN
    event_name := 'UPDATE';
  ELSE
    RETURN NULL;
  END IF;

  -- Broadcast to kitchen channel
  PERFORM realtime.send(
    jsonb_build_object(
      'event', event_name,
      'id', NEW.id,
      'restaurant_id', NEW.restaurant_id,
      'table_id', NEW.table_id,
      'status', NEW.status,
      'waiter_id', NEW.waiter_id,
      'created_at', NEW.created_at
    ),
    'order_changed',
    'kitchen:' || NEW.restaurant_id::text
  );

  -- Broadcast to waiter channel
  PERFORM realtime.send(
    jsonb_build_object(
      'event', event_name,
      'id', NEW.id,
      'restaurant_id', NEW.restaurant_id,
      'table_id', NEW.table_id,
      'status', NEW.status,
      'waiter_id', NEW.waiter_id,
      'created_at', NEW.created_at
    ),
    'order_changed',
    'waiter:' || NEW.restaurant_id::text
  );

  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS on_order_change ON public.orders;
CREATE TRIGGER on_order_change
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_order_change();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.users;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.order_status_logs;

-- ============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_logs ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "Public can read restaurants" ON restaurants;
DROP POLICY IF EXISTS "Public can update restaurants" ON restaurants;
DROP POLICY IF EXISTS "Public can view users" ON users;
DROP POLICY IF EXISTS "Public can view order status logs" ON order_status_logs;

-- RESTAURANTS POLICIES
CREATE POLICY "Users can read own restaurant"
ON restaurants FOR SELECT TO authenticated
USING (id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Managers can update own restaurant"
ON restaurants FOR UPDATE TO authenticated
USING (id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid() AND role = 'manager'))
WITH CHECK (id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid() AND role = 'manager'));

-- Allow public update for manager dashboard (temporary - can be restricted later)
CREATE POLICY "Public can update restaurants" 
ON restaurants FOR UPDATE TO public 
USING (true) WITH CHECK (true);

-- TABLES POLICIES
CREATE POLICY "Users can read own restaurant tables"
ON tables FOR SELECT TO authenticated
USING (restaurant_id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Managers can manage tables"
ON tables FOR ALL TO authenticated
USING (restaurant_id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid() AND role = 'manager'));

-- MENU ITEMS POLICIES
CREATE POLICY "Anyone can read available menu items"
ON menu_items FOR SELECT TO anon, authenticated
USING (is_available = true);

CREATE POLICY "Users can read own restaurant menu"
ON menu_items FOR SELECT TO authenticated
USING (restaurant_id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Managers can manage menu items"
ON menu_items FOR ALL TO authenticated
USING (restaurant_id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid() AND role = 'manager'));

-- ORDERS POLICIES
CREATE POLICY "Anyone can create orders"
ON orders FOR INSERT TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Users can read own restaurant orders"
ON orders FOR SELECT TO authenticated
USING (restaurant_id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Kitchen and waiters can update orders"
ON orders FOR UPDATE TO authenticated
USING (restaurant_id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid() AND role IN ('kitchen', 'waiter', 'manager')));

-- ORDER ITEMS POLICIES
CREATE POLICY "Anyone can create order items"
ON order_items FOR INSERT TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Users can read own restaurant order items"
ON order_items FOR SELECT TO authenticated
USING (order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid())));

-- USERS POLICIES
-- Create helper function to avoid recursion
CREATE OR REPLACE FUNCTION get_current_user_restaurant()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT restaurant_id FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- Users can read their own profile
CREATE POLICY "users_select_own"
ON users FOR SELECT TO authenticated
USING (auth_id = auth.uid());

-- Users can read other users in their restaurant
CREATE POLICY "users_select_restaurant"
ON users FOR SELECT TO authenticated
USING (restaurant_id = get_current_user_restaurant());

-- Users can update their own profile
CREATE POLICY "users_update_own"
ON users FOR UPDATE TO authenticated
USING (auth_id = auth.uid())
WITH CHECK (auth_id = auth.uid());

-- ORDER STATUS LOGS POLICIES
CREATE POLICY "Users can read own restaurant order logs"
ON order_status_logs FOR SELECT TO authenticated
USING (order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM users WHERE auth_id = auth.uid())));

-- ============================================================================
-- 8. ANALYTICS VIEWS (For Manager Dashboard)
-- ============================================================================

CREATE OR REPLACE VIEW daily_sales AS
SELECT 
  restaurant_id,
  DATE(billed_at) as sale_date,
  COUNT(*) as total_orders,
  SUM(total_amount) as total_sales
FROM orders
WHERE billed_at IS NOT NULL
GROUP BY restaurant_id, DATE(billed_at);

CREATE OR REPLACE VIEW top_selling_items AS
SELECT 
  o.restaurant_id,
  mi.id as menu_item_id,
  mi.name as item_name,
  SUM(oi.quantity) as total_quantity,
  SUM(oi.quantity * oi.price) as total_revenue
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
JOIN menu_items mi ON oi.menu_item_id = mi.id
WHERE o.billed_at IS NOT NULL
GROUP BY o.restaurant_id, mi.id, mi.name;

GRANT SELECT ON daily_sales TO authenticated;
GRANT SELECT ON top_selling_items TO authenticated;

-- ============================================================================
-- 9. SAMPLE DATA (Remove before production)
-- ============================================================================

-- Insert demo restaurant
INSERT INTO public.restaurants (id, name, order_routing_mode)
VALUES ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'direct_to_kitchen')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Insert demo tables
INSERT INTO public.tables (id, restaurant_id, table_number)
VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 1),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 2),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 3)
ON CONFLICT (restaurant_id, table_number) DO NOTHING;

-- Insert demo menu items
INSERT INTO public.menu_items (restaurant_id, name, price, is_available)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Margherita Pizza', 299.00, true),
  ('11111111-1111-1111-1111-111111111111', 'Chicken Burger', 199.00, true),
  ('11111111-1111-1111-1111-111111111111', 'Caesar Salad', 149.00, true),
  ('11111111-1111-1111-1111-111111111111', 'Masala Chai', 49.00, true),
  ('11111111-1111-1111-1111-111111111111', 'Chocolate Lava Cake', 179.00, true)
ON CONFLICT DO NOTHING;

-- Insert demo users (will be linked to auth users later)
INSERT INTO public.users (id, name, role, restaurant_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice (Waiter)', 'waiter', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bob (Waiter)', 'waiter', '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Charlie (Manager)', 'manager', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Diana (Kitchen)', 'kitchen', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 10. VERIFICATION
-- ============================================================================

SELECT 
  '✅ Migration completed successfully!' as status,
  (SELECT COUNT(*) FROM restaurants) as restaurants,
  (SELECT COUNT(*) FROM tables) as tables,
  (SELECT COUNT(*) FROM menu_items) as menu_items,
  (SELECT COUNT(*) FROM users) as users;

-- ============================================================================
-- NEXT STEPS:
-- 1. Create auth users in Supabase Dashboard (manager@demo.com, waiter@demo.com, kitchen@demo.com)
-- 2. Run setup_auth_users.sql to link auth users to profiles
-- 3. Test login at http://localhost:3000/login
-- ============================================================================
