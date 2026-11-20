import { readFlagOverride } from "./guestMode";

export const PUBLIC_YOU_OWE_FLAG = "public_you_owe";
export const YOU_OWE_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const CANONICAL_YOU_OWE_ORIGIN = "https://sharedmoney.app";

/** An explicit false env keeps the host UI off even if the database flag is later enabled. */
export function publicYouOweEnvBlocked(): boolean {
  return readFlagOverride(process.env.EXPO_PUBLIC_PUBLIC_YOU_OWE) === false;
}

export function isPublicYouOweEnabled(dbEnabled: boolean | null | undefined): boolean {
  return dbEnabled === true && !publicYouOweEnvBlocked();
}

export function getBalanceShareLinkUrl(token: string): string {
  if (!YOU_OWE_TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid balance link");
  }
  return `${CANONICAL_YOU_OWE_ORIGIN}/owe/${token}`;
}
