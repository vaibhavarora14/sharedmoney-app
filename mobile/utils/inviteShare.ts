/**
 * Invite-link share copy and limits. Keep this file free of React Native
 * imports so Deno tests can cover the join-URL message builders.
 *
 * The URL must stay the canonical `/app/join/:token` web link from
 * {@link getInviteLinkUrl}. Do not put tokens, emails, or names into analytics.
 */

/** Matches Add people → "Invite to SharedMoney". */
export const INVITE_LINK_MAX_USES = 10;
export const INVITE_LINK_VALID_DAYS = 30;

export function buildInviteShareMessage(url: string, groupName?: string): string {
  const trimmedName = groupName?.trim();
  if (trimmedName) {
    return `I started '${trimmedName}' on SharedMoney to track who paid and who owes. No bank link needed. Join here: ${url}`;
  }
  return `I started a SharedMoney group for us to track who paid and who owes. No bank link needed. Join here: ${url}`;
}

export function buildInviteShareTitle(groupName?: string): string {
  const trimmedName = groupName?.trim();
  if (trimmedName) {
    return `I started '${trimmedName}' on SharedMoney`;
  }
  return "I started a SharedMoney group";
}
