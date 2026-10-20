import { assertEquals } from "jsr:@std/assert@1";
import {
  formatE164ForDisplay,
  formatResendCountdown,
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

Deno.test("formatResendCountdown uses m:ss", () => {
  assertEquals(formatResendCountdown(30), "Resend in 0:30");
  assertEquals(formatResendCountdown(60), "Resend in 1:00");
  assertEquals(formatResendCountdown(0), "Resend in 0:00");
  assertEquals(formatResendCountdown(90), "Resend in 1:30");
});
