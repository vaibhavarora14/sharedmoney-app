/**
 * WhatsApp OTP login helpers: generation, hashing, expiry, rate limits.
 * Delivery uses Meta Cloud API (template or free-form text) via whatsapp.ts.
 */

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_SENDS_PER_HOUR = 5;
export const OTP_MAX_ATTEMPTS = 5;

export const WHATSAPP_OTP_FEATURE_ENV = 'ENABLE_WHATSAPP_OTP_LOGIN';
export const WHATSAPP_OTP_PEPPER_ENV = 'WHATSAPP_OTP_PEPPER';
export const WHATSAPP_OTP_DELIVERY_ENV = 'WHATSAPP_OTP_DELIVERY';

export type WhatsAppOtpDeliveryMode = 'text' | 'template';

export interface OtpChallengeRecord {
  id: string;
  phone_e164: string;
  code_hash: string;
  expires_at: string;
  attempt_count: number;
  max_attempts: number;
  consumed_at: string | null;
  created_at: string;
}

export function isWhatsAppOtpLoginEnabled(env: Deno.Env = Deno.env): boolean {
  return env.get(WHATSAPP_OTP_FEATURE_ENV)?.trim() === 'true';
}

/**
 * Test/default delivery: free-form text to Meta allowlisted test recipients.
 * Production path once sharedmoney_otp is approved: template.
 */
export function resolveOtpDeliveryMode(env: Deno.Env = Deno.env): WhatsAppOtpDeliveryMode {
  const raw = env.get(WHATSAPP_OTP_DELIVERY_ENV)?.trim().toLowerCase();
  if (raw === 'template') return 'template';
  return 'text';
}

export function generateOtpCode(length = OTP_LENGTH): string {
  if (length < 4 || length > 8) {
    throw new Error('OTP length must be 4–8');
  }
  const digits = new Uint8Array(length);
  crypto.getRandomValues(digits);
  return Array.from(digits, (n) => (n % 10).toString()).join('');
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashOtpCode(
  code: string,
  phoneE164: string,
  pepper: string,
): Promise<string> {
  const normalizedCode = code.trim();
  if (!/^\d{4,8}$/.test(normalizedCode)) {
    throw new Error('Invalid OTP code format');
  }
  if (!pepper.trim()) {
    throw new Error(`Missing required environment variable: ${WHATSAPP_OTP_PEPPER_ENV}`);
  }
  const material = `${pepper.trim()}:${phoneE164.trim()}:${normalizedCode}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(material),
  );
  return toHex(digest);
}

export async function codesMatch(
  code: string,
  phoneE164: string,
  pepper: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = await hashOtpCode(code, phoneE164, pepper);
  if (actual.length !== expectedHash.length) return false;
  // Constant-time-ish compare for equal-length hex strings.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

export function otpExpiresAt(now = new Date(), expiryMs = OTP_EXPIRY_MS): Date {
  return new Date(now.getTime() + expiryMs);
}

export function isOtpExpired(expiresAt: string | Date, now = new Date()): boolean {
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return expiry.getTime() <= now.getTime();
}

export function assertResendAllowed(
  latestCreatedAt: string | Date | null | undefined,
  now = new Date(),
  cooldownMs = OTP_RESEND_COOLDOWN_MS,
): void {
  if (!latestCreatedAt) return;
  const created = typeof latestCreatedAt === 'string'
    ? new Date(latestCreatedAt)
    : latestCreatedAt;
  const elapsed = now.getTime() - created.getTime();
  if (elapsed < cooldownMs) {
    const waitSec = Math.ceil((cooldownMs - elapsed) / 1000);
    throw new OtpRateLimitError(
      `Please wait ${waitSec}s before requesting another code.`,
      waitSec,
    );
  }
}

export function assertHourlySendLimit(
  sendsInLastHour: number,
  max = OTP_MAX_SENDS_PER_HOUR,
): void {
  if (sendsInLastHour >= max) {
    throw new OtpRateLimitError(
      'Too many code requests. Try again later.',
      3600,
    );
  }
}

export function assertChallengeVerifiable(
  challenge: OtpChallengeRecord | null,
  now = new Date(),
): OtpChallengeRecord {
  if (!challenge) {
    throw new OtpVerifyError('No active code for this number. Request a new one.');
  }
  if (challenge.consumed_at) {
    throw new OtpVerifyError('This code was already used. Request a new one.');
  }
  if (isOtpExpired(challenge.expires_at, now)) {
    throw new OtpVerifyError('This code has expired. Request a new one.');
  }
  if (challenge.attempt_count >= challenge.max_attempts) {
    throw new OtpVerifyError('Too many incorrect attempts. Request a new code.');
  }
  return challenge;
}

export function buildOtpTextBody(code: string): string {
  return `Your SharedMoney verification code is ${code}. It expires in 10 minutes. Do not share this code.`;
}

/** Deterministic placeholder email for phone-only WhatsApp accounts. */
export function phonePlaceholderEmail(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `wa.${digits}@phone.sharedmoney.internal`;
}

export class OtpRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'OtpRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class OtpVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtpVerifyError';
  }
}
