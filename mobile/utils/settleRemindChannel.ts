import { whatsAppPhoneDigits } from "./settleShareMessage";

export type SettleRemindChannel = "whatsapp" | "share";

export type SettleRemindPlatform = "ios" | "android" | "web" | "windows" | "macos";

export type SettleRemindDependencies = {
  canOpenURL: (url: string) => Promise<boolean>;
  openURL: (url: string) => Promise<void>;
  openWebTab?: (url: string) => void;
  platformOS?: SettleRemindPlatform | string;
};

function readPlatformOS(): string {
  try {
    // Soft native dependency — Deno unit tests load this module without RN.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as {
      Platform?: { OS?: string };
    };
    return Platform?.OS || "web";
  } catch {
    return "web";
  }
}

function readLinking(): {
  canOpenURL: (url: string) => Promise<boolean>;
  openURL: (url: string) => Promise<void>;
} | null {
  try {
    // Soft native dependency — Deno unit tests load this module without RN.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Linking } = require("react-native") as {
      Linking?: {
        canOpenURL: (url: string) => Promise<boolean>;
        openURL: (url: string) => Promise<void>;
      };
    };
    if (!Linking?.canOpenURL || !Linking?.openURL) return null;
    return Linking;
  } catch {
    return null;
  }
}

export const defaultSettleRemindDependencies: SettleRemindDependencies = {
  canOpenURL: async (url) => {
    const linking = readLinking();
    if (!linking) return false;
    return linking.canOpenURL(url);
  },
  openURL: async (url) => {
    const linking = readLinking();
    if (!linking) throw new Error("Linking unavailable");
    await linking.openURL(url);
  },
  openWebTab: (url) => {
    const browser = globalThis as {
      window?: { open?: (href: string, target?: string, features?: string) => unknown };
    };
    browser.window?.open?.(url, "_blank", "noopener,noreferrer");
  },
};

/**
 * Whether native can deep-link into WhatsApp. Without LSApplicationQueriesSchemes
 * / Android <queries>, iOS/Android often return false — callers must fall back.
 * Web always treats a valid phone as WhatsApp-capable via wa.me.
 */
export async function resolveSettleRemindChannel(
  phone: string | null | undefined,
  dependencies: Partial<SettleRemindDependencies> = {},
): Promise<{ channel: SettleRemindChannel; phoneDigits: string | null }> {
  const deps = { ...defaultSettleRemindDependencies, ...dependencies };
  const phoneDigits = whatsAppPhoneDigits(phone);
  if (!phoneDigits) {
    return { channel: "share", phoneDigits: null };
  }

  const os = deps.platformOS ?? readPlatformOS();
  if (os === "web") {
    return { channel: "whatsapp", phoneDigits };
  }

  try {
    const installed = await deps.canOpenURL("whatsapp://send");
    return {
      channel: installed ? "whatsapp" : "share",
      phoneDigits,
    };
  } catch {
    return { channel: "share", phoneDigits };
  }
}

export function settleRemindLabel(channel: SettleRemindChannel): string {
  return channel === "whatsapp" ? "Remind on WhatsApp" : "Remind";
}
