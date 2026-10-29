import { assertEquals } from "jsr:@std/assert@1";
import {
  countActiveGroupMembers,
  isMultiMemberGroup,
  REVIEW_QUALIFYING_EXPENSE_THRESHOLD,
  REVIEW_REQUESTED_STORAGE_KEY,
  reviewQualifyingExpenseCountKey,
  shouldCountCreatedExpense,
  shouldRequestReviewPrompt,
} from "./inAppReviewEligibility.ts";

Deno.test("counts only non-former participants as active group members", () => {
  assertEquals(countActiveGroupMembers(undefined), 0);
  assertEquals(countActiveGroupMembers(null), 0);
  assertEquals(countActiveGroupMembers([]), 0);
  assertEquals(
    countActiveGroupMembers([
      { type: "member" },
      { type: "invited" },
      { type: "former" },
    ]),
    2,
  );
});

Deno.test("multi-member groups require 2 or more active members", () => {
  assertEquals(isMultiMemberGroup(0), false);
  assertEquals(isMultiMemberGroup(1), false);
  assertEquals(isMultiMemberGroup(2), true);
  assertEquals(isMultiMemberGroup(5), true);
});

Deno.test("only expenses in multi-member groups increment the review counter", () => {
  assertEquals(
    shouldCountCreatedExpense({
      transactionType: "expense",
      groupMemberCount: 2,
    }),
    true,
  );
  assertEquals(
    shouldCountCreatedExpense({
      transactionType: "expense",
      groupMemberCount: 1,
    }),
    false,
  );
  assertEquals(
    shouldCountCreatedExpense({
      transactionType: "income",
      groupMemberCount: 3,
    }),
    false,
  );
  assertEquals(
    shouldCountCreatedExpense({
      transactionType: undefined,
      groupMemberCount: 3,
    }),
    false,
  );
});

Deno.test("review prompt triggers at the 3rd qualifying expense only once", () => {
  assertEquals(REVIEW_QUALIFYING_EXPENSE_THRESHOLD, 3);

  assertEquals(
    shouldRequestReviewPrompt({
      qualifyingExpenseCount: 2,
      hasRequestedReview: false,
      platform: "ios",
    }),
    false,
  );
  assertEquals(
    shouldRequestReviewPrompt({
      qualifyingExpenseCount: 3,
      hasRequestedReview: false,
      platform: "android",
    }),
    true,
  );
  assertEquals(
    shouldRequestReviewPrompt({
      qualifyingExpenseCount: 10,
      hasRequestedReview: true,
      platform: "ios",
    }),
    false,
  );
});

Deno.test("web is always a no-op for the review prompt", () => {
  assertEquals(
    shouldRequestReviewPrompt({
      qualifyingExpenseCount: 3,
      hasRequestedReview: false,
      platform: "web",
    }),
    false,
  );
});

Deno.test("storage keys are scoped per user for counts and once per install for the flag", () => {
  assertEquals(
    reviewQualifyingExpenseCountKey("user-a"),
    "@sharedmoney/in_app_review_qualifying_expense_count:user-a",
  );
  assertEquals(
    reviewQualifyingExpenseCountKey("user-b"),
    "@sharedmoney/in_app_review_qualifying_expense_count:user-b",
  );
  assertEquals(
    REVIEW_REQUESTED_STORAGE_KEY,
    "@sharedmoney/in_app_review_requested",
  );
});
