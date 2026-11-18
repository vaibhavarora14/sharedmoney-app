-- Hidden 1:1 direct groups for quick settle from Home.
-- A direct group is a normal two-person ledger (settlements, expenses, balances)
-- that the groups list and group search do not show as a group.
-- One pair of accounts shares one group. A name-only person is unique per owner
-- and is not auto-merged with a same-name person in another group.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE public.groups
  DROP CONSTRAINT IF EXISTS groups_kind_check;
ALTER TABLE public.groups
  ADD CONSTRAINT groups_kind_check
  CHECK (kind IN ('standard', 'direct'));

COMMENT ON COLUMN public.groups.kind IS
  'standard groups appear in the groups list. direct groups are one hidden 1:1 ledger per counterparty.';

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS settlements_client_request_id_uidx
  ON public.settlements (created_by, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_client_request_id_uidx
  ON public.transactions (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN public.settlements.client_request_id IS
  'Client idempotency key. A repeat with the same key returns the existing settlement.';
COMMENT ON COLUMN public.transactions.client_request_id IS
  'Client idempotency key. A repeat with the same key returns the existing transaction.';

CREATE TABLE IF NOT EXISTS public.direct_group_keys (
  group_id UUID PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
  user_low UUID,
  user_high UUID,
  owner_user_id UUID,
  name_key TEXT,
  CONSTRAINT direct_group_keys_shape CHECK (
    (
      user_low IS NOT NULL
      AND user_high IS NOT NULL
      AND user_low < user_high
      AND owner_user_id IS NULL
      AND name_key IS NULL
    )
    OR (
      user_low IS NULL
      AND user_high IS NULL
      AND owner_user_id IS NOT NULL
      AND name_key IS NOT NULL
      AND length(btrim(name_key)) > 0
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS direct_group_keys_account_pair_uidx
  ON public.direct_group_keys (user_low, user_high)
  WHERE user_low IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS direct_group_keys_name_uidx
  ON public.direct_group_keys (owner_user_id, name_key)
  WHERE name_key IS NOT NULL;

ALTER TABLE public.direct_group_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Direct group members can read their key" ON public.direct_group_keys;
CREATE POLICY "Direct group members can read their key"
  ON public.direct_group_keys
  FOR SELECT
  USING (
    public.is_user_group_member(group_id, auth.uid())
  );

REVOKE ALL ON TABLE public.direct_group_keys FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.direct_group_keys TO authenticated;
GRANT ALL ON TABLE public.direct_group_keys TO service_role;

CREATE OR REPLACE FUNCTION public.assert_direct_group_has_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.kind = 'direct' AND NOT EXISTS (
    SELECT 1 FROM public.direct_group_keys WHERE group_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'direct groups are created with create_or_get_direct_group';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS direct_group_requires_key ON public.groups;
CREATE CONSTRAINT TRIGGER direct_group_requires_key
  AFTER INSERT ON public.groups
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_direct_group_has_key();

CREATE OR REPLACE FUNCTION public.prevent_group_kind_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'group kind cannot change';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_group_kind_change ON public.groups;
CREATE TRIGGER prevent_group_kind_change
  BEFORE UPDATE OF kind ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_group_kind_change();

CREATE OR REPLACE FUNCTION public.relink_direct_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind TEXT;
  v_owner UUID;
  v_low UUID;
  v_high UUID;
  v_existing UUID;
BEGIN
  IF NEW.user_id IS NULL OR OLD.user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT g.kind, g.created_by
    INTO v_kind, v_owner
  FROM public.groups g
  WHERE g.id = NEW.group_id;

  IF v_kind IS DISTINCT FROM 'direct' OR v_owner IS NULL OR NEW.user_id = v_owner THEN
    RETURN NEW;
  END IF;

  v_low := LEAST(v_owner, NEW.user_id);
  v_high := GREATEST(v_owner, NEW.user_id);

  SELECT k.group_id INTO v_existing
  FROM public.direct_group_keys k
  WHERE k.user_low = v_low
    AND k.user_high = v_high
    AND k.group_id <> NEW.group_id;

  -- A same-name person who later gets an account is not merged into a
  -- different direct ledger that already exists for that account pair.
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.direct_group_keys
  SET
    user_low = v_low,
    user_high = v_high,
    owner_user_id = NULL,
    name_key = NULL
  WHERE group_id = NEW.group_id
    AND name_key IS NOT NULL;

  INSERT INTO public.group_members (group_id, user_id, role, status)
  VALUES (NEW.group_id, NEW.user_id, 'member', 'active')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS relink_direct_participant ON public.participants;
CREATE TRIGGER relink_direct_participant
  AFTER UPDATE OF user_id ON public.participants
  FOR EACH ROW
  EXECUTE FUNCTION public.relink_direct_participant();

CREATE OR REPLACE FUNCTION public.create_or_get_direct_group(
  p_counterparty_user_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner UUID;
  v_name TEXT;
  v_name_key TEXT;
  v_email TEXT;
  v_phone TEXT;
  v_group_id UUID;
  v_created BOOLEAN := FALSE;
  v_viewer_participant UUID;
  v_counterparty_participant UUID;
  v_low UUID;
  v_high UUID;
  v_profile_name TEXT;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_email := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
  v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');

  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Enter a valid email like name@example.com.';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Enter a valid phone number with area code.';
  END IF;

  IF p_counterparty_user_id IS NOT NULL THEN
    IF p_counterparty_user_id = v_owner THEN
      RAISE EXCEPTION 'Pick someone else';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_counterparty_user_id) THEN
      RAISE EXCEPTION 'That person does not have an account';
    END IF;

    v_low := LEAST(v_owner, p_counterparty_user_id);
    v_high := GREATEST(v_owner, p_counterparty_user_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_low::text || ':' || v_high::text, 0));

    SELECT k.group_id INTO v_group_id
    FROM public.direct_group_keys k
    WHERE k.user_low = v_low AND k.user_high = v_high;

    IF v_group_id IS NULL THEN
      SELECT NULLIF(btrim(full_name), '') INTO v_profile_name
      FROM public.profiles
      WHERE id = p_counterparty_user_id;

      v_name := COALESCE(v_name, v_profile_name, 'Direct');

      INSERT INTO public.groups (name, created_by, kind)
      VALUES (left(v_name, 255), v_owner, 'direct')
      RETURNING id INTO v_group_id;

      INSERT INTO public.group_members (group_id, user_id, role, status)
      VALUES (v_group_id, p_counterparty_user_id, 'member', 'active')
      ON CONFLICT (group_id, user_id) DO NOTHING;

      INSERT INTO public.direct_group_keys (group_id, user_low, user_high)
      VALUES (v_group_id, v_low, v_high);

      v_created := TRUE;
    END IF;
  ELSE
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'Enter a name';
    END IF;
    IF char_length(v_name) > 80 THEN
      RAISE EXCEPTION 'Name is too long';
    END IF;

    v_name_key := lower(regexp_replace(v_name, '\s+', ' ', 'g'));
    PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || v_name_key, 0));

    SELECT k.group_id INTO v_group_id
    FROM public.direct_group_keys k
    WHERE k.owner_user_id = v_owner AND k.name_key = v_name_key;

    IF v_group_id IS NULL THEN
      INSERT INTO public.groups (name, created_by, kind)
      VALUES (left(v_name, 255), v_owner, 'direct')
      RETURNING id INTO v_group_id;

      INSERT INTO public.participants (
        group_id, user_id, email, phone, type, role, full_name
      )
      VALUES (
        v_group_id, NULL, v_email, v_phone, 'member', 'member', left(v_name, 255)
      );

      INSERT INTO public.direct_group_keys (group_id, owner_user_id, name_key)
      VALUES (v_group_id, v_owner, v_name_key);

      v_created := TRUE;
    ELSE
      UPDATE public.participants
      SET
        email = COALESCE(email, v_email),
        phone = COALESCE(phone, v_phone),
        full_name = COALESCE(NULLIF(btrim(full_name), ''), left(v_name, 255)),
        updated_at = CURRENT_TIMESTAMP
      WHERE group_id = v_group_id
        AND user_id IS NULL
        AND type = 'member';
    END IF;
  END IF;

  SELECT p.id INTO v_viewer_participant
  FROM public.participants p
  WHERE p.group_id = v_group_id AND p.user_id = v_owner
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF p_counterparty_user_id IS NOT NULL THEN
    UPDATE public.participants
    SET full_name = COALESCE(NULLIF(btrim(full_name), ''), left(v_name, 255))
    WHERE group_id = v_group_id
      AND user_id = p_counterparty_user_id
      AND NULLIF(btrim(COALESCE(full_name, '')), '') IS NULL;

    SELECT p.id INTO v_counterparty_participant
    FROM public.participants p
    WHERE p.group_id = v_group_id AND p.user_id = p_counterparty_user_id
    ORDER BY p.created_at ASC
    LIMIT 1;
  ELSE
    SELECT p.id INTO v_counterparty_participant
    FROM public.participants p
    WHERE p.group_id = v_group_id AND p.user_id IS NULL AND p.type = 'member'
    ORDER BY p.created_at ASC
    LIMIT 1;
  END IF;

  IF v_viewer_participant IS NULL OR v_counterparty_participant IS NULL THEN
    RAISE EXCEPTION 'Could not open the direct ledger';
  END IF;

  RETURN jsonb_build_object(
    'group_id', v_group_id,
    'viewer_participant_id', v_viewer_participant,
    'counterparty_participant_id', v_counterparty_participant,
    'created', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_get_direct_group(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_get_direct_group(UUID, TEXT, TEXT, TEXT)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.assert_direct_group_has_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_group_kind_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.relink_direct_participant() FROM PUBLIC, anon, authenticated;
