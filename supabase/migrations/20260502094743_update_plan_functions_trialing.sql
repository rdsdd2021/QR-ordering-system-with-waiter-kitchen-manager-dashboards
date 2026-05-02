-- Migration: update_plan_functions_trialing
-- Updates get_plan_limits() and get_restaurant_plan() Postgres functions
-- to use 'trialing' instead of 'free' as the default/fallback plan value.

-- Update get_plan_limits(): rename WHEN 'free' branch to WHEN 'trialing'
CREATE OR REPLACE FUNCTION public.get_plan_limits(p_plan text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT CASE p_plan
    WHEN 'trialing' THEN '{"max_tables": 5, "max_menu_items": 20, "analytics": false, "advanced_features": false}'::jsonb
    WHEN 'pro'      THEN '{"max_tables": 999, "max_menu_items": 999, "analytics": true, "advanced_features": true}'::jsonb
    ELSE                 '{"max_tables": 5, "max_menu_items": 20, "analytics": false, "advanced_features": false}'::jsonb
  END;
$$;

-- Update get_restaurant_plan(): change COALESCE fallback from 'free' to 'trialing'
CREATE OR REPLACE FUNCTION public.get_restaurant_plan(p_restaurant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plan TEXT;
BEGIN
  SELECT COALESCE(s.plan, 'trialing')
  INTO v_plan
  FROM public.restaurants r
  LEFT JOIN public.subscriptions s
    ON s.restaurant_id = r.id AND s.status IN ('active', 'trialing')
  WHERE r.id = p_restaurant_id;

  RETURN COALESCE(v_plan, 'trialing');
END;
$$;
