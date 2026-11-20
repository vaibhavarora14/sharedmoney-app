-- Per-group automatic balance nudges (#417).
-- Default is off. Push (and existing monthly email dedupe) only. WhatsApp is out of scope.
-- Weekly: Mondays 09:00 UTC. Monthly: the 1st at 09:00 UTC.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS balance_nudge_cadence TEXT NOT NULL DEFAULT 'off';

ALTER TABLE public.groups
  DROP CONSTRAINT IF EXISTS groups_balance_nudge_cadence_check;

ALTER TABLE public.groups
  ADD CONSTRAINT groups_balance_nudge_cadence_check
  CHECK (balance_nudge_cadence IN ('off', 'weekly', 'monthly'));

COMMENT ON COLUMN public.groups.balance_nudge_cadence IS
  'Automatic balance nudges for members who owe. Default off. weekly = Mondays 09:00 UTC; monthly = 1st 09:00 UTC. Push only; WhatsApp is out of scope.';

CREATE TABLE IF NOT EXISTS public.group_balance_nudge_mutes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  muted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, group_id)
);

CREATE INDEX IF NOT EXISTS group_balance_nudge_mutes_group_id_idx
  ON public.group_balance_nudge_mutes (group_id);

COMMENT ON TABLE public.group_balance_nudge_mutes IS
  'Per-user mute for automatic balance nudges in a group.';

ALTER TABLE public.group_balance_nudge_mutes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.group_balance_nudge_mutes FROM anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.group_balance_nudge_mutes TO authenticated;

DROP POLICY IF EXISTS group_balance_nudge_mutes_select_own ON public.group_balance_nudge_mutes;
CREATE POLICY group_balance_nudge_mutes_select_own
  ON public.group_balance_nudge_mutes
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS group_balance_nudge_mutes_insert_own ON public.group_balance_nudge_mutes;
CREATE POLICY group_balance_nudge_mutes_insert_own
  ON public.group_balance_nudge_mutes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.group_members
      WHERE group_members.group_id = group_balance_nudge_mutes.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
    )
  );

DROP POLICY IF EXISTS group_balance_nudge_mutes_delete_own ON public.group_balance_nudge_mutes;
CREATE POLICY group_balance_nudge_mutes_delete_own
  ON public.group_balance_nudge_mutes
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.balance_nudge_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push')),
  day_key TEXT NOT NULL CHECK (day_key ~ '^\d{4}-\d{2}-\d{2}$'),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT balance_nudge_deliveries_unique
    UNIQUE (user_id, group_id, currency, channel, day_key)
);

CREATE INDEX IF NOT EXISTS balance_nudge_deliveries_day_key_idx
  ON public.balance_nudge_deliveries (day_key, status);

COMMENT ON TABLE public.balance_nudge_deliveries IS
  'Dedupe log for automatic balance nudge pushes.';

ALTER TABLE public.balance_nudge_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.balance_nudge_deliveries FROM anon, authenticated;

-- Daily 09:00 UTC invocation of the existing monthly-reminders function with
-- job=balance_nudges. Reuses monthly_reminders_function_url and
-- monthly_reminders_cron_secret. Emails stay on the 1st-of-month cron.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  ) THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'balance-nudges';

    PERFORM cron.schedule(
      'balance-nudges',
      '0 9 * * *',
      $cron$
        SELECT net.http_post(
          url := (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'monthly_reminders_function_url'
          ),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-reminder-cron-secret', (
              SELECT decrypted_secret
              FROM vault.decrypted_secrets
              WHERE name = 'monthly_reminders_cron_secret'
            )
          ),
          body := jsonb_build_object('scheduled_at', NOW(), 'job', 'balance_nudges')
        ) AS request_id;
      $cron$
    );
  END IF;
END
$$;
