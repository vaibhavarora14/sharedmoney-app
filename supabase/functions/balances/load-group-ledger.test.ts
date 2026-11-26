import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  GROUP_LEDGER_PARALLEL_QUERY_COUNT,
  POSTGREST_PAGE_SIZE,
  loadGroupLedger,
  loadGroupLedgers,
  pageAllRows,
} from "./load-group-ledger.ts";

type FakeResult = { data: unknown; error: unknown };

function createFakeSupabase(handlers: Record<string, (from: number, to: number) => FakeResult>) {
  const calls: string[] = [];
  const ranges: Array<{ table: string; from: number; to: number }> = [];

  const makeBuilder = (table: string) => {
    let from = 0;
    let to = POSTGREST_PAGE_SIZE - 1;
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = () => self();
    builder.eq = () => self();
    builder.in = () => self();
    builder.order = () => self();
    builder.range = (nextFrom: number, nextTo: number) => {
      from = nextFrom;
      to = nextTo;
      ranges.push({ table, from, to });
      return builder;
    };
    const resultPromise = () => Promise.resolve().then(() => handlers[table](from, to));
    builder.then = (
      onFulfilled?: (value: FakeResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => resultPromise().then(onFulfilled, onRejected);
    builder.catch = (onRejected?: (reason: unknown) => unknown) =>
      resultPromise().catch(onRejected);
    return builder;
  };

  return {
    calls,
    ranges,
    from: (table: string) => {
      calls.push(table);
      return makeBuilder(table);
    },
  };
}

Deno.test("GROUP_LEDGER_PARALLEL_QUERY_COUNT documents three parallel reads", () => {
  assertEquals(GROUP_LEDGER_PARALLEL_QUERY_COUNT, 3);
});

Deno.test("loadGroupLedger fetches transactions, participants, settlements in parallel", async () => {
  const supabase = createFakeSupabase({
    transactions: () => ({
      data: [
        {
          id: 1,
          group_id: "group-1",
          amount: 10,
          paid_by_participant_id: "p1",
          currency: "USD",
          transaction_splits: [{ participant_id: "p1", amount: 10 }],
        },
      ],
      error: null,
    }),
    participants: () => ({
      data: [
        {
          id: "p1",
          group_id: "group-1",
          user_id: "u1",
          email: "a@example.com",
          full_name: "A",
          avatar_url: null,
          type: "member",
        },
      ],
      error: null,
    }),
    settlements: () => ({
      data: [],
      error: null,
    }),
  });

  const snapshot = await loadGroupLedger(supabase, "group-1", {
    includeStatsFields: true,
  });

  assertEquals(snapshot.transactions.length, 1);
  assertEquals(snapshot.participants.length, 1);
  assertEquals(snapshot.settlements.length, 0);
  assertEquals([...supabase.calls].sort(), [
    "participants",
    "settlements",
    "transactions",
  ]);
});

Deno.test("loadGroupLedger throws when transactions query fails", async () => {
  const supabase = createFakeSupabase({
    transactions: () => ({
      data: null,
      error: { message: "boom" },
    }),
    participants: () => ({ data: [], error: null }),
    settlements: () => ({ data: [], error: null }),
  });

  await assertRejects(() => loadGroupLedger(supabase, "group-1"));
});

Deno.test("pageAllRows walks past the 1000-row PostgREST cap", async () => {
  const pages: number[][] = [
    Array.from({ length: POSTGREST_PAGE_SIZE }, (_unused, index) => index),
    [POSTGREST_PAGE_SIZE],
  ];
  const rows = await pageAllRows<number>(() => {
    const builder: Record<string, unknown> = {};
    builder.range = (from: number, to: number) => {
      const pageIndex = from === 0 ? 0 : 1;
      return Promise.resolve({ data: pages[pageIndex].filter((value) => value >= from && value <= to), error: null });
    };
    return builder as { range: (from: number, to: number) => PromiseLike<{ data: number[] | null; error: unknown }> };
  });
  assertEquals(rows.length, POSTGREST_PAGE_SIZE + 1);
  assertEquals(rows[0], 0);
  assertEquals(rows[POSTGREST_PAGE_SIZE], POSTGREST_PAGE_SIZE);
});

Deno.test("loadGroupLedgers batches by group_id instead of per-group queries", async () => {
  const supabase = createFakeSupabase({
    transactions: () => ({
      data: [
        {
          id: 1,
          group_id: "g1",
          amount: 10,
          paid_by_participant_id: "p1",
          currency: "INR",
          transaction_splits: [{ participant_id: "p1", amount: 10 }],
        },
        {
          id: 2,
          group_id: "g2",
          amount: 4,
          paid_by_participant_id: "p2",
          currency: "INR",
          transaction_splits: [{ participant_id: "p2", amount: 4 }],
        },
      ],
      error: null,
    }),
    participants: () => ({
      data: [
        { id: "p1", group_id: "g1", user_id: "u1", email: "a@example.com", full_name: "A", avatar_url: null, type: "member" },
        { id: "p2", group_id: "g2", user_id: "u2", email: "b@example.com", full_name: "B", avatar_url: null, type: "member" },
      ],
      error: null,
    }),
    settlements: () => ({ data: [], error: null }),
  });

  const ledgers = await loadGroupLedgers(supabase, ["g1", "g2"]);
  assertEquals(ledgers.get("g1")?.transactions.length, 1);
  assertEquals(ledgers.get("g2")?.transactions.length, 1);
  assertEquals(new Set(supabase.calls).size, 3);
});
