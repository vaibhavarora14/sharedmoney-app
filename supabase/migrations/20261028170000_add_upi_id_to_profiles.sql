-- Optional UPI VPA on profiles for settle "Pay via UPI".
-- Own-row write stays on existing update policy. Co-members may SELECT
-- a shared-group profile (membership RLS) so settle can read upi_id;
-- nobody outside a shared active membership can.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS upi_id TEXT;

COMMENT ON COLUMN public.profiles.upi_id IS
  'Optional UPI VPA (e.g. name@okhdfc). Visible to co-members for settle Pay via UPI.';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_upi_id_format;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_upi_id_format
  CHECK (
    upi_id IS NULL
    OR (
      char_length(upi_id) BETWEEN 3 AND 80
      AND upi_id !~ '[[:space:]]'
      AND upi_id ~ '^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,62}[a-zA-Z0-9])?@[a-zA-Z][a-zA-Z0-9]{1,63}$'
    )
  );

-- Co-members of an active group can read profile rows (including upi_id).
-- SELECT policies are OR'd with "Users can view own profile".
DROP POLICY IF EXISTS "Group co-members can view profiles" ON public.profiles;
CREATE POLICY "Group co-members can view profiles"
  ON public.profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_members AS me
      INNER JOIN public.group_members AS them
        ON them.group_id = me.group_id
      WHERE me.user_id = auth.uid()
        AND me.status = 'active'
        AND them.user_id = profiles.id
        AND them.status = 'active'
    )
  );

-- Table privileges already grant SELECT/UPDATE to authenticated
-- (see 20260818110000_restore_profile_api_privileges.sql). Reaffirm for clarity.
REVOKE ALL ON TABLE public.profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
