/**
 * Static mobile-width preview of WhatsApp OTP login screens for design review.
 * Driven by EXPO_PUBLIC_WHATSAPP_OTP_UI_PREVIEW=methods|phone|otp.
 * Uses the same AuthScreen component (flag must be on).
 */
import React from "react";
import { AuthScreen } from "./AuthScreen";

type PreviewStep = "methods" | "phone" | "otp";

interface WhatsAppOtpPreviewScreenProps {
  initialStep: PreviewStep;
}

export function PreviewAuthScreen({ initialStep }: WhatsAppOtpPreviewScreenProps) {
  return (
    <AuthScreen
      isSignUp={false}
      onToggleMode={() => {}}
      previewInitialStep={initialStep}
      previewPhoneE164="+919876543210"
    />
  );
}
