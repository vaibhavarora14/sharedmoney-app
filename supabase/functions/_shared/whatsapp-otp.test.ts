import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import {
  assertChallengeVerifiable,
  assertHourlySendLimit,
  assertIpHourlySendLimit,
  assertResendAllowed,
  buildOtpTextBody,
  codesMatch,
  DEFAULT_WHATSAPP_MONTHLY_BUDGET_INR,
  DEFAULT_WHATSAPP_OTP_COST_INR,
  extractClientIp,
  extractCountryCallingCode,
  generateOtpCode,
  hashOtpCode,
  hashRequestIp,
  isOtpExpired,
  isPhoneCountryAllowed,
  isWhatsAppOtpLoginEnabled,
  istBudgetMonth,
  mapReserveWhatsAppOtpError,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_MAX_SENDS_PER_IP_HOUR,
  otpExpiresAt,
  OtpBudgetExhaustedError,
  OtpRateLimitError,
  OtpVerifyError,
  phonePlaceholderEmail,
  resolveOtpDeliveryMode,
  resolveWhatsAppOtpBudgetConfig,
  WHATSAPP_BUDGET_EXHAUSTED_CODE,
  WHATSAPP_BUDGET_EXHAUSTED_MESSAGE,
  type OtpChallengeRecord,
} from './whatsapp-otp.ts';
import {
  buildWhatsAppTemplatePayload,
  buildWhatsAppTextPayload,
  DEFAULT_OTP_TEMPLATE_LANG,
  DEFAULT_OTP_TEMPLATE_NAME,
  isDefiniteWhatsAppMetaRejection,
  sendWhatsAppMessage,
  WhatsAppMetaHttpError,
  type WhatsAppTemplateConfig,
} from './whatsapp.ts';

function makeEnv(entries: Record<string, string | undefined>): Deno.Env {
  return {
    get(key: string) {
      return entries[key];
    },
    set() {},
    delete() {},
    toObject() {
      return Object.fromEntries(
        Object.entries(entries).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
    },
    has(key: string) {
      return entries[key] !== undefined && entries[key] !== '';
    },
  } as Deno.Env;
}

const baseConfig: WhatsAppTemplateConfig = {
  otpTemplateName: DEFAULT_OTP_TEMPLATE_NAME,
  otpTemplateLang: DEFAULT_OTP_TEMPLATE_LANG,
  reminderTemplateName: null,
  reminderTemplateLang: 'en',
};

Deno.test('isWhatsAppOtpLoginEnabled defaults off', () => {
  assertEquals(isWhatsAppOtpLoginEnabled(makeEnv({})), false);
  assertEquals(isWhatsAppOtpLoginEnabled(makeEnv({ ENABLE_WHATSAPP_OTP_LOGIN: 'false' })), false);
  assertEquals(isWhatsAppOtpLoginEnabled(makeEnv({ ENABLE_WHATSAPP_OTP_LOGIN: '1' })), false);
  assertEquals(isWhatsAppOtpLoginEnabled(makeEnv({ ENABLE_WHATSAPP_OTP_LOGIN: 'true' })), true);
});

Deno.test('resolveOtpDeliveryMode defaults to text for Meta test path', () => {
  assertEquals(resolveOtpDeliveryMode(makeEnv({})), 'text');
  assertEquals(resolveOtpDeliveryMode(makeEnv({ WHATSAPP_OTP_DELIVERY: 'TEXT' })), 'text');
  assertEquals(resolveOtpDeliveryMode(makeEnv({ WHATSAPP_OTP_DELIVERY: 'template' })), 'template');
});

Deno.test('generateOtpCode returns fixed-length digits', () => {
  const code = generateOtpCode(6);
  assertEquals(/^\d{6}$/.test(code), true);
});

Deno.test('hashOtpCode is stable and phone-scoped', async () => {
  const a = await hashOtpCode('123456', '+14155552671', 'pepper');
  const b = await hashOtpCode('123456', '+14155552671', 'pepper');
  const c = await hashOtpCode('123456', '+14155552672', 'pepper');
  assertEquals(a, b);
  assertEquals(a === c, false);
  assertEquals(a.length, 64);
});

Deno.test('codesMatch accepts correct code only', async () => {
  const hash = await hashOtpCode('654321', '+919876543210', 'secret');
  assertEquals(await codesMatch('654321', '+919876543210', 'secret', hash), true);
  assertEquals(await codesMatch('000000', '+919876543210', 'secret', hash), false);
});

Deno.test('otp expiry helpers', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  const expires = otpExpiresAt(now, 60_000);
  assertEquals(expires.toISOString(), '2026-10-20T12:01:00.000Z');
  assertEquals(isOtpExpired(expires, now), false);
  assertEquals(isOtpExpired(expires, new Date('2026-10-20T12:01:00.000Z')), true);
});

Deno.test('assertResendAllowed enforces cooldown', () => {
  const now = new Date('2026-10-20T12:00:30.000Z');
  assertThrows(
    () => assertResendAllowed('2026-10-20T12:00:00.000Z', now, 60_000),
    OtpRateLimitError,
    'wait',
  );
  assertResendAllowed('2026-10-20T11:58:00.000Z', now, 60_000);
});

Deno.test('assertHourlySendLimit blocks burst', () => {
  assertThrows(
    () => assertHourlySendLimit(OTP_MAX_SENDS_PER_HOUR),
    OtpRateLimitError,
  );
  assertHourlySendLimit(OTP_MAX_SENDS_PER_HOUR - 1);
});

Deno.test('assertIpHourlySendLimit blocks per-IP burst', () => {
  assertThrows(
    () => assertIpHourlySendLimit(OTP_MAX_SENDS_PER_IP_HOUR),
    OtpRateLimitError,
    'network',
  );
  assertIpHourlySendLimit(OTP_MAX_SENDS_PER_IP_HOUR - 1);
});

Deno.test('resolveWhatsAppOtpBudgetConfig defaults and fail-closed invalids', () => {
  const defaults = resolveWhatsAppOtpBudgetConfig(makeEnv({}));
  assertEquals(defaults?.monthlyBudgetInr, DEFAULT_WHATSAPP_MONTHLY_BUDGET_INR);
  assertEquals(defaults?.costInr, DEFAULT_WHATSAPP_OTP_COST_INR);
  assertEquals(defaults?.allowedCountryCodes, ['91']);

  assertEquals(
    resolveWhatsAppOtpBudgetConfig(makeEnv({
      WHATSAPP_MONTHLY_BUDGET_INR: '500',
      WHATSAPP_OTP_COST_INR: '0.14',
      WHATSAPP_OTP_ALLOWED_COUNTRY_CODES: '91',
    }))?.monthlyBudgetInr,
    500,
  );

  assertEquals(
    resolveWhatsAppOtpBudgetConfig(makeEnv({ WHATSAPP_MONTHLY_BUDGET_INR: 'abc' })),
    null,
  );
  assertEquals(
    resolveWhatsAppOtpBudgetConfig(makeEnv({ WHATSAPP_MONTHLY_BUDGET_INR: '-1' })),
    null,
  );
  assertEquals(
    resolveWhatsAppOtpBudgetConfig(makeEnv({ WHATSAPP_OTP_COST_INR: '0' })),
    null,
  );
  assertEquals(
    resolveWhatsAppOtpBudgetConfig(makeEnv({ WHATSAPP_OTP_COST_INR: '999' })),
    null,
  );
  assertEquals(
    resolveWhatsAppOtpBudgetConfig(makeEnv({
      WHATSAPP_OTP_ALLOWED_COUNTRY_CODES: 'xx',
    })),
    null,
  );
});

Deno.test('country allow-list rejects non-allowed calling codes', () => {
  assertEquals(isPhoneCountryAllowed('+919876543210', ['91']), true);
  assertEquals(isPhoneCountryAllowed('+14155552671', ['91']), false);
  assertEquals(extractCountryCallingCode('+919876543210', ['91']), '91');
  assertEquals(extractCountryCallingCode('+14155552671', ['91']), null);
  assertEquals(extractCountryCallingCode('+447911123456', ['44', '91']), '44');
});

Deno.test('istBudgetMonth uses Asia/Kolkata calendar month boundary', () => {
  // 2026-10-31 18:30 UTC == 2026-11-01 00:00 IST → November
  assertEquals(
    istBudgetMonth(new Date('2026-10-31T18:30:00.000Z')),
    '2026-11',
  );
  // 2026-10-31 18:29 UTC == 2026-10-31 23:59 IST → October
  assertEquals(
    istBudgetMonth(new Date('2026-10-31T18:29:00.000Z')),
    '2026-10',
  );
  // 2026-03-31 18:30 UTC == 2026-04-01 00:00 IST → April
  assertEquals(
    istBudgetMonth(new Date('2026-03-31T18:30:00.000Z')),
    '2026-04',
  );
});

Deno.test('hashRequestIp is stable and salt-scoped', async () => {
  const a = await hashRequestIp('203.0.113.10', 'pepper');
  const b = await hashRequestIp('203.0.113.10', 'pepper');
  const c = await hashRequestIp('203.0.113.11', 'pepper');
  const d = await hashRequestIp('203.0.113.10', 'other');
  assertEquals(a, b);
  assertEquals(a === c, false);
  assertEquals(a === d, false);
  assertEquals(a.length, 64);
});

Deno.test('extractClientIp prefers x-real-ip then rightmost x-forwarded-for', () => {
  // Spoofable leftmost XFF must not win when x-real-ip is present.
  assertEquals(
    extractClientIp(new Request('https://example.test', {
      headers: {
        'x-forwarded-for': '203.0.113.9, 10.0.0.1',
        'x-real-ip': '198.51.100.4',
      },
    })),
    '198.51.100.4',
  );
  // Without x-real-ip, use the platform-appended (rightmost) hop.
  assertEquals(
    extractClientIp(new Request('https://example.test', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    })),
    '10.0.0.1',
  );
  assertEquals(
    extractClientIp(new Request('https://example.test', {
      headers: { 'x-real-ip': '198.51.100.4' },
    })),
    '198.51.100.4',
  );
  // cf-connecting-ip alone is not treated as trusted for Supabase Edge.
  assertEquals(
    extractClientIp(new Request('https://example.test', {
      headers: { 'cf-connecting-ip': '203.0.113.50' },
    })),
    null,
  );
  assertEquals(extractClientIp(new Request('https://example.test')), null);
});

Deno.test('mapReserveWhatsAppOtpError maps budget and rate-limit refusals', () => {
  const budget = mapReserveWhatsAppOtpError(
    'WHATSAPP_BUDGET_EXHAUSTED',
  );
  assertEquals(budget instanceof OtpBudgetExhaustedError, true);
  assertEquals((budget as OtpBudgetExhaustedError).code, WHATSAPP_BUDGET_EXHAUSTED_CODE);
  assertEquals(budget.message, WHATSAPP_BUDGET_EXHAUSTED_MESSAGE);

  const cooldown = mapReserveWhatsAppOtpError('RATE_LIMITED:cooldown:42');
  assertEquals(cooldown instanceof OtpRateLimitError, true);
  assertEquals((cooldown as OtpRateLimitError).retryAfterSeconds, 42);

  const hourly = mapReserveWhatsAppOtpError('RATE_LIMITED:hourly');
  assertEquals(hourly instanceof OtpRateLimitError, true);

  const ipHourly = mapReserveWhatsAppOtpError('RATE_LIMITED:ip_hourly');
  assertEquals(ipHourly instanceof OtpRateLimitError, true);
  assertEquals(/network/i.test(ipHourly.message), true);

  // Unknown DB errors fail closed as budget exhausted (503 path).
  const unknown = mapReserveWhatsAppOtpError('connection reset');
  assertEquals(unknown instanceof OtpBudgetExhaustedError, true);
});

Deno.test('assertChallengeVerifiable covers expiry attempts and reuse', () => {
  const base: OtpChallengeRecord = {
    id: 'c1',
    phone_e164: '+14155552671',
    code_hash: 'a'.repeat(64),
    expires_at: '2026-10-20T12:10:00.000Z',
    attempt_count: 0,
    max_attempts: OTP_MAX_ATTEMPTS,
    consumed_at: null,
    created_at: '2026-10-20T12:00:00.000Z',
  };
  const now = new Date('2026-10-20T12:05:00.000Z');
  assertEquals(assertChallengeVerifiable(base, now).id, 'c1');
  assertThrows(() => assertChallengeVerifiable(null, now), OtpVerifyError);
  assertThrows(
    () => assertChallengeVerifiable({ ...base, consumed_at: now.toISOString() }, now),
    OtpVerifyError,
    'already used',
  );
  assertThrows(
    () => assertChallengeVerifiable({ ...base, expires_at: '2026-10-20T12:00:00.000Z' }, now),
    OtpVerifyError,
    'expired',
  );
  assertThrows(
    () => assertChallengeVerifiable({ ...base, attempt_count: OTP_MAX_ATTEMPTS }, now),
    OtpVerifyError,
    'incorrect attempts',
  );
  try {
    assertChallengeVerifiable({ ...base, expires_at: '2026-10-20T12:00:00.000Z' }, now);
  } catch (err) {
    assertEquals(err instanceof OtpVerifyError, true);
    assertEquals((err as OtpVerifyError).code, 'OTP_EXPIRED');
  }
  try {
    assertChallengeVerifiable({ ...base, attempt_count: OTP_MAX_ATTEMPTS }, now);
  } catch (err) {
    assertEquals(err instanceof OtpVerifyError, true);
    assertEquals((err as OtpVerifyError).code, 'OTP_LOCKED');
  }
});

Deno.test('buildOtpTextBody includes code without leaking extras', () => {
  const body = buildOtpTextBody('424242');
  assertEquals(body.includes('424242'), true);
  assertEquals(body.includes('SharedMoney'), true);
});

Deno.test('phonePlaceholderEmail is deterministic', () => {
  assertEquals(phonePlaceholderEmail('+91 98765-43210'), 'wa.919876543210@phone.sharedmoney.internal');
});

Deno.test('buildWhatsAppTextPayload builds Graph text message for OTP', () => {
  const payload = buildWhatsAppTextPayload('+14155552671', buildOtpTextBody('112233'));
  assertEquals(payload, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '14155552671',
    type: 'text',
    text: {
      preview_url: false,
      body: buildOtpTextBody('112233'),
    },
  });
});

Deno.test('buildWhatsAppTemplatePayload still builds OTP template components', () => {
  const payload = buildWhatsAppTemplatePayload({
    to: '+14155552671',
    template: 'otp',
    code: '998877',
    config: baseConfig,
  });
  assertEquals(payload.type, 'template');
  assertEquals(payload.template.name, 'sharedmoney_otp');
  assertEquals(payload.template.components[0].parameters[0].text, '998877');
});

Deno.test('sendWhatsAppMessage posts mocked Graph API and returns message id', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init: init || {} });
    return Promise.resolve(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.test.1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };

  const payload = buildWhatsAppTextPayload('+14155552671', 'test body');
  const result = await sendWhatsAppMessage({
    token: 'test-token',
    phoneNumberId: '1234567890',
    payload,
    fetchImpl,
  });

  assertEquals(result.messageId, 'wamid.test.1');
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, 'https://graph.facebook.com/v21.0/1234567890/messages');
  const headers = calls[0].init.headers as Record<string, string>;
  assertEquals(headers.Authorization, 'Bearer test-token');
  assertEquals(JSON.parse(String(calls[0].init.body)).type, 'text');
});

Deno.test('sendWhatsAppMessage surfaces Graph 4xx as definite Meta rejection', async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: '(#131030) Recipient not in allowed list', code: 131030 } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  const err = await assertRejects(
    () =>
      sendWhatsAppMessage({
        token: 't',
        phoneNumberId: '1',
        payload: buildWhatsAppTextPayload('+14155552671', 'x'),
        fetchImpl,
      }),
    WhatsAppMetaHttpError,
    'WhatsApp Graph API returned 400',
  );
  assertEquals(err instanceof WhatsAppMetaHttpError, true);
  assertEquals((err as WhatsAppMetaHttpError).definiteRejection, true);
  assertEquals(isDefiniteWhatsAppMetaRejection(err), true);
});

Deno.test('sendWhatsAppMessage 5xx is not a definite rejection (keep budget reserved)', async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(new Response('upstream timeout', { status: 503 }));

  const err = await assertRejects(
    () =>
      sendWhatsAppMessage({
        token: 't',
        phoneNumberId: '1',
        payload: buildWhatsAppTextPayload('+14155552671', 'x'),
        fetchImpl,
      }),
    WhatsAppMetaHttpError,
    'WhatsApp Graph API returned 503',
  );
  assertEquals((err as WhatsAppMetaHttpError).definiteRejection, false);
  assertEquals(isDefiniteWhatsAppMetaRejection(err), false);
});

Deno.test('network failures are not definite Meta rejections', () => {
  assertEquals(isDefiniteWhatsAppMetaRejection(new Error('network reset')), false);
  assertEquals(
    isDefiniteWhatsAppMetaRejection(
      new WhatsAppMetaHttpError('empty 400', 400, ''),
    ),
    false,
  );
  assertEquals(
    isDefiniteWhatsAppMetaRejection(
      new WhatsAppMetaHttpError('reject', 400, '{"error":{}}'),
    ),
    true,
  );
});
