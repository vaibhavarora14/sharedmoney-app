import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import type { Balance } from "../types.ts";
import { homePosition } from "./homePosition.ts";

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

Deno.test("a direct person is named on the muted line and is not added into the total", () => {
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
