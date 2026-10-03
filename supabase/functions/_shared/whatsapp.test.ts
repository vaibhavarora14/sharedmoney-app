import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  buildGraphMessagesUrl,
  buildWhatsAppTemplatePayload,
  DEFAULT_OTP_TEMPLATE_LANG,
  DEFAULT_OTP_TEMPLATE_NAME,
  isMissingSecretsResult,
  isValidE164,
  listMissingSecrets,
  loadWhatsAppTemplateConfig,
  resolveLiveSecrets,
  toWhatsAppRecipient,
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
  reminderTemplateName: 'sharedmoney_monthly_balance',
  reminderTemplateLang: 'en',
};

Deno.test('isValidE164 accepts practical international numbers', () => {
  assertEquals(isValidE164('+14155552671'), true);
  assertEquals(isValidE164('+919876543210'), true);
  assertEquals(isValidE164('14155552671'), false);
  assertEquals(isValidE164('+0123'), false);
  assertEquals(isValidE164('+1'), false);
});

Deno.test('toWhatsAppRecipient strips leading plus', () => {
  assertEquals(toWhatsAppRecipient('+14155552671'), '14155552671');
  assertThrows(() => toWhatsAppRecipient('4155552671'), Error, 'Invalid E.164');
});

Deno.test('buildWhatsAppTemplatePayload builds OTP auth template components', () => {
  const payload = buildWhatsAppTemplatePayload({
    to: '+14155552671',
    template: 'otp',
    code: '123456',
    config: baseConfig,
  });

  assertEquals(payload, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '14155552671',
    type: 'template',
    template: {
      name: 'sharedmoney_otp',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: '123456' }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: '123456' }],
        },
      ],
    },
  });
});

Deno.test('buildWhatsAppTemplatePayload rejects otp without code', () => {
  assertThrows(
    () =>
      buildWhatsAppTemplatePayload({
        to: '+14155552671',
        template: 'otp',
        config: baseConfig,
      }),
    Error,
    'code is required',
  );
});

Deno.test('buildWhatsAppTemplatePayload builds reminder template with sample params by default', () => {
  const payload = buildWhatsAppTemplatePayload({
    to: '+919876543210',
    template: 'reminder',
    config: baseConfig,
  });

  assertEquals(payload.template.name, 'sharedmoney_monthly_balance');
  assertEquals(payload.to, '919876543210');
  assertEquals(payload.template.components, [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: 'Weekend trip' },
        { type: 'text', text: 'Rs 450' },
      ],
    },
  ]);
});

Deno.test('buildWhatsAppTemplatePayload builds reminder template with trimmed custom params', () => {
  const payload = buildWhatsAppTemplatePayload({
    to: '+919876543210',
    template: 'reminder',
    group: '  Ski lodge  ',
    amount: '  Rs 1,250  ',
    config: baseConfig,
  });

  assertEquals(payload.template.components, [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: 'Ski lodge' },
        { type: 'text', text: 'Rs 1,250' },
      ],
    },
  ]);
});

Deno.test('buildWhatsAppTemplatePayload rejects non-string reminder params', () => {
  assertThrows(
    () =>
      buildWhatsAppTemplatePayload({
        to: '+919876543210',
        template: 'reminder',
        group: 123,
        config: baseConfig,
      }),
    Error,
    'Invalid request: group must be a string',
  );
});

Deno.test('buildWhatsAppTemplatePayload requires reminder template name secret', () => {
  assertThrows(
    () =>
      buildWhatsAppTemplatePayload({
        to: '+14155552671',
        template: 'reminder',
        config: { ...baseConfig, reminderTemplateName: null },
      }),
    Error,
    'WHATSAPP_REMINDER_TEMPLATE_NAME',
  );
});

Deno.test('listMissingSecrets and resolveLiveSecrets gate Meta credentials', () => {
  const empty = makeEnv({});
  assertEquals(listMissingSecrets(['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'], empty), [
    'WHATSAPP_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
  ]);

  const partial = makeEnv({ WHATSAPP_TOKEN: 'secret-token' });
  const resolvedPartial = resolveLiveSecrets(partial);
  assertEquals(isMissingSecretsResult(resolvedPartial), true);
  if (isMissingSecretsResult(resolvedPartial)) {
    assertEquals(resolvedPartial.missing, ['WHATSAPP_PHONE_NUMBER_ID']);
  }

  const full = makeEnv({
    WHATSAPP_TOKEN: 'secret-token',
    WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  });
  const resolved = resolveLiveSecrets(full);
  assertEquals(isMissingSecretsResult(resolved), false);
  if (!isMissingSecretsResult(resolved)) {
    assertEquals(resolved.token, 'secret-token');
    assertEquals(resolved.phoneNumberId, '1234567890');
  }
});

Deno.test('loadWhatsAppTemplateConfig applies defaults and optional reminder', () => {
  const defaults = loadWhatsAppTemplateConfig(makeEnv({}));
  assertEquals(defaults.otpTemplateName, DEFAULT_OTP_TEMPLATE_NAME);
  assertEquals(defaults.otpTemplateLang, DEFAULT_OTP_TEMPLATE_LANG);
  assertEquals(defaults.reminderTemplateName, null);

  const custom = loadWhatsAppTemplateConfig(makeEnv({
    WHATSAPP_OTP_TEMPLATE_NAME: 'custom_otp',
    WHATSAPP_OTP_TEMPLATE_LANG: 'en_US',
    WHATSAPP_REMINDER_TEMPLATE_NAME: 'custom_reminder',
    WHATSAPP_REMINDER_TEMPLATE_LANG: 'hi',
  }));
  assertEquals(custom.otpTemplateName, 'custom_otp');
  assertEquals(custom.otpTemplateLang, 'en_US');
  assertEquals(custom.reminderTemplateName, 'custom_reminder');
  assertEquals(custom.reminderTemplateLang, 'hi');
});

Deno.test('buildGraphMessagesUrl targets Graph v21 phone number messages', () => {
  assertEquals(
    buildGraphMessagesUrl('10987654321'),
    'https://graph.facebook.com/v21.0/10987654321/messages',
  );
});
