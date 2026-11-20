-- Household recurring expense templates (#333).
-- Product choice: remind, do not auto-post. A due cycle is added or skipped
-- by a group member. Pausing stops future reminders until resumed.

CREATE TABLE IF NOT EXISTS public.recurring_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 80),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (char_length(currency) = 3),
  category TEXT,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'yearly')),
  anchor_date DATE NOT NULL,
  paid_by_participant_id UUID REFERENCES public.participants(id) ON DELETE SET NULL,
  split_among_participant_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recurring_templates_group_id_idx
  ON public.recurring_templates (group_id, status);

COMMENT ON TABLE public.recurring_templates IS
  'Household recurring expense templates for a group. Due cycles remind members to add or skip; they do not auto-post an expense.';

CREATE TABLE IF NOT EXISTS public.recurring_template_cycles (
  template_id UUID NOT NULL REFERENCES public.recurring_templates(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('added', 'skipped')),
  transaction_id INTEGER REFERENCES public.transactions(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (template_id, period_key)
);

COMMENT ON TABLE public.recurring_template_cycles IS
  'Decided cycles for a recurring template. A missing row means the current period is still open.';

ALTER TABLE public.recurring_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_template_cycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recurring_templates FROM anon;
REVOKE ALL ON TABLE public.recurring_template_cycles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recurring_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recurring_template_cycles TO authenticated;

DROP POLICY IF EXISTS recurring_templates_select_members ON public.recurring_templates;
CREATE POLICY recurring_templates_select_members
  ON public.recurring_templates
  FOR SELECT
  TO authenticated
  USING (public.is_user_group_member(group_id, auth.uid()));

DROP POLICY IF EXISTS recurring_templates_write_active_members ON public.recurring_templates;
CREATE POLICY recurring_templates_insert_active_members
  ON public.recurring_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = recurring_templates.group_id
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
    )
  );

CREATE POLICY recurring_templates_update_active_members
  ON public.recurring_templates
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = recurring_templates.group_id
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = recurring_templates.group_id
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
    )
  );

CREATE POLICY recurring_templates_delete_active_members
  ON public.recurring_templates
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = recurring_templates.group_id
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
    )
  );

DROP POLICY IF EXISTS recurring_template_cycles_select_members ON public.recurring_template_cycles;
CREATE POLICY recurring_template_cycles_select_members
  ON public.recurring_template_cycles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recurring_templates t
      WHERE t.id = recurring_template_cycles.template_id
        AND public.is_user_group_member(t.group_id, auth.uid())
    )
  );

CREATE POLICY recurring_template_cycles_insert_active_members
  ON public.recurring_template_cycles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    decided_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.recurring_templates t
      JOIN public.group_members gm ON gm.group_id = t.group_id
      WHERE t.id = recurring_template_cycles.template_id
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
    )
  );
