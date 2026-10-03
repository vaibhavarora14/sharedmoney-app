import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from './env.ts';
import { log } from './logger.ts';

/**
 * Looks up an existing auth user's id by email (exact, case-insensitive match).
 *
 * Uses the `get_user_id_by_email` SECURITY DEFINER Postgres function via the
 * service-role client. This replaces the previous (broken) approach of calling
 * `GET /auth/v1/admin/users?email=...` — GoTrue's admin list endpoint has no
 * `email` parameter, so it returned only the newest page of users and missed
 * older accounts, causing existing users to be "invited" instead of added.
 *
 * @returns the user id if a user with this email exists, otherwise null.
 * @throws if the service role key is missing or the lookup query fails.
 */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await adminClient.rpc('get_user_id_by_email', {
    p_email: email.toLowerCase().trim(),
  });

  if (error) {
    log.error('Failed to look up user by email', 'user-lookup', {
      error: error.message,
    });
    throw new Error(`Failed to look up user by email: ${error.message}`);
  }

  return (data as string | null) ?? null;
}

export async function findUserIdByPhone(phone: string): Promise<string | null> {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await adminClient
    .from('profiles')
    .select('id')
    .eq('phone', phone.trim())
    .maybeSingle();

  if (error) {
    log.error('Failed to look up user by phone', 'user-lookup', {
      error: error.message,
    });
    throw new Error(`Failed to look up user by phone: ${error.message}`);
  }

  return (data as { id: string } | null)?.id ?? null;
}
