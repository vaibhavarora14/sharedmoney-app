/**
 * Checks if an error indicates session expiration
 */
export function isSessionExpiredError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("unauthorized") ||
    message.includes("not authenticated") ||
    message.includes("session has expired") ||
    message.includes("session expired")
  );
}

/**
 * Maps server error messages to user-friendly messages
 * Centralizes error message handling for consistent UX
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "An unexpected error occurred. Please try again.";
  }

  const message = error.message.toLowerCase();

  // Network/connection errors
  if (message.includes("network") || message.includes("fetch")) {
    return "Unable to connect to the server. Please check your internet connection and try again.";
  }

  // Authentication errors
  if (message.includes("unauthorized") || message.includes("not authenticated")) {
    return "Your session has expired. Please sign in again.";
  }

  // Rate limiting
  if (message.includes("too many requests") || message.includes("rate limit")) {
    return "Too many requests. Please wait a moment and try again.";
  }

  // Prefer actionable email format copy over the generic invalid mapper.
  if (
    message.includes("email") &&
    (message.includes("valid") ||
      message.includes("format") ||
      message.includes("name@example.com"))
  ) {
    return error.message.includes("name@example.com")
      ? error.message
      : "Enter a valid email like name@example.com.";
  }

  // Validation errors
  if (message.includes("invalid") || message.includes("validation")) {
    return "Invalid input. Please check your data and try again.";
  }

  // Not found errors
  if (message.includes("not found") || message.includes("404")) {
    return "The requested resource was not found.";
  }

  // Permission errors
  if (message.includes("forbidden") || message.includes("permission") || message.includes("403")) {
    return "You don't have permission to perform this action.";
  }

  // Server errors
  if (message.includes("500") || message.includes("internal server error")) {
    return "A server error occurred. Please try again later.";
  }

  // Business logic errors (keep original message if it's user-friendly)
  if (
    message.includes("last owner") ||
    message.includes("already a member") ||
    message.includes("already exists")
  ) {
    return error.message; // These are already user-friendly
  }

  // Default: return sanitized original message
  return error.message;
}
