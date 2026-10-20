/**
 * Local design-review preview for WhatsApp OTP screens (mobile width).
 *
 *   EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN=true \
 *   EXPO_PUBLIC_WHATSAPP_OTP_UI_PREVIEW=phone|otp|phone-sending|otp-verifying|otp-wrong|otp-expired|otp-locked|phone-not-whatsapp|methods \
 *   npx expo start --web
 *
 * Never set these in Production store/OTA builds.
 */
import React, { useMemo } from "react";
import { View } from "react-native";
import { PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./contexts/AuthContext";
import {
  PreviewAuthScreen,
  type PreviewStep,
  type PreviewWhatsAppLoading,
  type WhatsAppOtpPreviewScreenProps,
} from "./screens/WhatsAppOtpPreviewScreen";
import { lightTheme } from "./theme";

function resolvePreviewProps(): WhatsAppOtpPreviewScreenProps {
  const raw = process.env.EXPO_PUBLIC_WHATSAPP_OTP_UI_PREVIEW?.trim() || "phone";

  switch (raw) {
    case "methods":
      return { initialStep: "methods" };
    case "phone":
      return { initialStep: "phone" };
    case "otp":
      return { initialStep: "otp", resendSeconds: 30 };
    case "phone-sending":
      return { initialStep: "phone", whatsAppLoading: "send" };
    case "otp-verifying":
      return { initialStep: "otp", whatsAppLoading: "verify", resendSeconds: 30 };
    case "otp-wrong":
      return {
        initialStep: "otp",
        formError: "Incorrect code. Try again.",
        resendSeconds: 30,
      };
    case "otp-expired":
      return {
        initialStep: "otp",
        formError: "This code has expired. Request a new one.",
        resendSeconds: 0,
      };
    case "otp-locked":
      return {
        initialStep: "otp",
        formError: "Too many incorrect attempts. Request a new code.",
        resendSeconds: 0,
      };
    case "phone-not-whatsapp":
      return {
        initialStep: "phone",
        formError:
          "Could not send WhatsApp code. Confirm the number is a Meta test recipient and try again.",
      };
    default: {
      const step: PreviewStep =
        raw === "phone" || raw === "otp" || raw === "methods" ? raw : "phone";
      const loading: PreviewWhatsAppLoading = null;
      return { initialStep: step, whatsAppLoading: loading };
    }
  }
}

export default function WhatsAppOtpPreviewApp() {
  const theme = useMemo(() => lightTheme, []);
  const preview = resolvePreviewProps();

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <AuthProvider>
          <View
            style={{
              flex: 1,
              width: "100%",
              maxWidth: 390,
              alignSelf: "center",
              backgroundColor: theme.colors.background,
            }}
          >
            <PreviewAuthScreen {...preview} />
          </View>
        </AuthProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
