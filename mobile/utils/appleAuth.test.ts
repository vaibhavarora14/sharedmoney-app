import { assertEquals } from "jsr:@std/assert@1";
import {
  appleSignInRequestFromNonce,
  encodeAppleNonce,
  hashAppleNonce,
  prefetchPreparedAppleNonce,
  prepareAppleNonce,
  takePreparedAppleNonce,
} from "./appleAuth.ts";
import { shouldRetryAppleNativeAuth } from "./socialAuth.ts";

Deno.test("Apple nonce is lowercase hex of the raw bytes", () => {
  assertEquals(encodeAppleNonce(new Uint8Array([0, 1, 255])), "0001ff");
});

Deno.test("prepared Apple nonce hashes the raw value before the button press", async () => {
  const prepared = await prepareAppleNonce({
    randomBytes: () => new Uint8Array([0, 1, 255]),
    digestSha256Hex: async (value) => `sha256:${value}`,
  });

  assertEquals(prepared.rawNonce, "0001ff");
  assertEquals(prepared.hashedNonce, "sha256:0001ff");
  assertEquals(await hashAppleNonce("0001ff", async (value) => `sha256:${value}`), "sha256:0001ff");
});

Deno.test("takePreparedAppleNonce consumes a prefetched nonce once", async () => {
  takePreparedAppleNonce();
  const prepared = await prefetchPreparedAppleNonce(async () => ({
    rawNonce: "aa",
    hashedNonce: "bb",
  }));
  assertEquals(takePreparedAppleNonce(), prepared);
  assertEquals(takePreparedAppleNonce(), null);
});

Deno.test("Apple sign-in request only carries a prehashed nonce and name/email scopes", () => {
  assertEquals(appleSignInRequestFromNonce("hashed-nonce"), {
    nonce: "hashed-nonce",
    requestedScopes: ["FULL_NAME", "EMAIL"],
  });
});

Deno.test("ERR_REQUEST_UNKNOWN is not auto-retried; a second sheet is not a user gesture", () => {
  assertEquals(
    shouldRetryAppleNativeAuth({
      provider: "apple",
      stage: "native_request",
      code: "ERR_REQUEST_UNKNOWN",
      kind: "apple_unknown",
      group: "auth.apple.apple_unknown",
    }),
    false,
  );
});
