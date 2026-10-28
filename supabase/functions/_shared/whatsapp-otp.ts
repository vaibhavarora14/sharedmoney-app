/**
 * WhatsApp OTP login helpers: generation, hashing, expiry, rate limits,
 * monthly INR budget, country allow-list, and IP fingerprinting.
 * Delivery uses Meta Cloud API (template or free-form text) via whatsapp.ts.
 */

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_SENDS_PER_HOUR = 5;
export const OTP_MAX_SENDS_PER_IP_HOUR = 10;
export const OTP_MAX_ATTEMPTS = 5;

export const WHATSAPP_OTP_FEATURE_ENV = 'ENABLE_WHATSAPP_OTP_LOGIN';
export const WHATSAPP_OTP_PEPPER_ENV = 'WHATSAPP_OTP_PEPPER';
export const WHATSAPP_OTP_DELIVERY_ENV = 'WHATSAPP_OTP_DELIVERY';
export const WHATSAPP_MONTHLY_BUDGET_INR_ENV = 'WHATSAPP_MONTHLY_BUDGET_INR';
export const WHATSAPP_OTP_COST_INR_ENV = 'WHATSAPP_OTP_COST_INR';
export const WHATSAPP_OTP_ALLOWED_COUNTRY_CODES_ENV =
  'WHATSAPP_OTP_ALLOWED_COUNTRY_CODES';

/** Default monthly Meta template spend cap (INR, incl. estimated GST). */
export const DEFAULT_WHATSAPP_MONTHLY_BUDGET_INR = 500;
/** Estimated cost per auth template (₹0.115 Meta + ~18% GST ≈ ₹0.14). */
export const DEFAULT_WHATSAPP_OTP_COST_INR = 0.14;
/** Digits-only calling codes; India only by default. */
export const DEFAULT_WHATSAPP_OTP_ALLOWED_COUNTRY_CODES = ['91'] as const;

export const WHATSAPP_BUDGET_EXHAUSTED_MESSAGE =
  'WhatsApp sign-in is unavailable right now. Please use another sign-in method.';
export const WHATSAPP_BUDGET_EXHAUSTED_CODE = 'WHATSAPP_BUDGET_EXHAUSTED';

export type WhatsAppOtpDeliveryMode = 'text' | 'template';

export interface WhatsAppOtpBudgetConfig {
  monthlyBudgetInr: number;
  costInr: number;
  allowedCountryCodes: string[];
}

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

/**
 * IST calendar month key (YYYY-MM) for Meta spend ledger.
 * Asia/Kolkata is fixed UTC+05:30 (no DST).
 */
export function istBudgetMonth(now = new Date()): string {
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(now.getTime() + istOffsetMs);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function parseStrictPositiveNumber(
  raw: string | undefined,
  fallback: number,
): number | null {
  if (raw === undefined || raw === null) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function parseAllowedCountryCodes(raw: string | undefined): string[] | null {
  if (raw === undefined || raw === null) {
    return [...DEFAULT_WHATSAPP_OTP_ALLOWED_COUNTRY_CODES];
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return [...DEFAULT_WHATSAPP_OTP_ALLOWED_COUNTRY_CODES];
  }
  const codes = trimmed
    .split(/[,\s]+/)
    .map((part) => part.replace(/^\+/, '').trim())
    .filter(Boolean);
  if (codes.length === 0) return null;
  if (codes.some((code) => !/^\d{1,4}$/.test(code))) return null;
  return [...new Set(codes)];
}

/**
 * Read budget / cost / country allow-list. Invalid explicit values fail closed
 * (returns null → caller must refuse the send).
 */
export function resolveWhatsAppOtpBudgetConfig(
  env: Deno.Env = Deno.env,
): WhatsAppOtpBudgetConfig | null {
  const monthlyBudgetInr = parseStrictPositiveNumber(
    env.get(WHATSAPP_MONTHLY_BUDGET_INR_ENV),
    DEFAULT_WHATSAPP_MONTHLY_BUDGET_INR,
  );
  const costInr = parseStrictPositiveNumber(
    env.get(WHATSAPP_OTP_COST_INR_ENV),
    DEFAULT_WHATSAPP_OTP_COST_INR,
  );
  const allowedCountryCodes = parseAllowedCountryCodes(
    env.get(WHATSAPP_OTP_ALLOWED_COUNTRY_CODES_ENV),
  );
  if (
    monthlyBudgetInr === null ||
    costInr === null ||
    allowedCountryCodes === null ||
    costInr > monthlyBudgetInr
  ) {
    return null;
  }
  return { monthlyBudgetInr, costInr, allowedCountryCodes };
}

/**
 * Longest-prefix match of digits-only calling codes against an E.164 number.
 */
export function extractCountryCallingCode(
  phoneE164: string,
  allowedCodes: readonly string[],
): string | null {
  const digits = phoneE164.trim().replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(digits)) return null;
  const sorted = [...allowedCodes].sort((a, b) => b.length - a.length);
  for (const code of sorted) {
    if (digits.startsWith(code) && digits.length > code.length) {
      return code;
    }
  }
  return null;
}

export function isPhoneCountryAllowed(
  phoneE164: string,
  allowedCodes: readonly string[],
): boolean {
  return extractCountryCallingCode(phoneE164, allowedCodes) !== null;
}

/**
 * Client IP for per-IP rate limits.
 *
 * Prefer `x-real-ip`: the Supabase stack/API gateway sets this to the TCP peer
 * and replaces any client-supplied value. Else use the **rightmost**
 * `x-forwarded-for` hop (platform-appended). Never use the leftmost XFF entry —
 * clients can spoof it. Do not trust `cf-connecting-ip` here: hosted Edge
 * Functions are not documented to expose a Cloudflare-verified client IP.
 *
 * @see https://github.com/supabase/cli/pull/7345 (gateway appends peer to XFF / sets X-Real-IP)
 */
export function extractClientIp(req: Request): string | null {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return null;
}

/** SHA-256 hex fingerprint of IP + server salt (pepper). */
export async function hashRequestIp(
  ip: string,
  salt: string,
): Promise<string> {
  const material = `${salt.trim()}:ip:${ip.trim()}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(material),
  );
  return toHex(digest);
}

export function assertIpHourlySendLimit(
  sendsInLastHour: number,
  max = OTP_MAX_SENDS_PER_IP_HOUR,
): void {
  if (sendsInLastHour >= max) {
    throw new OtpRateLimitError(
      'Too many code requests from this network. Try again later.',
      3600,
    );
  }
}

/** Map reserve_whatsapp_otp_send Postgres errors to typed errors. */
export function mapReserveWhatsAppOtpError(message: string): Error {
  const text = message.trim();
  if (
    text.includes('WHATSAPP_BUDGET_EXHAUSTED') ||
    text.includes('whatsapp_budget_exhausted')
  ) {
    return new OtpBudgetExhaustedError();
  }
  const cooldown = /RATE_LIMITED:cooldown:(\d+)/i.exec(text);
  if (cooldown) {
    const waitSec = Number.parseInt(cooldown[1], 10) || 60;
    return new OtpRateLimitError(
      `Please wait ${waitSec}s before requesting another code.`,
      waitSec,
    );
  }
  if (/RATE_LIMITED:ip_hourly/i.test(text)) {
    return new OtpRateLimitError(
      'Too many code requests from this network. Try again later.',
      3600,
    );
  }
  if (/RATE_LIMITED:hourly/i.test(text)) {
    return new OtpRateLimitError(
      'Too many code requests. Try again later.',
      3600,
    );
  }
  return new OtpBudgetExhaustedError();
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

/** Seconds remaining before another OTP send is allowed for this challenge. */
export function resendCooldownRemainingSeconds(
  latestCreatedAt: string | Date | null | undefined,
  now = new Date(),
  cooldownMs = OTP_RESEND_COOLDOWN_MS,
): number {
  if (!latestCreatedAt) return 0;
  const created = typeof latestCreatedAt === 'string'
    ? new Date(latestCreatedAt)
    : latestCreatedAt;
  const elapsed = now.getTime() - created.getTime();
  if (elapsed >= cooldownMs) return 0;
  return Math.ceil((cooldownMs - elapsed) / 1000);
}

export type OtpVerifyErrorCode =
  | 'OTP_EXPIRED'
  | 'OTP_LOCKED'
  | 'OTP_INVALID';

export function assertChallengeVerifiable(
  challenge: OtpChallengeRecord | null,
  now = new Date(),
): OtpChallengeRecord {
  if (!challenge) {
    throw new OtpVerifyError(
      'No active code for this number. Request a new one.',
      'OTP_INVALID',
    );
  }
  if (challenge.consumed_at) {
    throw new OtpVerifyError(
      'This code was already used. Request a new one.',
      'OTP_INVALID',
    );
  }
  if (isOtpExpired(challenge.expires_at, now)) {
    throw new OtpVerifyError(
      'This code has expired. Request a new one.',
      'OTP_EXPIRED',
    );
  }
  if (challenge.attempt_count >= challenge.max_attempts) {
    throw new OtpVerifyError(
      'Too many incorrect attempts.',
      'OTP_LOCKED',
      resendCooldownRemainingSeconds(challenge.created_at, now),
    );
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

export class OtpBudgetExhaustedError extends Error {
  readonly code = WHATSAPP_BUDGET_EXHAUSTED_CODE;
  constructor(message = WHATSAPP_BUDGET_EXHAUSTED_MESSAGE) {
    super(message);
    this.name = 'OtpBudgetExhaustedError';
  }
}

export class OtpVerifyError extends Error {
  readonly code: OtpVerifyErrorCode;
  readonly retryAfterSeconds?: number;
  constructor(
    message: string,
    code: OtpVerifyErrorCode = 'OTP_INVALID',
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'OtpVerifyError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
