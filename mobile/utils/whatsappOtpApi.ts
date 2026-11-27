import { APP_VERSION } from "../constants/version";
import { formatNetworkErrorMessage } from "./networkErrors";
import {
  parseWhatsAppOtpFailure,
  WhatsAppOtpApiError,
  type WhatsAppOtpErrorBody,
} from "./whatsappOtpApiError";

export {
  isWhatsAppOtpErrorCode,
  parseRetryAfterSeconds,
  parseWhatsAppOtpFailure,
  resolveWhatsAppOtpErrorCode,
  WHATSAPP_OTP_ERROR_CODES,
  WhatsAppOtpApiError,
} from "./whatsappOtpApiError";
export type {
  WhatsAppOtpErrorBody,
  WhatsAppOtpErrorCode,
} from "./whatsappOtpApiError";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export interface WhatsAppOtpSendResult {
  sent: boolean;
  delivery: "text" | "template";
  expires_in: number;
  resend_after: number;
}

export interface WhatsAppOtpSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface WhatsAppOtpVerifyResult {
  verified: boolean;
  session: WhatsAppOtpSession;
  user: {
    id: string;
    phone: string | null;
    email: string | null;
  };
}

function isTimeoutNetworkFailure(errorName: string, errorMessage: string): boolean {
  return (
    errorMessage.toLowerCase().includes("timeout") ||
    errorName === "TimeoutError" ||
    errorName === "AbortError"
  );
}

async function postWhatsAppOtp(body: Record<string, unknown>): Promise<unknown> {
  if (!API_URL) {
    throw new WhatsAppOtpApiError(
      "Unable to connect to the server. Please check your app configuration and try again.",
      "NETWORK_ERROR",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/whatsapp-otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Version": APP_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (networkError: unknown) {
    const err = networkError as { name?: string; message?: string };
    const errorName = err?.name || "Unknown";
    const errorMessage = err?.message || "Network request failed";
    throw new WhatsAppOtpApiError(
      formatNetworkErrorMessage({
        apiUrl: API_URL,
        errorName,
        errorMessage,
        isDevelopment: __DEV__,
      }),
      isTimeoutNetworkFailure(errorName, errorMessage)
        ? "TIMEOUT_ERROR"
        : "NETWORK_ERROR",
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errBody = (payload && typeof payload === "object"
      ? payload
      : null) as WhatsAppOtpErrorBody | null;
    throw parseWhatsAppOtpFailure(response.status, errBody);
  }

  return payload;
}

export async function sendWhatsAppOtp(phoneE164: string): Promise<WhatsAppOtpSendResult> {
  return (await postWhatsAppOtp({
    action: "send",
    phone: phoneE164,
  })) as WhatsAppOtpSendResult;
}

export async function verifyWhatsAppOtp(
  phoneE164: string,
  code: string,
): Promise<WhatsAppOtpVerifyResult> {
  return (await postWhatsAppOtp({
    action: "verify",
    phone: phoneE164,
    code,
  })) as WhatsAppOtpVerifyResult;
}
