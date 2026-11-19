import { assertEquals } from "jsr:@std/assert@1";
import { parseOAuthCallbackUrl } from "./oauthCallback.ts";

Deno.test("implicit OAuth tokens are read from the URL hash", () => {
  assertEquals(
    parseOAuthCallbackUrl(
      "sharedmoney://auth/callback#access_token=aaa&refresh_token=bbb&expires_in=3600",
    ),
    {
      status: "tokens",
      accessToken: "aaa",
      refreshToken: "bbb",
    },
  );
});

Deno.test("implicit OAuth tokens are read from the query string", () => {
  assertEquals(
    parseOAuthCallbackUrl(
      "sharedmoney://auth/callback?access_token=aaa&refresh_token=bbb",
    ),
    {
      status: "tokens",
      accessToken: "aaa",
      refreshToken: "bbb",
    },
  );
});

Deno.test("PKCE OAuth code is read from the query string", () => {
  assertEquals(
    parseOAuthCallbackUrl("sharedmoney://auth/callback?code=pkce-code-1"),
    { status: "code", code: "pkce-code-1" },
  );
});

Deno.test("provider error query params are not treated as missing tokens", () => {
  assertEquals(
    parseOAuthCallbackUrl(
      "sharedmoney://auth/callback?error=access_denied&error_description=User+denied",
    ),
    { status: "error", error: "access_denied" },
  );
});

Deno.test("hash tokens win over a leftover query code", () => {
  assertEquals(
    parseOAuthCallbackUrl(
      "https://sharedmoney.app/app?code=stale#access_token=aaa&refresh_token=bbb",
    ),
    {
      status: "tokens",
      accessToken: "aaa",
      refreshToken: "bbb",
    },
  );
});

Deno.test("callback without tokens or code is missing", () => {
  assertEquals(
    parseOAuthCallbackUrl("sharedmoney://auth/callback"),
    { status: "missing" },
  );
});
