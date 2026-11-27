/** Server `code` values the OTP edge function is known to return. */
export const WHATSAPP_OTP_ERROR_CODES = [
  "WHATSAPP_SEND_FAILED",
  "OTP_MISMATCH",
  "OTP_EXPIRED",
  "OTP_LOCKED",
  "OTP_INVALID",
  "RATE_LIMITED",
  "FEATURE_DISABLED",
  "VALIDATION_ERROR",
  "METHOD_NOT_ALLOWED",
  "WHATSAPP_BUDGET_EXHAUSTED",
  "INTERNAL_ERROR",
  "UNKNOWN_ERROR",
  "AUTH_ERROR",
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "RATE_LIMIT",
  "GATEWAY_ERROR",
  "TIMEOUT_ERROR",
  "NETWORK_ERROR",
  "SESSION_MINT_FAILED",
] as const;

export type WhatsAppOtpErrorCode = (typeof WHATSAPP_OTP_ERROR_CODES)[number];

export type WhatsAppOtpErrorBody = {
  error?: string;
  code?: string;
  details?: string;
};

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

export function isWhatsAppOtpErrorCode(code: string): code is WhatsAppOtpErrorCode {
  return (WHATSAPP_OTP_ERROR_CODES as readonly string[]).includes(code);
}

export class WhatsAppOtpApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    code: string,
    options?: { retryAfterSeconds?: number; status?: number },
  ) {
    super(message);
    this.name = "WhatsAppOtpApiError";
    this.code = code;
    this.status = options?.status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export function parseRetryAfterSeconds(details: string | undefined): number | undefined {
  if (!details) return undefined;
  const match = /retry_after=(\d+)/i.exec(details);
  if (!match) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Keep the server `code` when it is a safe identifier. Otherwise derive a
 * stable fallback from HTTP status so 5xx/timeouts are not thrown as a
 * plain Error (which used to map to PostHog `reason_code=unknown`).
 */
export function resolveWhatsAppOtpErrorCode(
  status: number,
  rawCode?: string,
): string {
  if (rawCode && SAFE_ERROR_CODE.test(rawCode)) return rawCode;
  if (status === 404) return "FEATURE_DISABLED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 408 || status === 504) return "TIMEOUT_ERROR";
  if (status >= 500) return "GATEWAY_ERROR";
  return "UNKNOWN_ERROR";
}

export function parseWhatsAppOtpFailure(
  status: number,
  body: WhatsAppOtpErrorBody | null,
): WhatsAppOtpApiError {
  const errBody = body ?? {};
  if (status === 404 || errBody.code === "FEATURE_DISABLED") {
    return new WhatsAppOtpApiError(
      "WhatsApp login is not available in this build.",
      "FEATURE_DISABLED",
      { status },
    );
  }

  const message = errBody.error || `Request failed (${status})`;
  return new WhatsAppOtpApiError(
    message,
    resolveWhatsAppOtpErrorCode(
      status,
      typeof errBody.code === "string" ? errBody.code : undefined,
    ),
    {
      status,
      retryAfterSeconds: parseRetryAfterSeconds(errBody.details),
    },
  );
}
