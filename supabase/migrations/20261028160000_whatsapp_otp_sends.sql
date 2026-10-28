-- WhatsApp OTP monthly send ledger + atomic reserve (budget + rate limits).
-- Service-role edge functions own all access. Explicit GRANTs required for new public tables.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_otp_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  phone_e164 text NOT NULL
    CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  country_code text NOT NULL
    CHECK (country_code ~ '^[0-9]{1,4}$'),
  ip_hash text,
  est_cost_inr numeric(10, 4) NOT NULL
    CHECK (est_cost_inr >= 0),
  status text NOT NULL
    CHECK (status IN ('reserved', 'accepted', 'failed')),
  meta_message_id text,
  budget_month text NOT NULL
    CHECK (budget_month ~ '^[0-9]{4}-[0-9]{2}$')
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_otp_sends_budget_month_status
  ON public.whatsapp_otp_sends (budget_month, status);

CREATE INDEX IF NOT EXISTS idx_whatsapp_otp_sends_phone_created
  ON public.whatsapp_otp_sends (phone_e164, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_otp_sends_ip_created
  ON public.whatsapp_otp_sends (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

COMMENT ON TABLE public.whatsapp_otp_sends IS
  'WhatsApp OTP send ledger for monthly INR budget + abuse limits. Service role only.';

ALTER TABLE public.whatsapp_otp_sends ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated: clients never touch this table directly.
REVOKE ALL ON TABLE public.whatsapp_otp_sends FROM PUBLIC;
REVOKE ALL ON TABLE public.whatsapp_otp_sends FROM anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_otp_sends TO service_role;
GRANT ALL ON TABLE public.whatsapp_otp_sends TO postgres;

/**
 * Atomically reserve one OTP send against the IST monthly budget and
 * race-safe per-phone / per-IP rate limits.
 *
 * Raises with message prefixes the edge function maps to HTTP responses:
 *   WHATSAPP_BUDGET_EXHAUSTED
 *   RATE_LIMITED:cooldown:<seconds>
 *   RATE_LIMITED:hourly
 *   RATE_LIMITED:ip_hourly
 */
CREATE OR REPLACE FUNCTION public.reserve_whatsapp_otp_send(
  p_phone_e164 text,
  p_country_code text,
  p_ip_hash text,
  p_est_cost_inr numeric,
  p_budget_inr numeric,
  p_cooldown_seconds integer DEFAULT 60,
  p_max_sends_per_hour integer DEFAULT 5,
  p_max_sends_per_ip_hour integer DEFAULT 10
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget_month text;
  v_spent numeric(12, 4);
  v_latest_created timestamptz;
  v_phone_hourly integer;
  v_ip_hourly integer;
  v_wait_sec integer;
  v_id uuid;
BEGIN
  IF p_phone_e164 IS NULL OR p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'VALIDATION:invalid_phone';
  END IF;
  IF p_country_code IS NULL OR p_country_code !~ '^[0-9]{1,4}$' THEN
    RAISE EXCEPTION 'VALIDATION:invalid_country';
  END IF;
  IF p_est_cost_inr IS NULL OR p_est_cost_inr < 0 OR p_budget_inr IS NULL OR p_budget_inr < 0 THEN
    RAISE EXCEPTION 'WHATSAPP_BUDGET_EXHAUSTED';
  END IF;
  IF p_cooldown_seconds IS NULL OR p_cooldown_seconds < 0
     OR p_max_sends_per_hour IS NULL OR p_max_sends_per_hour < 0
     OR p_max_sends_per_ip_hour IS NULL OR p_max_sends_per_ip_hour < 0 THEN
    RAISE EXCEPTION 'WHATSAPP_BUDGET_EXHAUSTED';
  END IF;

  -- Serialize all OTP send reservations (low volume; fail-closed budget).
  PERFORM pg_advisory_xact_lock(87201401);

  v_budget_month := to_char((now() AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM');

  SELECT COALESCE(SUM(s.est_cost_inr), 0)
    INTO v_spent
  FROM public.whatsapp_otp_sends s
  WHERE s.budget_month = v_budget_month
    AND s.status <> 'failed';

  IF v_spent + p_est_cost_inr > p_budget_inr THEN
    RAISE EXCEPTION 'WHATSAPP_BUDGET_EXHAUSTED';
  END IF;

  SELECT c.created_at
    INTO v_latest_created
  FROM public.whatsapp_otp_challenges c
  WHERE c.phone_e164 = p_phone_e164
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_latest_created IS NOT NULL
     AND v_latest_created > now() - make_interval(secs => p_cooldown_seconds) THEN
    v_wait_sec := CEIL(
      EXTRACT(EPOCH FROM (v_latest_created + make_interval(secs => p_cooldown_seconds) - now()))
    )::integer;
    IF v_wait_sec < 1 THEN
      v_wait_sec := 1;
    END IF;
    RAISE EXCEPTION 'RATE_LIMITED:cooldown:%', v_wait_sec;
  END IF;

  SELECT COUNT(*)::integer
    INTO v_phone_hourly
  FROM public.whatsapp_otp_challenges c
  WHERE c.phone_e164 = p_phone_e164
    AND c.created_at >= now() - interval '1 hour';

  IF v_phone_hourly >= p_max_sends_per_hour THEN
    RAISE EXCEPTION 'RATE_LIMITED:hourly';
  END IF;

  IF p_ip_hash IS NOT NULL AND length(p_ip_hash) > 0 THEN
    SELECT COUNT(*)::integer
      INTO v_ip_hourly
    FROM public.whatsapp_otp_sends s
    WHERE s.ip_hash = p_ip_hash
      AND s.created_at >= now() - interval '1 hour';

    IF v_ip_hourly >= p_max_sends_per_ip_hour THEN
      RAISE EXCEPTION 'RATE_LIMITED:ip_hourly';
    END IF;
  END IF;

  INSERT INTO public.whatsapp_otp_sends (
    phone_e164,
    country_code,
    ip_hash,
    est_cost_inr,
    status,
    budget_month
  ) VALUES (
    p_phone_e164,
    p_country_code,
    NULLIF(p_ip_hash, ''),
    p_est_cost_inr,
    'reserved',
    v_budget_month
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_whatsapp_otp_send(
  text, text, text, numeric, numeric, integer, integer, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_whatsapp_otp_send(
  text, text, text, numeric, numeric, integer, integer, integer
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_whatsapp_otp_send(
  text, text, text, numeric, numeric, integer, integer, integer
) TO service_role;

COMMENT ON FUNCTION public.reserve_whatsapp_otp_send(
  text, text, text, numeric, numeric, integer, integer, integer
) IS
  'Atomically reserves a WhatsApp OTP send against IST monthly budget and phone/IP rate limits. Service role only.';

COMMIT;
