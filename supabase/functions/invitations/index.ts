import { verifyAuth } from '../_shared/auth.ts';
import { SUPABASE_SERVICE_ROLE_KEY } from '../_shared/env.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { parsePath } from '../_shared/path-parser.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { findUserIdByEmail } from '../_shared/user-lookup.ts';
import { EMAIL_FORMAT_ERROR, isValidEmail, isValidUUID, validateBodySize } from '../_shared/validation.ts';

/**
 * Invitations Edge Function
 * 
 * Handles group invitation operations:
 * - GET /invitations?group_id=xxx - List invitations (optionally filtered by group or email)
 * - POST /invitations - Create new invitation
 * - POST /invitations/:id/accept - Accept invitation
 * - DELETE /invitations/:id - Cancel invitation (owners only)
 * 
 * @route /functions/v1/invitations
 * @requires Authentication
 */

interface GroupInvitation {
  id: string;
  group_id: string;
  email: string | null; // null for shareable link invites
  invited_by: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  token?: string;
  expires_at: string;
  created_at: string;
  accepted_at?: string;
  user_id?: string; // User ID if the invited user has signed up
}

interface CreateInvitationRequest {
  group_id: string;
  email: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return createEmptyResponse(200, req);
  }

  try {
    const body = await req.text().catch(() => null);
    const bodySizeValidation = validateBodySize(body);
    if (!bodySizeValidation.valid) {
      return createErrorResponse(413, bodySizeValidation.error || 'Request body too large', 'VALIDATION_ERROR', undefined, req);
    }

    let authResult;
    try {
      authResult = await verifyAuth(req);
    } catch (authError) {
      return handleError(authError, 'authentication', req);
    }

    const { user: currentUser, supabase } = authResult;
    const httpMethod = req.method;
    const url = new URL(req.url);
    const parsedPath = parsePath(url.pathname);
    const invitationId = parsedPath.resource === 'invitations' ? parsedPath.id : null;
    const action = parsedPath.resource === 'invitations' ? parsedPath.action : null;

    // Handle POST /invitations - Create invitation
    if (httpMethod === 'POST' && !invitationId) {
      let requestData: CreateInvitationRequest;
      try {
        requestData = body ? JSON.parse(body) : {};
      } catch {
        return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
      }

      if (!requestData.group_id || !requestData.email) {
        return createErrorResponse(400, 'Missing required fields: group_id, email', 'VALIDATION_ERROR', undefined, req);
      }

      if (!isValidUUID(requestData.group_id)) {
        return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      const normalizedEmail = requestData.email.toLowerCase().trim();
      
      if (!isValidEmail(normalizedEmail)) {
        return createErrorResponse(400, EMAIL_FORMAT_ERROR, 'VALIDATION_ERROR', undefined, req);
      }

      const { data: membership, error: membershipError } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', requestData.group_id)
        .eq('user_id', currentUser.id)
        .single();

      if (membershipError || !membership) {
        return createErrorResponse(403, 'You must be a group member to create invitations', 'PERMISSION_DENIED', undefined, req);
      }

      if (SUPABASE_SERVICE_ROLE_KEY) {
        // Exact, case-insensitive lookup against auth.users via SECURITY DEFINER RPC.
        // (The previous `GET /auth/v1/admin/users?email=...` call silently ignored the
        // email parameter and only returned the newest page of users, so existing
        // users were wrongly treated as non-existent.)
        let targetUserId: string | null;
        try {
          targetUserId = await findUserIdByEmail(normalizedEmail);
        } catch (error: unknown) {
          return handleError(error, 'searching for user', req);
        }

        // If the invitee already has an account, add them as a member directly
        // instead of creating a pending invitation. Invitations are only for
        // people who don't have an account yet.
        if (targetUserId) {
          const { data: existingMember } = await supabase
            .from('group_members')
            .select('id, status')
            .eq('group_id', requestData.group_id)
            .eq('user_id', targetUserId)
            .maybeSingle();

          if (existingMember && existingMember.status !== 'left') {
            return createErrorResponse(400, 'User is already a member of this group', 'VALIDATION_ERROR', undefined, req);
          }

          // Accept any pre-existing pending invitation for this email so the
          // membership and invitation state stay consistent.
          const { data: pendingInvitation } = await supabase
            .from('group_invitations')
            .select('id')
            .eq('group_id', requestData.group_id)
            .eq('email', normalizedEmail)
            .eq('status', 'pending')
            .maybeSingle();

          if (pendingInvitation) {
            const { error: acceptError } = await supabase.rpc('accept_group_invitation', {
              invitation_id: pendingInvitation.id,
              accepting_user_id: targetUserId,
            });

            if (acceptError) {
              return handleError(acceptError, 'accepting invitation for existing user', req);
            }
          } else if (existingMember && existingMember.status === 'left') {
            const { error: reactivateError } = await supabase
              .from('group_members')
              .update({ status: 'active', left_at: null, role: 'member' })
              .eq('group_id', requestData.group_id)
              .eq('user_id', targetUserId);

            if (reactivateError) {
              return handleError(reactivateError, 'reactivating member', req);
            }
          } else {
            const { error: addError } = await supabase
              .from('group_members')
              .insert({
                group_id: requestData.group_id,
                user_id: targetUserId,
                role: 'member',
              });

            if (addError) {
              return handleError(addError, 'adding member', req);
            }
          }

          const { data: member, error: memberFetchError } = await supabase
            .from('group_members')
            .select('id, group_id, user_id, role, joined_at')
            .eq('group_id', requestData.group_id)
            .eq('user_id', targetUserId)
            .single();

          if (memberFetchError || !member) {
            return handleError(memberFetchError || new Error('Failed to fetch added member'), 'adding member', req);
          }

          return createSuccessResponse({
            member: true,
            message: 'User already has an account and was added to the group as a member.',
            email: normalizedEmail,
            ...member,
          }, 201, 0, req);
        }
      }

      const { data: existingInvitation } = await supabase
        .from('group_invitations')
        .select('id')
        .eq('group_id', requestData.group_id)
        .eq('email', normalizedEmail)
        .eq('status', 'pending')
        .single();

      if (existingInvitation) {
        return createErrorResponse(400, 'A pending invitation already exists for this email', 'VALIDATION_ERROR', undefined, req);
      }

      // Generate a unique token for the invitation using Deno crypto
      const tokenArray = new Uint8Array(32);
      crypto.getRandomValues(tokenArray);
      const token = Array.from(tokenArray)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const { data: invitation, error: createError } = await supabase
        .from('group_invitations')
        .insert({
          group_id: requestData.group_id,
          email: normalizedEmail,
          invited_by: currentUser.id,
          token: token,
          status: 'pending',
        })
        .select()
        .single();

      if (createError) {
        return handleError(createError, 'creating invitation', req);
      }

      return createSuccessResponse(invitation, 201, 0, req);
    }

    // Handle GET /invitations - List invitations
    if (httpMethod === 'GET' && !invitationId) {
      const url = new URL(req.url);
      const groupId = url.searchParams.get('group_id');
      const email = url.searchParams.get('email');

      let query = supabase
        .from('group_invitations')
        .select('id, group_id, email, invited_by, status, token, expires_at, created_at, accepted_at, max_uses, uses_count')
        .order('created_at', { ascending: false });

      if (groupId) {
        const { data: membership, error: membershipError } = await supabase
          .from('group_members')
          .select('id')
          .eq('group_id', groupId)
          .eq('user_id', currentUser.id)
          .maybeSingle();

        const { data: group } = await supabase
          .from('groups')
          .select('created_by')
          .eq('id', groupId)
          .single();

        const isMember = membership || (group && group.created_by === currentUser.id);

        if (!isMember) {
          return createErrorResponse(403, 'You must be a member of the group to view invitations', 'PERMISSION_DENIED', undefined, req);
        }

        query = query.eq('group_id', groupId);
      } else if (email) {
        const userEmail = currentUser.email;
        if (!userEmail || userEmail.toLowerCase() !== email.toLowerCase()) {
          return createErrorResponse(403, 'You can only view invitations sent to your email', 'PERMISSION_DENIED', undefined, req);
        }
        query = query.eq('email', email.toLowerCase());
      }

      const { data: invitations, error } = await query;

      if (error) {
        return handleError(error, 'fetching invitations', req);
      }

      // Enrich invitations with user_id for invited users who have signed up
      const enrichedInvitations = await Promise.all(
        (invitations || []).map(async (invitation: GroupInvitation) => {
          // Only look up user_id for pending email invitations
          // (link invitations have no email until redeemed)
          if (invitation.status !== 'pending' || !invitation.email || !SUPABASE_SERVICE_ROLE_KEY) {
            return invitation;
          }

          try {
            const invitedUserId = await findUserIdByEmail(invitation.email);

            if (invitedUserId) {
              return {
                ...invitation,
                user_id: invitedUserId,
              };
            }
          } catch (_err) {
            // If lookup fails, just return invitation without user_id
            // This is expected for users who haven't signed up yet
          }

          return invitation;
        })
      );

      return createSuccessResponse(enrichedInvitations || [], 200, 0, req);
    }

    // Handle POST /invitations/:id/accept - Accept invitation
    if (httpMethod === 'POST' && invitationId && action === 'accept') {
      const { data, error: rpcError } = await supabase.rpc('accept_group_invitation', {
        invitation_id: invitationId,
        accepting_user_id: currentUser.id,
      });

      if (rpcError) {
        return handleError(rpcError, 'accepting invitation', req);
      }

      return createSuccessResponse({ success: true, message: 'Invitation accepted successfully' }, 200, 0, req);
    }

    // Handle DELETE /invitations/:id - Cancel invitation
    if (httpMethod === 'DELETE' && invitationId) {
      const { data: invitation, error: fetchError } = await supabase
        .from('group_invitations')
        .select('group_id, status')
        .eq('id', invitationId)
        .single();

      if (fetchError || !invitation) {
        return createErrorResponse(404, 'Invitation not found', 'NOT_FOUND', undefined, req);
      }

      const { data: membership } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', invitation.group_id)
        .eq('user_id', currentUser.id)
        .single();

      if (!membership) {
        return createErrorResponse(403, 'You must be a group member to cancel invitations', 'PERMISSION_DENIED', undefined, req);
      }

      const { error: updateError } = await supabase
        .from('group_invitations')
        .update({ status: 'cancelled' })
        .eq('id', invitationId);

      if (updateError) {
        return handleError(updateError, 'cancelling invitation', req);
      }

      return createSuccessResponse({ success: true, message: 'Invitation cancelled successfully' }, 200, 0, req);
    }

    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  } catch (error: unknown) {
    return handleError(error, 'invitations handler', req);
  }
});
