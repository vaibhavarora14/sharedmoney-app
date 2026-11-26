import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { Session, User } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import * as AuthSession from "expo-auth-session";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import { AUTH_TIMEOUTS } from "../constants/auth";
import { unregisterCurrentPushToken } from "../services/pushNotifications";
import { supabase } from "../supabase";
import { getConfiguredWebAppPath } from "../utils/inviteLinks";
import { log, logError } from "../utils/logger";
import {
  recordSentryAuthSessionTransition,
} from "../utils/sentryTelemetry";
import { resolveAuthSessionTransition } from "../utils/sentryTriagePolicy";
import { performLocalLogout } from "../utils/logoutFlow";
import {
  appleSignInRequestFromNonce,
  prefetchPreparedAppleNonce,
  prepareAppleNonce,
  takePreparedAppleNonce,
  type PreparedAppleNonce,
} from "../utils/appleAuth";
import {
  authFailureReasonFromSocialFailure,
  isNewAuthUser,
  resolveAuthProvider,
  shouldCaptureSocialAuthFailure,
  type AuthFunnelMethod,
} from "../utils/authFunnelEvents";
import { captureAnalyticsEvent, captureAuthFailed, syncAnalyticsAuth } from "../utils/posthogAnalytics";
import { anonymousCaptchaToken } from "../utils/guestCaptcha";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import { isWebAuthShellActive } from "../utils/webAuthShell";
import { forgetWebProfileLabel } from "../utils/webProfileShell";
import { resolveAuthDisplayName } from "../utils/posthogIdentity";
import {
  canUseNativeGoogleSignIn,
  signInWithNativeGoogle,
} from "../utils/nativeGoogleAuth";
import {
  classifyGoogleAuthSessionResult,
  openGoogleAuthSession,
} from "../utils/googleBrowserAuth";
import { parseOAuthCallbackUrl } from "../utils/oauthCallback";
import {
  classifySocialAuthFailure,
  createSocialAuthError,
  readUnknownErrorMessage,
  type SocialAuthFailure,
  type SocialAuthProvider,
  type SocialAuthStage,
} from "../utils/socialAuth";
import { recordSocialAuthFailure } from "../utils/socialAuthTelemetry";
import { verifyWhatsAppOtp } from "../utils/whatsappOtpApi";
import {
  createSessionRefreshController,
  decideSessionRecovery,
  readPersistedAuthSession,
  shouldApplyAuthEvent,
  type SessionRecoveryDecision,
} from "../utils/authSessionRecovery";
// Complete the auth session when browser closes
WebBrowser.maybeCompleteAuthSession();

function appleNonceDependencies() {
  return {
    randomBytes: () => Crypto.getRandomBytes(32),
    digestSha256Hex: (value: string) =>
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  };
}

export function prefetchAppleAuthNonce(): Promise<PreparedAppleNonce> {
  return prefetchPreparedAppleNonce(() =>
    prepareAppleNonce(appleNonceDependencies()),
  );
}

function nativeAppleSignInOptions(hashedNonce: string) {
  const request = appleSignInRequestFromNonce(hashedNonce);
  return {
    nonce: request.nonce,
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  };
}

/**
 * Maps Supabase auth errors to user-friendly error messages
 * @param error - The error from Supabase auth
 * @param operation - The operation being performed ('signIn' | 'signUp')
 * @returns A user-friendly error message, or the original error if no mapping exists
 */
function mapAuthError(
  error: Error & { status?: number; code?: string },
  operation: "signIn" | "signUp"
): Error {
  // Sign in specific errors
  if (operation === "signIn") {
    // Invalid credentials
    if (
      error.status === 400 &&
      (error.message.includes("Invalid login credentials") ||
        error.message.includes("invalid_credentials") ||
        error.code === "invalid_credentials")
    ) {
      return new Error(
        "Invalid email or password. Please check your credentials and try again."
      );
    }

    // Rate limit
    if (
      error.status === 429 ||
      error.message.includes("rate limit") ||
      error.message.includes("429")
    ) {
      return new Error(
        "Too many sign-in attempts. Please wait a moment and try again."
      );
    }

    // Email confirmation required
    if (error.message.includes("email") && error.message.includes("confirm")) {
      return new Error(
        "Please check your email and confirm your account before signing in."
      );
    }
  }

  // Sign up specific errors
  if (operation === "signUp") {
    // User already exists
    if (
      error.status === 400 &&
      (error.message.includes("User already registered") ||
        error.message.includes("already registered") ||
        error.message.includes("email address is already registered") ||
        error.code === "user_already_registered")
    ) {
      return new Error(
        "An account with this email already exists. Please sign in instead."
      );
    }

    // Invalid email format
    if (
      error.status === 400 &&
      (error.message.includes("Invalid email") ||
        error.message.includes("email format") ||
        error.code === "invalid_email")
    ) {
      return new Error("Please enter a valid email address.");
    }

    // Weak password
    if (
      error.status === 400 &&
      ((error.message.includes("Password") && error.message.includes("weak")) ||
        error.message.includes("password is too weak") ||
        error.code === "weak_password")
    ) {
      return new Error(
        "Password is too weak. Please choose a stronger password."
      );
    }
  }

  // Return original error if no mapping found
  return error;
}

function classifyCaughtSocialAuthFailure(
  provider: SocialAuthProvider,
  stage: SocialAuthStage,
  error: unknown,
  cancelled = false,
): SocialAuthFailure {
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown })
      : null;
  const message = readUnknownErrorMessage(error);
  return classifySocialAuthFailure({
    provider,
    stage,
    code: typeof candidate?.code === "string" ? candidate.code : undefined,
    message: message || "Unknown social authentication error",
    cancelled,
  });
}

export function handleSocialAuthFailure(
  provider: SocialAuthProvider,
  stage: SocialAuthStage,
  error: unknown,
  attemptId: string,
  cancelled = false,
  retryCount = 0,
): { error: Error | null } {
  const failure = classifyCaughtSocialAuthFailure(
    provider,
    stage,
    error,
    cancelled,
  );

  if (failure.kind === "cancelled") return { error: null };

  recordSocialAuthFailure(failure, attemptId, { retryCount });
  // Cancels already returned. Profile-name updates are non-blocking, so they
  // are not sign-in funnel failures (auth_succeeded still fires).
  if (shouldCaptureSocialAuthFailure(failure.kind, failure.stage)) {
    captureAuthFailed(
      failure.provider,
      authFailureReasonFromSocialFailure(failure),
    );
  }
  return { error: createSocialAuthError(failure) };
}
function formatAppleFullName(
  fullName: AppleAuthentication.AppleAuthenticationFullName | null
): string | null {
  if (!fullName) return null;

  const name = [
    fullName.givenName,
    fullName.middleName,
    fullName.familyName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return name || null;
}

function getWebOAuthCallback() {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return null;
  }

  return parseOAuthCallbackUrl(window.location.href);
}

function clearWebOAuthCallbackParams() {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const hadHash = Boolean(url.hash);
  url.hash = "";
  url.searchParams.delete("code");
  url.searchParams.delete("access_token");
  url.searchParams.delete("refresh_token");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  if (!hadHash && url.search === window.location.search) return;

  window.history.replaceState(
    {},
    document.title,
    `${url.pathname}${url.search}`,
  );
}

/**
 * Authentication context type
 * Provides session state, user information, and authentication methods
 */
interface AuthContextType {
  /** Current Supabase session, null if not authenticated */
  session: Session | null;
  /** Current user object, null if not authenticated */
  user: User | null;
  /** Whether the auth state is still loading */
  loading: boolean;
  /** Signs in a user with email and password */
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  /** Signs up a new user with email and password */
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  /** Signs in a user with Google OAuth */
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  /** Signs in a user with native Sign in with Apple */
  signInWithApple: () => Promise<{ error: Error | null }>;
  /**
   * Exchanges an Apple credential obtained from a user-gesture `signInAsync`
   * for a Supabase session. AuthScreen calls this after the native sheet.
   */
  completeAppleSignIn: (
    credential: AppleAuthentication.AppleAuthenticationCredential,
    rawNonce: string,
  ) => Promise<{ error: Error | null }>;
  /**
   * Feature-flagged WhatsApp OTP login. Sends a code to `phoneE164`.
   * Prefer requesting the code via sendWhatsAppOtp; this verifies and sets the session.
   */
  signInWithWhatsAppOtp: (
    phoneE164: string,
    code: string,
  ) => Promise<{ error: Error | null }>;
  /** Starts a Supabase anonymous session. The guest_mode flag gates the button. */
  signInAnonymously: () => Promise<{ error: Error | null }>;
  /** Signs out the current user */
  signOut: () => void | Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider component
 * Provides authentication context to the application
 * Manages user session, authentication state, and provides auth methods
 *
 * @param children - React children components
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  // Logged-out /app already painted its title in the static shell. Waiting on
// getSession here would hide that title behind the groups skeleton.
const [loading, setLoading] = useState<boolean>(() => !isWebAuthShellActive());
  const previousAuthUserIdRef = useRef<string | null | undefined>(undefined);
  const pendingAuthMethodRef = useRef<AuthFunnelMethod | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const refreshControllerRef = useRef<ReturnType<
    typeof createSessionRefreshController
  > | null>(null);

  // Helper to update auth state and sync with Sentry
  // Wrapped in useCallback to maintain stable reference for useEffect dependency
  const updateAuthState = useCallback((nextSession: Session | null) => {
    sessionRef.current = nextSession;
    const previousUserId = previousAuthUserIdRef.current;
    const nextUserId = nextSession?.user?.id ?? null;
    // Skip the very first undefined→value bootstrap crumb flood; still tag later transitions.
    if (previousUserId !== undefined) {
      const transition = resolveAuthSessionTransition(previousUserId, nextUserId);
      if (transition) {
        recordSentryAuthSessionTransition(transition);
      }
    }
    if (
      Platform.OS === "web" &&
      previousUserId &&
      previousUserId !== nextUserId
    ) {
      forgetWebProfileLabel();
    }
    previousAuthUserIdRef.current = nextUserId;

    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    setLoading(false);

    // Sync with Sentry
    const user = nextSession?.user;
    Sentry.setUser(
      user
        ? {
            id: user.id,
            email: user.email ?? undefined,
          }
        : null
    );

    // Sync with PostHog: auth user id as distinct_id + email/name person props
    // so support can search persons by email in SharedMoney Production.
    const appProvider = user?.app_metadata?.provider;
    const pendingMethod = pendingAuthMethodRef.current;
    if (user) {
      pendingAuthMethodRef.current = null;
    }
    syncAnalyticsAuth(user?.id ?? null, {
      auth_provider: resolveAuthProvider({
        appProvider: typeof appProvider === "string" ? appProvider : undefined,
        pendingMethod,
      }),
      email: user?.email ?? undefined,
      name: resolveAuthDisplayName(
        user?.user_metadata as Record<string, unknown> | undefined,
      ),
      is_new_user: isNewAuthUser({
        createdAt: user?.created_at,
        lastSignInAt: user?.last_sign_in_at,
        now: Date.now(),
      }),
      is_guest: user?.is_anonymous === true,
    });
  }, []);

  useEffect(() => {
    const controller = createSessionRefreshController({
      refreshSession: async () => {
        if (!sessionRef.current?.refresh_token) {
          return { error: null };
        }
        const { error } = await supabase.auth.refreshSession();
        return { error };
      },
      startAutoRefresh: () => supabase.auth.startAutoRefresh(),
      stopAutoRefresh: () => supabase.auth.stopAutoRefresh(),
      onFatalFailure: () => {
        void supabase.auth.signOut({ scope: "local" });
        updateAuthState(null);
      },
      getAccessTokenExpiresAt: () => sessionRef.current?.expires_at ?? null,
    });
    refreshControllerRef.current = controller;

    const subscription = AppState.addEventListener("change", (nextState) => {
      controller.handleAppStateChange(nextState);
    });
    controller.handleAppStateChange(AppState.currentState);

    return () => {
      subscription.remove();
      controller.stop();
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
      }
    };
  }, [updateAuthState]);

  useEffect(() => {
    let mounted = true;
    let loadingReleased = false;
    let suppressPersistedSession = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const oauthCallback = getWebOAuthCallback();

    const releaseLoading = () => {
      if (!mounted || loadingReleased) return;
      loadingReleased = true;
      setLoading(false);
    };

    const applyRecovery = (decision: SessionRecoveryDecision) => {
      if (!mounted) return;
      switch (decision.action) {
        case "use-session": {
          const nextSession = (decision.session as Session | null) ?? null;
          if (!nextSession && sessionRef.current) {
            releaseLoading();
            return;
          }
          updateAuthState(nextSession);
          loadingReleased = true;
          return;
        }
        case "keep-existing":
          releaseLoading();
          if (sessionRef.current) {
            refreshControllerRef.current?.scheduleRetryAfterTransientFailure();
          }
          return;
        case "sign-out":
          suppressPersistedSession = true;
          void supabase.auth.signOut({ scope: "local" });
          updateAuthState(null);
          loadingReleased = true;
          return;
        default: {
          const _exhaustive: never = decision;
          throw new Error(
            `Unhandled session recovery action: ${String(_exhaustive)}`,
          );
        }
      }
    };

    if (!oauthCallback) {
      void readPersistedAuthSession(
        (key) => AsyncStorage.getItem(key),
        process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
      ).then((cached) => {
        if (!mounted || !cached || suppressPersistedSession) return;
        if (sessionRef.current) return;
        updateAuthState(cached as Session);
        loadingReleased = true;
      });
    }

    const initialSessionPromise =
      oauthCallback?.status === "tokens"
        ? supabase.auth
            .setSession({
              access_token: oauthCallback.accessToken,
              refresh_token: oauthCallback.refreshToken,
            })
            .finally(clearWebOAuthCallbackParams)
        : oauthCallback?.status === "code"
          ? supabase.auth
              .exchangeCodeForSession(oauthCallback.code)
              .finally(clearWebOAuthCallbackParams)
          : supabase.auth.getSession();

    // Get initial session. On web, also consume OAuth hash callbacks such as
    // /app#access_token=... when Supabase does not auto-detect them in time.
    // Timeouts and network errors must not clear a stored session.
    initialSessionPromise
      .then(({ data: { session: nextSession }, error }) => {
        if (!mounted) return;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (error) {
          logError(error, {
            context: "getSession",
            errorType: "session_error",
          });
        }

        applyRecovery(
          decideSessionRecovery({
            source: "resolved",
            session: nextSession,
            error,
          }),
        );
      })
      .catch((err) => {
        if (!mounted) return;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        logError(err, {
          context:
            oauthCallback?.status === "tokens" || oauthCallback?.status === "code"
              ? "setSessionFromOAuthUrl"
              : "getSession",
          errorType: "exception",
        });
        applyRecovery(
          decideSessionRecovery({
            source: "exception",
            error: err,
          }),
        );
      });

    timeoutId = setTimeout(() => {
      if (!mounted || loadingReleased) return;
      log(
        "getSession timeout - keeping existing session",
        { context: "getSession" },
        "warn",
      );
      applyRecovery(decideSessionRecovery({ source: "timeout" }));
    }, AUTH_TIMEOUTS.SESSION_FETCH_TIMEOUT);

    // Listen for auth changes - this is the primary source of truth
    // This includes TOKEN_REFRESHED events from Supabase's automatic token refresh
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (!mounted) return;

      if (
        !shouldApplyAuthEvent(event, nextSession, Boolean(sessionRef.current))
      ) {
        refreshControllerRef.current?.scheduleRetryAfterTransientFailure();
        releaseLoading();
        return;
      }

      if (event === "SIGNED_OUT") {
        suppressPersistedSession = true;
      }
      updateAuthState(nextSession);
      loadingReleased = true;
    });

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      subscription.unsubscribe();
    };
  }, [updateAuthState]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    void prefetchAppleAuthNonce();
  }, []);

  /**
   * Signs in a user with email and password
   * @param email - User's email address
   * @param password - User's password
   * @returns Promise resolving to an object with error property (null if successful)
   */
  const signIn = useCallback(async (email: string, password: string) => {
    try {
      pendingAuthMethodRef.current = "email";
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        pendingAuthMethodRef.current = null;
        return { error: mapAuthError(error, "signIn") };
      }

      return { error: null };
    } catch (err) {
      pendingAuthMethodRef.current = null;
      logError(err, { context: "signIn" });
      return {
        error:
          err instanceof Error ? err : new Error("Unknown error in signIn"),
      };
    }
  }, []);

  /**
   * Signs up a new user with email and password
   * @param email - User's email address
   * @param password - User's password
   * @returns Promise resolving to an object with error property (null if successful)
   */
  const signInAnonymously = useCallback(async () => {
    try {
      const captchaToken = await anonymousCaptchaToken();
      const { error } = await supabase.auth.signInAnonymously(
        captchaToken ? { options: { captchaToken } } : undefined,
      );
      if (error) {
        return { error: mapAuthError(error, "signIn") };
      }
      captureAnalyticsEvent(ANALYTICS_EVENTS.GUEST_STARTED, { platform: Platform.OS });
      return { error: null };
    } catch (err) {
      logError(err, { context: "signInAnonymously" });
      return {
        error: err instanceof Error ? err : new Error("Could not start a guest session"),
      };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    try {
      pendingAuthMethodRef.current = "email";
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        pendingAuthMethodRef.current = null;
        return { error: mapAuthError(error, "signUp") };
      }

      return { error };
    } catch (err) {
      pendingAuthMethodRef.current = null;
      logError(err, { context: "signUp" });
      return {
        error:
          err instanceof Error ? err : new Error("Unknown error in signUp"),
      };
    }
  }, []);

  /**
   * Signs in a user with Google.
   * Android development/production builds use native Credential Manager
   * (account drawer) + Supabase signInWithIdToken. Web, iOS, and Expo Go keep
   * the existing browser OAuth path so Apple/email flows stay unchanged.
   * @returns Promise resolving to an object with error property (null if successful)
   */
  const signInWithGoogle = useCallback(async () => {
    const attemptId = Crypto.randomUUID();
    let stage: SocialAuthStage = "provider_request";

    try {
      if (canUseNativeGoogleSignIn()) {
        stage = "native_request";
        const nativeResult = await signInWithNativeGoogle();

        if (nativeResult.status === "cancelled") {
          return handleSocialAuthFailure(
            "google",
            stage,
            new Error("Authentication was cancelled"),
            attemptId,
            true,
          );
        }

        if (nativeResult.status === "unavailable") {
          return handleSocialAuthFailure(
            "google",
            stage,
            Object.assign(new Error(nativeResult.reason), {
              code: "GOOGLE_NATIVE_UNAVAILABLE",
            }),
            attemptId,
          );
        }

        stage = "token_exchange";
        pendingAuthMethodRef.current = "google";
        const { error: sessionError } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: nativeResult.idToken,
          nonce: nativeResult.rawNonce,
        });

        if (sessionError) {
          pendingAuthMethodRef.current = null;
          return handleSocialAuthFailure(
            "google",
            stage,
            sessionError,
            attemptId,
          );
        }

        stage = "session_verification";
        const {
          data: { session: verifySession },
          error: verifyError,
        } = await supabase.auth.getSession();

        if (verifyError || !verifySession) {
          pendingAuthMethodRef.current = null;
          return handleSocialAuthFailure(
            "google",
            stage,
            verifyError ||
              new Error("Session was not created after native Google sign-in"),
            attemptId,
          );
        }

        return { error: null };
      }

      // Browser OAuth fallback (web, iOS, Expo Go, or misconfigured Android).
      const isExpoGo = Constants.appOwnership === "expo";
      const isWeb = Platform.OS === "web";

      let redirectTo: string;
      if (isWeb) {
        const appPath = getConfiguredWebAppPath();
        redirectTo =
          typeof window !== "undefined"
            ? `${window.location.origin}${appPath || ""}`
            : AuthSession.makeRedirectUri();
      } else if (isExpoGo) {
        // Use Expo's proxy service for Expo Go - this prevents email app from opening
        // useProxy is valid at runtime but not in types, so we use type assertion
        redirectTo = AuthSession.makeRedirectUri({
          useProxy: true,
        } as Parameters<typeof AuthSession.makeRedirectUri>[0]);
      } else {
        // Use SharedMoney's custom scheme for development/production builds.
        redirectTo = "sharedmoney://auth/callback";
      }

      // Get the OAuth URL from Supabase
      const { data, error: urlError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: !isWeb,
        },
      });

      if (urlError) {
        return handleSocialAuthFailure(
          "google",
          stage,
          urlError,
          attemptId,
        );
      }

      if (!data?.url) {
        return handleSocialAuthFailure(
          "google",
          stage,
          new Error("Failed to get OAuth URL"),
          attemptId,
        );
      }

      if (isWeb) {
        // On web, Supabase handles the redirect automatically if skipBrowserRedirect is false
        return { error: null };
      }

      // Open browser for authentication (native platforms only).
      // Android retries once with an explicit Custom Tabs package when the
      // default resolver finds no browser activity.
      stage = "browser_session";
      const result = await openGoogleAuthSession(
        data.url,
        redirectTo,
        {
          openAuthSession: (url, redirectUrl, options) =>
            WebBrowser.openAuthSessionAsync(url, redirectUrl, options),
          listCustomTabsBrowsers: () =>
            WebBrowser.getCustomTabsSupportingBrowsersAsync(),
        },
        Platform.OS,
      );

      if (result.type === "success") {
        stage = "callback_parse";
        const url = (result as { type: "success"; url: string }).url;
        const callback = parseOAuthCallbackUrl(url);

        switch (callback.status) {
          case "tokens": {
            stage = "token_exchange";
            pendingAuthMethodRef.current = "google";
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: callback.accessToken,
              refresh_token: callback.refreshToken,
            });
            if (sessionError) {
              pendingAuthMethodRef.current = null;
              return handleSocialAuthFailure(
                "google",
                stage,
                sessionError,
                attemptId,
              );
            }
            break;
          }
          case "code": {
            stage = "token_exchange";
            pendingAuthMethodRef.current = "google";
            const { error: sessionError } =
              await supabase.auth.exchangeCodeForSession(callback.code);
            if (sessionError) {
              pendingAuthMethodRef.current = null;
              return handleSocialAuthFailure(
                "google",
                stage,
                sessionError,
                attemptId,
              );
            }
            break;
          }
          case "error": {
            const cancelled = callback.error === "access_denied";
            return handleSocialAuthFailure(
              "google",
              stage,
              Object.assign(new Error(callback.error), {
                code: callback.error,
              }),
              attemptId,
              cancelled,
            );
          }
          case "missing":
            return handleSocialAuthFailure(
              "google",
              stage,
              new Error("OAuth callback tokens were missing"),
              attemptId,
            );
          default: {
            const _exhaustive: never = callback;
            return handleSocialAuthFailure(
              "google",
              stage,
              _exhaustive,
              attemptId,
            );
          }
        }

        stage = "session_verification";
        const {
          data: { session: verifySession },
          error: verifyError,
        } = await supabase.auth.getSession();

        if (verifyError || !verifySession) {
          pendingAuthMethodRef.current = null;
          return handleSocialAuthFailure(
            "google",
            stage,
            verifyError ||
              new Error("Session was not created after setting tokens"),
            attemptId,
          );
        }

        return { error: null };
      }

      const sessionKind = classifyGoogleAuthSessionResult(result.type);
      if (sessionKind === "cancelled") {
        pendingAuthMethodRef.current = null;
        return handleSocialAuthFailure(
          "google",
          stage,
          new Error("Authentication was cancelled"),
          attemptId,
          true,
        );
      }

      return handleSocialAuthFailure(
        "google",
        stage,
        Object.assign(
          new Error("Google sign-in did not complete. Please try again."),
          { code: `WEB_BROWSER_${result.type.toUpperCase()}` },
        ),
        attemptId,
      );
    } catch (error) {
      return handleSocialAuthFailure(
        "google",
        stage,
        error,
        attemptId,
      );
    }
  }, []);

  /**
   * Exchanges a native Apple credential for a Supabase session. The credential
   * must come from `signInAsync` invoked in a user-gesture context.
   */
  const completeAppleSignIn = useCallback(
    async (
      credential: AppleAuthentication.AppleAuthenticationCredential,
      rawNonce: string,
    ) => {
      const attemptId = Crypto.randomUUID();
      let stage: SocialAuthStage = "native_request";

      try {
        if (!credential.identityToken) {
          return handleSocialAuthFailure(
            "apple",
            stage,
            new Error("Apple did not return an identity token"),
            attemptId,
          );
        }

        stage = "token_exchange";
        pendingAuthMethodRef.current = "apple";
        const { error: sessionError } = await supabase.auth.signInWithIdToken({
          provider: "apple",
          token: credential.identityToken,
          nonce: rawNonce,
        });

        if (sessionError) {
          pendingAuthMethodRef.current = null;
          return handleSocialAuthFailure(
            "apple",
            stage,
            sessionError,
            attemptId,
          );
        }

        const fullName = formatAppleFullName(credential.fullName);
        if (fullName) {
          stage = "profile_update";
          const { error: metadataError } = await supabase.auth.updateUser({
            data: {
              full_name: fullName,
              given_name: credential.fullName?.givenName ?? undefined,
              family_name: credential.fullName?.familyName ?? undefined,
            },
          });

          if (metadataError) {
            handleSocialAuthFailure(
              "apple",
              stage,
              metadataError,
              attemptId,
            );
          }
        }

        stage = "session_verification";
        const {
          data: { session: verifySession },
          error: verifyError,
        } = await supabase.auth.getSession();

        if (verifyError || !verifySession) {
          pendingAuthMethodRef.current = null;
          return handleSocialAuthFailure(
            "apple",
            stage,
            verifyError ||
              new Error("Session was not created after Apple sign-in"),
            attemptId,
          );
        }

        return { error: null };
      } catch (error) {
        pendingAuthMethodRef.current = null;
        return handleSocialAuthFailure("apple", stage, error, attemptId);
      } finally {
        void prefetchAppleAuthNonce();
      }
    },
    [],
  );

  /**
   * Signs in a user with native Sign in with Apple and exchanges the ID token
   * for a Supabase session. Prefetches the nonce so `signInAsync` is the first
   * native call when a nonce is already ready.
   */
  const signInWithApple = useCallback(async () => {
    const attemptId = Crypto.randomUUID();
    let stage: SocialAuthStage = "native_request";

    try {
      if (Platform.OS !== "ios") {
        return { error: new Error("Apple sign-in is only available on iOS") };
      }

      let prepared = takePreparedAppleNonce();
      if (!prepared) {
        prepared = await prepareAppleNonce(appleNonceDependencies());
      }

      stage = "native_request";
      const credential = await AppleAuthentication.signInAsync(
        nativeAppleSignInOptions(prepared.hashedNonce),
      );
      return await completeAppleSignIn(credential, prepared.rawNonce);
    } catch (error) {
      void prefetchAppleAuthNonce();
      return handleSocialAuthFailure("apple", stage, error, attemptId);
    }
  }, [completeAppleSignIn]);

  /**
   * Verifies a WhatsApp OTP and establishes a Supabase session.
   * Gated by EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN + server ENABLE_WHATSAPP_OTP_LOGIN.
   */
  const signInWithWhatsAppOtp = useCallback(
    async (phoneE164: string, code: string) => {
      try {
        const result = await verifyWhatsAppOtp(phoneE164, code);
        pendingAuthMethodRef.current = "whatsapp";
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
        if (sessionError) {
          pendingAuthMethodRef.current = null;
          return { error: sessionError };
        }
        const {
          data: { session: verifySession },
          error: verifyError,
        } = await supabase.auth.getSession();
        if (verifyError || !verifySession) {
          pendingAuthMethodRef.current = null;
          return {
            error:
              verifyError ||
              new Error("Session was not created after WhatsApp OTP sign-in"),
          };
        }
        return { error: null };
      } catch (err) {
        pendingAuthMethodRef.current = null;
        logError(err, { context: "signInWithWhatsAppOtp" });
        return {
          error:
            err instanceof Error
              ? err
              : new Error("WhatsApp sign-in failed. Please try again."),
        };
      }
    },
    [],
  );

  /**
   * Signs out the current user
   * Clears the session state and signs out from Supabase
   */
  const signOut = useCallback(async () => {
    const result = await performLocalLogout({
      cleanupPushToken: unregisterCurrentPushToken,
      signOut: (options) => supabase.auth.signOut(options),
      clearAuthState: () => updateAuthState(null),
    });

    const cleanupFailures = result.cleanupResult?.failureStages ?? [];
    if (cleanupFailures.length > 0 || result.failureStages.length > 0) {
      log(
        "Local logout completed with fallback cleanup",
        {
          cleanupStatus: result.cleanupResult?.status,
          cleanupFailures,
          logoutFailures: result.failureStages,
        },
        "warn",
      );
    }
  }, [updateAuthState]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      session,
      user,
      loading,
      signIn,
      signUp,
      signInWithGoogle,
      signInWithApple,
      completeAppleSignIn,
      signInWithWhatsAppOtp,
      signInAnonymously,
      signOut,
    }),
    [
      session,
      user,
      loading,
      signIn,
      signUp,
      signInWithGoogle,
      signInWithApple,
      completeAppleSignIn,
      signInWithWhatsAppOtp,
      signInAnonymously,
      signOut,
    ]
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
};

/**
 * Hook to access the authentication context
 * @returns The authentication context with session, user, loading state, and auth methods
 * @throws Error if used outside of AuthProvider
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
