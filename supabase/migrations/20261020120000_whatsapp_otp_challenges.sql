-- WhatsApp OTP login challenges (feature-flagged; not applied to hosted DB by this agent).
-- Service-role edge functions own all access. Explicit GRANTs required for new public tables.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL
    CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash text NOT NULL
    CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5
    CHECK (max_attempts > 0),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_fingerprint text
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_otp_challenges_phone_created
  ON public.whatsapp_otp_challenges (phone_e164, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_otp_challenges_phone_active
  ON public.whatsapp_otp_challenges (phone_e164, expires_at DESC)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE public.whatsapp_otp_challenges IS
  'Hashed WhatsApp login OTPs. Readable/writable only by service_role via edge functions.';

ALTER TABLE public.whatsapp_otp_challenges ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated: clients never touch this table directly.
REVOKE ALL ON TABLE public.whatsapp_otp_challenges FROM PUBLIC;
REVOKE ALL ON TABLE public.whatsapp_otp_challenges FROM anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_otp_challenges TO service_role;
GRANT ALL ON TABLE public.whatsapp_otp_challenges TO postgres;

COMMIT;
