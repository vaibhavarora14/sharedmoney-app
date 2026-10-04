-- Issue 319. These sessions never create groups, memberships, or ledger entries.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.bill_split_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex')
    CHECK (token ~ '^[a-f0-9]{64}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  mode text NOT NULL CHECK (mode IN ('equal', 'shares', 'unequal')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

CREATE TABLE public.bill_split_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.bill_split_sessions(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 50),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000),
  confirmed_at timestamptz,
  UNIQUE (session_id, position)
);

ALTER TABLE public.bill_split_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_split_participants ENABLE ROW LEVEL SECURITY;
-- No table policies or list access. A bearer link grants only read/acknowledge.
REVOKE ALL ON public.bill_split_sessions, public.bill_split_participants FROM anon, authenticated;

CREATE FUNCTION public.create_bill_split_session(
  p_amount_minor bigint,
  p_currency text,
  p_people text[],
  p_mode text DEFAULT 'equal',
  p_values bigint[] DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_names text[];
  v_count integer;
  v_weights bigint[];
  v_weight bigint;
  v_amounts bigint[];
  v_session uuid;
  v_token text;
  v_i integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 1000000000 THEN
    RAISE EXCEPTION 'Invalid bill amount';
  END IF;
  IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Invalid currency'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('equal', 'shares', 'unequal') THEN RAISE EXCEPTION 'Invalid split mode'; END IF;
  IF p_people IS NULL OR cardinality(p_people) NOT BETWEEN 1 AND 49 OR array_ndims(p_people) <> 1 THEN
    RAISE EXCEPTION 'Include at least one other person (up to 49)';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_people) AS n WHERE n IS NULL OR length(btrim(n)) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'Enter a name for each person (up to 100 characters)';
  END IF;

  -- Creator is always first; clients cannot omit or rename the creator.
  SELECT left(coalesce(nullif(btrim(full_name), ''), 'Bill creator'), 100)
    INTO v_name FROM public.profiles WHERE id = v_uid;
  SELECT array_prepend(coalesce(v_name, 'Bill creator'), array_agg(btrim(n) ORDER BY ord))
    INTO v_names FROM unnest(p_people) WITH ORDINALITY AS t(n, ord);
  v_count := cardinality(v_names);

  IF p_mode <> 'equal' THEN
    IF p_values IS NULL OR cardinality(p_values) <> v_count OR array_ndims(p_values) <> 1
      OR EXISTS (SELECT 1 FROM unnest(p_values) AS n WHERE n IS NULL OR n <= 0 OR
        n > CASE WHEN p_mode = 'shares' THEN 99 ELSE 1000000000 END) THEN
      RAISE EXCEPTION 'Invalid shares or exact amounts';
    END IF;
  END IF;
  IF p_mode = 'unequal' THEN
    IF (SELECT sum(n) FROM unnest(p_values) AS n) <> p_amount_minor THEN
      RAISE EXCEPTION 'Exact amounts must add up to the total';
    END IF;
    SELECT array_agg(n ORDER BY ord) INTO v_amounts FROM unnest(p_values) WITH ORDINALITY AS t(n, ord);
  ELSE
    v_weights := CASE WHEN p_mode = 'equal' THEN array_fill(1::bigint, ARRAY[v_count]) ELSE p_values END;
    SELECT sum(n) INTO v_weight FROM unnest(v_weights) AS n;
    -- All arithmetic is integer. Largest remainder matches the expense editor;
    -- equal weights give the leftover cents to the earliest participants.
    WITH portions AS (
      SELECT ord, p_amount_minor * n / v_weight AS base,
        p_amount_minor * n % v_weight AS remainder
      FROM unnest(v_weights) WITH ORDINALITY AS t(n, ord)
    ), ranked AS (
      SELECT *, row_number() OVER (ORDER BY remainder DESC, ord) AS rank,
        p_amount_minor - sum(base) OVER () AS leftover FROM portions
    )
    SELECT array_agg(base + CASE WHEN rank <= leftover THEN 1 ELSE 0 END ORDER BY ord)
      INTO v_amounts FROM ranked;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_amounts) AS n WHERE n <= 0) THEN
    RAISE EXCEPTION 'Every person must have at least 0.01';
  END IF;

  INSERT INTO public.bill_split_sessions(created_by, amount_minor, currency, mode)
    VALUES (v_uid, p_amount_minor, p_currency, p_mode) RETURNING id, token INTO v_session, v_token;
  FOR v_i IN 1..v_count LOOP
    INSERT INTO public.bill_split_participants(session_id, position, display_name, amount_minor)
      VALUES (v_session, v_i, v_names[v_i], v_amounts[v_i]);
  END LOOP;
  RETURN v_token;
END;
$$;

CREATE FUNCTION public.get_bill_split_session(p_token text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'amount_minor', s.amount_minor, 'currency', s.currency, 'mode', s.mode,
    'participants', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'display_name', p.display_name, 'amount_minor', p.amount_minor,
        'confirmed', p.confirmed_at IS NOT NULL
      ) ORDER BY p.position)
      FROM public.bill_split_participants p WHERE p.session_id = s.id
    )
  ) FROM public.bill_split_sessions s
  WHERE p_token ~ '^[a-f0-9]{64}$' AND s.token = p_token AND s.expires_at > now();
$$;

CREATE FUNCTION public.confirm_bill_split_share(p_token text, p_participant_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Token possession permits acknowledgement for a named row; it does not
  -- prove identity or payment. Repeated/concurrent requests are idempotent.
  UPDATE public.bill_split_participants p SET confirmed_at = coalesce(p.confirmed_at, now())
  FROM public.bill_split_sessions s
  WHERE p.session_id = s.id AND p.id = p_participant_id
    AND p_token ~ '^[a-f0-9]{64}$' AND s.token = p_token AND s.expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.get_bill_split_session(p_token);
END;
$$;

REVOKE ALL ON FUNCTION public.create_bill_split_session(bigint, text, text[], text, bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_bill_split_session(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_bill_split_share(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bill_split_session(bigint, text, text[], text, bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_bill_split_session(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_bill_split_share(text, uuid) TO anon, authenticated;
