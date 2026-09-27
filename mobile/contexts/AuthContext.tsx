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
import { Platform } from "react-native";
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
import { syncAnalyticsAuth } from "../utils/posthogAnalytics";
import { resolveAuthDisplayName } from "../utils/posthogIdentity";
import {
  canUseNativeGoogleSignIn,
  signInWithNativeGoogle,
} from "../utils/nativeGoogleAuth";
import {
  classifySocialAuthFailure,
  getSocialAuthUserMessage,
  shouldRetryAppleNativeAuth,
  type SocialAuthFailure,
  type SocialAuthProvider,
  type SocialAuthStage,
} from "../utils/socialAuth";
import { recordSocialAuthFailure } from "../utils/socialAuthTelemetry";
// Complete the auth session when browser closes
WebBrowser.maybeCompleteAuthSession();

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
  return classifySocialAuthFailure({
    provider,
    stage,
    code: typeof candidate?.code === "string" ? candidate.code : undefined,
    message:
      typeof candidate?.message === "string"
        ? candidate.message
        : String(error ?? "Unknown social authentication error"),
    cancelled,
  });
}

function handleSocialAuthFailure(
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
  return { error: new Error(getSocialAuthUserMessage(failure)) };
}
function createAppleNonce(byteCount = 32): string {
  return Array.from(Crypto.getRandomBytes(byteCount))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

function extractOAuthTokensFromUrl(url: string): {
  access_token: string;
  refresh_token: string;
} | null {
  const hash = url.split("#")[1];
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) return null;

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}

function getWebOAuthTokensFromCurrentUrl(): {
  access_token: string;
  refresh_token: string;
} | null {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return null;
  }

  return extractOAuthTokensFromUrl(window.location.href);
}

function clearWebOAuthHash() {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return;
  }

  if (!window.location.hash) return;

  const cleanUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState({}, document.title, cleanUrl);
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
  const [loading, setLoading] = useState<boolean>(true);
  const previousAuthUserIdRef = useRef<string | null | undefined>(undefined);

  // Helper to update auth state and sync with Sentry
  // Wrapped in useCallback to maintain stable reference for useEffect dependency
  const updateAuthState = useCallback((nextSession: Session | null) => {
    const previousUserId = previousAuthUserIdRef.current;
    const nextUserId = nextSession?.user?.id ?? null;
    // Skip the very first undefined→value bootstrap crumb flood; still tag later transitions.
    if (previousUserId !== undefined) {
      const transition = resolveAuthSessionTransition(previousUserId, nextUserId);
      if (transition) {
        recordSentryAuthSessionTransition(transition);
      }
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
    const provider = user?.app_metadata?.provider;
    syncAnalyticsAuth(user?.id ?? null, {
      auth_provider: typeof provider === "string" ? provider : undefined,
      email: user?.email ?? undefined,
      name: resolveAuthDisplayName(
        user?.user_metadata as Record<string, unknown> | undefined,
      ),
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    let resolved = false;
    let timeoutId: NodeJS.Timeout | null = null;
    const oauthTokens = getWebOAuthTokensFromCurrentUrl();
    const initialSessionPromise = oauthTokens
      ? supabase.auth.setSession(oauthTokens).finally(clearWebOAuthHash)
      : supabase.auth.getSession();

    // Get initial session. On web, also consume OAuth hash callbacks such as
    // /app#access_token=... when Supabase does not auto-detect them in time.
    initialSessionPromise
      .then(({ data: { session }, error }) => {
        // Check resolved BEFORE setting it to prevent race condition
        if (resolved || !mounted) return;
        resolved = true;

        // Clear timeout since we resolved early
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (error) {
          logError(error, {
            context: "getSession",
            errorType: "session_error",
          });
          updateAuthState(null);
          return;
        }

        updateAuthState(session);
      })
      .catch((err) => {
        // Check resolved BEFORE setting it to prevent race condition
        if (resolved || !mounted) return;
        resolved = true;

        // Clear timeout since we resolved early
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        logError(err, {
          context: oauthTokens ? "setSessionFromOAuthUrl" : "getSession",
          errorType: "exception",
        });
        // Log out on exception - can't get session means auth is broken
        supabase.auth.signOut({ scope: "local" });
        updateAuthState(null);
      });

    // Fallback: If getSession doesn't resolve in time, log out
    timeoutId = setTimeout(() => {
      if (!resolved && mounted) {
        resolved = true; // Mark as resolved to prevent race condition
        log(
          "getSession timeout - logging out",
          { context: "getSession" },
          "warn"
        );
        supabase.auth.signOut({ scope: "local" });
        updateAuthState(null);
      }
    }, AUTH_TIMEOUTS.SESSION_FETCH_TIMEOUT);

    // Listen for auth changes - this is the primary source of truth
    // This includes TOKEN_REFRESHED events from Supabase's automatic token refresh
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_, session) => {
      // Check mounted flag to prevent state updates after unmount
      if (!mounted) return;

      updateAuthState(session);
    });

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      subscription.unsubscribe();
    };
  }, [updateAuthState]);

  /**
   * Signs in a user with email and password
   * @param email - User's email address
   * @param password - User's password
   * @returns Promise resolving to an object with error property (null if successful)
   */
  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { error: mapAuthError(error, "signIn") };
      }

      return { error: null };
    } catch (err) {
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
  const signUp = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        return { error: mapAuthError(error, "signUp") };
      }

      return { error };
    } catch (err) {
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
        const { error: sessionError } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: nativeResult.idToken,
          nonce: nativeResult.rawNonce,
        });

        if (sessionError) {
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

      // Open browser for authentication (native platforms only)
      stage = "browser_session";
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectTo
      );

      if (result.type === "success") {
        stage = "callback_parse";
        // TypeScript doesn't narrow the type properly, but url exists on success
        const url = (result as { type: "success"; url: string }).url;
        const tokens = extractOAuthTokensFromUrl(url);

        if (!tokens) {
          return handleSocialAuthFailure(
            "google",
            stage,
            new Error("OAuth callback tokens were missing"),
            attemptId,
          );
        }

        // Set session directly from tokens
        stage = "token_exchange";
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        });

        if (sessionError) {
          return handleSocialAuthFailure(
            "google",
            stage,
            sessionError,
            attemptId,
          );
        }

        // Verify session was created
        stage = "session_verification";
        const {
          data: { session: verifySession },
          error: verifyError,
        } = await supabase.auth.getSession();

        if (verifyError || !verifySession) {
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

      if (result.type === "cancel" || result.type === "dismiss") {
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
        Object.assign(new Error("Browser authentication did not complete"), {
          code: `WEB_BROWSER_${result.type.toUpperCase()}`,
        }),
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
   * Signs in a user with native Sign in with Apple and exchanges the ID token
   * for a Supabase session.
   * @returns Promise resolving to an object with error property (null if successful)
   */
  const signInWithApple = useCallback(async () => {
    const attemptId = Crypto.randomUUID();
    let stage: SocialAuthStage = "availability_check";
    let appleNativeRetries = 0;

    try {
      if (Platform.OS !== "ios") {
        return { error: new Error("Apple sign-in is only available on iOS") };
      }

      const isAvailable = await AppleAuthentication.isAvailableAsync();
      if (!isAvailable) {
        return {
          error: new Error("Apple sign-in is not available on this device"),
        };
      }

      const requestAppleCredential = async () => {
        const rawNonce = createAppleNonce();
        const hashedNonce = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          rawNonce
        );

        stage = "native_request";
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: hashedNonce,
        });

        return { credential, rawNonce };
      };

      let credential: AppleAuthentication.AppleAuthenticationCredential;
      let rawNonce: string;

      try {
        ({ credential, rawNonce } = await requestAppleCredential());
      } catch (nativeError) {
        const failure = classifyCaughtSocialAuthFailure(
          "apple",
          stage,
          nativeError,
        );

        // Retry once for transient Apple ERR_REQUEST_UNKNOWN with a fresh nonce.
        // Do not report the first failure if the retry succeeds (avoids Sentry noise).
        if (shouldRetryAppleNativeAuth(failure)) {
          appleNativeRetries = 1;
          try {
            ({ credential, rawNonce } = await requestAppleCredential());
          } catch (retryError) {
            return handleSocialAuthFailure(
              "apple",
              stage,
              retryError,
              attemptId,
              false,
              appleNativeRetries,
            );
          }
        } else {
          return handleSocialAuthFailure(
            "apple",
            stage,
            nativeError,
            attemptId,
            false,
            appleNativeRetries,
          );
        }
      }

      if (!credential.identityToken) {
        return handleSocialAuthFailure(
          "apple",
          stage,
          new Error("Apple did not return an identity token"),
          attemptId,
          false,
          appleNativeRetries,
        );
      }

      stage = "token_exchange";
      const { error: sessionError } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
        nonce: rawNonce,
      });

      if (sessionError) {
        return handleSocialAuthFailure(
          "apple",
          stage,
          sessionError,
          attemptId,
          false,
          appleNativeRetries,
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
            false,
            appleNativeRetries,
          );
        }
      }

      stage = "session_verification";
      const {
        data: { session: verifySession },
        error: verifyError,
      } = await supabase.auth.getSession();

      if (verifyError || !verifySession) {
        return handleSocialAuthFailure(
          "apple",
          stage,
          verifyError ||
            new Error("Session was not created after Apple sign-in"),
          attemptId,
          false,
          appleNativeRetries,
        );
      }

      return { error: null };
    } catch (error) {
      return handleSocialAuthFailure(
        "apple",
        stage,
        error,
        attemptId,
        false,
        appleNativeRetries,
      );
    }
  }, []);

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
