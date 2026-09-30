import { verifyAuth } from '../_shared/auth.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { parsePath } from '../_shared/path-parser.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { fetchUserEmails } from '../_shared/user-email.ts';
import { fetchUserProfiles } from '../_shared/user-profiles.ts';
import { normalizeOptionalCurrency } from '../_shared/rates.ts';
import { isValidUUID, validateBodySize, validateGroupData } from '../_shared/validation.ts';
import { requireMinVersion } from '../_shared/version-check.ts';

/**
 * Groups Edge Function
 * 
 * Handles CRUD operations for expense groups:
 * - GET /groups - List groups for the current user (excludes per-user hidden)
 * - GET /groups/:id - Get group details with members
 * - POST /groups - Create new group
 * - PATCH /groups/:id - Update name/description (owners) and/or settlement currency settings (active members)
 * - POST /groups/:id/archive | /unarchive | /hide - Per-user list visibility (no hard delete)
 * 
 * Group hard-delete is disabled (DB prevent_group_delete). Use Leave / Archive / Hide instead.
 * 
 * @route /functions/v1/groups
 * @requires Authentication
 */

interface Group {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  settlement_currency?: string | null;
  unify_balances?: boolean;
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

  // Check app version - return 426 if outdated
  const versionError = requireMinVersion(req);
  if (versionError) {
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
      // Get groups and include the user's membership status / visibility
      const { data: groups, error } = await supabase
        .from('groups')
        .select(`
          id, 
          name, 
          description, 
          created_by, 
          created_at, 
          updated_at,
          settlement_currency,
          unify_balances,
          group_members!inner(status, archived_at, hidden_at)
        `)
        .eq('group_members.user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        return handleError(error, 'fetching groups', req);
      }

      // Flatten the response and extract status / archive state.
      // Hidden memberships are omitted from the list for this user only.
      const flattenedGroups = (groups || [])
        .map((g: any) => {
          const membership = g.group_members?.[0] || {};
          return {
            ...g,
            user_status: membership.status || 'active',
            archived_at: membership.archived_at ?? null,
            hidden_at: membership.hidden_at ?? null,
            group_members: undefined, // Remove nesting
          };
        })
        .filter((g: any) => !g.hidden_at)
        .map((g: any) => ({ ...g, hidden_at: null }));

      // Sort: active (non-archived) first, archived next, left (former) last.
      flattenedGroups.sort((a: any, b: any) => {
        const rank = (g: any) => {
          if (g.user_status === 'left') return 2;
          if (g.archived_at) return 1;
          return 0;
        };
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
        return 0; // Keep DB order (created_at DESC) within the same bucket
      });

      return createSuccessResponse(flattenedGroups, 200, 0, req); // No caching - real-time data
    }

    // Handle GET /groups/:id - Get group details with members
    if (httpMethod === 'GET' && groupId) {
      // Validate group_id format
      if (!isValidUUID(groupId)) {
        return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      // Fetch group + members in parallel (members query is cheap even if group 404s)
      const [groupResult, membersResult] = await Promise.all([
        supabase
          .from('groups')
          .select('id, name, description, created_by, created_at, updated_at, settlement_currency, unify_balances')
          .eq('id', groupId)
          .single(),
        supabase
          .from('group_members')
          .select('id, group_id, user_id, role, joined_at, status, left_at, archived_at, hidden_at')
          .eq('group_id', groupId)
          .order('joined_at', { ascending: true }),
      ]);

      const { data: group, error: groupError } = groupResult;
      if (groupError || !group) {
        return createErrorResponse(404, 'Group not found', 'NOT_FOUND', undefined, req);
      }

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
        members: membersWithEmails,
      };

      return createSuccessResponse(groupWithMembers, 200, 0, req); // No caching - real-time data
    }

    // Handle POST /groups - Create new group
    if (httpMethod === 'POST') {
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
        .select('id, name, description, created_by, created_at, updated_at, settlement_currency, unify_balances')
        .eq('id', groupResult)
        .single();

      if (fetchError || !group) {
        return handleError(fetchError || new Error('Group not found after creation'), 'fetching created group', req);
      }

      return createSuccessResponse(group, 201, 0, req);
    }

    // Handle PATCH /groups/:id - name/description and/or settlement currency settings
    if (httpMethod === 'PATCH' && groupId) {
      if (!isValidUUID(groupId)) {
        return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      let updates: {
        name?: string;
        description?: string | null;
        settlement_currency?: string | null;
        unify_balances?: boolean;
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

      if (!hasName && !hasDescription && !hasCurrency && !hasUnify) {
        return createErrorResponse(400, 'Provide at least one field to update', 'VALIDATION_ERROR', undefined, req);
      }

      const { data: existing, error: existingError } = await supabase
        .from('groups')
        .select('id, name, description, created_by, created_at, updated_at, settlement_currency, unify_balances')
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
          .select('id, name, description, created_by, created_at, updated_at, settlement_currency, unify_balances')
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

      return createSuccessResponse(group, 200, 0, req);
    }

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
