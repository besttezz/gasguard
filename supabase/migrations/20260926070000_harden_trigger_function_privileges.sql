-- ==============================================================================
-- GasGuard Supabase Security Hardening (Phase 6C-3A)
-- Scope: Revoke client EXECUTE access on internal trigger functions
-- ==============================================================================

-- 1. Revoke EXECUTE privileges on public.handle_new_auth_user()
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

-- 2. Revoke EXECUTE privileges on public.handle_updated_at()
revoke execute on function public.handle_updated_at() from public, anon, authenticated;
