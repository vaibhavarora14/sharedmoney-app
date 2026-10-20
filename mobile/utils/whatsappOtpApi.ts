import { APP_VERSION } from "../constants/version";
import { formatNetworkErrorMessage } from "./networkErrors";

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

export type WhatsAppOtpErrorCode =
  | "WHATSAPP_SEND_FAILED"
  | "OTP_MISMATCH"
  | "OTP_EXPIRED"
  | "OTP_LOCKED"
  | "OTP_INVALID"
  | "RATE_LIMITED"
  | "FEATURE_DISABLED"
  | "VALIDATION_ERROR"
  | string;

export class WhatsAppOtpApiError extends Error {
  readonly code: WhatsAppOtpErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    code: WhatsAppOtpErrorCode,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "WhatsAppOtpApiError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseRetryAfterSeconds(details: string | undefined): number | undefined {
  if (!details) return undefined;
  const match = /retry_after=(\d+)/i.exec(details);
  if (!match) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : undefined;
}

async function postWhatsAppOtp(body: Record<string, unknown>): Promise<unknown> {
  if (!API_URL) {
    throw new Error(
      "Unable to connect to the server. Please check your app configuration and try again.",
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
    throw new Error(
      formatNetworkErrorMessage({
        apiUrl: API_URL,
        errorName: err?.name || "Unknown",
        errorMessage: err?.message || "Network request failed",
        isDevelopment: __DEV__,
      }),
    );
  }

  type ErrorBody = { error?: string; code?: string; details?: string };
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errBody = (payload && typeof payload === "object"
      ? payload
      : {}) as ErrorBody;
    if (response.status === 404 || errBody.code === "FEATURE_DISABLED") {
      throw new WhatsAppOtpApiError(
        "WhatsApp login is not available in this build.",
        "FEATURE_DISABLED",
      );
    }
    const code = errBody.code || `HTTP_${response.status}`;
    const message =
      errBody.error || `Request failed (${response.status})`;
    throw new WhatsAppOtpApiError(
      message,
      code,
      parseRetryAfterSeconds(errBody.details),
    );
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
