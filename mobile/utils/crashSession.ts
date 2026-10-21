import { generateSupportReferenceId } from "./supportReferenceId";

/**
 * In-memory crash counter for the current JS session.
 *
 * Rule (issue #377): show a support reference ID from the **2nd crash onward
 * in the same JS session** (survives ErrorBoundary remounts / Reload, resets
 * when the process is killed). Each crash from the 2nd onward gets its own ID
 * so support can look up that specific Sentry event.
 */

export type CrashRecord = {
  /** 1-based count of crashes observed in this JS session. */
  crashNumber: number;
  /** Present from the 2nd crash on; attach to the Sentry report. */
  supportReferenceId: string | null;
  /** True when the UI should show the support ID + Contact support link. */
  showSupportReference: boolean;
};

let crashCount = 0;

/** Test helper — not used by production UI. */
export function resetCrashSessionForTests(): void {
  crashCount = 0;
}

/** Test helper — inspect without recording. */
export function getCrashCountForTests(): number {
  return crashCount;
}

/**
 * Record a crash for this JS session and optionally mint a support reference ID.
 */
export function recordCrash(
  generateId: () => string = generateSupportReferenceId,
): CrashRecord {
  crashCount += 1;
  const showSupportReference = crashCount >= 2;
  return {
    crashNumber: crashCount,
    supportReferenceId: showSupportReference ? generateId() : null,
    showSupportReference,
  };
}
