BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);

INSERT INTO auth.users (id, email)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'owner@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'kabir@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'outsider@example.com');

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.create_or_get_direct_group(uuid, text, text, text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.create_or_get_direct_group(uuid, text, text, text)',
    'EXECUTE'
  ),
  'only signed-in users can open a direct ledger'
);

SELECT ok(
  (
    SELECT p.prosecdef
      AND EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg = 'search_path=public, pg_temp'
      )
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_or_get_direct_group'
  ),
  'create_or_get_direct_group is security definer with a pinned search_path'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok(
  $$SELECT public.create_or_get_direct_group(NULL, 'Kabir', NULL, NULL)$$,
  'P0001',
  'Not authenticated',
  'a signed-out call cannot create a direct ledger'
);

DO $$
BEGIN
  SET CONSTRAINTS direct_group_requires_key IMMEDIATE;
  BEGIN
    INSERT INTO public.groups (name, created_by, kind)
    VALUES (
      'Nope',
      '11111111-1111-4111-8111-111111111111',
      'direct'
    );
    RAISE EXCEPTION 'direct insert was allowed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%create_or_get_direct_group%' THEN
        RAISE;
      END IF;
  END;
  SET CONSTRAINTS direct_group_requires_key DEFERRED;
END;
$$;

SELECT pass('a direct group without a key is rejected');

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SET LOCAL ROLE authenticated;
SELECT is(
  (public.create_or_get_direct_group(NULL, 'Kabir', NULL, NULL) ->> 'created')::boolean,
  true,
  'the first name-only person creates a direct ledger'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT is(
  (
    SELECT (public.create_or_get_direct_group(NULL, '  kabir ', NULL, NULL) ->> 'group_id')
      = (
        SELECT k.group_id::text
        FROM public.direct_group_keys k
        WHERE k.owner_user_id = '11111111-1111-4111-8111-111111111111'
          AND k.name_key = 'kabir'
      )
  ),
  true,
  'the same name opens the same direct ledger'
);
RESET ROLE;

SELECT is(
  (
    SELECT count(*)
    FROM public.participants p
    JOIN public.direct_group_keys k ON k.group_id = p.group_id
    WHERE k.name_key = 'kabir'
  ),
  2::bigint,
  'a direct ledger has the owner and one name-only person'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.participants p
    JOIN public.direct_group_keys k ON k.group_id = p.group_id
    WHERE k.name_key = 'kabir'
      AND p.user_id IS NULL
      AND p.full_name = 'Kabir'
  ),
  1::bigint,
  'the name-only person has no account yet'
);

SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.groups WHERE kind = 'direct'),
  1::bigint,
  'the owner can read their direct ledger'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.groups WHERE kind = 'direct'),
  0::bigint,
  'a third account cannot read a direct ledger'
);
RESET ROLE;

INSERT INTO public.groups (id, name, created_by, kind)
VALUES (
  '44444444-4444-4444-8444-444444444444',
  'Goa trip',
  '11111111-1111-4111-8111-111111111111',
  'standard'
);

INSERT INTO public.participants (group_id, user_id, type, role, full_name)
VALUES (
  '44444444-4444-4444-8444-444444444444',
  NULL,
  'member',
  'member',
  'Kabir'
);

SELECT is(
  (
    SELECT k.group_id <> '44444444-4444-4444-8444-444444444444'
    FROM public.direct_group_keys k
    WHERE k.name_key = 'kabir'
  ),
  true,
  'a same-name person in a group is not merged into the direct ledger'
);

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (
    public.create_or_get_direct_group(
      '22222222-2222-4222-8222-222222222222',
      'Kabir Account',
      NULL,
      NULL
    ) ->> 'group_id'
  ),
  (
    SELECT k.group_id::text
    FROM public.direct_group_keys k
    WHERE k.user_low = LEAST(
        '11111111-1111-4111-8111-111111111111'::uuid,
        '22222222-2222-4222-8222-222222222222'::uuid
      )
      AND k.user_high = GREATEST(
        '11111111-1111-4111-8111-111111111111'::uuid,
        '22222222-2222-4222-8222-222222222222'::uuid
      )
  ),
  'an account pair gets one direct ledger'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (public.create_or_get_direct_group(
    '11111111-1111-4111-8111-111111111111',
    NULL,
    NULL,
    NULL
  ) ->> 'created')::boolean,
  false,
  'the other account opens the same ledger'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.groups WHERE kind = 'direct'),
  1::bigint,
  'the other account can read the shared direct ledger'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.groups WHERE kind = 'direct'),
  0::bigint,
  'a third account still cannot read the account-pair ledger'
);
RESET ROLE;

SELECT throws_ok(
  $$UPDATE public.groups SET kind = 'direct' WHERE id = '44444444-4444-4444-8444-444444444444'$$,
  'P0001',
  'group kind cannot change',
  'a standard group cannot be switched to direct'
);

INSERT INTO public.settlements (
  group_id,
  from_participant_id,
  to_participant_id,
  amount,
  currency,
  created_by,
  client_request_id
)
SELECT
  k.group_id,
  payer.id,
  payee.id,
  10,
  'INR',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
FROM public.direct_group_keys k
JOIN public.participants payer
  ON payer.group_id = k.group_id
 AND payer.user_id = '11111111-1111-4111-8111-111111111111'
JOIN public.participants payee
  ON payee.group_id = k.group_id
 AND payee.user_id IS NULL
WHERE k.name_key = 'kabir'
LIMIT 1;

SELECT throws_ok(
  $$
    INSERT INTO public.settlements (
      group_id,
      from_participant_id,
      to_participant_id,
      amount,
      currency,
      created_by,
      client_request_id
    )
    SELECT
      k.group_id,
      payer.id,
      payee.id,
      10,
      'INR',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    FROM public.direct_group_keys k
    JOIN public.participants payer
      ON payer.group_id = k.group_id
     AND payer.user_id = '11111111-1111-4111-8111-111111111111'
    JOIN public.participants payee
      ON payee.group_id = k.group_id
     AND payee.user_id IS NULL
    WHERE k.name_key = 'kabir'
    LIMIT 1
  $$,
  '23505',
  'duplicate key value violates unique constraint "settlements_client_request_id_uidx"',
  'the same idempotency key does not insert a second settlement'
);

SELECT * FROM finish();
ROLLBACK;
