-- Multiple payers per expense.
-- Additive: keep transactions.paid_by_participant_id as the primary/compat
-- payer, and store every paid allocation in transaction_payers (mirrors
-- transaction_splits). Existing single-payer rows are backfilled 1:1.

CREATE TABLE IF NOT EXISTS public.transaction_payers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id INTEGER NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (transaction_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_payers_transaction
  ON public.transaction_payers (transaction_id);

CREATE INDEX IF NOT EXISTS idx_transaction_payers_participant
  ON public.transaction_payers (participant_id);

COMMENT ON TABLE public.transaction_payers IS
  'Who paid how much of an expense. Sum of amounts must equal the expense total when any rows exist.';
COMMENT ON COLUMN public.transaction_payers.amount IS
  'Paid amount in the expense currency, in major units with 2 decimal places (same as transaction_splits).';

ALTER TABLE public.transaction_payers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payers for accessible transactions"
  ON public.transaction_payers
  FOR SELECT
  USING (
    transaction_id IN (
      SELECT id FROM public.transactions
      WHERE user_id = auth.uid()
      OR (group_id IS NOT NULL AND group_id IN (
        SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
      ))
    )
  );

CREATE POLICY "Users can create payers for group transactions"
  ON public.transaction_payers
  FOR INSERT
  WITH CHECK (
    transaction_id IN (
      SELECT id FROM public.transactions
      WHERE user_id = auth.uid()
      OR (group_id IS NOT NULL AND public.is_user_group_member(group_id, auth.uid()))
    )
  );

CREATE POLICY "Users can update payers for group transactions"
  ON public.transaction_payers
  FOR UPDATE
  USING (
    transaction_id IN (
      SELECT id FROM public.transactions
      WHERE user_id = auth.uid()
      OR (group_id IS NOT NULL AND public.is_user_group_member(group_id, auth.uid()))
    )
  );

CREATE POLICY "Users can delete payers for group transactions"
  ON public.transaction_payers
  FOR DELETE
  USING (
    transaction_id IN (
      SELECT id FROM public.transactions
      WHERE user_id = auth.uid()
      OR (group_id IS NOT NULL AND public.is_user_group_member(group_id, auth.uid()))
    )
  );

REVOKE ALL ON TABLE public.transaction_payers FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transaction_payers TO authenticated;

GRANT ALL ON TABLE public.transaction_payers TO service_role;

-- Backfill: every current expense becomes one payer row for the recorded payer.
INSERT INTO public.transaction_payers (transaction_id, participant_id, amount)
SELECT t.id, t.paid_by_participant_id, t.amount
FROM public.transactions t
WHERE t.type = 'expense'
  AND t.paid_by_participant_id IS NOT NULL
ON CONFLICT (transaction_id, participant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.transaction_payer_rows_match_total(p_transaction_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total numeric;
  v_paid numeric;
BEGIN
  SELECT amount INTO v_total
  FROM public.transactions
  WHERE id = p_transaction_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.transaction_payers
  WHERE transaction_id = p_transaction_id;

  IF v_paid = 0 THEN
    RETURN;
  END IF;

  IF abs(v_paid - v_total) > 0.01 THEN
    RAISE EXCEPTION 'Payer amounts must add up to the expense total'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_transaction_payers_match_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx_id integer;
BEGIN
  v_tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  PERFORM public.transaction_payer_rows_match_total(v_tx_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_transaction_amount_matches_payers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.transaction_payer_rows_match_total(NEW.id);
  RETURN NEW;
END;
$$;

-- Allow inserting the transaction first, then its payer rows, in one statement
-- batch. Empty payer sets stay valid so legacy single-payer writes can land
-- before the compatibility backfill/API row is written.
CREATE CONSTRAINT TRIGGER transaction_payers_sum_matches_total
AFTER INSERT OR UPDATE OR DELETE ON public.transaction_payers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_transaction_payers_match_total();

CREATE CONSTRAINT TRIGGER transaction_amount_matches_payers
AFTER UPDATE OF amount ON public.transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_transaction_amount_matches_payers();

CREATE OR REPLACE FUNCTION public.ensure_transaction_payer_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM 'expense' THEN
    RETURN NEW;
  END IF;
  IF NEW.paid_by_participant_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transaction_payers WHERE transaction_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.transaction_payers (transaction_id, participant_id, amount)
  VALUES (NEW.id, NEW.paid_by_participant_id, NEW.amount);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER ensure_transaction_payer_row
AFTER INSERT OR UPDATE OF amount, paid_by_participant_id, type ON public.transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.ensure_transaction_payer_row();

CREATE OR REPLACE FUNCTION public.merge_participant_into_canonical(
  p_canonical_participant_id UUID,
  p_duplicate_participant_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_canonical_group_id UUID;
  v_duplicate_group_id UUID;
BEGIN
  IF p_canonical_participant_id IS NULL
     OR p_duplicate_participant_id IS NULL
     OR p_canonical_participant_id = p_duplicate_participant_id THEN
    RETURN;
  END IF;

  SELECT group_id INTO v_canonical_group_id
  FROM public.participants
  WHERE id = p_canonical_participant_id
  FOR UPDATE;

  SELECT group_id INTO v_duplicate_group_id
  FROM public.participants
  WHERE id = p_duplicate_participant_id
  FOR UPDATE;

  IF v_canonical_group_id IS NULL
     OR v_duplicate_group_id IS NULL
     OR v_canonical_group_id <> v_duplicate_group_id THEN
    RETURN;
  END IF;

  UPDATE public.participants canonical
  SET
    full_name = COALESCE(canonical.full_name, duplicate.full_name),
    avatar_url = COALESCE(canonical.avatar_url, duplicate.avatar_url),
    role = COALESCE(canonical.role, duplicate.role),
    joined_at = COALESCE(canonical.joined_at, duplicate.joined_at),
    left_at = CASE
      WHEN canonical.type = 'former' THEN COALESCE(canonical.left_at, duplicate.left_at, CURRENT_TIMESTAMP)
      ELSE canonical.left_at
    END,
    updated_at = CURRENT_TIMESTAMP
  FROM public.participants duplicate
  WHERE canonical.id = p_canonical_participant_id
    AND duplicate.id = p_duplicate_participant_id;

  WITH duplicate_splits AS (
    SELECT transaction_id, amount
    FROM public.transaction_splits
    WHERE participant_id = p_duplicate_participant_id
  )
  UPDATE public.transaction_splits canonical_split
  SET amount = canonical_split.amount + duplicate_splits.amount
  FROM duplicate_splits
  WHERE canonical_split.transaction_id = duplicate_splits.transaction_id
    AND canonical_split.participant_id = p_canonical_participant_id;

  UPDATE public.transaction_splits duplicate_split
  SET participant_id = p_canonical_participant_id
  WHERE duplicate_split.participant_id = p_duplicate_participant_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.transaction_splits canonical_split
      WHERE canonical_split.transaction_id = duplicate_split.transaction_id
        AND canonical_split.participant_id = p_canonical_participant_id
    );

  DELETE FROM public.transaction_splits
  WHERE participant_id = p_duplicate_participant_id;

  WITH duplicate_payers AS (
    SELECT transaction_id, amount
    FROM public.transaction_payers
    WHERE participant_id = p_duplicate_participant_id
  )
  UPDATE public.transaction_payers canonical_payer
  SET amount = canonical_payer.amount + duplicate_payers.amount
  FROM duplicate_payers
  WHERE canonical_payer.transaction_id = duplicate_payers.transaction_id
    AND canonical_payer.participant_id = p_canonical_participant_id;

  UPDATE public.transaction_payers duplicate_payer
  SET participant_id = p_canonical_participant_id
  WHERE duplicate_payer.participant_id = p_duplicate_participant_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.transaction_payers canonical_payer
      WHERE canonical_payer.transaction_id = duplicate_payer.transaction_id
        AND canonical_payer.participant_id = p_canonical_participant_id
    );

  DELETE FROM public.transaction_payers
  WHERE participant_id = p_duplicate_participant_id;

  UPDATE public.transactions
  SET paid_by_participant_id = p_canonical_participant_id
  WHERE paid_by_participant_id = p_duplicate_participant_id;

  UPDATE public.settlements
  SET from_participant_id = p_canonical_participant_id
  WHERE from_participant_id = p_duplicate_participant_id;

  UPDATE public.settlements
  SET to_participant_id = p_canonical_participant_id
  WHERE to_participant_id = p_duplicate_participant_id;

  DELETE FROM public.participants
  WHERE id = p_duplicate_participant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transaction_payer_rows_match_total(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_transaction_payers_match_total() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_transaction_amount_matches_payers() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_transaction_payer_row() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transaction_payer_rows_match_total(integer) TO service_role;
