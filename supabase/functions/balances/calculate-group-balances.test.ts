import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  assembleHomeGroupBalances,
  calculateGroupBalancesFromLedger,
  visibleHomeGroupIds,
  type HomeMembershipRow,
} from "./calculate-group-balances.ts";
import type { GroupLedgerSnapshot } from "./load-group-ledger.ts";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";

function dinnerLedger(): GroupLedgerSnapshot {
  return {
    transactions: [
      {
        id: 1,
        group_id: "g1",
        amount: 100,
        paid_by_participant_id: "p-alice",
        currency: "INR",
        transaction_splits: [
          { participant_id: "p-alice", amount: 50 },
          { participant_id: "p-bob", amount: 50 },
        ],
      },
    ],
    participants: [
      { id: "p-alice", group_id: "g1", user_id: ALICE, email: "alice@test.com", full_name: "Alice", avatar_url: null, type: "member" },
      { id: "p-bob", group_id: "g1", user_id: BOB, email: "bob@test.com", full_name: "Bob", avatar_url: null, type: "member" },
    ],
    settlements: [],
  };
}

function taxiLedger(): GroupLedgerSnapshot {
  return {
    transactions: [
      {
        id: 2,
        group_id: "g2",
        amount: 40,
        paid_by_participant_id: "p-bob-2",
        currency: "INR",
        transaction_splits: [
          { participant_id: "p-alice-2", amount: 20 },
          { participant_id: "p-bob-2", amount: 20 },
        ],
      },
    ],
    participants: [
      { id: "p-alice-2", group_id: "g2", user_id: ALICE, email: "alice@test.com", full_name: "Alice", avatar_url: null, type: "member" },
      { id: "p-bob-2", group_id: "g2", user_id: BOB, email: "bob@test.com", full_name: "Bob", avatar_url: null, type: "member" },
    ],
    settlements: [],
  };
}

function sortedBalances(ledger: GroupLedgerSnapshot) {
  return calculateGroupBalancesFromLedger(ledger, new Map([
    [ALICE, "alice@test.com"],
    [BOB, "bob@test.com"],
  ])).map((row) => ({
    user_id: row.user_id,
    amount: row.amount,
    currency: row.currency,
  })).sort((a, b) => a.user_id.localeCompare(b.user_id));
}

Deno.test("single-group dinner split is +50 / -50", () => {
  const balances = sortedBalances(dinnerLedger());
  assertEquals(balances, [
    { user_id: ALICE, amount: 50, currency: "INR" },
    { user_id: BOB, amount: -50, currency: "INR" },
  ]);
});

Deno.test("batched Home ledgers match per-group math", () => {
  const emails = new Map([
    [ALICE, "alice@test.com"],
    [BOB, "bob@test.com"],
  ]);
  const ledgers = new Map<string, GroupLedgerSnapshot>([
    ["g1", dinnerLedger()],
    ["g2", taxiLedger()],
  ]);
  const batched = assembleHomeGroupBalances({
    groupIds: ["g1", "g2"],
    groups: [
      { id: "g1", name: "Dinner", kind: "standard" },
      { id: "g2", name: "Taxi", kind: "standard" },
    ],
    ledgers,
    userIdToEmail: emails,
  });
  const perGroup = ["g1", "g2"].map((groupId) => ({
    group_id: groupId,
    balances: calculateGroupBalancesFromLedger(ledgers.get(groupId)!, emails),
  }));
  assertEquals(
    batched.map((group) => ({
      group_id: group.group_id,
      amounts: group.balances.map((row) => ({ user_id: row.user_id, amount: row.amount })).sort((a, b) => a.user_id.localeCompare(b.user_id)),
    })),
    perGroup.map((group) => ({
      group_id: group.group_id,
      amounts: group.balances.map((row) => ({ user_id: row.user_id, amount: row.amount })).sort((a, b) => a.user_id.localeCompare(b.user_id)),
    })),
  );
});

Deno.test("Home list skips groups the user left or hid", () => {
  const rows: HomeMembershipRow[] = [
    { group_id: "active", status: "active", hidden_at: null },
    { group_id: "left", status: "left", hidden_at: null },
    { group_id: "hidden", status: "active", hidden_at: "2026-11-01T00:00:00.000Z" },
    { group_id: "archived-ok", status: "active", hidden_at: null },
  ];
  assertEquals(visibleHomeGroupIds(rows), ["active", "archived-ok"]);
});
