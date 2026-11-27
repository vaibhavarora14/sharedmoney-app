import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { mapAuthFailureReason } from "./authFunnelEvents";
import { getSentryRuntimeTags } from "./sentryDiagnostics";
import {
  buildWhatsAppOtpFailureTelemetry,
  type WhatsAppOtpFailureStep,
} from "./whatsappOtpErrors";

function runtimeTags(): Record<string, string> {
  const buildNumber =
    Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.buildNumber
      : Constants.expoConfig?.android?.versionCode?.toString();
  return getSentryRuntimeTags({
    isDevice: Device.isDevice,
    buildProfile: Constants.expoConfig?.extra?.buildProfile,
    release: Constants.expoConfig?.version,
    buildNumber,
    platform: Platform.OS,
  });
}

/**
 * Report a WhatsApp OTP send/verify failure to Sentry as a handled event.
 * Payloads are step, HTTP status, error code/message, and app version only —
 * never phone numbers, OTPs, or tokens.
 */
export function recordWhatsAppOtpFailure(input: {
  step: WhatsAppOtpFailureStep;
  error: unknown;
}): void {
  try {
    const reasonCode = mapAuthFailureReason(input.error);
    const appVersion = Constants.expoConfig?.version || "unknown";
    const telemetry = buildWhatsAppOtpFailureTelemetry({
      step: input.step,
      error: input.error,
      reasonCode,
      runtimeTags: runtimeTags(),
      appVersion,
    });
    Sentry.captureMessage(telemetry.message, {
      level: telemetry.level,
      fingerprint: telemetry.fingerprint,
      tags: telemetry.tags,
      extra: telemetry.extra,
    });
  } catch {
    // Telemetry must never break sign-in.
  }
}
