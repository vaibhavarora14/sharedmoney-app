BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

INSERT INTO auth.users (id, email)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'owner@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'member@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'outsider@example.com');

INSERT INTO public.groups (id, name, created_by)
VALUES (
  '44444444-4444-4444-8444-444444444444',
  'Flat 4B',
  '11111111-1111-4111-8111-111111111111'
);

INSERT INTO public.participants (id, group_id, user_id, type, role, full_name)
VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    'member',
    'owner',
    'Aisha'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '44444444-4444-4444-8444-444444444444',
    '22222222-2222-4222-8222-222222222222',
    'member',
    'member',
    'Rohan'
  );

INSERT INTO public.group_members (group_id, user_id, role, status)
VALUES
  (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    'owner',
    'active'
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '22222222-2222-4222-8222-222222222222',
    'member',
    'active'
  );

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.transaction_payers'::regclass
  ),
  'transaction_payers enforces RLS'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.transaction_payers', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon', 'public.transaction_payers', 'SELECT'),
  'authenticated members can mutate payers through RLS; anonymous cannot read them'
);

SELECT ok(
  (
    SELECT prosecdef AND exists (
      SELECT 1
      FROM unnest(coalesce(proconfig, ARRAY[]::text[])) AS cfg
      WHERE cfg LIKE 'search_path=%'
    )
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'transaction_payer_rows_match_total'
  ),
  'payer sum check pins search_path'
);

INSERT INTO public.transactions (
  id,
  amount,
  description,
  date,
  type,
  currency,
  user_id,
  paid_by_participant_id,
  group_id
)
VALUES (
  910552,
  900.00,
  'Friday dinner',
  CURRENT_DATE,
  'expense',
  'INR',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '44444444-4444-4444-8444-444444444444'
);

-- Compatibility: a single-payer expense with no payer rows yet is readable
-- as the original paid_by column, and the helper accepts an empty set.
SELECT lives_ok(
  $$SELECT public.transaction_payer_rows_match_total(910552)$$,
  'expenses without payer rows stay valid for the single-payer fallback'
);

INSERT INTO public.transaction_payers (transaction_id, participant_id, amount)
VALUES (
  910552,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  900.00
);

SELECT is(
  (
    SELECT amount
    FROM public.transaction_payers
    WHERE transaction_id = 910552
      AND participant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  900.00,
  'backfill-equivalent writes one payer row for the full expense total'
);

SELECT lives_ok(
  $$SELECT public.transaction_payer_rows_match_total(910552)$$,
  'a single payer of the full total reconciles'
);

INSERT INTO public.transactions (
  id,
  amount,
  description,
  date,
  type,
  currency,
  user_id,
  paid_by_participant_id,
  group_id
)
VALUES (
  910553,
  4800.00,
  'Thalassa',
  CURRENT_DATE,
  'expense',
  'INR',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '44444444-4444-4444-8444-444444444444'
);

INSERT INTO public.transaction_payers (transaction_id, participant_id, amount)
VALUES
  (910553, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 3000.00),
  (910553, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 1800.00);

SELECT lives_ok(
  $$SELECT public.transaction_payer_rows_match_total(910553)$$,
  'two payers whose amounts sum to the total reconcile'
);

INSERT INTO public.transactions (
  id,
  amount,
  description,
  date,
  type,
  currency,
  user_id,
  paid_by_participant_id,
  group_id
)
VALUES (
  910554,
  100.00,
  'Mismatch',
  CURRENT_DATE,
  'expense',
  'INR',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '44444444-4444-4444-8444-444444444444'
);

INSERT INTO public.transaction_payers (transaction_id, participant_id, amount)
VALUES
  (910554, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 60.00),
  (910554, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 30.00);

SELECT throws_ok(
  $$SELECT public.transaction_payer_rows_match_total(910554)$$,
  '23514',
  'Payer amounts must add up to the expense total',
  'payer amounts that miss the total are rejected'
);

SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.transaction_payers
    WHERE transaction_id = 910553
  ),
  2,
  'a group member can read payer rows for a group expense'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.transaction_payers
    WHERE transaction_id = 910553
  ),
  0,
  'an outsider cannot read payer rows'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    INSERT INTO public.transaction_payers (transaction_id, participant_id, amount)
    VALUES (
      910552,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      1.00
    )
  $$,
  'a group member can insert a payer row (sum is checked at commit)'
);

RESET ROLE;

SELECT is(
  (
    SELECT prosecdef AND exists (
      SELECT 1
      FROM unnest(coalesce(proconfig, ARRAY[]::text[])) AS cfg
      WHERE cfg LIKE 'search_path=%'
    )
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'merge_participant_into_canonical'
  ),
  true,
  'participant merge pins search_path after gaining payer rows'
);

SELECT * FROM finish();
ROLLBACK;
