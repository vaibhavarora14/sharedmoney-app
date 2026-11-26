export const AUTH_TIMEOUTS = {
  STUCK_LOADING_DETECTION: 15000,
  // Unstick loading only. Must not sign the user out; cached session paints first.
  SESSION_FETCH_TIMEOUT: 1500,
} as const;
