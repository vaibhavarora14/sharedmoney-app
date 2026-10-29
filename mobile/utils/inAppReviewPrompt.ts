import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  maybeRequestInAppReviewAfterExpense as maybeRequestInAppReviewAfterExpenseLogic,
  requestNativeStoreReview as requestNativeStoreReviewLogic,
  type InAppReviewPromptDependencies,
  type MaybeRequestInAppReviewInput,
  type StoreReviewModule,
} from "./inAppReviewPromptLogic";
import { captureIdentifiedAnalyticsEvent } from "./posthogAnalytics";
import { ANALYTICS_EVENTS } from "./posthogEvents";

export type {
  InAppReviewPromptDependencies,
  MaybeRequestInAppReviewInput,
  StoreReviewModule,
} from "./inAppReviewPromptLogic";

function defaultLoadStoreReview(): StoreReviewModule | null {
  // Lazy require: expo-store-review touches requireNativeModule at load time.
  // OTA to binaries that never linked ExpoStoreReview must not crash.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-store-review") as StoreReviewModule;
  } catch {
    return null;
  }
}

function defaultDependencies(
  overrides: Partial<InAppReviewPromptDependencies> = {},
): InAppReviewPromptDependencies {
  return {
    platform: overrides.platform ?? Platform.OS,
    storage: overrides.storage ?? AsyncStorage,
    settleDelayMs: overrides.settleDelayMs,
    schedule: overrides.schedule ?? setTimeout,
    loadStoreReview: overrides.loadStoreReview ?? defaultLoadStoreReview,
    captureEvent: overrides.captureEvent ?? captureIdentifiedAnalyticsEvent,
    reviewPromptRequestedEvent:
      overrides.reviewPromptRequestedEvent ??
      ANALYTICS_EVENTS.REVIEW_PROMPT_REQUESTED,
  };
}

export async function requestNativeStoreReview(
  loadStoreReview: () => StoreReviewModule | null = defaultLoadStoreReview,
): Promise<"requested" | "unavailable" | "missing_module"> {
  return requestNativeStoreReviewLogic(loadStoreReview);
}

/**
 * App entry point after a successful expense create. Uses AsyncStorage +
 * expo-store-review with safe no-ops when the native module is missing.
 */
export async function maybeRequestInAppReviewAfterExpense(
  input: MaybeRequestInAppReviewInput,
  deps: Partial<InAppReviewPromptDependencies> = {},
): Promise<void> {
  return maybeRequestInAppReviewAfterExpenseLogic(
    input,
    defaultDependencies(deps),
  );
}
