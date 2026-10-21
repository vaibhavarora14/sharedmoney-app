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

/** Muted inline suffix after the typed name. Null = no suffix. */
export function settlementPresenceSuffix(
  presence: SettlementPresence,
): string | null {
  switch (presence) {
    case "invited":
      return "invited";
    case "no_account":
      return "not on SharedMoney";
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
 * Modal header is tight ("X paid you"). Only append the presence suffix when
 * the typed name is short enough that the cluster still reads cleanly.
 */
export function shouldShowSettleModalPresenceSuffix(displayName: string): boolean {
  return displayName.trim().length > 0 && displayName.trim().length <= 14;
}

/**
 * Format `Name · suffix` for tests / a11y. UI prefers separate Text nodes so the
 * name can ellipsize while the suffix stays visible.
 */
export function formatSettlementNameWithSuffix(
  displayName: string,
  suffix: string | null,
  maxNameChars = 18,
): string {
  const name = displayName.trim() || "Someone";
  if (!suffix) return name;
  const truncated =
    name.length > maxNameChars
      ? `${name.slice(0, Math.max(1, maxNameChars - 1)).trimEnd()}…`
      : name;
  return `${truncated} · ${suffix}`;
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
