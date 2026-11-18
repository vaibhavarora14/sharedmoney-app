-- Guest mode (#524). Anonymous users are the `authenticated` role plus an
-- `is_anonymous` JWT claim. Caps, invite/link/UPI writes, and the conflict
-- merge are enforced here. The 60-day purge exists but is OFF: nothing in
-- this migration schedules pg_cron or deletes any row.

-- ---------------------------------------------------------------------------
-- Profile activity clock. Opening the app does not touch this column.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_guest_activity_at timestamptz;

-- Present when quick settle has already shipped. Harmless if it has.
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN public.profiles.last_guest_activity_at IS
  'Last guest write or anonymous sign-in. Viewing the app does not update it. Null for accounts that were never guests.';

-- ---------------------------------------------------------------------------
-- Merge bookkeeping. Tokens are single-use. guest_merges makes a retry a no-op.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.guest_merge_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.guest_merges (
  guest_user_id uuid PRIMARY KEY,
  permanent_user_id uuid NOT NULL,
  result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

-- Default OFF. purge_inactive_guests returns 0 until a human sets this true.
CREATE TABLE IF NOT EXISTS public.guest_runtime_config (
  singleton boolean PRIMARY KEY DEFAULT true,
  cleanup_enabled boolean NOT NULL DEFAULT false,
  CONSTRAINT guest_runtime_config_singleton CHECK (singleton)
);

INSERT INTO public.guest_runtime_config (singleton, cleanup_enabled)
VALUES (true, false)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.guest_merge_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_runtime_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guest_merge_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guest_merges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guest_runtime_config FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claim helpers. search_path is empty; auth.jwt() is schema-qualified.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_is_guest()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

REVOKE ALL ON FUNCTION public.current_user_is_guest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_guest() TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_guest_write()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF public.current_user_is_guest() THEN
    RAISE EXCEPTION 'GUEST_SIGNIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_guest_write() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_guest_write() TO authenticated;

CREATE OR REPLACE FUNCTION public.guest_token_hash(p_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT md5(p_token);
$$;

REVOKE ALL ON FUNCTION public.guest_token_hash(text) FROM PUBLIC, anon, authenticated;

-- Same-name groups stay separate. "(guest)" is appended only to the guest group.
CREATE OR REPLACE FUNCTION public.guest_collision_name(p_name text, p_taken text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_candidate text;
  v_item text;
  v_n integer := 2;
  v_taken boolean;
BEGIN
  v_taken := false;
  IF p_taken IS NOT NULL THEN
    FOREACH v_item IN ARRAY p_taken LOOP
      IF lower(btrim(v_item)) = lower(btrim(p_name)) THEN
        v_taken := true;
      END IF;
    END LOOP;
  END IF;
  IF NOT v_taken THEN
    RETURN p_name;
  END IF;

  v_candidate := p_name || ' (guest)';
  LOOP
    v_taken := false;
    IF p_taken IS NOT NULL THEN
      FOREACH v_item IN ARRAY p_taken LOOP
        IF lower(btrim(v_item)) = lower(btrim(v_candidate)) THEN
          v_taken := true;
        END IF;
      END LOOP;
    END IF;
    EXIT WHEN NOT v_taken;
    v_candidate := p_name || ' (guest ' || v_n::text || ')';
    v_n := v_n + 1;
    IF v_n > 50 THEN
      RAISE EXCEPTION 'GUEST_MERGE_NAME_EXHAUSTED' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_collision_name(text, text[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Caps. 5 groups and 200 expenses. Count is taken before the new row lands.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_guest_group_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.current_user_is_guest() THEN
    RETURN NEW;
  END IF;
  -- Hidden 1:1 direct ledgers are not groups in the list, so they do not
  -- use up the 5 visible groups. Expenses inside them still count.
  IF coalesce(NEW.kind, 'standard') = 'direct' THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.groups
  WHERE created_by = auth.uid()
    AND coalesce(kind, 'standard') IS DISTINCT FROM 'direct';
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'GUEST_GROUP_CAP' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_guest_expense_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.current_user_is_guest() THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.transactions
  WHERE user_id = auth.uid();
  IF v_count >= 200 THEN
    RAISE EXCEPTION 'GUEST_EXPENSE_CAP' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_guest_group_cap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_guest_expense_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guest_group_cap ON public.groups;
CREATE TRIGGER guest_group_cap
  BEFORE INSERT ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_guest_group_cap();

DROP TRIGGER IF EXISTS guest_expense_cap ON public.transactions;
CREATE TRIGGER guest_expense_cap
  BEFORE INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_guest_expense_cap();

-- ---------------------------------------------------------------------------
-- Activity. Writes only. A SELECT does not fire these triggers.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_guest_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NOT NULL AND public.current_user_is_guest() THEN
    UPDATE public.profiles
    SET last_guest_activity_at = now()
    WHERE id = v_uid;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_guest_activity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guest_activity_groups ON public.groups;
CREATE TRIGGER guest_activity_groups
  AFTER INSERT OR UPDATE OR DELETE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_guest_activity();

DROP TRIGGER IF EXISTS guest_activity_members ON public.group_members;
CREATE TRIGGER guest_activity_members
  AFTER INSERT OR UPDATE OR DELETE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_guest_activity();

DROP TRIGGER IF EXISTS guest_activity_participants ON public.participants;
CREATE TRIGGER guest_activity_participants
  AFTER INSERT OR UPDATE OR DELETE ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.touch_guest_activity();

DROP TRIGGER IF EXISTS guest_activity_transactions ON public.transactions;
CREATE TRIGGER guest_activity_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_guest_activity();

DROP TRIGGER IF EXISTS guest_activity_settlements ON public.settlements;
CREATE TRIGGER guest_activity_settlements
  AFTER INSERT OR UPDATE OR DELETE ON public.settlements
  FOR EACH ROW EXECUTE FUNCTION public.touch_guest_activity();

-- Guests cannot save a UPI ID, phone, or WhatsApp opt-in on the profile row.
CREATE OR REPLACE FUNCTION public.reject_guest_profile_secrets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.current_user_is_guest() THEN
    RETURN NEW;
  END IF;
  IF to_jsonb(NEW) ? 'upi_id'
     AND to_jsonb(NEW) ->> 'upi_id' IS NOT NULL
     AND to_jsonb(NEW) ->> 'upi_id' IS DISTINCT FROM to_jsonb(OLD) ->> 'upi_id' THEN
    RAISE EXCEPTION 'GUEST_SIGNIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF to_jsonb(NEW) ? 'phone'
     AND to_jsonb(NEW) ->> 'phone' IS NOT NULL
     AND to_jsonb(NEW) ->> 'phone' IS DISTINCT FROM to_jsonb(OLD) ->> 'phone' THEN
    RAISE EXCEPTION 'GUEST_SIGNIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_guest_profile_secrets() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guest_profile_secrets ON public.profiles;
CREATE TRIGGER guest_profile_secrets
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.reject_guest_profile_secrets();

-- ---------------------------------------------------------------------------
-- Restrictive policies. Permissive member policies still apply; these AND them.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS guest_cannot_insert_invitations ON public.group_invitations;
CREATE POLICY guest_cannot_insert_invitations
  ON public.group_invitations
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (NOT public.current_user_is_guest());

DROP POLICY IF EXISTS guest_cannot_update_invitations ON public.group_invitations;
CREATE POLICY guest_cannot_update_invitations
  ON public.group_invitations
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (NOT public.current_user_is_guest())
  WITH CHECK (NOT public.current_user_is_guest());

DROP POLICY IF EXISTS guest_cannot_delete_invitations ON public.group_invitations;
CREATE POLICY guest_cannot_delete_invitations
  ON public.group_invitations
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (NOT public.current_user_is_guest());

DO $$
BEGIN
  IF to_regclass('public.notification_preferences') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS guest_cannot_write_notification_preferences ON public.notification_preferences';
    EXECUTE 'CREATE POLICY guest_cannot_write_notification_preferences ON public.notification_preferences AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.current_user_is_guest()) WITH CHECK (NOT public.current_user_is_guest())';
  END IF;
  IF to_regclass('public.push_tokens') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS guest_cannot_write_push_tokens ON public.push_tokens';
    EXECUTE 'CREATE POLICY guest_cannot_write_push_tokens ON public.push_tokens AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.current_user_is_guest()) WITH CHECK (NOT public.current_user_is_guest())';
  END IF;
  IF to_regclass('public.whatsapp_reminder_prefs') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS guest_cannot_write_whatsapp_prefs ON public.whatsapp_reminder_prefs';
    EXECUTE 'CREATE POLICY guest_cannot_write_whatsapp_prefs ON public.whatsapp_reminder_prefs AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.current_user_is_guest()) WITH CHECK (NOT public.current_user_is_guest())';
  END IF;
END $$;

-- Email lookup stays service-role only. Anonymous JWTs use `authenticated`.
REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_emails_by_ids(uuid[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invite link RPCs. The previous bodies stay; the public names reject guests.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.create_group_share_link(uuid, integer, integer)
  RENAME TO create_group_share_link_registered;

ALTER FUNCTION public.redeem_group_invite_link(text)
  RENAME TO redeem_group_invite_link_registered;

REVOKE ALL ON FUNCTION public.create_group_share_link_registered(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_group_invite_link_registered(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_group_share_link(
  p_group_id uuid,
  p_max_uses integer DEFAULT 1,
  p_valid_days integer DEFAULT 7
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.reject_guest_write();
  RETURN public.create_group_share_link_registered(p_group_id, p_max_uses, p_valid_days);
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_group_invite_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.reject_guest_write();
  RETURN public.redeem_group_invite_link_registered(p_token);
END;
$$;

REVOKE ALL ON FUNCTION public.create_group_share_link(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_share_link(uuid, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.redeem_group_invite_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_group_invite_link(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- New anonymous users: profile row, activity clock, no email auto-join.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invitation_record RECORD;
  v_anonymous boolean := coalesce((to_jsonb(NEW) ->> 'is_anonymous')::boolean, false);
BEGIN
  INSERT INTO public.profiles (id, profile_completed)
  VALUES (NEW.id, FALSE)
  ON CONFLICT (id) DO NOTHING;

  IF v_anonymous THEN
    UPDATE public.profiles
    SET last_guest_activity_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
  END IF;

  -- Anonymous users, including ones that somehow carry an email, do not auto-join.
  IF v_anonymous OR NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  FOR invitation_record IN
    SELECT id, group_id, email
    FROM public.group_invitations
    WHERE LOWER(email) = LOWER(NEW.email)
      AND status = 'pending'
      AND expires_at >= CURRENT_TIMESTAMP
    FOR UPDATE
  LOOP
    BEGIN
      PERFORM public.sync_participant_state(
        invitation_record.group_id,
        NEW.id,
        invitation_record.email,
        'member',
        'member'
      );

      INSERT INTO public.group_members (group_id, user_id, role, status, left_at)
      VALUES (invitation_record.group_id, NEW.id, 'member', 'active', NULL)
      ON CONFLICT (group_id, user_id)
      DO UPDATE SET
        role = CASE
          WHEN public.group_members.role = 'owner' THEN public.group_members.role
          ELSE EXCLUDED.role
        END,
        status = 'active',
        left_at = NULL;

      UPDATE public.group_invitations
      SET status = 'accepted',
          accepted_at = CURRENT_TIMESTAMP
      WHERE id = invitation_record.id
        AND status = 'pending';
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'handle_new_user invite processing failed (user_id: %, invitation_id: %, group_id: %): %',
          NEW.id,
          invitation_record.id,
          invitation_record.group_id,
          SQLERRM;
    END;
  END LOOP;

  UPDATE public.group_invitations
  SET status = 'expired'
  WHERE LOWER(email) = LOWER(NEW.email)
    AND status = 'pending'
    AND expires_at < CURRENT_TIMESTAMP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates a profile. Anonymous sign-ins skip email invite auto-accept and stamp last_guest_activity_at.';

-- ---------------------------------------------------------------------------
-- Merge token, preview, merge, discard, self-delete.
-- Merge is one transaction: any error rolls back, including the token use
-- and the guest auth.users delete, which happens last.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_is_anonymous(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((to_jsonb(u) ->> 'is_anonymous')::boolean, false)
      OR coalesce(u.raw_app_meta_data ->> 'provider', '') = 'anonymous'
  FROM auth.users u
  WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.user_is_anonymous(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mint_guest_merge_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_guest() THEN
    RAISE EXCEPTION 'GUEST_SIGNIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_is_anonymous(v_uid) THEN
    RAISE EXCEPTION 'GUEST_SIGNIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.guest_merge_tokens (guest_user_id, token_hash, expires_at)
  VALUES (v_uid, public.guest_token_hash(v_token), now() + interval '15 minutes');
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.mint_guest_merge_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mint_guest_merge_token() TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_guest_merge(p_guest_user_id uuid, p_merge_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_hash text := public.guest_token_hash(p_merge_token);
  v_taken text[] := ARRAY[]::text[];
  v_groups jsonb := '[]'::jsonb;
  v_row record;
  v_label text;
  v_renamed boolean;
  v_expenses integer;
  v_payments integer;
BEGIN
  IF v_caller IS NULL OR v_caller = p_guest_user_id OR public.current_user_is_guest() THEN
    RAISE EXCEPTION 'GUEST_MERGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.guest_merge_tokens t
    WHERE t.token_hash = v_hash
      AND t.guest_user_id = p_guest_user_id
      AND t.used_at IS NULL
      AND t.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'GUEST_MERGE_TOKEN_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(g.name), ARRAY[]::text[]) INTO v_taken
  FROM public.groups g
  WHERE coalesce(g.kind, 'standard') IS DISTINCT FROM 'direct'
    AND (
      g.created_by = v_caller
      OR EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = g.id AND gm.user_id = v_caller AND gm.status = 'active'
      )
    );

  FOR v_row IN
    SELECT g.id, g.name, coalesce(g.kind, 'standard') AS kind
    FROM public.groups g
    WHERE g.created_by = p_guest_user_id
    ORDER BY g.created_at, g.id
  LOOP
    IF v_row.kind = 'direct' THEN
      v_label := v_row.name;
      v_renamed := false;
    ELSE
      v_label := public.guest_collision_name(v_row.name, v_taken);
      v_renamed := v_label IS DISTINCT FROM v_row.name;
      v_taken := v_taken || v_label;
    END IF;
    v_groups := v_groups || jsonb_build_array(jsonb_build_object(
      'id', v_row.id,
      'name', v_label,
      'renamed', v_renamed,
      'note', CASE WHEN v_renamed THEN 'Same name, kept separate' ELSE NULL END
    ));
  END LOOP;

  SELECT count(*) INTO v_expenses FROM public.transactions WHERE user_id = p_guest_user_id;
  SELECT count(*) INTO v_payments FROM public.settlements WHERE created_by = p_guest_user_id;

  RETURN jsonb_build_object(
    'groups', v_groups,
    'group_count', jsonb_array_length(v_groups),
    'expense_count', v_expenses,
    'payment_count', v_payments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_guest_merge(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_guest_merge(uuid, text) TO authenticated;

-- Moves direct-group keys that belong to the guest's groups. Keys already
-- owned by the permanent account are not updated. A colliding name or pair
-- keeps the guest ledger under a separate name key.
CREATE OR REPLACE FUNCTION public.reassign_guest_direct_keys(
  p_guest uuid,
  p_permanent uuid,
  p_group_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key record;
  v_low uuid;
  v_high uuid;
  v_name text;
  v_n integer;
BEGIN
  IF to_regclass('public.direct_group_keys') IS NULL OR p_group_ids IS NULL THEN
    RETURN;
  END IF;

  FOR v_key IN
    SELECT *
    FROM public.direct_group_keys
    WHERE group_id = ANY (p_group_ids)
    FOR UPDATE
  LOOP
    IF v_key.name_key IS NOT NULL THEN
      v_name := v_key.name_key;
      v_n := 2;
      WHILE EXISTS (
        SELECT 1 FROM public.direct_group_keys other
        WHERE other.owner_user_id = p_permanent
          AND other.name_key = v_name
          AND other.group_id <> v_key.group_id
      ) LOOP
        IF v_n = 2 THEN
          v_name := v_key.name_key || ' (guest)';
        ELSE
          v_name := v_key.name_key || ' (guest ' || v_n::text || ')';
        END IF;
        v_n := v_n + 1;
        IF v_n > 50 THEN
          RAISE EXCEPTION 'GUEST_MERGE_NAME_EXHAUSTED' USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
      UPDATE public.direct_group_keys
      SET owner_user_id = p_permanent, name_key = v_name
      WHERE group_id = v_key.group_id;
    ELSE
      v_low := CASE WHEN v_key.user_low = p_guest THEN p_permanent ELSE v_key.user_low END;
      v_high := CASE WHEN v_key.user_high = p_guest THEN p_permanent ELSE v_key.user_high END;
      IF v_low IS NULL OR v_high IS NULL OR v_low = v_high OR EXISTS (
        SELECT 1 FROM public.direct_group_keys other
        WHERE other.user_low = LEAST(v_low, v_high)
          AND other.user_high = GREATEST(v_low, v_high)
          AND other.group_id <> v_key.group_id
      ) THEN
        v_name := 'guest ' || v_key.group_id::text;
        UPDATE public.direct_group_keys
        SET user_low = NULL, user_high = NULL, owner_user_id = p_permanent, name_key = v_name
        WHERE group_id = v_key.group_id;
      ELSE
        UPDATE public.direct_group_keys
        SET user_low = LEAST(v_low, v_high), user_high = GREATEST(v_low, v_high)
        WHERE group_id = v_key.group_id;
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_guest_direct_keys(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.merge_guest_into_user(p_guest_user_id uuid, p_merge_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_hash text := public.guest_token_hash(p_merge_token);
  v_existing jsonb;
  v_taken text[] := ARRAY[]::text[];
  v_renamed jsonb := '[]'::jsonb;
  v_row record;
  v_label text;
  v_groups integer;
  v_expenses integer;
  v_payments integer;
  v_result jsonb;
  v_guest_currency text;
  v_permanent_currency text;
  v_guest_groups uuid[];
BEGIN
  SELECT result INTO v_existing
  FROM public.guest_merges
  WHERE guest_user_id = p_guest_user_id;
  IF FOUND THEN
    IF v_caller IS DISTINCT FROM (v_existing ->> 'permanent_user_id')::uuid THEN
      RAISE EXCEPTION 'GUEST_MERGE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    RETURN v_existing;
  END IF;

  IF v_caller IS NULL OR v_caller = p_guest_user_id OR public.current_user_is_guest() THEN
    RAISE EXCEPTION 'GUEST_MERGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_is_anonymous(p_guest_user_id) THEN
    RAISE EXCEPTION 'GUEST_MERGE_NOT_GUEST' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.guest_merge_tokens t
  WHERE t.token_hash = v_hash
    AND t.guest_user_id = p_guest_user_id
    AND t.used_at IS NULL
    AND t.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUEST_MERGE_TOKEN_INVALID' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM auth.users WHERE id = p_guest_user_id FOR UPDATE;
  PERFORM 1 FROM auth.users WHERE id = v_caller FOR UPDATE;

  SELECT count(*) INTO v_groups FROM public.groups WHERE created_by = p_guest_user_id;
  SELECT count(*) INTO v_expenses FROM public.transactions WHERE user_id = p_guest_user_id;
  SELECT count(*) INTO v_payments FROM public.settlements WHERE created_by = p_guest_user_id;

  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_guest_groups
  FROM public.groups
  WHERE created_by = p_guest_user_id;

  SELECT coalesce(array_agg(g.name), ARRAY[]::text[]) INTO v_taken
  FROM public.groups g
  WHERE coalesce(g.kind, 'standard') IS DISTINCT FROM 'direct'
    AND (
      g.created_by = v_caller
      OR EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = g.id AND gm.user_id = v_caller AND gm.status = 'active'
      )
    );

  FOR v_row IN
    SELECT g.id, g.name, coalesce(g.kind, 'standard') AS kind
    FROM public.groups g
    WHERE g.created_by = p_guest_user_id
    ORDER BY g.created_at, g.id
    FOR UPDATE
  LOOP
    IF v_row.kind = 'direct' THEN
      CONTINUE;
    END IF;
    v_label := public.guest_collision_name(v_row.name, v_taken);
    IF v_label IS DISTINCT FROM v_row.name THEN
      UPDATE public.groups SET name = v_label WHERE id = v_row.id AND created_by = p_guest_user_id;
      v_renamed := v_renamed || jsonb_build_array(jsonb_build_object(
        'from', v_row.name,
        'to', v_label
      ));
    END IF;
    v_taken := v_taken || v_label;
  END LOOP;

  -- Move ownership. Every predicate is the guest id, so existing account rows stay.
  UPDATE public.groups SET created_by = v_caller WHERE created_by = p_guest_user_id;
  PERFORM public.reassign_guest_direct_keys(p_guest_user_id, v_caller, v_guest_groups);

  DELETE FROM public.group_members gm
  WHERE gm.user_id = p_guest_user_id
    AND EXISTS (
      SELECT 1 FROM public.group_members kept
      WHERE kept.group_id = gm.group_id AND kept.user_id = v_caller
    );
  UPDATE public.group_members SET user_id = v_caller WHERE user_id = p_guest_user_id;

  UPDATE public.participants p
  SET user_id = NULL
  WHERE p.user_id = p_guest_user_id
    AND EXISTS (
      SELECT 1 FROM public.participants other
      WHERE other.group_id = p.group_id
        AND other.user_id = v_caller
        AND other.id <> p.id
    );
  UPDATE public.participants SET user_id = v_caller WHERE user_id = p_guest_user_id;

  UPDATE public.transactions SET user_id = v_caller WHERE user_id = p_guest_user_id;
  UPDATE public.settlements SET created_by = v_caller WHERE created_by = p_guest_user_id;
  UPDATE public.transaction_history SET changed_by = v_caller WHERE changed_by = p_guest_user_id;

  IF to_regclass('public.bill_split_sessions') IS NOT NULL THEN
    UPDATE public.bill_split_sessions SET created_by = v_caller WHERE created_by = p_guest_user_id;
  END IF;
  IF to_regclass('public.group_invitations') IS NOT NULL THEN
    UPDATE public.group_invitations SET invited_by = v_caller WHERE invited_by = p_guest_user_id;
  END IF;

  SELECT preferred_currency INTO v_guest_currency FROM public.profiles WHERE id = p_guest_user_id;
  SELECT preferred_currency INTO v_permanent_currency FROM public.profiles WHERE id = v_caller;
  IF v_permanent_currency IS NULL AND v_guest_currency IS NOT NULL THEN
    UPDATE public.profiles
    SET preferred_currency = v_guest_currency
    WHERE id = v_caller AND preferred_currency IS NULL;
  END IF;

  v_result := jsonb_build_object(
    'guest_user_id', p_guest_user_id,
    'permanent_user_id', v_caller,
    'groups_moved', v_groups,
    'expenses_moved', v_expenses,
    'payments_moved', v_payments,
    'renamed_groups', v_renamed,
    'already_merged', false
  );

  INSERT INTO public.guest_merges (guest_user_id, permanent_user_id, result)
  VALUES (p_guest_user_id, v_caller, v_result);

  UPDATE public.guest_merge_tokens
  SET used_at = now()
  WHERE token_hash = v_hash AND guest_user_id = p_guest_user_id;

  -- Last. A failure above rolls this back with the rest of the function.
  DELETE FROM auth.users WHERE id = p_guest_user_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_into_user(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_guest_into_user(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.merge_guest_into_user(uuid, text) IS
  'Moves a guest ledger onto the signed-in account in one transaction. Does not update or delete rows already owned by that account, except filling a null preferred currency. Same-name groups get a (guest) suffix.';

CREATE OR REPLACE FUNCTION public.discard_guest_data(p_guest_user_id uuid, p_merge_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_hash text := public.guest_token_hash(p_merge_token);
BEGIN
  IF v_caller IS NULL OR v_caller = p_guest_user_id OR public.current_user_is_guest() THEN
    RAISE EXCEPTION 'GUEST_MERGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.guest_merge_tokens t
  WHERE t.token_hash = v_hash
    AND t.guest_user_id = p_guest_user_id
    AND t.used_at IS NULL
    AND t.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_guest_user_id)
       AND EXISTS (
         SELECT 1 FROM public.guest_merge_tokens t
         WHERE t.token_hash = v_hash AND t.guest_user_id = p_guest_user_id AND t.used_at IS NOT NULL
       ) THEN
      RETURN jsonb_build_object('discarded', true, 'already', true);
    END IF;
    RAISE EXCEPTION 'GUEST_MERGE_TOKEN_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.user_is_anonymous(p_guest_user_id) THEN
    RAISE EXCEPTION 'GUEST_MERGE_NOT_GUEST' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.guest_merge_tokens
  SET used_at = now()
  WHERE token_hash = v_hash AND guest_user_id = p_guest_user_id;

  DELETE FROM auth.users WHERE id = p_guest_user_id AND id <> v_caller;
  RETURN jsonb_build_object('discarded', true, 'already', false);
END;
$$;

REVOKE ALL ON FUNCTION public.discard_guest_data(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_guest_data(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_own_guest_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_guest() OR NOT public.user_is_anonymous(v_uid) THEN
    RAISE EXCEPTION 'GUEST_SIGNIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  DELETE FROM auth.users WHERE id = v_uid;
  RETURN jsonb_build_object('deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_guest_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_guest_data() TO authenticated;

-- Code path only. cleanup_enabled defaults false, and this is not scheduled.
CREATE OR REPLACE FUNCTION public.purge_inactive_guests(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enabled boolean := false;
  v_id uuid;
  v_count integer := 0;
BEGIN
  SELECT cleanup_enabled INTO v_enabled
  FROM public.guest_runtime_config
  WHERE singleton = true;
  IF coalesce(v_enabled, false) IS NOT TRUE THEN
    RETURN 0;
  END IF;

  FOR v_id IN
    SELECT p.id
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.last_guest_activity_at IS NOT NULL
      AND p.last_guest_activity_at < p_now - interval '60 days'
      AND (
        coalesce((to_jsonb(u) ->> 'is_anonymous')::boolean, false)
        OR coalesce(u.raw_app_meta_data ->> 'provider', '') = 'anonymous'
      )
  LOOP
    DELETE FROM auth.users WHERE id = v_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_inactive_guests(timestamptz) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.purge_inactive_guests(timestamptz) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.purge_inactive_guests(timestamptz) IS
  'Deletes anonymous users with no write activity for 60 days. Returns 0 unless guest_runtime_config.cleanup_enabled is true. Not scheduled.';
