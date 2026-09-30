-- Batch email lookup for edge functions (replaces N Admin GET /auth/v1/admin/users/:id)
-- Created: 2026-09-30
--
-- Context:
-- fetchUserEmails previously issued one Admin API GET per user id. Group open and
-- /balances paths enrich many members/participants, so that fan-out dominated latency.
--
-- This SECURITY DEFINER function reads emails from auth.users in one query.
-- Service role only — do not grant to anon/authenticated (email oracle).

CREATE OR REPLACE FUNCTION public.get_user_emails_by_ids(p_ids UUID[])
RETURNS TABLE(id UUID, email TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.email::text
  FROM auth.users u
  WHERE u.id = ANY (p_ids)
    AND u.email IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_user_emails_by_ids(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_emails_by_ids(UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_user_emails_by_ids(UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_emails_by_ids(UUID[]) TO service_role;

COMMENT ON FUNCTION public.get_user_emails_by_ids(UUID[]) IS
  'Server-side batch lookup of auth user emails by id. Service role only.';
