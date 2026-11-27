import { assertEquals } from "jsr:@std/assert@1";
import {
  INVITE_PROMPT_MIN_TAP_TARGET,
  INVITE_PROMPT_SCRIM,
  INVITE_PROMPT_SHEET_BOTTOM_GAP,
  INVITE_PROMPT_WEB_MAX_WIDTH,
  invitePromptSheetPaddingBottom,
  isInvitePromptBottomSheet,
  shouldDismissInvitePromptSwipe,
} from "./invitePromptLayout.ts";

Deno.test("native is always a bottom sheet; web is a sheet only below the app column", () => {
  assertEquals(isInvitePromptBottomSheet("ios", 390), true);
  assertEquals(isInvitePromptBottomSheet("android", 1280), true);
  assertEquals(isInvitePromptBottomSheet("web", 390), true);
  assertEquals(isInvitePromptBottomSheet("web", 599), true);
  assertEquals(isInvitePromptBottomSheet("web", 600), false);
  assertEquals(isInvitePromptBottomSheet("web", 1280), false);
});

Deno.test("sheet bottom padding is the safe-area inset plus 16", () => {
  assertEquals(INVITE_PROMPT_SHEET_BOTTOM_GAP, 16);
  assertEquals(invitePromptSheetPaddingBottom(34), 50);
  assertEquals(invitePromptSheetPaddingBottom(0), 16);
  assertEquals(invitePromptSheetPaddingBottom(-8), 16);
});

Deno.test("swipe-down past the threshold counts as Not now", () => {
  assertEquals(shouldDismissInvitePromptSwipe(71), false);
  assertEquals(shouldDismissInvitePromptSwipe(72), true);
  assertEquals(shouldDismissInvitePromptSwipe(120), true);
  assertEquals(shouldDismissInvitePromptSwipe(0), false);
});

Deno.test("web dialog is capped at 440 and Not now meets 44pt", () => {
  assertEquals(INVITE_PROMPT_WEB_MAX_WIDTH, 440);
  assertEquals(INVITE_PROMPT_MIN_TAP_TARGET, 44);
  assertEquals(INVITE_PROMPT_SCRIM, "rgba(17, 23, 29, 0.6)");
});
