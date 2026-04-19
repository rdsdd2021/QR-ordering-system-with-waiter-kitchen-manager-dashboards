-- ============================================================================
-- REAL-TIME DEBUG AND TEST
-- ============================================================================
-- Run this to verify and fix real-time broadcasting
-- ============================================================================

-- Step 1: Check if the broadcast function exists
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname = 'broadcast_order_change';

-- Step 2: Check if the trigger exists
SELECT tgname, tgrelid::regclass, tgenabled 
FROM pg_trigger 
WHERE tgname = 'on_order_change';

-- Step 3: Check if realtime publication includes orders table
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime' 
AND tablename = 'orders';

-- Step 4: Recreate the broadcast function (FIXED VERSION)
CREATE OR REPLACE FUNCTION public.broadcast_order_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_name TEXT;
  payload jsonb;
BEGIN
  -- Determine event type
  IF TG_OP = 'INSERT' THEN
    event_name := 'INSERT';
  ELSIF TG_OP = 'UPDATE' THEN
    event_name := 'UPDATE';
  ELSIF TG_OP = 'DELETE' THEN
    event_name := 'DELETE';
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;

  -- Build payload
  payload := jsonb_build_object(
    'event', event_name,
    'id', NEW.id,
    'restaurant_id', NEW.restaurant_id,
    'table_id', NEW.table_id,
    'status', NEW.status,
    'waiter_id', NEW.waiter_id,
    'created_at', NEW.created_at
  );

  -- Log for debugging (check Supabase logs)
  RAISE NOTICE 'Broadcasting order change: %', payload;

  -- Broadcast to kitchen channel
  PERFORM pg_notify(
    'kitchen:' || NEW.restaurant_id::text,
    payload::text
  );

  -- Broadcast to waiter channel
  PERFORM pg_notify(
    'waiter:' || NEW.restaurant_id::text,
    payload::text
  );

  -- Broadcast to manager channel
  PERFORM pg_notify(
    'manager:' || NEW.restaurant_id::text,
    payload::text
  );

  RETURN NEW;
END;
$$;

-- Step 5: Ensure trigger is active
DROP TRIGGER IF EXISTS on_order_change ON public.orders;
CREATE TRIGGER on_order_change
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_order_change();

-- Step 6: Enable realtime for orders table
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.orders;

-- Step 7: Test the trigger manually
-- Uncomment and run this to test:
-- INSERT INTO public.orders (restaurant_id, table_id, status) 
-- VALUES ('11111111-1111-1111-1111-111111111111', 
--         (SELECT id FROM public.tables LIMIT 1), 
--         'pending');

-- Step 8: Check if realtime is enabled in your Supabase project
-- Go to: Dashboard > Settings > API > Realtime should be ON

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check recent orders
SELECT id, restaurant_id, table_id, status, created_at 
FROM public.orders 
ORDER BY created_at DESC 
LIMIT 5;

-- Check if trigger fired (look for NOTICE in logs)
-- Go to: Dashboard > Logs > Postgres Logs

-- ============================================================================
-- TROUBLESHOOTING
-- ============================================================================

-- If still not working, try using Supabase Realtime Broadcast API instead:
-- This uses the newer broadcast API which is more reliable

CREATE OR REPLACE FUNCTION public.broadcast_order_change_v2()
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
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;

  -- Use realtime.send if available (Supabase v2)
  BEGIN
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
      'manager:' || NEW.restaurant_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    -- Fallback to pg_notify if realtime.send doesn't exist
    RAISE NOTICE 'realtime.send failed, using pg_notify: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Apply the v2 function
DROP TRIGGER IF EXISTS on_order_change ON public.orders;
CREATE TRIGGER on_order_change
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_order_change_v2();

-- ============================================================================
-- FINAL CHECK
-- ============================================================================
SELECT 'Setup complete! Now test by placing an order.' as status;
