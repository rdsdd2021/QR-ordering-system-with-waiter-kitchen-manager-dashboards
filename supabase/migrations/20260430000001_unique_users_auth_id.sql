-- A5: Enforce uniqueness on users.auth_id so duplicate rows for the same
-- Supabase Auth user can never be created.
-- The non-unique index already exists (idx_users_auth_id) so we drop it first
-- and replace it with a UNIQUE constraint (which creates its own unique index).

DROP INDEX IF EXISTS public.idx_users_auth_id;

ALTER TABLE public.users
  ADD CONSTRAINT users_auth_id_unique UNIQUE (auth_id);
