/** Snapshot once per group mount. Undefined means unknown, not zero/false. */
export function predictGroupDashboardReservation({
  activeMemberCount,
  unifyEnabled,
}: {
  activeMemberCount?: number;
  unifyEnabled?: boolean;
}) {
  const mayHaveMultipleMembers = activeMemberCount === undefined || activeMemberCount > 1;
  return {
    currencyHeader: mayHaveMultipleMembers && unifyEnabled !== false,
    settlement: mayHaveMultipleMembers,
  };
}
