-- C1: Allow cancellation from pending/pending_waiter/confirmed in the DB trigger.
-- Kitchen can reject orders that are stuck or have unavailable items.
-- C2: When routing mode switches to direct_to_kitchen, migrate orphaned
--     pending_waiter orders to pending so the kitchen sees them.

-- ── C1: Update status transition validator ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  allowed_transitions jsonb := '{
    "pending":        ["confirmed", "cancelled"],
    "pending_waiter": ["confirmed", "cancelled"],
    "confirmed":      ["preparing", "cancelled"],
    "preparing":      ["ready"],
    "ready":          ["served"],
    "served":         [],
    "cancelled":      []
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

  IF allowed_next_statuses IS NULL OR NOT (allowed_next_statuses ? NEW.status) THEN
    RAISE EXCEPTION 'Invalid status transition from % to %. Allowed: %',
      OLD.status, NEW.status, allowed_next_statuses;
  END IF;

  RETURN NEW;
END;
$$;

-- ── C2: Function to migrate orphaned pending_waiter orders ────────────────────
CREATE OR REPLACE FUNCTION public.migrate_pending_waiter_orders(p_restaurant_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.orders
  SET status = 'pending'
  WHERE restaurant_id = p_restaurant_id
    AND status = 'pending_waiter'
    AND billed_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.migrate_pending_waiter_orders(uuid) TO authenticated, service_role;
