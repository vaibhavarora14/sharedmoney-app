import {
  UPI_APPS,
  type UpiAppDefinition,
} from "./upi";

export type UpiAppsDependencies = {
  canOpenURL: (url: string) => Promise<boolean>;
};

function defaultCanOpenURL(url: string): Promise<boolean> {
  try {
    // Soft native dependency — Deno unit tests load this module without RN.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Linking } = require("react-native") as {
      Linking?: { canOpenURL?: (url: string) => Promise<boolean> };
    };
    if (!Linking?.canOpenURL) return Promise.resolve(false);
    return Linking.canOpenURL(url);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Returns UPI apps that appear installed via scheme probes.
 * Requires LSApplicationQueriesSchemes (iOS) / Android <queries>.
 */
export async function detectInstalledUpiApps(
  dependencies: Partial<UpiAppsDependencies> = {},
): Promise<UpiAppDefinition[]> {
  const canOpenURL = dependencies.canOpenURL ?? defaultCanOpenURL;
  const installed: UpiAppDefinition[] = [];
  for (const app of UPI_APPS) {
    try {
      const ok = await canOpenURL(`${app.scheme}://`);
      if (ok) installed.push(app);
    } catch {
      // Ignore probe failures; treat as not installed.
    }
  }
  return installed;
}
