/**
 * WhatsApp dry-run / live template send (Meta Cloud API).
 *
 * CoS path A (#360): connect-only scaffold. No OTP login UI, no reminder routing.
 *
 * Auth (fail closed):
 * - Header `x-whatsapp-dry-run-secret` (or Bearer) matching `WHATSAPP_DRY_RUN_SECRET`, OR
 * - Bearer `SUPABASE_SERVICE_ROLE_KEY`
 *
 * Body JSON:
 * {
 *   "to": "+E.164",
 *   "template": "otp" | "reminder",
 *   "dryRun": true | false,   // default true
 *   "code"?: "123456",        // required for otp
 *   "group"?: "Weekend trip", // optional for reminder; blank uses sample
 *   "amount"?: "Rs 450"       // optional for reminder; blank uses sample
 * }
 *
 * Secrets (Supabase / GitHub Production — never commit):
 * - WHATSAPP_DRY_RUN_SECRET          — admin shared secret (recommended)
 * - WHATSAPP_TOKEN                   — required for dryRun:false
 * - WHATSAPP_PHONE_NUMBER_ID         — required for dryRun:false
 * - WHATSAPP_OTP_TEMPLATE_NAME       — default sharedmoney_otp
 * - WHATSAPP_OTP_TEMPLATE_LANG       — default en
 * - WHATSAPP_REMINDER_TEMPLATE_NAME  — optional; required when template=reminder
 * - WHATSAPP_REMINDER_TEMPLATE_LANG  — default en
 *
 * dryRun:true (default): validate + return Graph payload preview; Meta secrets optional.
 * dryRun:false: POST Graph API; return provider message id; never log full token.
 */
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { SUPABASE_SERVICE_ROLE_KEY } from '../_shared/env.ts';
import { log } from '../_shared/logger.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import {
  buildGraphMessagesUrl,
  buildWhatsAppTemplatePayload,
  getOptionalSecret,
  isMissingSecretsResult,
  isValidE164,
  loadWhatsAppTemplateConfig,
  resolveLiveSecrets,
  sendWhatsAppTemplateMessage,
  type WhatsAppTemplateKind,
} from '../_shared/whatsapp.ts';

interface DryRunBody {
  to?: unknown;
  template?: unknown;
  dryRun?: unknown;
  code?: unknown;
  group?: unknown;
  amount?: unknown;
}

function getBearerToken(req: Request): string | null {
  const authorization = req.headers.get('authorization') || req.headers.get('Authorization');
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() || null;
}

function getRequestSharedSecret(req: Request): string | null {
  const direct = req.headers.get('x-whatsapp-dry-run-secret')?.trim();
  if (direct) return direct;
  return getBearerToken(req);
}

function assertAdminAuth(req: Request): void {
  const expectedShared = getOptionalSecret('WHATSAPP_DRY_RUN_SECRET');
  const actualShared = getRequestSharedSecret(req);
  if (expectedShared && actualShared && actualShared === expectedShared) {
    return;
  }

  const bearer = getBearerToken(req);
  if (SUPABASE_SERVICE_ROLE_KEY && bearer && bearer === SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  if (!expectedShared && !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Missing required environment variable: WHATSAPP_DRY_RUN_SECRET (or SUPABASE_SERVICE_ROLE_KEY)',
    );
  }

  throw new Error('Unauthorized: invalid WhatsApp dry-run secret');
}

function parseTemplateKind(value: unknown): WhatsAppTemplateKind {
  if (value === 'otp' || value === 'reminder') return value;
  throw new Error('Invalid request: template must be "otp" or "reminder"');
}

function parseDryRun(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  throw new Error('Invalid request: dryRun must be a boolean');
}

function parseBody(raw: unknown): {
  to: string;
  template: WhatsAppTemplateKind;
  dryRun: boolean;
  code?: string;
  group?: string | null;
  amount?: string | null;
} {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid request: JSON body required');
  }
  const body = raw as DryRunBody;

  if (typeof body.to !== 'string' || !body.to.trim()) {
    throw new Error('Invalid request: to must be an E.164 phone number string');
  }
  const to = body.to.trim();
  if (!isValidE164(to)) {
    throw new Error('Invalid request: to must be E.164 (e.g. +14155552671)');
  }

  const template = parseTemplateKind(body.template);
  const dryRun = parseDryRun(body.dryRun);

  let code: string | undefined;
  if (body.code !== undefined && body.code !== null) {
    if (typeof body.code !== 'string') {
      throw new Error('Invalid request: code must be a string');
    }
    code = body.code.trim();
  }

  let group: string | null | undefined;
  if (body.group !== undefined && body.group !== null) {
    if (typeof body.group !== 'string') {
      throw new Error('Invalid request: group must be a string');
    }
    group = body.group.trim();
  } else if (body.group === null) {
    group = null;
  }

  let amount: string | null | undefined;
  if (body.amount !== undefined && body.amount !== null) {
    if (typeof body.amount !== 'string') {
      throw new Error('Invalid request: amount must be a string');
    }
    amount = body.amount.trim();
  } else if (body.amount === null) {
    amount = null;
  }

  return { to, template, dryRun, code, group, amount };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return createEmptyResponse(200, req);
  }

  if (req.method !== 'POST') {
    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  }

  try {
    assertAdminAuth(req);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new Error('Invalid request: JSON body required');
    }

    const { to, template, dryRun, code, group, amount } = parseBody(raw);
    const config = loadWhatsAppTemplateConfig();
    const payload = buildWhatsAppTemplatePayload({ to, template, code, group, amount, config });

    if (dryRun) {
      log.info('WhatsApp dry-run payload built', 'whatsapp-dry-run', {
        template,
        dryRun: true,
      });
      return createSuccessResponse({
        dry_run: true,
        template,
        to,
        graph_url_preview: buildGraphMessagesUrl(
          getOptionalSecret('WHATSAPP_PHONE_NUMBER_ID') || '{WHATSAPP_PHONE_NUMBER_ID}',
        ),
        payload,
      }, 200, 0, req);
    }

    const secrets = resolveLiveSecrets();
    if (isMissingSecretsResult(secrets)) {
      return createErrorResponse(
        503,
        'WhatsApp provider secrets not configured',
        'WHATSAPP_SECRETS_MISSING',
        `Missing: ${secrets.missing.join(', ')}`,
        req,
      );
    }

    const result = await sendWhatsAppTemplateMessage({
      token: secrets.token,
      phoneNumberId: secrets.phoneNumberId,
      payload,
    });

    log.info('WhatsApp template sent', 'whatsapp-dry-run', {
      template,
      messageId: result.messageId,
      dryRun: false,
    });

    return createSuccessResponse({
      dry_run: false,
      template,
      to,
      message_id: result.messageId,
    }, 200, 0, req);
  } catch (error: unknown) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('missing required environment variable')) {
        // Reminder template name (or auth secret) absent — surface clearly as 503.
        const match = error.message.match(/Missing required environment variable: (.+)$/);
        return createErrorResponse(
          503,
          'WhatsApp configuration incomplete',
          'WHATSAPP_SECRETS_MISSING',
          match ? `Missing: ${match[1]}` : error.message,
          req,
        );
      }
    }
    return handleError(error, 'whatsapp-dry-run handler', req);
  }
});
