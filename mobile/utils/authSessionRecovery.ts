export const SESSION_REFRESH_BACKOFF_MS = [0, 2_000, 8_000, 20_000] as const;

export type SessionRecoverySource =
  | "resolved"
  | "timeout"
  | "exception"
  | "refresh";

export type RecoverableSession = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user?: { id: string } | null;
} | null;

export type SessionRecoveryEvent = {
  source: SessionRecoverySource;
  session?: RecoverableSession;
  error?: unknown | null;
};

export type SessionRecoveryDecision =
  | { action: "use-session"; session: RecoverableSession }
  | { action: "keep-existing" }
  | { action: "sign-out" };

type ErrorShape = {
  name: string;
  message: string;
  code: string;
  status: number | undefined;
};

function readErrorShape(error: unknown): ErrorShape {
  if (typeof error === "string") {
    return { name: "", message: error, code: "", status: undefined };
  }
  if (!error || typeof error !== "object") {
    return { name: "", message: String(error ?? ""), code: "", status: undefined };
  }

  const record = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    status?: unknown;
    error?: unknown;
  };

  return {
    name: typeof record.name === "string" ? record.name : "",
    message: typeof record.message === "string" ? record.message : "",
    code:
      typeof record.code === "string"
        ? record.code
        : typeof record.error === "string"
          ? record.error
          : "",
    status: typeof record.status === "number" ? record.status : undefined,
  };
}

function isFatalRefreshMessage(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("invalid_grant") ||
    normalized.includes("refresh_token_not_found") ||
    normalized.includes("invalid refresh token") ||
    normalized.includes("refresh token not found")
  );
}

/**
 * True when the refresh token is gone or rejected. These are the only
 * bootstrap/refresh failures that should clear the local session.
 */
export function isFatalRefreshFailure(error: unknown): boolean {
  const { name, message, code, status } = readErrorShape(error);
  if (isFatalRefreshMessage(code) || isFatalRefreshMessage(message)) {
    return true;
  }

  const authApiError = name === "AuthApiError";
  const unauthorizedStatus = status === 400 || status === 401;
  if (authApiError && unauthorizedStatus && /refresh/i.test(message)) {
    return true;
  }

  return false;
}

/**
 * supabase-js 2.117 emits INITIAL_SESSION with a null session on any
 * initialize error, including a retryable network failure while refreshing
 * an expired access token. TOKEN_REFRESHED can also arrive with null on a
 * transient refresh failure. Those must not clear a cached session.
 * SIGNED_OUT is the only null event that always applies.
 */
export function shouldApplyAuthEvent(
  event: string,
  session: unknown,
  hasSession: boolean,
): boolean {
  if (event === "SIGNED_OUT") {
    return true;
  }
  if (session == null && hasSession) {
    return false;
  }
  return true;
}

export function planAuthStateChange(
  event: string,
  session: unknown,
  hasSession: boolean,
): { apply: boolean; scheduleRetry: boolean } {
  const apply = shouldApplyAuthEvent(event, session, hasSession);
  return { apply, scheduleRetry: !apply };
}

export const ACCESS_TOKEN_FOREGROUND_REFRESH_SKEW_SECONDS = 5 * 60;

export function shouldRefreshAccessTokenOnForeground(
  expiresAtSeconds: number | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof expiresAtSeconds !== "number" || !Number.isFinite(expiresAtSeconds)) {
    return true;
  }
  return expiresAtSeconds <= nowSeconds + ACCESS_TOKEN_FOREGROUND_REFRESH_SKEW_SECONDS;
}

export function decideSessionRecovery(
  event: SessionRecoveryEvent,
): SessionRecoveryDecision {
  switch (event.source) {
    case "timeout":
      return { action: "keep-existing" };
    case "exception":
    case "resolved":
    case "refresh": {
      if (event.error) {
        if (isFatalRefreshFailure(event.error)) {
          return { action: "sign-out" };
        }
        return { action: "keep-existing" };
      }
      if (event.source === "exception") {
        return { action: "keep-existing" };
      }
      if (event.source === "refresh" && !event.session) {
        return { action: "keep-existing" };
      }
      return { action: "use-session", session: event.session ?? null };
    }
    default: {
      const _exhaustive: never = event.source;
      throw new Error(`Unhandled session recovery source: ${String(_exhaustive)}`);
    }
  }
}

export function supabaseAuthStorageKey(supabaseUrl: string): string | null {
  try {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    if (!projectRef) return null;
    return `sb-${projectRef}-auth-token`;
  } catch {
    return null;
  }
}

function asRecoverableSession(value: unknown): RecoverableSession {
  if (!value || typeof value !== "object") return null;
  const record = value as {
    access_token?: unknown;
    user?: unknown;
    currentSession?: unknown;
  };

  if (record.currentSession) {
    return asRecoverableSession(record.currentSession);
  }

  if (typeof record.access_token !== "string" || record.access_token.length === 0) {
    return null;
  }

  const user = record.user;
  if (!user || typeof user !== "object" || typeof (user as { id?: unknown }).id !== "string") {
    return null;
  }

  return value as NonNullable<RecoverableSession>;
}

export function parsePersistedAuthSession(raw: string | null): RecoverableSession {
  if (!raw) return null;
  try {
    return asRecoverableSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function readPersistedAuthSession(
  getItem: (key: string) => Promise<string | null>,
  supabaseUrl: string,
): Promise<RecoverableSession> {
  const key = supabaseAuthStorageKey(supabaseUrl);
  if (!key) return null;
  try {
    return parsePersistedAuthSession(await getItem(key));
  } catch {
    return null;
  }
}

export type SessionRefreshController = {
  handleAppStateChange: (state: string) => void;
  scheduleRetryAfterTransientFailure: () => void;
  stop: () => void;
};

export type SessionRefreshControllerDependencies = {
  refreshSession: () => Promise<{ error: unknown | null }>;
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;
  onFatalFailure: () => void;
  getAccessTokenExpiresAt?: () => number | null | undefined;
  nowSeconds?: () => number;
  backoffMs?: readonly number[];
  setTimeoutFn?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
};

export function createSessionRefreshController(
  dependencies: SessionRefreshControllerDependencies,
): SessionRefreshController {
  const backoff = dependencies.backoffMs ?? SESSION_REFRESH_BACKOFF_MS;
  const schedule = dependencies.setTimeoutFn ?? setTimeout;
  const unschedule = dependencies.clearTimeoutFn ?? clearTimeout;

  let stopped = false;
  let inFlight = false;
  let attempt = 0;
  let sawBackground = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer == null) return;
    unschedule(timer);
    timer = null;
  };

  const scheduleRetry = () => {
    if (stopped || timer != null) return;
    const delay = backoff[Math.min(attempt, backoff.length - 1)] ?? 0;
    attempt += 1;
    timer = schedule(() => {
      timer = null;
      void runRefresh();
    }, delay);
  };

  const runRefresh = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    let shouldRetry = false;
    try {
      const { error } = await dependencies.refreshSession();
      if (stopped) return;
      if (!error) {
        attempt = 0;
        clearTimer();
        return;
      }
      if (isFatalRefreshFailure(error)) {
        clearTimer();
        dependencies.onFatalFailure();
        return;
      }
      shouldRetry = true;
    } catch (error) {
      if (stopped) return;
      if (isFatalRefreshFailure(error)) {
        clearTimer();
        dependencies.onFatalFailure();
        return;
      }
      shouldRetry = true;
    } finally {
      inFlight = false;
    }
    if (shouldRetry) scheduleRetry();
  };

  return {
    handleAppStateChange(state: string) {
      if (stopped) return;
      if (state === "active") {
        dependencies.startAutoRefresh();
        if (!sawBackground) return;
        attempt = 0;
        clearTimer();
        const nowSeconds =
          dependencies.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
        if (
          !shouldRefreshAccessTokenOnForeground(
            dependencies.getAccessTokenExpiresAt?.(),
            nowSeconds,
          )
        ) {
          return;
        }
        void runRefresh();
        return;
      }
      sawBackground = true;
      dependencies.stopAutoRefresh();
      clearTimer();
    },
    scheduleRetryAfterTransientFailure() {
      if (stopped || inFlight) return;
      scheduleRetry();
    },
    stop() {
      stopped = true;
      clearTimer();
    },
  };
}
