import { assertEquals } from "jsr:@std/assert@1";
import {
  parseWhatsAppOtpFailure,
  resolveWhatsAppOtpErrorCode,
  WhatsAppOtpApiError,
} from "./whatsappOtpApiError.ts";

Deno.test("keeps structured server codes instead of dropping them", () => {
  assertEquals(resolveWhatsAppOtpErrorCode(500, "INTERNAL_ERROR"), "INTERNAL_ERROR");
  assertEquals(resolveWhatsAppOtpErrorCode(502, "WHATSAPP_SEND_FAILED"), "WHATSAPP_SEND_FAILED");
  assertEquals(resolveWhatsAppOtpErrorCode(429, "RATE_LIMIT"), "RATE_LIMIT");
  assertEquals(resolveWhatsAppOtpErrorCode(400, "VALIDATION_ERROR"), "VALIDATION_ERROR");
});

Deno.test("derives a stable code when the gateway body has none", () => {
  assertEquals(resolveWhatsAppOtpErrorCode(502, undefined), "GATEWAY_ERROR");
  assertEquals(resolveWhatsAppOtpErrorCode(500, ""), "GATEWAY_ERROR");
  assertEquals(resolveWhatsAppOtpErrorCode(504, undefined), "TIMEOUT_ERROR");
  assertEquals(resolveWhatsAppOtpErrorCode(408, undefined), "TIMEOUT_ERROR");
  assertEquals(resolveWhatsAppOtpErrorCode(429, undefined), "RATE_LIMITED");
  assertEquals(resolveWhatsAppOtpErrorCode(404, undefined), "FEATURE_DISABLED");
  assertEquals(resolveWhatsAppOtpErrorCode(400, undefined), "UNKNOWN_ERROR");
  assertEquals(
    resolveWhatsAppOtpErrorCode(500, "not a safe code"),
    "GATEWAY_ERROR",
  );
});

Deno.test("parseWhatsAppOtpFailure preserves HTTP status and server code", () => {
  const internal = parseWhatsAppOtpFailure(500, {
    error: "Internal server error",
    code: "INTERNAL_ERROR",
    details: "Failed to generate login link",
  });
  assertEquals(internal instanceof WhatsAppOtpApiError, true);
  assertEquals(internal.code, "INTERNAL_ERROR");
  assertEquals(internal.status, 500);
  assertEquals(internal.message, "Internal server error");

  const gateway = parseWhatsAppOtpFailure(502, null);
  assertEquals(gateway.code, "GATEWAY_ERROR");
  assertEquals(gateway.status, 502);
  assertEquals(gateway.message, "Request failed (502)");

  const timeout = parseWhatsAppOtpFailure(504, null);
  assertEquals(timeout.code, "TIMEOUT_ERROR");
  assertEquals(timeout.status, 504);

  const rateLimit = parseWhatsAppOtpFailure(429, {
    error: "Too many requests",
    code: "RATE_LIMIT",
    details: "retry_after=42",
  });
  assertEquals(rateLimit.code, "RATE_LIMIT");
  assertEquals(rateLimit.retryAfterSeconds, 42);
});

Deno.test("404 and FEATURE_DISABLED stay a build-unavailable error", () => {
  const fromStatus = parseWhatsAppOtpFailure(404, { error: "Not found" });
  assertEquals(fromStatus.code, "FEATURE_DISABLED");
  assertEquals(fromStatus.message, "WhatsApp login is not available in this build.");

  const fromCode = parseWhatsAppOtpFailure(404, {
    error: "Not found",
    code: "FEATURE_DISABLED",
  });
  assertEquals(fromCode.code, "FEATURE_DISABLED");
});
