import { isNoMatchingBrowserActivityError } from "./socialAuth";

export type CustomTabsBrowserListing = {
  defaultBrowserPackage?: string | null;
  preferredBrowserPackage?: string | null;
  browserPackages?: readonly string[] | null;
};

export type GoogleAuthBrowserResult = {
  type: string;
  url?: string;
};

export type GoogleAuthSessionKind = "success" | "cancelled" | "incomplete";

/**
 * iOS ASWebAuthenticationSession often returns `dismiss` when the sheet
 * closes without tokens. That is not a user cancel — treat it as incomplete
 * so the caller can show an error instead of failing silently.
 */
export function classifyGoogleAuthSessionResult(
  type: string,
): GoogleAuthSessionKind {
  if (type === "success") return "success";
  if (type === "cancel") return "cancelled";
  return "incomplete";
}

export type GoogleAuthBrowserOptions = {
  browserPackage?: string;
};

export type GoogleBrowserAuthDependencies = {
  openAuthSession: (
    url: string,
    redirectUrl: string,
    options?: GoogleAuthBrowserOptions,
  ) => Promise<GoogleAuthBrowserResult>;
  listCustomTabsBrowsers: () => Promise<CustomTabsBrowserListing>;
};

function firstPackage(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Prefer a browser that fully supports Custom Tabs, then the default, then
 * any package that can handle the Custom Tabs intent.
 */
export function pickCustomTabsBrowserPackage(
  listing: CustomTabsBrowserListing | null | undefined,
): string | null {
  if (!listing) return null;
  const preferred = firstPackage(listing.preferredBrowserPackage);
  if (preferred) return preferred;
  const fallback = firstPackage(listing.defaultBrowserPackage);
  if (fallback) return fallback;
  for (const candidate of listing.browserPackages ?? []) {
    const packageName = firstPackage(candidate);
    if (packageName) return packageName;
  }
  return null;
}

/**
 * Opens the Google OAuth browser session.
 *
 * Android `openAuthSessionAsync` is a Custom Tabs polyfill. When the default
 * resolver finds no activity, retry once with an explicit Custom Tabs package
 * so a non-default browser (Chrome installed, another app set as default) can
 * still complete sign-in. If nothing is installed, the original rejection is
 * rethrown for the caller to offer email or WhatsApp.
 */
export async function openGoogleAuthSession(
  url: string,
  redirectUrl: string,
  dependencies: GoogleBrowserAuthDependencies,
  platform: string,
): Promise<GoogleAuthBrowserResult> {
  try {
    return await dependencies.openAuthSession(url, redirectUrl);
  } catch (error) {
    if (platform !== "android" || !isNoMatchingBrowserActivityError(error)) {
      throw error;
    }

    let browserPackage: string | null = null;
    try {
      browserPackage = pickCustomTabsBrowserPackage(
        await dependencies.listCustomTabsBrowsers(),
      );
    } catch {
      browserPackage = null;
    }

    if (!browserPackage) {
      throw error;
    }

    return await dependencies.openAuthSession(url, redirectUrl, {
      browserPackage,
    });
  }
}
