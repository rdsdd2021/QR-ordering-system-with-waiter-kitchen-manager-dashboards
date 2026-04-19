-- ============================================================================
-- FIX ORDER ASSIGNMENT ISSUES
-- This migration fixes the duplicate order assignment problem
-- ============================================================================

-- 1. Create the missing table_sessions table
CREATE TABLE IF NOT EXISTS table_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  waiter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ NULL,
  
  -- Ensure only one active session per table
  CONSTRAINT unique_active_table_session 
    EXCLUDE (table_id WITH =) WHERE (closed_at IS NULL)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_table_sessions_active 
  ON table_sessions(restaurant_id, table_id) 
  WHERE closed_at IS NULL;

-- 2. Create the missing RPC functions

-- Open or reuse a table session for a waiter
CREATE OR REPLACE FUNCTION open_table_session(
  p_restaurant_id UUID,
  p_table_id UUID,
  p_waiter_id UUID
) RETURNS UUID AS $$
DECLARE
  session_id UUID;
BEGIN
  -- Check if there's already an active session for this table
  SELECT id INTO session_id
  FROM table_sessions
  WHERE table_id = p_table_id 
    AND closed_at IS NULL;
  
  -- If session exists and belongs to same waiter, return it
  IF session_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM table_sessions 
      WHERE id = session_id AND waiter_id = p_waiter_id
    ) THEN
      RETURN session_id;
    ELSE
      -- Session exists but belongs to different waiter - error
      RAISE EXCEPTION 'Table % already has an active session with another waiter', p_table_id;
    END IF;
  END IF;
  
  -- Create new session
  INSERT INTO table_sessions (restaurant_id, table_id, waiter_id)
  VALUES (p_restaurant_id, p_table_id, p_waiter_id)
  RETURNING id INTO session_id;
  
  RETURN session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Close a table session
CREATE OR REPLACE FUNCTION close_table_session(p_table_id UUID) 
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE table_sessions 
  SET closed_at = now()
  WHERE table_id = p_table_id 
    AND closed_at IS NULL;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Add atomic order assignment function to prevent race conditions
CREATE OR REPLACE FUNCTION assign_order_to_waiter(
  p_order_id UUID,
  p_waiter_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  order_record RECORD;
  session_id UUID;
BEGIN
  -- Get order details and lock the row
  SELECT id, restaurant_id, table_id, waiter_id, status
  INTO order_record
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;
  
  -- Check if order exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;
  
  -- Check if order is already assigned
  IF order_record.waiter_id IS NOT NULL THEN
    RAISE EXCEPTION 'Order % is already assigned to waiter %', p_order_id, order_record.waiter_id;
  END IF;
  
  -- Check if order is in a valid state for assignment
  IF order_record.status NOT IN ('pending_waiter', 'confirmed', 'ready') THEN
    RAISE EXCEPTION 'Order % cannot be assigned in status %', p_order_id, order_record.status;
  END IF;
  
  -- Try to open table session (this will fail if another waiter has the table)
  BEGIN
    session_id := open_table_session(
      order_record.restaurant_id,
      order_record.table_id,
      p_waiter_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Cannot assign order: %', SQLERRM;
  END;
  
  -- Assign the order
  UPDATE orders 
  SET waiter_id = p_waiter_id
  WHERE id = p_order_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Add atomic order acceptance function (for waiter_first mode)
CREATE OR REPLACE FUNCTION accept_order_atomic(
  p_order_id UUID,
  p_waiter_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  order_record RECORD;
  session_id UUID;
BEGIN
  -- Get order details and lock the row
  SELECT id, restaurant_id, table_id, waiter_id, status
  INTO order_record
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;
  
  -- Check if order exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;
  
  -- Check if order is in pending_waiter status or already assigned to this waiter
  IF order_record.status != 'pending_waiter' AND 
     (order_record.waiter_id IS NOT NULL AND order_record.waiter_id != p_waiter_id) THEN
    RAISE EXCEPTION 'Order % cannot be accepted by waiter %', p_order_id, p_waiter_id;
  END IF;
  
  -- Try to open table session (this will fail if another waiter has the table)
  BEGIN
    session_id := open_table_session(
      order_record.restaurant_id,
      order_record.table_id,
      p_waiter_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Cannot accept order: %', SQLERRM;
  END;
  
  -- Accept the order
  UPDATE orders 
  SET waiter_id = p_waiter_id, status = 'confirmed'
  WHERE id = p_order_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Grant permissions
GRANT EXECUTE ON FUNCTION open_table_session(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION close_table_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION assign_order_to_waiter(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_order_atomic(UUID, UUID) TO authenticated;

-- 6. Enable RLS on table_sessions
ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see sessions for their restaurant
CREATE POLICY table_sessions_select_policy ON table_sessions
  FOR SELECT USING (
    restaurant_id IN (
      SELECT restaurant_id FROM users WHERE auth_id = auth.uid()
    )
  );

-- Policy: Only waiters can create sessions for themselves
CREATE POLICY table_sessions_insert_policy ON table_sessions
  FOR INSERT WITH CHECK (
    waiter_id IN (
      SELECT id FROM users 
      WHERE auth_id = auth.uid() AND role = 'waiter'
    )
  );

-- Policy: Only the waiter who owns the session can update it
CREATE POLICY table_sessions_update_policy ON table_sessions
  FOR UPDATE USING (
    waiter_id IN (
      SELECT id FROM users WHERE auth_id = auth.uid()
    )
  );