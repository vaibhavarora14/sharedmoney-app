// Local isolated PostgreSQL regression test. No Supabase project or credentials.
// Requires @electric-sql/pglite (may be installed in /tmp and supplied via NODE_PATH).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");

test("issue 319: real RPCs, allocation, token boundaries, RLS, expiry, acknowledgements", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    // Only the two pre-existing dependencies. There are intentionally no groups,
    // memberships, participants, expenses, or balances in this test database.
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth; CREATE SCHEMA extensions;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111');
      INSERT INTO public.profiles VALUES ('11111111-1111-4111-8111-111111111111', 'Creator');
      SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
    `);
    await db.exec(readFileSync(require("node:path").join(__dirname, "../migrations/20261003100000_add_bill_split_sessions.sql"), "utf8"));
    const rpc = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
    const create = (mode, values, amount = 1001) => rpc(
      "SELECT public.create_bill_split_session($1, 'USD', ARRAY['Guest A','Guest B'], $2, $3) AS value",
      [amount, mode, values],
    );
    const get = (token) => rpc("SELECT public.get_bill_split_session($1) AS value", [token]);
    const confirm = (token, id) => rpc("SELECT public.confirm_bill_split_share($1, $2) AS value", [token, id]);
    await db.exec("SET ROLE authenticated");
    const equalToken = await create("equal", null);
    const sharesToken = await create("shares", [1, 2, 3]);
    const exactToken = await create("unequal", [201, 300, 500]);
    assert.match(equalToken, /^[a-f0-9]{64}$/);
    assert.notEqual(equalToken, sharesToken);
    for (const [token, expected] of [[equalToken, [334, 334, 333]], [sharesToken, [167, 334, 500]], [exactToken, [201, 300, 500]]]) {
      const session = await get(token);
      assert.deepEqual(session.participants.map((p) => p.amount_minor), expected);
      assert.equal(session.participants.reduce((sum, p) => sum + p.amount_minor, 0), session.amount_minor);
      assert.equal(session.participants[0].display_name, "Creator");
      assert.deepEqual(Object.keys(session).sort(), ["amount_minor", "currency", "mode", "participants"]);
      assert.deepEqual(Object.keys(session.participants[0]).sort(), ["amount_minor", "confirmed", "display_name", "id"]);
    }
    await assert.rejects(create("unequal", [201, 300, 499]));
    await assert.rejects(create("unequal", [201, 300, 501]));
    await assert.rejects(create("shares", [0, 1, 2]));
    await assert.rejects(create("shares", [1, 100, 2]));
    await assert.rejects(create("equal", null, 1));
    await assert.rejects(rpc("SELECT public.create_bill_split_session(100, 'USD', ARRAY[]::text[]) AS value"));
    await assert.rejects(rpc("SELECT public.create_bill_split_session(100, 'USD', ARRAY[NULL]::text[]) AS value"));
    await assert.rejects(rpc("SELECT public.create_bill_split_session(100, 'USD', ARRAY['  ']) AS value"));
    await assert.rejects(create("equal", null, 1000000001));
    await assert.rejects(db.query("SELECT * FROM public.bill_split_sessions"));
    await assert.rejects(db.query("SELECT * FROM public.bill_split_participants"));

    await db.exec("RESET ROLE; SET ROLE anon");
    await assert.rejects(create("equal", null));
    await assert.rejects(db.query("SELECT * FROM public.bill_split_sessions"));
    await assert.rejects(db.query("UPDATE public.bill_split_participants SET confirmed_at = now()"));
    assert.equal(await get(null), null);
    assert.equal(await get("invalid"), null);
    assert.equal(await get("00".repeat(32)), null);
    const bill = await get(equalToken);
    const person = bill.participants[1];
    assert.equal(await confirm(sharesToken, person.id), null);
    assert.equal(await confirm("00".repeat(32), person.id), null);
    const acknowledged = await confirm(equalToken, person.id);
    assert.equal(acknowledged.participants[1].confirmed, true);
    assert.equal(acknowledged.participants[0].confirmed, false);
    assert.deepEqual(await confirm(equalToken, person.id), acknowledged);

    await db.exec("RESET ROLE");
    const before = await rpc("SELECT confirmed_at AS value FROM public.bill_split_participants WHERE id = $1", [person.id]);
    await confirm(equalToken, person.id);
    assert.deepEqual(await rpc("SELECT confirmed_at AS value FROM public.bill_split_participants WHERE id = $1", [person.id]), before);
    const rls = await db.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('bill_split_sessions', 'bill_split_participants')");
    assert.equal(rls.rows.length, 2);
    assert.equal(rls.rows.every((r) => r.relrowsecurity), true);
    await db.query("UPDATE public.bill_split_sessions SET expires_at = now() - interval '1 day' WHERE token = $1", [equalToken]);
    await db.exec("SET ROLE anon");
    assert.equal(await get(equalToken), null);
    assert.equal(await confirm(equalToken, person.id), null);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE authenticated");
    await assert.rejects(create("equal", null));
  } finally { await db.close(); }
});
