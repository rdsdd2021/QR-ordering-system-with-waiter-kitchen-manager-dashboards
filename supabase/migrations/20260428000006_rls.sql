-- =============================================================================
-- SEGMENT 6: Row Level Security — Enable + Policies
-- =============================================================================

-- Enable RLS on all public tables
ALTER TABLE public.restaurants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_tags           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_tags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_suggestions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_usages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries  ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- restaurants
-- =============================================================================

CREATE POLICY "Anyone can read active restaurants"
  ON public.restaurants FOR SELECT
  TO public
  USING (is_active = true);

CREATE POLICY "super_admins_read_all_restaurants"
  ON public.restaurants FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
        AND users.is_super_admin = true
    )
  );

CREATE POLICY "Authenticated users can create restaurants"
  ON public.restaurants FOR INSERT
  TO public
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Managers can update their restaurant"
  ON public.restaurants FOR UPDATE
  TO public
  USING (
    id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
        AND users.role = 'manager'
    )
  );

-- =============================================================================
-- users
-- =============================================================================

CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

CREATE POLICY "users_select_restaurant"
  ON public.users FOR SELECT
  TO authenticated
  USING (restaurant_id = get_current_user_restaurant());

CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "managers_can_insert_staff"
  ON public.users FOR INSERT
  TO public
  WITH CHECK (
    restaurant_id IN (
      SELECT users_1.restaurant_id FROM users users_1
      WHERE users_1.auth_id = auth.uid()
        AND users_1.role = 'manager'
    )
  );

CREATE POLICY "managers_can_update_staff"
  ON public.users FOR UPDATE
  TO public
  USING (
    restaurant_id IN (
      SELECT users_1.restaurant_id FROM users users_1
      WHERE users_1.auth_id = auth.uid()
        AND users_1.role = 'manager'
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT users_1.restaurant_id FROM users users_1
      WHERE users_1.auth_id = auth.uid()
        AND users_1.role = 'manager'
    )
  );

CREATE POLICY "managers_can_delete_staff"
  ON public.users FOR DELETE
  TO public
  USING (
    restaurant_id IN (
      SELECT users_1.restaurant_id FROM users users_1
      WHERE users_1.auth_id = auth.uid()
        AND users_1.role = 'manager'
    )
  );

-- =============================================================================
-- floors
-- =============================================================================

CREATE POLICY "anyone_can_read_floors"
  ON public.floors FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "managers_can_manage_floors"
  ON public.floors FOR ALL
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
        AND users.role = 'manager'
    )
  );

-- =============================================================================
-- tables
-- =============================================================================

CREATE POLICY "Public can read tables"
  ON public.tables FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Users can read own restaurant tables"
  ON public.tables FOR SELECT
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
    )
  );

CREATE POLICY "Managers can manage tables"
  ON public.tables FOR ALL
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
        AND users.role = 'manager'
    )
  );

-- =============================================================================
-- menu_items
-- =============================================================================

CREATE POLICY "Public can read available menu items"
  ON public.menu_items FOR SELECT
  TO public
  USING (is_available = true);

CREATE POLICY "Anyone can read available menu items"
  ON public.menu_items FOR SELECT
  TO anon, authenticated
  USING (is_available = true);

CREATE POLICY "Users can read own restaurant menu"
  ON public.menu_items FOR SELECT
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
    )
  );

CREATE POLICY "Managers can manage menu items"
  ON public.menu_items FOR ALL
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
        AND users.role = 'manager'
    )
  );

-- =============================================================================
-- orders
-- =============================================================================

CREATE POLICY "Public can read orders"
  ON public.orders FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Users can read own restaurant orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
    )
  );

CREATE POLICY "Anyone can create orders"
  ON public.orders FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Public can insert orders"
  ON public.orders FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Public can update order status"
  ON public.orders FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Kitchen and waiters can update orders"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
        AND users.role = ANY (ARRAY['kitchen','waiter','manager'])
    )
  );

-- =============================================================================
-- order_items
-- =============================================================================

CREATE POLICY "Public can read order_items"
  ON public.order_items FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Users can read own restaurant order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (
    order_id IN (
      SELECT orders.id FROM orders
      WHERE orders.restaurant_id IN (
        SELECT users.restaurant_id FROM users
        WHERE users.auth_id = auth.uid()
      )
    )
  );

CREATE POLICY "Public can insert order items"
  ON public.order_items FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Anyone can create order items"
  ON public.order_items FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- =============================================================================
-- order_status_logs
-- =============================================================================

CREATE POLICY "Public can view order status logs"
  ON public.order_status_logs FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Users can read own restaurant order logs"
  ON public.order_status_logs FOR SELECT
  TO authenticated
  USING (
    order_id IN (
      SELECT orders.id FROM orders
      WHERE orders.restaurant_id IN (
        SELECT users.restaurant_id FROM users
        WHERE users.auth_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- table_sessions
-- =============================================================================

CREATE POLICY "restaurant_staff_can_read_sessions"
  ON public.table_sessions FOR SELECT
  TO public
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
    )
  );

CREATE POLICY "waiters_can_open_sessions"
  ON public.table_sessions FOR INSERT
  TO public
  WITH CHECK (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
    )
  );

CREATE POLICY "staff_can_close_sessions"
  ON public.table_sessions FOR UPDATE
  TO public
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
    )
  );

-- =============================================================================
-- reviews
-- =============================================================================

CREATE POLICY "anyone_can_read_reviews"
  ON public.reviews FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "authenticated_can_create_reviews"
  ON public.reviews FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =============================================================================
-- food_categories
-- =============================================================================

CREATE POLICY "food_categories_read"
  ON public.food_categories FOR SELECT
  TO public
  USING (true);

CREATE POLICY "food_categories_write"
  ON public.food_categories FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.auth_id = auth.uid()
        AND u.restaurant_id = food_categories.restaurant_id
        AND u.role = 'manager'
    )
  );

-- =============================================================================
-- food_tags
-- =============================================================================

CREATE POLICY "food_tags_read"
  ON public.food_tags FOR SELECT
  TO public
  USING (true);

CREATE POLICY "food_tags_write"
  ON public.food_tags FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.auth_id = auth.uid()
        AND u.restaurant_id = food_tags.restaurant_id
        AND u.role = 'manager'
    )
  );

-- =============================================================================
-- menu_item_categories
-- =============================================================================

CREATE POLICY "menu_item_categories_read"
  ON public.menu_item_categories FOR SELECT
  TO public
  USING (true);

CREATE POLICY "menu_item_categories_write"
  ON public.menu_item_categories FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM menu_items mi
      JOIN users u ON u.restaurant_id = mi.restaurant_id
      WHERE mi.id = menu_item_categories.menu_item_id
        AND u.auth_id = auth.uid()
        AND u.role = 'manager'
    )
  );

-- =============================================================================
-- menu_item_tags
-- =============================================================================

CREATE POLICY "menu_item_tags_read"
  ON public.menu_item_tags FOR SELECT
  TO public
  USING (true);

CREATE POLICY "menu_item_tags_write"
  ON public.menu_item_tags FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM menu_items mi
      JOIN users u ON u.restaurant_id = mi.restaurant_id
      WHERE mi.id = menu_item_tags.menu_item_id
        AND u.auth_id = auth.uid()
        AND u.role = 'manager'
    )
  );

-- =============================================================================
-- category_suggestions
-- =============================================================================

CREATE POLICY "category_suggestions_read"
  ON public.category_suggestions FOR SELECT
  TO public
  USING (true);

-- =============================================================================
-- tag_suggestions
-- =============================================================================

CREATE POLICY "tag_suggestions_read"
  ON public.tag_suggestions FOR SELECT
  TO public
  USING (true);

-- =============================================================================
-- coupons
-- =============================================================================

CREATE POLICY "coupons_read_active"
  ON public.coupons FOR SELECT
  TO public
  USING (is_active = true);

CREATE POLICY "coupons_service_all"
  ON public.coupons FOR ALL
  TO public
  USING (auth.role() = 'service_role');

-- =============================================================================
-- coupon_usages
-- =============================================================================

CREATE POLICY "coupon_usages_service_all"
  ON public.coupon_usages FOR ALL
  TO public
  USING (auth.role() = 'service_role');

-- =============================================================================
-- subscriptions
-- =============================================================================

CREATE POLICY "managers_read_own_subscription"
  ON public.subscriptions FOR SELECT
  TO public
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
        AND users.role = 'manager'
    )
  );

-- =============================================================================
-- payment_transactions
-- =============================================================================

CREATE POLICY "manager_read_own_transactions"
  ON public.payment_transactions FOR SELECT
  TO public
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
        AND users.role = ANY (ARRAY['manager','owner'])
    )
  );

-- =============================================================================
-- plans
-- =============================================================================

CREATE POLICY "plans_public_read"
  ON public.plans FOR SELECT
  TO public
  USING (is_active = true);

CREATE POLICY "plans_service_all"
  ON public.plans FOR ALL
  TO public
  USING (auth.role() = 'service_role');

-- =============================================================================
-- webhook_endpoints
-- =============================================================================

CREATE POLICY "managers_manage_own_endpoints"
  ON public.webhook_endpoints FOR ALL
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT users.restaurant_id FROM users
      WHERE users.auth_id = auth.uid()
        AND users.role = 'manager'
    )
  );

CREATE POLICY "service_role_manage_endpoints"
  ON public.webhook_endpoints FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- webhook_deliveries
-- =============================================================================

CREATE POLICY "managers_read_own_deliveries"
  ON public.webhook_deliveries FOR SELECT
  TO authenticated
  USING (
    endpoint_id IN (
      SELECT we.id
      FROM webhook_endpoints we
      JOIN users u ON u.restaurant_id = we.restaurant_id
      WHERE u.auth_id = auth.uid()
        AND u.role = 'manager'
    )
  );

CREATE POLICY "service_role_write_deliveries"
  ON public.webhook_deliveries FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
