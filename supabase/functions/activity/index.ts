import { generateActivityDescription } from '../_shared/activityDescriptions.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { ACTIVITY_FEED_CONFIG } from '../_shared/constants.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { log } from '../_shared/logger.ts';
import { filterBlockedActivityRecords } from '../_shared/moderation.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { fetchUserEmails } from '../_shared/user-email.ts';
import { fetchUserProfiles } from '../_shared/user-profiles.ts';
import { isValidUUID } from '../_shared/validation.ts';
import { activityPageMeta } from './page-meta.ts';

/**
 * Activity Edge Function
 * 
 * Returns activity feed for a group showing transaction and settlement history:
 * - GET /activity?group_id=xxx&limit=50&offset=0 - Get activity feed with pagination
 * 
 * Activity items include created/updated/deleted transactions and settlements.
 * 
 * @route /functions/v1/activity
 * @requires Authentication
 */

interface TransactionSnapshot {
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

interface SettlementSnapshot {
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
  action: 'created' | 'updated' | 'deleted';
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

interface TransactionHistory {
  id: string;
  transaction_id: number | null;
  settlement_id: string | null;
  activity_type: 'transaction' | 'settlement';
  group_id: string;
  action: 'created' | 'updated' | 'deleted';
  changed_by: string;
  changed_at: string;
  changes: HistoryChanges;
  snapshot: HistorySnapshot | null;
}

interface ActivityItemDetails {
  action: 'created' | 'updated' | 'deleted';
  changes?: ChangesDiff;
  transaction?: TransactionSnapshot;
  settlement?: SettlementSnapshot;
}

interface ActivityItem {
  id: string;
  type: 'transaction_created' | 'transaction_updated' | 'transaction_deleted' | 'settlement_created' | 'settlement_updated' | 'settlement_deleted';
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

// Email fetching now handled by shared utility

function collectUserIdsFromHistory(historyRecords: TransactionHistory[]): Set<string> {
  const userIds = new Set<string>();
  
  historyRecords.forEach((h: TransactionHistory) => {
    userIds.add(h.changed_by);
  });
  
  return userIds;
}

interface Participant {
  id: string;
  group_id: string;
  user_id?: string | null;
  email?: string | null;
  type: 'member' | 'invited' | 'former';
  role?: 'owner' | 'member';
  full_name?: string | null;
  avatar_url?: string | null;
}

async function buildParticipantMapForHistory(
  supabase: any, // Use 'any' for SupabaseClient to avoid import issues if not explicitly defined
  historyRecords: TransactionHistory[]
): Promise<Map<string, Participant>> {
  const participantIds = new Set<string>();
  const userIds = new Set<string>();
  
  historyRecords.forEach((h: TransactionHistory) => {
    userIds.add(h.changed_by);
    
    // Collect from diffs
    if (h.changes?.diff) {
      const diff = h.changes.diff;
      ['paid_by_participant_id', 'paid_by'].forEach(field => {
        if (diff[field]) {
          if (diff[field].old) participantIds.add(diff[field].old as string);
          if (diff[field].new) participantIds.add(diff[field].new as string);
        }
      });
      ['split_among_participant_ids', 'split_among'].forEach(field => {
        if (diff[field]) {
          if (Array.isArray(diff[field].old)) diff[field].old.forEach((id: string) => participantIds.add(id));
          if (Array.isArray(diff[field].new)) diff[field].new.forEach((id: string) => participantIds.add(id));
        }
      });
      // Settlements
      ['from_participant_id', 'to_participant_id', 'from_user_id', 'to_user_id'].forEach(field => {
        if (diff[field]) {
          if (diff[field].old) participantIds.add(diff[field].old as string);
          if (diff[field].new) participantIds.add(diff[field].new as string);
        }
      });
    }
    
    
    // Collect from snapshots
    const extracted = extractSnapshot(h);
    let s: any = extracted.transaction || extracted.settlement;
    
    if (!s) {
       s = h.changes?.transaction || h.changes?.settlement;
    }

    if (s) {
      if (s.paid_by_participant_id) participantIds.add(s.paid_by_participant_id);
      if (s.paid_by) participantIds.add(s.paid_by);
      if (Array.isArray(s.split_among_participant_ids)) s.split_among_participant_ids.forEach((id: string) => participantIds.add(id));
      if (Array.isArray(s.split_among)) s.split_among.forEach((id: string) => participantIds.add(id));
      if (s.from_participant_id) participantIds.add(s.from_participant_id);
      if (s.to_participant_id) participantIds.add(s.to_participant_id);
      if (s.from_user_id) participantIds.add(s.from_user_id);
      if (s.to_user_id) participantIds.add(s.to_user_id);
    }
  });

  const participantMap = new Map<string, Participant>();
  if (participantIds.size === 0) return participantMap;

  // Resolve participant IDs (could be participant_id or user_id in legacy)
  const { data: participants } = await supabase
    .from('participants')
    .select('*')
    .or(`id.in.(${Array.from(participantIds).filter(isValidUUID).join(',') || '00000000-0000-0000-0000-000000000000'}),user_id.in.(${Array.from(participantIds).filter(isValidUUID).join(',') || '00000000-0000-0000-0000-000000000000'})`);

  if (participants) {
    participants.forEach((p: Participant) => {
      participantMap.set(p.id, p);
      if (p.user_id) participantMap.set(p.user_id, p); // Map user_id to participant as well for easier lookup
    });
  }

  return participantMap;
}

async function buildEmailMapForHistory(
  historyRecords: TransactionHistory[],
  currentUserId: string,
  currentUserEmail: string | null,
  supabase: any,
  groupId: string
): Promise<{ 
  emailMap: Map<string, string>; 
  profileMap: Map<string, { full_name: string | null; avatar_url: string | null }>;
  participantMap: Map<string, Participant>;
}> {
  const emailMap = new Map<string, string>();
  const profileMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  const participantMap = new Map<string, Participant>();
  
  if (historyRecords.length === 0) {
    return { emailMap, profileMap, participantMap };
  }

  const userIds = collectUserIdsFromHistory(historyRecords);
  const participantIds = new Set<string>();

  historyRecords.forEach((h: TransactionHistory) => {
    // Collect from diffs
    if (h.changes?.diff) {
      const diff = h.changes.diff;
      ['paid_by_participant_id', 'paid_by', 'from_participant_id', 'to_participant_id'].forEach(field => {
        if (diff[field]) {
          if (diff[field].old) participantIds.add(diff[field].old as string);
          if (diff[field].new) participantIds.add(diff[field].new as string);
        }
      });
      ['split_among_participant_ids', 'split_among'].forEach(field => {
        if (diff[field]) {
          if (Array.isArray(diff[field].old)) diff[field].old.forEach((id: string) => participantIds.add(id));
          if (Array.isArray(diff[field].new)) diff[field].new.forEach((id: string) => participantIds.add(id));
        }
      });
    }
    
    
    // Collect from snapshots
    const extracted = extractSnapshot(h);
    let s: any = extracted.transaction || extracted.settlement;
    
    if (!s) {
       s = h.changes?.transaction || h.changes?.settlement;
    }

    if (s) {
      if (s.paid_by_participant_id) participantIds.add(s.paid_by_participant_id);
      if (s.paid_by) participantIds.add(s.paid_by);
      if (Array.isArray(s.split_among_participant_ids)) s.split_among_participant_ids.forEach((id: string) => participantIds.add(id));
      if (Array.isArray(s.split_among)) s.split_among.forEach((id: string) => participantIds.add(id));
      if (s.from_participant_id) participantIds.add(s.from_participant_id);
      if (s.to_participant_id) participantIds.add(s.to_participant_id);
      if (s.from_user_id) participantIds.add(s.from_user_id);
      if (s.to_user_id) participantIds.add(s.to_user_id);
    }
  });

  // Resolve participants
  if (participantIds.size > 0) {
    const { data: participants } = await supabase
      .from('participants')
      .select('*')
      .in('id', Array.from(participantIds).filter(isValidUUID));

    if (participants) {
      participants.forEach((p: Participant) => {
        participantMap.set(p.id, p);
        if (p.user_id) userIds.add(p.user_id);
      });
    }
  }

  // Fetch all user details
  const userIdsArray = Array.from(userIds);
  if (userIdsArray.length > 0) {
    const [fetchedEmailMap, fetchedProfileMap] = await Promise.all([
      fetchUserEmails(userIdsArray, currentUserId, currentUserEmail),
      fetchUserProfiles(supabase, userIdsArray),
    ]);

    fetchedEmailMap.forEach((email, userId) => emailMap.set(userId, email));
    fetchedProfileMap.forEach((profile, userId) => profileMap.set(userId, profile));

    // Enrich participant map with profile data if available
    participantMap.forEach((p) => {
      if (p.user_id) {
        // Try profile first
        const profile = profileMap.get(p.user_id);
        if (profile) {
          if (!p.full_name && profile.full_name) p.full_name = profile.full_name;
          if (!p.avatar_url && profile.avatar_url) p.avatar_url = profile.avatar_url;
        }
        // Try email map
        if (!p.email) {
          const email = emailMap.get(p.user_id);
          if (email) p.email = email;
        }
      }
    });
  }
  
  return { emailMap, profileMap, participantMap };
}

function extractSnapshot(
  history: TransactionHistory
): { transaction?: TransactionSnapshot; settlement?: SettlementSnapshot } {
  const snapshot = history.snapshot;
  if (!snapshot) {
    return {};
  }

  if (history.activity_type === 'settlement') {
    if ((snapshot as any).settlement) {
      return { settlement: (snapshot as any).settlement as SettlementSnapshot };
    }
    if (
      ('from_user_id' in snapshot && 'to_user_id' in snapshot) ||
      ('from_participant_id' in snapshot && 'to_participant_id' in snapshot)
    ) {
      return { settlement: snapshot as unknown as SettlementSnapshot };
    }
    return {};
  }

  if ((snapshot as any).transaction) {
    return { transaction: (snapshot as any).transaction as TransactionSnapshot };
  }

  if ('amount' in snapshot && 'currency' in snapshot && 'group_id' in snapshot) {
    return { transaction: snapshot as unknown as TransactionSnapshot };
  }

  return {};
}

function transformHistoryToActivity(
  history: TransactionHistory,
  emailMap: Map<string, string>,
  profileMap: Map<string, { full_name: string | null; avatar_url: string | null }>,
  participantMap: Map<string, Participant>
): ActivityItem {
  const activityType = history.activity_type || 'transaction';
  const action = history.action;
  
  const typeMap: Record<string, ActivityItem['type']> = {
    'created': activityType === 'settlement' ? 'settlement_created' : 'transaction_created',
    'updated': activityType === 'settlement' ? 'settlement_updated' : 'transaction_updated',
    'deleted': activityType === 'settlement' ? 'settlement_deleted' : 'transaction_deleted',
  };

  const details: ActivityItemDetails = {
    action: action,
  };

  if (action === 'updated' && history.changes?.diff) {
    details.changes = history.changes.diff;
  }

  const snapshot = extractSnapshot(history);

  if (activityType === 'settlement') {
    if (snapshot.settlement) {
      details.settlement = snapshot.settlement;
    } else if (history.changes?.settlement) {
      details.settlement = history.changes.settlement;
    }
  } else {
    if (snapshot.transaction) {
      details.transaction = snapshot.transaction;
    } else if (history.changes?.transaction) {
      details.transaction = history.changes.transaction;
    }
  }

  return {
    id: history.id,
    type: typeMap[action] || 'transaction_updated',
    transaction_id: history.transaction_id || undefined,
    settlement_id: history.settlement_id || undefined,
    group_id: history.group_id,
    changed_by: {
      id: history.changed_by,
      email: emailMap.get(history.changed_by) || 'Unknown User',
      full_name: profileMap.get(history.changed_by)?.full_name || null,
      avatar_url: profileMap.get(history.changed_by)?.avatar_url || null,
    },
    changed_at: history.changed_at,
    description: generateActivityDescription(history, emailMap, participantMap),
    details,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return createEmptyResponse(200, req);
  }

  try {
    if (req.method !== 'GET') {
      return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
    }

    let authResult;
    try {
      authResult = await verifyAuth(req);
    } catch (authError) {
      return handleError(authError, 'authentication', req);
    }

    const { user, supabase } = authResult;

    const url = new URL(req.url);
    const groupId = url.searchParams.get('group_id');
    
    if (!groupId) {
      return createErrorResponse(400, 'Missing required parameter: group_id', 'VALIDATION_ERROR', undefined, req);
    }

    if (!isValidUUID(groupId)) {
      return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
    }

    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || String(ACTIVITY_FEED_CONFIG.DEFAULT_LIMIT)),
      ACTIVITY_FEED_CONFIG.MAX_LIMIT
    );
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const [membershipResult, blockedResult] = await Promise.all([
      supabase
        .from('group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single(),
      supabase
        .from('user_blocks')
        .select('blocked_user_id')
        .eq('blocker_id', user.id),
    ]);

    if (membershipResult.error || !membershipResult.data) {
      return createErrorResponse(403, 'You must be a member of the group to view activity', 'PERMISSION_DENIED', undefined, req);
    }

    if (blockedResult.error) {
      return handleError(blockedResult.error, 'fetching blocked users', req);
    }

    const blockedUserIds = new Set<string>(
      (blockedResult.data || []).map((row: { blocked_user_id: string }) => row.blocked_user_id),
    );

    let historyQuery = supabase
      .from('transaction_history')
      .select('id, transaction_id, settlement_id, activity_type, group_id, action, changed_by, changed_at, changes, snapshot')
      .eq('group_id', groupId)
      .order('changed_at', { ascending: false });

    let countQuery = supabase
      .from('transaction_history')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId);

    if (blockedUserIds.size > 0) {
      const blockedFilter = `(${Array.from(blockedUserIds).join(',')})`;
      historyQuery = historyQuery.not('changed_by', 'in', blockedFilter);
      countQuery = countQuery.not('changed_by', 'in', blockedFilter);
    }

    const [historyResult, countResult] = await Promise.all([
      historyQuery.range(offset, offset + limit - 1),
      countQuery,
    ]);

    if (historyResult.error) {
      return handleError(historyResult.error, 'fetching transaction history', req);
    }

    const visibleHistoryRecords: TransactionHistory[] = filterBlockedActivityRecords(
      (historyResult.data || []) as TransactionHistory[],
      blockedUserIds,
    );

    const { emailMap, profileMap, participantMap } = await buildEmailMapForHistory(
      visibleHistoryRecords,
      user.id,
      user.email || null,
      supabase,
      groupId
    );

    const activities: ActivityItem[] = visibleHistoryRecords.map((h: TransactionHistory) =>
      transformHistoryToActivity(h, emailMap, profileMap, participantMap)
    );

    if (countResult.error) {
      log.error('Count query error', 'activity-feed', {
        error: countResult.error.message,
        code: countResult.error.code,
        groupId,
      });
    }

    const { total, has_more: hasMore } = activityPageMeta({
      offset,
      limit,
      pageLength: activities.length,
      count: countResult.error ? null : (countResult.count ?? 0),
      countError: Boolean(countResult.error),
    });

    return createSuccessResponse({
      activities,
      total,
      has_more: hasMore,
    }, 200, 0, req);
  } catch (error: unknown) {
    return handleError(error, 'activity handler', req);
  }
});
