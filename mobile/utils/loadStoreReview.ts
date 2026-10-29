import type { StoreReviewModule } from "./inAppReviewPromptLogic";

/**
 * Native loader. Lazy require: expo-store-review touches requireNativeModule
 * at load time, so an OTA to a binary that never linked ExpoStoreReview must
 * not crash. Web uses loadStoreReview.web.ts so the package is not bundled.
 */
export function loadStoreReview(): StoreReviewModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-store-review") as StoreReviewModule;
  } catch {
    return null;
  }
}
