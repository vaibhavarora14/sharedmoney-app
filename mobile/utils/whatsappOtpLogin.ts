/**
 * Client gate for WhatsApp OTP phone login.
 * Must be exactly "true". Production builds leave this unset → entry hidden.
 */
export function isWhatsAppOtpLoginEnabled(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  return env.EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN === "true";
}
