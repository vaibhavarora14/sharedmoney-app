import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Balance } from "../types";
import {
  groupListDenseAmountText,
  groupListDenseSubline,
  isViewerGroupSettled,
  partitionActiveGroupsBySettlement,
  resolveGroupListBalanceDisplay,
} from "./groupListBalanceDisplay.ts";

function balance(
  userId: string,
  amount: number,
  currency = "INR",
): Balance {
  return {
    user_id: userId,
    participant_id: `p-${userId}`,
    amount,
    currency,
    full_name: userId,
  };
}

Deno.test("loading never reads as even or settled", () => {
  const display = resolveGroupListBalanceDisplay({
    loading: true,
    balances: [balance("me", 0)],
    currentUserId: "me",
  });
  assertEquals(display.kind, "loading");
  assertEquals(groupListDenseSubline(display), "");
});

Deno.test("viewer net zero is even / Settled", () => {
  const display = resolveGroupListBalanceDisplay({
    balances: [balance("me", 0), balance("asha", 0)],
    currentUserId: "me",
  });
  assertEquals(display.kind, "even");
  assertEquals(groupListDenseSubline(display), "Settled");
  assertEquals(groupListDenseAmountText(display), "");
});

Deno.test("owed and owe sublines keep the amount on the side", () => {
  const owed = resolveGroupListBalanceDisplay({
    balances: [balance("me", 2250)],
    currentUserId: "me",
  });
  assertEquals(owed.kind, "amount");
  if (owed.kind !== "amount") return;
  assertEquals(groupListDenseSubline(owed), "You're owed");
  assertEquals(groupListDenseAmountText(owed).includes("2,250"), true);

  const owe = resolveGroupListBalanceDisplay({
    balances: [balance("me", -800)],
    currentUserId: "me",
  });
  assertEquals(groupListDenseSubline(owe), "You owe");
});

Deno.test("missing group after balances resolve is treated as settled", () => {
  assertEquals(isViewerGroupSettled(undefined, "me"), true);
  assertEquals(isViewerGroupSettled([balance("me", 12)], "me"), false);
  assertEquals(isViewerGroupSettled([balance("me", 0.004)], "me"), true);
});

Deno.test("settled groups fold only after balances are ready", () => {
  const groups = [{ id: "open" }, { id: "even" }];
  const balances = [
    { group_id: "open", balances: [balance("me", 40)] },
    { group_id: "even", balances: [balance("me", 0)] },
  ];
  const waiting = partitionActiveGroupsBySettlement(groups, balances, "me", false);
  assertEquals(waiting.openGroups.map((group) => group.id), ["open", "even"]);
  assertEquals(waiting.settledGroups.length, 0);

  const ready = partitionActiveGroupsBySettlement(groups, balances, "me", true);
  assertEquals(ready.openGroups.map((group) => group.id), ["open"]);
  assertEquals(ready.settledGroups.map((group) => group.id), ["even"]);
});
