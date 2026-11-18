import { assertEquals } from "jsr:@std/assert@1";
import {
  analyticsPersonPropertiesKey,
  buildAnalyticsPersonProperties,
  isSeedAuthUserId,
  resolveAuthDisplayName,
  SEED_AUTH_USER_IDS,
} from "./posthogIdentity.ts";

Deno.test("seed Alice UUID is recognized as a local E2E identity", () => {
  assertEquals(
    isSeedAuthUserId("11111111-1111-1111-1111-111111111111"),
    true,
  );
  assertEquals(SEED_AUTH_USER_IDS.size, 4);
});

Deno.test("real auth user ids are not treated as seed identities", () => {
  assertEquals(
    isSeedAuthUserId("7ee1001f-226a-4158-a668-0c3f3d9ac73c"),
    false,
  );
  assertEquals(isSeedAuthUserId(null), false);
  assertEquals(isSeedAuthUserId(""), false);
});

Deno.test("buildAnalyticsPersonProperties keeps trimmed email and name", () => {
  assertEquals(
    buildAnalyticsPersonProperties({
      email: " peter.yillen@example.com ",
      name: " Peter Yillen ",
    }),
    {
      email: "peter.yillen@example.com",
      name: "Peter Yillen",
    },
  );
});

Deno.test("buildAnalyticsPersonProperties omits empty fields", () => {
  assertEquals(
    buildAnalyticsPersonProperties({ email: "  ", name: undefined }),
    undefined,
  );
  assertEquals(
    buildAnalyticsPersonProperties({ email: "a@b.com" }),
    { email: "a@b.com" },
  );
});

Deno.test("analyticsPersonPropertiesKey changes when email is added", () => {
  assertEquals(analyticsPersonPropertiesKey(undefined), "");
  assertEquals(
    analyticsPersonPropertiesKey({ email: "a@b.com" }),
    "email=a@b.com|name=|guest=",
  );
  assertEquals(
    analyticsPersonPropertiesKey({ email: "a@b.com" }) ===
      analyticsPersonPropertiesKey({ email: "a@b.com", name: "A" }),
    false,
  );
});

Deno.test("resolveAuthDisplayName prefers full_name then name then given+family", () => {
  assertEquals(
    resolveAuthDisplayName({ full_name: "Ada Lovelace", name: "Ada" }),
    "Ada Lovelace",
  );
  assertEquals(resolveAuthDisplayName({ name: "Ada" }), "Ada");
  assertEquals(
    resolveAuthDisplayName({ given_name: "Ada", family_name: "Lovelace" }),
    "Ada Lovelace",
  );
  assertEquals(resolveAuthDisplayName({}), undefined);
});
