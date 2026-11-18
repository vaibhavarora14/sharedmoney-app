import { verifyAuth } from '../_shared/auth.ts';
import { isUniqueViolation, isoDateWithinHorizon, parseClientRequestId } from '../_shared/clientRequestId.ts';
import { classifyDatabaseWriteError } from '../_shared/database-write-error.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { fetchUserEmails } from '../_shared/user-email.ts';
import { isValidDate, isValidUUID, validateBodySize, validateSettlementData } from '../_shared/validation.ts';
import { broadcastToGroup } from '../_shared/realtime-broadcast.ts';

/**
 * Settlements Edge Function
 * 
 * Handles CRUD operations for settlements (payments between users):
 * - GET /settlements?group_id=xxx - List settlements (optionally filtered by group)
 * - POST /settlements - Create new settlement
 * - PUT /settlements - Update existing settlement
 * - DELETE /settlements?id=xxx - Delete settlement
 * 
 * @route /functions/v1/settlements
 * @requires Authentication
 */

interface Settlement {
  id: string;
  group_id: string;
  from_participant_id: string;
  to_participant_id: string;
  from_user_id?: string; // Kept for logic, but participant is primary
  to_user_id?: string;
  amount: number;
  currency: string;
  notes?: string;
  created_by: string;
  created_at: string;
  from_user_email?: string;
  to_user_email?: string;
  from_full_name?: string;
  to_full_name?: string;
}

interface CreateSettlementRequest {
  group_id: string;
  from_participant_id: string;
  to_participant_id: string;
  amount: number;
  currency?: string;
  notes?: string;
  /** YYYY-MM-DD. Stored as created_at so a backdated payment keeps its day. */
  date?: string;
  client_request_id?: string;
}

interface UpdateSettlementRequest {
  id: string;
  amount?: number;
  currency?: string;
  notes?: string;
  from_participant_id?: string;
  to_participant_id?: string;
  /** YYYY-MM-DD payment date; maps to settlements.created_at */
  date?: string;
  group_id?: string;
}

async function canManageGroupSettlement(
  supabase: any,
  groupId: string,
  createdBy: string,
  currentUserId: string
): Promise<boolean> {
  // Match expense update/delete: creator OR any group member
  if (createdBy === currentUserId) {
    return true;
  }

  const { data: groupMember, error: memberError } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', currentUserId)
    .maybeSingle();

  return !memberError && !!groupMember;
}

function parseSettlementDateToCreatedAt(date: string): string | null {
  if (!isValidDate(date)) {
    return null;
  }
  // Keep a stable midday UTC so local calendars don't shift the day
  return `${date}T12:00:00.000Z`;
}

async function enrichSettlementsWithParticipants(
  supabase: any,
  settlements: Settlement[],
  currentUserId: string,
  currentUserEmail: string | null
): Promise<void> {
  if (settlements.length === 0) {
    return;
  }

  const participantIds = new Set<string>();
  settlements.forEach(s => {
    participantIds.add(s.from_participant_id);
    participantIds.add(s.to_participant_id);
  });

  const { data: participants } = await supabase
    .from('participants')
    .select('id, user_id, email, full_name')
    .in('id', Array.from(participantIds));

  if (!participants) return;

  const participantMap = new Map<string, any>();
  participants.forEach((p: any) => participantMap.set(p.id, p));
  
  const userIdsToFetch = participants
    .filter((p: any) => p.user_id)
    .map((p: any) => p.user_id!);
    
  const emailMap = await fetchUserEmails(userIdsToFetch, currentUserId, currentUserEmail);

  settlements.forEach(s => {
    const fromP = participantMap.get(s.from_participant_id);
    const toP = participantMap.get(s.to_participant_id);

    if (fromP) {
      s.from_user_id = fromP.user_id || undefined;
      s.from_user_email = fromP.email || (fromP.user_id ? emailMap.get(fromP.user_id) : undefined);
      s.from_full_name = fromP.full_name || undefined;
    }
    if (toP) {
      s.to_user_id = toP.user_id || undefined;
      s.to_user_email = toP.email || (toP.user_id ? emailMap.get(toP.user_id) : undefined);
      s.to_full_name = toP.full_name || undefined;
    }
  });
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

    const { user, supabase } = authResult;
    const currentUserId = user.id;
    const currentUserEmail = user.email;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const groupId = url.searchParams.get('group_id');
      
      if (groupId && !isValidUUID(groupId)) {
        return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      let query = supabase
        .from('settlements')
        .select('id, group_id, from_participant_id, to_participant_id, amount, currency, notes, created_by, created_at')
        .order('created_at', { ascending: false });

      if (groupId) {
        // Simple membership check via participants (since everyone is a participant)
        const { data: memberParticipant } = await supabase
          .from('participants')
          .select('id')
          .eq('group_id', groupId)
          .eq('user_id', currentUserId)
          .maybeSingle();

        if (!memberParticipant) {
          return createErrorResponse(403, 'Forbidden: Not a member of this group', 'PERMISSION_DENIED', undefined, req);
        }

        query = query.eq('group_id', groupId);
      } else {
        // For global settlements, we'd need a more complex query joining with participants
        // For now, let's stick to group-based or creator-based
        query = query.eq('created_by', currentUserId);
      }

      const { data: settlements, error } = await query;

      if (error) {
        return handleError(error, 'fetching settlements', req);
      }

      const enrichedSettlements = (settlements || []) as Settlement[];
      await enrichSettlementsWithParticipants(
        supabase,
        enrichedSettlements,
        currentUserId,
        currentUserEmail
      );

      return createSuccessResponse({ settlements: enrichedSettlements }, 200, 0, req);
    }

    if (req.method === 'POST') {
      if (!body) {
        return createErrorResponse(400, 'Request body is required', 'VALIDATION_ERROR', undefined, req);
      }

      let settlementData: CreateSettlementRequest;
      try {
        settlementData = JSON.parse(body);
      } catch {
        return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
      }

      const validation = validateSettlementData(settlementData);
      if (!validation.valid) {
        return createErrorResponse(400, validation.error || 'Invalid settlement data', 'VALIDATION_ERROR', undefined, req);
      }

      const requestId = parseClientRequestId(settlementData.client_request_id);
      if (!requestId.ok) {
        return createErrorResponse(400, requestId.error, 'VALIDATION_ERROR', undefined, req);
      }

      let createdAt: string | undefined;
      if (settlementData.date) {
        if (!isValidDate(settlementData.date) || !isoDateWithinHorizon(settlementData.date)) {
          return createErrorResponse(400, 'Date must be today or earlier', 'VALIDATION_ERROR', undefined, req);
        }
        const parsed = parseSettlementDateToCreatedAt(settlementData.date);
        if (!parsed) {
          return createErrorResponse(400, 'Invalid date format (expected YYYY-MM-DD)', 'VALIDATION_ERROR', undefined, req);
        }
        createdAt = parsed;
      }

      if (requestId.id) {
        const { data: existing, error: existingError } = await supabase
          .from('settlements')
          .select('id, group_id, from_participant_id, to_participant_id, amount, currency, notes, created_by, created_at')
          .eq('created_by', currentUserId)
          .eq('client_request_id', requestId.id)
          .maybeSingle();
        if (existingError) {
          return handleError(existingError, 'checking settlement idempotency', req);
        }
        if (existing) {
          const replay = existing as Settlement;
          await enrichSettlementsWithParticipants(supabase, [replay], currentUserId, currentUserEmail);
          return createSuccessResponse({ settlement: replay }, 200, 0, req);
        }
      }

      if (!settlementData.group_id || !settlementData.from_participant_id || !settlementData.to_participant_id || !settlementData.amount) {
        return createErrorResponse(400, 'Missing required fields: group_id, from_participant_id, to_participant_id, amount', 'VALIDATION_ERROR', undefined, req);
      }

      // Verify group membership of the creator
      const { data: creatorParticipant } = await supabase
        .from('participants')
        .select('id')
        .eq('group_id', settlementData.group_id)
        .eq('user_id', currentUserId)
        .maybeSingle();

      if (!creatorParticipant) {
        return createErrorResponse(403, 'Forbidden: Not a member of this group', 'PERMISSION_DENIED', undefined, req);
      }

      // A former member keeps their participant row, so the check above passes.
      // Insert RLS still requires group_members.status = 'active'. Failing that
      // check inside the insert comes back as a PostgREST error object, which
      // handleError used to turn into 500 "Internal server error" — the
      // "Couldn't settle all groups" alert (Sentry REACT-NATIVE-22).
      const { data: activeMembership, error: membershipError } = await supabase
        .from('group_members')
        .select('status')
        .eq('group_id', settlementData.group_id)
        .eq('user_id', currentUserId)
        .eq('status', 'active')
        .maybeSingle();

      if (membershipError) {
        return handleError(membershipError, 'checking settlement membership', req);
      }
      if (!activeMembership) {
        return createErrorResponse(403, 'Not an active group member', 'PERMISSION_DENIED', undefined, req);
      }

      const { data: settlement, error } = await supabase
        .from('settlements')
        .insert({
          group_id: settlementData.group_id,
          from_participant_id: settlementData.from_participant_id,
          to_participant_id: settlementData.to_participant_id,
          amount: settlementData.amount,
          currency: settlementData.currency || 'USD',
          notes: settlementData.notes || null,
          created_by: currentUserId,
          ...(requestId.id ? { client_request_id: requestId.id } : {}),
          ...(createdAt ? { created_at: createdAt } : {}),
        })
        .select()
        .single();

      if (error && requestId.id && isUniqueViolation(error)) {
        const { data: existing } = await supabase
          .from('settlements')
          .select('id, group_id, from_participant_id, to_participant_id, amount, currency, notes, created_by, created_at')
          .eq('created_by', currentUserId)
          .eq('client_request_id', requestId.id)
          .maybeSingle();
        if (existing) {
          const replay = existing as Settlement;
          await enrichSettlementsWithParticipants(supabase, [replay], currentUserId, currentUserEmail);
          return createSuccessResponse({ settlement: replay }, 200, 0, req);
        }
      }

      if (error) {
        const classified = classifyDatabaseWriteError(error);
        if (classified) {
          return createErrorResponse(
            classified.status,
            classified.error,
            classified.code,
            undefined,
            req,
          );
        }
        return handleError(error, 'creating settlement', req);
      }

      const enrichedSettlement = settlement as Settlement;
      await enrichSettlementsWithParticipants(
        supabase,
        [enrichedSettlement],
        currentUserId,
        currentUserEmail
      );

      if (settlement?.group_id) {
        broadcastToGroup(settlement.group_id, 'DATA_MUTATED', {
          entity: 'settlements',
          action: 'create',
          settlementId: settlement.id,
        }).catch(() => {});
      }

      return createSuccessResponse({ settlement: enrichedSettlement }, 201, 0, req);
    }

    if (req.method === 'PUT') {
      if (!body) {
        return createErrorResponse(400, 'Request body is required', 'VALIDATION_ERROR', undefined, req);
      }

      let updateData: UpdateSettlementRequest;
      try {
        updateData = JSON.parse(body);
      } catch {
        return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
      }

      if (!updateData.id) {
        return createErrorResponse(400, 'Settlement id is required', 'VALIDATION_ERROR', undefined, req);
      }

      if (!isValidUUID(updateData.id)) {
        return createErrorResponse(400, 'Invalid settlement id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      const validation = validateSettlementData({
        amount: updateData.amount,
        currency: updateData.currency,
        from_participant_id: updateData.from_participant_id,
        to_participant_id: updateData.to_participant_id,
      });
      if (!validation.valid) {
        return createErrorResponse(400, validation.error || 'Invalid settlement data', 'VALIDATION_ERROR', undefined, req);
      }

      if (updateData.date !== undefined && !isValidDate(updateData.date)) {
        return createErrorResponse(400, 'Invalid date format (expected YYYY-MM-DD)', 'VALIDATION_ERROR', undefined, req);
      }

      const { data: existingSettlement, error: fetchError } = await supabase
        .from('settlements')
        .select('id, group_id, created_by, from_participant_id, to_participant_id')
        .eq('id', updateData.id)
        .single();

      if (fetchError || !existingSettlement) {
        return createErrorResponse(404, 'Settlement not found', 'NOT_FOUND', undefined, req);
      }

      const allowed = await canManageGroupSettlement(
        supabase,
        existingSettlement.group_id,
        existingSettlement.created_by,
        currentUserId
      );
      if (!allowed) {
        return createErrorResponse(
          403,
          'You can only update settlements you created or settlements in groups you belong to',
          'PERMISSION_DENIED',
          undefined,
          req
        );
      }

      const nextFromParticipantId =
        updateData.from_participant_id ?? existingSettlement.from_participant_id;
      const nextToParticipantId =
        updateData.to_participant_id ?? existingSettlement.to_participant_id;

      if (nextFromParticipantId === nextToParticipantId) {
        return createErrorResponse(
          400,
          'from_participant_id and to_participant_id must be different',
          'VALIDATION_ERROR',
          undefined,
          req
        );
      }

      if (
        updateData.from_participant_id !== undefined ||
        updateData.to_participant_id !== undefined
      ) {
        const participantIds = [nextFromParticipantId, nextToParticipantId];
        const { data: participants, error: participantsError } = await supabase
          .from('participants')
          .select('id')
          .eq('group_id', existingSettlement.group_id)
          .in('id', participantIds);

        if (participantsError) {
          return handleError(participantsError, 'validating settlement participants', req);
        }

        if (!participants || participants.length !== 2) {
          return createErrorResponse(
            400,
            'Both participants must belong to this group',
            'VALIDATION_ERROR',
            undefined,
            req
          );
        }
      }

      const updateFields: Record<string, unknown> = {};
      if (updateData.amount !== undefined) updateFields.amount = updateData.amount;
      if (updateData.currency !== undefined) updateFields.currency = updateData.currency;
      if (updateData.notes !== undefined) updateFields.notes = updateData.notes || null;
      if (updateData.from_participant_id !== undefined) {
        updateFields.from_participant_id = updateData.from_participant_id;
      }
      if (updateData.to_participant_id !== undefined) {
        updateFields.to_participant_id = updateData.to_participant_id;
      }
      if (updateData.date !== undefined) {
        const createdAt = parseSettlementDateToCreatedAt(updateData.date);
        if (!createdAt) {
          return createErrorResponse(400, 'Invalid date format (expected YYYY-MM-DD)', 'VALIDATION_ERROR', undefined, req);
        }
        updateFields.created_at = createdAt;
      }

      if (Object.keys(updateFields).length === 0) {
        return createErrorResponse(400, 'No fields to update', 'VALIDATION_ERROR', undefined, req);
      }

      const { data: updatedSettlement, error: updateError } = await supabase
        .from('settlements')
        .update(updateFields)
        .eq('id', updateData.id)
        .select()
        .single();

      if (updateError) {
        return handleError(updateError, 'updating settlement', req);
      }

      const enrichedSettlement = updatedSettlement as Settlement;
      await enrichSettlementsWithParticipants(
        supabase,
        [enrichedSettlement],
        currentUserId,
        currentUserEmail
      );

      if (updatedSettlement?.group_id) {
        broadcastToGroup(updatedSettlement.group_id, 'DATA_MUTATED', {
          entity: 'settlements',
          action: 'update',
          settlementId: updatedSettlement.id,
        }).catch(() => {});
      }

      return createSuccessResponse({ settlement: enrichedSettlement }, 200, 0, req);
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const settlementId = url.searchParams.get('id');

      if (!settlementId) {
        return createErrorResponse(400, 'Settlement id is required', 'VALIDATION_ERROR', undefined, req);
      }

      if (!isValidUUID(settlementId)) {
        return createErrorResponse(400, 'Invalid settlement id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
      }

      const { data: existingSettlement, error: fetchError } = await supabase
        .from('settlements')
        .select('id, group_id, created_by')
        .eq('id', settlementId)
        .single();

      if (fetchError || !existingSettlement) {
        return createErrorResponse(404, 'Settlement not found', 'NOT_FOUND', undefined, req);
      }

      const allowed = await canManageGroupSettlement(
        supabase,
        existingSettlement.group_id,
        existingSettlement.created_by,
        currentUserId
      );
      if (!allowed) {
        return createErrorResponse(
          403,
          'Forbidden: You can only delete settlements you created or settlements in groups you belong to',
          'PERMISSION_DENIED',
          undefined,
          req
        );
      }

      const { error: deleteError } = await supabase
        .from('settlements')
        .delete()
        .eq('id', settlementId);

      if (deleteError) {
        return handleError(deleteError, 'deleting settlement', req);
      }

      if (existingSettlement?.group_id) {
        broadcastToGroup(existingSettlement.group_id, 'DATA_MUTATED', {
          entity: 'settlements',
          action: 'delete',
          settlementId,
        }).catch(() => {});
      }

      return createEmptyResponse(204, req);
    }

    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  } catch (error: unknown) {
    return handleError(error, 'settlements handler', req);
  }
});
