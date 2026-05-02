-- Migration: rename_free_plan_to_trialing
-- Renames the 'free' plan value to 'trialing' throughout the subscriptions table.
-- This fixes the misnomer where 'free' was used as an internal fallback/pending state
-- when the correct term is 'trialing'.

-- 1. Drop the old plan check constraint
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;

-- 2. Migrate existing 'free' rows to 'trialing' BEFORE adding new constraint
UPDATE subscriptions SET plan = 'trialing' WHERE plan = 'free';

-- 3. Change default from 'free' to 'trialing'
ALTER TABLE subscriptions ALTER COLUMN plan SET DEFAULT 'trialing';

-- 4. Add new constraint that only allows 'trialing' and 'pro'
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN ('trialing', 'pro'));
