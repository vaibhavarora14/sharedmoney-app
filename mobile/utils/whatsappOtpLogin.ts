/**
 * Client gate for WhatsApp OTP phone login.
 * Must be exactly "true". Production builds leave this unset → entry hidden.
 *
 * Default path must read `process.env.EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN`
 * as a direct member access so Expo/Metro can inline it into the web bundle.
 * Passing `process.env` as an object and reading `env.EXPO_PUBLIC_…` is not
 * rewritten and stays empty at runtime (`process.env` ≈ `{ NODE_ENV }` on web).
 */
export function isWhatsAppOtpLoginEnabled(
  env?: Record<string, string | undefined>,
): boolean {
  const value = env
    ? env.EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN
    : process.env.EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN;
  return value === "true";
}
