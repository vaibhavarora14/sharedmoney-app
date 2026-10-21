import {
  buildWhatsAppMeUrl,
  buildWhatsAppSendUrl,
} from "./settleShareMessage";
import { shareSettleDraft } from "./shareSettleDraft";
import {
  defaultSettleRemindDependencies,
  resolveSettleRemindChannel,
  settleRemindLabel,
  type SettleRemindChannel,
  type SettleRemindDependencies,
} from "./settleRemindChannel";

export type { SettleRemindChannel, SettleRemindDependencies };
export { resolveSettleRemindChannel, settleRemindLabel };

function readPlatformOS(): string {
  try {
    // Soft native dependency — keep Deno-safe for adjacent modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as {
      Platform?: { OS?: string };
    };
    return Platform?.OS || "web";
  } catch {
    return "web";
  }
}

/**
 * Open WhatsApp with a prefilled draft, or fall back to the OS share sheet.
 * Does not show a success toast. Never logs the phone number.
 */
export async function openSettleRemind(input: {
  message: string;
  phone?: string | null;
  /** Force share sheet (long-press / "Share another way"). */
  forceShare?: boolean;
  dependencies?: Partial<SettleRemindDependencies>;
}): Promise<SettleRemindChannel> {
  const trimmed = input.message.trim();
  if (!trimmed) return "share";

  if (input.forceShare) {
    await shareSettleDraft(trimmed);
    return "share";
  }

  const { channel, phoneDigits } = await resolveSettleRemindChannel(
    input.phone,
    input.dependencies,
  );

  if (channel !== "whatsapp" || !phoneDigits) {
    await shareSettleDraft(trimmed);
    return "share";
  }

  const deps = { ...defaultSettleRemindDependencies, ...input.dependencies };
  const os = deps.platformOS ?? readPlatformOS();

  if (os === "web") {
    const url = buildWhatsAppMeUrl(phoneDigits, trimmed);
    deps.openWebTab?.(url);
    return "whatsapp";
  }

  const url = buildWhatsAppSendUrl(phoneDigits, trimmed);
  try {
    await deps.openURL(url);
    return "whatsapp";
  } catch {
    await shareSettleDraft(trimmed);
    return "share";
  }
}
