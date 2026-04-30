-- Fix: both INSERT triggers must respect waiter_assignment_mode.
-- In 'broadcast' mode, orders stay unassigned at INSERT time so all waiters
-- can see and accept them. The confirm trigger handles assignment on confirmation
-- in 'auto_assign' mode.

-- ── auto_assign_waiter_from_session ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_assign_waiter_from_session()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_waiter_id       uuid;
  v_assignment_mode text;
BEGIN
  IF TG_OP != 'INSERT' OR NEW.waiter_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT waiter_assignment_mode INTO v_assignment_mode
  FROM public.restaurants WHERE id = NEW.restaurant_id;

  IF v_assignment_mode = 'broadcast' THEN
    RETURN NEW;
  END IF;

  SELECT waiter_id INTO v_waiter_id
  FROM public.table_sessions
  WHERE table_id  = NEW.table_id
    AND closed_at IS NULL
  LIMIT 1;

  IF v_waiter_id IS NOT NULL THEN
    NEW.waiter_id := v_waiter_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ── auto_assign_table_waiter ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_assign_table_waiter()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  _active_waiter_id uuid;
  _assignment_mode  text;
BEGIN
  IF TG_OP != 'INSERT' OR NEW.waiter_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT waiter_assignment_mode INTO _assignment_mode
  FROM public.restaurants WHERE id = NEW.restaurant_id;

  IF _assignment_mode = 'broadcast' THEN
    RETURN NEW;
  END IF;

  -- Tier 2: inherit from another active order on the same table
  SELECT waiter_id INTO _active_waiter_id
  FROM public.orders
  WHERE table_id  = NEW.table_id
    AND waiter_id IS NOT NULL
    AND billed_at IS NULL
    AND status    != 'cancelled'
    AND id        != NEW.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF _active_waiter_id IS NOT NULL THEN
    NEW.waiter_id := _active_waiter_id;
    RETURN NEW;
  END IF;

  -- Tier 3: least-busy active waiter in the restaurant
  SELECT u.id INTO _active_waiter_id
  FROM public.users u
  LEFT JOIN public.orders o
    ON  o.waiter_id = u.id
    AND o.billed_at IS NULL
    AND o.status    NOT IN ('served', 'cancelled')
  WHERE u.restaurant_id = NEW.restaurant_id
    AND u.role          = 'waiter'
    AND u.is_active     = true
  GROUP BY u.id
  ORDER BY COUNT(o.id) ASC, u.name ASC
  LIMIT 1;

  IF _active_waiter_id IS NOT NULL THEN
    NEW.waiter_id := _active_waiter_id;
  END IF;

  RETURN NEW;
END;
$$;
