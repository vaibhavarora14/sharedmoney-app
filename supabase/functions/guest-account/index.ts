import { verifyAuth } from '../_shared/auth.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { guestSignInRequiredResponse } from '../_shared/guest.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { validateBodySize } from '../_shared/validation.ts';

type GuestAction = 'token' | 'preview' | 'merge' | 'discard' | 'delete';

interface GuestAccountBody {
  action?: GuestAction;
  guest_user_id?: string;
  token?: string;
}

function isAction(value: string | undefined): value is GuestAction {
  return value === 'token'
    || value === 'preview'
    || value === 'merge'
    || value === 'discard'
    || value === 'delete';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return createEmptyResponse(200, req);
  if (req.method !== 'POST') {
    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  }

  try {
    const bodyText = await req.text().catch(() => null);
    const size = validateBodySize(bodyText);
    if (!size.valid) {
      return createErrorResponse(413, size.error || 'Request body too large', 'VALIDATION_ERROR', undefined, req);
    }

    const authResult = await verifyAuth(req);
    const { supabase } = authResult;
    let body: GuestAccountBody = {};
    if (bodyText) {
      try {
        body = JSON.parse(bodyText) as GuestAccountBody;
      } catch {
        return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
      }
    }
    if (!isAction(body.action)) {
      return createErrorResponse(400, 'Missing guest action', 'VALIDATION_ERROR', undefined, req);
    }

    if (body.action === 'token' || body.action === 'delete') {
      if (!authResult.isAnonymous) {
        return createErrorResponse(400, 'This action is only for a guest session', 'VALIDATION_ERROR', undefined, req);
      }
    } else if (authResult.isAnonymous) {
      return guestSignInRequiredResponse(req);
    }

    if (body.action === 'token') {
      const { data, error } = await supabase.rpc('mint_guest_merge_token');
      if (error) return handleError(error, 'mint guest token', req);
      const [{ count: groups }, { count: expenses }] = await Promise.all([
        supabase.from('groups').select('id', { count: 'exact', head: true }).eq('created_by', authResult.user.id),
        supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', authResult.user.id),
      ]);
      return createSuccessResponse({
        token: data,
        group_count: groups ?? 0,
        expense_count: expenses ?? 0,
      }, 200, 0, req);
    }

    if (body.action === 'delete') {
      const { data, error } = await supabase.rpc('delete_own_guest_data');
      if (error) return handleError(error, 'delete guest data', req);
      return createSuccessResponse(data, 200, 0, req);
    }

    if (!body.guest_user_id || !body.token) {
      return createErrorResponse(400, 'Missing guest id or token', 'VALIDATION_ERROR', undefined, req);
    }

    const rpc = body.action === 'preview'
      ? 'preview_guest_merge'
      : body.action === 'merge'
        ? 'merge_guest_into_user'
        : 'discard_guest_data';
    const { data, error } = await supabase.rpc(rpc, {
      p_guest_user_id: body.guest_user_id,
      p_merge_token: body.token,
    });
    if (error) return handleError(error, `guest ${body.action}`, req);
    return createSuccessResponse(data, 200, 0, req);
  } catch (error) {
    return handleError(error, 'guest account', req);
  }
});
