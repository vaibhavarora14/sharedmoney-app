import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import {
  assertChallengeVerifiable,
  assertHourlySendLimit,
  assertResendAllowed,
  buildOtpTextBody,
  codesMatch,
  generateOtpCode,
  hashOtpCode,
  isOtpExpired,
  isWhatsAppOtpLoginEnabled,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  otpExpiresAt,
  OtpRateLimitError,
  OtpVerifyError,
  phonePlaceholderEmail,
  resolveOtpDeliveryMode,
  type OtpChallengeRecord,
} from './whatsapp-otp.ts';
import {
  buildWhatsAppTemplatePayload,
  buildWhatsAppTextPayload,
  DEFAULT_OTP_TEMPLATE_LANG,
  DEFAULT_OTP_TEMPLATE_NAME,
  sendWhatsAppMessage,
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

Deno.test('sendWhatsAppMessage surfaces Graph errors', async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: '(#131030) Recipient not in allowed list', code: 131030 } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  await assertRejects(
    () =>
      sendWhatsAppMessage({
        token: 't',
        phoneNumberId: '1',
        payload: buildWhatsAppTextPayload('+14155552671', 'x'),
        fetchImpl,
      }),
    Error,
    'WhatsApp Graph API returned 400',
  );
});
