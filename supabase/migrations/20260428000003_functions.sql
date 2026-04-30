-- =============================================================================
-- SEGMENT 3: Functions (RPCs and helpers)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_current_user_restaurant
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_user_restaurant()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
AS $$
  SELECT restaurant_id FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- get_user_restaurant_id (alias)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_restaurant_id()
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
AS $$
  SELECT restaurant_id FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- get_user_role
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_role()
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
AS $$
  SELECT role FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- user_has_role
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_role(required_role text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE auth_id = auth.uid() AND role = required_role
  );
$$;

-- -----------------------------------------------------------------------------
-- get_plan_limits
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_plan_limits(p_plan text)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
AS $$
  SELECT CASE p_plan
    WHEN 'free' THEN '{"max_tables": 5, "max_menu_items": 20, "analytics": false, "advanced_features": false}'::jsonb
    WHEN 'pro'  THEN '{"max_tables": 999, "max_menu_items": 999, "analytics": true, "advanced_features": true}'::jsonb
    ELSE              '{"max_tables": 5, "max_menu_items": 20, "analytics": false, "advanced_features": false}'::jsonb
  END;
$$;

-- -----------------------------------------------------------------------------
-- get_restaurant_plan
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_restaurant_plan(p_restaurant_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_plan TEXT;
BEGIN
  SELECT COALESCE(s.plan, 'free')
  INTO v_plan
  FROM public.restaurants r
  LEFT JOIN public.subscriptions s
    ON s.restaurant_id = r.id AND s.status IN ('active', 'trialing')
  WHERE r.id = p_restaurant_id;

  RETURN COALESCE(v_plan, 'free');
END;
$$;

-- -----------------------------------------------------------------------------
-- get_initial_order_status
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_initial_order_status(p_restaurant_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  routing_mode text;
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
$$;

-- -----------------------------------------------------------------------------
-- calculate_order_total
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_order_total(p_order_id uuid)
  RETURNS numeric
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  order_total numeric;
BEGIN
  SELECT COALESCE(SUM(quantity * price), 0)
  INTO order_total
  FROM public.order_items
  WHERE order_id = p_order_id;

  RETURN order_total;
END;
$$;

-- -----------------------------------------------------------------------------
-- calculate_item_price
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_item_price(p_menu_item_id uuid, p_table_id uuid)
  RETURNS numeric
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
AS $$
DECLARE
  base_price numeric;
  multiplier numeric := 1.0;
BEGIN
  SELECT price INTO base_price
  FROM menu_items
  WHERE id = p_menu_item_id;

  IF base_price IS NULL THEN
    RAISE EXCEPTION 'Menu item not found: %', p_menu_item_id;
  END IF;

  SELECT COALESCE(f.price_multiplier, 1.0) INTO multiplier
  FROM tables t
  LEFT JOIN floors f ON t.floor_id = f.id
  WHERE t.id = p_table_id;

  RETURN base_price * multiplier;
END;
$$;

-- -----------------------------------------------------------------------------
-- calculate_item_prices_batch
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_item_prices_batch(p_items jsonb, p_table_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_multiplier numeric := 1.0;
  v_result     jsonb   := '[]'::jsonb;
  v_item       jsonb;
  v_final      numeric;
BEGIN
  SELECT COALESCE(f.price_multiplier, 1.0)
  INTO   v_multiplier
  FROM   tables t
  LEFT JOIN floors f ON f.id = t.floor_id
  WHERE  t.id = p_table_id;

  IF NOT FOUND THEN
    v_multiplier := 1.0;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_final := ROUND((v_item->>'base_price')::numeric * v_multiplier, 2);
    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_item->>'menu_item_id',
        'final_price',  v_final
      )
    );
  END LOOP;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------
-- generate_bill
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_bill(
  p_order_id       uuid,
  p_payment_method text    DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0,
  p_discount_note  text    DEFAULT NULL
)
  RETURNS TABLE(
    order_id     uuid,
    total_amount numeric,
    net_amount   numeric,
    billed_at    timestamptz,
    success      boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  calculated_total numeric;
  net_total        numeric;
  order_status     text;
  v_order_id       uuid;
  v_total_amount   numeric;
  v_net_amount     numeric;
  v_billed_at      timestamptz;
BEGIN
  IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('cash', 'card', 'upi') THEN
    RAISE EXCEPTION 'Invalid payment method: %. Must be cash, card, or upi', p_payment_method;
  END IF;

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
  net_total := GREATEST(calculated_total - COALESCE(p_discount_amount, 0), 0);

  UPDATE public.orders
  SET
    total_amount    = net_total,
    billed_at       = now(),
    payment_method  = COALESCE(p_payment_method, payment_method),
    discount_amount = COALESCE(p_discount_amount, 0),
    discount_note   = p_discount_note
  WHERE id = p_order_id
  RETURNING
    orders.id,
    orders.total_amount,
    orders.billed_at
  INTO
    v_order_id,
    v_total_amount,
    v_billed_at;

  order_id     := v_order_id;
  total_amount := calculated_total;
  net_amount   := v_total_amount;
  billed_at    := v_billed_at;
  success      := true;

  RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- check_table_has_unpaid_orders
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_table_has_unpaid_orders(
  p_table_id      uuid,
  p_customer_phone text DEFAULT NULL
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  IF p_customer_phone IS NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM orders
      WHERE table_id = p_table_id
        AND billed_at IS NULL
        AND status    != 'cancelled'
    );
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM orders
    WHERE table_id = p_table_id
      AND billed_at IS NULL
      AND status    != 'cancelled'
      AND (

        customer_phone IS NULL
        OR customer_phone != p_customer_phone
      )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- get_table_unpaid_orders
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_table_unpaid_orders(p_table_id uuid)
  RETURNS TABLE(
    order_id      uuid,
    status        text,
    customer_name text,
    customer_phone text,
    created_at    timestamptz,
    total_amount  numeric
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.status,
    o.customer_name,
    o.customer_phone,
    o.created_at,
    o.total_amount
  FROM orders o
  WHERE o.table_id = p_table_id
    AND o.billed_at IS NULL
    AND o.status   != 'cancelled'
  ORDER BY o.created_at DESC;
END;
$$;

-- -----------------------------------------------------------------------------
-- open_table_session
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_table_session(
  p_restaurant_id uuid,
  p_table_id      uuid,
  p_waiter_id     uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  SELECT id INTO v_session_id
  FROM public.table_sessions
  WHERE table_id = p_table_id
    AND closed_at IS NULL
  LIMIT 1;

  IF v_session_id IS NOT NULL THEN
    UPDATE public.table_sessions
    SET waiter_id = p_waiter_id
    WHERE id = v_session_id;
    RETURN v_session_id;
  END IF;

  INSERT INTO public.table_sessions (restaurant_id, table_id, waiter_id)
  VALUES (p_restaurant_id, p_table_id, p_waiter_id)
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- close_table_session
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_table_session(p_table_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.table_sessions
  SET closed_at = now()
  WHERE table_id = p_table_id
    AND closed_at IS NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- accept_order_atomic
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_order_atomic(p_order_id uuid, p_waiter_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  order_record RECORD;
  session_id   uuid;
BEGIN
  SELECT id, restaurant_id, table_id, waiter_id, status
  INTO order_record
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  IF order_record.status != 'pending_waiter' AND
     (order_record.waiter_id IS NOT NULL AND order_record.waiter_id != p_waiter_id) THEN
    RAISE EXCEPTION 'Order % cannot be accepted by waiter %', p_order_id, p_waiter_id;
  END IF;

  BEGIN
    session_id := open_table_session(
      order_record.restaurant_id,
      order_record.table_id,
      p_waiter_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Cannot accept order: %', SQLERRM;
  END;

  UPDATE orders
  SET waiter_id = p_waiter_id, status = 'confirmed'
  WHERE id = p_order_id;

  RETURN TRUE;
END;
$$;

-- -----------------------------------------------------------------------------
-- assign_order_to_waiter
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_order_to_waiter(p_order_id uuid, p_waiter_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  order_record RECORD;
  session_id   uuid;
BEGIN
  SELECT id, restaurant_id, table_id, waiter_id, status
  INTO order_record
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  IF order_record.waiter_id IS NOT NULL THEN
    RAISE EXCEPTION 'Order % is already assigned to waiter %', p_order_id, order_record.waiter_id;
  END IF;

  IF order_record.status NOT IN ('pending_waiter', 'confirmed', 'ready') THEN
    RAISE EXCEPTION 'Order % cannot be assigned in status %', p_order_id, order_record.status;
  END IF;

  BEGIN
    session_id := open_table_session(
      order_record.restaurant_id,
      order_record.table_id,
      p_waiter_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Cannot assign order: %', SQLERRM;
  END;

  UPDATE orders
  SET waiter_id = p_waiter_id
  WHERE id = p_order_id;

  RETURN TRUE;
END;
$$;

-- -----------------------------------------------------------------------------
-- validate_coupon
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_coupon(
  p_code          text,
  p_plan          text,
  p_restaurant_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_coupon       public.coupons%ROWTYPE;
  v_already_used boolean;
  v_base_plan    text;
BEGIN
  p_code := upper(trim(p_code));
  v_base_plan := regexp_replace(p_plan, '_(monthly|yearly)$', '');

  SELECT * INTO v_coupon FROM public.coupons WHERE code = p_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Coupon not found');
  END IF;

  IF NOT v_coupon.is_active THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Coupon is inactive');
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Coupon has expired');
  END IF;

  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Coupon usage limit reached');
  END IF;

  IF NOT (v_base_plan = ANY(v_coupon.applicable_plans)) THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Coupon not valid for this plan');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.coupon_usages
    WHERE coupon_id = v_coupon.id AND restaurant_id = p_restaurant_id
  ) INTO v_already_used;

  IF v_already_used THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Coupon already used by this account');
  END IF;

  RETURN jsonb_build_object(
    'valid',         true,
    'coupon_id',     v_coupon.id,
    'type',          v_coupon.type,
    'value',         v_coupon.value,
    'duration_days', v_coupon.duration_days
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- record_coupon_usage
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_coupon_usage(p_coupon_id uuid, p_restaurant_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_lock_key      bigint;
  v_rows_inserted int;
BEGIN
  v_lock_key := ('x' || substr(replace(p_coupon_id::text, '-', ''), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF EXISTS (
    SELECT 1 FROM public.coupons
    WHERE id = p_coupon_id
      AND max_uses IS NOT NULL
      AND used_count >= max_uses
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.coupon_usages (coupon_id, restaurant_id)
  VALUES (p_coupon_id, p_restaurant_id)
  ON CONFLICT (coupon_id, restaurant_id) DO NOTHING;

  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

  IF v_rows_inserted > 0 THEN
    UPDATE public.coupons
    SET used_count = used_count + 1
    WHERE id = p_coupon_id;
  END IF;

  RETURN true;
END;
$$;

-- -----------------------------------------------------------------------------
-- onboard_restaurant
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.onboard_restaurant(
  p_auth_id    uuid,
  p_name       text,
  p_email      text,
  p_owner_name text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_restaurant_id uuid;
  v_floor_id      uuid;
  v_user_id       uuid;
BEGIN
  SELECT u.restaurant_id INTO v_restaurant_id
  FROM public.users u
  WHERE u.auth_id = p_auth_id
  LIMIT 1;

  IF v_restaurant_id IS NOT NULL THEN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id LIMIT 1;
    SELECT id INTO v_floor_id FROM public.floors WHERE restaurant_id = v_restaurant_id LIMIT 1;
    RETURN jsonb_build_object(
      'restaurant_id', v_restaurant_id,
      'user_id',       v_user_id,
      'floor_id',      v_floor_id
    );
  END IF;

  INSERT INTO public.restaurants (name, owner_id)
  VALUES (p_name, p_auth_id)
  RETURNING id INTO v_restaurant_id;

  INSERT INTO public.floors (restaurant_id, name, price_multiplier)
  VALUES (v_restaurant_id, 'Main Floor', 1.0)
  RETURNING id INTO v_floor_id;

  INSERT INTO public.tables (restaurant_id, table_number, floor_id, capacity)
  SELECT v_restaurant_id, n, v_floor_id, 4
  FROM generate_series(1, 5) AS n;

  INSERT INTO public.users (auth_id, email, name, role, restaurant_id, is_active)
  VALUES (p_auth_id, p_email, p_owner_name, 'manager', v_restaurant_id, true)
  RETURNING id INTO v_user_id;

  INSERT INTO public.subscriptions (
    restaurant_id, plan, status, trial_used, current_period_end
  ) VALUES (
    v_restaurant_id, 'pro', 'trialing', true,
    now() + INTERVAL '7 days'
  )
  ON CONFLICT (restaurant_id) DO NOTHING;

  RETURN jsonb_build_object(
    'restaurant_id', v_restaurant_id,
    'user_id',       v_user_id,
    'floor_id',      v_floor_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- auto_confirm_pending_orders (called by cron)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_confirm_pending_orders()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.orders o
  SET
    status       = 'confirmed',
    confirmed_at = now()
  FROM public.restaurants r
  WHERE
    r.id = o.restaurant_id
    AND r.auto_confirm_minutes IS NOT NULL
    AND r.auto_confirm_minutes > 0
    AND o.status = 'pending'
    AND o.created_at < now() - (r.auto_confirm_minutes || ' minutes')::interval;
END;
$$;

-- -----------------------------------------------------------------------------
-- set_updated_at (generic trigger helper)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- update_coupon_updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_coupon_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
