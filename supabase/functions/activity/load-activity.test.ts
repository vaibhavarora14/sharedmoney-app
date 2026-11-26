import { assertEquals } from "jsr:@std/assert@1";
import {
  GET_GROUP_ACTIVITY_PAGE_RPC,
  assembleActivityFeed,
  loadActivityFeed,
  loadActivityFeedFromTables,
  type ActivityPageRpcRow,
  type Participant,
  type TransactionHistory,
} from "./load-activity.ts";

const VIEWER = "11111111-1111-1111-1111-111111111111";
const AISHA = "22222222-2222-2222-2222-222222222222";
const BLOCKED = "33333333-3333-3333-3333-333333333333";
const GROUP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PAYER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const historyRow: TransactionHistory = {
  id: "hist-1",
  transaction_id: 9,
  settlement_id: null,
  activity_type: "transaction",
  group_id: GROUP,
  action: "created",
  changed_by: AISHA,
  changed_at: "2026-11-13T02:00:00",
  changes: {
    action: "created",
    transaction: {
      id: 9,
      amount: 40,
      description: "Dinner",
      date: "2026-11-13",
      type: "expense",
      currency: "INR",
      user_id: AISHA,
      group_id: GROUP,
      paid_by: AISHA,
      created_at: "2026-11-13T02:00:00",
    },
  },
  snapshot: {
    transaction: {
      id: 9,
      amount: 40,
      description: "Dinner",
      date: "2026-11-13",
      type: "expense",
      currency: "INR",
      user_id: AISHA,
      group_id: GROUP,
      paid_by: AISHA,
      created_at: "2026-11-13T02:00:00",
    },
  },
};

const blockedRow: TransactionHistory = {
  ...historyRow,
  id: "hist-blocked",
  changed_by: BLOCKED,
};

const participant: Participant = {
  id: PAYER,
  group_id: GROUP,
  user_id: AISHA,
  email: null,
  type: "member",
  full_name: "Aisha Kapoor",
  avatar_url: null,
};

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  const pending = Promise.resolve(result);
  builder.select = () => self();
  builder.eq = () => self();
  builder.in = () => self();
  builder.not = () => self();
  builder.order = () => self();
  builder.range = () => self();
  builder.single = () => pending;
  builder.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => pending.then(onFulfilled, onRejected);
  return builder;
}

Deno.test("RPC activity feed matches the table path for the same fixtures", async () => {
  const started: string[] = [];
  const history = [historyRow, blockedRow];
  const visible = [historyRow];
  const emails = [{ id: AISHA, email: "aisha@example.com" }];
  const profiles = [{ id: AISHA, full_name: "Aisha Kapoor", avatar_url: null }];

  const tableClient = {
    from(table: string) {
      started.push(table);
      if (table === "group_members") {
        return chain({ data: { id: "m1" }, error: null });
      }
      if (table === "user_blocks") {
        return chain({ data: [{ blocked_user_id: BLOCKED }], error: null });
      }
      if (table === "transaction_history") {
        return chain({ data: visible, error: null, count: 1 });
      }
      if (table === "participants") {
        return chain({ data: [participant], error: null });
      }
      if (table === "profiles") {
        return chain({ data: profiles, error: null });
      }
      throw new Error(table);
    },
  };

  const fetchEmails = async () => {
    started.push("emails");
    return new Map([[AISHA, "aisha@example.com"]]);
  };

  const tablePath = await loadActivityFeedFromTables(
    tableClient,
    { id: VIEWER, email: "me@example.com" },
    GROUP,
    50,
    0,
    fetchEmails,
  );

  const rpcStarted: string[] = [];
  const rpcRow: ActivityPageRpcRow = {
    is_member: true,
    total: 1,
    history: visible,
    participants: [participant],
    profiles,
    emails,
  };
  const rpcPath = await loadActivityFeed(
    {
      rpc(fn, args) {
        rpcStarted.push(fn);
        assertEquals(fn, GET_GROUP_ACTIVITY_PAGE_RPC);
        assertEquals(args.p_group_id, GROUP);
        return Promise.resolve({ data: [rpcRow], error: null });
      },
    },
    { id: VIEWER, email: "me@example.com" },
    GROUP,
    50,
    0,
  );

  assertEquals(tablePath.kind, "ok");
  assertEquals(rpcPath.kind, "ok");
  if (tablePath.kind !== "ok" || rpcPath.kind !== "ok") return;
  assertEquals(rpcPath.body, tablePath.body);
  assertEquals(rpcPath.body.activities[0].changed_by.email, "aisha@example.com");
  assertEquals(rpcPath.body.activities[0].description.includes("Dinner"), true);
  assertEquals(rpcStarted, [GET_GROUP_ACTIVITY_PAGE_RPC]);
  assertEquals(started[0], "group_members");
  assertEquals(started.includes("transaction_history"), true);
  assertEquals(started.includes("participants"), true);
});

Deno.test("non-members are forbidden on both paths", async () => {
  const tablePath = await loadActivityFeedFromTables(
    {
      from(table: string) {
        if (table === "group_members") return chain({ data: null, error: { message: "missing" } });
        if (table === "user_blocks") return chain({ data: [], error: null });
        throw new Error(table);
      },
    },
    { id: VIEWER, email: null },
    GROUP,
    50,
    0,
  );
  const rpcPath = await loadActivityFeed(
    {
      rpc: () =>
        Promise.resolve({
          data: [{
            is_member: false,
            total: 0,
            history: [],
            participants: [],
            profiles: [],
            emails: [],
          }],
          error: null,
        }),
    },
    { id: VIEWER, email: null },
    GROUP,
    50,
    0,
  );
  assertEquals(tablePath, { kind: "forbidden" });
  assertEquals(rpcPath, { kind: "forbidden" });
});

Deno.test("assembleActivityFeed keeps the v1 envelope", () => {
  const body = assembleActivityFeed({
    history: [historyRow],
    emails: [{ id: AISHA, email: "aisha@example.com" }],
    profiles: [{ id: AISHA, full_name: "Aisha Kapoor", avatar_url: null }],
    participants: [participant],
    currentUserId: VIEWER,
    currentUserEmail: "me@example.com",
    offset: 0,
    limit: 50,
    total: 1,
    countError: false,
  });
  assertEquals(Object.keys(body).sort(), ["activities", "has_more", "total"]);
  assertEquals(body.total, 1);
  assertEquals(body.has_more, false);
  assertEquals(body.activities.length, 1);
});
