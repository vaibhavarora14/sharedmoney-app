import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  maybeRequestInAppReviewAfterExpense as maybeRequestInAppReviewAfterExpenseLogic,
  requestNativeStoreReview as requestNativeStoreReviewLogic,
  type InAppReviewPromptDependencies,
  type MaybeRequestInAppReviewInput,
  type StoreReviewModule,
} from "./inAppReviewPromptLogic";
import { loadStoreReview } from "./loadStoreReview";
import { captureIdentifiedAnalyticsEvent } from "./posthogAnalytics";
import { ANALYTICS_EVENTS } from "./posthogEvents";

export type {
  InAppReviewPromptDependencies,
  MaybeRequestInAppReviewInput,
  StoreReviewModule,
} from "./inAppReviewPromptLogic";

const defaultLoadStoreReview = loadStoreReview;

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
