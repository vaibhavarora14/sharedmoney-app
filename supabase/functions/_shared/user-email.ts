import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './env.ts';
import { log } from './logger.ts';

interface UserResponse {
  id: string;
  email?: string;
  user?: {
    email?: string;
  };
}

/**
 * Fetches email for a single user ID using Supabase Admin API.
 * Fallback when the batch RPC is unavailable.
 */
async function fetchUserEmail(
  userId: string,
  currentUserId: string,
  currentUserEmail: string | null
): Promise<string | null> {
  if (userId === currentUserId && currentUserEmail) {
    return currentUserEmail;
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  try {
    const userResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${userId}`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    
    if (userResponse.ok) {
      const userData = await userResponse.json() as UserResponse;
      return userData.user?.email || userData.email || null;
    } else {
      log.warn('Failed to fetch user email', 'user-email', {
        userId,
        status: userResponse.status,
      });
    }
  } catch (err) {
    log.error('Error fetching user email', 'user-email', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  
  return null;
}

/**
 * Batch fetches emails for multiple user IDs via get_user_emails_by_ids RPC.
 * Falls back to per-user Admin GETs only if the RPC fails.
 */
export async function fetchUserEmails(
  userIds: string[],
  currentUserId: string,
  currentUserEmail: string | null
): Promise<Map<string, string>> {
  const emailMap = new Map<string, string>();
  
  if (userIds.length === 0) {
    return emailMap;
  }

  // Filter out non-UUID values (emails, etc.) - only process valid UUIDs
  // UUID pattern: 8-4-4-4-12 hexadecimal characters
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validUserIds = userIds.filter(id => uuidPattern.test(id));

  if (validUserIds.length === 0) {
    return emailMap;
  }

  // Add current user email if in the list
  if (currentUserEmail && validUserIds.includes(currentUserId)) {
    emailMap.set(currentUserId, currentUserEmail);
  }

  // Filter out current user ID since we already have their email
  const userIdsToFetch = validUserIds.filter(id => id !== currentUserId);
  
  if (userIdsToFetch.length === 0) {
    return emailMap;
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    log.warn('SUPABASE_SERVICE_ROLE_KEY not set, skipping email enrichment', 'user-email');
    return emailMap;
  }

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await adminClient.rpc('get_user_emails_by_ids', {
      p_ids: userIdsToFetch,
    });

    if (!error && Array.isArray(data)) {
      for (const row of data as Array<{ id: string; email: string | null }>) {
        if (row?.id && row?.email) {
          emailMap.set(row.id, row.email);
        }
      }
      return emailMap;
    }

    if (error) {
      log.warn('get_user_emails_by_ids RPC failed; falling back to Admin GETs', 'user-email', {
        error: error.message,
        userIdCount: userIdsToFetch.length,
      });
    }
  } catch (err) {
    log.warn('get_user_emails_by_ids threw; falling back to Admin GETs', 'user-email', {
      error: err instanceof Error ? err.message : String(err),
      userIdCount: userIdsToFetch.length,
    });
  }

  // Fallback: parallel Admin GETs in batches (pre-migration / RPC unavailable)
  try {
    const batchSize = 50;
    for (let i = 0; i < userIdsToFetch.length; i += batchSize) {
      const batch = userIdsToFetch.slice(i, i + batchSize);
      
      const emailPromises = batch.map(userId => 
        fetchUserEmail(userId, currentUserId, currentUserEmail)
      );
      
      const emailResults = await Promise.allSettled(emailPromises);
      
      emailResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          emailMap.set(batch[index], result.value);
        }
      });
    }
  } catch (err) {
    log.error('Error in batchFetchUserEmails fallback', 'user-email', {
      error: err instanceof Error ? err.message : String(err),
      userIdCount: userIdsToFetch.length,
    });
  }

  return emailMap;
}
