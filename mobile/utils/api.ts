import { APP_VERSION } from "../constants/version";
import { triggerGlobalUpgrade } from "../contexts/UpgradeContext";
import { supabase } from "../supabase";
import { ApiErrorResponse } from "../types/api";
import {
  handleUnauthorizedResponse,
  type UnauthorizedPolicy,
} from "./authenticatedFetchPolicy";
import { authenticatedRequestHeaders } from "./authenticatedRequestHeaders";
import { formatNetworkErrorMessage } from "./networkErrors";
import { requestGuestSignIn } from "./guestGate";
import { guestSignInCopy, type GuestSignInAction } from "./guestMode";

const TOKEN_REFRESH_BUFFER_SECONDS = 60;
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const API_URL = process.env.EXPO_PUBLIC_API_URL;

/**
 * Sanitizes error messages to remove sensitive information before showing to users
 */
function sanitizeErrorMessage(message: string): string {
  // Remove stack traces (lines starting with "at" or file paths)
  let sanitized = message
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("at ") &&
        !trimmed.includes("/node_modules/") &&
        !trimmed.includes("\\node_modules\\") &&
        !trimmed.match(/^[A-Z]:\\/) && // Windows absolute paths
        !trimmed.startsWith("/") && // Unix absolute paths (but allow relative)
        !trimmed.match(/^\w+:\/\//) // URLs
      );
    })
    .join("\n")
    .trim();

  // If we filtered everything out, return a generic message
  if (!sanitized) {
    return "An error occurred. Please try again.";
  }

  // Limit message length to prevent UI issues
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 197) + "...";
  }

  return sanitized;
}

export async function getAuthToken(): Promise<string | null> {
  let {
    data: { session: currentSession },
  } = await supabase.auth.getSession();

  if (!currentSession) return null;

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = currentSession.expires_at || 0;

  if (expiresAt && expiresAt < now + TOKEN_REFRESH_BUFFER_SECONDS) {
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession();

    if (refreshError || !refreshData.session) {
      return null;
    }

    currentSession = refreshData.session;
  }

  return currentSession.access_token;
}

/**
 * Wraps fetch in a timeout so we don't hang forever on bad connections.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

export async function fetchWithAuth(
  endpoint: string,
  options: RequestInit = {},
  unauthorizedPolicy: UnauthorizedPolicy = "sign-out-local",
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  if (!API_URL) {
    throw new Error(
      "Unable to connect to the server. Please check your app configuration and try again."
    );
  }

  const token = await getAuthToken();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const fullUrl = `${API_URL}${endpoint}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(fullUrl, {
      ...options,
      headers: authenticatedRequestHeaders(token, APP_VERSION, options.headers),
    }, timeoutMs);
  } catch (networkError: any) {
    // Handle network-level errors (connection refused, timeout, DNS failure, etc.)
    const errorName = networkError?.name || "Unknown";
    const errorMessage = networkError?.message || "Network request failed";
    
    if (__DEV__) {
      console.error("[API Network Error]", {
        errorName,
        errorMessage,
        endpoint,
      });
    }

    throw new Error(
      formatNetworkErrorMessage({
        apiUrl: API_URL,
        errorName,
        errorMessage,
        isDevelopment: __DEV__,
      }),
    );
  }

  if (response.status === 401) {
    return handleUnauthorizedResponse(
      unauthorizedPolicy,
      (options) => supabase.auth.signOut(options),
    );
  }

  // Handle 426 Upgrade Required - app version is too old
  if (response.status === 426) {
    let errorData: ApiErrorResponse | null = null;
    try {
      const responseText = await response.text();
      if (responseText) {
        errorData = JSON.parse(responseText) as ApiErrorResponse;
      }
    } catch {
      // Ignore parse errors
    }
    
    // Trigger the global upgrade modal
    triggerGlobalUpgrade(
      errorData?.error || "Please update your app to continue.",
      errorData?.details
    );
    
    // Throw a special error that hooks can recognize
    const error = new Error("UPGRADE_REQUIRED");
    (error as any).code = "UPGRADE_REQUIRED";
    throw error;
  }

  if (response.status === 429) {
    throw new Error("Too many requests. Please wait a moment and try again.");
  }

  if (!response.ok) {
    let errorData: ApiErrorResponse | null = null;
    try {
      const responseText = await response.text();
      if (responseText) {
        try {
          errorData = JSON.parse(responseText) as ApiErrorResponse;
        } catch {
          // Not JSON, use text as error message
        }
      }
    } catch {
      // Ignore
    }

    if (
      errorData?.code === "GUEST_SIGNIN_REQUIRED"
      || errorData?.code === "GUEST_GROUP_CAP"
      || errorData?.code === "GUEST_EXPENSE_CAP"
    ) {
      const action: GuestSignInAction = errorData.code === "GUEST_GROUP_CAP"
        ? "cap_groups"
        : errorData.code === "GUEST_EXPENSE_CAP"
          ? "cap_expenses"
          : "share_link";
      requestGuestSignIn(guestSignInCopy(action));
      const guestError = new Error(errorData.error || "Sign in to continue");
      (guestError as { code?: string }).code = errorData.code;
      throw guestError;
    }

    const rawErrorMessage =
      errorData?.error ||
      errorData?.message ||
      errorData?.details ||
      `HTTP error! status: ${response.status}`;

    // Sanitize error messages for user-facing display
    // Remove potentially sensitive information like stack traces, file paths, etc.
    const sanitizedMessage = sanitizeErrorMessage(rawErrorMessage);

    throw new Error(sanitizedMessage);
  }

  return response;
}
