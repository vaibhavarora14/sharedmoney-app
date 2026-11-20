import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Alert, Linking, Platform } from "react-native";
import { STORE_URL_ANDROID, STORE_URL_IOS } from "../constants/storeUrls";
import {
  maybePromptAppUpdateAfterExpense as maybePromptAppUpdateAfterExpenseLogic,
  type InAppUpdatePromptDependencies,
  type MaybePromptAppUpdateInput,
  type UpdatePromptChoice,
} from "./inAppUpdatePromptLogic";
import { captureIdentifiedAnalyticsEvent } from "./posthogAnalytics";
import { ANALYTICS_EVENTS } from "./posthogEvents";

export type {
  InAppUpdatePromptDependencies,
  MaybePromptAppUpdateInput,
} from "./inAppUpdatePromptLogic";

function defaultStoreUrl(platform: string): string {
  return platform === "android" ? STORE_URL_ANDROID : STORE_URL_IOS;
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`store lookup failed: ${response.status}`);
  }
  return await response.text();
}

function defaultPresentPrompt(input: {
  title: string;
  message: string;
}): Promise<UpdatePromptChoice> {
  return new Promise((resolve) => {
    Alert.alert(input.title, input.message, [
      { text: "Not now", style: "cancel", onPress: () => resolve("later") },
      { text: "Update", onPress: () => resolve("update") },
    ]);
  });
}

function defaultDependencies(
  overrides: Partial<InAppUpdatePromptDependencies> = {},
): InAppUpdatePromptDependencies {
  const platform = overrides.platform ?? Platform.OS;
  return {
    platform,
    currentVersion:
      overrides.currentVersion ?? Application.nativeApplicationVersion,
    storage: overrides.storage ?? AsyncStorage,
    storeUrl: overrides.storeUrl ?? defaultStoreUrl(platform),
    inOnboarding: overrides.inOnboarding ?? false,
    settleDelayMs: overrides.settleDelayMs,
    schedule: overrides.schedule ?? setTimeout,
    fetchText: overrides.fetchText ?? defaultFetchText,
    presentPrompt: overrides.presentPrompt ?? defaultPresentPrompt,
    openStoreUrl:
      overrides.openStoreUrl ??
      (async (url: string) => {
        await Linking.openURL(url);
      }),
    captureEvent: overrides.captureEvent ?? captureIdentifiedAnalyticsEvent,
    promptShownEvent:
      overrides.promptShownEvent ?? ANALYTICS_EVENTS.APP_UPDATE_PROMPT_SHOWN,
    updateStartedEvent:
      overrides.updateStartedEvent ?? ANALYTICS_EVENTS.APP_UPDATE_STARTED,
  };
}

/**
 * After a successful expense create, maybe show a once-per-version update
 * prompt. Returns true when a prompt was scheduled (skip the review prompt).
 */
export async function maybePromptAppUpdateAfterExpense(
  input: MaybePromptAppUpdateInput,
  deps: Partial<InAppUpdatePromptDependencies> = {},
): Promise<boolean> {
  return maybePromptAppUpdateAfterExpenseLogic(input, defaultDependencies(deps));
}
