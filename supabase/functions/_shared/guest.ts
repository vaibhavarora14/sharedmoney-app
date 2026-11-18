import { createErrorResponse } from "./error-handler.ts";
import {
  GUEST_SIGNIN_REQUIRED,
  guestCleanupMayRun,
  guestDatabaseError,
  sessionIsAnonymous,
} from "./guest-rules.ts";

export {
  GUEST_EXPENSE_CAP,
  GUEST_EXPENSE_LIMIT,
  GUEST_GROUP_CAP,
  GUEST_GROUP_LIMIT,
  GUEST_SIGNIN_REQUIRED,
  GuestSignInRequiredError,
  claimsAreAnonymous,
  guestCleanupMayRun,
  guestDatabaseError,
  readJwtClaims,
  sessionIsAnonymous,
} from "./guest-rules.ts";

export function guestSignInRequiredResponse(req?: Request): Response {
  return createErrorResponse(
    403,
    "Sign in to continue",
    GUEST_SIGNIN_REQUIRED,
    undefined,
    req,
  );
}

export { guestCleanupMayRun as guestCleanupEnabled };
export { sessionIsAnonymous as isAnonymousSession };
export { guestDatabaseError as mapGuestDatabaseError };
