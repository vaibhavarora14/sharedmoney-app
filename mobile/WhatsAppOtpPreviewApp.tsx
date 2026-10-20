/**
 * Local design-review preview for WhatsApp OTP screens (mobile width).
 *
 *   EXPO_PUBLIC_ENABLE_WHATSAPP_OTP_LOGIN=true \
 *   EXPO_PUBLIC_WHATSAPP_OTP_UI_PREVIEW=phone \
 *   npx expo start --web
 *
 * Never set these in Production store/OTA builds.
 */
import React, { useMemo } from "react";
import { View } from "react-native";
import { PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./contexts/AuthContext";
import { PreviewAuthScreen } from "./screens/WhatsAppOtpPreviewScreen";
import { lightTheme } from "./theme";

type PreviewStep = "methods" | "phone" | "otp";

function resolvePreviewStep(): PreviewStep {
  const raw = process.env.EXPO_PUBLIC_WHATSAPP_OTP_UI_PREVIEW?.trim();
  if (raw === "phone" || raw === "otp" || raw === "methods") return raw;
  return "phone";
}

export default function WhatsAppOtpPreviewApp() {
  const theme = useMemo(() => lightTheme, []);
  const step = resolvePreviewStep();

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
            <PreviewAuthScreen initialStep={step} />
          </View>
        </AuthProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
