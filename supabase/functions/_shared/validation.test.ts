import { assertEquals } from "jsr:@std/assert@1";
import { EMAIL_FORMAT_ERROR, isValidEmail } from "./validation.ts";

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
