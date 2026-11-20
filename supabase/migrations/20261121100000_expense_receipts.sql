-- Expense receipt photos (#416). Private storage; group members only.
-- OCR / scan-to-prefill stays out of scope (#318).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.transaction_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id INTEGER NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transaction_receipts_content_type_check
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  CONSTRAINT transaction_receipts_path_format_check
    CHECK (storage_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp)$')
);

CREATE INDEX IF NOT EXISTS transaction_receipts_transaction_id_idx
  ON public.transaction_receipts (transaction_id, sort_order, created_at);

COMMENT ON TABLE public.transaction_receipts IS
  'Photos attached to an expense. Files live in the private expense-receipts bucket. Group members may read; active members may add or delete. OCR is out of scope.';

ALTER TABLE public.transaction_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transaction_receipts FROM anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.transaction_receipts TO authenticated;

DROP POLICY IF EXISTS transaction_receipts_select_members ON public.transaction_receipts;
CREATE POLICY transaction_receipts_select_members
  ON public.transaction_receipts
  FOR SELECT
  TO authenticated
  USING (public.is_user_group_member(group_id, auth.uid()));

DROP POLICY IF EXISTS transaction_receipts_insert_active_members ON public.transaction_receipts;
CREATE POLICY transaction_receipts_insert_active_members
  ON public.transaction_receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.transactions t
      WHERE t.id = transaction_receipts.transaction_id
        AND t.group_id = transaction_receipts.group_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = transaction_receipts.group_id
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
    )
  );

DROP POLICY IF EXISTS transaction_receipts_delete_active_members ON public.transaction_receipts;
CREATE POLICY transaction_receipts_delete_active_members
  ON public.transaction_receipts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = transaction_receipts.group_id
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_transaction_receipt_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.transaction_receipts
    WHERE transaction_id = NEW.transaction_id
  ) >= 8 THEN
    RAISE EXCEPTION 'A transaction can have at most 8 receipts';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transaction_receipts_limit ON public.transaction_receipts;
CREATE TRIGGER transaction_receipts_limit
  BEFORE INSERT ON public.transaction_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_transaction_receipt_limit();

CREATE OR REPLACE FUNCTION public.delete_expense_receipt_object()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = storage, public
AS $$
BEGIN
  DELETE FROM storage.objects
  WHERE bucket_id = 'expense-receipts'
    AND name = OLD.storage_path;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS transaction_receipts_delete_object ON public.transaction_receipts;
CREATE TRIGGER transaction_receipts_delete_object
  AFTER DELETE ON public.transaction_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_expense_receipt_object();

CREATE OR REPLACE FUNCTION public.expense_receipt_object_group_id(object_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = storage, public
AS $$
DECLARE
  parts text[];
BEGIN
  parts := storage.foldername(object_name);
  IF parts IS NULL OR array_length(parts, 1) < 1 THEN
    RETURN NULL;
  END IF;
  IF parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN parts[1]::uuid;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.expense_receipt_object_group_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expense_receipt_object_group_id(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.expense_receipt_object_transaction_id(object_name text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = storage, public
AS $$
DECLARE
  parts text[];
BEGIN
  parts := storage.foldername(object_name);
  IF parts IS NULL OR array_length(parts, 1) < 2 THEN
    RETURN NULL;
  END IF;
  IF parts[2] !~ '^[0-9]+$' THEN
    RETURN NULL;
  END IF;
  RETURN parts[2]::integer;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.expense_receipt_object_transaction_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expense_receipt_object_transaction_id(text) TO authenticated;

DROP POLICY IF EXISTS expense_receipts_select_members ON storage.objects;
CREATE POLICY expense_receipts_select_members
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.is_user_group_member(public.expense_receipt_object_group_id(name), auth.uid())
  );

DROP POLICY IF EXISTS expense_receipts_insert_active_members ON storage.objects;
CREATE POLICY expense_receipts_insert_active_members
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = public.expense_receipt_object_group_id(name)
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
    )
    AND EXISTS (
      SELECT 1
      FROM public.transactions t
      WHERE t.id = public.expense_receipt_object_transaction_id(name)
        AND t.group_id = public.expense_receipt_object_group_id(name)
    )
  );

DROP POLICY IF EXISTS expense_receipts_delete_active_members ON storage.objects;
CREATE POLICY expense_receipts_delete_active_members
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = public.expense_receipt_object_group_id(name)
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
    )
  );
