/**
 * Static mobile-width preview of WhatsApp OTP login screens for design review.
 * Driven by EXPO_PUBLIC_WHATSAPP_OTP_UI_PREVIEW (see WhatsAppOtpPreviewApp).
 */
import React from "react";
import { AuthScreen } from "./AuthScreen";
import { WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS } from "../utils/phoneDisplay";

export type PreviewStep = "methods" | "phone" | "otp";
export type PreviewWhatsAppLoading = "send" | "verify" | null;

export interface WhatsAppOtpPreviewScreenProps {
  initialStep: PreviewStep;
  formError?: string | null;
  whatsAppLoading?: PreviewWhatsAppLoading;
  resendSeconds?: number;
  phoneE164?: string;
}

export function PreviewAuthScreen({
  initialStep,
  formError = null,
  whatsAppLoading = null,
  resendSeconds,
  phoneE164 = "+919876543210",
}: WhatsAppOtpPreviewScreenProps) {
  return (
    <AuthScreen
      isSignUp={false}
      onToggleMode={() => {}}
      previewInitialStep={initialStep}
      previewPhoneE164={phoneE164}
      previewFormError={formError}
      previewWhatsAppLoading={whatsAppLoading}
      previewResendSeconds={
        resendSeconds ??
        (initialStep === "otp" ? WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS : undefined)
      }
    />
  );
}
