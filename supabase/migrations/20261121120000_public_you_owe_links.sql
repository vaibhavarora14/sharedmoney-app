-- Public 1:1 "You owe X" balance links (#325).
-- Dark launch: public_you_owe is OFF by default. The public payload is only
-- amount, currency, and direction — never names, emails, photos, group ids,
-- or other members' data. Links are for direct ledgers only, expire, and
-- can be revoked.

CREATE TABLE IF NOT EXISTS public.app_feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_feature_flags (key, enabled)
VALUES ('public_you_owe', false)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.app_feature_flags IS
  'Named runtime flags. public_you_owe stays false until an operator turns it on.';

CREATE TABLE IF NOT EXISTS public.balance_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewer_participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS balance_share_links_group_id_idx
  ON public.balance_share_links (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.balance_share_link_hits (
  token_hash TEXT NOT NULL,
  hit_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS balance_share_link_hits_hash_at_idx
  ON public.balance_share_link_hits (token_hash, hit_at DESC);

ALTER TABLE public.app_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balance_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balance_share_link_hits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_feature_flags FROM anon, authenticated;
REVOKE ALL ON TABLE public.balance_share_links FROM anon, authenticated;
REVOKE ALL ON TABLE public.balance_share_link_hits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_app_feature_enabled(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT enabled FROM public.app_feature_flags WHERE key = p_key
  ), false);
$$;

REVOKE ALL ON FUNCTION public.is_app_feature_enabled(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_app_feature_enabled(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_balance_share_link(p_group_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_viewer uuid;
  v_token text;
  v_hash text;
  v_active integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF public.user_is_anonymous(v_uid) THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'Group is required';
  END IF;
  IF NOT public.is_app_feature_enabled('public_you_owe') THEN
    RAISE EXCEPTION 'This feature is off';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.groups g
    JOIN public.group_members gm ON gm.group_id = g.id
    WHERE g.id = p_group_id
      AND g.kind = 'direct'
      AND gm.user_id = v_uid
      AND gm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Balance links are only for a 1:1 ledger you belong to';
  END IF;

  SELECT p.id
    INTO v_viewer
  FROM public.participants p
  WHERE p.group_id = p_group_id
    AND coalesce(p.type, 'member') <> 'former'
    AND (p.user_id IS NULL OR p.user_id <> v_uid)
  ORDER BY p.created_at NULLS LAST, p.id
  LIMIT 1;

  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'This ledger needs the other person before you can share a balance link';
  END IF;
  IF (
    SELECT count(*)
    FROM public.participants p
    WHERE p.group_id = p_group_id
      AND coalesce(p.type, 'member') <> 'former'
      AND (p.user_id IS NULL OR p.user_id <> v_uid)
  ) <> 1 THEN
    RAISE EXCEPTION 'Balance links are only for a 1:1 ledger';
  END IF;

  SELECT count(*) INTO v_active
  FROM public.balance_share_links l
  WHERE l.group_id = p_group_id
    AND l.revoked_at IS NULL
    AND l.expires_at > NOW();
  IF v_active >= 3 THEN
    RAISE EXCEPTION 'Revoke an existing link before creating another';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.balance_share_links (
    group_id, created_by, viewer_participant_id, token_hash, expires_at
  ) VALUES (
    p_group_id, v_uid, v_viewer, v_hash, NOW() + interval '7 days'
  );

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_balance_share_links(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = v_uid
      AND gm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not an active group member';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', l.id,
      'created_at', l.created_at,
      'expires_at', l.expires_at,
      'revoked_at', l.revoked_at
    ) ORDER BY l.created_at DESC)
    FROM public.balance_share_links l
    WHERE l.group_id = p_group_id
      AND l.created_by = v_uid
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_balance_share_link(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE public.balance_share_links l
     SET revoked_at = NOW()
   WHERE l.id = p_id
     AND l.revoked_at IS NULL
     AND l.created_by = v_uid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.create_balance_share_link(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_balance_share_links(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_balance_share_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_balance_share_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_balance_share_links(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_balance_share_link(uuid) TO authenticated;
