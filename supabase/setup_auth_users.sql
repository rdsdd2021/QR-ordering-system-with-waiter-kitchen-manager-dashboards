-- ============================================
-- AUTH USER SETUP SCRIPT
-- ============================================
-- This script links existing user profiles to auth users
-- Run this AFTER creating auth users in Supabase Dashboard
--
-- PREREQUISITE: Create these auth users in Supabase Dashboard first:
-- 1. manager@demo.com (password: password123)
-- 2. waiter@demo.com (password: password123)  
-- 3. kitchen@demo.com (password: password123)
-- ============================================

-- Step 1: Verify auth users exist
SELECT 
  email, 
  id as auth_id,
  created_at,
  confirmed_at
FROM auth.users 
WHERE email IN ('manager@demo.com', 'waiter@demo.com', 'kitchen@demo.com')
ORDER BY email;

-- Expected: 3 rows showing the auth users you created
-- If empty, go create them in Supabase Dashboard → Authentication → Users

-- ============================================
-- Step 2: Link auth users to existing profiles
-- ============================================

-- Link Charlie (Manager) to manager@demo.com
UPDATE users 
SET 
  auth_id = (SELECT id FROM auth.users WHERE email = 'manager@demo.com'),
  email = 'manager@demo.com'
WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  AND name = 'Charlie (Manager)';

-- Link Bob (Waiter) to waiter@demo.com
UPDATE users 
SET 
  auth_id = (SELECT id FROM auth.users WHERE email = 'waiter@demo.com'),
  email = 'waiter@demo.com'
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  AND name = 'Bob (Waiter)';

-- Link Diana (Kitchen) to kitchen@demo.com
UPDATE users 
SET 
  auth_id = (SELECT id FROM auth.users WHERE email = 'kitchen@demo.com'),
  email = 'kitchen@demo.com'
WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
  AND name = 'Diana (Kitchen)';

-- ============================================
-- Step 3: Verify the linkage
-- ============================================

SELECT 
  u.id,
  u.name,
  u.role,
  u.email as profile_email,
  u.auth_id,
  au.email as auth_email,
  au.confirmed_at,
  r.name as restaurant_name
FROM users u
LEFT JOIN auth.users au ON u.auth_id = au.id
LEFT JOIN restaurants r ON u.restaurant_id = r.id
WHERE u.restaurant_id = '11111111-1111-1111-1111-111111111111'
ORDER BY u.role;

-- Expected output:
-- ┌──────────────────────────────────────┬──────────────────┬─────────┬──────────────────┬──────────────────────────────────────┬──────────────────┬─────────────────────┬─────────────────┐
-- │ id                                   │ name             │ role    │ profile_email    │ auth_id                              │ auth_email       │ confirmed_at        │ restaurant_name │
-- ├──────────────────────────────────────┼──────────────────┼─────────┼──────────────────┼──────────────────────────────────────┼──────────────────┼─────────────────────┼─────────────────┤
-- │ dddddddd-dddd-dddd-dddd-dddddddddddd │ Diana (Kitchen)  │ kitchen │ kitchen@demo.com │ [uuid]                               │ kitchen@demo.com │ 2026-04-19 ...      │ Demo Restaurant │
-- │ cccccccc-cccc-cccc-cccc-cccccccccccc │ Charlie (Manager)│ manager │ manager@demo.com │ [uuid]                               │ manager@demo.com │ 2026-04-19 ...      │ Demo Restaurant │
-- │ bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb │ Bob (Waiter)     │ waiter  │ waiter@demo.com  │ [uuid]                               │ waiter@demo.com  │ 2026-04-19 ...      │ Demo Restaurant │
-- └──────────────────────────────────────┴──────────────────┴─────────┴──────────────────┴──────────────────────────────────────┴──────────────────┴─────────────────────┴─────────────────┘

-- ============================================
-- Step 4: Test RLS policies
-- ============================================

-- Test that helper functions work
SELECT get_user_role('cccccccc-cccc-cccc-cccc-cccccccccccc'); -- Should return 'manager'
SELECT get_user_restaurant_id('cccccccc-cccc-cccc-cccc-cccccccccccc'); -- Should return restaurant UUID
SELECT user_has_role('cccccccc-cccc-cccc-cccc-cccccccccccc', 'manager'); -- Should return true

-- ============================================
-- Step 5: Generate test data for analytics
-- ============================================

-- Create some billed orders for analytics testing
UPDATE orders 
SET 
  billed_at = NOW(),
  status = 'completed'
WHERE table_id IN (
  SELECT id FROM tables 
  WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'
)
AND billed_at IS NULL
LIMIT 3;

-- Verify analytics views work
SELECT * FROM daily_sales 
WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'
ORDER BY sale_date DESC
LIMIT 7;

SELECT * FROM top_selling_items
WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'
LIMIT 10;

-- ============================================
-- DONE! 
-- ============================================
-- Now you can test login at: http://localhost:3000/login
--
-- Credentials:
-- Manager: manager@demo.com / password123
-- Waiter:  waiter@demo.com / password123
-- Kitchen: kitchen@demo.com / password123
-- ============================================
