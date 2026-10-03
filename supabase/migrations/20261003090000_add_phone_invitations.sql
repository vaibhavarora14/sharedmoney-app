-- Phone-based group invitations
-- Created: 2026-10-03
--
-- Adds V1 support for pending invitations addressed by E.164 phone number.
-- Link invites still use rows with both email and phone NULL.

BEGIN;

ALTER TABLE public.group_invitations
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_group_invitations_phone
  ON public.group_invitations(phone)
  WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_invitations_unique_pending_phone
  ON public.group_invitations(group_id, phone)
  WHERE status = 'pending' AND phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_phone
  ON public.profiles(phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_participants_phone
  ON public.participants(phone)
  WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_unique_group_phone
  ON public.participants(group_id, phone)
  WHERE phone IS NOT NULL;

ALTER TABLE public.group_invitations
  DROP CONSTRAINT IF EXISTS group_invitations_phone_e164;

ALTER TABLE public.group_invitations
  ADD CONSTRAINT group_invitations_phone_e164
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE public.participants
  DROP CONSTRAINT IF EXISTS participants_phone_e164;

ALTER TABLE public.participants
  ADD CONSTRAINT participants_phone_e164
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE public.participants
  DROP CONSTRAINT IF EXISTS check_participant_type_member;

ALTER TABLE public.participants
  ADD CONSTRAINT check_participant_type_member
  CHECK (
    (
      type = 'member'
      AND (
        (user_id IS NOT NULL AND email IS NULL)
        OR (
          user_id IS NULL
          AND NULLIF(BTRIM(COALESCE(full_name, '')), '') IS NOT NULL
        )
      )
    )
    OR (
      type = 'invited'
      AND user_id IS NULL
      AND (email IS NOT NULL OR phone IS NOT NULL)
    )
    OR (
      type = 'former'
      AND (
        user_id IS NOT NULL
        OR NULLIF(BTRIM(COALESCE(full_name, '')), '') IS NOT NULL
      )
    )
  );

CREATE OR REPLACE FUNCTION public.auto_create_participant_for_invitation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    IF NEW.email IS NOT NULL THEN
      PERFORM public.sync_participant_state(NEW.group_id, NULL, NEW.email, 'member', 'invited');
    ELSIF NEW.phone IS NOT NULL THEN
      INSERT INTO public.participants (group_id, phone, type, role)
      VALUES (NEW.group_id, NEW.phone, 'invited', 'member')
      ON CONFLICT (group_id, phone) WHERE phone IS NOT NULL
      DO UPDATE SET
        type = EXCLUDED.type,
        role = COALESCE(EXCLUDED.role, public.participants.role),
        updated_at = CURRENT_TIMESTAMP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON COLUMN public.group_invitations.phone IS
  'Invitee phone number in E.164 format; NULL for email and share-link invites.';

COMMENT ON COLUMN public.participants.phone IS
  'Phone number in E.164 format for phone-invited participants without an account.';

COMMIT;
