import { assertEquals } from "jsr:@std/assert@1";
import type { Participant, Settlement, Transaction } from "../types";
import { emptyRateBook } from "./currencyMerge.ts";
import {
  buildExpenseDetailModel,
  buildPaymentDetailModel,
  resolveExpenseDetailTransaction,
} from "./transactionDetail.ts";

const viewer = "me";
const participants: Participant[] = [
  { id: "p-me", group_id: "g", user_id: viewer, type: "member", full_name: "You" },
  { id: "p-rahul", group_id: "g", user_id: "rahul", type: "member", full_name: "Rahul" },
  { id: "p-meera", group_id: "g", user_id: "meera", type: "member", full_name: "Meera" },
  { id: "p-dev", group_id: "g", user_id: "dev", type: "member", full_name: "Dev" },
];

function expense(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    amount: 4800,
    description: "Dinner at Thalassa",
    date: "2026-11-12",
    type: "expense",
    category: "Food & drink",
    currency: "INR",
    paid_by_participant_id: "p-rahul",
    paid_by: "rahul",
    user_id: "rahul",
    created_at: "2026-11-11T15:44:00.000Z",
    splits: [
      { participant_id: "p-dev", user_id: "dev", amount: 1200 },
      { participant_id: "p-rahul", user_id: "rahul", amount: 1200 },
      { participant_id: "p-me", user_id: viewer, amount: 1200 },
      { participant_id: "p-meera", user_id: "meera", amount: 1200 },
    ],
    ...overrides,
  };
}

const now = new Date(2026, 10, 12, 15, 0, 0);

Deno.test("equal split detail names people once and keeps your line secondary", () => {
  const detail = buildExpenseDetailModel({
    transaction: expense(),
    viewerUserId: viewer,
    viewerParticipantId: "p-me",
    participants,
    now,
  });
  assertEquals(detail.amountText, "₹4,800");
  assertEquals(detail.metaLine, "Today · Food & drink");
  assertEquals(detail.yourLine, "You borrowed ₹1,200");
  assertEquals(detail.paidBy, "Rahul");
  assertEquals(detail.split, {
    mode: "equal",
    line: "Split equally · ₹1,200 each",
    names: ["You", "Dev", "Rahul", "Meera"],
  });
  assertEquals(detail.rateLine, null);
  assertEquals(detail.historySummary, "Added by Rahul · 11 Nov, 3:44 PM");
});

Deno.test("unequal split keeps per-person amounts with You first", () => {
  const detail = buildExpenseDetailModel({
    transaction: expense({
      amount: 2100,
      description: "Scooter rental",
      paid_by_participant_id: "p-me",
      paid_by: viewer,
      splits: [
        { participant_id: "p-rahul", user_id: "rahul", amount: 1000 },
        { participant_id: "p-me", user_id: viewer, amount: 700 },
        { participant_id: "p-meera", user_id: "meera", amount: 400 },
      ],
    }),
    viewerUserId: viewer,
    viewerParticipantId: "p-me",
    participants,
    now,
  });
  assertEquals(detail.yourLine, "You lent ₹1,400");
  assertEquals(detail.split.mode, "unequal");
  if (detail.split.mode !== "unequal") return;
  assertEquals(detail.split.people.map((person) => person.name), ["You", "Rahul", "Meera"]);
  assertEquals(detail.split.people[0].amountText, "₹700");
  assertEquals(detail.split.people[1].amountText, "₹1,000");
});

Deno.test("not in split stays a secondary line", () => {
  const detail = buildExpenseDetailModel({
    transaction: expense({
      description: "Taxi to airport",
      amount: 900,
      paid_by_participant_id: "p-meera",
      splits: [
        { participant_id: "p-meera", user_id: "meera", amount: 450 },
        { participant_id: "p-rahul", user_id: "rahul", amount: 450 },
      ],
    }),
    viewerUserId: viewer,
    viewerParticipantId: "p-me",
    participants,
    now,
  });
  assertEquals(detail.yourLine, "Not in this split");
  assertEquals(detail.amountText, "₹900");
});

Deno.test("converted amount keeps the original total and one rate line", () => {
  const detail = buildExpenseDetailModel({
    transaction: expense({
      description: "Beach shack",
      amount: 1200,
      currency: "THB",
      category: "Food & drink",
      paid_by_participant_id: "p-me",
      paid_by: viewer,
      splits: [
        { participant_id: "p-me", user_id: viewer, amount: 400 },
        { participant_id: "p-rahul", user_id: "rahul", amount: 800 },
      ],
    }),
    viewerUserId: viewer,
    viewerParticipantId: "p-me",
    participants,
    now,
    unifyEnabled: true,
    settlementCurrency: "INR",
    rateBook: emptyRateBook({ USD: 1, INR: 83, THB: 32 }),
  });
  assertEquals(detail.amountText, "฿1,200");
  assertEquals(detail.yourLine, "You lent ฿800");
  assertEquals(detail.rateLine, "Converted ₹3,112.50 at 2.59");
});

Deno.test("payment detail is a title and an unsigned amount", () => {
  const settlement: Settlement = {
    id: "pay-1",
    group_id: "g",
    from_user_id: "rahul",
    to_user_id: viewer,
    from_participant_id: "p-rahul",
    to_participant_id: "p-me",
    amount: 1000,
    currency: "INR",
    created_by: "rahul",
    created_at: "2026-11-11T18:00:00.000Z",
  };
  const detail = buildPaymentDetailModel({
    settlement,
    viewerUserId: viewer,
    viewerParticipantId: "p-me",
    participants,
    now,
  });
  assertEquals(detail.title, "Rahul paid you");
  assertEquals(detail.amountText, "₹1,000");
  assertEquals(detail.yourLine, null);
  assertEquals(detail.paidBy, "Rahul");
  assertEquals(detail.paidTo, "You");
  assertEquals(detail.split.mode, "none");
});

Deno.test("expense detail prefers live feed receipts over the frozen snapshot", () => {
  const snapshot = expense({ receipts: [] });
  const live = expense({
    receipts: [{
      id: "abcdef12-3456-7890-abcd-ef1234567890",
      transaction_id: 1,
      group_id: "g",
      storage_path: "g/1/abcdef12-3456-7890-abcd-ef1234567890.jpg",
      content_type: "image/jpeg",
    }],
  });
  const resolved = resolveExpenseDetailTransaction(snapshot, [live]);
  assertEquals(resolved.receipts?.length, 1);
  assertEquals(resolved.receipts?.[0].id, "abcdef12-3456-7890-abcd-ef1234567890");
  assertEquals(resolveExpenseDetailTransaction(snapshot, []).receipts, []);
});
