import {
  INVITE_PROMPT_SETTLE_DELAY_MS,
  invitePromptShownKey,
  isInvitePromptShownValue,
  shouldShowInvitePrompt,
} from "./invitePromptEligibility";
import type {
  InvitePromptChoice,
  InvitePromptRequest,
} from "./invitePromptPresenter";

export type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export type InvitePromptDependencies = {
  platform: string;
  storage: StorageLike;
  settleDelayMs?: number;
  schedule: (fn: () => void | Promise<void>, ms: number) => unknown;
  presentPrompt: (request: InvitePromptRequest) => Promise<InvitePromptChoice>;
  captureEvent: (
    userId: string | null | undefined,
    event: string,
    properties?: Record<string, string | number | boolean | null | undefined>,
  ) => void;
  promptShownEvent: string;
  promptSharedEvent: string;
  promptDismissedEvent: string;
};

export type MaybeShowInvitePromptInput = {
  userId: string | null | undefined;
  groupId: string | null | undefined;
  groupName?: string;
  amount?: number;
  currency?: string;
  transactionType: string | null | undefined;
  isFirstExpense: boolean;
  activeMemberCount: number;
  groupKind: string | null | undefined;
};

async function alreadyPrompted(
  storage: StorageLike,
  groupId: string,
): Promise<boolean> {
  const value = await storage.getItem(invitePromptShownKey(groupId));
  return isInvitePromptShownValue(value);
}

async function markPrompted(
  storage: StorageLike,
  groupId: string,
): Promise<void> {
  await storage.setItem(invitePromptShownKey(groupId), "1");
}

function capturePromptOutcome(
  deps: InvitePromptDependencies,
  userId: string | null | undefined,
  choice: InvitePromptChoice,
  properties: Record<string, string | number | boolean | null | undefined>,
): void {
  switch (choice) {
    case "share":
      deps.captureEvent(userId, deps.promptSharedEvent, properties);
      return;
    case "dismiss":
      deps.captureEvent(userId, deps.promptDismissedEvent, properties);
      return;
    default: {
      const _exhaustive: never = choice;
      return _exhaustive;
    }
  }
}

/**
 * After a successful expense create, maybe show a once-per-group invite
 * prompt. Returns true when a prompt was scheduled so callers can skip
 * stacked update/review prompts.
 */
export async function maybeShowInvitePromptAfterExpense(
  input: MaybeShowInvitePromptInput,
  deps: InvitePromptDependencies,
): Promise<boolean> {
  const groupId = input.groupId;
  if (!groupId) return false;
  if (
    !shouldShowInvitePrompt({
      transactionType: input.transactionType,
      isFirstExpense: input.isFirstExpense,
      activeMemberCount: input.activeMemberCount,
      groupKind: input.groupKind,
      alreadyShown: false,
    })
  ) {
    return false;
  }
  if (await alreadyPrompted(deps.storage, groupId)) return false;

  // Stick the once-flag before the settle delay so a second save cannot
  // schedule another prompt. Showing is still delayed until the form closes.
  await markPrompted(deps.storage, groupId);

  const settleDelayMs = deps.settleDelayMs ?? INVITE_PROMPT_SETTLE_DELAY_MS;
  deps.schedule(() => {
    return runInvitePromptAfterSettle({ input, groupId, deps });
  }, settleDelayMs);
  return true;
}

async function runInvitePromptAfterSettle(args: {
  input: MaybeShowInvitePromptInput;
  groupId: string;
  deps: InvitePromptDependencies;
}): Promise<void> {
  const { input, groupId, deps } = args;
  const properties = {
    group_id: groupId,
    platform: deps.platform,
  };

  deps.captureEvent(input.userId, deps.promptShownEvent, properties);

  let choice: InvitePromptChoice = "dismiss";
  try {
    choice = await deps.presentPrompt({
      groupId,
      groupName: input.groupName,
      amount: input.amount,
      currency: input.currency,
    });
  } catch {
    // Presentation is best-effort; the shown event and once-flag already stuck.
    return;
  }

  capturePromptOutcome(deps, input.userId, choice, properties);
}
