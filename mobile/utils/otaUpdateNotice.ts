export const OTA_MAX_RELOAD_ATTEMPTS = 1;

export type OtaStoreRequiredReason =
  | "checkError"
  | "downloadError"
  | "incompatible"
  | "none"
  | "reloadFailed";

export type OtaUpdateNotice =
  | { kind: "hidden" }
  | { kind: "downloading"; progressLabel: string | null }
  | { kind: "ready" }
  | { kind: "storeRequired"; reason: OtaStoreRequiredReason };

export interface OtaUpdateState {
  isEnabled?: boolean;
  platform?: string;
  isDownloading: boolean;
  isUpdatePending: boolean;
  downloadProgress?: number | null;
  /** Expo `useUpdates().checkError` from startup / checkForUpdateAsync. */
  checkError?: { message?: string } | null;
  /** Expo `useUpdates().downloadError` from startup / fetchUpdateAsync. */
  downloadError?: { message?: string } | null;
  /** True when a launchable update exists for this runtime. */
  isUpdateAvailable?: boolean;
  /** Set after the first update check finishes this process lifetime. */
  lastCheckForUpdateTimeSinceRestart?: Date | null;
  /** Expo `useUpdates().restartCount` (reloadAsync attempts since cold start). */
  restartCount?: number;
  /** Local flag when reloadAsync threw before a successful restart. */
  reloadFailed?: boolean;
  /** Expo emergency launch — a downloaded update failed to start. */
  isEmergencyLaunch?: boolean;
  /**
   * Explicit "no compatible OTA for this runtime" signal (e.g. incompatibility
   * inferred outside typed Expo errors). A plain empty check stays hidden —
   * Expo cannot tell that apart from "already current".
   */
  noCompatibleUpdate?: boolean;
}

function formatProgress(progress?: number | null): string | null {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return `${percent}%`;
}

function errorMessage(error: { message?: string } | null | undefined): string {
  return typeof error?.message === "string" ? error.message.toLowerCase() : "";
}

/**
 * Heuristic for Expo / EAS errors that mean this binary cannot take the OTA
 * (wrong runtimeVersion / incompatible update), so the store build is required.
 */
export function isOtaIncompatibilityError(
  error: { message?: string } | null | undefined,
): boolean {
  const message = errorMessage(error);
  if (!message) return false;
  return (
    message.includes("incompatible") ||
    message.includes("not compatible") ||
    message.includes("runtimeversion") ||
    message.includes("runtime version") ||
    message.includes("this runtime") ||
    message.includes("failed to load update") ||
    message.includes("no compatible")
  );
}

function storeReasonForError(
  error: { message?: string } | null | undefined,
  fallback: "checkError" | "downloadError",
): OtaStoreRequiredReason {
  return isOtaIncompatibilityError(error) ? "incompatible" : fallback;
}

function storeNameForPlatform(platform?: string): string {
  if (platform === "ios") return "App Store";
  if (platform === "android") return "Play Store";
  return "app store";
}

/**
 * Quiet, non-blocking copy for Expo OTA status.
 * Skip the "checking" state so every cold start does not flash a banner.
 * Errors / exhausted reloads / incompatible updates point users to the store
 * instead of another restart/retry loop.
 */
export function otaUpdateNotice(state: OtaUpdateState): OtaUpdateNotice {
  if (state.platform === "web" || state.isEnabled === false) {
    return { kind: "hidden" };
  }

  if (state.reloadFailed) {
    return { kind: "storeRequired", reason: "reloadFailed" };
  }

  if (state.noCompatibleUpdate) {
    return { kind: "storeRequired", reason: "none" };
  }

  if (state.isEmergencyLaunch) {
    return { kind: "storeRequired", reason: "incompatible" };
  }

  if (state.downloadError) {
    return {
      kind: "storeRequired",
      reason: storeReasonForError(state.downloadError, "downloadError"),
    };
  }

  if (state.checkError) {
    return {
      kind: "storeRequired",
      reason: storeReasonForError(state.checkError, "checkError"),
    };
  }

  const restartCount = state.restartCount ?? 0;
  if (state.isUpdatePending && restartCount >= OTA_MAX_RELOAD_ATTEMPTS) {
    return { kind: "storeRequired", reason: "reloadFailed" };
  }

  if (state.isUpdatePending) {
    return { kind: "ready" };
  }

  if (state.isDownloading) {
    return {
      kind: "downloading",
      progressLabel: formatProgress(state.downloadProgress),
    };
  }

  // Successful check with nothing for this runtime: stay quiet. Expo cannot
  // distinguish "already current" from "no OTA for this appVersion" without an
  // error — store messaging only for errors / failed apply / explicit signals.
  return { kind: "hidden" };
}

export function otaUpdateMessage(
  notice: OtaUpdateNotice,
  platform?: string,
): string | null {
  switch (notice.kind) {
    case "hidden":
      return null;
    case "downloading":
      return notice.progressLabel
        ? `Downloading update… ${notice.progressLabel}`
        : "Downloading update…";
    case "ready":
      return "Update ready. Tap to restart.";
    case "storeRequired": {
      const store = storeNameForPlatform(platform);
      if (notice.reason === "incompatible" || notice.reason === "none") {
        return `A newer version is available in the ${store}. Tap to update.`;
      }
      return `Couldn't install this update. Get the latest SharedMoney from the ${store}.`;
    }
    default: {
      const _exhaustive: never = notice;
      return _exhaustive;
    }
  }
}
