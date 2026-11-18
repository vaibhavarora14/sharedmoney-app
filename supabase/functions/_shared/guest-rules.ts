export const GUEST_SIGNIN_REQUIRED = "GUEST_SIGNIN_REQUIRED";
export const GUEST_GROUP_CAP = "GUEST_GROUP_CAP";
export const GUEST_EXPENSE_CAP = "GUEST_EXPENSE_CAP";

export const GUEST_GROUP_LIMIT = 5;
export const GUEST_EXPENSE_LIMIT = 200;

export class GuestSignInRequiredError extends Error {
  readonly code = GUEST_SIGNIN_REQUIRED;

  constructor() {
    super(GUEST_SIGNIN_REQUIRED);
    this.name = "GuestSignInRequiredError";
  }
}

interface JwtClaims {
  is_anonymous?: unknown;
}

export function readJwtClaims(authorizationHeader: string | null): JwtClaims | null {
  if (!authorizationHeader) return null;
  const token = authorizationHeader.replace(/^Bearer\s+/i, "").trim();
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = atob(padded);
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export function claimsAreAnonymous(claims: JwtClaims | null | undefined): boolean {
  return claims?.is_anonymous === true;
}

export function sessionIsAnonymous(
  user: { is_anonymous?: boolean } | null | undefined,
  authorizationHeader: string | null,
): boolean {
  if (user?.is_anonymous === true) return true;
  return claimsAreAnonymous(readJwtClaims(authorizationHeader));
}

export interface GuestDatabaseError {
  status: number;
  code: string;
  error: string;
}

export function guestDatabaseError(message: string): GuestDatabaseError | null {
  const lower = message.toLowerCase();
  if (lower.includes("guest_signin_required")) {
    return { status: 403, code: GUEST_SIGNIN_REQUIRED, error: "Sign in to continue" };
  }
  if (lower.includes("guest_group_cap")) {
    return { status: 403, code: GUEST_GROUP_CAP, error: "Sign in to add more groups" };
  }
  if (lower.includes("guest_expense_cap")) {
    return { status: 403, code: GUEST_EXPENSE_CAP, error: "Sign in to add more expenses" };
  }
  return null;
}

/** Env flag for the purge function. Exact string "true" only. Defaults off. */
export function guestCleanupMayRun(envValue: string | undefined): boolean {
  return envValue === "true";
}
