-- G1: Drop the public UPDATE policy that allows anyone to modify any order
DROP POLICY IF EXISTS "Public can update order status" ON public.orders;
DROP POLICY IF EXISTS "Public can update restaurants"  ON public.restaurants;

-- G2: Drop unscoped order_items INSERT policies, replace with scoped one
DROP POLICY IF EXISTS "Public can insert order items" ON public.order_items;
DROP POLICY IF EXISTS "Anyone can create order items" ON public.order_items;

-- New scoped policy: only allow inserting items for existing unbilled orders
CREATE POLICY "anon_can_insert_order_items_for_valid_orders"
  ON public.order_items FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND orders.billed_at IS NULL
    )
  );

-- G3: Restrict restaurants INSERT to service_role only
-- onboard_restaurant() RPC runs as SECURITY DEFINER so onboarding still works
DROP POLICY IF EXISTS "Authenticated users can create restaurants" ON public.restaurants;

CREATE POLICY "service_role_can_create_restaurants"
  ON public.restaurants FOR INSERT
  TO service_role
  WITH CHECK (true);
