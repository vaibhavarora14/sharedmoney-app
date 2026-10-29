import type { StoreReviewModule } from "./inAppReviewPromptLogic";

/** Web never shows a native review prompt; keep expo-store-review out of the web bundle. */
export function loadStoreReview(): StoreReviewModule | null {
  return null;
}
