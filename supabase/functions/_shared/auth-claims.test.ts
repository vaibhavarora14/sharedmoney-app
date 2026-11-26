import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  claimsErrorAllowsGetUserFallback,
  resolveAuthenticatedUser,
  type AuthVerifier,
} from "./auth-claims.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const HEADER = "Bearer header.payload.sig";

Deno.test("getClaims success skips getUser", async () => {
  let getUserCalls = 0;
  const auth: AuthVerifier = {
    getClaims: () =>
      Promise.resolve({
        data: { claims: { sub: USER, email: "a@b.com", is_anonymous: false } },
        error: null,
      }),
    getUser: () => {
      getUserCalls += 1;
      return Promise.resolve({ data: { user: null }, error: { message: "should not run" } });
    },
  };
  const user = await resolveAuthenticatedUser(auth, HEADER);
  assertEquals(user, { id: USER, email: "a@b.com", isAnonymous: false });
  assertEquals(getUserCalls, 0);
});

Deno.test("getClaims invalid JWT does not fall back to getUser", async () => {
  let getUserCalls = 0;
  const auth: AuthVerifier = {
    getClaims: () =>
      Promise.resolve({
        data: null,
        error: { message: "invalid JWT", code: "bad_jwt" },
      }),
    getUser: () => {
      getUserCalls += 1;
      return Promise.resolve({ data: { user: { id: USER } }, error: null });
    },
  };
  await assertRejects(
    () => resolveAuthenticatedUser(auth, HEADER),
    Error,
    "Unauthorized: Invalid or expired token",
  );
  assertEquals(getUserCalls, 0);
});

Deno.test("JWKS fetch failure falls back to getUser", async () => {
  const auth: AuthVerifier = {
    getClaims: () =>
      Promise.resolve({
        data: null,
        error: { message: "Failed to fetch JWKS", code: "auth_error" },
      }),
    getUser: () =>
      Promise.resolve({
        data: { user: { id: USER, email: "a@b.com", is_anonymous: true } },
        error: null,
      }),
  };
  const user = await resolveAuthenticatedUser(auth, HEADER);
  assertEquals(user.id, USER);
  assertEquals(user.isAnonymous, true);
  assertEquals(claimsErrorAllowsGetUserFallback({ message: "Failed to fetch JWKS" }), true);
  assertEquals(claimsErrorAllowsGetUserFallback({ code: "bad_jwt", message: "invalid JWT" }), false);
});

Deno.test("missing getClaims uses getUser", async () => {
  const auth: AuthVerifier = {
    getUser: () =>
      Promise.resolve({
        data: { user: { id: USER, email: null } },
        error: null,
      }),
  };
  const user = await resolveAuthenticatedUser(auth, HEADER);
  assertEquals(user, { id: USER, email: null, isAnonymous: false });
});
