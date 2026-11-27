import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  maybeShowInvitePromptAfterExpense as maybeShowInvitePromptAfterExpenseLogic,
  type InvitePromptDependencies,
  type MaybeShowInvitePromptInput,
} from "./invitePromptLogic";
import { presentInvitePrompt } from "./invitePromptPresenter";
import { captureIdentifiedAnalyticsEvent } from "./posthogAnalytics";
import { ANALYTICS_EVENTS } from "./posthogEvents";

export type {
  InvitePromptDependencies,
  MaybeShowInvitePromptInput,
} from "./invitePromptLogic";

function defaultDependencies(
  overrides: Partial<InvitePromptDependencies> = {},
): InvitePromptDependencies {
  return {
    platform: overrides.platform ?? Platform.OS,
    storage: overrides.storage ?? AsyncStorage,
    settleDelayMs: overrides.settleDelayMs,
    schedule: overrides.schedule ?? setTimeout,
    presentPrompt: overrides.presentPrompt ?? presentInvitePrompt,
    captureEvent: overrides.captureEvent ?? captureIdentifiedAnalyticsEvent,
    promptShownEvent:
      overrides.promptShownEvent ?? ANALYTICS_EVENTS.INVITE_PROMPT_SHOWN,
    promptSharedEvent:
      overrides.promptSharedEvent ?? ANALYTICS_EVENTS.INVITE_PROMPT_SHARED,
    promptDismissedEvent:
      overrides.promptDismissedEvent ?? ANALYTICS_EVENTS.INVITE_PROMPT_DISMISSED,
  };
}

/**
 * After a successful expense create, maybe show a once-per-group invite
 * prompt. Returns true when a prompt was scheduled (skip update/review).
 */
export async function maybeShowInvitePromptAfterExpense(
  input: MaybeShowInvitePromptInput,
  deps: Partial<InvitePromptDependencies> = {},
): Promise<boolean> {
  return maybeShowInvitePromptAfterExpenseLogic(input, defaultDependencies(deps));
}
