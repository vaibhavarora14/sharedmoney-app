import { assertEquals } from "jsr:@std/assert@1";
import {
  buildSocialAuthTelemetry,
  classifySocialAuthFailure,
  createSocialAuthError,
  getBrowserUnavailableAlertActions,
  getSocialAuthUserMessage,
  isNoMatchingBrowserActivityError,
  readSocialAuthKind,
  sanitizeSocialAuthErrorMessage,
  shouldRetryAppleNativeAuth,
} from "./socialAuth.ts";

Deno.test("Google cancellation is expected", () => {
  assertEquals(
    classifySocialAuthFailure({
      provider: "google",
      stage: "browser_session",
      cancelled: true,
    }).kind,
    "cancelled",
  );
});

Deno.test("telemetry payload is grouped and excludes raw auth material", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";
  const failure = classifySocialAuthFailure({
    provider: "apple",
    stage: "native_request",
    code: "ERR_REQUEST_UNKNOWN",
    message: `unknown reason identity_token=${jwt}`,
  });
  const telemetry = buildSocialAuthTelemetry(failure, "attempt-123", {
    release: "2.20.1",
    build_number: "78",
    device_type: "physical",
  }, { retryCount: 1 });

  assertEquals(telemetry.fingerprint, ["auth.apple.apple_unknown"]);
  assertEquals(telemetry.level, "warning");
  assertEquals(telemetry.tags.auth_provider, "apple");
  assertEquals(telemetry.tags.auth_stage, "native_request");
  assertEquals(telemetry.tags.auth_code, "ERR_REQUEST_UNKNOWN");
  assertEquals(telemetry.extra.auth_attempt_id, "attempt-123");
  assertEquals(telemetry.extra.auth_retry_count, 1);
  assertEquals(
    telemetry.extra.provider_message,
    "unknown reason identity_token=[redacted]",
  );
  assertEquals(JSON.stringify(telemetry).includes(jwt), false);
});
Deno.test("sanitizer redacts JWTs, hex nonces, and labeled tokens", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";
  const sanitized = sanitizeSocialAuthErrorMessage(
    `Apple failed identity_token=${jwt} nonce=abcdef0123456789abcdef0123456789abcd bare ${jwt} hex abcdef0123456789abcdef0123456789abcd detail`,
  );

  assertEquals(sanitized?.includes(jwt), false);
  assertEquals(sanitized?.includes("abcdef0123456789abcdef0123456789abcd"), false);
  assertEquals(sanitized?.includes("identity_token=[redacted]"), true);
  assertEquals(sanitized?.includes("nonce=[redacted]"), true);
  assertEquals(sanitized?.includes("[redacted-jwt]"), true);
  assertEquals(sanitized?.includes("[redacted-hex]"), true);
});

Deno.test("untrusted error codes cannot become Sentry tags", () => {
  assertEquals(
    classifySocialAuthFailure({
      provider: "apple",
      stage: "native_request",
      code: "identity-token=secret value",
    }).code,
    "unknown",
  );
});

Deno.test("exact Android browser resolution failure is stable", () => {
  const failure = classifySocialAuthFailure({
    provider: "google",
    stage: "browser_session",
    message: "No matching browser activity found",
  });

  assertEquals(failure.kind, "browser_unavailable");
  assertEquals(failure.group, "auth.google.browser_unavailable");
  assertEquals(
    getSocialAuthUserMessage(failure),
    "No supported browser is available. Install or enable Chrome (or another browser), or use another sign-in method.",
  );

  const wrapped = new Error(
    "Call to function 'ExpoWebBrowser.openBrowserAsync' has been rejected.",
  );
  wrapped.cause = new Error("No matching activity!");
  assertEquals(isNoMatchingBrowserActivityError(wrapped), true);
  assertEquals(
    classifySocialAuthFailure({
      provider: "google",
      stage: "browser_session",
      message: "No matching activity!",
    }).kind,
    "browser_unavailable",
  );
});

Deno.test("browser-unavailable recovery offers email and optional WhatsApp", () => {
  const failure = classifySocialAuthFailure({
    provider: "google",
    stage: "browser_session",
    message: "No matching browser activity found",
  });
  const error = createSocialAuthError(failure);

  assertEquals(readSocialAuthKind(error), "browser_unavailable");
  assertEquals(
    getBrowserUnavailableAlertActions(false).map((action) => action.id),
    ["email", "dismiss"],
  );
  assertEquals(
    getBrowserUnavailableAlertActions(true).map((action) => action.text),
    ["Use WhatsApp", "Use email", "Not now"],
  );
});

Deno.test("Play Services failures are grouped for native Google", () => {
  const failure = classifySocialAuthFailure({
    provider: "google",
    stage: "native_request",
    code: "PLAY_SERVICES_NOT_AVAILABLE",
    message: "Play Services not available",
  });

  assertEquals(failure.kind, "play_services_unavailable");
  assertEquals(
    getSocialAuthUserMessage(failure),
    "Google Play Services is missing or outdated. Update Play Services, then try Google sign-in again.",
  );
});

Deno.test("Android developer errors map to provider configuration", () => {
  assertEquals(
    classifySocialAuthFailure({
      provider: "google",
      stage: "native_request",
      code: "DEVELOPER_ERROR",
      message: "Android OAuth client misconfigured",
    }).kind,
    "provider_configuration",
  );
});

Deno.test("Apple cancellation code creates no actionable failure", () => {
  assertEquals(
    classifySocialAuthFailure({
      provider: "apple",
      stage: "native_request",
      code: "ERR_REQUEST_CANCELED",
    }).kind,
    "cancelled",
  );
});

Deno.test("Apple unknown request code is grouped and not auto-retried", () => {
  const failure = classifySocialAuthFailure({
    provider: "apple",
    stage: "native_request",
    code: "ERR_REQUEST_UNKNOWN",
    message: "The operation couldn’t be completed for an unknown reason",
  });

  assertEquals(failure.kind, "apple_unknown");
  assertEquals(failure.group, "auth.apple.apple_unknown");
  assertEquals(shouldRetryAppleNativeAuth(failure), false);
  assertEquals(
    getSocialAuthUserMessage(failure),
    "Apple sign-in couldn’t be completed. Please try again, or use email or Google sign-in.",
  );
});

Deno.test("Google dismiss is interrupted, not a silent cancel", () => {
  const failure = classifySocialAuthFailure({
    provider: "google",
    stage: "browser_session",
    code: "WEB_BROWSER_DISMISS",
    message: "Google sign-in did not complete. Please try again.",
  });
  assertEquals(failure.kind, "interrupted");
  assertEquals(
    getSocialAuthUserMessage(failure),
    "Google sign-in did not complete. Please try again.",
  );
});

Deno.test("Apple unknown is not retried outside native_request", () => {
  const failure = classifySocialAuthFailure({
    provider: "apple",
    stage: "token_exchange",
    code: "ERR_REQUEST_UNKNOWN",
  });

  assertEquals(failure.kind, "apple_unknown");
  assertEquals(shouldRetryAppleNativeAuth(failure), false);
});

Deno.test("Apple cancellation is never treated as retryable unknown", () => {
  const failure = classifySocialAuthFailure({
    provider: "apple",
    stage: "native_request",
    code: "ERR_REQUEST_CANCELED",
  });

  assertEquals(failure.kind, "cancelled");
  assertEquals(shouldRetryAppleNativeAuth(failure), false);
});

Deno.test("provider configuration failures are separated from unexpected failures", () => {
  assertEquals(
    classifySocialAuthFailure({
      provider: "google",
      stage: "provider_request",
      message: "Unsupported provider: provider is not enabled",
    }).kind,
    "provider_configuration",
  );
  assertEquals(
    classifySocialAuthFailure({
      provider: "apple",
      stage: "session_verification",
      message: "Session was not created",
    }).kind,
    "unexpected",
  );
});

Deno.test("classified failure carries sanitized provider message for extras", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";
  const failure = classifySocialAuthFailure({
    provider: "apple",
    stage: "native_request",
    code: "ERR_REQUEST_UNKNOWN",
    message: `ERR_REQUEST_UNKNOWN ${jwt}`,
  });
  const telemetry = buildSocialAuthTelemetry(failure, "attempt-9", {});

  assertEquals(telemetry.extra.provider_message?.includes(jwt), false);
  assertEquals(telemetry.extra.provider_message?.includes("[redacted-jwt]"), true);
});
