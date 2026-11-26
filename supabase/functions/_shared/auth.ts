import { createClient } from 'jsr:@supabase/supabase-js@2';
import { resolveAuthenticatedUser } from './auth-claims.ts';
import { scheduleBackgroundWork } from './background.ts';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env.ts';
import { recordLastSeenAppFromRequest } from './last-seen-app.ts';
import { log } from './logger.ts';

export interface UserInfo {
  id: string;
  email: string | null;
}

/**
 * Verifies the user's authentication token and returns user info
 * Throws an error if authentication fails
 */
export async function verifyAuth(request: Request): Promise<{
  user: UserInfo;
  supabase: any;
  isAnonymous: boolean;
}> {

  // Get authorization header
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  
  if (!authHeader) {
    throw new Error('Unauthorized: Missing authorization header');
  }

  // Create Supabase client with auth header
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // JWKS-backed getClaims is local on a warm isolate. getUser is a
  // sequential Auth hop from the caller's region to the project.
  const user = await resolveAuthenticatedUser(supabase.auth, authHeader);

  // Last-seen version is for reminder emails, not the response. Do not
  // add a sequential DB round trip to every authenticated request (#486).
  scheduleBackgroundWork(
    recordLastSeenAppFromRequest(supabase, user.id, request),
    'last-seen-app',
  );

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    supabase,
    isAnonymous: user.isAnonymous,
  };
}

/**
 * Records X-App-Version when the caller has a session.
 * HTTP 426 still wins when the session is missing or expired.
 */
export async function recordLastSeenAppIfAuthenticated(request: Request): Promise<void> {
  try {
    await verifyAuth(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('Unauthorized')) {
      log.warn('Last-seen app version was not recorded before upgrade response', 'auth', {
        error: message.slice(0, 200),
      });
    }
  }
}
