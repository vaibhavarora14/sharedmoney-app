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
  user_id?: string | null;
  type?: string | null;
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
