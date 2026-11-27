import type { SocialAuthFailureKind } from "./socialAuth";
import { isBenignConnectivityError } from "./networkErrors";

/**
 * Pure helpers for the pre-auth sign-in funnel (PostHog project 563625).
 *
 * Payloads are enums and booleans only. These functions never return an email,
 * phone, name, token, or raw error message.
 *
 * `cancelled` is a real reason code so callers can recognize user aborts, but
 * `auth_failed` must not be emitted for it — see shouldCaptureSocialAuthFailure
 * and captureAuthFailed. A non-blocking Apple profile-name update
 * (`profile_update`) is also omitted: the session still succeeds.
 */

export const AUTH_FAILURE_REASON_CODES = [
  "cancelled",
  "browser_unavailable",
  "play_services_unavailable",
  "provider_configuration",
  "invalid_credentials",
  "email_not_confirmed",
  "already_registered",
  "weak_password",
  "network",
  "otp_invalid",
  "otp_expired",
  "otp_send_failed",
  "rate_limited",
  "apple_unknown",
  "interrupted",
  "timeout",
  "server_error",
  "unsupported_country",
  "unknown",
] as const;

export type AuthFailureReasonCode = (typeof AUTH_FAILURE_REASON_CODES)[number];

export type AuthFunnelStep = "methods" | "email" | "phone" | "otp";
export type AuthFunnelMode = "sign_in" | "sign_up";
export type AuthFunnelMethod = "apple" | "google" | "email" | "whatsapp";

/** created_at within this window of last_sign_in_at (or now) counts as a signup. */
export const NEW_AUTH_USER_WINDOW_MS = 10 * 60 * 1000;

const SOCIAL_KIND_REASON: Record<SocialAuthFailureKind, AuthFailureReasonCode> =
  {
    cancelled: "cancelled",
    browser_unavailable: "browser_unavailable",
    play_services_unavailable: "play_services_unavailable",
    provider_configuration: "provider_configuration",
    apple_unknown: "apple_unknown",
    interrupted: "interrupted",
    unexpected: "unknown",
  };

type ErrorShape = {
  message: string;
  code?: string;
  status?: number;
  name?: string;
  socialAuthKind?: string;
};

function isSocialAuthFailureKind(kind: string): kind is SocialAuthFailureKind {
  return Object.prototype.hasOwnProperty.call(SOCIAL_KIND_REASON, kind);
}

function readErrorShape(error: unknown): ErrorShape {
  if (typeof error === "string") {
    return { message: error };
  }
  if (!error || typeof error !== "object") {
    return { message: "" };
  }

  const record = error as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    name?: unknown;
    socialAuthKind?: unknown;
  };
  return {
    message: typeof record.message === "string" ? record.message : "",
    name: typeof record.name === "string" ? record.name : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
    status: typeof record.status === "number" ? record.status : undefined,
    socialAuthKind:
      typeof record.socialAuthKind === "string"
        ? record.socialAuthKind
        : undefined,
  };
}

function normalizeMessage(message: string): string {
  return message.toLowerCase().replace(/’/g, "'");
}

/**
 * Structured WhatsApp OTP codes. Unknown codes return null so message
 * heuristics can still classify the error.
 */
function reasonFromOtpCode(
  code: string,
  message: string,
): AuthFailureReasonCode | null {
  switch (code) {
    case "WHATSAPP_SEND_FAILED":
    case "WHATSAPP_BUDGET_EXHAUSTED":
      return "otp_send_failed";
    case "OTP_MISMATCH":
    case "OTP_INVALID":
      return "otp_invalid";
    case "OTP_EXPIRED":
      return "otp_expired";
    case "OTP_LOCKED":
    case "RATE_LIMITED":
    case "RATE_LIMIT":
      return "rate_limited";
    case "FEATURE_DISABLED":
    case "METHOD_NOT_ALLOWED":
    case "AUTH_ERROR":
    case "PERMISSION_DENIED":
    case "NOT_FOUND":
      return "provider_configuration";
    case "VALIDATION_ERROR":
      return message.includes("country")
        ? "unsupported_country"
        : "unknown";
    case "INTERNAL_ERROR":
    case "UNKNOWN_ERROR":
    case "GATEWAY_ERROR":
    case "SESSION_MINT_FAILED":
      return "server_error";
    case "TIMEOUT_ERROR":
      return "timeout";
    case "NETWORK_ERROR":
      return "network";
    default:
      return null;
  }
}

function reasonFromSignals(shape: ErrorShape): AuthFailureReasonCode {
  const message = normalizeMessage(shape.message);
  const otpReason = shape.code ? reasonFromOtpCode(shape.code, message) : null;
  if (otpReason) return otpReason;

  const code = shape.code ?? "";

  if (
    code === "ERR_REQUEST_CANCELED" ||
    message.includes("authentication was cancelled") ||
    message.includes("authentication was canceled") ||
    message.includes("user cancelled") ||
    message.includes("user canceled")
  ) {
    return "cancelled";
  }

  if (
    message.includes("no matching browser activity") ||
    message.includes("no matching activity") ||
    message.includes("no supported browser")
  ) {
    return "browser_unavailable";
  }

  if (
    code === "PLAY_SERVICES_NOT_AVAILABLE" ||
    message.includes("play services")
  ) {
    return "play_services_unavailable";
  }

  if (
    code === "GOOGLE_NATIVE_UNAVAILABLE" ||
    code === "DEVELOPER_ERROR" ||
    message.includes("only available on ios") ||
    message.includes("not available on this device") ||
    message.includes("temporarily unavailable") ||
    message.includes("unsupported provider") ||
    message.includes("provider is not enabled")
  ) {
    return "provider_configuration";
  }

  if (
    shape.status === 429 ||
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    message.includes("rate limit") ||
    message.includes("too many")
  ) {
    return "rate_limited";
  }

  if (
    code === "invalid_credentials" ||
    message.includes("invalid login credentials") ||
    message.includes("invalid email or password") ||
    message.includes("invalid credentials")
  ) {
    return "invalid_credentials";
  }

  if (
    code === "email_not_confirmed" ||
    (message.includes("email") && message.includes("confirm"))
  ) {
    return "email_not_confirmed";
  }

  if (
    code === "user_already_registered" ||
    message.includes("already registered") ||
    message.includes("already exists")
  ) {
    return "already_registered";
  }

  if (
    code === "weak_password" ||
    message.includes("too weak") ||
    (message.includes("password") && message.includes("weak"))
  ) {
    return "weak_password";
  }

  if (
    message.includes("couldn't send") ||
    message.includes("could not send")
  ) {
    return "otp_send_failed";
  }

  if (
    message.includes("code has expired") ||
    message.includes("expired code")
  ) {
    return "otp_expired";
  }

  if (
    message.includes("incorrect code") ||
    message.includes("invalid code")
  ) {
    return "otp_invalid";
  }

  if (
    message.includes("supported country") ||
    message.includes("country code")
  ) {
    return "unsupported_country";
  }

  if (
    shape.status === 408 ||
    shape.status === 504 ||
    message.includes("timed out") ||
    message.includes("timeout")
  ) {
    return "timeout";
  }

  if (
    shape.status === 500 ||
    shape.status === 502 ||
    shape.status === 503 ||
    message.includes("internal server error") ||
    message.includes("request failed (5") ||
    message.includes("session was not created")
  ) {
    return "server_error";
  }

  if (
    isBenignConnectivityError({ name: shape.name, message: shape.message }) ||
    message.includes("unable to connect") ||
    message.includes("check your internet") ||
    message.includes("check your connection") ||
    message.includes("network request failed") ||
    message.includes("failed to fetch")
  ) {
    return "network";
  }

  return "unknown";
}

/**
 * Map a provider/API error to a short reason code.
 * Social kinds win, except `unexpected` and `apple_unknown`, which still
 * inspect the message so a network failure is not collapsed early.
 */
export function mapAuthFailureReason(error: unknown): AuthFailureReasonCode {
  const shape = readErrorShape(error);
  if (
    shape.socialAuthKind &&
    isSocialAuthFailureKind(shape.socialAuthKind) &&
    shape.socialAuthKind !== "unexpected" &&
    shape.socialAuthKind !== "apple_unknown"
  ) {
    return SOCIAL_KIND_REASON[shape.socialAuthKind];
  }

  const fromSignals = reasonFromSignals(shape);
  if (fromSignals !== "unknown") return fromSignals;

  if (
    shape.socialAuthKind &&
    isSocialAuthFailureKind(shape.socialAuthKind)
  ) {
    return SOCIAL_KIND_REASON[shape.socialAuthKind];
  }

  return "unknown";
}

export function authFailureReasonFromSocialKind(
  kind: SocialAuthFailureKind,
): AuthFailureReasonCode {
  return SOCIAL_KIND_REASON[kind];
}

/**
 * Reason for a classified social failure. Generic Apple/unexpected kinds still
 * consult the sanitized provider message so network failures stay `network`.
 * The message itself is never returned.
 */
export function authFailureReasonFromSocialFailure(failure: {
  kind: SocialAuthFailureKind;
  code?: string;
  providerMessage?: string;
}): AuthFailureReasonCode {
  if (failure.kind !== "unexpected" && failure.kind !== "apple_unknown") {
    return authFailureReasonFromSocialKind(failure.kind);
  }

  return mapAuthFailureReason({
    code: failure.code,
    message: failure.providerMessage,
  });
}

/**
 * User cancels are not funnel failures. Apple profile-name updates are not
 * either: sign-in continues and `auth_succeeded` still fires.
 */
export function shouldCaptureSocialAuthFailure(
  kind: SocialAuthFailureKind,
  stage: string,
): boolean {
  return kind !== "cancelled" && stage !== "profile_update";
}

export function authScreenViewedProperties(input: {
  step: AuthFunnelStep;
  mode: AuthFunnelMode;
  platform: string;
  whatsappEnabled: boolean;
  appleAvailable: boolean;
}): {
  step: AuthFunnelStep;
  mode: AuthFunnelMode;
  platform: string;
  whatsapp_enabled: boolean;
  apple_available: boolean;
} {
  return {
    step: input.step,
    mode: input.mode,
    platform: input.platform,
    whatsapp_enabled: input.whatsappEnabled,
    apple_available: input.appleAvailable,
  };
}

export function authMethodSelectedProperties(input: {
  method: AuthFunnelMethod;
  mode: AuthFunnelMode;
  platform: string;
}): {
  method: AuthFunnelMethod;
  mode: AuthFunnelMode;
  platform: string;
} {
  return {
    method: input.method,
    mode: input.mode,
    platform: input.platform,
  };
}

export function authFailedProperties(input: {
  method: AuthFunnelMethod;
  reasonCode: AuthFailureReasonCode;
  platform: string;
}): {
  method: AuthFunnelMethod;
  reason_code: AuthFailureReasonCode;
  platform: string;
} {
  return {
    method: input.method,
    reason_code: input.reasonCode,
    platform: input.platform,
  };
}

export function authSucceededProperties(input: {
  authProvider: string;
  platform: string;
  isNewUser: boolean;
  fromGuest?: boolean;
}): {
  auth_provider: string;
  platform: string;
  is_new_user: boolean;
  from_guest?: boolean;
} {
  return {
    auth_provider: input.authProvider || "unknown",
    platform: input.platform,
    is_new_user: input.isNewUser,
    ...(input.fromGuest ? { from_guest: true } : {}),
  };
}

function parseAuthTimestamp(
  value: string | number | null | undefined,
): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * True when Supabase `created_at` is within 10 minutes of `last_sign_in_at`.
 * If `last_sign_in_at` is missing, compares against `now`. Missing or
 * unparseable `created_at`, or no reference timestamp, is false.
 */
/**
 * WhatsApp OTP mints an email-provider session, so app_metadata.provider is
 * "email". Prefer the method the user just completed when it is known.
 */
export function resolveAuthProvider(input: {
  appProvider?: string | null;
  pendingMethod?: AuthFunnelMethod | null;
}): string {
  switch (input.pendingMethod) {
    case "whatsapp":
      return "whatsapp";
    case "apple":
      return "apple";
    case "google":
      return "google";
    case "email":
      return "email";
    case null:
    case undefined:
      break;
    default: {
      const _exhaustive: never = input.pendingMethod;
      return _exhaustive;
    }
  }

  if (typeof input.appProvider === "string" && input.appProvider.trim()) {
    return input.appProvider;
  }
  return "unknown";
}

export function isNewAuthUser(input: {
  createdAt?: string | number | null;
  lastSignInAt?: string | number | null;
  now?: string | number | null;
}): boolean {
  const createdAt = parseAuthTimestamp(input.createdAt);
  if (createdAt == null) return false;

  const reference =
    parseAuthTimestamp(input.lastSignInAt) ?? parseAuthTimestamp(input.now);
  if (reference == null) return false;

  return Math.abs(createdAt - reference) <= NEW_AUTH_USER_WINDOW_MS;
}
