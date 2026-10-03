import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SettleHandoffDetails } from "./settleHandoff";

const STORAGE_KEY = "sharedmoney:settle-handoff:v1";

type StoredSettleHandoffDetails = Record<string, SettleHandoffDetails>;

async function readAll(): Promise<StoredSettleHandoffDetails> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function loadSettleHandoffDetails(
  key: string,
): Promise<SettleHandoffDetails> {
  const all = await readAll();
  return all[key] ?? {};
}

export async function saveSettleHandoffDetails(
  key: string,
  details: SettleHandoffDetails,
): Promise<void> {
  const all = await readAll();
  all[key] = details;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
