export type AuthSessionTransition = "signed_in" | "signed_out" | "session_refresh";

export function resolveAuthSessionTransition(
  previousUserId: string | null | undefined,
  nextUserId: string | null | undefined,
): AuthSessionTransition | null {
  const hadUser = Boolean(previousUserId);
  const hasUser = Boolean(nextUserId);
  if (!hadUser && hasUser) return "signed_in";
  if (hadUser && !hasUser) return "signed_out";
  if (hadUser && hasUser && previousUserId === nextUserId) return "session_refresh";
  if (hadUser && hasUser && previousUserId !== nextUserId) {
    // Treat user swaps as a fresh sign-in for triage (logout crumb may be skipped).
    return "signed_in";
  }
  return null;
}

/**
 * Default mobile replay sample rates: keep error sessions useful, lower
 * always-on sampling to reduce iOS RAM / quota pressure.
 *
 * When `env` is omitted, read `process.env.EXPO_PUBLIC_…` via direct member
 * access so Expo/Metro can inline the values. Do not pass `process.env` as an
 * object — that pattern is not rewritten for web.
 */
export function resolveSentryReplaySampleRates(input: {
  platform: string;
  env?: Record<string, string | undefined>;
}) {
  const sessionDefault = input.platform === "ios" ? "0.02" : "0.05";
  const sessionRaw = input.env
    ? input.env.EXPO_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE
    : process.env.EXPO_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE;
  const onErrorRaw = input.env
    ? input.env.EXPO_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE
    : process.env.EXPO_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE;
  return {
    replaysSessionSampleRate: Number(sessionRaw ?? sessionDefault),
    replaysOnErrorSampleRate: Number(onErrorRaw ?? "1.0"),
  };
}

/**
 * Exchange-rate fetches are background, non-critical reads. When the auth
 * session is missing (cold start before restore, refresh failed, sign-out
 * race), fetchWithAuth throws "Not authenticated" — expected, not a bug.
 * See Sentry REACT-NATIVE-24.
 */
export function shouldReportRatesFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() !== "Not authenticated";
}
