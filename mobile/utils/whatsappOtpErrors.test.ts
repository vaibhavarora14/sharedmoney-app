import { assertEquals } from "jsr:@std/assert@1";
import { mapAuthFailureReason } from "./authFunnelEvents.ts";
import {
  WHATSAPP_SEND_FAILED_USER_MESSAGE,
  WHATSAPP_TEMPORARY_PROBLEM_USER_MESSAGE,
  WHATSAPP_TIMEOUT_USER_MESSAGE,
} from "./phoneDisplay.ts";
import { WhatsAppOtpApiError } from "./whatsappOtpApiError.ts";
import {
  buildWhatsAppOtpFailureTelemetry,
  sanitizeWhatsAppOtpErrorMessage,
  userMessageForWhatsAppOtpError,
} from "./whatsappOtpErrors.ts";

Deno.test("WhatsApp OTP user copy is actionable for 5xx and timeouts", () => {
  assertEquals(
    userMessageForWhatsAppOtpError(
      new WhatsAppOtpApiError("Internal server error", "INTERNAL_ERROR", {
        status: 500,
      }),
      "Couldn't send WhatsApp code.",
    ),
    WHATSAPP_TEMPORARY_PROBLEM_USER_MESSAGE,
  );
  assertEquals(
    userMessageForWhatsAppOtpError(
      new WhatsAppOtpApiError("Request failed (502)", "GATEWAY_ERROR", {
        status: 502,
      }),
      "Couldn't send WhatsApp code.",
    ),
    WHATSAPP_TEMPORARY_PROBLEM_USER_MESSAGE,
  );
  assertEquals(
    userMessageForWhatsAppOtpError(
      new WhatsAppOtpApiError("Request timed out.", "TIMEOUT_ERROR"),
      "Couldn't send WhatsApp code.",
    ),
    WHATSAPP_TIMEOUT_USER_MESSAGE,
  );
  assertEquals(
    userMessageForWhatsAppOtpError(
      new WhatsAppOtpApiError(
        WHATSAPP_SEND_FAILED_USER_MESSAGE,
        "WHATSAPP_SEND_FAILED",
        { status: 502 },
      ),
      "Couldn't send WhatsApp code.",
    ),
    WHATSAPP_SEND_FAILED_USER_MESSAGE,
  );
  assertEquals(
    userMessageForWhatsAppOtpError(
      new WhatsAppOtpApiError("Incorrect code. Try again.", "OTP_MISMATCH", {
        status: 400,
      }),
      "Incorrect code. Try again.",
    ),
    "Incorrect code. Try again.",
  );
});

Deno.test("Sentry payload redacts phone, OTP, and tokens", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";
  const raw =
    `send failed phone=+919876543210 otp=112233 access_token=${jwt} nonce=abcdef0123456789abcdef0123456789abcd`;
  const sanitized = sanitizeWhatsAppOtpErrorMessage(raw);
  assertEquals(sanitized?.includes("+919876543210"), false);
  assertEquals(sanitized?.includes("112233"), false);
  assertEquals(sanitized?.includes(jwt), false);
  assertEquals(sanitized?.includes("abcdef0123456789abcdef0123456789abcd"), false);
  assertEquals(sanitized?.includes("phone=[redacted]"), true);
  assertEquals(sanitized?.includes("otp=[redacted]"), true);

  const error = new WhatsAppOtpApiError(raw, "INTERNAL_ERROR", { status: 500 });
  const telemetry = buildWhatsAppOtpFailureTelemetry({
    step: "send",
    error,
    reasonCode: mapAuthFailureReason(error),
    runtimeTags: { platform: "android", release: "2.68.0" },
    appVersion: "2.68.0",
  });

  assertEquals(telemetry.message, "WhatsApp OTP send failed: server_error");
  assertEquals(telemetry.level, "error");
  assertEquals(telemetry.fingerprint, ["auth.whatsapp.send.server_error"]);
  assertEquals(telemetry.tags.otp_step, "send");
  assertEquals(telemetry.tags.http_status, "500");
  assertEquals(telemetry.tags.otp_error_code, "INTERNAL_ERROR");
  assertEquals(telemetry.tags.app_version, "2.68.0");
  assertEquals(telemetry.tags.reason_code, "server_error");
  assertEquals(telemetry.extra.http_status, 500);
  const serialized = JSON.stringify(telemetry);
  assertEquals(serialized.includes("+919876543210"), false);
  assertEquals(serialized.includes("112233"), false);
  assertEquals(serialized.includes(jwt), false);
});

Deno.test("reason-code mapping covers each WhatsApp OTP error class", () => {
  const cases: Array<[WhatsAppOtpApiError, string]> = [
    [
      new WhatsAppOtpApiError("timeout", "TIMEOUT_ERROR"),
      "timeout",
    ],
    [
      new WhatsAppOtpApiError("offline", "NETWORK_ERROR"),
      "network",
    ],
    [
      new WhatsAppOtpApiError("slow down", "RATE_LIMITED", { status: 429 }),
      "rate_limited",
    ],
    [
      new WhatsAppOtpApiError("Incorrect code. Try again.", "OTP_MISMATCH"),
      "otp_invalid",
    ],
    [
      new WhatsAppOtpApiError("This code has expired.", "OTP_EXPIRED"),
      "otp_expired",
    ],
    [
      new WhatsAppOtpApiError("couldn't send", "WHATSAPP_SEND_FAILED", {
        status: 502,
      }),
      "otp_send_failed",
    ],
    [
      new WhatsAppOtpApiError("disabled", "FEATURE_DISABLED", { status: 404 }),
      "provider_configuration",
    ],
    [
      new WhatsAppOtpApiError("Internal server error", "INTERNAL_ERROR", {
        status: 500,
      }),
      "server_error",
    ],
    [
      new WhatsAppOtpApiError(
        "WhatsApp sign-in is only available for supported country codes.",
        "VALIDATION_ERROR",
        { status: 400 },
      ),
      "unsupported_country",
    ],
  ];

  for (const [error, expected] of cases) {
    assertEquals(mapAuthFailureReason(error), expected);
  }
});
