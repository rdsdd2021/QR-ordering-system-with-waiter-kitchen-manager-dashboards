-- =============================================================================
-- SEGMENT 5: Triggers
-- =============================================================================

-- coupons: updated_at
CREATE TRIGGER trg_coupons_updated_at
  BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.update_coupon_updated_at();

-- plans: updated_at
CREATE TRIGGER plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- webhook_endpoints: updated_at
CREATE TRIGGER trg_webhook_endpoints_updated_at
  BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- restaurants: create default subscription on insert
CREATE TRIGGER on_restaurant_created
  AFTER INSERT ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.create_default_subscription();

-- orders: validate status transition (BEFORE INSERT/UPDATE)
CREATE TRIGGER validate_order_status_transition
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_order_status_transition();

-- orders: set status timestamps (BEFORE INSERT/UPDATE)
CREATE TRIGGER update_order_timestamps_trigger
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_order_timestamps();

-- orders: auto-assign waiter from active session (BEFORE INSERT)
CREATE TRIGGER auto_assign_waiter_from_session
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_waiter_from_session();

-- orders: auto-assign waiter from previous unbilled order (BEFORE INSERT)
CREATE TRIGGER auto_assign_table_waiter_trigger
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_table_waiter();

-- orders: log status changes (AFTER INSERT/UPDATE)
CREATE TRIGGER log_order_status_change
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();

-- orders: broadcast updates to realtime channels (AFTER INSERT/UPDATE)
CREATE TRIGGER orders_broadcast_trigger
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_order_changes();

-- order_items: broadcast new order to realtime on first item insert (AFTER INSERT)
CREATE TRIGGER on_order_item_insert
  AFTER INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_order_on_items_insert();

-- -----------------------------------------------------------------------------
-- Event trigger: auto-enable RLS on new public tables
-- -----------------------------------------------------------------------------
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();
