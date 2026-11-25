import { assertEquals, assert } from "jsr:@std/assert@1";
import type { Participant, Settlement, Transaction } from "../types";
import {
  buildBalanceBreakdown,
  displayedBalanceBetween,
  formatBreakdownDate,
} from "./balanceBreakdown.ts";
import { calculateGroupNetsFromLedger } from "./groupLedgerNets.ts";
import { calculateEqualSplits } from "./splits.ts";
import { viewerSettlementRows } from "./groupPosition.ts";
import { emptyRateBook } from "./currencyMerge.ts";

const VIEWER = "u-asha";
const PRIYA = "u-priya";
const RAHUL = "u-rahul";

const participants: Participant[] = [
  { id: "p-asha", group_id: "g", user_id: VIEWER, type: "member", full_name: "Asha Rao" },
  { id: "p-priya", group_id: "g", user_id: PRIYA, type: "member", full_name: "Priya Shah" },
  { id: "p-rahul", group_id: "g", user_id: RAHUL, type: "member", full_name: "Rahul Mehta" },
];

const viewer = { participantId: "p-asha", userId: VIEWER };
const priya = { participantId: "p-priya", userId: PRIYA };

function expense(input: {
  id: number;
  description: string;
  date: string;
  amount: number;
  payer: string;
  among: string[];
  splits?: Transaction["splits"];
  currency?: string;
}): Transaction {
  const currency = input.currency ?? "INR";
  const splits = input.splits ?? calculateEqualSplits(input.amount, input.among).map((share) => ({
    participant_id: share.participant_id,
    amount: share.amount,
  }));
  return {
    id: input.id,
    description: input.description,
    date: input.date,
    amount: input.amount,
    type: "expense",
    currency,
    paid_by_participant_id: input.payer,
    splits,
  };
}

function payment(input: {
  id: string;
  from: string;
  to: string;
  amount: number;
  created_at: string;
  notes?: string;
  currency?: string;
}): Settlement {
  return {
    id: input.id,
    group_id: "g",
    from_user_id: "",
    to_user_id: "",
    from_participant_id: input.from,
    to_participant_id: input.to,
    amount: input.amount,
    currency: input.currency ?? "INR",
    notes: input.notes,
    created_by: VIEWER,
    created_at: input.created_at,
  };
}

function displayed(expenses: Transaction[], settlements: Settlement[]) {
  const balances = calculateGroupNetsFromLedger({
    expenses,
    settlements,
    participants,
  });
  return displayedBalanceBetween({
    balances,
    viewer,
    other: priya,
    currency: "INR",
    defaultCurrency: "INR",
  });
}

function breakdown(expenses: Transaction[], settlements: Settlement[]) {
  return buildBalanceBreakdown({
    expenses,
    settlements,
    participants,
    viewer,
    other: priya,
    currency: "INR",
    viewerName: "You",
    otherName: "Priya",
    defaultCurrency: "INR",
  });
}

Deno.test("formatBreakdownDate keeps the calendar day", () => {
  assertEquals(formatBreakdownDate("2026-11-12"), "12 Nov 2026");
  assertEquals(formatBreakdownDate("2026-01-03T18:00:00.000Z"), "3 Jan 2026");
});

Deno.test("equal splits: breakdown total equals the displayed Priya row", () => {
  const expenses = [
    expense({
      id: 1,
      description: "Dinner",
      date: "2026-11-10",
      amount: 1600,
      payer: "p-asha",
      among: ["p-asha", "p-priya"],
    }),
  ];
  const row = displayed(expenses, []);
  const result = breakdown(expenses, []);
  assertEquals(row, 800);
  assertEquals(result.total, row);
  assertEquals(result.entries.length, 1);
  assertEquals(result.entries[0].description, "Dinner");
  assertEquals(result.entries[0].paidByName, "You");
  assertEquals(result.entries[0].shareAmount, 800);
  assertEquals(result.entries[0].effect, 800);
  assertEquals(result.entries[0].running, 800);
});

Deno.test("unequal splits: breakdown total equals the displayed row", () => {
  const expenses = [
    expense({
      id: 2,
      description: "Groceries",
      date: "2026-11-11",
      amount: 1000,
      payer: "p-asha",
      among: ["p-asha", "p-priya"],
      splits: [
        { participant_id: "p-asha", amount: 250 },
        { participant_id: "p-priya", amount: 750 },
      ],
    }),
  ];
  const row = displayed(expenses, []);
  const result = breakdown(expenses, []);
  assertEquals(row, 750);
  assertEquals(result.total, row);
  assertEquals(result.entries[0].shareAmount, 750);
  assertEquals(result.entries[0].effect, 750);
});

Deno.test("percentage-style weights: breakdown total equals the displayed row", () => {
  const expenses = [
    expense({
      id: 3,
      description: "Airbnb",
      date: "2026-11-08",
      amount: 5000,
      payer: "p-priya",
      among: ["p-asha", "p-priya"],
      splits: [
        { participant_id: "p-asha", amount: 2000 },
        { participant_id: "p-priya", amount: 3000 },
      ],
    }),
  ];
  const row = displayed(expenses, []);
  const result = breakdown(expenses, []);
  assertEquals(row, -2000);
  assertEquals(result.total, row);
  assertEquals(result.entries[0].paidByName, "Priya Shah");
  assertEquals(result.entries[0].shareLabel, "Your share");
  assertEquals(result.entries[0].shareAmount, 2000);
});

Deno.test("expense paid by a third person does not create a Priya row on its own", () => {
  const expenses = [
    expense({
      id: 4,
      description: "Movie",
      date: "2026-11-09",
      amount: 900,
      payer: "p-rahul",
      among: ["p-asha", "p-priya", "p-rahul"],
    }),
  ];
  const row = displayed(expenses, []);
  const result = breakdown(expenses, []);
  assertEquals(row, 0);
  assertEquals(result.total, row);
  assertEquals(result.entries.length, 0);
});

Deno.test("third-person expense still keeps the breakdown total on the displayed row", () => {
  const expenses = [
    expense({
      id: 5,
      description: "Dinner",
      date: "2026-11-10",
      amount: 1600,
      payer: "p-asha",
      among: ["p-asha", "p-priya"],
    }),
    expense({
      id: 6,
      description: "Movie",
      date: "2026-11-11",
      amount: 900,
      payer: "p-rahul",
      among: ["p-asha", "p-priya", "p-rahul"],
    }),
  ];
  const row = displayed(expenses, []);
  const result = breakdown(expenses, []);
  assertEquals(result.total, row);
  const dinner = result.entries.find((entry) => entry.description === "Dinner");
  const movie = result.entries.find((entry) => entry.description === "Movie");
  assert(dinner, "Dinner must contribute");
  assertEquals(dinner.effect, 800);
  // Group simplification moves part of Priya's debt onto Rahul.
  assert(movie, "Movie must appear because it changes the displayed Priya edge");
  assertEquals(movie.effect, row - 800);
  assertEquals(result.entries[result.entries.length - 1].running, row);
});

Deno.test("settlements: payment reduces the displayed row by the same amount", () => {
  const expenses = [
    expense({
      id: 7,
      description: "Dinner",
      date: "2026-11-10",
      amount: 1600,
      payer: "p-asha",
      among: ["p-asha", "p-priya"],
    }),
  ];
  const settlements = [
    payment({
      id: "s1",
      from: "p-priya",
      to: "p-asha",
      amount: 300,
      created_at: "2026-11-12T10:00:00.000Z",
      notes: "UPI",
    }),
  ];
  const row = displayed(expenses, settlements);
  const result = breakdown(expenses, settlements);
  assertEquals(row, 500);
  assertEquals(result.total, row);
  assertEquals(result.entries.length, 2);
  assertEquals(result.entries[1].kind, "settlement");
  assertEquals(result.entries[1].effect, -300);
  assertEquals(result.entries[1].running, 500);
});

Deno.test("deleted expenses are excluded from the breakdown and the displayed row", () => {
  const kept = expense({
    id: 8,
    description: "Taxi",
    date: "2026-11-10",
    amount: 400,
    payer: "p-asha",
    among: ["p-asha", "p-priya"],
  });
  const deleted = expense({
    id: 9,
    description: "Deleted brunch",
    date: "2026-11-09",
    amount: 2000,
    payer: "p-asha",
    among: ["p-asha", "p-priya"],
  });
  const withDeleted = displayed([kept, deleted], []);
  const withoutDeleted = displayed([kept], []);
  const result = breakdown([kept], []);
  assertEquals(withoutDeleted, 200);
  assertEquals(withDeleted, 1200);
  assertEquals(result.total, withoutDeleted);
  assertEquals(result.entries.map((entry) => entry.description), ["Taxi"]);
  assertEquals(result.entries.some((entry) => entry.description.includes("brunch")), false);
});

Deno.test("multi-currency keeps INR and USD rows on their own displayed amounts", () => {
  const expenses = [
    expense({
      id: 10,
      description: "Dinner",
      date: "2026-11-10",
      amount: 1600,
      payer: "p-asha",
      among: ["p-asha", "p-priya"],
      currency: "INR",
    }),
    expense({
      id: 11,
      description: "Museum",
      date: "2026-11-11",
      amount: 40,
      payer: "p-priya",
      among: ["p-asha", "p-priya"],
      currency: "USD",
    }),
  ];
  const inr = buildBalanceBreakdown({
    expenses,
    settlements: [],
    participants,
    viewer,
    other: priya,
    currency: "INR",
    defaultCurrency: "INR",
  });
  const usd = buildBalanceBreakdown({
    expenses,
    settlements: [],
    participants,
    viewer,
    other: priya,
    currency: "USD",
    defaultCurrency: "INR",
  });
  const balances = calculateGroupNetsFromLedger({
    expenses,
    settlements: [],
    participants,
  });
  assertEquals(inr.total, displayedBalanceBetween({
    balances, viewer, other: priya, currency: "INR", defaultCurrency: "INR",
  }));
  assertEquals(usd.total, displayedBalanceBetween({
    balances, viewer, other: priya, currency: "USD", defaultCurrency: "INR",
  }));
  assertEquals(inr.total, 800);
  assertEquals(usd.total, -20);
});

Deno.test("empty ledger is settled: no entries, zero total", () => {
  const result = breakdown([], []);
  assertEquals(result.total, 0);
  assertEquals(result.entries.length, 0);
});

Deno.test("running totals end on the same number the group row shows", () => {
  const expenses = [
    expense({
      id: 12,
      description: "Dinner",
      date: "2026-11-08",
      amount: 1600,
      payer: "p-asha",
      among: ["p-asha", "p-priya"],
    }),
    expense({
      id: 13,
      description: "Taxi",
      date: "2026-11-09",
      amount: 600,
      payer: "p-priya",
      among: ["p-asha", "p-priya"],
    }),
    expense({
      id: 14,
      description: "Groceries",
      date: "2026-11-10",
      amount: 1800,
      payer: "p-asha",
      among: ["p-asha", "p-priya"],
    }),
  ];
  const settlements = [
    payment({
      id: "s2",
      from: "p-priya",
      to: "p-asha",
      amount: 160,
      created_at: "2026-11-12T08:00:00.000Z",
    }),
  ];
  const row = displayed(expenses, settlements);
  const result = breakdown(expenses, settlements);
  assertEquals(row, 1240);
  assertEquals(result.total, 1240);
  assertEquals(result.entries[result.entries.length - 1].running, 1240);
  const rows = viewerSettlementRows({
    balances: calculateGroupNetsFromLedger({ expenses, settlements, participants }),
    currentUserId: VIEWER,
    currentUserParticipantId: "p-asha",
    unifyEnabled: false,
    settlementCurrency: "INR",
    defaultCurrency: "INR",
    rateBook: emptyRateBook(),
  });
  const priyaRow = rows.find((balance) => balance.participant_id === "p-priya");
  assertEquals(priyaRow?.amount, 1240);
});
