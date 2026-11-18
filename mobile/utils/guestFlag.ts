import AsyncStorage from "@react-native-async-storage/async-storage";
import { readFlagOverride } from "./guestMode";

const FLAG_ID_KEY = "sharedmoney.guestFlagDistinctId";

export function guestModeOverride(): boolean | null {
  return readFlagOverride(process.env.EXPO_PUBLIC_GUEST_MODE);
}

export function guestCleanupOverride(): boolean | null {
  return readFlagOverride(process.env.EXPO_PUBLIC_GUEST_CLEANUP);
}

async function distinctId(): Promise<string> {
  const existing = await AsyncStorage.getItem(FLAG_ID_KEY);
  if (existing) return existing;
  const created = `guest-flag-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  await AsyncStorage.setItem(FLAG_ID_KEY, created);
  return created;
}

/**
 * PostHog boolean flag. Missing key, network, or flag evaluates to false.
 */
export async function evaluateRemoteGuestFlag(key: "guest_mode" | "guest_cleanup"): Promise<boolean> {
  const token = process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim();
  if (!token) return false;
  const host = (process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/$/, "");
  try {
    const response = await fetch(`${host}/flags?v=2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: token,
        distinct_id: await distinctId(),
        person_properties: {},
      }),
    });
    if (!response.ok) return false;
    const payload = await response.json() as {
      errorsWhileComputingFlags?: boolean;
      flags?: Record<string, { enabled?: unknown }>;
    };
    if (payload.errorsWhileComputingFlags) return false;
    return payload.flags?.[key]?.enabled === true;
  } catch {
    return false;
  }
}
