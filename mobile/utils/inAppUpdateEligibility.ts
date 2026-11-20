/**
 * Pure eligibility and version helpers for the in-app update prompt (#479 B).
 *
 * expo-in-app-updates 0.13 needs Expo SDK 58 (#477, still open). This prompt
 * uses a store-version lookup plus the existing store URLs instead, so it can
 * ship in the current SDK 57 app. Android flexible Play Core overlays stay
 * with the SDK 58 upgrade.
 */

export const APP_STORE_ID = "6755923591";
export const ANDROID_PACKAGE = "com.vaibhavarora.sharemoney";
export const ITUNES_LOOKUP_URL = `https://itunes.apple.com/lookup?id=${APP_STORE_ID}`;
export const PLAY_STORE_LOOKUP_URL =
  `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&hl=en&gl=US`;

export const UPDATE_PROMPT_SETTLE_DELAY_MS = 1200;

export const UPDATE_PROMPT_TITLE = "Update SharedMoney";
export const UPDATE_PROMPT_MESSAGE =
  "A newer version is available. Update to get the latest fixes and features.";

export type UpdatePromptPlatform = "ios" | "android" | "web" | string;

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:\W.*)?$/;

export function parseMarketingVersion(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = VERSION_RE.exec(trimmed);
  if (!match) return null;
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

/** @returns negative if a < b, 0 if equal, positive if a > b. */
export function compareMarketingVersions(a: string, b: string): number | null {
  const left = parseMarketingVersion(a);
  const right = parseMarketingVersion(b);
  if (!left || !right) return null;
  const partsA = left.split(".").map(Number);
  const partsB = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
  }
  return 0;
}

export function isStoreVersionNewer(
  currentVersion: string | null | undefined,
  storeVersion: string | null | undefined,
): boolean {
  const compared = compareMarketingVersions(
    currentVersion ?? "",
    storeVersion ?? "",
  );
  return compared != null && compared < 0;
}

export function shouldOfferUpdatePrompt(input: {
  platform: UpdatePromptPlatform;
  currentVersion: string | null | undefined;
  storeVersion: string | null | undefined;
  alreadyPromptedForCurrentVersion: boolean;
  inOnboarding: boolean;
  transactionType: string | null | undefined;
}): boolean {
  if (input.platform === "web") return false;
  if (input.inOnboarding) return false;
  if (input.transactionType !== "expense") return false;
  if (input.alreadyPromptedForCurrentVersion) return false;
  return isStoreVersionNewer(input.currentVersion, input.storeVersion);
}

export function updatePromptShownKey(currentVersion: string): string {
  return `@sharedmoney/app_update_prompt_shown:${currentVersion}`;
}

export function parseITunesStoreVersion(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0];
  if (!first || typeof first !== "object") return null;
  const version = (first as { version?: unknown }).version;
  return typeof version === "string" ? parseMarketingVersion(version) : null;
}

export function parsePlayStoreVersion(html: string): string | null {
  if (!html) return null;
  const patterns = [
    /itemprop="softwareVersion"[^>]*content="([^"]+)"/i,
    /content="([^"]+)"[^>]*itemprop="softwareVersion"/i,
    /Current Version<\/[^>]+>\s*<[^>]+>\s*([0-9]+\.[0-9]+\.[0-9]+)/i,
    /\[\[\["([0-9]+\.[0-9]+\.[0-9]+)"\]\]/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      const parsed = parseMarketingVersion(match[1]);
      if (parsed) return parsed;
    }
  }
  return null;
}
