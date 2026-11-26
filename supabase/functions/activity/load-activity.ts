import { generateActivityDescription } from "../_shared/activityDescriptions.ts";
import { fetchUserEmails } from "../_shared/user-email.ts";
import { fetchUserProfiles } from "../_shared/user-profiles.ts";
import { isValidUUID } from "../_shared/validation.ts";
import { activityPageMeta } from "./page-meta.ts";

export const GET_GROUP_ACTIVITY_PAGE_RPC = "get_group_activity_page";

/** After JWT verify: one RPC (membership + blocked + page + count + people). */
export const ACTIVITY_SEQUENTIAL_DB_ROUND_TRIPS = {
  activityPageRpc: 1,
} as const;

export const ACTIVITY_SEQUENTIAL_DB_ROUND_TRIPS_BEFORE = {
  membershipAndBlocked: 1,
  historyAndCount: 1,
  participants: 1,
  emailsAndProfiles: 1,
} as const;

export interface TransactionSnapshot {
  id: number;
  amount: number;
  description: string;
  date: string;
  type: string;
  category?: string;
  currency: string;
  user_id: string;
  group_id: string;
  paid_by: string;
  split_among?: string[];
  created_at: string;
  updated_at?: string;
}

export interface SettlementSnapshot {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  currency: string;
  notes?: string;
  created_by: string;
  created_at: string;
}

interface ChangesDiff {
  [field: string]: {
    old: unknown;
    new: unknown;
  };
}

interface HistoryChanges {
  action: "created" | "updated" | "deleted";
  diff?: ChangesDiff;
  transaction?: TransactionSnapshot;
  settlement?: SettlementSnapshot;
  transaction_id?: number;
  settlement_id?: string;
}

interface HistorySnapshot {
  transaction?: TransactionSnapshot;
  settlement?: SettlementSnapshot;
}

export interface TransactionHistory {
  id: string;
  transaction_id: number | null;
  settlement_id: string | null;
  activity_type: "transaction" | "settlement";
  group_id: string;
  action: "created" | "updated" | "deleted";
  changed_by: string;
  changed_at: string;
  changes: HistoryChanges;
  snapshot: HistorySnapshot | null;
}

interface ActivityItemDetails {
  action: "created" | "updated" | "deleted";
  changes?: ChangesDiff;
  transaction?: TransactionSnapshot;
  settlement?: SettlementSnapshot;
}

export interface ActivityItem {
  id: string;
  type:
    | "transaction_created"
    | "transaction_updated"
    | "transaction_deleted"
    | "settlement_created"
    | "settlement_updated"
    | "settlement_deleted";
  transaction_id?: number;
  settlement_id?: string;
  group_id: string;
  changed_by: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
  changed_at: string;
  description: string;
  details: ActivityItemDetails;
}

export interface Participant {
  id: string;
  group_id: string;
  user_id?: string | null;
  email?: string | null;
  type: "member" | "invited" | "former";
  role?: "owner" | "member";
  full_name?: string | null;
  avatar_url?: string | null;
}

export interface ActivityFeedEnvelope {
  activities: ActivityItem[];
  total: number;
  has_more: boolean;
}

export type LoadActivityResult =
  | { kind: "ok"; body: ActivityFeedEnvelope }
  | { kind: "forbidden" }
  | { kind: "error"; error: unknown; context: string };

type ProfileRow = { id: string; full_name: string | null; avatar_url: string | null };
type EmailRow = { id: string; email: string | null };

export interface ActivityPageRpcRow {
  is_member: boolean;
  total: number;
  history: TransactionHistory[] | string;
  participants: Participant[] | string;
  profiles: ProfileRow[] | string;
  emails: EmailRow[] | string;
}

function firstRpcRow<T>(data: T | T[] | null | undefined): T | null {
  if (data == null) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function asArray<T>(value: T[] | string | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function extractSnapshot(
  history: TransactionHistory,
): { transaction?: TransactionSnapshot; settlement?: SettlementSnapshot } {
  const snapshot = history.snapshot;
  if (!snapshot) {
    return {};
  }

  if (history.activity_type === "settlement") {
    if ((snapshot as { settlement?: SettlementSnapshot }).settlement) {
      return { settlement: (snapshot as { settlement: SettlementSnapshot }).settlement };
    }
    if (
      ("from_user_id" in snapshot && "to_user_id" in snapshot) ||
      ("from_participant_id" in snapshot && "to_participant_id" in snapshot)
    ) {
      return { settlement: snapshot as unknown as SettlementSnapshot };
    }
    return {};
  }

  if ((snapshot as { transaction?: TransactionSnapshot }).transaction) {
    return { transaction: (snapshot as { transaction: TransactionSnapshot }).transaction };
  }

  if ("amount" in snapshot && "currency" in snapshot && "group_id" in snapshot) {
    return { transaction: snapshot as unknown as TransactionSnapshot };
  }

  return {};
}

function collectUserIdsFromHistory(historyRecords: TransactionHistory[]): Set<string> {
  const userIds = new Set<string>();
  historyRecords.forEach((h: TransactionHistory) => {
    userIds.add(h.changed_by);
  });
  return userIds;
}

export function collectParticipantIdsFromHistory(
  historyRecords: TransactionHistory[],
): Set<string> {
  const participantIds = new Set<string>();
  historyRecords.forEach((h: TransactionHistory) => {
    if (h.changes?.diff) {
      const diff = h.changes.diff;
      ["paid_by_participant_id", "paid_by", "from_participant_id", "to_participant_id"].forEach(
        (field) => {
          if (diff[field]) {
            if (diff[field].old) participantIds.add(diff[field].old as string);
            if (diff[field].new) participantIds.add(diff[field].new as string);
          }
        },
      );
      ["split_among_participant_ids", "split_among"].forEach((field) => {
        if (diff[field]) {
          if (Array.isArray(diff[field].old)) {
            diff[field].old.forEach((id: string) => participantIds.add(id));
          }
          if (Array.isArray(diff[field].new)) {
            diff[field].new.forEach((id: string) => participantIds.add(id));
          }
        }
      });
    }

    const extracted = extractSnapshot(h);
    let snapshot: Record<string, unknown> | undefined =
      (extracted.transaction || extracted.settlement) as Record<string, unknown> | undefined;
    if (!snapshot) {
      snapshot = (h.changes?.transaction || h.changes?.settlement) as
        | Record<string, unknown>
        | undefined;
    }
    if (!snapshot) return;
    if (snapshot.paid_by_participant_id) {
      participantIds.add(snapshot.paid_by_participant_id as string);
    }
    if (snapshot.paid_by) participantIds.add(snapshot.paid_by as string);
    if (Array.isArray(snapshot.split_among_participant_ids)) {
      snapshot.split_among_participant_ids.forEach((id: string) => participantIds.add(id));
    }
    if (Array.isArray(snapshot.split_among)) {
      snapshot.split_among.forEach((id: string) => participantIds.add(id));
    }
    if (snapshot.from_participant_id) {
      participantIds.add(snapshot.from_participant_id as string);
    }
    if (snapshot.to_participant_id) participantIds.add(snapshot.to_participant_id as string);
    if (snapshot.from_user_id) participantIds.add(snapshot.from_user_id as string);
    if (snapshot.to_user_id) participantIds.add(snapshot.to_user_id as string);
  });
  return participantIds;
}

export function mapsFromActivityLookups(input: {
  emails: EmailRow[];
  profiles: ProfileRow[];
  participants: Participant[];
  currentUserId: string;
  currentUserEmail: string | null;
}): {
  emailMap: Map<string, string>;
  profileMap: Map<string, { full_name: string | null; avatar_url: string | null }>;
  participantMap: Map<string, Participant>;
} {
  const emailMap = new Map<string, string>();
  const profileMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  const participantMap = new Map<string, Participant>();

  for (const row of input.emails) {
    if (row?.id && row.email) emailMap.set(row.id, row.email);
  }
  if (input.currentUserEmail) {
    emailMap.set(input.currentUserId, input.currentUserEmail);
  }
  for (const profile of input.profiles) {
    if (!profile?.id) continue;
    profileMap.set(profile.id, {
      full_name: profile.full_name ?? null,
      avatar_url: profile.avatar_url ?? null,
    });
  }
  for (const participant of input.participants) {
    participantMap.set(participant.id, { ...participant });
  }
  participantMap.forEach((participant) => {
    if (!participant.user_id) return;
    const profile = profileMap.get(participant.user_id);
    if (profile) {
      if (!participant.full_name && profile.full_name) {
        participant.full_name = profile.full_name;
      }
      if (!participant.avatar_url && profile.avatar_url) {
        participant.avatar_url = profile.avatar_url;
      }
    }
    if (!participant.email) {
      const email = emailMap.get(participant.user_id);
      if (email) participant.email = email;
    }
  });
  return { emailMap, profileMap, participantMap };
}

export function transformHistoryToActivity(
  history: TransactionHistory,
  emailMap: Map<string, string>,
  profileMap: Map<string, { full_name: string | null; avatar_url: string | null }>,
  participantMap: Map<string, Participant>,
): ActivityItem {
  const activityType = history.activity_type || "transaction";
  const action = history.action;

  const typeMap: Record<string, ActivityItem["type"]> = {
    created: activityType === "settlement" ? "settlement_created" : "transaction_created",
    updated: activityType === "settlement" ? "settlement_updated" : "transaction_updated",
    deleted: activityType === "settlement" ? "settlement_deleted" : "transaction_deleted",
  };

  const details: ActivityItemDetails = {
    action: action,
  };

  if (action === "updated" && history.changes?.diff) {
    details.changes = history.changes.diff;
  }

  const snapshot = extractSnapshot(history);

  if (activityType === "settlement") {
    if (snapshot.settlement) {
      details.settlement = snapshot.settlement;
    } else if (history.changes?.settlement) {
      details.settlement = history.changes.settlement;
    }
  } else if (snapshot.transaction) {
    details.transaction = snapshot.transaction;
  } else if (history.changes?.transaction) {
    details.transaction = history.changes.transaction;
  }

  return {
    id: history.id,
    type: typeMap[action] || "transaction_updated",
    transaction_id: history.transaction_id || undefined,
    settlement_id: history.settlement_id || undefined,
    group_id: history.group_id,
    changed_by: {
      id: history.changed_by,
      email: emailMap.get(history.changed_by) || "Unknown User",
      full_name: profileMap.get(history.changed_by)?.full_name || null,
      avatar_url: profileMap.get(history.changed_by)?.avatar_url || null,
    },
    changed_at: history.changed_at,
    description: generateActivityDescription(history, emailMap, participantMap),
    details,
  };
}

export function assembleActivityFeed(input: {
  history: TransactionHistory[];
  emails: EmailRow[];
  profiles: ProfileRow[];
  participants: Participant[];
  currentUserId: string;
  currentUserEmail: string | null;
  offset: number;
  limit: number;
  total: number | null;
  countError: boolean;
}): ActivityFeedEnvelope {
  const { emailMap, profileMap, participantMap } = mapsFromActivityLookups(input);
  const activities = input.history.map((row) =>
    transformHistoryToActivity(row, emailMap, profileMap, participantMap)
  );
  return {
    activities,
    ...activityPageMeta({
      offset: input.offset,
      limit: input.limit,
      pageLength: activities.length,
      count: input.total,
      countError: input.countError,
    }),
  };
}

export async function loadActivityFeedFromTables(
  supabase: {
    from: (table: string) => any;
  },
  user: { id: string; email: string | null },
  groupId: string,
  limit: number,
  offset: number,
  fetchEmails: typeof fetchUserEmails = fetchUserEmails,
): Promise<LoadActivityResult> {
  const [membershipResult, blockedResult] = await Promise.all([
    supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single(),
    supabase
      .from("user_blocks")
      .select("blocked_user_id")
      .eq("blocker_id", user.id),
  ]);

  if (membershipResult.error || !membershipResult.data) {
    return { kind: "forbidden" };
  }
  if (blockedResult.error) {
    return { kind: "error", error: blockedResult.error, context: "fetching blocked users" };
  }

  const blockedUserIds = new Set<string>(
    (blockedResult.data || []).map((row: { blocked_user_id: string }) => row.blocked_user_id),
  );

  let historyQuery = supabase
    .from("transaction_history")
    .select(
      "id, transaction_id, settlement_id, activity_type, group_id, action, changed_by, changed_at, changes, snapshot",
    )
    .eq("group_id", groupId)
    .order("changed_at", { ascending: false });

  let countQuery = supabase
    .from("transaction_history")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);

  if (blockedUserIds.size > 0) {
    const blockedFilter = `(${Array.from(blockedUserIds).join(",")})`;
    historyQuery = historyQuery.not("changed_by", "in", blockedFilter);
    countQuery = countQuery.not("changed_by", "in", blockedFilter);
  }

  const [historyResult, countResult] = await Promise.all([
    historyQuery.range(offset, offset + limit - 1),
    countQuery,
  ]);

  if (historyResult.error) {
    return { kind: "error", error: historyResult.error, context: "fetching transaction history" };
  }

  const historyRecords = ((historyResult.data || []) as TransactionHistory[]).filter(
    (row) => !blockedUserIds.has(row.changed_by),
  );

  const participantIds = collectParticipantIdsFromHistory(historyRecords);
  let participants: Participant[] = [];
  if (participantIds.size > 0) {
    const { data } = await supabase
      .from("participants")
      .select("*")
      .in("id", Array.from(participantIds).filter(isValidUUID));
    participants = (data || []) as Participant[];
  }

  const userIds = collectUserIdsFromHistory(historyRecords);
  for (const participant of participants) {
    if (participant.user_id) userIds.add(participant.user_id);
  }
  const userIdsArray = Array.from(userIds);
  const [emailMap, profileMap] = await Promise.all([
    fetchEmails(userIdsArray, user.id, user.email),
    fetchUserProfiles(supabase, userIdsArray),
  ]);

  return {
    kind: "ok",
    body: assembleActivityFeed({
      history: historyRecords,
      emails: [...emailMap.entries()].map(([id, email]) => ({ id, email })),
      profiles: [...profileMap.entries()].map(([id, profile]) => ({ id, ...profile })),
      participants,
      currentUserId: user.id,
      currentUserEmail: user.email,
      offset,
      limit,
      total: countResult.error ? null : (countResult.count ?? 0),
      countError: Boolean(countResult.error),
    }),
  };
}

export async function loadActivityFeed(
  supabase: {
    rpc: (
      fn: string,
      args: { p_group_id: string; p_limit: number; p_offset: number },
    ) => PromiseLike<{ data: ActivityPageRpcRow | ActivityPageRpcRow[] | null; error: unknown }>;
  },
  user: { id: string; email: string | null },
  groupId: string,
  limit: number,
  offset: number,
): Promise<LoadActivityResult> {
  const { data, error } = await supabase.rpc(GET_GROUP_ACTIVITY_PAGE_RPC, {
    p_group_id: groupId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    return { kind: "error", error, context: "fetching transaction history" };
  }
  const page = firstRpcRow(data);
  if (!page) {
    return { kind: "forbidden" };
  }
  if (!page.is_member) {
    return { kind: "forbidden" };
  }

  return {
    kind: "ok",
    body: assembleActivityFeed({
      history: asArray<TransactionHistory>(page.history),
      emails: asArray<EmailRow>(page.emails),
      profiles: asArray<ProfileRow>(page.profiles),
      participants: asArray<Participant>(page.participants),
      currentUserId: user.id,
      currentUserEmail: user.email,
      offset,
      limit,
      total: typeof page.total === "number" ? page.total : Number(page.total ?? 0),
      countError: false,
    }),
  };
}
