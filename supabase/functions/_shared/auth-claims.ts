import { sessionIsAnonymous } from "./guest-rules.ts";

export type VerifiedUser = {
  id: string;
  email: string | null;
  isAnonymous: boolean;
};

type JwtClaims = {
  sub?: unknown;
  email?: unknown;
  is_anonymous?: unknown;
};

export type AuthVerifier = {
  getClaims?: (jwt?: string) => PromiseLike<{
    data: { claims?: JwtClaims } | null;
    error: { message?: string; code?: string } | null;
  }>;
  getUser: () => PromiseLike<{
    data: {
      user: { id: string; email?: string | null; is_anonymous?: boolean } | null;
    };
    error: { message?: string } | null;
  }>;
};

function bearerToken(authorizationHeader: string): string {
  return authorizationHeader.replace(/^Bearer\s+/i, "").trim();
}

function claimsAreUsable(claims: JwtClaims | undefined): claims is JwtClaims & { sub: string } {
  return typeof claims?.sub === "string" && claims.sub.length > 0;
}

/** JWKS fetch/network failures should fall back to getUser. Invalid JWTs should not. */
export function claimsErrorAllowsGetUserFallback(
  error: { message?: string; code?: string } | null,
): boolean {
  if (!error) return false;
  const haystack = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return /jwks|fetch|network|timeout|econnreset/.test(haystack);
}

/**
 * Verify the caller locally via JWKS (`getClaims`) when the client supports it.
 * Falls back to `getUser` only if getClaims is missing or JWKS cannot be fetched.
 * Invalid/expired tokens are rejected without a second Auth round trip.
 */
export async function resolveAuthenticatedUser(
  auth: AuthVerifier,
  authorizationHeader: string,
): Promise<VerifiedUser> {
  const jwt = bearerToken(authorizationHeader);

  if (typeof auth.getClaims === "function" && jwt) {
    const { data, error } = await auth.getClaims(jwt);
    if (!error && claimsAreUsable(data?.claims)) {
      const claims = data.claims;
      return {
        id: claims.sub,
        email: typeof claims.email === "string" ? claims.email : null,
        isAnonymous: claims.is_anonymous === true,
      };
    }
    if (error && !claimsErrorAllowsGetUserFallback(error)) {
      throw new Error("Unauthorized: Invalid or expired token");
    }
    if (!error && data?.claims && !claimsAreUsable(data.claims)) {
      throw new Error("Unauthorized: Invalid or expired token");
    }
  }

  const { data: { user }, error } = await auth.getUser();
  if (error || !user) {
    throw new Error("Unauthorized: Invalid or expired token");
  }
  return {
    id: user.id,
    email: user.email || null,
    isAnonymous: sessionIsAnonymous(user, authorizationHeader),
  };
}
