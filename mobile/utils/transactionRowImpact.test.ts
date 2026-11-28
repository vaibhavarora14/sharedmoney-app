import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildExpenseRowModel,
  NOT_IN_SPLIT_LABEL,
  paymentAmountText,
  paymentInvolvesViewer,
  paymentRowTitle,
  SAVING_PAYER_LINE,
} from "./transactionRowImpact.ts";

const viewer = { userId: "me", participantId: "p-me" };

Deno.test("expense impact is words for the viewer's share, and whole amounts drop .00", () => {
  const lent = buildExpenseRowModel({
    amount: 2100,
    currency: "INR",
    payerName: "You",
    paidByParticipantId: "p-me",
    splits: [
      { participant_id: "p-me", amount: 700 },
      { participant_id: "p-rahul", amount: 1400 },
    ],
    viewer,
  });
  assertEquals(lent.payerLine, "You paid ₹2,100");
  assertEquals(lent.impactText, "You're owed ₹1,400");
  assertEquals(lent.impactAmountText, "₹1,400");
  assertEquals(lent.impactDirectionText, "You're owed");
  assertEquals(lent.impactText.includes(".00"), false);
  assertEquals(lent.impactMuted, false);
  assertEquals(lent.involvesViewer, true);

  const borrowed = buildExpenseRowModel({
    amount: 4800,
    currency: "INR",
    payerName: "Rahul",
    paidByParticipantId: "p-rahul",
    splits: [
      { participant_id: "p-me", amount: 1200 },
      { participant_id: "p-rahul", amount: 3600 },
    ],
    viewer,
  });
  assertEquals(borrowed.payerLine, "Rahul paid ₹4,800");
  assertEquals(borrowed.impactText, "You owe ₹1,200");
  assertEquals(borrowed.impactAmountText, "₹1,200");
  assertEquals(borrowed.impactDirectionText, "You owe");
  assertEquals(borrowed.net, -1200);

  const fractional = buildExpenseRowModel({
    amount: 10.5,
    currency: "USD",
    payerName: "You",
    paidByUserId: "me",
    splits: [{ participant_id: "p-me", user_id: "me", amount: 0 }],
    viewer,
  });
  assertEquals(fractional.impactText, "You're owed $10.50");
});

Deno.test("a viewer who did not pay and is not in the split sees not in split", () => {
  const row = buildExpenseRowModel({
    amount: 900,
    currency: "INR",
    payerName: "Meera",
    paidByParticipantId: "p-meera",
    splits: [
      { participant_id: "p-meera", amount: 450 },
      { participant_id: "p-dev", amount: 450 },
    ],
    viewer,
  });
  assertEquals(row.impactText, NOT_IN_SPLIT_LABEL);
  assertEquals(row.impactAmountText, "");
  assertEquals(row.impactDirectionText, NOT_IN_SPLIT_LABEL);
  assertEquals(row.impactMuted, true);
  assertEquals(row.involvesViewer, false);
  assertEquals(row.net, null);
});

Deno.test("a foreign-currency expense keeps that currency on the payer line", () => {
  const row = buildExpenseRowModel({
    amount: 1200,
    currency: "THB",
    payerName: "You",
    paidByParticipantId: "p-me",
    splits: [
      { participant_id: "p-me", amount: 400 },
      { participant_id: "p-rahul", amount: 800 },
    ],
    viewer,
  });
  assertEquals(row.payerLine, "You paid ฿1,200");
  assertEquals(row.impactText, "You're owed ฿800");
  assertEquals(row.impactMuted, false);
});

Deno.test("saving rows replace the payer line and still keep the impact", () => {
  const row = buildExpenseRowModel({
    amount: 600,
    currency: "INR",
    payerName: "You",
    paidByUserId: "me",
    splits: [{ participant_id: "p-me", amount: 0 }],
    viewer,
    saving: true,
  });
  assertEquals(row.payerLine, SAVING_PAYER_LINE);
  assertEquals(row.impactText, "You're owed ₹600");
});

Deno.test("unknown splits do not invent an impact", () => {
  const row = buildExpenseRowModel({
    amount: 100,
    currency: "INR",
    payerName: "Rahul",
    paidByParticipantId: "p-rahul",
    splits: null,
    viewer,
  });
  assertEquals(row.impactText, "");
  assertEquals(row.involvesViewer, false);
});

Deno.test("payment rows are an unsigned amount and never a Payment subtitle", () => {
  assertEquals(paymentRowTitle("Rahul", "You"), "Rahul paid you");
  assertEquals(paymentRowTitle("You", "Meera"), "You paid Meera");
  assertEquals(paymentRowTitle("Rahul", "Meera"), "Rahul paid Meera");
  assertEquals(paymentAmountText(1000, "INR"), "₹1,000");
  assertEquals(paymentAmountText(1000.0, "INR").includes(".00"), false);
  assertEquals(paymentAmountText(-1000, "INR"), "₹1,000");
  const title = paymentRowTitle("Rahul", "You");
  assertEquals(title.includes("Payment"), false);
  assertEquals(paymentInvolvesViewer({
    fromParticipantId: "p-rahul",
    toParticipantId: "p-me",
    viewer,
  }), true);
  assertEquals(paymentInvolvesViewer({
    fromParticipantId: "p-rahul",
    toParticipantId: "p-meera",
    viewer,
  }), false);
});
