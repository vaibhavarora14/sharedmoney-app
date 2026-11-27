import { assertEquals } from "jsr:@std/assert@1";
import {
  AUTH_FAILURE_REASON_CODES,
  authFailedProperties,
  authFailureReasonFromSocialFailure,
  authMethodSelectedProperties,
  authScreenViewedProperties,
  authSucceededProperties,
  isNewAuthUser,
  mapAuthFailureReason,
  NEW_AUTH_USER_WINDOW_MS,
  resolveAuthProvider,
  shouldCaptureSocialAuthFailure,
} from "./authFunnelEvents.ts";

const CREATED = "2026-11-12T03:00:00.000Z";
const TEN_MINUTES_LATER = "2026-11-12T03:10:00.000Z";
const TEN_MINUTES_PLUS_1MS = "2026-11-12T03:10:00.001Z";
const RETURNING_SIGN_IN = "2026-11-12T12:00:00.000Z";

Deno.test("maps each auth failure family to a reason_code", () => {
  assertEquals(
    mapAuthFailureReason({ socialAuthKind: "cancelled" }),
    "cancelled",
  );
  assertEquals(
    mapAuthFailureReason(new Error("Authentication was cancelled")),
    "cancelled",
  );
  assertEquals(
    mapAuthFailureReason({ code: "ERR_REQUEST_CANCELED", message: "" }),
    "cancelled",
  );

  assertEquals(
    mapAuthFailureReason({ socialAuthKind: "browser_unavailable" }),
    "browser_unavailable",
  );
  assertEquals(
    mapAuthFailureReason(
      new Error("No matching browser activity found for Custom Tabs"),
    ),
    "browser_unavailable",
  );

  assertEquals(
    mapAuthFailureReason({ socialAuthKind: "play_services_unavailable" }),
    "play_services_unavailable",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "PLAY_SERVICES_NOT_AVAILABLE",
      message: "Google Play Services is missing",
    }),
    "play_services_unavailable",
  );

  assertEquals(
    mapAuthFailureReason({ socialAuthKind: "provider_configuration" }),
    "provider_configuration",
  );
  assertEquals(
    mapAuthFailureReason(
      new Error("Apple sign-in is not available on this device"),
    ),
    "provider_configuration",
  );
  assertEquals(
    mapAuthFailureReason({ code: "FEATURE_DISABLED", message: "disabled" }),
    "provider_configuration",
  );

  assertEquals(
    mapAuthFailureReason(
      new Error(
        "Invalid email or password. Please check your credentials and try again.",
      ),
    ),
    "invalid_credentials",
  );
  assertEquals(
    mapAuthFailureReason({
      status: 400,
      code: "invalid_credentials",
      message: "Invalid login credentials",
    }),
    "invalid_credentials",
  );

  assertEquals(
    mapAuthFailureReason(
      new Error(
        "Please check your email and confirm your account before signing in.",
      ),
    ),
    "email_not_confirmed",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "email_not_confirmed",
      message: "Email not confirmed",
    }),
    "email_not_confirmed",
  );

  assertEquals(
    mapAuthFailureReason(new Error("Network request failed")),
    "network",
  );
  assertEquals(
    mapAuthFailureReason(
      new Error(
        "Unable to connect. Check your internet connection and try again.",
      ),
    ),
    "network",
  );
  assertEquals(
    mapAuthFailureReason({
      name: "AuthRetryableFetchError",
      message: "request failed",
    }),
    "network",
  );

  assertEquals(
    mapAuthFailureReason({
      code: "OTP_MISMATCH",
      message: "Incorrect code. Try again.",
    }),
    "otp_invalid",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "OTP_EXPIRED",
      message: "This code has expired.",
    }),
    "otp_expired",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "OTP_INVALID",
      message: "Enter the code again.",
    }),
    "otp_invalid",
  );
  assertEquals(
    mapAuthFailureReason(new Error("Incorrect code. Try again.")),
    "otp_invalid",
  );

  assertEquals(
    mapAuthFailureReason({
      code: "WHATSAPP_SEND_FAILED",
      message: "Couldn't send WhatsApp code.",
    }),
    "otp_send_failed",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "WHATSAPP_BUDGET_EXHAUSTED",
      message: "budget",
    }),
    "otp_send_failed",
  );
  assertEquals(
    mapAuthFailureReason(new Error("Couldn't send a new code.")),
    "otp_send_failed",
  );

  assertEquals(
    mapAuthFailureReason(
      new Error(
        "Too many sign-in attempts. Please wait a moment and try again.",
      ),
    ),
    "rate_limited",
  );
  assertEquals(
    mapAuthFailureReason({ status: 429, message: "rate limit" }),
    "rate_limited",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "OTP_LOCKED",
      message: "Too many incorrect attempts.",
    }),
    "rate_limited",
  );
  assertEquals(
    mapAuthFailureReason({ code: "RATE_LIMITED", message: "slow down" }),
    "rate_limited",
  );

  assertEquals(
    mapAuthFailureReason(
      new Error(
        "An account with this email already exists. Please sign in instead.",
      ),
    ),
    "already_registered",
  );
  assertEquals(
    mapAuthFailureReason(
      new Error("Password is too weak. Please choose a stronger password."),
    ),
    "weak_password",
  );

  assertEquals(
    mapAuthFailureReason(new Error("An unexpected error occurred")),
    "unknown",
  );
  assertEquals(
    mapAuthFailureReason({
      socialAuthKind: "unexpected",
      message: "something else",
    }),
    "unknown",
  );
  assertEquals(
    mapAuthFailureReason({
      socialAuthKind: "apple_unknown",
      message: "Apple sign-in couldn’t be completed.",
    }),
    "apple_unknown",
  );
  assertEquals(
    mapAuthFailureReason({ socialAuthKind: "interrupted" }),
    "interrupted",
  );
  assertEquals(
    mapAuthFailureReason({ code: "VALIDATION_ERROR", message: "bad input" }),
    "unknown",
  );
});

Deno.test("maps WhatsApp OTP failures that previously fell through to unknown", () => {
  assertEquals(
    mapAuthFailureReason({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "Internal server error",
    }),
    "server_error",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "UNKNOWN_ERROR",
      status: 500,
      message: "Internal server error",
    }),
    "server_error",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "GATEWAY_ERROR",
      status: 502,
      message: "Request failed (502)",
    }),
    "server_error",
  );
  assertEquals(
    mapAuthFailureReason({
      status: 502,
      message: "Request failed (502)",
    }),
    "server_error",
  );
  assertEquals(
    mapAuthFailureReason({
      status: 504,
      message: "Request failed (504)",
    }),
    "timeout",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "TIMEOUT_ERROR",
      message: "Request timed out. Check your connection and try again.",
    }),
    "timeout",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "NETWORK_ERROR",
      message: "Unable to connect. Check your internet connection and try again.",
    }),
    "network",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "RATE_LIMIT",
      status: 429,
      message: "Too many requests",
    }),
    "rate_limited",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "METHOD_NOT_ALLOWED",
      message: "Method not allowed",
    }),
    "provider_configuration",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "SESSION_MINT_FAILED",
      message: "Failed to create session",
    }),
    "server_error",
  );
  assertEquals(
    mapAuthFailureReason(
      new Error("Session was not created after WhatsApp OTP sign-in"),
    ),
    "server_error",
  );
  assertEquals(
    mapAuthFailureReason({
      code: "VALIDATION_ERROR",
      message: "WhatsApp sign-in is only available for supported country codes.",
    }),
    "unsupported_country",
  );
  assertEquals(
    mapAuthFailureReason(
      new Error("This code has expired. Request a new one."),
    ),
    "otp_expired",
  );
});

Deno.test("unexpected social failures still map network messages", () => {
  assertEquals(
    authFailureReasonFromSocialFailure({
      kind: "unexpected",
      code: "unknown",
      providerMessage: "TypeError: Network request failed",
    }),
    "network",
  );
  assertEquals(
    authFailureReasonFromSocialFailure({
      kind: "browser_unavailable",
      providerMessage: "No matching browser activity",
    }),
    "browser_unavailable",
  );
});

Deno.test("reason codes never include raw error text or PII", () => {
  const reason = mapAuthFailureReason(
    new Error(
      "Invalid login credentials for ada@example.com phone +15551212 token=eyJhbGciOiJIUzI1NiJ9.payload.sig",
    ),
  );
  assertEquals(reason, "invalid_credentials");
  assertEquals(AUTH_FAILURE_REASON_CODES.includes(reason), true);
  assertEquals(reason.includes("@"), false);
  assertEquals(reason.includes("+"), false);
  assertEquals(reason.includes("eyJ"), false);
  assertEquals(reason.includes(" "), false);
});

Deno.test("user cancels and profile-name updates are not auth_failed", () => {
  assertEquals(shouldCaptureSocialAuthFailure("cancelled", "browser_session"), false);
  assertEquals(shouldCaptureSocialAuthFailure("browser_unavailable", "profile_update"), false);
  assertEquals(shouldCaptureSocialAuthFailure("unexpected", "token_exchange"), true);
  assertEquals(shouldCaptureSocialAuthFailure("apple_unknown", "native_request"), true);
  assertEquals(shouldCaptureSocialAuthFailure("interrupted", "browser_session"), true);
});

Deno.test("is_new_user is true only inside the 10 minute signup window", () => {
  assertEquals(NEW_AUTH_USER_WINDOW_MS, 10 * 60 * 1000);
  assertEquals(
    isNewAuthUser({
      createdAt: CREATED,
      lastSignInAt: "2026-11-12T03:04:00.000Z",
    }),
    true,
  );
  assertEquals(
    isNewAuthUser({
      createdAt: CREATED,
      lastSignInAt: TEN_MINUTES_LATER,
    }),
    true,
  );
  assertEquals(
    isNewAuthUser({
      createdAt: CREATED,
      lastSignInAt: TEN_MINUTES_PLUS_1MS,
    }),
    false,
  );
  assertEquals(
    isNewAuthUser({
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSignInAt: RETURNING_SIGN_IN,
      now: RETURNING_SIGN_IN,
    }),
    false,
  );
});

Deno.test("is_new_user falls back to now and is false when timestamps are missing", () => {
  assertEquals(
    isNewAuthUser({
      createdAt: CREATED,
      lastSignInAt: null,
      now: "2026-11-12T03:02:00.000Z",
    }),
    true,
  );
  assertEquals(
    isNewAuthUser({
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSignInAt: null,
      now: RETURNING_SIGN_IN,
    }),
    false,
  );
  assertEquals(
    isNewAuthUser({ createdAt: null, lastSignInAt: null }),
    false,
  );
  assertEquals(
    isNewAuthUser({ createdAt: null, lastSignInAt: RETURNING_SIGN_IN }),
    false,
  );
  assertEquals(
    isNewAuthUser({ createdAt: CREATED, lastSignInAt: null }),
    false,
  );
  assertEquals(
    isNewAuthUser({ createdAt: "", lastSignInAt: "" }),
    false,
  );
  assertEquals(
    isNewAuthUser({ createdAt: "not-a-date", lastSignInAt: RETURNING_SIGN_IN }),
    false,
  );
  assertEquals(
    isNewAuthUser({
      createdAt: CREATED,
      lastSignInAt: "not-a-date",
      now: null,
    }),
    false,
  );
});

Deno.test("WhatsApp OTP success is not labeled as email", () => {
  assertEquals(
    resolveAuthProvider({ appProvider: "email", pendingMethod: "whatsapp" }),
    "whatsapp",
  );
  assertEquals(
    resolveAuthProvider({ appProvider: "email", pendingMethod: "email" }),
    "email",
  );
  assertEquals(
    resolveAuthProvider({ appProvider: "google" }),
    "google",
  );
  assertEquals(resolveAuthProvider({}), "unknown");
});

Deno.test("auth funnel payloads are enums and booleans only", () => {
  assertEquals(
    authScreenViewedProperties({
      step: "methods",
      mode: "sign_in",
      platform: "android",
      whatsappEnabled: false,
      appleAvailable: false,
    }),
    {
      step: "methods",
      mode: "sign_in",
      platform: "android",
      whatsapp_enabled: false,
      apple_available: false,
    },
  );
  assertEquals(
    authMethodSelectedProperties({
      method: "email",
      mode: "sign_up",
      platform: "web",
    }),
    {
      method: "email",
      mode: "sign_up",
      platform: "web",
    },
  );
  assertEquals(
    authFailedProperties({
      method: "google",
      reasonCode: "browser_unavailable",
      platform: "android",
    }),
    {
      method: "google",
      reason_code: "browser_unavailable",
      platform: "android",
    },
  );
  assertEquals(
    authSucceededProperties({
      authProvider: "google",
      platform: "ios",
      isNewUser: true,
    }),
    {
      auth_provider: "google",
      platform: "ios",
      is_new_user: true,
    },
  );
  assertEquals(
    authSucceededProperties({
      authProvider: "",
      platform: "web",
      isNewUser: false,
    }),
    {
      auth_provider: "unknown",
      platform: "web",
      is_new_user: false,
    },
  );
});
