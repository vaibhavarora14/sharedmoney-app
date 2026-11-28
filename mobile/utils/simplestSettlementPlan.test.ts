import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Balance } from "../types.ts";
import {
  partitionSettlePlan,
  paymentInvolvement,
  simplestSettlementPlan,
  viewerPlanLine,
} from "./simplestSettlementPlan.ts";

function person(
  id: string,
  amount: number,
  name: string,
  currency = "INR",
): Balance {
  return {
    user_id: `u-${id}`,
    participant_id: `p-${id}`,
    full_name: name,
    amount,
    currency,
  };
}

function apply(payments: ReturnType<typeof simplestSettlementPlan>, balances: Balance[]) {
  const nets = new Map<string, number>();
  for (const row of balances) {
    const key = row.participant_id || row.user_id;
    nets.set(key, (nets.get(key) ?? 0) + Math.round(row.amount * 100));
  }
  const leftover = [...nets.values()].reduce((sum, value) => sum + value, 0);
  if (leftover !== 0) {
    const largest = [...nets.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    nets.set(largest[0], largest[1] - leftover);
  }
  for (const payment of payments) {
    const paise = Math.round(payment.amount * 100);
    const from = payment.from.participantId || payment.from.userId || "";
    const to = payment.to.participantId || payment.to.userId || "";
    nets.set(from, (nets.get(from) ?? 0) + paise);
    nets.set(to, (nets.get(to) ?? 0) - paise);
  }
  return [...nets.values()];
}

Deno.test("simplest plan pairs Asha to You and Meera to Rohan", () => {
  const balances = [
    person("you", 2250, "You"),
    person("asha", -2250, "Asha Rao"),
    person("rohan", 800, "Rohan Iyer"),
    person("meera", -800, "Meera Shah"),
  ];
  const payments = simplestSettlementPlan(balances);
  assertEquals(payments.length, 2);
  assertEquals(payments.map((row) => `${row.from.name}→${row.to.name}:${row.amount}`).sort(), [
    "Asha Rao→You:2250",
    "Meera Shah→Rohan Iyer:800",
  ]);
  assertEquals(apply(payments, balances).every((net) => net === 0), true);
});

Deno.test("simplest plan uses at most n-1 payments and nets to zero", () => {
  const balances = [
    person("a", 100, "A"),
    person("b", -40, "B"),
    person("c", -35, "C"),
    person("d", -25, "D"),
  ];
  const payments = simplestSettlementPlan(balances);
  const nonzero = balances.filter((row) => row.amount !== 0).length;
  assertEquals(payments.length <= nonzero - 1, true);
  assertEquals(payments.length, 3);
  assertEquals(apply(payments, balances).every((net) => net === 0), true);
  const paid = payments.reduce((sum, row) => sum + row.amount, 0);
  assertEquals(paid, 100);
});

Deno.test("simplest plan rounds to paise and keeps the set summing to zero", () => {
  const balances = [
    person("a", 10.005, "A"),
    person("b", -3.333, "B"),
    person("c", -6.672, "C"),
  ];
  const payments = simplestSettlementPlan(balances);
  assertEquals(apply(payments, balances).every((net) => net === 0), true);
  for (const payment of payments) {
    assertEquals(Number.isInteger(Math.round(payment.amount * 100)), true);
    assertEquals(Math.round(payment.amount * 100) / 100, payment.amount);
  }
});

Deno.test("own payments pin on top of other people's payments", () => {
  const balances = [
    person("you", 2250, "You"),
    person("asha", -2250, "Asha Rao"),
    person("rohan", 800, "Rohan Iyer"),
    person("meera", -800, "Meera Shah"),
  ];
  const payments = simplestSettlementPlan(balances);
  const { yours, others } = partitionSettlePlan(payments, "u-you", "p-you");
  assertEquals(yours.length, 1);
  assertEquals(paymentInvolvement(yours[0], "u-you", "p-you"), "receive");
  assertEquals(others.length, 1);
  assertEquals(others[0].from.name, "Meera Shah");
  const line = viewerPlanLine(payments, "u-you", "p-you");
  assertEquals(line?.from.name, "Asha Rao");
  assertEquals(line?.to.name, "You");
});
