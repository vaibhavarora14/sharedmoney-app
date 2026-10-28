import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  countActiveMembers,
  countNonFormerParticipants,
  getTransactionsEmptyCopy,
  shouldPreferAddPeopleFab,
} from "./transactionsEmptyCopy.ts";

Deno.test("countActiveMembers counts only active (and missing status)", () => {
  assertEquals(countActiveMembers(undefined), 0);
  assertEquals(countActiveMembers([]), 0);
  assertEquals(
    countActiveMembers([
      { status: "active" },
      { status: "left" },
      { status: "invited" },
      { status: undefined },
      null,
    ]),
    2,
  );
});

Deno.test("countNonFormerParticipants includes no-account and pending invites", () => {
  assertEquals(countNonFormerParticipants(undefined), 0);
  assertEquals(
    countNonFormerParticipants([
      { type: "member" },
      { type: "invited" },
      { type: "former" },
      null,
    ]),
    2,
  );
});

Deno.test("solo empty all: Just you so far + quiet secondary", () => {
  const copy = getTransactionsEmptyCopy("all", 1);
  assertEquals(copy.title, "Just you so far");
  assertEquals(
    copy.body,
    "Send a link to the people you split costs with. They join with one tap, and you can add expenses now or later.",
  );
  assertEquals(copy.primaryAction, "add_people");
  assertEquals(copy.primaryLabel, "Invite people");
  assertEquals(copy.secondaryAction, "add_expense");
  assertEquals(copy.secondaryLabel, "Add an expense first");
  // No over-explaining secondary / banner copy
  assertEquals((copy as { infoFooter?: string }).infoFooter, undefined);
  assertEquals((copy as { secondaryBody?: string }).secondaryBody, undefined);
});

Deno.test("solo with zero active still people-first", () => {
  const copy = getTransactionsEmptyCopy("all", 0);
  assertEquals(copy.primaryAction, "add_people");
  assertEquals(copy.title, "Just you so far");
});

Deno.test("two+ empty all: expense-first CTA", () => {
  const copy = getTransactionsEmptyCopy("all", 2);
  assertEquals(copy.title, "No expenses yet");
  assertEquals(
    copy.body,
    "Add what someone paid and who shared it. SharedMoney works out who owes whom.",
  );
  assertEquals(copy.primaryAction, "add_expense");
  assertEquals(copy.primaryLabel, "Add first expense");
  assertEquals(copy.secondaryLabel, undefined);
});

Deno.test("solo expenses filter: people-first", () => {
  const copy = getTransactionsEmptyCopy("expenses", 1);
  assertEquals(copy.primaryAction, "add_people");
  assertEquals(copy.secondaryAction, "add_expense");
  assertEquals(copy.title, "Just you so far");
});

Deno.test("two+ expenses filter: add first expense", () => {
  const copy = getTransactionsEmptyCopy("expenses", 3);
  assertEquals(copy.primaryAction, "add_expense");
  assertEquals(copy.primaryLabel, "Add first expense");
});

Deno.test("payments filter has no people/expense CTAs", () => {
  const copy = getTransactionsEmptyCopy("payments", 1);
  assertEquals(copy.primaryAction, undefined);
  assertEquals(copy.secondaryAction, undefined);
});

Deno.test("FAB prefers add people only for solo empty ledger", () => {
  assertEquals(shouldPreferAddPeopleFab(1, true), true);
  assertEquals(shouldPreferAddPeopleFab(1, false), false);
  assertEquals(shouldPreferAddPeopleFab(2, true), false);
});
