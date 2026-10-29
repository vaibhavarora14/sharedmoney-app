/**
 * Pure eligibility rules for the native in-app review prompt.
 *
 * Trigger: current user's 3rd successfully saved expense in a group with
 * 2+ members. Ask at most once per install from our side; the OS still
 * throttles further (iOS ~3/year, Play quota).
 */

export const REVIEW_QUALIFYING_EXPENSE_THRESHOLD = 3;

export const MIN_GROUP_MEMBERS_FOR_REVIEW = 2;

/** Delay after a successful save so the form/modal has dismissed. */
export const REVIEW_PROMPT_SETTLE_DELAY_MS = 1200;

export type ReviewPromptPlatform = "ios" | "android" | "web" | string;

export function countActiveGroupMembers(
  participants: ReadonlyArray<{ type?: string | null }> | null | undefined,
): number {
  if (!Array.isArray(participants)) return 0;
  return participants.filter((p) => p.type !== "former").length;
}

export function isMultiMemberGroup(memberCount: number): boolean {
  return memberCount >= MIN_GROUP_MEMBERS_FOR_REVIEW;
}

/**
 * Whether this created transaction should increment the local qualifying
 * expense counter (expense type + multi-member group).
 */
export function shouldCountCreatedExpense(input: {
  transactionType: string | null | undefined;
  groupMemberCount: number;
}): boolean {
  return (
    input.transactionType === "expense" &&
    isMultiMemberGroup(input.groupMemberCount)
  );
}

/**
 * Whether we should attempt the native review API after a qualifying save.
 * Web is always a no-op. Once-per-install flag blocks further attempts.
 */
export function shouldRequestReviewPrompt(input: {
  qualifyingExpenseCount: number;
  hasRequestedReview: boolean;
  platform: ReviewPromptPlatform;
}): boolean {
  if (input.platform === "web") return false;
  if (input.hasRequestedReview) return false;
  return input.qualifyingExpenseCount >= REVIEW_QUALIFYING_EXPENSE_THRESHOLD;
}

/** Install-scoped: one ask from our side regardless of account. */
export const REVIEW_REQUESTED_STORAGE_KEY =
  "@sharedmoney/in_app_review_requested";

export function reviewQualifyingExpenseCountKey(userId: string): string {
  return `@sharedmoney/in_app_review_qualifying_expense_count:${userId}`;
}
