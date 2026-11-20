import {
  ITUNES_LOOKUP_URL,
  PLAY_STORE_LOOKUP_URL,
  UPDATE_PROMPT_MESSAGE,
  UPDATE_PROMPT_SETTLE_DELAY_MS,
  UPDATE_PROMPT_TITLE,
  parseITunesStoreVersion,
  parsePlayStoreVersion,
  shouldOfferUpdatePrompt,
  updatePromptShownKey,
  type UpdatePromptPlatform,
} from "./inAppUpdateEligibility";

export type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export type UpdatePromptChoice = "update" | "later";

export type InAppUpdatePromptDependencies = {
  platform: UpdatePromptPlatform;
  currentVersion: string | null | undefined;
  storage: StorageLike;
  storeUrl: string;
  inOnboarding?: boolean;
  settleDelayMs?: number;
  schedule: (fn: () => void | Promise<void>, ms: number) => unknown;
  fetchText: (url: string) => Promise<string>;
  presentPrompt: (input: {
    title: string;
    message: string;
  }) => Promise<UpdatePromptChoice>;
  openStoreUrl: (url: string) => Promise<void>;
  captureEvent: (
    userId: string | null | undefined,
    event: string,
    properties?: Record<string, string | number | boolean | null | undefined>,
  ) => void;
  promptShownEvent: string;
  updateStartedEvent: string;
};

export type MaybePromptAppUpdateInput = {
  userId: string | null | undefined;
  transactionType: string | null | undefined;
};

async function alreadyPrompted(
  storage: StorageLike,
  currentVersion: string,
): Promise<boolean> {
  const value = await storage.getItem(updatePromptShownKey(currentVersion));
  return value === "1" || value === "true";
}

async function markPrompted(
  storage: StorageLike,
  currentVersion: string,
): Promise<void> {
  await storage.setItem(updatePromptShownKey(currentVersion), "1");
}

export async function lookupStoreVersion(
  platform: UpdatePromptPlatform,
  fetchText: (url: string) => Promise<string>,
): Promise<string | null> {
  if (platform === "ios") {
    const raw = await fetchText(ITUNES_LOOKUP_URL);
    try {
      return parseITunesStoreVersion(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (platform === "android") {
    const html = await fetchText(PLAY_STORE_LOOKUP_URL);
    return parsePlayStoreVersion(html);
  }
  return null;
}

/**
 * After a successful expense create, check the live store version and maybe
 * show a once-per-installed-version update prompt. Returns true when a prompt
 * was scheduled so callers can skip the review prompt. Safe no-op on web.
 */
export async function maybePromptAppUpdateAfterExpense(
  input: MaybePromptAppUpdateInput,
  deps: InAppUpdatePromptDependencies,
): Promise<boolean> {
  const currentVersion = deps.currentVersion ?? null;
  if (!currentVersion) return false;
  if (deps.platform === "web") return false;
  if (deps.inOnboarding) return false;
  if (input.transactionType !== "expense") return false;
  if (await alreadyPrompted(deps.storage, currentVersion)) return false;

  let storeVersion: string | null;
  try {
    storeVersion = await lookupStoreVersion(deps.platform, deps.fetchText);
  } catch {
    return false;
  }

  if (
    !shouldOfferUpdatePrompt({
      platform: deps.platform,
      currentVersion,
      storeVersion,
      alreadyPromptedForCurrentVersion: false,
      inOnboarding: Boolean(deps.inOnboarding),
      transactionType: input.transactionType,
    })
  ) {
    return false;
  }

  const settleDelayMs = deps.settleDelayMs ?? UPDATE_PROMPT_SETTLE_DELAY_MS;
  deps.schedule(() => {
    return runUpdatePromptAfterSettle({
      userId: input.userId,
      currentVersion,
      storeVersion: storeVersion!,
      deps,
    });
  }, settleDelayMs);
  return true;
}

async function runUpdatePromptAfterSettle(input: {
  userId: string | null | undefined;
  currentVersion: string;
  storeVersion: string;
  deps: InAppUpdatePromptDependencies;
}): Promise<void> {
  const { userId, currentVersion, storeVersion, deps } = input;
  if (await alreadyPrompted(deps.storage, currentVersion)) return;

  await markPrompted(deps.storage, currentVersion);
  deps.captureEvent(userId, deps.promptShownEvent, {
    platform: deps.platform,
    current_version: currentVersion,
    store_version: storeVersion,
  });

  const choice = await deps.presentPrompt({
    title: UPDATE_PROMPT_TITLE,
    message: UPDATE_PROMPT_MESSAGE,
  });
  if (choice !== "update") return;

  deps.captureEvent(userId, deps.updateStartedEvent, {
    platform: deps.platform,
    current_version: currentVersion,
    store_version: storeVersion,
  });
  try {
    await deps.openStoreUrl(deps.storeUrl);
  } catch {
    // Opening the store is best-effort; the shown event already stuck.
  }
}
