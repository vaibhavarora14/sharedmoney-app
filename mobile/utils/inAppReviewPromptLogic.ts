import {
  REVIEW_PROMPT_SETTLE_DELAY_MS,
  REVIEW_REQUESTED_STORAGE_KEY,
  reviewQualifyingExpenseCountKey,
  shouldCountCreatedExpense,
  shouldRequestReviewPrompt,
} from "./inAppReviewEligibility";

export type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export type StoreReviewModule = {
  isAvailableAsync?: () => Promise<boolean>;
  hasAction?: () => Promise<boolean>;
  requestReview?: () => Promise<void>;
};

export type InAppReviewPromptDependencies = {
  platform: string;
  storage: StorageLike;
  settleDelayMs?: number;
  schedule: (
    fn: () => void | Promise<void>,
    ms: number,
  ) => unknown;
  loadStoreReview: () => StoreReviewModule | null;
  captureEvent: (
    userId: string | null | undefined,
    event: string,
    properties?: Record<string, string | number | boolean | null | undefined>,
  ) => void;
  /** Analytics event name for a successful native requestReview call. */
  reviewPromptRequestedEvent: string;
};

async function readCount(
  storage: StorageLike,
  userId: string,
): Promise<number> {
  const raw = await storage.getItem(reviewQualifyingExpenseCountKey(userId));
  const parsed = raw == null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function writeCount(
  storage: StorageLike,
  userId: string,
  count: number,
): Promise<void> {
  await storage.setItem(reviewQualifyingExpenseCountKey(userId), String(count));
}

async function hasRequestedReview(storage: StorageLike): Promise<boolean> {
  const value = await storage.getItem(REVIEW_REQUESTED_STORAGE_KEY);
  return value === "1" || value === "true";
}

async function markRequestedReview(storage: StorageLike): Promise<void> {
  await storage.setItem(REVIEW_REQUESTED_STORAGE_KEY, "1");
}

/**
 * Call the native in-app review API when available. Never throws.
 */
export async function requestNativeStoreReview(
  loadStoreReview: () => StoreReviewModule | null,
): Promise<"requested" | "unavailable" | "missing_module"> {
  let StoreReview: StoreReviewModule | null;
  try {
    StoreReview = loadStoreReview();
  } catch {
    return "missing_module";
  }
  if (!StoreReview) return "missing_module";

  let available = false;
  let hasAction = true;
  try {
    available =
      typeof StoreReview.isAvailableAsync === "function"
        ? await StoreReview.isAvailableAsync()
        : false;
    hasAction =
      typeof StoreReview.hasAction === "function"
        ? await StoreReview.hasAction()
        : true;
  } catch {
    // JS package loaded but native binary lacks ExpoStoreReview.
    return "missing_module";
  }

  if (!available || !hasAction) return "unavailable";
  if (typeof StoreReview.requestReview !== "function") return "unavailable";

  try {
    await StoreReview.requestReview();
    return "requested";
  } catch {
    // We reached the native call; treat as unavailable so the once-per-install
    // flag still sticks (avoid hammering a broken path).
    return "unavailable";
  }
}

export type MaybeRequestInAppReviewInput = {
  userId: string | null | undefined;
  transactionType: string | null | undefined;
  groupMemberCount: number;
};

/**
 * After a successful expense create: bump the per-user qualifying count when
 * the group has 2+ members, then (once) request the native review after a
 * short settle delay. Safe no-op on web and when the native module is absent.
 */
export async function maybeRequestInAppReviewAfterExpense(
  input: MaybeRequestInAppReviewInput,
  deps: InAppReviewPromptDependencies,
): Promise<void> {
  const settleDelayMs = deps.settleDelayMs ?? REVIEW_PROMPT_SETTLE_DELAY_MS;
  const userId = input.userId;
  if (!userId) return;

  if (
    !shouldCountCreatedExpense({
      transactionType: input.transactionType,
      groupMemberCount: input.groupMemberCount,
    })
  ) {
    return;
  }

  const nextCount = (await readCount(deps.storage, userId)) + 1;
  await writeCount(deps.storage, userId, nextCount);

  const alreadyRequested = await hasRequestedReview(deps.storage);
  if (
    !shouldRequestReviewPrompt({
      qualifyingExpenseCount: nextCount,
      hasRequestedReview: alreadyRequested,
      platform: deps.platform,
    })
  ) {
    return;
  }

  deps.schedule(() => {
    // Return the promise so tests can flush settle work; setTimeout ignores it.
    return runReviewPromptAfterSettle({
      userId,
      nextCount,
      deps,
    });
  }, settleDelayMs);
}

async function runReviewPromptAfterSettle(input: {
  userId: string;
  nextCount: number;
  deps: InAppReviewPromptDependencies;
}): Promise<void> {
  const { userId, nextCount, deps } = input;

  // Re-check the once-per-install flag in case two saves raced.
  if (await hasRequestedReview(deps.storage)) return;

  const result = await requestNativeStoreReview(deps.loadStoreReview);
  if (result === "missing_module") {
    // Leave the flag unset so a later store binary with the native module
    // can still prompt after the next qualifying save.
    return;
  }

  // Mark once for this install whether the OS showed UI or declined via
  // isAvailableAsync/hasAction. We asked from our side either way.
  await markRequestedReview(deps.storage);

  if (result === "requested") {
    deps.captureEvent(userId, deps.reviewPromptRequestedEvent, {
      platform: deps.platform,
      qualifying_expense_count: nextCount,
    });
  }
}
