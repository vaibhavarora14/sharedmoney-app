/**
 * Layout tokens for the post-first-expense invite prompt (#545).
 * Keep this file free of React Native so Deno tests can cover sheet vs dialog.
 */

import { WEB_MAX_WIDTH } from "../constants/layout";

/** Centered web dialog width. Phone-width web still uses the bottom sheet. */
export const INVITE_PROMPT_WEB_MAX_WIDTH = 440;

/** Dark scrim: ~60% of the dark canvas (`#11171D`). */
export const INVITE_PROMPT_SCRIM = "rgba(17, 23, 29, 0.6)";

/** Extra padding below sheet content, added on top of the safe-area inset. */
export const INVITE_PROMPT_SHEET_BOTTOM_GAP = 16;

/** Minimum tap target for "Not now" (and Share). */
export const INVITE_PROMPT_MIN_TAP_TARGET = 44;

/** Swipe-down distance that counts as Not now. */
export const INVITE_PROMPT_SWIPE_DISMISS_DY = 72;

export function isInvitePromptBottomSheet(
  platform: string,
  width: number,
): boolean {
  if (platform !== "web") return true;
  return width < WEB_MAX_WIDTH;
}

export function invitePromptSheetPaddingBottom(safeAreaBottom: number): number {
  const inset = Number.isFinite(safeAreaBottom) && safeAreaBottom > 0
    ? safeAreaBottom
    : 0;
  return inset + INVITE_PROMPT_SHEET_BOTTOM_GAP;
}

export function shouldDismissInvitePromptSwipe(dy: number): boolean {
  return dy >= INVITE_PROMPT_SWIPE_DISMISS_DY;
}
