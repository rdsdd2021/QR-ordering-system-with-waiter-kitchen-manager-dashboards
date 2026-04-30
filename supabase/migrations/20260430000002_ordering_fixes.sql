-- B5: Add 'cancelled' to the orders status CHECK constraint
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status = ANY (ARRAY[
    'pending', 'pending_waiter', 'confirmed',
    'preparing', 'ready', 'served', 'cancelled'
  ]));

-- B6: Add CHECK constraint on party_size — must be between 1 and 50 when provided
ALTER TABLE public.orders
  ADD CONSTRAINT orders_party_size_check
  CHECK (party_size IS NULL OR (party_size >= 1 AND party_size <= 50));

-- B5: Allow anonymous customers to cancel their own orders,
-- but only while the order is still in a cancellable state.
CREATE POLICY "customers_can_cancel_pending_orders"
  ON public.orders FOR UPDATE
  TO anon, authenticated
  USING (
    status IN ('pending', 'pending_waiter')
  )
  WITH CHECK (
    status = 'cancelled'
  );
