import { settleModalPersonName } from "./settleShareMessage";

/**
 * Presence of a settle counterparty relative to SharedMoney accounts / invites.
 * Drives row suffixes and remind-copy branches — not payment confirmation state.
 */
export type SettlementPresence =
  | "app_member"
  | "invited"
  | "no_account"
  | "former";

export type SettlementPresencePerson = {
  id?: string;
  user_id?: string | null;
  type?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type SettlementBalancePerson = {
  participant_id?: string | null;
  user_id?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

function hasUserId(userId?: string | null): boolean {
  return typeof userId === "string" && userId.trim().length > 0;
}

/**
 * Classify a participant for settle chrome.
 * Pending invite (`type === "invited"`) wins over account linkage.
 * Former wins over everything else for styling.
 */
export function resolveSettlementPresence(
  person: SettlementPresencePerson | null | undefined,
): SettlementPresence {
  if (!person) return "no_account";
  if (person.type === "former") return "former";
  if (person.type === "invited") return "invited";
  if (!hasUserId(person.user_id)) return "no_account";
  return "app_member";
}

/**
 * Secondary caption under the settle owe line (no-account / pending invite only).
 * Null for app members and former — those stay one line.
 */
export function settlementPresenceCaption(
  presence: SettlementPresence,
): string | null {
  switch (presence) {
    case "invited":
      return "Invited";
    case "no_account":
      return "Not on SharedMoney";
    case "app_member":
    case "former":
      return null;
    default: {
      const _exhaustive: never = presence;
      return _exhaustive;
    }
  }
}

/**
 * @deprecated Inline `·` suffixes were removed; use {@link settlementPresenceCaption}.
 */
export function settlementPresenceSuffix(
  presence: SettlementPresence,
): string | null {
  return settlementPresenceCaption(presence);
}

/** Remind / share audience: app members keep group-link copy; others do not. */
export function settleRemindAudienceFromPresence(
  presence: SettlementPresence,
): "app_member" | "off_app" {
  return presence === "app_member" ? "app_member" : "off_app";
}

/** Match a balance row to its participant (participant_id first, then user_id). */
export function findParticipantForBalance<T extends SettlementPresencePerson>(
  balance: SettlementBalancePerson,
  participants: T[] | null | undefined,
): T | undefined {
  if (!participants?.length) return undefined;
  if (balance.participant_id) {
    const byId = participants.find((person) => person.id === balance.participant_id);
    if (byId) return byId;
  }
  if (balance.user_id) {
    return participants.find((person) => person.user_id === balance.user_id);
  }
  return undefined;
}

/**
 * Creator-typed display name for a settle counterparty.
 * Prefers the participants list (source of truth for people without accounts),
 * then the balance enrichment. Never returns a raw email or phone.
 */
export function settlementCounterpartyDisplayName(
  balance: SettlementBalancePerson,
  participants?: SettlementPresencePerson[] | null,
): string {
  const match = findParticipantForBalance(balance, participants);
  return settleModalPersonName({
    full_name: match?.full_name || balance.full_name,
    email: match?.email || balance.email,
    phone: match?.phone || balance.phone,
  });
}

/** First-token label for settle rows (typed name → local-part → Someone). */
export function settlementCounterpartyShortName(
  balance: SettlementBalancePerson,
  participants?: SettlementPresencePerson[] | null,
): string {
  const display = settlementCounterpartyDisplayName(balance, participants);
  return display.split(/\s+/)[0] || display;
}
