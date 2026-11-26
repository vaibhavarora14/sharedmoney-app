import { verifyAuth } from '../_shared/auth.ts';
import { ACTIVITY_FEED_CONFIG } from '../_shared/constants.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { isValidUUID } from '../_shared/validation.ts';
import { loadActivityFeed, type LoadActivityResult } from './load-activity.ts';

/**
 * Activity Edge Function
 *
 * GET /activity?group_id=xxx&limit=50&offset=0
 *
 * @route /functions/v1/activity
 * @requires Authentication
 */

function activityResponse(loaded: LoadActivityResult, req: Request): Response {
  switch (loaded.kind) {
    case "ok":
      return createSuccessResponse(loaded.body, 200, 0, req);
    case "forbidden":
      return createErrorResponse(
        403,
        "You must be a member of the group to view activity",
        "PERMISSION_DENIED",
        undefined,
        req,
      );
    case "error":
      return handleError(loaded.error, loaded.context, req);
    default: {
      const _never: never = loaded;
      return handleError(new Error(String(_never)), "activity handler", req);
    }
  }
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

    const loaded = await loadActivityFeed(
      supabase,
      { id: user.id, email: user.email || null },
      groupId,
      limit,
      offset,
    );
    return activityResponse(loaded, req);
  } catch (error: unknown) {
    return handleError(error, 'activity handler', req);
  }
});
