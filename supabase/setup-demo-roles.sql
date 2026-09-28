-- ==============================================================================
-- Assign the GasGuard admin role (run in Supabase Dashboard > SQL Editor)
-- 1. Create the user first: Authentication > Users > Add user > Create new user
--    (email admin@gasguard.test, tick "Auto Confirm User", choose your own password).
-- 2. Run this script. Safe to re-run. Contains no passwords.
-- Admin sees every site through RLS, so no site membership is needed.
-- ==============================================================================

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
where lower(email) = 'admin@gasguard.test';

select email, raw_app_meta_data ->> 'role' as role
from auth.users
order by email;
