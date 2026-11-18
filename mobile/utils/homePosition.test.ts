import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import type { Balance } from "../types.ts";
import { homePosition, settleHeroFromPeople, viewerOverallBalances } from "./homePosition.ts";
import { buildDirectHomeRows } from "./quickSettle.ts";
import { formatShareCurrency } from "./settleShareMessage.ts";

function row(amount: number, currency: string): Balance {
  return { user_id: "me", amount, currency };
}

Deno.test("owed uses the single overall_balances amount", () => {
  const result = homePosition({
    hasBalances: true,
    overallBalances: [row(4210, "INR")],
    groupsWithBalance: 3,
    activeGroupCount: 4,
  });
  assertEquals(result, {
    kind: "amount",
    label: "You're owed",
    numberText: "₹4,210",
    mutedLine: "Across 3 groups",
  });
});

Deno.test("owe uses the single overall_balances amount", () => {
  const result = homePosition({
    hasBalances: true,
    overallBalances: [row(-1050, "INR")],
    groupsWithBalance: 1,
    activeGroupCount: 2,
  });
  assertEquals(result, {
    kind: "amount",
    label: "You owe",
    numberText: "₹1,050",
    mutedLine: "Across 1 group",
  });
});

Deno.test("the hero equals the sum of the rows, including a direct balance", () => {
  const groupBalances = [
    { group_id: "goa", group_name: "Goa trip", group_kind: "standard" as const, balances: [{ user_id: "me", amount: 2400, currency: "INR" }] },
    { group_id: "flat", group_name: "Flat 4B", group_kind: "standard" as const, balances: [{ user_id: "me", amount: -1050, currency: "INR" }] },
    { group_id: "office", group_name: "Office lunch", group_kind: "standard" as const, balances: [{ user_id: "me", amount: 2860, currency: "INR" }] },
    { group_id: "kabir", group_name: "Kabir", group_kind: "direct" as const, balances: [{ user_id: "me", amount: 500, currency: "INR" }] },
  ];
  const overall = viewerOverallBalances(groupBalances, "me");
  const directRows = buildDirectHomeRows({
    groups: groupBalances.map((group) => ({
      id: group.group_id,
      name: group.group_id === "kabir" ? "Kabir" : group.group_id,
      kind: group.group_kind,
      created_by: "me",
      created_at: "2026-11-18T00:00:00.000Z",
      updated_at: "2026-11-18T00:00:00.000Z",
      user_status: "active" as const,
    })),
    groupBalances,
    userId: "me",
    now: new Date("2026-11-18T04:00:00.000Z"),
  });
  const rowSum = groupBalances
    .filter((group) => group.group_kind !== "direct")
    .reduce((sum, group) => sum + group.balances[0].amount, 0)
    + directRows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  assertEquals(overall[0]?.amount, rowSum);
  assertEquals(overall[0]?.amount, 4710);
  const home = homePosition({
    hasBalances: true,
    overallBalances: overall,
    groupsWithBalance: 3,
    activeGroupCount: 3,
    directPeople: { count: 1, name: "Kabir" },
  });
  assertEquals(home, {
    kind: "amount",
    label: "You're owed",
    numberText: "₹4,710",
    mutedLine: "Across 3 groups and Kabir",
  });

  const people = [
    { netsByCurrency: { INR: 2860 } },
    { netsByCurrency: { INR: 1250 } },
    { netsByCurrency: { INR: 800 } },
    { netsByCurrency: { INR: 500 } },
    { netsByCurrency: { INR: -700 } },
  ];
  const settle = settleHeroFromPeople(people);
  const peopleSum = people.reduce((sum, person) => sum + person.netsByCurrency.INR, 0);
  assertEquals(settle.kind === "amount" ? settle.numberText : "", formatShareCurrency(peopleSum, "INR"));
  assertEquals(settle, {
    kind: "amount",
    label: "You're owed",
    numberText: "₹4,710",
    mutedLine: "Across 5 people",
  });
});

Deno.test("one direct person is named beside the group count", () => {
  assertEquals(
    homePosition({
      hasBalances: true,
      overallBalances: [{ user_id: "me", amount: 4710, currency: "INR" }],
      groupsWithBalance: 3,
      activeGroupCount: 4,
      directPeople: { count: 1, name: "Kabir" },
    }),
    {
      kind: "amount",
      label: "You're owed",
      numberText: "₹4,710",
      mutedLine: "Across 3 groups and Kabir",
    },
  );
});

Deno.test("even when overall_balances is empty does not invent a currency", () => {
  const result = homePosition({
    hasBalances: true,
    overallBalances: [],
    groupsWithBalance: 0,
    activeGroupCount: 2,
  });
  assertEquals(result.kind, "amount");
  if (result.kind !== "amount") return;
  assertEquals(result.label, "You're even");
  assertEquals(result.mutedLine, "Across 2 groups");
  assertEquals("numberText" in result, false);
  const encoded = JSON.stringify(result);
  assertEquals(encoded.includes("₹"), false);
  assertEquals(encoded.includes("$"), false);
  assertEquals(encoded.includes("0"), false);
});

Deno.test("a single even overall row keeps that currency's zero", () => {
  const result = homePosition({
    hasBalances: true,
    overallBalances: [row(0, "INR")],
    groupsWithBalance: 0,
    activeGroupCount: 2,
  });
  assertEquals(result, {
    kind: "amount",
    label: "You're even",
    numberText: "₹0",
    mutedLine: "Across 2 groups",
  });
});

Deno.test("combining multi-group case shows the overall row and does not add parts", () => {
  // The API already combined the groups into one INR row. These parts are not inputs.
  const parts = [row(2400, "INR"), row(-1050, "INR"), row(2860, "INR")];
  const combined = parts.reduce((sum, part) => sum + part.amount, 0);
  assertEquals(combined, 4210);
  const result = homePosition({
    hasBalances: true,
    overallBalances: [row(combined, "INR")],
    groupsWithBalance: 3,
    activeGroupCount: 4,
  });
  assertEquals(result.kind, "amount");
  if (result.kind !== "amount") return;
  assertEquals(result.numberText, "₹4,210");
  assertEquals(result.numberText, "₹4,210");
});

Deno.test("two overall rows are not added into a fake total", () => {
  const result = homePosition({
    hasBalances: true,
    overallBalances: [row(100, "INR"), row(50, "INR")],
    groupsWithBalance: 2,
    activeGroupCount: 2,
  });
  assertEquals(result, { kind: "split", mutedLine: "They don’t combine" });
  const encoded = JSON.stringify(result);
  assertEquals(encoded.includes("150"), false);
  assertEquals(encoded.includes("₹"), false);
});

Deno.test("cannot-combine currencies produce no number", () => {
  const result = homePosition({
    hasBalances: true,
    overallBalances: [row(4210, "INR"), row(-88.15, "USD")],
    groupsWithBalance: 2,
    activeGroupCount: 2,
  });
  assertEquals(result.kind, "split");
  if (result.kind !== "split") return;
  assertEquals(result.mutedLine, "Also USD · they don’t combine");
  assertEquals("numberText" in result, false);
  const encoded = JSON.stringify(result);
  assertEquals(encoded.includes("4,122"), false);
  assertEquals(encoded.includes("4121"), false);
  assertEquals(encoded.includes("₹"), false);
  assertEquals(encoded.includes("$"), false);
  assertEquals(encoded.includes("88"), false);
});

Deno.test("balances that have not loaded are not even", () => {
  assertEquals(homePosition({
    hasBalances: false,
    overallBalances: [],
    groupsWithBalance: 0,
    activeGroupCount: 3,
  }), { kind: "unknown" });
});
