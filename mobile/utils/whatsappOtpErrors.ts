import type { AuthFailureReasonCode } from "./authFunnelEvents";
import {
  WHATSAPP_SEND_FAILED_USER_MESSAGE,
  WHATSAPP_TEMPORARY_PROBLEM_USER_MESSAGE,
  WHATSAPP_TIMEOUT_USER_MESSAGE,
} from "./phoneDisplay";
import { WhatsAppOtpApiError } from "./whatsappOtpApiError";

export type WhatsAppOtpFailureStep = "send" | "verify";

export type WhatsAppOtpFailureTelemetry = {
  message: string;
  level: "warning" | "error";
  fingerprint: string[];
  tags: Record<string, string>;
  extra: {
    otp_step: WhatsAppOtpFailureStep;
    reason_code: AuthFailureReasonCode;
    app_version: string;
    otp_error_code?: string;
    http_status?: number;
    error_message?: string;
  };
};

const GENERIC_SERVER_MESSAGE =
  /^(internal server error|unknown error|request failed \(\d+\))$/i;

/**
 * Strip phone numbers, OTPs, and tokens before attaching a message to Sentry.
 * Never include the raw provider payload.
 */
export function sanitizeWhatsAppOtpErrorMessage(
  message?: string,
): string | undefined {
  if (!message) return undefined;

  let sanitized = message
    .replace(
      /\b(phone|phone_e164|to)\b\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\b(otp|code)\b\s*[:=]\s*\d{4,8}/gi, "$1=[redacted]")
    .replace(
      /\b(identity[_-]?token|id[_-]?token|access[_-]?token|refresh[_-]?token|nonce|token)\b\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\+\d{7,15}/g, "[redacted-phone]")
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[redacted-jwt]",
    )
    .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted-hex]")
    .trim();

  if (!sanitized) return undefined;
  if (sanitized.length > 240) {
    sanitized = `${sanitized.slice(0, 240)}…`;
  }
  return sanitized;
}

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status)
    ? status
    : undefined;
}

function readCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code : undefined;
}

function readMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function sentryLevelForReason(
  reasonCode: AuthFailureReasonCode,
): "warning" | "error" {
  switch (reasonCode) {
    case "server_error":
    case "unknown":
    case "otp_send_failed":
    case "provider_configuration":
      return "error";
    case "cancelled":
    case "browser_unavailable":
    case "play_services_unavailable":
    case "invalid_credentials":
    case "email_not_confirmed":
    case "already_registered":
    case "weak_password":
    case "network":
    case "otp_invalid":
    case "otp_expired":
    case "rate_limited":
    case "apple_unknown":
    case "interrupted":
    case "timeout":
    case "unsupported_country":
      return "warning";
    default: {
      const _exhaustive: never = reasonCode;
      return _exhaustive;
    }
  }
}

export function isGenericWhatsAppOtpServerMessage(message: string): boolean {
  return GENERIC_SERVER_MESSAGE.test(message.trim());
}

/**
 * Actionable copy for the auth form. Server messages that are already
 * user-facing (mismatch, expired, country, rate limit) are kept.
 */
export function userMessageForWhatsAppOtpError(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof WhatsAppOtpApiError) {
    switch (error.code) {
      case "WHATSAPP_SEND_FAILED":
        return WHATSAPP_SEND_FAILED_USER_MESSAGE;
      case "TIMEOUT_ERROR":
        return WHATSAPP_TIMEOUT_USER_MESSAGE;
      case "INTERNAL_ERROR":
      case "UNKNOWN_ERROR":
      case "GATEWAY_ERROR":
      case "SESSION_MINT_FAILED":
        return WHATSAPP_TEMPORARY_PROBLEM_USER_MESSAGE;
      case "NETWORK_ERROR":
        return error.message || fallback;
      default:
        break;
    }
    if (isGenericWhatsAppOtpServerMessage(error.message)) {
      return WHATSAPP_TEMPORARY_PROBLEM_USER_MESSAGE;
    }
    return error.message || fallback;
  }

  const message = readMessage(error);
  if (!message) return fallback;
  if (isGenericWhatsAppOtpServerMessage(message)) {
    return WHATSAPP_TEMPORARY_PROBLEM_USER_MESSAGE;
  }
  return message;
}

export function buildWhatsAppOtpFailureTelemetry(input: {
  step: WhatsAppOtpFailureStep;
  error: unknown;
  reasonCode: AuthFailureReasonCode;
  runtimeTags: Record<string, string>;
  appVersion: string;
}): WhatsAppOtpFailureTelemetry {
  const status = readStatus(input.error);
  const code = readCode(input.error);
  const errorMessage = sanitizeWhatsAppOtpErrorMessage(readMessage(input.error));
  const httpStatusTag =
    typeof status === "number" && status > 0 ? String(status) : "none";

  return {
    message: `WhatsApp OTP ${input.step} failed: ${input.reasonCode}`,
    level: sentryLevelForReason(input.reasonCode),
    fingerprint: [`auth.whatsapp.${input.step}.${input.reasonCode}`],
    tags: {
      ...input.runtimeTags,
      auth_provider: "whatsapp",
      otp_step: input.step,
      reason_code: input.reasonCode,
      otp_error_code: code || "none",
      http_status: httpStatusTag,
      app_version: input.appVersion,
    },
    extra: {
      otp_step: input.step,
      reason_code: input.reasonCode,
      app_version: input.appVersion,
      ...(code ? { otp_error_code: code } : {}),
      ...(typeof status === "number" && status > 0
        ? { http_status: status }
        : {}),
      ...(errorMessage ? { error_message: errorMessage } : {}),
    },
  };
}
