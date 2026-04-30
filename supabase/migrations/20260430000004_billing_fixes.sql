-- D1: generate_bill with optional force flag
-- D3: close_table_session only when ALL non-cancelled orders are billed
-- D4: atomic bill_table RPC

-- ── D1: generate_bill with force override ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_bill(
  p_order_id        uuid,
  p_payment_method  text    DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0,
  p_discount_note   text    DEFAULT NULL,
  p_force           boolean DEFAULT false
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

  SELECT status INTO order_status FROM public.orders WHERE id = p_order_id;

  IF order_status IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF order_status != 'served' THEN
    IF p_force AND order_status IN ('pending','pending_waiter','confirmed','preparing','ready') THEN
      UPDATE public.orders
      SET status = 'served', served_at = COALESCE(served_at, now())
      WHERE id = p_order_id;
      order_status := 'served';
    ELSE
      RAISE EXCEPTION 'Cannot bill order that is not served. Current status: %. Use force=true to override.', order_status;
    END IF;
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
  RETURNING orders.id, orders.total_amount, orders.billed_at
  INTO v_order_id, v_total_amount, v_billed_at;

  order_id     := v_order_id;
  total_amount := calculated_total;
  net_amount   := v_total_amount;
  billed_at    := v_billed_at;
  success      := true;

  RETURN NEXT;
END;
$$;

-- ── D3: close_table_session — correct condition ───────────────────────────────
CREATE OR REPLACE FUNCTION public.close_table_session(p_table_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE table_id  = p_table_id
      AND billed_at IS NULL
      AND status    NOT IN ('cancelled')
  ) THEN
    UPDATE public.table_sessions
    SET closed_at = now()
    WHERE table_id  = p_table_id
      AND closed_at IS NULL;
  END IF;
END;
$$;

-- ── D4: bill_table — atomic per-table billing ─────────────────────────────────
-- Fix: FOR UPDATE cannot be used with aggregate functions (array_agg).
-- Solution: lock rows in a subquery first, then aggregate the IDs.
CREATE OR REPLACE FUNCTION public.bill_table(
  p_table_id        uuid,
  p_payment_method  text    DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0,
  p_discount_note   text    DEFAULT NULL,
  p_force           boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_order         RECORD;
  v_order_share   numeric;
  v_net           numeric;
  v_gross_total   numeric := 0;
  v_billed_count  integer := 0;
  v_skipped_count integer := 0;
  v_results       jsonb   := '[]'::jsonb;
  v_order_ids     uuid[];
BEGIN
  IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('cash', 'card', 'upi') THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
  END IF;

  -- Lock rows in a subquery, then aggregate — FOR UPDATE is not allowed
  -- directly alongside aggregate functions like array_agg().
  SELECT array_agg(id) INTO v_order_ids
  FROM (
    SELECT id
    FROM public.orders
    WHERE table_id = p_table_id
      AND billed_at IS NULL
      AND status NOT IN ('cancelled')
    FOR UPDATE
  ) locked_rows;

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) = 0 THEN
    -- No billable orders remain — but the session may still be open if every
    -- order was cancelled. Close it so the table is freed.
    UPDATE public.table_sessions
    SET closed_at = now()
    WHERE table_id  = p_table_id
      AND closed_at IS NULL;

    RETURN jsonb_build_object(
      'success',      true,
      'billed_count', 0,
      'skipped_count',0,
      'gross_total',  0,
      'net_total',    0,
      'orders',       '[]'::jsonb
    );
  END IF;

  -- First pass: compute gross total for discount proration
  FOR v_order IN
    SELECT id, status, public.calculate_order_total(id) AS order_total
    FROM public.orders WHERE id = ANY(v_order_ids)
  LOOP
    IF v_order.status = 'served'
       OR (p_force AND v_order.status IN ('pending','pending_waiter','confirmed','preparing','ready'))
    THEN
      v_gross_total := v_gross_total + v_order.order_total;
    END IF;
  END LOOP;

  -- Second pass: bill each order
  FOR v_order IN
    SELECT id, status, public.calculate_order_total(id) AS order_total
    FROM public.orders WHERE id = ANY(v_order_ids) ORDER BY created_at
  LOOP
    IF v_order.status != 'served' THEN
      IF p_force AND v_order.status IN ('pending','pending_waiter','confirmed','preparing','ready') THEN
        UPDATE public.orders
        SET status = 'served', served_at = COALESCE(served_at, now())
        WHERE id = v_order.id;
      ELSE
        v_skipped_count := v_skipped_count + 1;
        v_results := v_results || jsonb_build_array(
          jsonb_build_object('order_id', v_order.id, 'skipped', true, 'reason', 'not_served')
        );
        CONTINUE;
      END IF;
    END IF;

    v_order_share := CASE
      WHEN v_gross_total > 0
        THEN ROUND((v_order.order_total / v_gross_total) * p_discount_amount, 2)
      ELSE 0
    END;
    v_net := GREATEST(v_order.order_total - v_order_share, 0);

    UPDATE public.orders
    SET
      total_amount    = v_net,
      billed_at       = now(),
      payment_method  = p_payment_method,
      discount_amount = v_order_share,
      discount_note   = p_discount_note
    WHERE id = v_order.id;

    v_billed_count := v_billed_count + 1;
    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'order_id', v_order.id,
        'skipped',  false,
        'gross',    v_order.order_total,
        'discount', v_order_share,
        'net',      v_net
      )
    );
  END LOOP;

  -- Close session if all orders are now billed
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE table_id = p_table_id
      AND billed_at IS NULL
      AND status NOT IN ('cancelled')
  ) THEN
    UPDATE public.table_sessions
    SET closed_at = now()
    WHERE table_id = p_table_id AND closed_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'success',      true,
    'billed_count', v_billed_count,
    'skipped_count',v_skipped_count,
    'gross_total',  v_gross_total,
    'net_total',    GREATEST(v_gross_total - p_discount_amount, 0),
    'orders',       v_results
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_bill(uuid, text, numeric, text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bill_table(uuid, text, numeric, text, boolean)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_table_session(uuid)                         TO anon, authenticated, service_role;
