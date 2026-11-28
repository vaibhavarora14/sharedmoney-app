import { assertEquals } from "jsr:@std/assert@1";
import type { Participant, Settlement, Transaction } from "../types.ts";
import { buildGroupCsvDocument, formatCsvAmount } from "./groupExportCsv.ts";

const GROUP = "flat-4b";
const AISHA = "aisha";
const DEV = "dev";
const CARA = "cara";

const PEOPLE: Participant[] = [
  { id: AISHA, group_id: GROUP, type: "member", full_name: "Aisha", email: "aisha@example.com" },
  { id: DEV, group_id: GROUP, type: "member", full_name: "Dev", email: "dev@example.com" },
  { id: CARA, group_id: GROUP, type: "member", full_name: "Cara", email: "cara@example.com" },
];

function expense(partial: Partial<Transaction> & Pick<Transaction, "id" | "amount" | "description" | "date">): Transaction {
  return {
    type: "expense",
    currency: "INR",
    paid_by_participant_id: AISHA,
    splits: [],
    ...partial,
  };
}

function settlement(partial: Partial<Settlement> & Pick<Settlement, "id" | "amount" | "currency">): Settlement {
  return {
    group_id: GROUP,
    from_user_id: "user-cara",
    to_user_id: "user-aisha",
    from_participant_id: CARA,
    to_participant_id: AISHA,
    created_by: "user-cara",
    created_at: "2026-04-03T18:00:00.000Z",
    ...partial,
  };
}

function document(
  transactions: Transaction[],
  settlements: Settlement[] = [],
  members: Participant[] = PEOPLE,
): string {
  return buildGroupCsvDocument({
    members,
    transactions,
    settlements,
    participants: members,
    defaultCurrency: "INR",
  });
}

function linesOf(csv: string): string[] {
  const body = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  return body.split("\n").filter((line) => line.length > 0);
}

Deno.test("formatCsvAmount is a plain number without currency or forced trailing zeros", () => {
  assertEquals(formatCsvAmount(1250.5), "1250.5");
  assertEquals(formatCsvAmount(100), "100");
  assertEquals(formatCsvAmount(0), "0");
  assertEquals(formatCsvAmount(10.25), "10.25");
});

Deno.test("csv starts with a UTF-8 BOM and one column per member", () => {
  const csv = document([
    expense({
      id: 1,
      date: "2026-04-01",
      description: "Groceries",
      category: "Food",
      amount: 90,
      splits: [
        { participant_id: AISHA, amount: 30 },
        { participant_id: DEV, amount: 30 },
        { participant_id: CARA, amount: 30 },
      ],
    }),
  ]);
  assertEquals(csv.charCodeAt(0), 0xfeff);
  assertEquals(
    linesOf(csv)[0],
    "date,description,category,payer,amount,currency,Aisha,Dev,Cara",
  );
});

Deno.test("csv escapes commas, quotes, and newlines inside a field", () => {
  const csv = document([
    expense({
      id: 1,
      date: "2026-04-01",
      description: 'Dinner, "beach"\nnotes',
      category: "Food",
      amount: 1250.5,
      splits: [
        { participant_id: AISHA, amount: 625.25 },
        { participant_id: DEV, amount: 625.25 },
      ],
    }),
  ]);
  const body = csv.slice(1);
  assertEquals(
    body,
    "date,description,category,payer,amount,currency,Aisha,Dev,Cara\n" +
      '2026-04-01,"Dinner, ""beach""\nnotes",Food,Aisha,1250.5,INR,625.25,625.25,0\n',
  );
});

Deno.test("csv keeps each expense in its original currency", () => {
  const csv = document([
    expense({
      id: 1,
      date: "2026-04-01",
      description: "Groceries",
      category: "Food",
      amount: 1250.5,
      currency: "INR",
      splits: [
        { participant_id: AISHA, amount: 625.25 },
        { participant_id: DEV, amount: 625.25 },
      ],
    }),
    expense({
      id: 2,
      date: "2026-04-02",
      description: "Taxi",
      category: "Transport",
      amount: 40,
      currency: "USD",
      paid_by_participant_id: DEV,
      splits: [
        { participant_id: DEV, amount: 20 },
        { participant_id: AISHA, amount: 20 },
      ],
    }),
  ]);
  const rows = linesOf(csv);
  assertEquals(rows[1], "2026-04-01,Groceries,Food,Aisha,1250.5,INR,625.25,625.25,0");
  assertEquals(rows[2], "2026-04-02,Taxi,Transport,Dev,40,USD,20,20,0");
});

Deno.test("csv names two payers in the payer column", () => {
  const csv = document([
    expense({
      id: 1,
      date: "2026-04-01",
      description: "Dinner",
      category: "Food",
      amount: 4800,
      payers: [
        { participant_id: AISHA, amount: 3000 },
        { participant_id: DEV, amount: 1800 },
      ],
      splits: [
        { participant_id: AISHA, amount: 1600 },
        { participant_id: DEV, amount: 1600 },
        { participant_id: CARA, amount: 1600 },
      ],
    }),
  ]);
  assertEquals(
    linesOf(csv)[1],
    "2026-04-01,Dinner,Food,Aisha and Dev,4800,INR,1600,1600,1600",
  );
  assertEquals(csv.includes("3320"), false);
  assertEquals(csv.includes("₹"), false);
  assertEquals(csv.includes("$"), false);
});

Deno.test("csv writes a settlement row and a member with a zero share", () => {
  const csv = document(
    [
      expense({
        id: 1,
        date: "2026-04-02",
        description: "Groceries",
        category: "Food",
        amount: 100,
        splits: [
          { participant_id: AISHA, amount: 50 },
          { participant_id: DEV, amount: 50 },
        ],
      }),
    ],
    [
      settlement({
        id: "set-1",
        amount: 50,
        currency: "INR",
        notes: "Paid back",
        created_at: "2026-04-01T09:00:00.000Z",
      }),
    ],
  );
  const rows = linesOf(csv);
  assertEquals(rows[1], "2026-04-01,Paid back,Settlement,Cara,50,INR,50,0,0");
  assertEquals(rows[2], "2026-04-02,Groceries,Food,Aisha,100,INR,50,50,0");
});

Deno.test("csv skips income rows", () => {
  const csv = document([
    expense({
      id: 1,
      date: "2026-04-01",
      description: "Salary",
      amount: 500,
      type: "income",
    }),
    expense({
      id: 2,
      date: "2026-04-02",
      description: "Groceries",
      category: "Food",
      amount: 80,
      splits: [
        { participant_id: AISHA, amount: 40 },
        { participant_id: DEV, amount: 40 },
      ],
    }),
  ]);
  assertEquals(csv.includes("Salary"), false);
  assertEquals(linesOf(csv).length, 2);
});

Deno.test("csv prefixes formula-leading text cells and leaves negative amounts numeric", () => {
  const payer: Participant = {
    id: "payer",
    group_id: GROUP,
    type: "member",
    full_name: "+cmd",
  };
  const csv = document(
    [
      expense({
        id: 1,
        date: "2026-04-01",
        description: '=HYPERLINK("x")',
        category: "-Travel",
        amount: -12.5,
        paid_by_participant_id: "payer",
        splits: [{ participant_id: "payer", amount: 0 }],
      }),
    ],
    [],
    [payer],
  );
  const body = csv.slice(1);
  assertEquals(
    body,
    "date,description,category,payer,amount,currency,'+cmd\n" +
      "2026-04-01,\"'=HYPERLINK(\"\"x\"\")\",'-Travel,'+cmd,-12.5,INR,0\n",
  );
});
