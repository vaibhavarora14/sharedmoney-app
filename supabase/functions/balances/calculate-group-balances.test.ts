import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  applyEmailAndProfiles,
  assembleHomeGroupBalances,
  calculateGroupBalancesFromLedger,
  membershipGroupIds,
  type Balance,
  type GroupBalance,
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

Deno.test("legacy single-payer rows without transaction_payers keep the same nets", () => {
  const withRows = dinnerLedger();
  withRows.transactions[0].transaction_payers = [
    { participant_id: "p-alice", amount: 100 },
  ];
  assertEquals(sortedBalances(dinnerLedger()), sortedBalances(withRows));
});

Deno.test("two payers and two splitters, including a person who both pays and owes", () => {
  const CHARLIE = "33333333-3333-3333-3333-333333333333";
  const ledger: GroupLedgerSnapshot = {
    transactions: [
      {
        id: 3,
        group_id: "g3",
        amount: 100,
        paid_by_participant_id: "p-alice",
        currency: "INR",
        transaction_payers: [
          { participant_id: "p-alice", amount: 60 },
          { participant_id: "p-bob", amount: 40 },
        ],
        transaction_splits: [
          { participant_id: "p-alice", amount: 50 },
          { participant_id: "p-bob", amount: 30 },
          { participant_id: "p-charlie", amount: 20 },
        ],
      },
    ],
    participants: [
      { id: "p-alice", group_id: "g3", user_id: ALICE, email: "alice@test.com", full_name: "Alice", avatar_url: null, type: "member" },
      { id: "p-bob", group_id: "g3", user_id: BOB, email: "bob@test.com", full_name: "Bob", avatar_url: null, type: "member" },
      { id: "p-charlie", group_id: "g3", user_id: CHARLIE, email: "charlie@test.com", full_name: "Charlie", avatar_url: null, type: "member" },
    ],
    settlements: [],
  };
  const balances = calculateGroupBalancesFromLedger(
    ledger,
    new Map([
      [ALICE, "alice@test.com"],
      [BOB, "bob@test.com"],
      [CHARLIE, "charlie@test.com"],
    ]),
  ).map((row) => ({
    user_id: row.user_id,
    amount: row.amount,
    currency: row.currency,
  })).sort((a, b) => a.user_id.localeCompare(b.user_id));
  // Alice paid 60 owe 50 => +10; Bob paid 40 owe 30 => +10; Charlie paid 0 owe 20 => -20.
  assertEquals(balances, [
    { user_id: ALICE, amount: 10, currency: "INR" },
    { user_id: BOB, amount: 10, currency: "INR" },
    { user_id: CHARLIE, amount: -20, currency: "INR" },
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

function splitLedger(
  groupId: string,
  alicePid: string,
  bobPid: string,
  amount: number,
): GroupLedgerSnapshot {
  return {
    transactions: [
      {
        id: amount,
        group_id: groupId,
        amount,
        paid_by_participant_id: alicePid,
        currency: "INR",
        transaction_splits: [
          { participant_id: alicePid, amount: amount / 2 },
          { participant_id: bobPid, amount: amount / 2 },
        ],
      },
    ],
    participants: [
      { id: alicePid, group_id: groupId, user_id: ALICE, email: "alice@test.com", full_name: "Alice", avatar_url: null, type: "member" },
      { id: bobPid, group_id: groupId, user_id: BOB, email: "bob@test.com", full_name: "Bob", avatar_url: null, type: "member" },
    ],
    settlements: [],
  };
}

/**
 * Oracle: previous Home path — one ledger load per membership group_id,
 * including left and hidden groups, then sum the viewer's amounts.
 */
function oldPerGroupHomeBalances(input: {
  groupIds: string[];
  groups: Array<{ id: string; name?: string | null; kind?: string | null }>;
  ledgers: Map<string, GroupLedgerSnapshot>;
  userIdToEmail: Map<string, string>;
}): GroupBalance[] {
  const groupMap = new Map(input.groups.map((group) => [group.id, group]));
  return input.groupIds.map((groupId) => {
    const group = groupMap.get(groupId);
    const ledger = input.ledgers.get(groupId) ?? {
      transactions: [],
      participants: [],
      settlements: [],
    };
    return {
      group_id: groupId,
      group_name: group?.name || "Unknown Group",
      group_kind: group?.kind === "direct" ? "direct" as const : "standard" as const,
      balances: calculateGroupBalancesFromLedger(ledger, input.userIdToEmail),
    };
  });
}

function oldHomeViewerTotal(groupBalances: GroupBalance[], userId: string): Array<{ currency: string; amount: number }> {
  const overallBalanceMap = new Map<string, number>();
  for (const groupBalance of groupBalances) {
    for (const balance of groupBalance.balances) {
      if (balance.user_id !== userId) continue;
      const current = overallBalanceMap.get(balance.currency) || 0;
      overallBalanceMap.set(balance.currency, current + balance.amount);
    }
  }
  const overall: Array<{ currency: string; amount: number }> = [];
  for (const [currency, amount] of overallBalanceMap.entries()) {
    const roundedAmount = Math.round(amount * 100) / 100;
    if (Math.abs(roundedAmount) > 0.01) {
      overall.push({ currency, amount: roundedAmount });
    }
  }
  return overall.sort((a, b) => a.currency.localeCompare(b.currency));
}

Deno.test("Home includes left and hidden groups and matches the old per-group totals", () => {
  const emails = new Map([
    [ALICE, "alice@test.com"],
    [BOB, "bob@test.com"],
  ]);
  const memberships: HomeMembershipRow[] = [
    { group_id: "active", status: "active", hidden_at: null },
    { group_id: "left", status: "left", hidden_at: null },
    { group_id: "hidden", status: "active", hidden_at: "2026-11-01T00:00:00.000Z" },
  ];
  const groupIds = membershipGroupIds(memberships);
  assertEquals(groupIds, ["active", "left", "hidden"]);

  const ledgers = new Map<string, GroupLedgerSnapshot>([
    ["active", splitLedger("active", "p-a1", "p-b1", 100)],
    ["left", splitLedger("left", "p-a2", "p-b2", 40)],
    ["hidden", splitLedger("hidden", "p-a3", "p-b3", 20)],
  ]);
  const groups = [
    { id: "active", name: "Trip", kind: "standard" },
    { id: "left", name: "Old", kind: "standard" },
    { id: "hidden", name: "Quiet", kind: "direct" },
  ];
  const input = { groupIds, groups, ledgers, userIdToEmail: emails };
  const batched = assembleHomeGroupBalances(input);
  const oracle = oldPerGroupHomeBalances(input);

  assertEquals(
    batched.map((group) => ({
      group_id: group.group_id,
      group_kind: group.group_kind,
      amounts: group.balances
        .map((row) => ({ user_id: row.user_id, amount: row.amount, currency: row.currency }))
        .sort((a, b) => a.user_id.localeCompare(b.user_id)),
    })),
    oracle.map((group) => ({
      group_id: group.group_id,
      group_kind: group.group_kind,
      amounts: group.balances
        .map((row) => ({ user_id: row.user_id, amount: row.amount, currency: row.currency }))
        .sort((a, b) => a.user_id.localeCompare(b.user_id)),
    })),
  );
  assertEquals(oldHomeViewerTotal(batched, ALICE), oldHomeViewerTotal(oracle, ALICE));
  assertEquals(oldHomeViewerTotal(batched, ALICE), [{ currency: "INR", amount: 80 }]);
});

Deno.test("applyEmailAndProfiles fills overall_balances email from the existing map", () => {
  const overall: Balance[] = [{ user_id: ALICE, amount: 50, currency: "INR" }];
  applyEmailAndProfiles(
    overall,
    new Map([[ALICE, "alice@test.com"]]),
    new Map([[ALICE, { full_name: "Alice", avatar_url: null }]]),
  );
  assertEquals(overall[0].email, "alice@test.com");
  assertEquals(overall[0].full_name, "Alice");
});
