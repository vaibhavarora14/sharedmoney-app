/**
 * WhatsApp OTP phone login (feature-flagged).
 *
 * ENABLE_WHATSAPP_OTP_LOGIN must be exactly "true" or this returns 404.
 * Client flag EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN must also be true for UI.
 *
 * POST body:
 * { "action": "send", "phone": "+E.164" }
 * { "action": "verify", "phone": "+E.164", "code": "123456" }
 *
 * Delivery (WHATSAPP_OTP_DELIVERY):
 * - text (default): free-form OTP to Meta allowlisted test recipients
 * - template: WHATSAPP_OTP_TEMPLATE_NAME (default sharedmoney_otp)
 *
 * Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_OTP_PEPPER,
 * optional WHATSAPP_OTP_TEMPLATE_NAME / LANG.
 */
import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/env.ts';
import { log } from '../_shared/logger.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { findUserIdByPhone } from '../_shared/user-lookup.ts';
import { isValidE164Phone, validateBodySize } from '../_shared/validation.ts';
import {
  assertChallengeVerifiable,
  buildOtpTextBody,
  codesMatch,
  extractClientIp,
  extractCountryCallingCode,
  generateOtpCode,
  hashOtpCode,
  hashRequestIp,
  isPhoneCountryAllowed,
  isWhatsAppOtpLoginEnabled,
  mapReserveWhatsAppOtpError,
  OTP_EXPIRY_MS,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_MAX_SENDS_PER_IP_HOUR,
  OTP_RESEND_COOLDOWN_MS,
  otpExpiresAt,
  OtpBudgetExhaustedError,
  OtpRateLimitError,
  OtpVerifyError,
  phonePlaceholderEmail,
  resendCooldownRemainingSeconds,
  resolveOtpDeliveryMode,
  resolveWhatsAppOtpBudgetConfig,
  WHATSAPP_BUDGET_EXHAUSTED_CODE,
  WHATSAPP_BUDGET_EXHAUSTED_MESSAGE,
  WHATSAPP_OTP_PEPPER_ENV,
  type OtpChallengeRecord,
} from '../_shared/whatsapp-otp.ts';
import {
  buildWhatsAppTemplatePayload,
  buildWhatsAppTextPayload,
  getOptionalSecret,
  isMissingSecretsResult,
  loadWhatsAppTemplateConfig,
  resolveLiveSecrets,
  sendWhatsAppMessage,
} from '../_shared/whatsapp.ts';

type OtpAction = 'send' | 'verify';

interface OtpRequestBody {
  action?: unknown;
  phone?: unknown;
  code?: unknown;
}

function createServiceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function parseAction(value: unknown): OtpAction | null {
  if (value === 'send' || value === 'verify') return value;
  return null;
}

function requirePepper(): string {
  const pepper = getOptionalSecret(WHATSAPP_OTP_PEPPER_ENV);
  if (!pepper) {
    throw new Error(`Missing required environment variable: ${WHATSAPP_OTP_PEPPER_ENV}`);
  }
  return pepper;
}

async function markOtpSendStatus(
  admin: SupabaseClient,
  sendId: string,
  status: 'accepted' | 'failed',
  metaMessageId?: string | null,
): Promise<void> {
  const patch: { status: string; meta_message_id?: string } = { status };
  if (status === 'accepted' && metaMessageId) {
    patch.meta_message_id = metaMessageId;
  }
  const { error } = await admin
    .from('whatsapp_otp_sends')
    .update(patch)
    .eq('id', sendId)
    .eq('status', 'reserved');
  if (error) {
    log.error('Failed to update WhatsApp OTP send status', 'whatsapp-otp', {
      status,
      error: error.message,
    });
  }
}

async function reserveOtpSend(
  admin: SupabaseClient,
  params: {
    phone: string;
    countryCode: string;
    ipHash: string | null;
    costInr: number;
    budgetInr: number;
  },
): Promise<string> {
  const { data, error } = await admin.rpc('reserve_whatsapp_otp_send', {
    p_phone_e164: params.phone,
    p_country_code: params.countryCode,
    p_ip_hash: params.ipHash,
    p_est_cost_inr: params.costInr,
    p_budget_inr: params.budgetInr,
    p_cooldown_seconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
    p_max_sends_per_hour: OTP_MAX_SENDS_PER_HOUR,
    p_max_sends_per_ip_hour: OTP_MAX_SENDS_PER_IP_HOUR,
  });

  if (error) {
    throw mapReserveWhatsAppOtpError(error.message || String(error));
  }
  if (typeof data !== 'string' || !data) {
    throw new OtpBudgetExhaustedError();
  }
  return data;
}

async function activeChallenge(
  admin: SupabaseClient,
  phone: string,
): Promise<OtpChallengeRecord | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('whatsapp_otp_challenges')
    .select(
      'id, phone_e164, code_hash, expires_at, attempt_count, max_attempts, consumed_at, created_at',
    )
    .eq('phone_e164', phone)
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load active OTP challenge: ${error.message}`);
  }
  return (data as OtpChallengeRecord | null) ?? null;
}

async function deliverOtp(phone: string, code: string): Promise<{ messageId: string | null; delivery: string }> {
  const secrets = resolveLiveSecrets();
  if (isMissingSecretsResult(secrets)) {
    throw new Error(`Missing WhatsApp secrets: ${secrets.missing.join(', ')}`);
  }

  const delivery = resolveOtpDeliveryMode();
  const payload = delivery === 'template'
    ? buildWhatsAppTemplatePayload({
      to: phone,
      template: 'otp',
      code,
      config: loadWhatsAppTemplateConfig(),
    })
    : buildWhatsAppTextPayload(phone, buildOtpTextBody(code));

  const result = await sendWhatsAppMessage({
    token: secrets.token,
    phoneNumberId: secrets.phoneNumberId,
    payload,
  });

  return { messageId: result.messageId, delivery };
}

async function ensureUserForPhone(
  admin: SupabaseClient,
  phone: string,
): Promise<User> {
  const existingId = await findUserIdByPhone(phone);
  if (existingId) {
    const { data, error } = await admin.auth.admin.getUserById(existingId);
    if (error || !data.user) {
      throw new Error(error?.message || 'Failed to load existing user');
    }
    return data.user;
  }

  const email = phonePlaceholderEmail(phone);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    phone,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: {
      phone_login: true,
      auth_channel: 'whatsapp_otp',
    },
    app_metadata: {
      provider: 'whatsapp_otp',
      providers: ['whatsapp_otp'],
    },
  });

  if (createError || !created.user) {
    // Race: another request created the user — try phone lookup again.
    const racedId = await findUserIdByPhone(phone);
    if (racedId) {
      const { data, error } = await admin.auth.admin.getUserById(racedId);
      if (error || !data.user) {
        throw new Error(createError?.message || 'Failed to create user');
      }
      return data.user;
    }
    throw new Error(createError?.message || 'Failed to create user');
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: created.user.id,
    phone,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (profileError) {
    log.error('Failed to set profile phone after WhatsApp OTP signup', 'whatsapp-otp', {
      error: profileError.message,
    });
  }

  return created.user;
}

async function mintSessionForUser(
  admin: SupabaseClient,
  user: User,
): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: string }> {
  const email = user.email || phonePlaceholderEmail(user.phone || '');
  if (!email) {
    throw new Error('Cannot mint session without email or phone');
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(linkError?.message || 'Failed to generate login link');
  }

  const { data: verified, error: verifyError } = await admin.auth.verifyOtp({
    type: 'email',
    token_hash: linkData.properties.hashed_token,
  });

  if (verifyError || !verified.session) {
    throw new Error(verifyError?.message || 'Failed to create session');
  }

  return {
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    expires_in: verified.session.expires_in,
    token_type: verified.session.token_type,
  };
}

async function handleSend(
  admin: SupabaseClient,
  phone: string,
  req: Request,
): Promise<Response> {
  const budgetConfig = resolveWhatsAppOtpBudgetConfig();
  if (!budgetConfig) {
    log.error('WhatsApp OTP budget config invalid; refusing send', 'whatsapp-otp');
    return createErrorResponse(
      503,
      WHATSAPP_BUDGET_EXHAUSTED_MESSAGE,
      WHATSAPP_BUDGET_EXHAUSTED_CODE,
      undefined,
      req,
    );
  }

  if (!isPhoneCountryAllowed(phone, budgetConfig.allowedCountryCodes)) {
    return createErrorResponse(
      400,
      'WhatsApp sign-in is only available for supported country codes.',
      'VALIDATION_ERROR',
      undefined,
      req,
    );
  }

  const countryCode = extractCountryCallingCode(
    phone,
    budgetConfig.allowedCountryCodes,
  );
  if (!countryCode) {
    return createErrorResponse(
      400,
      'WhatsApp sign-in is only available for supported country codes.',
      'VALIDATION_ERROR',
      undefined,
      req,
    );
  }

  const pepper = requirePepper();
  const clientIp = extractClientIp(req);
  const ipHash = clientIp ? await hashRequestIp(clientIp, pepper) : null;

  let sendId: string;
  try {
    sendId = await reserveOtpSend(admin, {
      phone,
      countryCode,
      ipHash,
      costInr: budgetConfig.costInr,
      budgetInr: budgetConfig.monthlyBudgetInr,
    });
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      throw err;
    }
    if (err instanceof OtpBudgetExhaustedError) {
      return createErrorResponse(
        503,
        WHATSAPP_BUDGET_EXHAUSTED_MESSAGE,
        WHATSAPP_BUDGET_EXHAUSTED_CODE,
        undefined,
        req,
      );
    }
    log.error('WhatsApp OTP reserve failed', 'whatsapp-otp', {
      error: err instanceof Error ? err.message : String(err),
    });
    return createErrorResponse(
      503,
      WHATSAPP_BUDGET_EXHAUSTED_MESSAGE,
      WHATSAPP_BUDGET_EXHAUSTED_CODE,
      undefined,
      req,
    );
  }

  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code, phone, pepper);
  const expiresAt = otpExpiresAt();

  const { error: insertError } = await admin.from('whatsapp_otp_challenges').insert({
    phone_e164: phone,
    code_hash: codeHash,
    expires_at: expiresAt.toISOString(),
    attempt_count: 0,
    max_attempts: OTP_MAX_ATTEMPTS,
    request_fingerprint: ipHash,
  });

  if (insertError) {
    await markOtpSendStatus(admin, sendId, 'failed');
    throw new Error(`Failed to store OTP challenge: ${insertError.message}`);
  }

  try {
    const { messageId, delivery } = await deliverOtp(phone, code);
    await markOtpSendStatus(admin, sendId, 'accepted', messageId);
    log.info('WhatsApp OTP sent', 'whatsapp-otp', {
      delivery,
      hasMessageId: Boolean(messageId),
      expiresInSec: Math.floor(OTP_EXPIRY_MS / 1000),
    });
    return createSuccessResponse(
      {
        sent: true,
        delivery,
        expires_in: Math.floor(OTP_EXPIRY_MS / 1000),
        resend_after: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
      },
      200,
      0,
      req,
    );
  } catch (sendError) {
    await markOtpSendStatus(admin, sendId, 'failed');
    // Meta allowlist / test-recipient hints stay in logs only — never in user-facing copy.
    log.error('WhatsApp OTP delivery failed', 'whatsapp-otp', {
      error: sendError instanceof Error ? sendError.message : String(sendError),
      hint:
        'Confirm the recipient is a Meta allowlisted test number and (for text delivery) has opened the 24h session.',
    });
    return createErrorResponse(
      502,
      "We couldn't send a code to this number. Check it's on WhatsApp, or use another sign-in method.",
      'WHATSAPP_SEND_FAILED',
      undefined,
      req,
    );
  }
}

async function handleVerify(
  admin: SupabaseClient,
  phone: string,
  code: string,
  req: Request,
): Promise<Response> {
  const challenge = await activeChallenge(admin, phone);
  let active: OtpChallengeRecord;
  try {
    active = assertChallengeVerifiable(challenge);
  } catch (err) {
    if (err instanceof OtpVerifyError) {
      const details = err.retryAfterSeconds != null
        ? `retry_after=${err.retryAfterSeconds}`
        : undefined;
      return createErrorResponse(400, err.message, err.code, details, req);
    }
    throw err;
  }

  const pepper = requirePepper();
  const ok = await codesMatch(code, phone, pepper, active.code_hash);

  if (!ok) {
    const nextAttempts = active.attempt_count + 1;
    await admin
      .from('whatsapp_otp_challenges')
      .update({ attempt_count: nextAttempts })
      .eq('id', active.id);

    if (nextAttempts >= active.max_attempts) {
      const retryAfter = resendCooldownRemainingSeconds(active.created_at);
      return createErrorResponse(
        400,
        'Too many incorrect attempts.',
        'OTP_LOCKED',
        `retry_after=${retryAfter}`,
        req,
      );
    }
    return createErrorResponse(400, 'Incorrect code. Try again.', 'OTP_MISMATCH', undefined, req);
  }

  const { error: consumeError } = await admin
    .from('whatsapp_otp_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', active.id)
    .is('consumed_at', null);

  if (consumeError) {
    throw new Error(`Failed to consume OTP: ${consumeError.message}`);
  }

  const user = await ensureUserForPhone(admin, phone);

  // Keep profile.phone in sync for returning users who signed up another way.
  await admin.from('profiles').upsert({
    id: user.id,
    phone,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  const session = await mintSessionForUser(admin, user);

  return createSuccessResponse(
    {
      verified: true,
      session,
      user: {
        id: user.id,
        phone: user.phone ?? phone,
        email: user.email,
      },
    },
    200,
    0,
    req,
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return createEmptyResponse(200, req);
  }
  if (req.method !== 'POST') {
    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  }

  if (!isWhatsAppOtpLoginEnabled()) {
    return createErrorResponse(404, 'Not found', 'FEATURE_DISABLED', undefined, req);
  }

  try {
    const bodyText = await req.text().catch(() => null);
    const bodySizeValidation = validateBodySize(bodyText, 4 * 1024);
    if (!bodySizeValidation.valid) {
      return createErrorResponse(
        413,
        bodySizeValidation.error || 'Request body too large',
        'VALIDATION_ERROR',
        undefined,
        req,
      );
    }

    let body: OtpRequestBody;
    try {
      body = bodyText ? JSON.parse(bodyText) as OtpRequestBody : {};
    } catch {
      return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
    }

    const action = parseAction(body.action);
    if (!action) {
      return createErrorResponse(
        400,
        'action must be "send" or "verify"',
        'VALIDATION_ERROR',
        undefined,
        req,
      );
    }

    if (typeof body.phone !== 'string' || !isValidE164Phone(body.phone)) {
      return createErrorResponse(
        400,
        'phone must be a valid E.164 number',
        'VALIDATION_ERROR',
        undefined,
        req,
      );
    }
    const phone = body.phone.trim();

    const admin = createServiceClient();

    if (action === 'send') {
      try {
        return await handleSend(admin, phone, req);
      } catch (err) {
        if (err instanceof OtpRateLimitError) {
          return createErrorResponse(
            429,
            err.message,
            'RATE_LIMITED',
            `retry_after=${err.retryAfterSeconds}`,
            req,
          );
        }
        if (err instanceof OtpBudgetExhaustedError) {
          return createErrorResponse(
            503,
            WHATSAPP_BUDGET_EXHAUSTED_MESSAGE,
            WHATSAPP_BUDGET_EXHAUSTED_CODE,
            undefined,
            req,
          );
        }
        throw err;
      }
    }

    if (typeof body.code !== 'string' || !/^\d{4,8}$/.test(body.code.trim())) {
      return createErrorResponse(
        400,
        'code must be 4–8 digits',
        'VALIDATION_ERROR',
        undefined,
        req,
      );
    }

    return await handleVerify(admin, phone, body.code.trim(), req);
  } catch (error) {
    return handleError(error, 'whatsapp otp', req);
  }
});
