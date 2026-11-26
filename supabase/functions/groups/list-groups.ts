import {
  collectActivityNameIds,
  fetchLatestHistoryRows,
  lastActivityByGroup,
  type HistoryActivityRow,
} from '../_shared/groupLastActivity.ts';
import { log } from '../_shared/logger.ts';
import { fetchUserProfiles } from '../_shared/user-profiles.ts';
import { isValidUUID } from '../_shared/validation.ts';

export const GROUPS_LIST_COLUMNS =
  'id, name, description, created_by, created_at, updated_at, kind, settlement_currency, unify_balances, default_split_mode, default_split_weights, balance_nudge_cadence';

export interface GroupMembershipRow {
  group_id: string;
  status?: string | null;
  archived_at?: string | null;
  hidden_at?: string | null;
}

export interface GroupsListRoundTrips {
  /** Sequential memberships read before the parallel batch. */
  memberships: 1;
  /** groups + mutes + latest activity in one Promise.all. */
  parallelListBatch: 1;
  /** profiles + participants for recency names, after activity rows exist. */
  recencyNames: 1;
}

export const GROUPS_LIST_SEQUENTIAL_DB_ROUND_TRIPS: GroupsListRoundTrips = {
  memberships: 1,
  parallelListBatch: 1,
  recencyNames: 1,
};

export function visibleMemberships(rows: GroupMembershipRow[]): GroupMembershipRow[] {
  return rows.filter((row) => !row.hidden_at);
}

export function applyBalanceNudgeMutes<T extends { id: string }>(
  groups: T[],
  mutedGroupIds: Iterable<string>,
): Array<T & { balance_nudge_muted: boolean }> {
  const muted = new Set(mutedGroupIds);
  return groups.map((group) => ({
    ...group,
    balance_nudge_muted: muted.has(group.id),
  }));
}

export function flattenListedGroups(
  groups: Array<Record<string, unknown>>,
  membershipByGroupId: Map<string, GroupMembershipRow>,
): Array<Record<string, unknown>> {
  const flattened = groups.map((group) => {
    const membership = typeof group.id === 'string'
      ? membershipByGroupId.get(group.id)
      : undefined;
    return {
      ...group,
      user_status: membership?.status || 'active',
      archived_at: membership?.archived_at ?? null,
      hidden_at: null,
    };
  });

  flattened.sort((a, b) => {
    const rank = (group: Record<string, unknown>) => {
      if (group.user_status === 'left') return 2;
      if (group.archived_at) return 1;
      return 0;
    };
    return rank(a) - rank(b);
  });
  return flattened;
}

export async function attachGroupLastActivity(
  supabase: any,
  groups: Array<Record<string, unknown>>,
  viewerId: string,
  preloadedRows?: HistoryActivityRow[],
): Promise<Array<Record<string, unknown>>> {
  const ids = groups
    .map((group) => group.id)
    .filter((id): id is string => typeof id === 'string' && isValidUUID(id));
  if (ids.length === 0) {
    return groups.map((group) => ({ ...group, last_activity: null }));
  }

  let rows: HistoryActivityRow[];
  try {
    rows = preloadedRows ?? await fetchLatestHistoryRows(supabase, ids);
  } catch (error) {
    log.error('latest group activity failed', 'groups', {
      error: error instanceof Error ? error.message : String(error),
    });
    return groups;
  }

  const { userIds, participantIds } = collectActivityNameIds(rows);
  const names = new Map<string, string | null>();
  const [profiles, participantsResult] = await Promise.all([
    fetchUserProfiles(supabase, userIds),
    participantIds.length > 0
      ? supabase.from('participants').select('id, full_name').in('id', participantIds)
      : Promise.resolve({ data: [] }),
  ]);
  for (const [id, profile] of profiles) {
    names.set(id, profile.full_name);
  }
  for (const person of participantsResult.data || []) {
    if (person?.id && !names.has(person.id)) {
      names.set(person.id, person.full_name ?? null);
    }
  }

  const byGroup = lastActivityByGroup(rows, names, viewerId);
  return groups.map((group) => ({
    ...group,
    last_activity: typeof group.id === 'string' ? (byGroup.get(group.id) ?? null) : null,
  }));
}

/**
 * Groups list: memberships, then groups + mutes + latest activity together.
 */
export async function loadGroupsList(
  supabase: any,
  userId: string,
  includeDirect: boolean,
): Promise<Array<Record<string, unknown>>> {
  const { data: membershipRows, error: membershipError } = await supabase
    .from('group_members')
    .select('group_id, status, archived_at, hidden_at')
    .eq('user_id', userId);
  if (membershipError) throw membershipError;

  const memberships = visibleMemberships((membershipRows || []) as GroupMembershipRow[]);
  const groupIds = memberships
    .map((row) => row.group_id)
    .filter((id): id is string => typeof id === 'string' && isValidUUID(id));
  if (groupIds.length === 0) return [];

  const membershipByGroupId = new Map(memberships.map((row) => [row.group_id, row]));

  let groupsQuery = supabase
    .from('groups')
    .select(GROUPS_LIST_COLUMNS)
    .in('id', groupIds)
    .order('created_at', { ascending: false });
  if (!includeDirect) {
    groupsQuery = groupsQuery.neq('kind', 'direct');
  }

  const mutesQuery = supabase
    .from('group_balance_nudge_mutes')
    .select('group_id')
    .eq('user_id', userId)
    .in('group_id', groupIds);

  const [groupsResult, mutesResult, activitySettled] = await Promise.all([
    groupsQuery,
    mutesQuery,
    fetchLatestHistoryRows(supabase, groupIds).then(
      (rows) => ({ ok: true as const, rows }),
      (error) => {
        log.error('latest group activity failed', 'groups', {
          error: error instanceof Error ? error.message : String(error),
        });
        return { ok: false as const };
      },
    ),
  ]);

  if (groupsResult.error) throw groupsResult.error;
  if (mutesResult.error) throw mutesResult.error;

  const flattened = flattenListedGroups(
    (groupsResult.data || []) as Array<Record<string, unknown>>,
    membershipByGroupId,
  );
  const withMutes = applyBalanceNudgeMutes(
    flattened as Array<Record<string, unknown> & { id: string }>,
    (mutesResult.data || []).map((row: { group_id: string }) => row.group_id),
  );
  if (!activitySettled.ok) {
    return withMutes;
  }
  return await attachGroupLastActivity(supabase, withMutes, userId, activitySettled.rows);
}
