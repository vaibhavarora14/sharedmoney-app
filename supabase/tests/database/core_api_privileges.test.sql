BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SELECT is_empty(
  $$
    SELECT table_name
    FROM unnest(ARRAY[
      'groups',
      'group_members',
      'group_invitations',
      'participants',
      'transactions',
      'transaction_splits',
      'transaction_payers',
      'settlements',
      'transaction_history',
      'transaction_history_archive'
    ]) AS tables(table_name)
    WHERE NOT (
      SELECT relrowsecurity
      FROM pg_class
      WHERE oid = format('public.%I', table_name)::regclass
    )
  $$,
  'all user-facing finance tables enforce RLS'
);

SELECT is_empty(
  $$
    SELECT table_name
    FROM unnest(ARRAY[
      'groups',
      'group_members',
      'group_invitations',
      'participants',
      'transactions',
      'transaction_splits',
      'transaction_payers',
      'settlements',
      'transaction_history',
      'transaction_history_archive'
    ]) AS tables(table_name)
    WHERE NOT has_table_privilege(
      'authenticated',
      format('public.%I', table_name),
      'SELECT'
    )
  $$,
  'authenticated users can read RLS-scoped finance data'
);

SELECT is_empty(
  $$
    SELECT table_name
    FROM unnest(ARRAY[
      'groups',
      'group_members',
      'group_invitations',
      'participants',
      'transactions',
      'transaction_splits',
      'transaction_payers',
      'settlements'
    ]) AS tables(table_name)
    WHERE NOT has_table_privilege(
      'authenticated',
      format('public.%I', table_name),
      'INSERT,UPDATE,DELETE'
    )
  $$,
  'authenticated users can mutate finance data only through its RLS policies'
);

SELECT is_empty(
  $$
    SELECT table_name
    FROM unnest(ARRAY[
      'groups',
      'group_members',
      'group_invitations',
      'participants',
      'transactions',
      'transaction_splits',
      'transaction_payers',
      'settlements',
      'transaction_history',
      'transaction_history_archive'
    ]) AS tables(table_name)
    WHERE has_table_privilege(
      'anon',
      format('public.%I', table_name),
      'SELECT'
    )
  $$,
  'anonymous users cannot read finance data'
);

SELECT is_empty(
  $$
    SELECT table_name
    FROM unnest(ARRAY[
      'groups',
      'group_members',
      'group_invitations',
      'participants',
      'transactions',
      'transaction_splits',
      'transaction_payers',
      'settlements',
      'transaction_history',
      'transaction_history_archive'
    ]) AS tables(table_name)
    WHERE NOT has_table_privilege(
      'service_role',
      format('public.%I', table_name),
      'SELECT,INSERT,UPDATE,DELETE'
    )
  $$,
  'service role can perform trusted server-side finance operations'
);

SELECT * FROM finish();
ROLLBACK;
