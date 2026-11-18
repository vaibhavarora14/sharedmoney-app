import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/env.ts';
import { guestCleanupMayRun } from '../_shared/guest.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';

/**
 * 60-day guest purge. Ships disabled.
 * GUEST_CLEANUP_ENABLED must be the exact string "true", and
 * guest_runtime_config.cleanup_enabled must also be true.
 * This function is not on a cron schedule.
 */
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return createEmptyResponse(200, req);
  if (req.method !== 'POST') {
    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  }

  if (!guestCleanupMayRun(Deno.env.get('GUEST_CLEANUP_ENABLED'))) {
    return createSuccessResponse({ enabled: false, deleted: 0 }, 200, 0, req);
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return createSuccessResponse({ enabled: false, deleted: 0 }, 200, 0, req);
  }

  try {
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await serviceClient.rpc('purge_inactive_guests');
    if (error) return handleError(error, 'purge inactive guests', req);
    return createSuccessResponse({
      enabled: true,
      deleted: typeof data === 'number' ? data : 0,
    }, 200, 0, req);
  } catch (error) {
    return handleError(error, 'guest cleanup', req);
  }
});
