/** Shared by the loading snapshot and live content. Undefined reserves unknown data. */
export function resolveGroupDashboardSlots({
  activeMemberCount,
  unifyEnabled,
  balanceError = false,
  hasNonZeroBalance = false,
}: {
  /**
   * Prefer non-former participant count (incl. people without accounts and
   * pending invites). Undefined = unknown → reserve settle chrome.
   */
  activeMemberCount?: number;
  unifyEnabled?: boolean;
  balanceError?: boolean;
  /** Viewer has any non-zero balance in this group (incl. vs former members). */
  hasNonZeroBalance?: boolean;
}) {
  // Solo (just the viewer) stays calm unless a balance or error needs the slot.
  const mayHaveMultipleMembers =
    activeMemberCount === undefined
    || activeMemberCount > 1
    || hasNonZeroBalance;
  return {
    currencyHeader: !balanceError && mayHaveMultipleMembers && unifyEnabled !== false,
    settlement: balanceError || mayHaveMultipleMembers,
  };
}
