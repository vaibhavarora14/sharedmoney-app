export const RESEND_REQUEST_TEXT = "Hey, the SharedMoney bill link didn’t open, can you resend it?";

/** Ask label: uses the sharer's name only when the link told us who it was. */
export function askForNewLinkLabel(friendName?: string | null): string {
  const name = friendName?.trim();
  return name ? `Ask ${name} for a new link` : "Ask for a new link";
}
