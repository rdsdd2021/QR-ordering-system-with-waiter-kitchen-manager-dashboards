-- ============================================================================
-- COMPREHENSIVE REAL-TIME SYSTEM
-- ============================================================================
-- This migration adds real-time broadcasting for all tables and operations
-- to ensure instant updates across all users and dashboards.
-- ============================================================================

-- ============================================================================
-- 1. ENHANCED ORDER CHANGE BROADCAST
-- ============================================================================
-- Broadcasts to kitchen, waiter, manager, and customer channels

CREATE OR REPLACE FUNCTION public.broadcast_order_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'INSERT';
  ELSIF TG_OP = 'UPDATE' THEN
    event_name := 'UPDATE';
  ELSIF TG_OP = 'DELETE' THEN
    event_name := 'DELETE';
  ELSE
    RETURN NULL;
  END IF;

  -- Use NEW for INSERT/UPDATE, OLD for DELETE
  DECLARE
    order_data RECORD;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      order_data := OLD;
    ELSE
      order_data := NEW;
    END IF;

    -- Broadcast to kitchen channel
    PERFORM realtime.send(
      jsonb_build_object(
        'event', event_name,
        'id', order_data.id,
        'restaurant_id', order_data.restaurant_id,
        'table_id', order_data.table_id,
        'status', order_data.status,
        'waiter_id', order_data.waiter_id,
        'total_amount', order_data.total_amount,
        'created_at', order_data.created_at
      ),
      'order_changed',
      'kitchen:' || order_data.restaurant_id::text
    );

    -- Broadcast to waiter channel
    PERFORM realtime.send(
      jsonb_build_object(
        'event', event_name,
        'id', order_data.id,
        'restaurant_id', order_data.restaurant_id,
        'table_id', order_data.table_id,
        'status', order_data.status,
        'waiter_id', order_data.waiter_id,
        'total_amount', order_data.total_amount,
        'created_at', order_data.created_at
      ),
      'order_changed',
      'waiter:' || order_data.restaurant_id::text
    );

    -- Broadcast to manager channel
    PERFORM realtime.send(
      jsonb_build_object(
        'event', event_name,
        'id', order_data.id,
        'restaurant_id', order_data.restaurant_id,
        'table_id', order_data.table_id,
        'status', order_data.status,
        'waiter_id', order_data.waiter_id,
        'total_amount', order_data.total_amount,
        'created_at', order_data.created_at
      ),
      'order_changed',
      'manager:' || order_data.restaurant_id::text
    );

    -- Broadcast to customer channel (table-specific)
    PERFORM realtime.send(
      jsonb_build_object(
        'event', event_name,
        'id', order_data.id,
        'status', order_data.status,
        'total_amount', order_data.total_amount
      ),
      'order_changed',
      'customer:' || order_data.restaurant_id::text || ':' || order_data.table_id::text
    );
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS on_order_change ON public.orders;
CREATE TRIGGER on_order_change
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_order_change();

-- ============================================================================
-- 2. MENU ITEM CHANGE BROADCAST
-- ============================================================================
-- Notifies all customers and managers when menu items change

CREATE OR REPLACE FUNCTION public.broadcast_menu_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_name TEXT;
  item_data RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'INSERT';
    item_data := NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    event_name := 'UPDATE';
    item_data := NEW;
  ELSIF TG_OP = 'DELETE' THEN
    event_name := 'DELETE';
    item_data := OLD;
  ELSE
    RETURN NULL;
  END IF;

  -- Broadcast to manager channel
  PERFORM realtime.send(
    jsonb_build_object(
      'event', event_name,
      'id', item_data.id,
      'restaurant_id', item_data.restaurant_id,
      'name', item_data.name,
      'price', item_data.price,
      'is_available', item_data.is_available
    ),
    'menu_changed',
    'manager:' || item_data.restaurant_id::text
  );

  -- Broadcast to all customers in this restaurant
  PERFORM realtime.send(
    jsonb_build_object(
      'event', event_name,
      'id', item_data.id,
      'name', item_data.name,
      'price', item_data.price,
      'is_available', item_data.is_available
    ),
    'menu_changed',
    'customer:' || item_data.restaurant_id::text
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS on_menu_change ON public.menu_items;
CREATE TRIGGER on_menu_change
  AFTER INSERT OR UPDATE OR DELETE ON public.menu_items
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_menu_change();

-- ============================================================================
-- 3. TABLE CHANGE BROADCAST
-- ============================================================================
-- Notifies managers when tables are added, updated, or removed

CREATE OR REPLACE FUNCTION public.broadcast_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_name TEXT;
  table_data RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'INSERT';
    table_data := NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    event_name := 'UPDATE';
    table_data := NEW;
  ELSIF TG_OP = 'DELETE' THEN
    event_name := 'DELETE';
    table_data := OLD;
  ELSE
    RETURN NULL;
  END IF;

  -- Broadcast to manager channel
  PERFORM realtime.send(
    jsonb_build_object(
      'event', event_name,
      'id', table_data.id,
      'restaurant_id', table_data.restaurant_id,
      'table_number', table_data.table_number,
      'floor_id', table_data.floor_id,
      'capacity', table_data.capacity
    ),
    'table_changed',
    'manager:' || table_data.restaurant_id::text
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS on_table_change ON public.tables;
CREATE TRIGGER on_table_change
  AFTER INSERT OR UPDATE OR DELETE ON public.tables
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_table_change();

-- ============================================================================
-- 4. FLOOR CHANGE BROADCAST
-- ============================================================================
-- Notifies managers when floors are added, updated, or removed

CREATE OR REPLACE FUNCTION public.broadcast_floor_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_name TEXT;
  floor_data RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'INSERT';
    floor_data := NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    event_name := 'UPDATE';
    floor_data := NEW;
  ELSIF TG_OP = 'DELETE' THEN
    event_name := 'DELETE';
    floor_data := OLD;
  ELSE
    RETURN NULL;
  END IF;

  -- Broadcast to manager channel
  PERFORM realtime.send(
    jsonb_build_object(
      'event', event_name,
      'id', floor_data.id,
      'restaurant_id', floor_data.restaurant_id,
      'name', floor_data.name,
      'display_order', floor_data.display_order
    ),
    'floor_changed',
    'manager:' || floor_data.restaurant_id::text
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS on_floor_change ON public.floors;
CREATE TRIGGER on_floor_change
  AFTER INSERT OR UPDATE OR DELETE ON public.floors
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_floor_change();

-- ============================================================================
-- 5. USER/STAFF CHANGE BROADCAST
-- ============================================================================
-- Notifies managers when staff members are added, updated, or removed

CREATE OR REPLACE FUNCTION public.broadcast_user_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_name TEXT;
  user_data RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'INSERT';
    user_data := NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    event_name := 'UPDATE';
    user_data := NEW;
  ELSIF TG_OP = 'DELETE' THEN
    event_name := 'DELETE';
    user_data := OLD;
  ELSE
    RETURN NULL;
  END IF;

  -- Broadcast to manager channel
  PERFORM realtime.send(
    jsonb_build_object(
      'event', event_name,
      'id', user_data.id,
      'restaurant_id', user_data.restaurant_id,
      'name', user_data.name,
      'role', user_data.role,
      'email', user_data.email
    ),
    'user_changed',
    'manager:' || user_data.restaurant_id::text
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS on_user_change ON public.users;
CREATE TRIGGER on_user_change
  AFTER INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_user_change();

-- ============================================================================
-- 6. RESTAURANT SETTINGS CHANGE BROADCAST
-- ============================================================================
-- Notifies all users when restaurant settings change

CREATE OR REPLACE FUNCTION public.broadcast_restaurant_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Broadcast to all channels for this restaurant
  PERFORM realtime.send(
    jsonb_build_object(
      'event', 'UPDATE',
      'id', NEW.id,
      'name', NEW.name,
      'order_routing_mode', NEW.order_routing_mode
    ),
    'restaurant_changed',
    'manager:' || NEW.id::text
  );

  PERFORM realtime.send(
    jsonb_build_object(
      'event', 'UPDATE',
      'order_routing_mode', NEW.order_routing_mode
    ),
    'restaurant_changed',
    'kitchen:' || NEW.id::text
  );

  PERFORM realtime.send(
    jsonb_build_object(
      'event', 'UPDATE',
      'order_routing_mode', NEW.order_routing_mode
    ),
    'restaurant_changed',
    'waiter:' || NEW.id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_restaurant_change ON public.restaurants;
CREATE TRIGGER on_restaurant_change
  AFTER UPDATE ON public.restaurants
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_restaurant_change();

-- ============================================================================
-- 7. ENABLE REALTIME FOR ALL TABLES
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.order_items;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.menu_items;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.tables;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.floors;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.users;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.restaurants;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.order_status_logs;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- All tables now broadcast changes in real-time to relevant channels:
-- - kitchen:restaurant_id - Kitchen dashboard
-- - waiter:restaurant_id - Waiter dashboard
-- - manager:restaurant_id - Manager dashboard
-- - customer:restaurant_id:table_id - Customer ordering page
-- - customer:restaurant_id - All customers (for menu changes)
-- ============================================================================
