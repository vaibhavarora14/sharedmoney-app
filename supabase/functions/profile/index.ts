import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuth } from '../_shared/auth.ts';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/env.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { buildTermsAcceptanceUpdate } from '../_shared/profile.ts';
import { normalizeOptionalCurrency } from '../_shared/rates.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import {
  getOptionalUpiIdFormatError,
  normalizeUpiId,
} from '../_shared/upi.ts';
import { fetchUserEmails } from '../_shared/user-email.ts';
import { validateBodySize } from '../_shared/validation.ts';

interface Profile {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
  country_code?: string | null;
  profile_completed: boolean;
  terms_accepted_at?: string | null;
  terms_version?: string | null;
  preferred_currency?: string | null;
  upi_id?: string | null;
  created_at: string;
  updated_at: string;
}

type ProfileUpdates = Partial<Pick<Profile, 'full_name' | 'avatar_url' | 'phone' | 'country_code' | 'profile_completed' | 'preferred_currency' | 'upi_id'>>;
type ProfileUpdateRequest = ProfileUpdates & { accept_terms?: boolean };

interface ValidationResult {
  valid: boolean;
  error?: string;
}

const POSTGREST_NO_ROWS_CODE = 'PGRST116';

// Valid ISO 3166-1 alpha-2 country codes
// This is a comprehensive list of all valid 2-letter country codes
const VALID_COUNTRY_CODES = new Set([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
]);

function trimOrUndefined(value?: string | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateProfileUpdates(updates: ProfileUpdateRequest): ValidationResult {
  if (updates.full_name !== undefined && updates.full_name !== null) {
    if (typeof updates.full_name !== 'string') {
      return { valid: false, error: 'Full name must be a string' };
    }

    const trimmedName = updates.full_name.trim();
    if (trimmedName.length === 0) {
      return { valid: false, error: 'Full name cannot be empty' };
    }

    if (trimmedName.length > 255) {
      return { valid: false, error: 'Full name must be 255 characters or less' };
    }
  }

  if (updates.avatar_url !== undefined && updates.avatar_url !== null) {
    if (typeof updates.avatar_url !== 'string') {
      return { valid: false, error: 'Avatar URL must be a string' };
    }

    try {
      // Throws if invalid
      new URL(updates.avatar_url);
    } catch {
      return { valid: false, error: 'Invalid avatar URL format' };
    }
  }

  if (updates.phone !== undefined && updates.phone !== null) {
    if (typeof updates.phone !== 'string') {
      return { valid: false, error: 'Phone number must be a string' };
    }

    const trimmedPhone = updates.phone.trim();
    if (trimmedPhone.length > 20) {
      return { valid: false, error: 'Phone number must be 20 characters or less' };
    }

    const phoneRegex = /^\+?[\d\s\-()]{7,20}$/;
    if (trimmedPhone.length > 0 && !phoneRegex.test(trimmedPhone)) {
      return { valid: false, error: 'Invalid phone number format' };
    }
  }

  if (updates.country_code !== undefined && updates.country_code !== null) {
    if (typeof updates.country_code !== 'string') {
      return { valid: false, error: 'Country code must be a string' };
    }

    const trimmedCode = updates.country_code.trim().toUpperCase();
    // ISO 3166-1 alpha-2 country codes are exactly 2 characters
    if (trimmedCode.length !== 2) {
      return { valid: false, error: 'Country code must be a 2-character ISO code (e.g., US, CA, IN)' };
    }

    // Validate it's only letters
    if (!/^[A-Z]{2}$/.test(trimmedCode)) {
      return { valid: false, error: 'Country code must contain only letters' };
    }

    // Validate against list of valid ISO 3166-1 alpha-2 country codes
    if (!VALID_COUNTRY_CODES.has(trimmedCode)) {
      return { valid: false, error: `Invalid country code: ${trimmedCode}. Must be a valid ISO 3166-1 alpha-2 code (e.g., US, CA, IN, GB)` };
    }
  }

  if (updates.profile_completed !== undefined && typeof updates.profile_completed !== 'boolean') {
    return { valid: false, error: 'profile_completed must be a boolean value' };
  }

  if (updates.accept_terms !== undefined && updates.accept_terms !== true) {
    return { valid: false, error: 'Terms must be explicitly accepted' };
  }

  if (updates.preferred_currency !== undefined) {
    const currency = normalizeOptionalCurrency(updates.preferred_currency);
    if (!currency.valid) {
      return { valid: false, error: currency.error || 'Invalid preferred currency' };
    }
  }

  if (updates.upi_id !== undefined && updates.upi_id !== null) {
    if (typeof updates.upi_id !== 'string') {
      return { valid: false, error: 'UPI ID must be a string' };
    }
    const upiError = getOptionalUpiIdFormatError(updates.upi_id);
    if (upiError) {
      return { valid: false, error: upiError };
    }
  }

  return { valid: true };
}

/**
 * User IDs that share at least one active group with the viewer (plus self).
 * Used to gate upi_id on service-role batch reads (RLS is bypassed there).
 */
async function sharedGroupUserIds(
  serviceClient: ReturnType<typeof createClient>,
  viewerId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  const allowed = new Set<string>([viewerId]);
  const others = candidateIds.filter((id) => id && id !== viewerId);
  if (others.length === 0) return allowed;

  const { data: myMemberships, error: myError } = await serviceClient
    .from('group_members')
    .select('group_id')
    .eq('user_id', viewerId)
    .eq('status', 'active');

  if (myError || !myMemberships?.length) {
    return allowed;
  }

  const groupIds = myMemberships.map((row: { group_id: string }) => row.group_id);
  const { data: coMembers, error: coError } = await serviceClient
    .from('group_members')
    .select('user_id')
    .in('group_id', groupIds)
    .in('user_id', others)
    .eq('status', 'active');

  if (coError) {
    return allowed;
  }

  for (const row of coMembers || []) {
    if (row.user_id) allowed.add(row.user_id);
  }
  return allowed;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return createEmptyResponse(200, req);
  }

  try {
    const bodyText = await req.text().catch(() => null);
    const bodyValidation = validateBodySize(bodyText);

    if (!bodyValidation.valid) {
      return createErrorResponse(413, bodyValidation.error || 'Request body too large', 'VALIDATION_ERROR', undefined, req);
    }

    let authResult;
    try {
      authResult = await verifyAuth(req);
    } catch (authError) {
      return handleError(authError, 'authentication', req);
    }

    const { user, supabase } = authResult;
    const method = req.method;

    if (method === 'GET') {
      const url = new URL(req.url);
      const userIdsParam = url.searchParams.get('user_ids');
      
      // Support batch fetching profiles by user_ids
      if (userIdsParam) {
        try {
          const userIds = JSON.parse(userIdsParam) as string[];
          
          if (!Array.isArray(userIds) || userIds.length === 0) {
            return createErrorResponse(400, 'user_ids must be a non-empty array', 'VALIDATION_ERROR', undefined, req);
          }
          
          // Limit batch size for performance
          if (userIds.length > 100) {
            return createErrorResponse(400, 'Maximum 100 user_ids allowed per request', 'VALIDATION_ERROR', undefined, req);
          }
          
          // Use service role client to bypass RLS for batch profile fetching
          // This allows fetching profiles for any user, not just the authenticated user
          if (!SUPABASE_SERVICE_ROLE_KEY) {
            return createErrorResponse(
              500,
              'Server configuration error: Service role key not configured. This is required for batch profile fetching.',
              'CONFIGURATION_ERROR',
              undefined,
              req
            );
          }
          
          const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          });
          
          // Fetch profile fields using service role (bypasses RLS). upi_id is
          // stripped below unless the viewer shares an active group membership.
          const { data: profiles, error } = await serviceClient
            .from('profiles')
            .select('id, full_name, avatar_url, phone, country_code, profile_completed, upi_id, created_at, updated_at')
            .in('id', userIds);
          
          if (error) {
            return handleError(error, 'fetching profiles', req);
          }

          const upiAllowedIds = await sharedGroupUserIds(serviceClient, user.id, userIds);
          
          // Enrich profiles with email addresses
          const emailMap = await fetchUserEmails(userIds, user.id, user.email || null);
          
          // Create a map of existing profiles
          const profileMap = new Map((profiles || []).map(p => [p.id, p]));
          
          // Create enriched profiles for all requested user IDs
          // Include users even if they don't have a profile record (they might have an email)
          const enrichedProfiles = userIds.map(userId => {
            const existingProfile = profileMap.get(userId);
            const email = emailMap.get(userId) || null;
            const canSeeUpi = upiAllowedIds.has(userId);
            
            if (existingProfile) {
              return {
                ...existingProfile,
                upi_id: canSeeUpi ? (existingProfile.upi_id ?? null) : null,
                email,
              };
            } else {
              // Return minimal profile for users without profile records
              return {
                id: userId,
                full_name: null,
                avatar_url: null,
                phone: null,
                country_code: null,
                profile_completed: false,
                upi_id: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                email,
              };
            }
          });
          
          return createSuccessResponse(enrichedProfiles, 200, 0, req);
        } catch (parseError) {
          return createErrorResponse(400, 'Invalid user_ids format. Expected JSON array.', 'VALIDATION_ERROR', undefined, req);
        }
      }
      
      // Single profile fetch (existing behavior)
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        if (error.code === POSTGREST_NO_ROWS_CODE) {
          const { data: newProfile, error: insertError } = await supabase
            .from('profiles')
            .insert({
              id: user.id,
              profile_completed: false,
            })
            .select('*')
            .single();

          if (insertError) {
            return handleError(insertError, 'creating profile', req);
          }

          return createSuccessResponse(newProfile, 200, 0, req);
        }

        return handleError(error, 'fetching profile', req);
      }

      return createSuccessResponse(profile, 200, 0, req);
    }

    if (method === 'PUT') {
      if (!bodyText) {
        return createErrorResponse(400, 'Request body is required', 'VALIDATION_ERROR', undefined, req);
      }

      let updates: ProfileUpdateRequest;
      try {
        updates = JSON.parse(bodyText) as ProfileUpdateRequest;
      } catch {
        return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
      }

      const validation = validateProfileUpdates(updates);
      if (!validation.valid) {
        return createErrorResponse(400, validation.error || 'Invalid profile data', 'VALIDATION_ERROR', undefined, req);
      }

      if (updates.profile_completed === true) {
        const fullName = trimOrUndefined(updates.full_name);
        if (!fullName) {
          return createErrorResponse(400, 'Full name is required to complete profile', 'VALIDATION_ERROR', undefined, req);
        }
      }

      const sanitizedUpdates: ProfileUpdates & {
        updated_at: string;
        terms_accepted_at?: string;
        terms_version?: string;
      } = {
        updated_at: new Date().toISOString(),
      };

      if (updates.full_name !== undefined) {
        sanitizedUpdates.full_name = trimOrUndefined(updates.full_name) ?? null;
      }

      if (updates.avatar_url !== undefined) {
        sanitizedUpdates.avatar_url = updates.avatar_url;
      }

      if (updates.phone !== undefined) {
        const trimmedPhone = trimOrUndefined(updates.phone);
        sanitizedUpdates.phone = trimmedPhone ?? null;
      }

      if (updates.country_code !== undefined) {
        const trimmedCode = updates.country_code
          ? updates.country_code.trim().toUpperCase()
          : undefined;
        sanitizedUpdates.country_code = trimmedCode ?? null;
      }

      if (updates.profile_completed !== undefined) {
        sanitizedUpdates.profile_completed = updates.profile_completed;
      }

      if (updates.preferred_currency !== undefined) {
        sanitizedUpdates.preferred_currency = normalizeOptionalCurrency(updates.preferred_currency).value ?? null;
      }

      if (updates.upi_id !== undefined) {
        sanitizedUpdates.upi_id = normalizeUpiId(updates.upi_id);
      }

      if (updates.accept_terms === true) {
        Object.assign(sanitizedUpdates, buildTermsAcceptanceUpdate(true));
      }

      const { data: updatedProfile, error } = await supabase
        .from('profiles')
        .update(sanitizedUpdates)
        .eq('id', user.id)
        .select('*')
        .single();

      if (error) {
        if (error.code === POSTGREST_NO_ROWS_CODE) {
          const { data: newProfile, error: insertError } = await supabase
            .from('profiles')
            .insert({
              id: user.id,
              full_name: sanitizedUpdates.full_name ?? null,
              avatar_url: sanitizedUpdates.avatar_url ?? null,
              phone: sanitizedUpdates.phone ?? null,
              country_code: sanitizedUpdates.country_code ?? null,
              profile_completed: sanitizedUpdates.profile_completed ?? false,
              preferred_currency: sanitizedUpdates.preferred_currency ?? null,
              upi_id: sanitizedUpdates.upi_id ?? null,
              terms_accepted_at: sanitizedUpdates.terms_accepted_at ?? null,
              terms_version: sanitizedUpdates.terms_version ?? null,
            })
            .select('*')
            .single();

          if (insertError) {
            return handleError(insertError, 'creating profile', req);
          }

          return createSuccessResponse(newProfile, 201, 0, req);
        }

        return handleError(error, 'updating profile', req);
      }

      return createSuccessResponse(updatedProfile, 200, 0, req);
    }

    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  } catch (error: unknown) {
    return handleError(error, 'profile handler', req);
  }
});
