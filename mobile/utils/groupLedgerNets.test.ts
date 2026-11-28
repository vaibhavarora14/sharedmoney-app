import { assertEquals } from "jsr:@std/assert@1";
import { calculateGroupNetsFromLedger } from "./groupLedgerNets.ts";

const ALICE = "p-alice";
const BOB = "p-bob";
const CHARLIE = "p-charlie";

const people = [
  { id: ALICE, user_id: "u-alice", full_name: "Alice", type: "member" },
  { id: BOB, user_id: "u-bob", full_name: "Bob", type: "member" },
  { id: CHARLIE, user_id: "u-charlie", full_name: "Charlie", type: "member" },
];

function netsFor(
  expenses: Parameters<typeof calculateGroupNetsFromLedger>[0]["expenses"],
): Record<string, number> {
  const rows = calculateGroupNetsFromLedger({
    expenses,
    settlements: [],
    participants: people,
  });
  return Object.fromEntries(rows.map((row) => [row.participant_id, row.amount]));
}

Deno.test("legacy single-payer expenses without payer rows keep the same nets", () => {
  const legacy = netsFor([{
    amount: 90,
    currency: "INR",
    paid_by_participant_id: ALICE,
    splits: [
      { participant_id: ALICE, amount: 30 },
      { participant_id: BOB, amount: 30 },
      { participant_id: CHARLIE, amount: 30 },
    ],
  }]);
  const stored = netsFor([{
    amount: 90,
    currency: "INR",
    paid_by_participant_id: ALICE,
    payers: [{ participant_id: ALICE, amount: 90 }],
    splits: [
      { participant_id: ALICE, amount: 30 },
      { participant_id: BOB, amount: 30 },
      { participant_id: CHARLIE, amount: 30 },
    ],
  }]);
  assertEquals(legacy, stored);
  assertEquals(legacy, { [ALICE]: 60, [BOB]: -30, [CHARLIE]: -30 });
});

Deno.test("two payers and a splitter who also paid land the right nets", () => {
  // Alice paid 60, Bob paid 40. Shares 50 / 30 / 20.
  assertEquals(
    netsFor([{
      amount: 100,
      currency: "INR",
      paid_by_participant_id: ALICE,
      payers: [
        { participant_id: ALICE, amount: 60 },
        { participant_id: BOB, amount: 40 },
      ],
      splits: [
        { participant_id: ALICE, amount: 50 },
        { participant_id: BOB, amount: 30 },
        { participant_id: CHARLIE, amount: 20 },
      ],
    }]),
    { [ALICE]: 10, [BOB]: 10, [CHARLIE]: -20 },
  );
});
