import {
  EMAIL_FORMAT_ERROR,
  getOptionalEmailFormatError,
  isValidEmail,
} from "../mobile/utils/emailValidation.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

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

Deno.test("getOptionalEmailFormatError allows blank for name-only invites", () => {
  assertEquals(getOptionalEmailFormatError(""), null);
  assertEquals(getOptionalEmailFormatError("   "), null);
  assertEquals(getOptionalEmailFormatError(null), null);
  assertEquals(getOptionalEmailFormatError(undefined), null);
  assertEquals(getOptionalEmailFormatError("name@example.com"), null);
  assertEquals(
    getOptionalEmailFormatError("not-an-email"),
    EMAIL_FORMAT_ERROR,
  );
  assertEquals(
    getOptionalEmailFormatError("foo@bar..com"),
    EMAIL_FORMAT_ERROR,
  );
});
