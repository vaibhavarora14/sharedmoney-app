-- Fold remaining serial round trips on groups list and group activity.
-- Additive: CREATE OR REPLACE only. No RLS policy changes.
-- list_my_visible_groups: memberships + groups + mutes + latest activity + names.
-- get_group_activity_page: active membership + blocked filter + page + count
-- + participants + profiles + emails in one call. Emails are scoped to this
-- group's page (active members already see those addresses on the feed).

CREATE OR REPLACE FUNCTION public.list_my_visible_groups(p_include_direct boolean DEFAULT false)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  created_by uuid,
  created_at timestamp,
  updated_at timestamp,
  kind text,
  settlement_currency character varying,
  unify_balances boolean,
  default_split_mode text,
  default_split_weights jsonb,
  balance_nudge_cadence text,
  user_status text,
  archived_at timestamptz,
  hidden_at timestamptz,
  balance_nudge_muted boolean,
  activity_row jsonb,
  activity_names jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH memberships AS (
    SELECT gm.group_id, gm.status, gm.archived_at, gm.hidden_at
    FROM public.group_members gm
    WHERE gm.user_id = auth.uid()
      AND gm.hidden_at IS NULL
  ),
  listed AS (
    SELECT
      g.id,
      g.name,
      g.description,
      g.created_by,
      g.created_at,
      g.updated_at,
      g.kind,
      g.settlement_currency,
      g.unify_balances,
      g.default_split_mode,
      g.default_split_weights,
      g.balance_nudge_cadence,
      m.status AS user_status,
      m.archived_at,
      EXISTS (
        SELECT 1
        FROM public.group_balance_nudge_mutes mute
        WHERE mute.user_id = auth.uid()
          AND mute.group_id = g.id
      ) AS balance_nudge_muted
    FROM public.groups g
    JOIN memberships m ON m.group_id = g.id
    WHERE p_include_direct OR g.kind <> 'direct'
  ),
  activity AS (
    SELECT lat.*
    FROM public.latest_group_activity(
      ARRAY(SELECT l.id FROM listed l)
    ) AS lat
  )
  SELECT
    l.id,
    l.name::text,
    l.description::text,
    l.created_by,
    l.created_at,
    l.updated_at,
    l.kind::text,
    l.settlement_currency,
    l.unify_balances,
    l.default_split_mode::text,
    l.default_split_weights,
    l.balance_nudge_cadence::text,
    l.user_status::text,
    l.archived_at,
    NULL::timestamptz AS hidden_at,
    l.balance_nudge_muted,
    CASE WHEN a.group_id IS NULL THEN NULL
    ELSE jsonb_build_object(
      'group_id', a.group_id,
      'action', a.action,
      'activity_type', a.activity_type,
      'changed_by', a.changed_by,
      'changed_at', a.changed_at,
      'changes', a.changes,
      'snapshot', a.snapshot
    ) END AS activity_row,
    CASE WHEN a.group_id IS NULL THEN '{}'::jsonb
    ELSE COALESCE(
      (
        SELECT jsonb_object_agg(n.k, n.v)
        FROM (
          VALUES
            (a.changed_by::text, actor.full_name),
            (from_u.id::text, from_u.full_name),
            (to_u.id::text, to_u.full_name),
            (from_p.id::text, from_p.full_name),
            (to_p.id::text, to_p.full_name)
        ) AS n(k, v)
        WHERE n.k IS NOT NULL
      ),
      '{}'::jsonb
    ) END AS activity_names
  FROM listed l
  LEFT JOIN activity a ON a.group_id = l.id
  LEFT JOIN public.profiles actor ON actor.id = a.changed_by
  LEFT JOIN public.profiles from_u ON from_u.id = COALESCE(
    CASE WHEN a.snapshot->>'from_user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (a.snapshot->>'from_user_id')::uuid END,
    CASE WHEN a.changes->'settlement'->>'from_user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (a.changes->'settlement'->>'from_user_id')::uuid END
  )
  LEFT JOIN public.profiles to_u ON to_u.id = COALESCE(
    CASE WHEN a.snapshot->>'to_user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (a.snapshot->>'to_user_id')::uuid END,
    CASE WHEN a.changes->'settlement'->>'to_user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (a.changes->'settlement'->>'to_user_id')::uuid END
  )
  LEFT JOIN public.participants from_p ON from_p.id = COALESCE(
    CASE WHEN a.snapshot->>'from_participant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (a.snapshot->>'from_participant_id')::uuid END,
    CASE WHEN a.changes->'settlement'->>'from_participant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (a.changes->'settlement'->>'from_participant_id')::uuid END
  )
  LEFT JOIN public.participants to_p ON to_p.id = COALESCE(
    CASE WHEN a.snapshot->>'to_participant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (a.snapshot->>'to_participant_id')::uuid END,
    CASE WHEN a.changes->'settlement'->>'to_participant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (a.changes->'settlement'->>'to_participant_id')::uuid END
  )
  ORDER BY l.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_my_visible_groups(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_visible_groups(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_my_visible_groups(boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_my_visible_groups(boolean) IS
  'Visible groups for the caller, with mute flag and latest activity names, in one round trip. RLS applies (SECURITY INVOKER).';

CREATE OR REPLACE FUNCTION public.get_group_activity_page(
  p_group_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  is_member boolean,
  total bigint,
  history jsonb,
  participants jsonb,
  profiles jsonb,
  emails jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer;
  v_offset integer;
  v_is_member boolean;
  v_total bigint;
  v_history jsonb;
  v_participants jsonb;
  v_profiles jsonb;
  v_emails jsonb;
  v_user_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = v_uid
      AND gm.status = 'active'
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    is_member := false;
    total := 0;
    history := '[]'::jsonb;
    participants := '[]'::jsonb;
    profiles := '[]'::jsonb;
    emails := '[]'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT count(*)::bigint INTO v_total
  FROM public.transaction_history th
  WHERE th.group_id = p_group_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_blocks b
      WHERE b.blocker_id = v_uid
        AND b.blocked_user_id = th.changed_by
    );

  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.changed_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT
      th.id,
      th.transaction_id,
      th.settlement_id,
      th.activity_type,
      th.group_id,
      th.action,
      th.changed_by,
      th.changed_at,
      th.changes,
      th.snapshot
    FROM public.transaction_history th
    WHERE th.group_id = p_group_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_blocks b
        WHERE b.blocker_id = v_uid
          AND b.blocked_user_id = th.changed_by
      )
    ORDER BY th.changed_at DESC
    OFFSET v_offset
    LIMIT v_limit
  ) h;

  SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
  INTO v_participants
  FROM public.participants p
  WHERE p.group_id = p_group_id;

  SELECT COALESCE(array_agg(DISTINCT uid), ARRAY[]::uuid[])
  INTO v_user_ids
  FROM (
    SELECT (h->>'changed_by')::uuid AS uid
    FROM jsonb_array_elements(v_history) AS h
    WHERE (h->>'changed_by') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    UNION
    SELECT p.user_id
    FROM public.participants p
    WHERE p.group_id = p_group_id
      AND p.user_id IS NOT NULL
  ) u
  WHERE uid IS NOT NULL;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id', pr.id,
      'full_name', pr.full_name,
      'avatar_url', pr.avatar_url
    )),
    '[]'::jsonb
  )
  INTO v_profiles
  FROM public.profiles pr
  WHERE pr.id = ANY (v_user_ids);

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email)),
    '[]'::jsonb
  )
  INTO v_emails
  FROM auth.users u
  WHERE u.id = ANY (v_user_ids)
    AND u.email IS NOT NULL;

  is_member := true;
  total := v_total;
  history := v_history;
  participants := COALESCE(v_participants, '[]'::jsonb);
  profiles := COALESCE(v_profiles, '[]'::jsonb);
  emails := COALESCE(v_emails, '[]'::jsonb);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_activity_page(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_group_activity_page(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_group_activity_page(uuid, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_group_activity_page(uuid, integer, integer) IS
  'Group activity page for an active member: membership, blocked-user filter, rows, count, participants, profiles, and emails in one round trip.';
