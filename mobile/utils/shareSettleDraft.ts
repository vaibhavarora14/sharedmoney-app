import { Alert, Platform, Share } from "react-native";

export async function shareSettleDraft(
  message: string,
  paymentUrl?: string | null,
): Promise<void> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) return;

  const trimmedUrl = paymentUrl?.trim() || "";
  const hasUrl = trimmedUrl.length > 0;

  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          text: trimmedMessage,
          ...(hasUrl ? { url: trimmedUrl } : {}),
        });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(trimmedMessage);
        Alert.alert(
          "Settle message copied",
          "Paste it into WhatsApp, iMessage, or any chat. Nothing is sent until you send it.",
        );
        return;
      }
    }

    await Share.share(
      {
        message: trimmedMessage,
        ...(hasUrl ? { url: trimmedUrl } : {}),
      },
      Platform.OS === "android" ? { dialogTitle: "Share in chat" } : undefined,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "";
    if (/abort|cancel/i.test(errorMessage)) return;
    throw err;
  }
}
