-- ── H3: Set REPLICA IDENTITY FULL on all tables used with postgres_changes ────
ALTER TABLE public.subscriptions  REPLICA IDENTITY FULL;
ALTER TABLE public.users          REPLICA IDENTITY FULL;
ALTER TABLE public.audit_logs     REPLICA IDENTITY FULL;
ALTER TABLE public.restaurants    REPLICA IDENTITY FULL;
ALTER TABLE public.tables         REPLICA IDENTITY FULL;

-- ── H2: Remove _item_count guard from broadcast_order_on_items_insert ─────────
-- Broadcast on every item insert so partial batch failures don't silently
-- drop the notification. Client deduplicates via fetchingRef.
CREATE OR REPLACE FUNCTION public.broadcast_order_on_items_insert()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  _order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'event',         'INSERT',
      'id',            _order.id,
      'restaurant_id', _order.restaurant_id,
      'table_id',      _order.table_id,
      'status',        _order.status,
      'waiter_id',     _order.waiter_id,
      'created_at',    _order.created_at
    ),
    'order_changed',
    'kitchen:' || _order.restaurant_id::text,
    false
  );

  PERFORM realtime.send(
    jsonb_build_object(
      'event',         'INSERT',
      'id',            _order.id,
      'restaurant_id', _order.restaurant_id,
      'table_id',      _order.table_id,
      'status',        _order.status,
      'waiter_id',     _order.waiter_id,
      'created_at',    _order.created_at
    ),
    'order_changed',
    'waiter:' || _order.restaurant_id::text,
    false
  );

  PERFORM realtime.send(
    jsonb_build_object(
      'event',         'INSERT',
      'id',            _order.id,
      'restaurant_id', _order.restaurant_id,
      'table_id',      _order.table_id,
      'status',        _order.status,
      'waiter_id',     _order.waiter_id,
      'created_at',    _order.created_at
    ),
    'order_changed',
    'manager:' || _order.restaurant_id::text,
    false
  );

  RETURN NEW;
END;
$$;
