import { assertEquals } from "jsr:@std/assert@1";
import {
  EMAIL_FORMAT_ERROR,
  isValidE164Phone,
  isValidEmail,
  normalizePhoneToE164,
  PHONE_FORMAT_ERROR,
} from "./validation.ts";

Deno.test("isValidEmail accepts common and uncommon-but-legal addresses", () => {
  const valid = [
    "name@example.com",
    "user+tag@example.com",
    "first.last@example.co.uk",
    "a@b.co",
    "user_name@sub.domain.museum",
    "user!tag@example.com",
    "o'brien@example.com",
    "xn--test@xn--bcher-kva.example",
  ];

  for (const email of valid) {
    assertEquals(isValidEmail(email), true, `expected valid: ${email}`);
  }
});

Deno.test("isValidEmail rejects clearly invalid invite emails", () => {
  const invalid = [
    "",
    "   ",
    "notanemail",
    "foo@",
    "@example.com",
    "foo@bar",
    "foo@bar..com",
    "foo@.bar.com",
    "foo@bar.com.",
    ".foo@bar.com",
    "foo.@bar.com",
    "foo@-bar.com",
    "foo@bar-.com",
    "foo bar@example.com",
    "foo@bar.c",
    "a@@b.com",
    "plainaddress",
    "name@example",
  ];

  for (const email of invalid) {
    assertEquals(isValidEmail(email), false, `expected invalid: ${email}`);
  }
});

Deno.test("EMAIL_FORMAT_ERROR is actionable", () => {
  assertEquals(EMAIL_FORMAT_ERROR.includes("name@example.com"), true);
  assertEquals(EMAIL_FORMAT_ERROR.toLowerCase().includes("valid"), true);
});

Deno.test("normalizePhoneToE164 accepts E.164 and national numbers", () => {
  assertEquals(normalizePhoneToE164("+1 (415) 555-2671"), "+14155552671");
  assertEquals(normalizePhoneToE164("415 555 2671", "US"), "+14155552671");
  assertEquals(normalizePhoneToE164("98765 43210", null), "+919876543210");
});

Deno.test("isValidE164Phone rejects invalid or non-normalized phone numbers", () => {
  assertEquals(isValidE164Phone("+919876543210"), true);
  assertEquals(isValidE164Phone("9876543210"), false);
  assertEquals(normalizePhoneToE164("123"), null);
});

Deno.test("PHONE_FORMAT_ERROR is actionable", () => {
  assertEquals(PHONE_FORMAT_ERROR.toLowerCase().includes("phone"), true);
  assertEquals(PHONE_FORMAT_ERROR.toLowerCase().includes("area code"), true);
});
