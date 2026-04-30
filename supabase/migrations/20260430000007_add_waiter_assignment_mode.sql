-- Add waiter_assignment_mode to restaurants.
-- 'auto_assign' (default): when an order is confirmed, auto-assign the least-busy active waiter.
-- 'broadcast':             order stays unassigned in pending_waiter; appears on all waiters'
--                          dashboards until one accepts it (first-come-first-served).

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS waiter_assignment_mode text
    NOT NULL DEFAULT 'auto_assign'
    CHECK (waiter_assignment_mode IN ('auto_assign', 'broadcast'));

COMMENT ON COLUMN public.restaurants.waiter_assignment_mode IS
  'auto_assign: confirmed orders are auto-assigned to the least-busy waiter. '
  'broadcast: pending_waiter orders are visible to all waiters until one accepts.';

-- ── Trigger: auto-assign waiter when order is confirmed ───────────────────────
-- Fires BEFORE UPDATE. When status → 'confirmed' and waiter_id IS NULL and
-- restaurant is in auto_assign mode, picks the least-busy active waiter.

CREATE OR REPLACE FUNCTION public.auto_assign_waiter_on_confirm()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  _mode             text;
  _assigned_waiter  uuid;
BEGIN
  IF NEW.status != 'confirmed' OR OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;
  IF NEW.waiter_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT waiter_assignment_mode INTO _mode
  FROM public.restaurants WHERE id = NEW.restaurant_id;

  IF _mode IS DISTINCT FROM 'auto_assign' THEN
    RETURN NEW;
  END IF;

  SELECT u.id INTO _assigned_waiter
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

  IF _assigned_waiter IS NOT NULL THEN
    NEW.waiter_id := _assigned_waiter;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_waiter_on_confirm ON public.orders;
CREATE TRIGGER trg_auto_assign_waiter_on_confirm
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_waiter_on_confirm();
