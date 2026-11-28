import { assertEquals } from "jsr:@std/assert@1";
import {
  calculateShareSplits,
  remainingSplitAmount,
} from "./splits.ts";
import {
  formatPaidByLabel,
  formatPayerLine,
  resolveExpensePayers,
  viewerPaidAmount,
} from "./expensePayers.ts";

const ALICE = "p-alice";
const BOB = "p-bob";

Deno.test("missing payer rows fall back to paid_by without changing the total", () => {
  assertEquals(
    resolveExpensePayers({
      amount: 90,
      paid_by_participant_id: ALICE,
      paid_by: "u-alice",
    }),
    [{ participant_id: ALICE, user_id: "u-alice", amount: 90 }],
  );
});

Deno.test("stored payer rows win over the single paid_by column", () => {
  assertEquals(
    resolveExpensePayers({
      amount: 4800,
      paid_by_participant_id: ALICE,
      payers: [
        { participant_id: ALICE, amount: 3000, user_id: "u-alice" },
        { participant_id: BOB, amount: 1800, user_id: "u-bob" },
      ],
    }),
    [
      { participant_id: ALICE, user_id: "u-alice", amount: 3000 },
      { participant_id: BOB, user_id: "u-bob", amount: 1800 },
    ],
  );
});

Deno.test("share allocations reconcile to the expense total", () => {
  const shares = calculateShareSplits(4800, [ALICE, BOB], { [ALICE]: 2, [BOB]: 1 });
  assertEquals(shares, [
    { participant_id: ALICE, amount: 3200 },
    { participant_id: BOB, amount: 1600 },
  ]);
  assertEquals(remainingSplitAmount(4800, 3200 + 1600), 0);
});

Deno.test("list copy uses + N for two payers and a count for three", () => {
  assertEquals(
    formatPayerLine({ payerNames: ["Asha"], amount: 4800, currency: "INR" }),
    "Asha paid ₹4,800",
  );
  assertEquals(
    formatPayerLine({ payerNames: ["Asha", "Rohan"], amount: 4800, currency: "INR" }),
    "Asha + 1 paid ₹4,800",
  );
  assertEquals(
    formatPayerLine({ payerNames: ["Asha", "Rohan", "You"], amount: 4800, currency: "INR" }),
    "3 people paid ₹4,800",
  );
});

Deno.test("detail copy names two payers and counts three", () => {
  assertEquals(formatPaidByLabel(["Asha"]), "Asha");
  assertEquals(formatPaidByLabel(["Asha", "Rohan"]), "Asha and Rohan");
  assertEquals(formatPaidByLabel(["Asha", "Rohan", "You"]), "3 people");
});

Deno.test("viewer paid amount sums only that person's payer rows", () => {
  const payers = resolveExpensePayers({
    amount: 100,
    paid_by_participant_id: ALICE,
    payers: [
      { participant_id: ALICE, amount: 60, user_id: "u-alice" },
      { participant_id: BOB, amount: 40, user_id: "u-bob" },
    ],
  });
  assertEquals(viewerPaidAmount(payers, { participantId: ALICE, userId: "u-alice" }), 60);
  assertEquals(viewerPaidAmount(payers, { participantId: BOB }), 40);
  assertEquals(viewerPaidAmount(payers, { participantId: "p-other" }), 0);
});
