export type PreparedAppleNonce = {
  rawNonce: string;
  hashedNonce: string;
};

export const APPLE_SIGN_IN_SCOPE_KEYS = ["FULL_NAME", "EMAIL"] as const;
export type AppleSignInScopeKey = (typeof APPLE_SIGN_IN_SCOPE_KEYS)[number];

export type AppleSignInRequest = {
  nonce: string;
  requestedScopes: readonly AppleSignInScopeKey[];
};

let cachedNonce: PreparedAppleNonce | null = null;
let inflightNonce: Promise<PreparedAppleNonce> | null = null;

export function encodeAppleNonce(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashAppleNonce(
  rawNonce: string,
  digestSha256Hex: (value: string) => Promise<string>,
): Promise<string> {
  return digestSha256Hex(rawNonce);
}

export async function prepareAppleNonce(deps: {
  randomBytes: () => Uint8Array;
  digestSha256Hex: (value: string) => Promise<string>;
}): Promise<PreparedAppleNonce> {
  const rawNonce = encodeAppleNonce(deps.randomBytes());
  const hashedNonce = await hashAppleNonce(rawNonce, deps.digestSha256Hex);
  return { rawNonce, hashedNonce };
}

/**
 * Hash the nonce before the Apple button press so `signInAsync` can run as
 * the first native call in the user-gesture context.
 */
export async function prefetchPreparedAppleNonce(
  prepare: () => Promise<PreparedAppleNonce>,
): Promise<PreparedAppleNonce> {
  if (cachedNonce) return cachedNonce;
  if (!inflightNonce) {
    inflightNonce = prepare()
      .then((value) => {
        cachedNonce = value;
        return value;
      })
      .finally(() => {
        inflightNonce = null;
      });
  }
  return inflightNonce;
}

export function takePreparedAppleNonce(): PreparedAppleNonce | null {
  const value = cachedNonce;
  cachedNonce = null;
  return value;
}

export function appleSignInRequestFromNonce(
  hashedNonce: string,
): AppleSignInRequest {
  return {
    nonce: hashedNonce,
    requestedScopes: APPLE_SIGN_IN_SCOPE_KEYS,
  };
}
