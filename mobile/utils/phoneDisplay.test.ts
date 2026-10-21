import { assertEquals } from "jsr:@std/assert@1";
import {
  formatE164ForDisplay,
  formatNationalAsYouType,
  formatResendCountdown,
  formatTryAgainCountdown,
  WHATSAPP_SEND_FAILED_USER_MESSAGE,
} from "./phoneDisplay.ts";

Deno.test("formatE164ForDisplay formats India mobiles as +91 XXXXX XXXXX", () => {
  assertEquals(formatE164ForDisplay("+919876543210"), "+91 98765 43210");
  assertEquals(formatE164ForDisplay("+91 98765-43210"), "+91 98765 43210");
});

Deno.test("formatE164ForDisplay formats NANP numbers", () => {
  assertEquals(formatE164ForDisplay("+14155552671"), "+1 415 555 2671");
});

Deno.test("formatE164ForDisplay leaves non-E.164 strings alone", () => {
  assertEquals(formatE164ForDisplay("9876543210"), "9876543210");
  assertEquals(formatE164ForDisplay(""), "");
});

Deno.test("formatNationalAsYouType formats India as user types", () => {
  assertEquals(formatNationalAsYouType("98765", "+91"), "98765");
  assertEquals(formatNationalAsYouType("987654", "+91"), "98765 4");
  assertEquals(formatNationalAsYouType("9876543210", "+91"), "98765 43210");
});

Deno.test("formatResendCountdown uses m:ss", () => {
  assertEquals(formatResendCountdown(30), "Resend in 0:30");
  assertEquals(formatResendCountdown(60), "Resend in 1:00");
  assertEquals(formatResendCountdown(0), "Resend in 0:00");
  assertEquals(formatResendCountdown(90), "Resend in 1:30");
});

Deno.test("formatTryAgainCountdown uses m:ss", () => {
  assertEquals(formatTryAgainCountdown(600), "Try again in 10:00");
  assertEquals(formatTryAgainCountdown(45), "Try again in 0:45");
});

Deno.test("send-failed copy never mentions Meta test recipients", () => {
  assertEquals(
    WHATSAPP_SEND_FAILED_USER_MESSAGE.includes("Meta"),
    false,
  );
  assertEquals(
    WHATSAPP_SEND_FAILED_USER_MESSAGE.includes("test recipient"),
    false,
  );
  assertEquals(
    WHATSAPP_SEND_FAILED_USER_MESSAGE,
    "We couldn't send a code to this number. Check it's on WhatsApp, or use another sign-in method.",
  );
});
