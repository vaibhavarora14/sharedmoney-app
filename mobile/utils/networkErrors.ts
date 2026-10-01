export type NetworkErrorMessageInput = {
  apiUrl: string;
  errorName: string;
  errorMessage: string;
  isDevelopment: boolean;
};

export function formatNetworkErrorMessage({
  apiUrl,
  errorName,
  errorMessage,
  isDevelopment,
}: NetworkErrorMessageInput): string {
  const isTimeout =
    errorMessage.includes("timeout") ||
    errorName === "TimeoutError" ||
    errorName === "AbortError";

  if (!isDevelopment) {
    return isTimeout
      ? "Request timed out. Check your connection and try again."
      : "Unable to connect. Check your internet connection and try again.";
  }

  if (
    errorMessage.includes("Network request failed") ||
    errorName === "TypeError"
  ) {
    if (apiUrl.includes("localhost") || apiUrl.includes("127.0.0.1")) {
      return "Cannot connect to server. For Android emulator, use 10.0.2.2 instead of localhost in EXPO_PUBLIC_API_URL";
    }
    if (apiUrl.includes("10.0.0.2")) {
      return "Cannot connect to server. IP address typo detected: use 10.0.2.2 (not 10.0.0.2) for Android emulator in EXPO_PUBLIC_API_URL";
    }
    if (apiUrl.includes("10.0.2.") && !apiUrl.includes("10.0.2.2")) {
      const detectedIp = apiUrl.match(/10\.0\.2\.\d+/)?.[0] || "unknown";
      return `Cannot connect to server. For Android emulator, use exactly 10.0.2.2 (found: ${detectedIp})`;
    }
    return "Cannot connect to server. Please check:\n- Supabase is running (supabase start)\n- Edge Functions server is running (npm run dev:server)\n- Correct API URL in mobile/.env (use 10.0.2.2:54321 for Android emulator)\n- Network connection";
  }

  if (isTimeout) {
    return "Request timed out. The server may be slow or unreachable.";
  }

  if (
    errorMessage.includes("Failed to connect") ||
    errorMessage.includes("ECONNREFUSED")
  ) {
    return "Connection refused. Is the server running?";
  }

  return "Network request failed";
}

function getErrorParts(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (typeof error === "string") {
    return { name: "", message: error };
  }
  if (error && typeof error === "object") {
    const record = error as { name?: unknown; message?: unknown };
    return {
      name: typeof record.name === "string" ? record.name : "",
      message: typeof record.message === "string"
        ? record.message
        : String(record.message ?? ""),
    };
  }
  return { name: "", message: String(error ?? "") };
}

/**
 * True for expected offline / connectivity failures that should not be
 * captured as Sentry exceptions (breadcrumb/warn is enough).
 */
export function isBenignConnectivityError(error: unknown): boolean {
  const { name, message } = getErrorParts(error);

  if (
    message ===
      "Unable to connect. Check your internet connection and try again." ||
    message === "Request timed out. Check your connection and try again." ||
    message.includes("Network request failed") ||
    message.includes("Failed to fetch")
  ) {
    return true;
  }

  // Classic fetch TypeError with a network-ish message
  if (name === "TypeError" && /network|fetch|internet|connect/i.test(message)) {
    return true;
  }

  return false;
}
