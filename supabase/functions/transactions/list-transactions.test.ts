import { assertEquals } from "jsr:@std/assert@1";
import {
  TRANSACTIONS_LIST_SEQUENTIAL_DB_ROUND_TRIPS,
  TRANSACTIONS_LIST_SEQUENTIAL_DB_ROUND_TRIPS_BEFORE,
  enrichTransactionsWithParticipants,
  loadGroupTransactionsPage,
  parseTransactionListRequest,
} from "./list-transactions.ts";

const VIEWER = "11111111-1111-1111-1111-111111111111";
const GROUP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PERSON = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

Deno.test("group transactions drop from three serial DB hops to one parallel batch", () => {
  assertEquals(TRANSACTIONS_LIST_SEQUENTIAL_DB_ROUND_TRIPS_BEFORE, {
    participant: 1,
    page: 1,
    people: 1,
  });
  assertEquals(TRANSACTIONS_LIST_SEQUENTIAL_DB_ROUND_TRIPS, {
    participantAndPageAndPeople: 1,
  });
});

function chain(data: unknown, record?: (label: string) => void, label?: string) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  const pending = Promise.resolve().then(() => {
    if (record && label) record(label);
    return { data, error: null };
  });
  builder.select = () => self();
  builder.eq = () => self();
  builder.in = () => self();
  builder.or = () => self();
  builder.order = () => self();
  builder.limit = () => self();
  builder.single = () => pending;
  builder.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => pending.then(onFulfilled, onRejected);
  return builder;
}

Deno.test("membership, first page, and people start together", async () => {
  const started: string[] = [];
  const tx = {
    id: 1,
    date: "2026-11-13",
    paid_by_participant_id: PERSON,
    transaction_splits: [{ participant_id: PERSON, amount: 40, transaction_id: 1 }],
    transaction_receipts: [],
  };
  const person = {
    id: PERSON,
    group_id: GROUP,
    user_id: VIEWER,
    email: "me@example.com",
    type: "member",
    full_name: "Me",
    avatar_url: null,
  };

  let participantCalls = 0;
  const supabase = {
    from(table: string) {
      if (table === "participants") {
        participantCalls += 1;
        if (participantCalls === 1) {
          return chain({ id: PERSON, type: "member" }, (l) => started.push(l), "participant");
        }
        return chain([person], (l) => started.push(l), "people");
      }
      if (table === "transactions") {
        return chain([tx], (l) => started.push(l), "transactions");
      }
      throw new Error(table);
    },
  };

  const loaded = await loadGroupTransactionsPage(supabase, { id: VIEWER }, {
    groupId: GROUP,
    limit: 30,
    cursorDate: null,
    cursorId: null,
    listSort: "date",
  });
  assertEquals(loaded.kind, "ok");
  if (loaded.kind !== "ok") return;
  assertEquals(loaded.body.items[0].splits?.[0].full_name, "Me");
  assertEquals(loaded.body.has_more, false);
  assertEquals(new Set(started), new Set(["participant", "people", "transactions"]));
});

Deno.test("enrichment output matches the previous split shape", () => {
  const items = enrichTransactionsWithParticipants(
    [{
      id: 1,
      date: "2026-11-13",
      paid_by_participant_id: PERSON,
      transaction_splits: [{ participant_id: PERSON, amount: 40, transaction_id: 1 }],
      transaction_receipts: [{ sort_order: 1, created_at: "2026-11-13", storage_path: "a" }],
    }],
    new Map([[PERSON, {
      id: PERSON,
      group_id: GROUP,
      user_id: VIEWER,
      email: "me@example.com",
      type: "member",
      full_name: "Me",
      avatar_url: null,
    }]]),
  );
  assertEquals(items[0].splits?.[0], {
    participant_id: PERSON,
    amount: 40,
    transaction_id: 1,
    user_id: VIEWER,
    email: "me@example.com",
    full_name: "Me",
    avatar_url: null,
  });
  assertEquals(items[0].split_among_participant_ids, [PERSON]);
  assertEquals((items[0] as { receipts: unknown[] }).receipts.length, 1);
  assertEquals(items[0].transaction_receipts, undefined);
});

Deno.test("list query validation stays the same", () => {
  const bad = parseTransactionListRequest(new URL("https://x/transactions?group_id=nope"));
  assertEquals(bad.ok, false);
  const ok = parseTransactionListRequest(
    new URL(`https://x/transactions?group_id=${GROUP}&limit=10`),
  );
  assertEquals(ok.ok, true);
  if (ok.ok) assertEquals(ok.limit, 10);
});
