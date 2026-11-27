import { assertEquals } from "jsr:@std/assert@1";
import {
  INVITE_PROMPT_DISMISS_LABEL,
  INVITE_PROMPT_SHARE_LABEL,
  INVITE_PROMPT_TITLE_FALLBACK,
  invitePromptBody,
  invitePromptShownKey,
  invitePromptTitle,
  isFirstExpenseInFeed,
  isInvitePromptShownValue,
  resolveInvitePromptGroupContext,
  shouldShowInvitePrompt,
} from "./invitePromptEligibility.ts";
import { formatShareCurrency } from "./settleShareMessage.ts";

const eligible = {
  transactionType: "expense" as const,
  isFirstExpense: true,
  activeMemberCount: 1,
  groupKind: "standard" as const,
  alreadyShown: false,
};

Deno.test("shows only for the first expense in a single-member standard group", () => {
  assertEquals(shouldShowInvitePrompt(eligible), true);
  assertEquals(
    shouldShowInvitePrompt({ ...eligible, groupKind: undefined }),
    true,
  );
  assertEquals(
    shouldShowInvitePrompt({ ...eligible, groupKind: null }),
    true,
  );
});

Deno.test("does not show for the second expense", () => {
  assertEquals(
    shouldShowInvitePrompt({ ...eligible, isFirstExpense: false }),
    false,
  );
});

Deno.test("does not show when the group already has two or more members", () => {
  assertEquals(
    shouldShowInvitePrompt({ ...eligible, activeMemberCount: 2 }),
    false,
  );
  assertEquals(
    shouldShowInvitePrompt({ ...eligible, activeMemberCount: 0 }),
    false,
  );
});

Deno.test("does not show for direct groups, settlements, or after it was shown", () => {
  assertEquals(
    shouldShowInvitePrompt({ ...eligible, groupKind: "direct" }),
    false,
  );
  assertEquals(
    shouldShowInvitePrompt({ ...eligible, transactionType: "settlement" }),
    false,
  );
  assertEquals(
    shouldShowInvitePrompt({ ...eligible, transactionType: "income" }),
    false,
  );
  assertEquals(
    shouldShowInvitePrompt({ ...eligible, alreadyShown: true }),
    false,
  );
});

Deno.test("empty or missing feed is a first expense; any prior expense is not", () => {
  assertEquals(isFirstExpenseInFeed(undefined), true);
  assertEquals(isFirstExpenseInFeed(null), true);
  assertEquals(isFirstExpenseInFeed({ pages: [] }), true);
  assertEquals(isFirstExpenseInFeed({ pages: [{ items: [] }] }), true);
  assertEquals(
    isFirstExpenseInFeed({
      pages: [{ items: [{ type: "income" }] }],
    }),
    true,
  );
  assertEquals(
    isFirstExpenseInFeed({
      pages: [{ items: [{ type: "expense" }] }],
    }),
    false,
  );
  assertEquals(
    isFirstExpenseInFeed({
      pages: [
        { items: [{ type: "income" }] },
        { items: [{ type: "expense" }, { type: "income" }] },
      ],
    }),
    false,
  );
});

Deno.test("group context counts only active members and skips direct kind", () => {
  assertEquals(
    resolveInvitePromptGroupContext({
      kind: "standard",
      name: "  Flat 4B  ",
      members: [
        { status: "active" },
        { status: "left" },
        { status: "invited" },
        null,
      ],
    }),
    {
      groupKind: "standard",
      groupName: "Flat 4B",
      activeMemberCount: 1,
    },
  );
  assertEquals(
    resolveInvitePromptGroupContext({
      kind: "direct",
      name: "Rahul",
      members: [{ status: "active" }, { status: "active" }],
    }).activeMemberCount,
    2,
  );
  assertEquals(resolveInvitePromptGroupContext(undefined).activeMemberCount, 0);
});

Deno.test("once-per-group storage key is scoped to the group id", () => {
  assertEquals(
    invitePromptShownKey("group-a"),
    "@sharedmoney/invite_prompt_shown:group-a",
  );
  assertEquals(
    invitePromptShownKey("group-b"),
    "@sharedmoney/invite_prompt_shown:group-b",
  );
  assertEquals(isInvitePromptShownValue("1"), true);
  assertEquals(isInvitePromptShownValue("true"), true);
  assertEquals(isInvitePromptShownValue("0"), false);
  assertEquals(isInvitePromptShownValue(null), false);
});

Deno.test("prompt copy uses the group name and formatted amount", () => {
  assertEquals(invitePromptTitle("Flat 4B"), "Invite people to Flat 4B");
  assertEquals(invitePromptTitle("  Flat 4B  "), "Invite people to Flat 4B");
  assertEquals(invitePromptTitle(""), INVITE_PROMPT_TITLE_FALLBACK);
  assertEquals(invitePromptTitle(undefined), INVITE_PROMPT_TITLE_FALLBACK);
  assertEquals(
    invitePromptBody(formatShareCurrency(840, "INR")),
    "Send a link so they can split ₹840 with you.",
  );
  assertEquals(
    invitePromptBody("₹840").includes("You're the only one here."),
    false,
  );
  assertEquals(INVITE_PROMPT_SHARE_LABEL, "Share invite");
  assertEquals(INVITE_PROMPT_DISMISS_LABEL, "Not now");
  assertEquals(invitePromptBody("₹840").includes("http"), false);
  assertEquals(invitePromptBody("₹840").includes("token"), false);
});
