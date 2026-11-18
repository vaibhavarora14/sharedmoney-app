// In-memory checks for #524: caps, invite-link gate, transactional merge,
// discard, delete-guest-data, and the disabled 60-day purge.
// No network, no production database, no personal data.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const GUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function migrationSql() {
  return readFileSync(
    join(__dirname, "../migrations/20261118130000_guest_mode.sql"),
    "utf8",
  );
}

async function boot() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      is_anonymous boolean NOT NULL DEFAULT false,
      raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
    $$;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      profile_completed boolean NOT NULL DEFAULT false,
      full_name text,
      preferred_currency varchar(3)
    );
    CREATE TABLE public.groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      kind text NOT NULL DEFAULT 'standard'
    );
    CREATE TABLE public.direct_group_keys (
      group_id uuid PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
      user_low uuid,
      user_high uuid,
      owner_user_id uuid,
      name_key text,
      CONSTRAINT direct_group_keys_shape CHECK (
        (
          user_low IS NOT NULL AND user_high IS NOT NULL AND user_low < user_high
          AND owner_user_id IS NULL AND name_key IS NULL
        )
        OR (
          user_low IS NULL AND user_high IS NULL
          AND owner_user_id IS NOT NULL AND name_key IS NOT NULL
        )
      )
    );
    CREATE UNIQUE INDEX direct_group_keys_name_uidx
      ON public.direct_group_keys (owner_user_id, name_key) WHERE name_key IS NOT NULL;
    CREATE UNIQUE INDEX direct_group_keys_pair_uidx
      ON public.direct_group_keys (user_low, user_high) WHERE user_low IS NOT NULL;
    CREATE TABLE public.group_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      role text NOT NULL DEFAULT 'member',
      status text NOT NULL DEFAULT 'active',
      left_at timestamptz,
      UNIQUE (group_id, user_id)
    );
    CREATE TABLE public.participants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      full_name text,
      email text,
      type text NOT NULL DEFAULT 'member'
    );
    CREATE TABLE public.transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
      group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
      amount numeric NOT NULL,
      description text
    );
    CREATE TABLE public.settlements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
      created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      amount numeric NOT NULL
    );
    CREATE TABLE public.transaction_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id uuid,
      changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
    );
    CREATE TABLE public.bill_split_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
    );
    CREATE TABLE public.group_invitations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id uuid,
      email text,
      invited_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
      status text,
      expires_at timestamptz,
      token text
    );
    CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY);
    CREATE TABLE public.push_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
    CREATE TABLE public.whatsapp_reminder_prefs (user_id uuid PRIMARY KEY);
    CREATE FUNCTION public.get_user_id_by_email(p_email text) RETURNS uuid
      LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.get_user_emails_by_ids(p_ids uuid[])
      RETURNS TABLE(id uuid, email text) LANGUAGE sql AS $$
        SELECT NULL::uuid, NULL::text WHERE false $$;
    CREATE FUNCTION public.create_group_share_link(
      p_group_id uuid, p_max_uses integer DEFAULT 1, p_valid_days integer DEFAULT 7
    ) RETURNS text LANGUAGE sql AS $$ SELECT 'token'::text $$;
    CREATE FUNCTION public.redeem_group_invite_link(p_token text)
      RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"status":"joined"}'::jsonb $$;
  `);
  await db.exec(migrationSql());
  await db.exec(`
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  `);
  return db;
}

async function become(db, id, anonymous) {
  const claims = JSON.stringify({ sub: id, is_anonymous: anonymous });
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [id]);
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims]);
}

async function addUser(db, id, { anonymous, name, currency, email = null }) {
  await db.query(
    `INSERT INTO auth.users (id, email, is_anonymous, raw_app_meta_data)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      id,
      email,
      anonymous,
      anonymous ? JSON.stringify({ provider: "anonymous" }) : JSON.stringify({ provider: "email" }),
    ],
  );
  if (name || currency) {
    await db.query(
      `UPDATE public.profiles SET full_name = $2, preferred_currency = $3 WHERE id = $1`,
      [id, name, currency],
    );
  }
}

test("guest collision names stay separate and do not rename the existing account", async () => {
  const db = await boot();
  const once = await db.query(
    `SELECT public.guest_collision_name('Flat 4B', ARRAY['Flat 4B']) AS name`,
  );
  assert.equal(once.rows[0].name, "Flat 4B (guest)");
  const twice = await db.query(
    `SELECT public.guest_collision_name('Flat 4B', ARRAY['Flat 4B', 'Flat 4B (guest)']) AS name`,
  );
  assert.equal(twice.rows[0].name, "Flat 4B (guest 2)");
  const free = await db.query(
    `SELECT public.guest_collision_name('Goa trip', ARRAY['Flat 4B']) AS name`,
  );
  assert.equal(free.rows[0].name, "Goa trip");
  await db.close();
});

test("anonymous session cannot create or redeem invite links; a registered session can", async () => {
  const db = await boot();
  await addUser(db, GUEST, { anonymous: true, name: "Alex" });
  await addUser(db, OWNER, { anonymous: false, name: "Permanent" });
  const group = (await db.query(
    `INSERT INTO public.groups (name, created_by) VALUES ('Goa trip', $1) RETURNING id`,
    [OWNER],
  )).rows[0].id;

  await become(db, GUEST, true);
  await assert.rejects(
    db.query(`SELECT public.create_group_share_link($1, 1, 7)`, [group]),
    /GUEST_SIGNIN_REQUIRED/,
  );
  await assert.rejects(
    db.query(`SELECT public.redeem_group_invite_link('secret')`),
    /GUEST_SIGNIN_REQUIRED/,
  );

  await become(db, OWNER, false);
  const created = await db.query(`SELECT public.create_group_share_link($1, 1, 7) AS token`, [group]);
  assert.equal(created.rows[0].token, "token");
  const redeemed = await db.query(`SELECT public.redeem_group_invite_link('secret') AS result`);
  assert.equal(redeemed.rows[0].result.status, "joined");
  await db.close();
});

test("email lookup functions are not executable by authenticated or anon", async () => {
  const db = await boot();
  for (const role of ["authenticated", "anon"]) {
    const byEmail = await db.query(
      `SELECT has_function_privilege($1, 'public.get_user_id_by_email(text)', 'execute') AS ok`,
      [role],
    );
    const byId = await db.query(
      `SELECT has_function_privilege($1, 'public.get_user_emails_by_ids(uuid[])', 'execute') AS ok`,
      [role],
    );
    assert.equal(byEmail.rows[0].ok, false, role);
    assert.equal(byId.rows[0].ok, false, role);
  }
  await db.close();
});

test("guests stop at 5 groups and 200 expenses; registered users do not", async () => {
  const db = await boot();
  await addUser(db, GUEST, { anonymous: true, name: "Alex" });
  await addUser(db, OWNER, { anonymous: false, name: "Permanent" });
  await become(db, GUEST, true);
  for (let i = 0; i < 5; i += 1) {
    await db.query(
      `INSERT INTO public.groups (name, created_by) VALUES ($1, $2)`,
      [`Group ${i}`, GUEST],
    );
  }
  await assert.rejects(
    db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Sixth', $1)`, [GUEST]),
    /GUEST_GROUP_CAP/,
  );
  await db.query(
    `INSERT INTO public.groups (name, created_by, kind) VALUES ('Hidden', $1, 'direct')`,
    [GUEST],
  );

  const groupId = (await db.query(
    `SELECT id FROM public.groups WHERE created_by = $1 LIMIT 1`,
    [GUEST],
  )).rows[0].id;
  await db.query(
    `INSERT INTO public.transactions (user_id, group_id, amount, description)
     SELECT $1, $2, 1, 'expense' FROM generate_series(1, 200)`,
    [GUEST, groupId],
  );
  await assert.rejects(
    db.query(
      `INSERT INTO public.transactions (user_id, group_id, amount, description) VALUES ($1, $2, 1, 'one more')`,
      [GUEST, groupId],
    ),
    /GUEST_EXPENSE_CAP/,
  );

  await become(db, OWNER, false);
  for (let i = 0; i < 6; i += 1) {
    await db.query(
      `INSERT INTO public.groups (name, created_by) VALUES ($1, $2)`,
      [`Owner ${i}`, OWNER],
    );
  }
  const ownerCount = await db.query(
    `SELECT count(*)::int AS n FROM public.groups WHERE created_by = $1`,
    [OWNER],
  );
  assert.equal(ownerCount.rows[0].n, 6);
  await db.close();
});

test("writes move the guest activity clock and a read does not", async () => {
  const db = await boot();
  await addUser(db, GUEST, { anonymous: true, name: "Alex" });
  await db.query(
    `UPDATE public.profiles SET last_guest_activity_at = now() - interval '3 days' WHERE id = $1`,
    [GUEST],
  );
  const before = (await db.query(
    `SELECT last_guest_activity_at FROM public.profiles WHERE id = $1`,
    [GUEST],
  )).rows[0].last_guest_activity_at;
  await db.query(`SELECT * FROM public.groups`);
  const afterRead = (await db.query(
    `SELECT last_guest_activity_at FROM public.profiles WHERE id = $1`,
    [GUEST],
  )).rows[0].last_guest_activity_at;
  assert.equal(new Date(afterRead).toISOString(), new Date(before).toISOString());

  await become(db, GUEST, true);
  await db.query(
    `INSERT INTO public.groups (name, created_by) VALUES ('Goa trip', $1)`,
    [GUEST],
  );
  const afterWrite = (await db.query(
    `SELECT last_guest_activity_at FROM public.profiles WHERE id = $1`,
    [GUEST],
  )).rows[0].last_guest_activity_at;
  assert.ok(new Date(afterWrite).getTime() > new Date(before).getTime());
  await db.close();
});

test("anonymous sign-in creates a profile and skips email invite auto-accept", async () => {
  const db = await boot();
  await db.query(`
    CREATE FUNCTION public.sync_participant_state(uuid, uuid, text, text, text)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'invite path should not run'; END $$;
  `);
  await db.query(
    `INSERT INTO auth.users (id, email, is_anonymous, raw_app_meta_data)
     VALUES ($1, 'alex@example.com', true, '{"provider":"anonymous"}'::jsonb)`,
    [GUEST],
  );
  const profile = (await db.query(
    `SELECT profile_completed, last_guest_activity_at IS NOT NULL AS stamped
     FROM public.profiles WHERE id = $1`,
    [GUEST],
  )).rows[0];
  assert.equal(profile.profile_completed, false);
  assert.equal(profile.stamped, true);
  await db.close();
});

test("merge moves guest rows, suffixes a same-name group, and leaves the account untouched", async () => {
  const db = await boot();
  await addUser(db, OWNER, { anonymous: false, name: "Permanent", currency: "INR" });
  await addUser(db, GUEST, { anonymous: true, name: "Alex", currency: "USD" });
  const kept = (await db.query(
    `INSERT INTO public.groups (name, created_by) VALUES ('Flat 4B', $1) RETURNING id`,
    [OWNER],
  )).rows[0].id;
  await db.query(
    `INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [kept, OWNER],
  );
  await db.query(
    `INSERT INTO public.transactions (user_id, group_id, amount, description)
     VALUES ($1, $2, 999, 'rent already there')`,
    [OWNER, kept],
  );
  await db.query(
    `INSERT INTO public.settlements (group_id, created_by, amount) VALUES ($1, $2, 10)`,
    [kept, OWNER],
  );
  const keptParticipant = (await db.query(
    `INSERT INTO public.participants (group_id, user_id, full_name, type)
     VALUES ($1, $2, 'Permanent', 'member') RETURNING id`,
    [kept, OWNER],
  )).rows[0].id;

  await become(db, GUEST, true);
  const goa = (await db.query(
    `INSERT INTO public.groups (name, created_by) VALUES ('Goa trip', $1) RETURNING id`,
    [GUEST],
  )).rows[0].id;
  const clash = (await db.query(
    `INSERT INTO public.groups (name, created_by) VALUES ('Flat 4B', $1) RETURNING id`,
    [GUEST],
  )).rows[0].id;
  await db.query(
    `INSERT INTO public.group_members (group_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $2, 'owner')`,
    [goa, GUEST, clash],
  );
  await db.query(
    `INSERT INTO public.participants (group_id, user_id, full_name, type)
     VALUES ($1, $2, 'Alex', 'member'), ($3, NULL, 'Rahul', 'member')`,
    [goa, GUEST, goa],
  );
  await db.query(
    `INSERT INTO public.transactions (user_id, group_id, amount, description)
     VALUES ($1, $2, 50, 'dinner')`,
    [GUEST, goa],
  );
  await db.query(
    `INSERT INTO public.settlements (group_id, created_by, amount) VALUES ($1, $2, 3)`,
    [goa, GUEST],
  );
  await db.query(
    `INSERT INTO public.transaction_history (group_id, changed_by) VALUES ($1, $2)`,
    [goa, GUEST],
  );

  const token = (await db.query(`SELECT public.mint_guest_merge_token() AS token`)).rows[0].token;
  await become(db, OWNER, false);
  const preview = (await db.query(
    `SELECT public.preview_guest_merge($1, $2) AS preview`,
    [GUEST, token],
  )).rows[0].preview;
  const labels = preview.groups.map((group) => group.name).sort();
  assert.deepEqual(labels, ["Flat 4B (guest)", "Goa trip"]);
  assert.equal(preview.groups.find((group) => group.name.startsWith("Flat")).note, "Same name, kept separate");

  const first = (await db.query(
    `SELECT public.merge_guest_into_user($1, $2) AS result`,
    [GUEST, token],
  )).rows[0].result;
  const second = (await db.query(
    `SELECT public.merge_guest_into_user($1, $2) AS result`,
    [GUEST, token],
  )).rows[0].result;
  assert.deepEqual(second, first);
  assert.equal(first.groups_moved, 2);
  assert.equal(first.expenses_moved, 1);
  assert.equal(first.payments_moved, 1);
  assert.equal(first.already_merged, false);

  const account = (await db.query(
    `SELECT full_name, preferred_currency FROM public.profiles WHERE id = $1`,
    [OWNER],
  )).rows[0];
  assert.equal(account.full_name, "Permanent");
  assert.equal(account.preferred_currency, "INR");

  const keptGroup = (await db.query(`SELECT name, created_by FROM public.groups WHERE id = $1`, [kept])).rows[0];
  assert.equal(keptGroup.name, "Flat 4B");
  assert.equal(keptGroup.created_by, OWNER);
  const keptExpense = (await db.query(
    `SELECT amount, user_id, description FROM public.transactions WHERE group_id = $1`,
    [kept],
  )).rows[0];
  assert.equal(Number(keptExpense.amount), 999);
  assert.equal(keptExpense.user_id, OWNER);
  assert.equal(keptExpense.description, "rent already there");
  const keptSettlement = (await db.query(
    `SELECT amount, created_by FROM public.settlements WHERE group_id = $1`,
    [kept],
  )).rows[0];
  assert.equal(Number(keptSettlement.amount), 10);
  assert.equal(keptSettlement.created_by, OWNER);
  const keptPerson = (await db.query(
    `SELECT user_id, full_name FROM public.participants WHERE id = $1`,
    [keptParticipant],
  )).rows[0];
  assert.equal(keptPerson.user_id, OWNER);
  assert.equal(keptPerson.full_name, "Permanent");

  const movedClash = (await db.query(`SELECT name, created_by FROM public.groups WHERE id = $1`, [clash])).rows[0];
  assert.equal(movedClash.name, "Flat 4B (guest)");
  assert.equal(movedClash.created_by, OWNER);
  const movedGoa = (await db.query(`SELECT name, created_by FROM public.groups WHERE id = $1`, [goa])).rows[0];
  assert.equal(movedGoa.name, "Goa trip");
  assert.equal(movedGoa.created_by, OWNER);
  const movedExpense = (await db.query(
    `SELECT user_id FROM public.transactions WHERE group_id = $1`,
    [goa],
  )).rows[0];
  assert.equal(movedExpense.user_id, OWNER);
  const nameOnly = (await db.query(
    `SELECT user_id, full_name FROM public.participants WHERE group_id = $1 AND full_name = 'Rahul'`,
    [goa],
  )).rows[0];
  assert.equal(nameOnly.user_id, null);
  const guestPerson = (await db.query(
    `SELECT user_id FROM public.participants WHERE group_id = $1 AND full_name = 'Alex'`,
    [goa],
  )).rows[0];
  assert.equal(guestPerson.user_id, OWNER);
  const history = (await db.query(
    `SELECT changed_by FROM public.transaction_history WHERE group_id = $1`,
    [goa],
  )).rows[0];
  assert.equal(history.changed_by, OWNER);

  const guestGone = await db.query(`SELECT count(*)::int AS n FROM auth.users WHERE id = $1`, [GUEST]);
  assert.equal(guestGone.rows[0].n, 0);
  const ownerRemains = await db.query(`SELECT count(*)::int AS n FROM auth.users WHERE id = $1`, [OWNER]);
  assert.equal(ownerRemains.rows[0].n, 1);
  await db.close();
});

test("a merge failure rolls back and keeps both the guest and the existing account", async () => {
  const db = await boot();
  await addUser(db, OWNER, { anonymous: false, name: "Permanent", currency: "INR" });
  await addUser(db, GUEST, { anonymous: true, name: "Alex" });
  await db.query(
    `INSERT INTO public.groups (name, created_by) VALUES ('Flat 4B', $1)`,
    [OWNER],
  );
  await become(db, GUEST, true);
  await db.query(
    `INSERT INTO public.groups (name, created_by) VALUES ('Flat 4B', $1)`,
    [GUEST],
  );
  const token = (await db.query(`SELECT public.mint_guest_merge_token() AS token`)).rows[0].token;
  await db.exec(`
    CREATE FUNCTION public.fail_guest_rename() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.name LIKE '%(guest)%' THEN
        RAISE EXCEPTION 'forced failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER fail_guest_rename
      BEFORE UPDATE ON public.groups
      FOR EACH ROW EXECUTE FUNCTION public.fail_guest_rename();
  `);
  await become(db, OWNER, false);
  await assert.rejects(
    db.query(`SELECT public.merge_guest_into_user($1, $2)`, [GUEST, token]),
    /forced failure/,
  );
  const guest = await db.query(`SELECT count(*)::int AS n FROM auth.users WHERE id = $1`, [GUEST]);
  assert.equal(guest.rows[0].n, 1);
  const guestGroup = await db.query(
    `SELECT name, created_by FROM public.groups WHERE created_by = $1`,
    [GUEST],
  );
  assert.equal(guestGroup.rows[0].name, "Flat 4B");
  const kept = await db.query(
    `SELECT name, created_by FROM public.groups WHERE created_by = $1`,
    [OWNER],
  );
  assert.equal(kept.rows[0].name, "Flat 4B");
  const profile = (await db.query(
    `SELECT full_name, preferred_currency FROM public.profiles WHERE id = $1`,
    [OWNER],
  )).rows[0];
  assert.equal(profile.full_name, "Permanent");
  assert.equal(profile.preferred_currency, "INR");
  const used = await db.query(
    `SELECT used_at IS NULL AS open FROM public.guest_merge_tokens WHERE guest_user_id = $1`,
    [GUEST],
  );
  assert.equal(used.rows[0].open, true);
  const merges = await db.query(`SELECT count(*)::int AS n FROM public.guest_merges`);
  assert.equal(merges.rows[0].n, 0);
  await db.close();
});

test("discard deletes the guest ledger and does not remove the existing account", async () => {
  const db = await boot();
  await addUser(db, OWNER, { anonymous: false, name: "Permanent", currency: "INR" });
  await addUser(db, GUEST, { anonymous: true, name: "Alex" });
  await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Kept', $1)`, [OWNER]);
  await become(db, GUEST, true);
  await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Phone only', $1)`, [GUEST]);
  const token = (await db.query(`SELECT public.mint_guest_merge_token() AS token`)).rows[0].token;
  await become(db, OWNER, false);
  const discarded = (await db.query(
    `SELECT public.discard_guest_data($1, $2) AS result`,
    [GUEST, token],
  )).rows[0].result;
  assert.equal(discarded.discarded, true);
  const guestGroups = await db.query(`SELECT count(*)::int AS n FROM public.groups WHERE name = 'Phone only'`);
  assert.equal(guestGroups.rows[0].n, 0);
  const kept = await db.query(`SELECT name, created_by FROM public.groups WHERE name = 'Kept'`);
  assert.equal(kept.rows[0].created_by, OWNER);
  const profile = (await db.query(
    `SELECT full_name FROM public.profiles WHERE id = $1`,
    [OWNER],
  )).rows[0];
  assert.equal(profile.full_name, "Permanent");
  const guest = await db.query(`SELECT count(*)::int AS n FROM auth.users WHERE id = $1`, [GUEST]);
  assert.equal(guest.rows[0].n, 0);
  await db.close();
});

test("delete own guest data removes that guest and nobody else", async () => {
  const db = await boot();
  await addUser(db, OWNER, { anonymous: false, name: "Permanent" });
  await addUser(db, GUEST, { anonymous: true, name: "Alex" });
  await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Kept', $1)`, [OWNER]);
  await become(db, GUEST, true);
  await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Phone only', $1)`, [GUEST]);
  const deleted = (await db.query(`SELECT public.delete_own_guest_data() AS result`)).rows[0].result;
  assert.equal(deleted.deleted, true);
  const guest = await db.query(`SELECT count(*)::int AS n FROM auth.users WHERE id = $1`, [GUEST]);
  assert.equal(guest.rows[0].n, 0);
  const phone = await db.query(`SELECT count(*)::int AS n FROM public.groups WHERE name = 'Phone only'`);
  assert.equal(phone.rows[0].n, 0);
  const owner = await db.query(`SELECT full_name FROM public.profiles WHERE id = $1`, [OWNER]);
  assert.equal(owner.rows[0].full_name, "Permanent");
  const kept = await db.query(`SELECT count(*)::int AS n FROM public.groups WHERE name = 'Kept'`);
  assert.equal(kept.rows[0].n, 1);

  await become(db, OWNER, false);
  await assert.rejects(db.query(`SELECT public.delete_own_guest_data()`), /GUEST_SIGNIN_REQUIRED/);
  await db.close();
});

test("purge stays off and deletes nobody until cleanup_enabled is set", async () => {
  const db = await boot();
  await addUser(db, GUEST, { anonymous: true, name: "Alex" });
  await addUser(db, OTHER, { anonymous: true, name: "Recent" });
  await addUser(db, OWNER, { anonymous: false, name: "Permanent" });
  await db.query(
    `UPDATE public.profiles SET last_guest_activity_at = now() - interval '61 days' WHERE id = $1`,
    [GUEST],
  );
  await db.query(
    `UPDATE public.profiles SET last_guest_activity_at = now() - interval '10 days' WHERE id = $1`,
    [OTHER],
  );
  await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Old', $1), ('Kept', $2)`, [GUEST, OWNER]);

  const dormant = await db.query(`SELECT public.purge_inactive_guests(now()) AS n`);
  assert.equal(dormant.rows[0].n, 0);
  const stillThere = await db.query(`SELECT count(*)::int AS n FROM auth.users WHERE id = $1`, [GUEST]);
  assert.equal(stillThere.rows[0].n, 1);

  await db.query(`UPDATE public.guest_runtime_config SET cleanup_enabled = true WHERE singleton`);
  const purged = await db.query(`SELECT public.purge_inactive_guests(now()) AS n`);
  assert.equal(purged.rows[0].n, 1);
  const guest = await db.query(`SELECT count(*)::int AS n FROM auth.users WHERE id = $1`, [GUEST]);
  assert.equal(guest.rows[0].n, 0);
  const recent = await db.query(`SELECT count(*)::int AS n FROM auth.users WHERE id = $1`, [OTHER]);
  assert.equal(recent.rows[0].n, 1);
  const owner = await db.query(`SELECT count(*)::int AS n FROM public.groups WHERE name = 'Kept'`);
  assert.equal(owner.rows[0].n, 1);
  await db.close();
});

test("a null preferred currency is filled from the guest and a set one is not", async () => {
  const db = await boot();
  await addUser(db, OWNER, { anonymous: false, name: "Permanent", currency: null });
  await addUser(db, GUEST, { anonymous: true, name: "Alex", currency: "USD" });
  await become(db, GUEST, true);
  await db.query(`INSERT INTO public.groups (name, created_by) VALUES ('Goa trip', $1)`, [GUEST]);
  const token = (await db.query(`SELECT public.mint_guest_merge_token() AS token`)).rows[0].token;
  await become(db, OWNER, false);
  await db.query(`SELECT public.merge_guest_into_user($1, $2)`, [GUEST, token]);
  const currency = (await db.query(
    `SELECT preferred_currency, full_name FROM public.profiles WHERE id = $1`,
    [OWNER],
  )).rows[0];
  assert.equal(currency.preferred_currency, "USD");
  assert.equal(currency.full_name, "Permanent");
  await db.close();
});

test("merge moves a hidden direct group and leaves the account's direct ledger unchanged", async () => {
  const db = await boot();
  await addUser(db, OWNER, { anonymous: false, name: "Permanent", currency: "INR" });
  await addUser(db, GUEST, { anonymous: true, name: "Alex" });
  const kept = (await db.query(
    `INSERT INTO public.groups (name, created_by, kind) VALUES ('Rahul', $1, 'direct') RETURNING id`,
    [OWNER],
  )).rows[0].id;
  await db.query(
    `INSERT INTO public.direct_group_keys (group_id, owner_user_id, name_key) VALUES ($1, $2, 'rahul')`,
    [kept, OWNER],
  );
  await db.query(
    `INSERT INTO public.settlements (group_id, created_by, amount) VALUES ($1, $2, 10)`,
    [kept, OWNER],
  );

  await become(db, GUEST, true);
  const hidden = (await db.query(
    `INSERT INTO public.groups (name, created_by, kind) VALUES ('Rahul', $1, 'direct') RETURNING id`,
    [GUEST],
  )).rows[0].id;
  await db.query(
    `INSERT INTO public.direct_group_keys (group_id, owner_user_id, name_key) VALUES ($1, $2, 'rahul')`,
    [hidden, GUEST],
  );
  await db.query(
    `INSERT INTO public.settlements (group_id, created_by, amount) VALUES ($1, $2, 3)`,
    [hidden, GUEST],
  );
  await db.query(
    `INSERT INTO public.groups (name, created_by) VALUES ('Goa trip', $1)`,
    [GUEST],
  );
  const token = (await db.query(`SELECT public.mint_guest_merge_token() AS token`)).rows[0].token;

  await become(db, OWNER, false);
  await db.query(`SELECT public.merge_guest_into_user($1, $2)`, [GUEST, token]);

  const keptKey = (await db.query(
    `SELECT owner_user_id, name_key FROM public.direct_group_keys WHERE group_id = $1`,
    [kept],
  )).rows[0];
  assert.equal(keptKey.owner_user_id, OWNER);
  assert.equal(keptKey.name_key, "rahul");
  const keptPay = (await db.query(
    `SELECT amount::float AS amount, created_by FROM public.settlements WHERE group_id = $1`,
    [kept],
  )).rows[0];
  assert.equal(keptPay.amount, 10);
  assert.equal(keptPay.created_by, OWNER);
  const keptGroup = (await db.query(`SELECT name, created_by, kind FROM public.groups WHERE id = $1`, [kept])).rows[0];
  assert.equal(keptGroup.name, "Rahul");
  assert.equal(keptGroup.created_by, OWNER);

  const movedKey = (await db.query(
    `SELECT owner_user_id, name_key, user_low FROM public.direct_group_keys WHERE group_id = $1`,
    [hidden],
  )).rows[0];
  assert.equal(movedKey.owner_user_id, OWNER);
  assert.equal(movedKey.name_key, "rahul (guest)");
  assert.equal(movedKey.user_low, null);
  const movedPay = (await db.query(
    `SELECT amount::float AS amount, created_by FROM public.settlements WHERE group_id = $1`,
    [hidden],
  )).rows[0];
  assert.equal(movedPay.amount, 3);
  assert.equal(movedPay.created_by, OWNER);
  const movedGroup = (await db.query(`SELECT created_by, kind FROM public.groups WHERE id = $1`, [hidden])).rows[0];
  assert.equal(movedGroup.created_by, OWNER);
  assert.equal(movedGroup.kind, "direct");

  const orphan = await db.query(
    `SELECT count(*)::int AS n FROM public.direct_group_keys WHERE owner_user_id = $1 OR user_low = $1 OR user_high = $1`,
    [GUEST],
  );
  assert.equal(orphan.rows[0].n, 0);
  const guest = await db.query(`SELECT count(*)::int AS n FROM auth.users WHERE id = $1`, [GUEST]);
  assert.equal(guest.rows[0].n, 0);
  await db.close();
});

test("deleting a guest removes their hidden direct group and not the account's", async () => {
  const db = await boot();
  await addUser(db, OWNER, { anonymous: false, name: "Permanent" });
  await addUser(db, GUEST, { anonymous: true, name: "Alex" });
  const kept = (await db.query(
    `INSERT INTO public.groups (name, created_by, kind) VALUES ('Rahul', $1, 'direct') RETURNING id`,
    [OWNER],
  )).rows[0].id;
  await db.query(
    `INSERT INTO public.direct_group_keys (group_id, owner_user_id, name_key) VALUES ($1, $2, 'rahul')`,
    [kept, OWNER],
  );
  await become(db, GUEST, true);
  const hidden = (await db.query(
    `INSERT INTO public.groups (name, created_by, kind) VALUES ('Kabir', $1, 'direct') RETURNING id`,
    [GUEST],
  )).rows[0].id;
  await db.query(
    `INSERT INTO public.direct_group_keys (group_id, owner_user_id, name_key) VALUES ($1, $2, 'kabir')`,
    [hidden, GUEST],
  );
  await db.query(`SELECT public.delete_own_guest_data()`);
  const gone = await db.query(`SELECT count(*)::int AS n FROM public.groups WHERE id = $1`, [hidden]);
  assert.equal(gone.rows[0].n, 0);
  const keys = await db.query(`SELECT count(*)::int AS n FROM public.direct_group_keys WHERE group_id = $1`, [hidden]);
  assert.equal(keys.rows[0].n, 0);
  const keptRow = (await db.query(
    `SELECT g.name, k.owner_user_id, k.name_key
     FROM public.groups g JOIN public.direct_group_keys k ON k.group_id = g.id
     WHERE g.id = $1`,
    [kept],
  )).rows[0];
  assert.equal(keptRow.name, "Rahul");
  assert.equal(keptRow.owner_user_id, OWNER);
  assert.equal(keptRow.name_key, "rahul");
  await db.close();
});
