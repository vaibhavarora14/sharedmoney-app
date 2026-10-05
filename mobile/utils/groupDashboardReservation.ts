/** Shared by the loading snapshot and live content. Undefined reserves unknown data. */
export function resolveGroupDashboardSlots({
  activeMemberCount,
  unifyEnabled,
  balanceError = false,
}: {
  activeMemberCount?: number;
  unifyEnabled?: boolean;
  balanceError?: boolean;
}) {
  const mayHaveMultipleMembers = activeMemberCount === undefined || activeMemberCount > 1;
  return {
    currencyHeader: !balanceError && mayHaveMultipleMembers && unifyEnabled !== false,
    settlement: balanceError || mayHaveMultipleMembers,
  };
}
