import { Alert, Platform, Share } from "react-native";
import { buildInviteShareMessage, buildInviteShareTitle } from "./inviteShare";

export type ShareInviteLinkResult = "shared" | "cancelled" | "unavailable";

const DEFAULT_COPIED_MESSAGE = "Share it with the people you want to invite.";

/**
 * Opens the platform share sheet (or copies the URL on web without Web Share).
 * Abort/cancel from the sheet is returned as `cancelled`, not thrown.
 */
export async function shareInviteLink(
  url: string,
  groupName?: string,
  options?: { copiedMessage?: string },
): Promise<ShareInviteLinkResult> {
  const title = buildInviteShareTitle(groupName);
  const message = buildInviteShareMessage(url, groupName);

  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title, text: message, url });
        return "shared";
      }
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        Alert.alert(
          "Invite link copied",
          options?.copiedMessage ?? DEFAULT_COPIED_MESSAGE,
        );
        return "shared";
      }
      return "unavailable";
    }

    const result = await Share.share({ message, url });
    if (result.action === Share.dismissedAction) return "cancelled";
    return "shared";
  } catch (err) {
    const text = err instanceof Error ? err.message : "";
    if (/abort|cancel/i.test(text)) return "cancelled";
    throw err;
  }
}

export function inviteShareChannel(platform: string): string {
  return platform === "web" ? "web" : platform;
}
