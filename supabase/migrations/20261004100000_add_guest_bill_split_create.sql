-- Local-only follow-up for the public /split form. Not applied to hosted Supabase.
-- Account-backed creation and bearer-token read/confirm rules stay unchanged.
ALTER TABLE public.bill_split_sessions ALTER COLUMN created_by DROP NOT NULL;

CREATE FUNCTION public.create_guest_bill_split_session(
  p_amount_minor bigint,
  p_currency text,
  p_people text[],
  p_mode text DEFAULT 'equal',
  p_values bigint[] DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_names text[];
  v_count integer;
  v_weights bigint[];
  v_weight bigint;
  v_amounts bigint[];
  v_session uuid;
  v_token text;
  v_i integer;
BEGIN
  IF p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 1000000000 THEN
    RAISE EXCEPTION 'Invalid bill amount';
  END IF;
  IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Invalid currency'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('equal', 'shares', 'unequal') THEN RAISE EXCEPTION 'Invalid split mode'; END IF;
  IF p_people IS NULL OR cardinality(p_people) NOT BETWEEN 2 AND 50 OR array_ndims(p_people) <> 1 THEN
    RAISE EXCEPTION 'Include 2–50 people, including yourself';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_people) AS n WHERE n IS NULL OR length(btrim(n)) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'Enter a name for each person (up to 100 characters)';
  END IF;

  -- Anonymous sessions contain only the supplied display names, never user IDs.
  SELECT array_agg(btrim(n) ORDER BY ord)
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
    VALUES (NULL, p_amount_minor, p_currency, p_mode) RETURNING id, token INTO v_session, v_token;
  FOR v_i IN 1..v_count LOOP
    INSERT INTO public.bill_split_participants(session_id, position, display_name, amount_minor)
      VALUES (v_session, v_i, v_names[v_i], v_amounts[v_i]);
  END LOOP;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_guest_bill_split_session(bigint, text, text[], text, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_guest_bill_split_session(bigint, text, text[], text, bigint[]) TO anon, authenticated;
