import { Platform } from "react-native";
import { shouldRequestGuestCaptcha } from "./guestMode";

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      size: "invisible";
      callback: (token: string) => void;
      "error-callback": () => void;
    },
  ) => void;
}

function turnstileApi(): TurnstileApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { turnstile?: TurnstileApi }).turnstile;
}

function loadTurnstile(): Promise<void> {
  if (turnstileApi()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${TURNSTILE_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Captcha failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Captcha failed to load"));
    document.head.appendChild(script);
  });
}

/**
 * Invisible Turnstile token for anonymous sign-in on web.
 * Returns undefined when no site key is configured, so local and native
 * sign-in are unchanged until the owner sets EXPO_PUBLIC_TURNSTILE_SITE_KEY.
 */
export async function anonymousCaptchaToken(): Promise<string | undefined> {
  const siteKey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  if (!shouldRequestGuestCaptcha(siteKey, Platform.OS) || typeof document === "undefined") {
    return undefined;
  }
  await loadTurnstile();
  const turnstile = turnstileApi();
  if (!turnstile) throw new Error("Captcha failed to load");
  return new Promise((resolve, reject) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    turnstile.render(host, {
      sitekey: siteKey!.trim(),
      size: "invisible",
      callback: (token) => {
        host.remove();
        resolve(token);
      },
      "error-callback": () => {
        host.remove();
        reject(new Error("Captcha failed"));
      },
    });
  });
}
