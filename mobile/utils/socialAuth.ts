export type SocialAuthProvider = "google" | "apple";

export type SocialAuthStage =
  | "availability_check"
  | "provider_request"
  | "browser_session"
  | "callback_parse"
  | "native_request"
  | "token_exchange"
  | "profile_update"
  | "session_verification";

export type SocialAuthFailureKind =
  | "cancelled"
  | "browser_unavailable"
  | "play_services_unavailable"
  | "apple_unknown"
  | "provider_configuration"
  | "interrupted"
  | "unexpected";

export type SocialAuthFailureInput = {
  provider: SocialAuthProvider;
  stage: SocialAuthStage;
  code?: string;
  message?: string;
  cancelled?: boolean;
};

export type SocialAuthFailure = {
  provider: SocialAuthProvider;
  stage: SocialAuthStage;
  code: string;
  kind: SocialAuthFailureKind;
  group: string;
  /** Sanitized provider message safe for telemetry extras (never tokens). */
  providerMessage?: string;
};

export type SocialAuthTelemetry = {
  message: string;
  level: "warning" | "error";
  fingerprint: string[];
  tags: Record<string, string>;
  extra: {
    auth_attempt_id: string;
    provider_message?: string;
    auth_retry_count?: number;
  };
};

export type SocialAuthTelemetryOptions = {
  retryCount?: number;
};

const SOCIAL_AUTH_FAILURE_KINDS: readonly SocialAuthFailureKind[] = [
  "cancelled",
  "browser_unavailable",
  "play_services_unavailable",
  "apple_unknown",
  "provider_configuration",
  "interrupted",
  "unexpected",
];

/**
 * Expo WebBrowser rejects with this text when Android cannot resolve a Custom
 * Tabs activity. Older SDKs used the shorter "No matching activity".
 */
export function isNoMatchingBrowserActivityMessage(message?: string): boolean {
  const normalized = message?.toLowerCase() ?? "";
  return (
    normalized.includes("no matching browser activity") ||
    normalized.includes("no matching activity")
  );
}

/** Walk Error.message and Error.cause so wrapped Expo rejections still match. */
export function readUnknownErrorMessage(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current) && parts.length < 4) {
    seen.add(current);
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    if (typeof current !== "object") break;
    if ("message" in current) {
      const message = (current as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        parts.push(message);
      }
    }
    if ("cause" in current) {
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }

  return parts.join("\n");
}

export function isNoMatchingBrowserActivityError(error: unknown): boolean {
  return isNoMatchingBrowserActivityMessage(readUnknownErrorMessage(error));
}

export type SocialAuthError = Error & {
  socialAuthKind: SocialAuthFailureKind;
};

export function createSocialAuthError(failure: SocialAuthFailure): SocialAuthError {
  const error = new Error(getSocialAuthUserMessage(failure)) as SocialAuthError;
  error.socialAuthKind = failure.kind;
  return error;
}

export function readSocialAuthKind(error: unknown): SocialAuthFailureKind | null {
  if (!error || typeof error !== "object" || !("socialAuthKind" in error)) {
    return null;
  }
  const kind = (error as { socialAuthKind?: unknown }).socialAuthKind;
  if (
    typeof kind === "string" &&
    (SOCIAL_AUTH_FAILURE_KINDS as readonly string[]).includes(kind)
  ) {
    return kind as SocialAuthFailureKind;
  }
  return null;
}

export type BrowserUnavailableAlertAction = {
  id: "whatsapp" | "email" | "dismiss";
  text: string;
  style?: "cancel";
};

/**
 * Recovery choices when Google OAuth cannot open a browser.
 * WhatsApp is included only when that sign-in method is enabled.
 */
export function getBrowserUnavailableAlertActions(
  whatsappEnabled: boolean,
): BrowserUnavailableAlertAction[] {
  const actions: BrowserUnavailableAlertAction[] = [];
  if (whatsappEnabled) {
    actions.push({ id: "whatsapp", text: "Use WhatsApp" });
  }
  actions.push({ id: "email", text: "Use email" });
  actions.push({ id: "dismiss", text: "Not now", style: "cancel" });
  return actions;
}

/**
 * Strip credential-looking material before attaching provider messages to Sentry.
 * Keeps Apple/OS error text useful while avoiding identity tokens / nonces / JWTs.
 */
export function sanitizeSocialAuthErrorMessage(
  message?: string,
): string | undefined {
  if (!message) return undefined;

  let sanitized = message
    .replace(
      /\b(identity[_-]?token|id[_-]?token|access[_-]?token|refresh[_-]?token|nonce)\b\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[redacted-jwt]",
    )
    .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted-hex]")
    .trim();

  if (!sanitized) return undefined;
  if (sanitized.length > 240) {
    sanitized = `${sanitized.slice(0, 240)}…`;
  }
  return sanitized;
}

export function classifySocialAuthFailure(
  input: SocialAuthFailureInput,
): SocialAuthFailure {
  const rawCode = input.code || "unknown";
  const code = /^[A-Za-z0-9_.:-]{1,80}$/.test(rawCode)
    ? rawCode
    : "unknown";
  const message = input.message?.toLowerCase() || "";
  let kind: SocialAuthFailureKind = "unexpected";

  if (
    input.cancelled ||
    code === "ERR_REQUEST_CANCELED" ||
    message.includes("authentication was cancelled") ||
    message.includes("authentication was canceled")
  ) {
    kind = "cancelled";
  } else if (
    input.provider === "google" &&
    isNoMatchingBrowserActivityMessage(input.message)
  ) {
    kind = "browser_unavailable";
  } else if (
    input.provider === "google" &&
    (code === "PLAY_SERVICES_NOT_AVAILABLE" ||
      message.includes("play services"))
  ) {
    kind = "play_services_unavailable";
  } else if (
    input.provider === "apple" &&
    code === "ERR_REQUEST_UNKNOWN"
  ) {
    kind = "apple_unknown";
  } else if (
    input.provider === "google" &&
    (code.startsWith("WEB_BROWSER_") ||
      message.includes("did not complete") ||
      message.includes("authentication session was dismissed"))
  ) {
    kind = "interrupted";
  } else if (
    message.includes("unsupported provider") ||
    message.includes("provider is not enabled") ||
    message.includes("oauth client") ||
    message.includes("client id") ||
    message.includes("redirect uri") ||
    message.includes("nonce configuration") ||
    code === "DEVELOPER_ERROR" ||
    code === "GOOGLE_NATIVE_UNAVAILABLE"
  ) {
    kind = "provider_configuration";
  }

  return {
    provider: input.provider,
    stage: input.stage,
    code,
    kind,
    group: `auth.${input.provider}.${kind}`,
    providerMessage: sanitizeSocialAuthErrorMessage(input.message),
  };
}

/**
 * Do not auto-present a second Apple sheet. The retry is not a user gesture,
 * and on iOS 26 it reproduces ERR_REQUEST_UNKNOWN (Sentry REACT-NATIVE-2B).
 */
export function shouldRetryAppleNativeAuth(
  _failure: SocialAuthFailure,
): boolean {
  return false;
}

export function buildSocialAuthTelemetry(
  failure: SocialAuthFailure,
  attemptId: string,
  runtimeTags: Record<string, string>,
  options: SocialAuthTelemetryOptions = {},
): SocialAuthTelemetry {
  return {
    message: `Social authentication failure: ${failure.group}`,
    level:
      failure.kind === "browser_unavailable" ||
      failure.kind === "play_services_unavailable" ||
      failure.kind === "provider_configuration" ||
      failure.kind === "apple_unknown" ||
      failure.kind === "interrupted"
        ? "warning"
        : "error",
    fingerprint: [failure.group],
    tags: {
      ...runtimeTags,
      auth_issue: failure.group,
      auth_provider: failure.provider,
      auth_stage: failure.stage,
      auth_code: failure.code,
    },
    extra: {
      auth_attempt_id: attemptId,
      ...(failure.providerMessage
        ? { provider_message: failure.providerMessage }
        : {}),
      ...(typeof options.retryCount === "number"
        ? { auth_retry_count: options.retryCount }
        : {}),
    },
  };
}

export function getSocialAuthUserMessage(
  failure: SocialAuthFailure,
): string {
  switch (failure.kind) {
    case "cancelled":
      return "Authentication was cancelled";
    case "browser_unavailable":
      return "No supported browser is available. Install or enable Chrome (or another browser), or use another sign-in method.";
    case "play_services_unavailable":
      return "Google Play Services is missing or outdated. Update Play Services, then try Google sign-in again.";
    case "apple_unknown":
      return "Apple sign-in couldn’t be completed. Please try again, or use email or Google sign-in.";
    case "provider_configuration":
      return "This sign-in method is temporarily unavailable. Please use email or another sign-in method.";
    case "interrupted":
      return "Google sign-in did not complete. Please try again.";
    case "unexpected":
      return failure.provider === "apple"
        ? "Apple sign-in couldn’t be completed. Please try again, or use email or Google sign-in."
        : "Google sign-in couldn’t be completed. Please try again.";
    default: {
      const _exhaustive: never = failure.kind;
      return _exhaustive;
    }
  }
}
