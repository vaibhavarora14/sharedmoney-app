import { recordLastSeenAppIfAuthenticated, verifyAuth } from '../_shared/auth.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { parsePath } from '../_shared/path-parser.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { fetchUserEmails } from '../_shared/user-email.ts';
import { fetchUserProfiles } from '../_shared/user-profiles.ts';
import { parseGroupDefaultSplitUpdate } from '../_shared/groupDefaultSplit.ts';
import { isBalanceNudgeCadence } from '../_shared/balance-nudges.ts';
import { handleRecurringTemplateRequest, loadRecurringTemplateViews } from '../_shared/recurring-template-api.ts';
import { normalizeOptionalCurrency } from '../_shared/rates.ts';
import { isValidUUID, validateBodySize, validateGroupData } from '../_shared/validation.ts';
import { requireMinVersion } from '../_shared/version-check.ts';
import { attachBalanceNudgeMutes, loadGroupsListFromTables } from './list-groups.ts';

/**
 * Groups Edge Function
 * 
 * Handles CRUD operations for expense groups:
 * - GET /groups - List groups for the current user (excludes per-user hidden)
 * - GET /groups/:id - Get group details with members
 * - POST /groups - Create new group
 * - PATCH /groups/:id - Update name/description (owners), settlement currency settings, default split (active members), balance nudge cadence (owners), and mute (active members)
 * - POST /groups/:id/archive | /unarchive | /hide - Per-user list visibility (no hard delete)
 * 
 * Group hard-delete is disabled (DB prevent_group_delete). Use Leave / Archive / Hide instead.
 * 
 * @route /functions/v1/groups
 * @requires Authentication
 */

const GROUP_COLUMNS =
  'id, name, description, created_by, created_at, updated_at, settlement_currency, unify_balances, default_split_mode, default_split_weights, kind, balance_nudge_cadence';

interface Group {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  settlement_currency?: string | null;
  unify_balances?: boolean;
  default_split_mode?: 'equal' | 'weights';
  default_split_weights?: Record<string, number>;
  balance_nudge_cadence?: 'off' | 'weekly' | 'monthly';
  balance_nudge_muted?: boolean;
}

interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
}

interface GroupWithMembers extends Group {
  user_status?: string;
  archived_at?: string | null;
  hidden_at?: string | null;
  members?: Array<GroupMember & { email?: string; full_name?: string | null; avatar_url?: string | null }>;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return createEmptyResponse(200, req);
  }

  // Check app version - return 426 if outdated. A valid session still
  // records X-App-Version so reminder emails can see the old build.
  const versionError = requireMinVersion(req);
  if (versionError) {
    await recordLastSeenAppIfAuthenticated(req);
    return versionError;
  }

  try {
    // Validate request body size
    const body = await req.text().catch(() => null);
    const bodySizeValidation = validateBodySize(body);
    if (!bodySizeValidation.valid) {
      return createErrorResponse(413, bodySizeValidation.error || 'Request body too large', 'VALIDATION_ERROR', undefined, req);
    }

    // Verify authentication
    let authResult;
    try {
      authResult = await verifyAuth(req);
    } catch (authError) {
      return handleError(authError, 'authentication', req);
    }

    const { user, supabase } = authResult;
    const currentUserEmail = user.email;

    const httpMethod = req.method;
    const url = new URL(req.url);
    const parsedPath = parsePath(url.pathname);
    const groupId = parsedPath.resource === 'groups' ? parsedPath.id : null;

    // Handle GET /groups - List groups for the current user (hidden excluded)
    if (httpMethod === 'GET' && !groupId) {
      // Direct ledgers stay out of the groups list and search unless Home asks
      // for them. Group details by id still work, so "View with Kabir" can open one.
      const includeDirect = url.searchParams.get('include_direct') === '1';
      try {
        const listed = await loadGroupsListFromTables(supabase, user.id, includeDirect);
        return createSuccessResponse(listed, 200, 0, req); // No caching - real-time data
      } catch (error) {
        return handleError(error, 'fetching groups', req);
      }
    }

    // Handle GET /groups/:id - Get group details with members
    if (httpMethod === 'GET' && groupId) {
      // Validate group_id format
      if (!isValidUUID(groupId)) {
        return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      // Fetch group + members + mute + recurring templates in one batch.
      // Templates are settled separately so a 404 still wins if the group is gone.
      const [groupResult, membersResult, muteResult, recurringSettled] = await Promise.all([
        supabase
          .from('groups')
          .select(GROUP_COLUMNS)
          .eq('id', groupId)
          .single(),
        supabase
          .from('group_members')
          .select('id, group_id, user_id, role, joined_at, status, left_at, archived_at, hidden_at')
          .eq('group_id', groupId)
          .order('joined_at', { ascending: true }),
        supabase
          .from('group_balance_nudge_mutes')
          .select('user_id')
          .eq('group_id', groupId)
          .eq('user_id', user.id)
          .maybeSingle(),
        loadRecurringTemplateViews(supabase, groupId).then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error }),
        ),
      ]);

      const { data: group, error: groupError } = groupResult;
      if (groupError || !group) {
        return createErrorResponse(404, 'Group not found', 'NOT_FOUND', undefined, req);
      }
      if (!recurringSettled.ok) {
        throw recurringSettled.error;
      }
      const recurringTemplates = recurringSettled.value;

      const { data: members, error: membersError } = membersResult;
      if (membersError) {
        return handleError(membersError, 'fetching group members', req);
      }

      // Enrich members with email addresses and profile data using shared utilities
      const memberIds = new Set((members || []).map((m: GroupMember) => m.user_id));
      const [emailMap, profileMap, participantsResult] = await Promise.all([
        fetchUserEmails(Array.from(memberIds) as string[], user.id, currentUserEmail),
        fetchUserProfiles(supabase, Array.from(memberIds) as string[]),
        supabase
          .from('participants')
          .select('id, user_id')
          .eq('group_id', groupId)
          .in('user_id', Array.from(memberIds))
      ]);
      
      const participants = participantsResult.data || [];
      const participantMap = new Map(participants.map((p: any) => [p.user_id, p.id]));
      
      const membersWithEmails = (members || []).map((member: any) => {
        const profile = profileMap.get(member.user_id);
        return {
          ...member,
          email: emailMap.get(member.user_id),
          full_name: profile?.full_name || null,
          avatar_url: profile?.avatar_url || null,
          participant_id: participantMap.get(member.user_id) || null,
        };
      });

      const myMembership = (members || []).find((m: any) => m.user_id === user.id);

      const groupWithMembers: GroupWithMembers = {
        ...group,
        user_status: myMembership?.status || undefined,
        archived_at: myMembership?.archived_at ?? null,
        hidden_at: myMembership?.hidden_at ?? null,
        balance_nudge_muted: Boolean(muteResult.data),
        members: membersWithEmails,
      };

      return createSuccessResponse({ ...groupWithMembers, recurring_templates: recurringTemplates }, 200, 0, req); // No caching - real-time data
    }

    // Handle POST /groups - Create new group
    if (httpMethod === 'POST' && !groupId) {
      let groupData: Partial<Group>;
      try {
        groupData = body ? JSON.parse(body) : {};
      } catch {
        return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
      }

      // Validate required fields
      if (!groupData.name || !groupData.name.trim()) {
        return createErrorResponse(400, 'Missing required field: name', 'VALIDATION_ERROR', undefined, req);
      }

      // Validate group data
      const validation = validateGroupData(groupData);
      if (!validation.valid) {
        return createErrorResponse(400, validation.error || 'Invalid group data', 'VALIDATION_ERROR', undefined, req);
      }

      // Create group using SECURITY DEFINER function to bypass RLS issues
      // This ensures auth.uid() is properly recognized
      const { data: groupResult, error } = await supabase.rpc('create_group', {
        group_name: groupData.name.trim(),
        group_description: groupData.description?.trim() || null,
      });

      if (error) {
        return handleError(error, 'creating group', req);
      }

      // Fetch the created group to return full details
      const { data: group, error: fetchError } = await supabase
        .from('groups')
        .select(GROUP_COLUMNS)
        .eq('id', groupResult)
        .single();

      if (fetchError || !group) {
        return handleError(fetchError || new Error('Group not found after creation'), 'fetching created group', req);
      }

      return createSuccessResponse(group, 201, 0, req);
    }

    // Handle PATCH /groups/:id - name/description and/or settlement currency settings
    if (httpMethod === 'PATCH' && groupId && !parsedPath.action) {
      if (!isValidUUID(groupId)) {
        return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      let updates: {
        name?: string;
        description?: string | null;
        settlement_currency?: string | null;
        unify_balances?: boolean;
        default_split_mode?: unknown;
        default_split_weights?: unknown;
        balance_nudge_cadence?: unknown;
        mute_balance_nudges?: unknown;
      };
      try {
        updates = body ? JSON.parse(body) : {};
      } catch {
        return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
      }

      const hasName = updates.name !== undefined;
      const hasDescription = updates.description !== undefined;
      const hasCurrency = updates.settlement_currency !== undefined;
      const hasUnify = updates.unify_balances !== undefined;
      const hasDefaultSplit = updates.default_split_mode !== undefined
        || updates.default_split_weights !== undefined;
      const hasCadence = updates.balance_nudge_cadence !== undefined;
      const hasMute = updates.mute_balance_nudges !== undefined;
      const defaultSplit = hasDefaultSplit
        ? parseGroupDefaultSplitUpdate(updates)
        : null;

      if (!hasName && !hasDescription && !hasCurrency && !hasUnify && !hasDefaultSplit && !hasCadence && !hasMute) {
        return createErrorResponse(400, 'Provide at least one field to update', 'VALIDATION_ERROR', undefined, req);
      }

      if (defaultSplit && !defaultSplit.ok) {
        return createErrorResponse(400, defaultSplit.error, 'VALIDATION_ERROR', undefined, req);
      }

      const { data: existing, error: existingError } = await supabase
        .from('groups')
        .select(GROUP_COLUMNS)
        .eq('id', groupId)
        .single();

      if (existingError || !existing) {
        return createErrorResponse(404, 'Group not found', 'NOT_FOUND', undefined, req);
      }

      let group = existing;

      // Name/description updates are owner-only (active owners).
      if (hasName || hasDescription) {
        const validation = validateGroupData({
          name: updates.name,
          description: updates.description,
        });
        if (!validation.valid) {
          return createErrorResponse(400, validation.error || 'Invalid group data', 'VALIDATION_ERROR', undefined, req);
        }

        const { data: membership } = await supabase
          .from('group_members')
          .select('role, status')
          .eq('group_id', groupId)
          .eq('user_id', user.id)
          .maybeSingle();

        const isActiveOwner =
          membership?.status === 'active' &&
          (membership?.role === 'owner' || existing.created_by === user.id);

        if (!isActiveOwner) {
          return createErrorResponse(403, 'Only group owners can update group details', 'PERMISSION_DENIED', undefined, req);
        }

        const detailUpdates: {
          name?: string;
          description?: string | null;
          updated_at: string;
        } = {
          updated_at: new Date().toISOString(),
        };

        if (hasName && typeof updates.name === 'string') {
          detailUpdates.name = updates.name.trim();
        }

        if (hasDescription) {
          if (updates.description === null) {
            detailUpdates.description = null;
          } else if (typeof updates.description === 'string') {
            const trimmed = updates.description.trim();
            detailUpdates.description = trimmed.length > 0 ? trimmed : null;
          } else {
            return createErrorResponse(400, 'Description must be a string or null', 'VALIDATION_ERROR', undefined, req);
          }
        }

        const { data: updatedDetails, error: updateError } = await supabase
          .from('groups')
          .update(detailUpdates)
          .eq('id', groupId)
          .select(GROUP_COLUMNS)
          .single();

        if (updateError || !updatedDetails) {
          return handleError(updateError || new Error('Group not found after update'), 'updating group details', req);
        }

        group = updatedDetails;
      }

      // Settlement currency settings remain available to any active member.
      if (hasCurrency || hasUnify) {
        const currency = normalizeOptionalCurrency(updates.settlement_currency);
        if (!currency.valid) {
          return createErrorResponse(400, currency.error || 'Invalid settlement currency', 'VALIDATION_ERROR', undefined, req);
        }
        if (updates.unify_balances !== undefined && typeof updates.unify_balances !== 'boolean') {
          return createErrorResponse(400, 'unify_balances must be a boolean', 'VALIDATION_ERROR', undefined, req);
        }

        const nextCurrency = currency.value !== undefined
          ? currency.value
          : group.settlement_currency ?? null;
        const nextUnify = updates.unify_balances !== undefined
          ? updates.unify_balances
          : group.unify_balances === true;

        const { data: currencyGroup, error } = await supabase.rpc('update_group_currency_settings', {
          p_group_id: groupId,
          p_settlement_currency: nextCurrency,
          p_unify_balances: nextUnify,
        });

        if (error) {
          const message = (error.message || '').toLowerCase();
          if (message.includes('not an active group member')) {
            return createErrorResponse(403, 'Not an active group member', 'PERMISSION_DENIED', undefined, req);
          }
          if (message.includes('not authenticated')) {
            return createErrorResponse(401, 'Unauthorized', 'AUTH_ERROR', undefined, req);
          }
          return handleError(error, 'updating group currency settings', req);
        }

        group = currencyGroup;
      }

      // Default split is a prefill for new expenses. The RPC updates the group
      // row only, so expenses already saved keep their split amounts.
      if (defaultSplit?.ok) {
        const { data: splitGroup, error } = await supabase.rpc('update_group_default_split', {
          p_group_id: groupId,
          p_mode: defaultSplit.value.mode,
          p_weights: defaultSplit.value.weights,
        });

        if (error || !splitGroup) {
          const message = (error?.message || '').toLowerCase();
          if (message.includes('not an active group member')) {
            return createErrorResponse(403, 'Not an active group member', 'PERMISSION_DENIED', undefined, req);
          }
          if (message.includes('not authenticated')) {
            return createErrorResponse(401, 'Unauthorized', 'AUTH_ERROR', undefined, req);
          }
          if (
            message.includes('default_split')
            || message.includes('each weight')
            || message.includes('group not found')
          ) {
            return createErrorResponse(400, error?.message || 'Invalid default split', 'VALIDATION_ERROR', undefined, req);
          }
          return handleError(error || new Error('Group not found after default split update'), 'updating group default split', req);
        }

        group = splitGroup;
      }

      if (hasCadence) {
        if (!isBalanceNudgeCadence(updates.balance_nudge_cadence)) {
          return createErrorResponse(400, 'balance_nudge_cadence must be off, weekly, or monthly', 'VALIDATION_ERROR', undefined, req);
        }

        const { data: membership } = await supabase
          .from('group_members')
          .select('role, status')
          .eq('group_id', groupId)
          .eq('user_id', user.id)
          .maybeSingle();

        const isActiveOwner =
          membership?.status === 'active' &&
          (membership?.role === 'owner' || group.created_by === user.id);
        if (!isActiveOwner) {
          return createErrorResponse(403, 'Only group owners can update balance nudge cadence', 'PERMISSION_DENIED', undefined, req);
        }

        const { data: cadenceGroup, error } = await supabase
          .from('groups')
          .update({
            balance_nudge_cadence: updates.balance_nudge_cadence,
            updated_at: new Date().toISOString(),
          })
          .eq('id', groupId)
          .select(GROUP_COLUMNS)
          .single();

        if (error || !cadenceGroup) {
          return handleError(error || new Error('Group not found after cadence update'), 'updating balance nudge cadence', req);
        }
        group = cadenceGroup;
      }

      if (hasMute) {
        if (typeof updates.mute_balance_nudges !== 'boolean') {
          return createErrorResponse(400, 'mute_balance_nudges must be a boolean', 'VALIDATION_ERROR', undefined, req);
        }

        const { data: membership } = await supabase
          .from('group_members')
          .select('status')
          .eq('group_id', groupId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (membership?.status !== 'active') {
          return createErrorResponse(403, 'Not an active group member', 'PERMISSION_DENIED', undefined, req);
        }

        if (updates.mute_balance_nudges) {
          const { error } = await supabase
            .from('group_balance_nudge_mutes')
            .upsert({ user_id: user.id, group_id: groupId }, { onConflict: 'user_id,group_id' });
          if (error) {
            return handleError(error, 'muting balance nudges', req);
          }
        } else {
          const { error } = await supabase
            .from('group_balance_nudge_mutes')
            .delete()
            .eq('user_id', user.id)
            .eq('group_id', groupId);
          if (error) {
            return handleError(error, 'unmuting balance nudges', req);
          }
        }
        group = { ...group, balance_nudge_muted: updates.mute_balance_nudges };
      } else {
        const withMute = await attachBalanceNudgeMutes(supabase, [group], user.id);
        group = withMute[0];
      }

      return createSuccessResponse(group, 200, 0, req);
    }

    const recurringResponse = await handleRecurringTemplateRequest({
      req,
      supabase,
      user,
      groupId: groupId || '',
      action: parsedPath.resource === 'groups' ? (parsedPath.action || null) : null,
      httpMethod,
      body,
    });
    if (recurringResponse) return recurringResponse;

    // Per-user list visibility: archive / unarchive / hide (never delete the group)
    const membershipAction = parsedPath.resource === 'groups' ? parsedPath.action : null;
    if (
      httpMethod === 'POST' &&
      groupId &&
      (membershipAction === 'archive' ||
        membershipAction === 'unarchive' ||
        membershipAction === 'hide')
    ) {
      if (!isValidUUID(groupId)) {
        return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      const rpcArgs: {
        p_group_id: string;
        p_archived?: boolean;
        p_hidden?: boolean;
      } = { p_group_id: groupId };

      if (membershipAction === 'archive') {
        rpcArgs.p_archived = true;
      } else if (membershipAction === 'unarchive') {
        rpcArgs.p_archived = false;
      } else {
        rpcArgs.p_hidden = true;
      }

      const { data: membership, error } = await supabase.rpc(
        'update_my_group_membership_visibility',
        rpcArgs,
      );

      if (error) {
        const message = (error.message || '').toLowerCase();
        if (message.includes('not authenticated')) {
          return createErrorResponse(401, 'Unauthorized', 'AUTH_ERROR', undefined, req);
        }
        if (message.includes('not a member')) {
          return createErrorResponse(404, 'You are not a member of this group', 'NOT_FOUND', undefined, req);
        }
        if (
          message.includes('only active') ||
          message.includes('only available') ||
          message.includes('already removed') ||
          message.includes('cannot be') ||
          message.includes('provide archived')
        ) {
          return createErrorResponse(400, error.message || 'Invalid membership visibility update', 'VALIDATION_ERROR', undefined, req);
        }
        return handleError(error, 'updating group membership visibility', req);
      }

      return createSuccessResponse({
        group_id: groupId,
        status: membership?.status ?? null,
        archived_at: membership?.archived_at ?? null,
        hidden_at: membership?.hidden_at ?? null,
      }, 200, 0, req);
    }

    // Method not allowed — group hard-delete is intentionally unsupported
    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  } catch (error: unknown) {
    return handleError(error, 'groups handler', req);
  }
});
