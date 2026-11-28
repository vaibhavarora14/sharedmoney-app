import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  involvingMeFilterLabel,
  ledgerRowMatchesSearch,
  LOADED_ROWS_SEARCH_NOTE,
  transactionSearchEmptyMessage,
  transactionSearchTerm,
  type LedgerSearchFields,
} from "./transactionSearch.ts";

const dinner: LedgerSearchFields = {
  kind: "expense",
  title: "Taxi to airport",
  payerLine: "Meera paid ₹900",
  amountText: "Not in split",
  amount: 900,
  involvesViewer: false,
};

const scooter: LedgerSearchFields = {
  kind: "expense",
  title: "Scooter rental",
  payerLine: "You paid ₹2,100",
  amountText: "You're owed ₹1,400",
  amount: 2100,
  involvesViewer: true,
};

const payment: LedgerSearchFields = {
  kind: "payment",
  title: "Rahul paid you",
  payerLine: "",
  amountText: "₹1,000",
  amount: 1000,
  involvesViewer: true,
};

Deno.test("search matches title, payer, and amount, including grouped digits", () => {
  assertEquals(ledgerRowMatchesSearch(dinner, "taxi", "all"), true);
  assertEquals(ledgerRowMatchesSearch(dinner, "meera", "all"), true);
  assertEquals(ledgerRowMatchesSearch(dinner, "900", "all"), true);
  assertEquals(ledgerRowMatchesSearch(dinner, "₹900", "all"), true);
  assertEquals(ledgerRowMatchesSearch(scooter, "1,400", "all"), true);
  assertEquals(ledgerRowMatchesSearch(scooter, "1400", "all"), true);
  assertEquals(ledgerRowMatchesSearch(scooter, "2,100.00", "all"), true);
  assertEquals(ledgerRowMatchesSearch(dinner, "hotel", "all"), false);
});

Deno.test("filters select expenses, payments, or rows involving the viewer", () => {
  assertEquals(ledgerRowMatchesSearch(dinner, "", "expenses"), true);
  assertEquals(ledgerRowMatchesSearch(payment, "", "expenses"), false);
  assertEquals(ledgerRowMatchesSearch(payment, "", "payments"), true);
  assertEquals(ledgerRowMatchesSearch(scooter, "", "payments"), false);
  assertEquals(ledgerRowMatchesSearch(dinner, "", "involving-me"), false);
  assertEquals(ledgerRowMatchesSearch(scooter, "scooter", "involving-me"), true);
  assertEquals(ledgerRowMatchesSearch(payment, "rahul", "involving-me"), true);
  assertEquals(ledgerRowMatchesSearch(dinner, "taxi", "payments"), false);
});

Deno.test("empty search copy uses curly quotes and does not invent a result count", () => {
  assertEquals(transactionSearchEmptyMessage("taxi"), "No transactions match “taxi”");
  assertEquals(transactionSearchTerm("taxi", "payments", "Involving me"), "taxi");
  assertEquals(transactionSearchTerm("  ", "payments", "Involving me"), "Payments");
  assertEquals(transactionSearchTerm("", "involving-me", "Me"), "Me");
  assertEquals(transactionSearchTerm("", "all", "Involving me"), "");
  assertEquals(LOADED_ROWS_SEARCH_NOTE.includes("result"), false);
});

Deno.test("Involving me shortens to Me when the line would not fit", () => {
  assertEquals(involvingMeFilterLabel(390, 1), "Involving me");
  assertEquals(involvingMeFilterLabel(320, 1), "Me");
  assertEquals(involvingMeFilterLabel(390, 1.3), "Me");
});
