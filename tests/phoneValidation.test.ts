import {
  getOptionalPhoneFormatError,
  isValidE164Phone,
  normalizePhoneToE164,
  PHONE_FORMAT_ERROR,
} from "../mobile/utils/phoneValidation.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("normalizes valid phone numbers to E.164", () => {
  assertEquals(normalizePhoneToE164("+1 (415) 555-2671"), "+14155552671");
  assertEquals(normalizePhoneToE164("415 555 2671", "US"), "+14155552671");
  assertEquals(normalizePhoneToE164("07911 123456", "GB"), "+447911123456");
});

Deno.test("defaults to India +91 when no profile country exists", () => {
  assertEquals(normalizePhoneToE164("98765 43210"), "+919876543210");
});

Deno.test("rejects invalid phone numbers with actionable copy", () => {
  assertEquals(isValidE164Phone("+919876543210"), true);
  assertEquals(isValidE164Phone("9876543210"), false);
  assertEquals(normalizePhoneToE164("123"), null);
  assertEquals(getOptionalPhoneFormatError("123"), PHONE_FORMAT_ERROR);
  assertEquals(getOptionalPhoneFormatError(""), null);
});
