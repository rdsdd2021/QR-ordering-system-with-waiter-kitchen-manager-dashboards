-- =============================================================================
-- SEGMENT 9: Function EXECUTE Grants + broadcast_order_change (legacy)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- broadcast_order_change (legacy/orphaned — no trigger attached, kept for API compat)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.broadcast_order_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  event_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'INSERT';
  ELSIF TG_OP = 'UPDATE' THEN
    event_name := 'UPDATE';
  ELSE
    RETURN null;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'event',         event_name,
      'id',            NEW.id,
      'restaurant_id', NEW.restaurant_id,
      'table_id',      NEW.table_id,
      'status',        NEW.status,
      'waiter_id',     NEW.waiter_id,
      'created_at',    NEW.created_at
    ),
    'order_changed',
    'kitchen:' || NEW.restaurant_id::text
  );

  PERFORM realtime.send(
    jsonb_build_object(
      'event',         event_name,
      'id',            NEW.id,
      'restaurant_id', NEW.restaurant_id,
      'table_id',      NEW.table_id,
      'status',        NEW.status,
      'waiter_id',     NEW.waiter_id,
      'created_at',    NEW.created_at
    ),
    'order_changed',
    'waiter:' || NEW.restaurant_id::text
  );

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- EXECUTE grants for all public functions
-- Supabase exposes these to anon/authenticated/service_role via PostgREST
-- -----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.accept_order_atomic(uuid, uuid)                          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_order_to_waiter(uuid, uuid)                       TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_assign_table_waiter()                               TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_assign_waiter_from_session()                        TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_confirm_pending_orders()                            TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_order_change()                                 TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_order_changes()                                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_order_on_items_insert()                        TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_item_price(uuid, uuid)                         TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_item_prices_batch(jsonb, uuid)                 TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_order_total(uuid)                              TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_table_has_unpaid_orders(uuid, text)                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_table_session(uuid)                                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_default_subscription()                            TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_bill(uuid, text, numeric, text)                 TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_user_restaurant()                            TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_initial_order_status(uuid)                           TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_plan_limits(text)                                    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_restaurant_plan(uuid)                                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_table_unpaid_orders(uuid)                            TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_restaurant_id()                                 TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role()                                          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_order_status_change()                                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.onboard_restaurant(uuid, text, text, text)               TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_table_session(uuid, uuid, uuid)                     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_coupon_usage(uuid, uuid)                          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable()                                        TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at()                                         TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_coupon_updated_at()                               TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_order_timestamps()                                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_role(text)                                      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text, text, uuid)                        TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_order_status_transition()                       TO anon, authenticated, service_role;
