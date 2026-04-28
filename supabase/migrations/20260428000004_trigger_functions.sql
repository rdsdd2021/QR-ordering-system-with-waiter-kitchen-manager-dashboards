-- =============================================================================
-- SEGMENT 4: Trigger Functions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- validate_order_status_transition
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  allowed_transitions jsonb := '{
    "pending":        ["confirmed"],
    "pending_waiter": ["confirmed"],
    "confirmed":      ["preparing"],
    "preparing":      ["ready"],
    "ready":          ["served"],
    "served":         []
  }';
  allowed_next_statuses jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  allowed_next_statuses := allowed_transitions -> OLD.status;

  IF NOT (allowed_next_statuses ? NEW.status) THEN
    RAISE EXCEPTION 'Invalid status transition from % to %. Allowed transitions: %',
      OLD.status, NEW.status, allowed_next_statuses;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- update_order_timestamps
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_order_timestamps()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

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
      -- no-op
  END CASE;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- log_order_status_change
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_order_status_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    INSERT INTO public.order_status_logs (order_id, old_status, new_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.waiter_id);
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_status_logs (order_id, old_status, new_status, changed_by)
    VALUES (NEW.id, null, NEW.status, NEW.waiter_id);
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- auto_assign_waiter_from_session
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_assign_waiter_from_session()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_waiter_id uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.waiter_id IS NULL THEN
    SELECT waiter_id INTO v_waiter_id
    FROM public.table_sessions
    WHERE table_id = NEW.table_id
      AND closed_at IS NULL
    LIMIT 1;

    IF v_waiter_id IS NOT NULL THEN
      NEW.waiter_id := v_waiter_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- auto_assign_table_waiter
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_assign_table_waiter()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  _active_waiter_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' OR NEW.waiter_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT waiter_id INTO _active_waiter_id
  FROM public.orders
  WHERE table_id   = NEW.table_id
    AND waiter_id  IS NOT NULL
    AND billed_at  IS NULL
    AND id         <> NEW.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF _active_waiter_id IS NOT NULL THEN
    NEW.waiter_id := _active_waiter_id;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- broadcast_order_changes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.broadcast_order_changes()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  _restaurant_id uuid;
  _table_id      uuid;
  _payload       jsonb;
BEGIN
  -- Skip INSERT — handled by on_order_item_insert trigger after items are committed
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;

  _restaurant_id := coalesce(NEW.restaurant_id, OLD.restaurant_id);
  _table_id      := coalesce(NEW.table_id,      OLD.table_id);

  _payload := jsonb_build_object(
    'event',         TG_OP,
    'id',            coalesce(NEW.id,          OLD.id),
    'restaurant_id', _restaurant_id,
    'table_id',      _table_id,
    'status',        coalesce(NEW.status,      OLD.status),
    'waiter_id',     coalesce(NEW.waiter_id,   OLD.waiter_id),
    'total_amount',  coalesce(NEW.total_amount, OLD.total_amount),
    'created_at',    coalesce(NEW.created_at,  OLD.created_at)
  );

  PERFORM realtime.send(_payload, 'order_changed', 'kitchen:' || _restaurant_id::text, false);
  PERFORM realtime.send(_payload, 'order_changed', 'waiter:'  || _restaurant_id::text, false);
  PERFORM realtime.send(_payload, 'order_changed', 'manager:' || _restaurant_id::text, false);

  PERFORM realtime.send(
    jsonb_build_object(
      'event',        TG_OP,
      'id',           coalesce(NEW.id,   OLD.id),
      'status',       coalesce(NEW.status, OLD.status),
      'total_amount', coalesce(NEW.total_amount, OLD.total_amount)
    ),
    'order_changed',
    'customer:' || _restaurant_id::text || ':' || _table_id::text,
    false
  );

  RETURN coalesce(NEW, OLD);
END;
$$;

-- -----------------------------------------------------------------------------
-- broadcast_order_on_items_insert
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.broadcast_order_on_items_insert()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  _order      public.orders%ROWTYPE;
  _item_count int;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO _item_count FROM public.order_items WHERE order_id = NEW.order_id;
  IF _item_count <> 1 THEN RETURN NEW; END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'event',         'INSERT',
      'id',            _order.id,
      'restaurant_id', _order.restaurant_id,
      'table_id',      _order.table_id,
      'status',        _order.status,
      'waiter_id',     _order.waiter_id,
      'created_at',    _order.created_at
    ),
    'order_changed',
    'kitchen:' || _order.restaurant_id::text,
    false
  );

  PERFORM realtime.send(
    jsonb_build_object(
      'event',         'INSERT',
      'id',            _order.id,
      'restaurant_id', _order.restaurant_id,
      'table_id',      _order.table_id,
      'status',        _order.status,
      'waiter_id',     _order.waiter_id,
      'created_at',    _order.created_at
    ),
    'order_changed',
    'waiter:' || _order.restaurant_id::text,
    false
  );

  PERFORM realtime.send(
    jsonb_build_object(
      'event',         'INSERT',
      'id',            _order.id,
      'restaurant_id', _order.restaurant_id,
      'table_id',      _order.table_id,
      'status',        _order.status,
      'waiter_id',     _order.waiter_id,
      'created_at',    _order.created_at
    ),
    'order_changed',
    'manager:' || _order.restaurant_id::text,
    false
  );

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- create_default_subscription (fires on restaurant INSERT)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_default_subscription()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.subscriptions (restaurant_id, plan, status, trial_used, current_period_end)
  VALUES (NEW.id, 'pro', 'trialing', true, now() + INTERVAL '7 days')
  ON CONFLICT (restaurant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- rls_auto_enable (event trigger function)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$$;
