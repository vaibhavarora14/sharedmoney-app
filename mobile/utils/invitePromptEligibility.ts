/**
 * Pure eligibility for the post-first-expense invite prompt (#545).
 *
 * Show once per group, only after the first expense in a single-member
 * (non-direct) group. Persistence is a device-local AsyncStorage flag.
 */

import { countActiveMembers } from "./transactionsEmptyCopy";

/** Delay after a successful save so the expense form overlay has dismissed. */
export const INVITE_PROMPT_SETTLE_DELAY_MS = 1200;

export const INVITE_PROMPT_TITLE_FALLBACK = "Invite people to this group";
export const INVITE_PROMPT_SHARE_LABEL = "Share invite";
export const INVITE_PROMPT_DISMISS_LABEL = "Not now";

/** Title: "Invite people to {group name}". */
export function invitePromptTitle(groupName?: string | null): string {
  const trimmed = groupName?.trim();
  return trimmed ? `Invite people to ${trimmed}` : INVITE_PROMPT_TITLE_FALLBACK;
}

/**
 * Body: "Send a link so they can split {amount} with you."
 * `formattedAmount` is already run through the existing currency formatter.
 */
export function invitePromptBody(formattedAmount?: string | null): string {
  const amount = formattedAmount?.trim();
  if (amount) {
    return `Send a link so they can split ${amount} with you.`;
  }
  return "Send a link so they can split this expense with you.";
}

export type InvitePromptPlatform = "ios" | "android" | "web" | string;

export type ExpenseFeedLike = {
  pages?: Array<{
    items?: Array<{ type?: string | null } | null | undefined> | null;
  } | null> | null;
} | null | undefined;

export type InvitePromptGroupLike = {
  kind?: string | null;
  name?: string | null;
  members?: Array<{ status?: string | null } | null | undefined> | null;
} | null | undefined;

/**
 * True when the feed snapshot from *before* this create has no expenses.
 * Settlements and income do not count. An empty or missing cache is treated
 * as first expense (new groups open the form from an empty ledger).
 */
export function isFirstExpenseInFeed(previous: ExpenseFeedLike): boolean {
  const pages = previous?.pages;
  if (!pages?.length) return true;
  for (const page of pages) {
    const items = page?.items;
    if (!items?.length) continue;
    for (const item of items) {
      if (item?.type === "expense") return false;
    }
  }
  return true;
}

export function resolveInvitePromptGroupContext(group: InvitePromptGroupLike): {
  groupKind: string | null;
  groupName: string | undefined;
  activeMemberCount: number;
} {
  const trimmedName = group?.name?.trim();
  return {
    groupKind: group?.kind ?? null,
    groupName: trimmedName ? trimmedName : undefined,
    activeMemberCount: countActiveMembers(group?.members),
  };
}

/**
 * Gate for the invite prompt. Direct (1:1) groups have invites disabled.
 * Missing kind is treated as a standard group.
 */
export function shouldShowInvitePrompt(input: {
  transactionType: string | null | undefined;
  isFirstExpense: boolean;
  activeMemberCount: number;
  groupKind: string | null | undefined;
  alreadyShown: boolean;
}): boolean {
  if (input.alreadyShown) return false;
  if (input.transactionType !== "expense") return false;
  if (!input.isFirstExpense) return false;
  if (input.activeMemberCount !== 1) return false;
  if ((input.groupKind ?? "standard") === "direct") return false;
  return true;
}

export function invitePromptShownKey(groupId: string): string {
  return `@sharedmoney/invite_prompt_shown:${groupId}`;
}

export function isInvitePromptShownValue(
  value: string | null | undefined,
): boolean {
  return value === "1" || value === "true";
}
