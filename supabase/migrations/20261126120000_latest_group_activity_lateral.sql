-- Newest transaction_history row per group via the (group_id, changed_at DESC)
-- index. LATERAL LIMIT 1 avoids a DISTINCT ON scan of every history row.
-- SECURITY INVOKER is unchanged; RLS on transaction_history still applies.

CREATE OR REPLACE FUNCTION public.latest_group_activity(p_group_ids uuid[])
RETURNS TABLE (
  group_id uuid,
  action text,
  activity_type text,
  changed_by uuid,
  changed_at timestamp,
  changes jsonb,
  snapshot jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    th.group_id,
    th.action::text,
    th.activity_type::text,
    th.changed_by,
    th.changed_at,
    th.changes,
    th.snapshot
  FROM unnest(COALESCE(p_group_ids, ARRAY[]::uuid[])) AS g(id)
  CROSS JOIN LATERAL (
    SELECT
      hist.group_id,
      hist.action,
      hist.activity_type,
      hist.changed_by,
      hist.changed_at,
      hist.changes,
      hist.snapshot
    FROM public.transaction_history hist
    WHERE hist.group_id = g.id
    ORDER BY hist.changed_at DESC
    LIMIT 1
  ) th;
$$;

REVOKE ALL ON FUNCTION public.latest_group_activity(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.latest_group_activity(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.latest_group_activity(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.latest_group_activity(uuid[]) IS
  'Latest transaction_history row per group (index nested-loop). Caller must be a member; RLS applies.';
