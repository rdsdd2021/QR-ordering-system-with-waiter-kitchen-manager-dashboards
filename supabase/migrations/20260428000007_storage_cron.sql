-- =============================================================================
-- SEGMENT 7: Storage Buckets, Storage RLS, and Cron Jobs
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Storage Buckets
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('menu-images',      'menu-images',      true,  5242880,  ARRAY['image/jpeg','image/png','image/webp','image/gif']),
  ('restaurant-logos', 'restaurant-logos', true,  2097152,  ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Storage RLS: menu-images
-- -----------------------------------------------------------------------------

CREATE POLICY "Public can view menu images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'menu-images');

CREATE POLICY "Authenticated users can upload menu images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'menu-images');

CREATE POLICY "Authenticated users can update menu images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'menu-images');

CREATE POLICY "Authenticated users can delete menu images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'menu-images');

-- -----------------------------------------------------------------------------
-- Storage RLS: restaurant-logos
-- -----------------------------------------------------------------------------

CREATE POLICY "Public read restaurant logos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'restaurant-logos');

CREATE POLICY "Authenticated upload restaurant logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'restaurant-logos');

CREATE POLICY "Authenticated update restaurant logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'restaurant-logos');

CREATE POLICY "Authenticated delete restaurant logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'restaurant-logos');

-- -----------------------------------------------------------------------------
-- Cron Jobs
-- -----------------------------------------------------------------------------

-- Job 1: auto-confirm pending orders via the dedicated function
SELECT cron.schedule(
  'auto-confirm-orders-fn',
  '* * * * *',
  $$SELECT public.auto_confirm_pending_orders()$$
);

-- Job 2: inline auto-confirm (legacy duplicate — kept for compatibility)
SELECT cron.schedule(
  'auto-confirm-orders-inline',
  '* * * * *',
  $$
  UPDATE orders
  SET
    status       = 'confirmed',
    confirmed_at = now()
  WHERE
    status = 'pending'
    AND restaurant_id IN (
      SELECT id FROM restaurants
      WHERE auto_confirm_minutes IS NOT NULL
        AND auto_confirm_minutes > 0
    )
    AND created_at <= now() - (
      SELECT (auto_confirm_minutes || ' minutes')::interval
      FROM restaurants
      WHERE id = orders.restaurant_id
    );
  $$
);
