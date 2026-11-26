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

export const LIST_MY_VISIBLE_GROUPS_RPC = "list_my_visible_groups";

export interface GroupsListRoundTrips {
  /** One SECURITY INVOKER RPC: memberships + groups + mutes + activity + names. */
  listRpc: 1;
}

export const GROUPS_LIST_SEQUENTIAL_DB_ROUND_TRIPS: GroupsListRoundTrips = {
  listRpc: 1,
};

export const GROUPS_LIST_SEQUENTIAL_DB_ROUND_TRIPS_BEFORE = {
  memberships: 1,
  parallelListBatch: 1,
  recencyNames: 1,
} as const;

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

export interface ListedGroupRpcRow {
  id: string;
  name: string;
  description?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  kind?: string | null;
  settlement_currency?: string | null;
  unify_balances?: boolean;
  default_split_mode?: string;
  default_split_weights?: Record<string, number>;
  balance_nudge_cadence?: string;
  user_status?: string | null;
  archived_at?: string | null;
  hidden_at?: string | null;
  balance_nudge_muted?: boolean;
  activity_row?: HistoryActivityRow | null;
  activity_names?: Record<string, string | null> | null;
}

function namesMap(raw: Record<string, string | null> | null | undefined): Map<string, string | null> {
  const names = new Map<string, string | null>();
  if (!raw) return names;
  for (const [id, name] of Object.entries(raw)) {
    names.set(id, name ?? null);
  }
  return names;
}

export function groupsFromListRpcRows(
  rows: ListedGroupRpcRow[],
  viewerId: string,
): Array<Record<string, unknown>> {
  const membershipByGroupId = new Map<string, GroupMembershipRow>();
  const groups: Array<Record<string, unknown> & { id: string }> = [];
  const muted: string[] = [];

  for (const row of rows) {
    membershipByGroupId.set(row.id, {
      group_id: row.id,
      status: row.user_status,
      archived_at: row.archived_at ?? null,
      hidden_at: null,
    });
    if (row.balance_nudge_muted) muted.push(row.id);
    const history = row.activity_row ?? null;
    const lastActivity = history
      ? (lastActivityByGroup([history], namesMap(row.activity_names), viewerId).get(row.id) ?? null)
      : null;
    groups.push({
      id: row.id,
      name: row.name,
      description: row.description,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      kind: row.kind,
      settlement_currency: row.settlement_currency,
      unify_balances: row.unify_balances,
      default_split_mode: row.default_split_mode,
      default_split_weights: row.default_split_weights,
      balance_nudge_cadence: row.balance_nudge_cadence,
      last_activity: lastActivity,
    });
  }

  const flattened = flattenListedGroups(groups, membershipByGroupId);
  return applyBalanceNudgeMutes(
    flattened as Array<Record<string, unknown> & { id: string }>,
    muted,
  );
}

export async function attachBalanceNudgeMutes<T extends { id: string }>(
  supabase: { from: (table: string) => any },
  groups: T[],
  userId: string,
): Promise<Array<T & { balance_nudge_muted: boolean }>> {
  if (groups.length === 0) return [];
  const { data, error } = await supabase
    .from("group_balance_nudge_mutes")
    .select("group_id")
    .eq("user_id", userId)
    .in("group_id", groups.map((group) => group.id));
  if (error) throw error;
  return applyBalanceNudgeMutes(
    groups,
    (data || []).map((row: { group_id: string }) => row.group_id),
  );
}

/**
 * Groups list: one RPC (memberships + groups + mutes + latest activity + names).
 */
export async function loadGroupsList(
  supabase: {
    rpc: (
      fn: string,
      args: { p_include_direct: boolean },
    ) => PromiseLike<{ data: ListedGroupRpcRow[] | null; error: unknown }>;
  },
  userId: string,
  includeDirect: boolean,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase.rpc(LIST_MY_VISIBLE_GROUPS_RPC, {
    p_include_direct: includeDirect,
  });
  if (error) throw error;
  return groupsFromListRpcRows((data || []) as ListedGroupRpcRow[], userId);
}

/**
 * Pre-RPC path kept for equality tests against the same fixtures.
 */
export async function loadGroupsListFromTables(
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
