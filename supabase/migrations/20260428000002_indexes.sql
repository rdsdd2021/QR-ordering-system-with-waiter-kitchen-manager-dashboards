-- =============================================================================
-- SEGMENT 2: Indexes
-- =============================================================================

-- restaurants
-- (slug unique index already created by UNIQUE constraint)

-- users
CREATE INDEX idx_users_auth_id           ON public.users (auth_id);
CREATE INDEX idx_users_email             ON public.users (email);
CREATE INDEX idx_users_active            ON public.users (is_active) WHERE is_active = true;
CREATE INDEX users_restaurant_id_role_idx ON public.users (restaurant_id, role);

-- floors
CREATE INDEX idx_floors_restaurant ON public.floors (restaurant_id);

-- tables
CREATE INDEX tables_restaurant_id_idx ON public.tables (restaurant_id);
CREATE INDEX idx_tables_floor         ON public.tables (floor_id);

-- menu_items
CREATE INDEX menu_items_restaurant_id_is_available_idx ON public.menu_items (restaurant_id, is_available);

-- orders
CREATE INDEX orders_restaurant_id_table_id_idx     ON public.orders (restaurant_id, table_id);
CREATE INDEX orders_status_restaurant_id_idx        ON public.orders (status, restaurant_id);
CREATE INDEX idx_orders_status_restaurant           ON public.orders (status, restaurant_id);
CREATE INDEX orders_waiter_id_idx                   ON public.orders (waiter_id);
CREATE INDEX idx_orders_billed_at                   ON public.orders (restaurant_id, billed_at) WHERE billed_at IS NULL;
CREATE INDEX idx_orders_pending_waiter              ON public.orders (restaurant_id, status) WHERE status = 'pending_waiter';
CREATE INDEX idx_orders_served_unbilled             ON public.orders (restaurant_id, status, billed_at) WHERE status = 'served' AND billed_at IS NULL;
CREATE INDEX idx_orders_customer_phone              ON public.orders (customer_phone) WHERE customer_phone IS NOT NULL;
CREATE INDEX idx_orders_customer_phone_created_at   ON public.orders (customer_phone, created_at DESC) WHERE customer_phone IS NOT NULL;
CREATE INDEX idx_orders_timestamps                  ON public.orders (created_at, confirmed_at, preparing_at, ready_at, served_at);

-- order_items
CREATE INDEX order_items_order_id_idx ON public.order_items (order_id);

-- order_status_logs
CREATE INDEX order_status_logs_order_id_idx   ON public.order_status_logs (order_id);
CREATE INDEX order_status_logs_created_at_idx ON public.order_status_logs (created_at);

-- table_sessions
CREATE INDEX idx_table_sessions_restaurant ON public.table_sessions (restaurant_id);
CREATE INDEX idx_table_sessions_table_id   ON public.table_sessions (table_id);
CREATE INDEX idx_table_sessions_waiter_id  ON public.table_sessions (waiter_id);

-- reviews
CREATE INDEX idx_reviews_menu_item ON public.reviews (menu_item_id);
CREATE INDEX idx_reviews_created   ON public.reviews (created_at DESC);

-- food_categories
CREATE INDEX idx_food_categories_restaurant ON public.food_categories (restaurant_id);
CREATE INDEX idx_food_categories_parent     ON public.food_categories (parent_id);

-- food_tags
CREATE INDEX idx_food_tags_restaurant ON public.food_tags (restaurant_id);

-- menu_item_categories
CREATE INDEX idx_mic_category ON public.menu_item_categories (category_id);

-- menu_item_tags
CREATE INDEX idx_mit_tag ON public.menu_item_tags (tag_id);

-- coupons
CREATE INDEX idx_coupons_code   ON public.coupons (code);
CREATE INDEX idx_coupons_active ON public.coupons (is_active) WHERE is_active = true;

-- coupon_usages
CREATE INDEX idx_coupon_usages_coupon     ON public.coupon_usages (coupon_id);
CREATE INDEX idx_coupon_usages_restaurant ON public.coupon_usages (restaurant_id);

-- subscriptions
CREATE INDEX idx_subscriptions_restaurant      ON public.subscriptions (restaurant_id);
CREATE INDEX idx_subscriptions_stripe_customer ON public.subscriptions (phonepe_customer_id);

-- payment_transactions
CREATE INDEX idx_payment_transactions_restaurant ON public.payment_transactions (restaurant_id, created_at DESC);

-- webhook_endpoints
CREATE INDEX idx_webhook_endpoints_restaurant ON public.webhook_endpoints (restaurant_id);

-- webhook_deliveries
CREATE INDEX idx_webhook_deliveries_endpoint  ON public.webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX idx_webhook_deliveries_event_id  ON public.webhook_deliveries (event_id);
CREATE INDEX idx_webhook_deliveries_status    ON public.webhook_deliveries (status, next_retry_at)
  WHERE status = ANY (ARRAY['pending', 'retrying']);
