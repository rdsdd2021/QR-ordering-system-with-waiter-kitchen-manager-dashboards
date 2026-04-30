-- Extend auto_assign_table_waiter to auto-assign the least-busy active waiter
-- when no session and no prior orders exist on the table (fresh/walk-in order).
--
-- Assignment priority:
--   1. Waiter from the open table_session  (handled by auto_assign_waiter_from_session)
--   2. Waiter already on another active order at this table  (existing tier 2)
--   3. Least-busy active waiter in the restaurant  (new tier 3 — this migration)
--
-- "Least busy" = fewest non-cancelled, unbilled, non-served orders assigned to them.
-- Tie-break is alphabetical by name for determinism.

CREATE OR REPLACE FUNCTION public.auto_assign_table_waiter()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  _active_waiter_id uuid;
BEGIN
  -- Only act on INSERT when no waiter has been assigned yet
  IF TG_OP <> 'INSERT' OR NEW.waiter_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Tier 2: inherit from another active order on the same table
  SELECT waiter_id INTO _active_waiter_id
  FROM public.orders
  WHERE table_id  = NEW.table_id
    AND waiter_id IS NOT NULL
    AND billed_at IS NULL
    AND status    != 'cancelled'
    AND id        <> NEW.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF _active_waiter_id IS NOT NULL THEN
    NEW.waiter_id := _active_waiter_id;
    RETURN NEW;
  END IF;

  -- Tier 3: assign the least-busy active waiter in the restaurant
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
