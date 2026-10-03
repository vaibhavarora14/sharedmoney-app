import { verifyAuth } from '../_shared/auth.ts';
import { SUPABASE_SERVICE_ROLE_KEY } from '../_shared/env.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { buildInvitationInsert, InviteIdentity, normalizeInviteIdentity, resolveInviteAction } from '../_shared/invite-identity.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { findUserIdByEmail, findUserIdByPhone } from '../_shared/user-lookup.ts';
import { isValidUUID, validateBodySize } from '../_shared/validation.ts';

/**
 * Group Members Edge Function
 * 
 * Handles group member management:
 * - POST /group-members - Add member to group (creates invitation if user doesn't exist)
 * - DELETE /group-members?group_id=xxx&user_id=xxx - Remove member from group
 * 
 * @route /functions/v1/group-members
 * @requires Authentication
 */

interface AddMemberRequest {
  group_id: string;
  email?: string | null;
  phone?: string | null;
  country_code?: string | null;
  role?: 'owner' | 'member';
}

async function createInvitation(
  supabase: Awaited<ReturnType<typeof verifyAuth>>['supabase'],
  groupId: string,
  identity: InviteIdentity,
  invitedBy: string
): Promise<{ id: string; token: string } | null> {
  const { data: existingInvitation } = await supabase
    .from('group_invitations')
    .select('id, token')
    .eq('group_id', groupId)
    .eq(identity.column, identity.value)
    .eq('status', 'pending')
    .single();

  if (existingInvitation) {
    return existingInvitation as { id: string; token: string };
  }

  const tokenArray = new Uint8Array(32);
  crypto.getRandomValues(tokenArray);
  const token = Array.from(tokenArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const { data: invitation, error: inviteError } = await supabase
    .from('group_invitations')
    .insert(buildInvitationInsert({ groupId, invitedBy, token, identity }))
    .select('id, token')
    .single();

  if (inviteError) {
    throw new Error(`Failed to create invitation: ${inviteError.message}`);
  }

  return invitation;
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

    if (httpMethod === 'POST') {
      let requestData: AddMemberRequest;
      try {
        requestData = body ? JSON.parse(body) : {};
      } catch {
        return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
      }

      if (!requestData.group_id || (!requestData.email && !requestData.phone)) {
        return createErrorResponse(400, 'Missing required fields: group_id and email or phone', 'VALIDATION_ERROR', undefined, req);
      }

      if (!isValidUUID(requestData.group_id)) {
        return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      const { data: membership, error: membershipError } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', requestData.group_id)
        .eq('user_id', currentUser.id)
        .single();

      if (membershipError || !membership) {
        return createErrorResponse(403, 'You must be a member of the group to add members', 'PERMISSION_DENIED', undefined, req);
      }

      const identityResult = normalizeInviteIdentity(requestData);
      if (identityResult.error || !identityResult.identity) {
        return createErrorResponse(400, identityResult.error || 'Invalid invite target', 'VALIDATION_ERROR', undefined, req);
      }
      const identity = identityResult.identity;

      if (!SUPABASE_SERVICE_ROLE_KEY) {
        return createErrorResponse(
          500,
          'Server configuration error: Service role key not configured. This is required for user lookup. Please configure SUPABASE_SERVICE_ROLE_KEY in your environment variables.',
          'CONFIGURATION_ERROR',
          undefined,
          req
        );
      }

      let targetUserId: string | null;
      try {
        targetUserId = identity.kind === 'phone'
          ? await findUserIdByPhone(identity.value)
          : await findUserIdByEmail(identity.value);
      } catch (error: unknown) {
        return handleError(error, 'searching for user', req);
      }

      if (resolveInviteAction(targetUserId) === 'create_pending_invite') {
        try {
          const invitation = await createInvitation(
            supabase,
            requestData.group_id,
            identity,
            currentUser.id
          );

          if (!invitation) {
            return createSuccessResponse({
              invitation: true,
              message: `An invitation has already been sent to this ${identity.kind}. The user will be added to the group when they sign up.`,
              [identity.kind]: identity.value,
            }, 200, 0, req);
          }

          return createSuccessResponse({
            invitation: true,
            message: 'Invitation sent successfully. The user will be added to the group when they sign up.',
            [identity.kind]: identity.value,
            invitation_id: invitation.id,
            token: invitation.token,
          }, 201, 0, req);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to create invitation';
          return handleError(new Error(errorMessage), 'creating invitation', req);
        }
      }

      // Check if user is already an active member
      const { data: existingMember } = await supabase
        .from('group_members')
        .select('id, status')
        .eq('group_id', requestData.group_id)
        .eq('user_id', targetUserId)
        .single();

      if (existingMember) {
        // Check if member has status column and if they're active
        if ('status' in existingMember && existingMember.status === 'active') {
          return createErrorResponse(400, 'User is already a member of this group', 'VALIDATION_ERROR', undefined, req);
        }
        
        // If member exists but is inactive (status='left'), re-activate them
        if ('status' in existingMember && existingMember.status === 'left') {
          const { data: reactivatedMember, error: reactivateError } = await supabase
            .from('group_members')
            .update({
              status: 'active',
              left_at: null,
              role: requestData.role || 'member',
            })
            .eq('group_id', requestData.group_id)
            .eq('user_id', targetUserId)
            .select('id, group_id, user_id, role, joined_at')
            .maybeSingle();

          if (reactivateError) {
            return handleError(reactivateError, 'reactivating member', req);
          }

          if (!reactivatedMember) {
            // If update didn't return a row, fetch it separately
            const { data: fetchedMember, error: fetchError } = await supabase
              .from('group_members')
              .select('id, group_id, user_id, role, joined_at')
              .eq('group_id', requestData.group_id)
              .eq('user_id', targetUserId)
              .single();

            if (fetchError || !fetchedMember) {
              return handleError(fetchError || new Error('Failed to fetch reactivated member'), 'reactivating member', req);
            }

            return createSuccessResponse({
              ...fetchedMember,
              [identity.kind]: identity.value,
            }, 200, 0, req);
          }

          return createSuccessResponse({
            ...reactivatedMember,
            [identity.kind]: identity.value,
          }, 200, 0, req);
        }
        
        // If no status column exists, they're already a member
        return createErrorResponse(400, 'User is already a member of this group', 'VALIDATION_ERROR', undefined, req);
      }

      const { data: pendingInvitation } = await supabase
        .from('group_invitations')
        .select('id')
        .eq('group_id', requestData.group_id)
        .eq(identity.column, identity.value)
        .eq('status', 'pending')
        .single();

      if (pendingInvitation && identity.kind === 'email') {
        const { error: acceptError } = await supabase.rpc('accept_group_invitation', {
          invitation_id: pendingInvitation.id,
          accepting_user_id: targetUserId,
        });

        if (!acceptError) {
          const { data: member } = await supabase
            .from('group_members')
            .select('id, group_id, user_id, role, joined_at')
            .eq('group_id', requestData.group_id)
            .eq('user_id', targetUserId)
            .single();

          if (member) {
            return createSuccessResponse({
              ...member,
              [identity.kind]: identity.value,
            }, 201, 0, req);
          }
        }
      } else if (pendingInvitation && identity.kind === 'phone') {
        const acceptedAt = new Date().toISOString();
        const { error: updateError } = await supabase
          .from('group_invitations')
          .update({
            status: 'accepted',
            accepted_at: acceptedAt,
            accepted_by: targetUserId,
          })
          .eq('id', pendingInvitation.id);

        if (updateError) {
          return handleError(updateError, 'accepting phone invitation for existing user', req);
        }

        const { error: participantUpdateError } = await supabase
          .from('participants')
          .update({
            user_id: targetUserId,
            phone: null,
            type: 'member',
            role: requestData.role || 'member',
            joined_at: acceptedAt,
            updated_at: acceptedAt,
          })
          .eq('group_id', requestData.group_id)
          .eq('phone', identity.value)
          .eq('type', 'invited');

        if (participantUpdateError) {
          return handleError(participantUpdateError, 'connecting phone invite participant', req);
        }
      }

      const { data: member, error: addError } = await supabase
        .from('group_members')
        .insert({
          group_id: requestData.group_id,
          user_id: targetUserId,
          role: requestData.role || 'member',
        })
        .select()
        .single();

      if (addError) {
        return handleError(addError, 'adding member', req);
      }

      return createSuccessResponse({
        ...member,
        [identity.kind]: identity.value,
      }, 201, 0, req);
    }

    if (httpMethod === 'DELETE') {
      const url = new URL(req.url);
      const groupId = url.searchParams.get('group_id');
      const providedUserId = url.searchParams.get('user_id');
      
      const userId = providedUserId || currentUser.id;

      if (!groupId) {
        return createErrorResponse(400, 'Missing group_id in query parameters', 'VALIDATION_ERROR', undefined, req);
      }

      if (!isValidUUID(groupId)) {
        return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      if (providedUserId && !isValidUUID(providedUserId)) {
        return createErrorResponse(400, 'Invalid user_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      const { data, error: rpcError } = await supabase.rpc('remove_group_member', {
        p_group_id: groupId,
        p_user_id: userId,
      });

      if (rpcError) {
        const errorMessage = rpcError.message || 'Failed to remove member';
        
        if (errorMessage.includes('not authenticated') || errorMessage.includes('Unauthorized')) {
          return createErrorResponse(401, 'Unauthorized', 'AUTH_ERROR', undefined, req);
        }
        
        if (errorMessage.includes('not a member')) {
          return createErrorResponse(404, 'User is not a member of this group', 'NOT_FOUND', undefined, req);
        }
        
        if (errorMessage.includes('Only group owners')) {
          return createErrorResponse(403, 'You can only remove yourself or be removed by group owner', 'PERMISSION_DENIED', undefined, req);
        }

        return handleError(rpcError, 'removing member', req);
      }

      return createSuccessResponse({ success: true, message: 'Member removed successfully' }, 200, 0, req);
    }

    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  } catch (error: unknown) {
    return handleError(error, 'group-members handler', req);
  }
});
