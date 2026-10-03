/**
 * WhatsApp Cloud API helpers (Meta Graph API template messages).
 *
 * Used by `whatsapp-dry-run` for connect-only dry-run / live template sends.
 * Secrets live in Supabase/GitHub env — never commit tokens.
 *
 * Env:
 * - WHATSAPP_TOKEN (required for live send)
 * - WHATSAPP_PHONE_NUMBER_ID (required for live send)
 * - WHATSAPP_OTP_TEMPLATE_NAME (default: sharedmoney_otp)
 * - WHATSAPP_OTP_TEMPLATE_LANG (default: en)
 * - WHATSAPP_REMINDER_TEMPLATE_NAME (optional; required when template=reminder)
 * - WHATSAPP_REMINDER_TEMPLATE_LANG (default: en)
 * - WHATSAPP_DRY_RUN_SECRET (shared secret for admin/debug auth)
 */

export const WHATSAPP_GRAPH_API_VERSION = 'v21.0';
export const DEFAULT_OTP_TEMPLATE_NAME = 'sharedmoney_otp';
export const DEFAULT_OTP_TEMPLATE_LANG = 'en';
export const DEFAULT_REMINDER_TEMPLATE_LANG = 'en';

export type WhatsAppTemplateKind = 'otp' | 'reminder';

export interface WhatsAppTemplateTextParameter {
  type: 'text';
  text: string;
}

export interface WhatsAppTemplateBodyComponent {
  type: 'body';
  parameters: WhatsAppTemplateTextParameter[];
}

export interface WhatsAppTemplateButtonComponent {
  type: 'button';
  sub_type: 'url';
  index: '0';
  parameters: WhatsAppTemplateTextParameter[];
}

export type WhatsAppTemplateComponent =
  | WhatsAppTemplateBodyComponent
  | WhatsAppTemplateButtonComponent;

export interface WhatsAppTemplateMessagePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: { code: string };
    components: WhatsAppTemplateComponent[];
  };
}

export interface WhatsAppTemplateConfig {
  otpTemplateName: string;
  otpTemplateLang: string;
  reminderTemplateName: string | null;
  reminderTemplateLang: string;
}

export interface BuildWhatsAppTemplateInput {
  to: string;
  template: WhatsAppTemplateKind;
  code?: string;
  group?: unknown;
  amount?: unknown;
  config: WhatsAppTemplateConfig;
}

export interface WhatsAppLiveSecrets {
  token: string;
  phoneNumberId: string;
}

export interface MissingSecretsResult {
  missing: string[];
}

/** E.164 with leading +, 8–15 digits after country code rules (practical). */
const E164_RE = /^\+[1-9]\d{7,14}$/;

export function getOptionalSecret(key: string, env: Deno.Env = Deno.env): string | null {
  const value = env.get(key)?.trim();
  return value ? value : null;
}

export function requireSecret(key: string, env: Deno.Env = Deno.env): string {
  const value = getOptionalSecret(key, env);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function listMissingSecrets(keys: readonly string[], env: Deno.Env = Deno.env): string[] {
  return keys.filter((key) => !getOptionalSecret(key, env));
}

export function isValidE164(phone: string): boolean {
  return E164_RE.test(phone.trim());
}

/** Meta Cloud API `to` field expects digits only (no leading +). */
export function toWhatsAppRecipient(e164: string): string {
  const trimmed = e164.trim();
  if (!isValidE164(trimmed)) {
    throw new Error(`Invalid E.164 phone number: ${trimmed}`);
  }
  return trimmed.slice(1);
}

export function loadWhatsAppTemplateConfig(env: Deno.Env = Deno.env): WhatsAppTemplateConfig {
  return {
    otpTemplateName: getOptionalSecret('WHATSAPP_OTP_TEMPLATE_NAME', env) || DEFAULT_OTP_TEMPLATE_NAME,
    otpTemplateLang: getOptionalSecret('WHATSAPP_OTP_TEMPLATE_LANG', env) || DEFAULT_OTP_TEMPLATE_LANG,
    reminderTemplateName: getOptionalSecret('WHATSAPP_REMINDER_TEMPLATE_NAME', env),
    reminderTemplateLang:
      getOptionalSecret('WHATSAPP_REMINDER_TEMPLATE_LANG', env) || DEFAULT_REMINDER_TEMPLATE_LANG,
  };
}

export function resolveLiveSecrets(env: Deno.Env = Deno.env): WhatsAppLiveSecrets | MissingSecretsResult {
  const missing = listMissingSecrets(['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'], env);
  if (missing.length > 0) {
    return { missing };
  }
  return {
    token: requireSecret('WHATSAPP_TOKEN', env),
    phoneNumberId: requireSecret('WHATSAPP_PHONE_NUMBER_ID', env),
  };
}

export function isMissingSecretsResult(
  value: WhatsAppLiveSecrets | MissingSecretsResult,
): value is MissingSecretsResult {
  return 'missing' in value;
}

function textParam(text: string): WhatsAppTemplateTextParameter {
  return { type: 'text', text };
}

function buildOtpComponents(code: string): WhatsAppTemplateComponent[] {
  return [
    {
      type: 'body',
      parameters: [textParam(code)],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [textParam(code)],
    },
  ];
}

function resolveReminderText(value: unknown, fallback: string, field: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    throw new Error(`Invalid request: ${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function buildReminderComponents(group: unknown, amount: unknown): WhatsAppTemplateComponent[] {
  return [
    {
      type: 'body',
      parameters: [
        textParam(resolveReminderText(group, 'Weekend trip', 'group')),
        textParam(resolveReminderText(amount, 'Rs 450', 'amount')),
      ],
    },
  ];
}

export function buildWhatsAppTemplatePayload(
  input: BuildWhatsAppTemplateInput,
): WhatsAppTemplateMessagePayload {
  const to = toWhatsAppRecipient(input.to);
  const { config, template } = input;

  switch (template) {
    case 'otp': {
      const code = input.code?.trim();
      if (!code) {
        throw new Error('Invalid request: code is required when template is "otp"');
      }
      if (!/^\d{4,8}$/.test(code)) {
        throw new Error('Invalid request: code must be 4–8 digits');
      }
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: config.otpTemplateName,
          language: { code: config.otpTemplateLang },
          components: buildOtpComponents(code),
        },
      };
    }
    case 'reminder': {
      if (!config.reminderTemplateName) {
        throw new Error(
          'Missing required environment variable: WHATSAPP_REMINDER_TEMPLATE_NAME',
        );
      }
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: config.reminderTemplateName,
          language: { code: config.reminderTemplateLang },
          components: buildReminderComponents(input.group, input.amount),
        },
      };
    }
    default: {
      const _exhaustive: never = template;
      throw new Error(`Unsupported template kind: ${_exhaustive}`);
    }
  }
}

export function buildGraphMessagesUrl(phoneNumberId: string): string {
  const id = phoneNumberId.trim();
  if (!id) {
    throw new Error('Missing required environment variable: WHATSAPP_PHONE_NUMBER_ID');
  }
  return `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${id}/messages`;
}

export interface MetaSendResult {
  messageId: string | null;
  raw: unknown;
}

export async function sendWhatsAppTemplateMessage(options: {
  token: string;
  phoneNumberId: string;
  payload: WhatsAppTemplateMessagePayload;
  fetchImpl?: typeof fetch;
}): Promise<MetaSendResult> {
  const url = buildGraphMessagesUrl(options.phoneNumberId);
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.payload),
  });

  const responseText = await response.text();
  let raw: unknown = null;
  if (responseText) {
    try {
      raw = JSON.parse(responseText);
    } catch {
      raw = { error: responseText.slice(0, 500) };
    }
  }

  if (!response.ok) {
    const detail =
      typeof raw === 'object' && raw !== null && 'error' in raw
        ? JSON.stringify((raw as { error: unknown }).error).slice(0, 500)
        : responseText.slice(0, 500);
    throw new Error(`WhatsApp Graph API returned ${response.status}: ${detail}`);
  }

  const messageId =
    typeof raw === 'object' &&
      raw !== null &&
      Array.isArray((raw as { messages?: unknown }).messages) &&
      (raw as { messages: Array<{ id?: string }> }).messages[0]?.id
      ? (raw as { messages: Array<{ id?: string }> }).messages[0].id ?? null
      : null;

  return { messageId, raw };
}
