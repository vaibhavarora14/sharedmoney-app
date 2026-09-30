export const OTA_MAX_RELOAD_ATTEMPTS = 1;

export type OtaUpdateNotice =
  | { kind: "hidden" }
  | { kind: "downloading"; progressLabel: string | null }
  | { kind: "ready" };

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
   * Explicit "no compatible OTA for this runtime" signal. Banner stays hidden;
   * store upgrades use ForceUpdateModal / HTTP 426 only.
   */
  noCompatibleUpdate?: boolean;
}

function formatProgress(progress?: number | null): string | null {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return `${percent}%`;
}

function cannotApplyOta(state: OtaUpdateState): boolean {
  return Boolean(
    state.reloadFailed ||
      state.noCompatibleUpdate ||
      state.isEmergencyLaunch ||
      state.checkError ||
      state.downloadError ||
      (state.isUpdatePending &&
        (state.restartCount ?? 0) >= OTA_MAX_RELOAD_ATTEMPTS),
  );
}

/**
 * Quiet, non-blocking copy for Expo OTA status.
 * Only surfaces when an OTA can actually apply (downloading / ready).
 * Skip checking, empty checks, errors, and incompatible runtimes — store
 * upgrades stay on ForceUpdateModal / HTTP 426, not this chip.
 */
export function otaUpdateNotice(state: OtaUpdateState): OtaUpdateNotice {
  if (state.platform === "web" || state.isEnabled === false) {
    return { kind: "hidden" };
  }

  if (cannotApplyOta(state)) {
    return { kind: "hidden" };
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

  return { kind: "hidden" };
}

export function otaUpdateMessage(notice: OtaUpdateNotice): string | null {
  switch (notice.kind) {
    case "hidden":
      return null;
    case "downloading":
      return notice.progressLabel
        ? `Downloading update… ${notice.progressLabel}`
        : "Downloading update…";
    case "ready":
      return "Update ready. Tap to restart.";
    default: {
      const _exhaustive: never = notice;
      return _exhaustive;
    }
  }
}
