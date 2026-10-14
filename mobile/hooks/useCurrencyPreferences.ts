import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Group, GroupWithMembers } from "../types";
import { fetchWithAuth } from "../utils/api";
import { getDefaultCurrency } from "../utils/currency";
import { type RateBook, type RateSource } from "../utils/currencyMerge";
import { logError } from "../utils/logger";
import { shouldReportRatesFetchError } from "../utils/sentryTriagePolicy";
import {
  groupSettingsFromGroup,
  overrideMapFromResponse,
  rateBookFromResponse,
  resolveRateBook,
  type RatesResponse,
} from "../utils/rateBook";
import { queryKeys } from "./queryKeys";
import { fetchGroupDetails, useGroups } from "./useGroups";
import { type Profile, useProfile } from "./useProfile";

const STORAGE_KEY = "currency-merge-preferences-v1";

export type GroupCurrencySettings = {
  enabled: boolean;
  settlementCurrency: string;
  customRates: Record<string, number>;
};

export type CurrencyPreferences = {
  preferredCurrency: string;
  groups: Record<string, GroupCurrencySettings>;
};

function defaultPreferences(): CurrencyPreferences {
  return {
    preferredCurrency: getDefaultCurrency(),
    groups: {},
  };
}

function normalizePreferences(raw: unknown): CurrencyPreferences {
  const fallback = defaultPreferences();
  if (!raw || typeof raw !== "object") return fallback;

  const value = raw as Partial<CurrencyPreferences>;
  const preferred = typeof value.preferredCurrency === "string"
    ? value.preferredCurrency.toUpperCase()
    : fallback.preferredCurrency;

  const groups: Record<string, GroupCurrencySettings> = {};
  if (value.groups && typeof value.groups === "object") {
    for (const [groupId, settings] of Object.entries(value.groups)) {
      if (!settings || typeof settings !== "object") continue;
      groups[groupId] = {
        enabled: settings.enabled === true,
        settlementCurrency: (settings.settlementCurrency || preferred).toUpperCase(),
        customRates: settings.customRates && typeof settings.customRates === "object"
          ? Object.fromEntries(
              Object.entries(settings.customRates).filter(([, rate]) =>
                Number.isFinite(rate) && (rate as number) > 0
              )
            )
          : {},
      };
    }
  }

  return { preferredCurrency: preferred, groups };
}

let memoryCache: CurrencyPreferences | null = null;
const listeners = new Set<(prefs: CurrencyPreferences) => void>();

async function readPreferences(): Promise<CurrencyPreferences> {
  if (memoryCache) return memoryCache;
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    memoryCache = stored ? normalizePreferences(JSON.parse(stored)) : defaultPreferences();
  } catch {
    memoryCache = defaultPreferences();
  }
  return memoryCache;
}

async function writePreferences(next: CurrencyPreferences): Promise<void> {
  memoryCache = next;
  listeners.forEach((listener) => listener(next));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function getGroupCurrencySettings(
  prefs: CurrencyPreferences,
  groupId: string | undefined
): GroupCurrencySettings | null {
  if (!groupId) return null;
  return prefs.groups[groupId] || null;
}

export function buildGroupRateBook(
  settings: GroupCurrencySettings | null | undefined,
  market?: RateBook
): RateBook {
  return resolveRateBook(market, settings?.customRates || {});
}

export async function fetchRates(groupId?: string): Promise<RatesResponse | null> {
  try {
    const path = groupId
      ? `/rates?group_id=${encodeURIComponent(groupId)}`
      : "/rates";
    const response = await fetchWithAuth(path);
    return await response.json();
  } catch (error) {
    if (!shouldReportRatesFetchError(error)) return null;
    logError(error instanceof Error ? error : new Error(String(error)), {
      context: "Fetch exchange rates",
      groupId,
    });
    return null;
  }
}

function sameRateMap(
  left: Record<string, number> | undefined,
  right: Record<string, number>
): boolean {
  const leftKeys = Object.keys(left || {});
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return rightKeys.every((key) => left?.[key] === right[key]);
}

function isMissingEndpointError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("method not allowed") ||
    message.includes("preferred_currency") ||
    message.includes("settlement_currency") ||
    message.includes("unify_balances")
  );
}

export function useCurrencyPreferences(groupId?: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [prefs, setPrefs] = useState<CurrencyPreferences>(
    () => memoryCache || defaultPreferences()
  );
  const [ready, setReady] = useState(Boolean(memoryCache));

  useEffect(() => {
    let mounted = true;
    readPreferences().then((value) => {
      if (mounted) {
        setPrefs(value);
        setReady(true);
      }
    });
    const listener = (value: CurrencyPreferences) => setPrefs(value);
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback(async (
    updater: (current: CurrencyPreferences) => CurrencyPreferences
  ) => {
    const current = await readPreferences();
    const next = updater(current);
    await writePreferences(next);
    return next;
  }, []);

  const { data: profile } = useProfile();
  const { data: groups } = useGroups();
  const groupDetailsQuery = useQuery({
    queryKey: groupId ? queryKeys.group(groupId) : queryKeys.group(""),
    queryFn: () => fetchGroupDetails(groupId as string),
    enabled: false,
  });
  const groupFromServer = groupDetailsQuery.data
    || groups.find((group) => group.id === groupId)
    || null;

  const marketRatesQuery = useQuery({
    queryKey: queryKeys.marketRates,
    queryFn: () => fetchRates(),
    enabled: !!user?.id,
    staleTime: 60 * 60 * 1000,
  });

  const unifyEnabled = groupFromServer?.unify_balances === true
    || (groupId ? prefs.groups[groupId]?.enabled === true : false);

  const groupRatesQuery = useQuery({
    queryKey: groupId ? queryKeys.groupRates(groupId) : queryKeys.marketRates,
    queryFn: () => fetchRates(groupId),
    enabled: !!user?.id && !!groupId && unifyEnabled,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const preferred = profile?.preferred_currency?.toUpperCase();
    if (!preferred) return;
    void update((current) => (
      current.preferredCurrency === preferred
        ? current
        : { ...current, preferredCurrency: preferred }
    ));
  }, [profile?.preferred_currency, update]);

  useEffect(() => {
    if (!groupId || !groupFromServer) return;
    const enabled = groupFromServer.unify_balances === true;
    const settlementCurrency = (
      groupFromServer.settlement_currency || prefs.preferredCurrency
    ).toUpperCase();
    void update((current) => {
      const existing = current.groups[groupId];
      if (
        existing &&
        existing.enabled === enabled &&
        existing.settlementCurrency === settlementCurrency
      ) {
        return current;
      }
      return {
        ...current,
        groups: {
          ...current.groups,
          [groupId]: {
            enabled,
            settlementCurrency,
            customRates: existing?.customRates || {},
          },
        },
      };
    });
  }, [
    groupId,
    groupFromServer?.unify_balances,
    groupFromServer?.settlement_currency,
    prefs.preferredCurrency,
    update,
  ]);

  const persistPreferredCurrency = useMutation({
    mutationFn: async (currency: string) => {
      const response = await fetchWithAuth("/profile", {
        method: "PUT",
        body: JSON.stringify({ preferred_currency: currency }),
      });
      return response.json() as Promise<Profile>;
    },
    onSuccess: (updatedProfile) => {
      queryClient.setQueryData(queryKeys.profile(user?.id ?? null), updatedProfile);
    },
    onError: (error) => {
      if (!isMissingEndpointError(error)) {
        logError(error instanceof Error ? error : new Error(String(error)), {
          context: "Save preferred currency",
        });
      }
    },
  });

  const persistGroupSettings = useMutation({
    mutationFn: async (variables: {
      id: string;
      enabled: boolean;
      settlementCurrency: string;
    }) => {
      const response = await fetchWithAuth(`/groups/${variables.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          settlement_currency: variables.settlementCurrency,
          unify_balances: variables.enabled,
        }),
      });
      return response.json() as Promise<Group>;
    },
    onSuccess: (group, variables) => {
      queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
        (current || []).map((item) => item.id === group.id ? { ...item, ...group } : item)
      );
      queryClient.setQueryData<GroupWithMembers | null>(queryKeys.group(variables.id), (current) =>
        current ? { ...current, ...group } : current
      );
    },
    onError: (error) => {
      if (!isMissingEndpointError(error)) {
        logError(error instanceof Error ? error : new Error(String(error)), {
          context: "Save group currency settings",
        });
      }
    },
  });

  const persistGroupRate = useMutation({
    mutationFn: async (variables: {
      id: string;
      from: string;
      to: string;
      rate: number;
      source: Exclude<RateSource, "market">;
    }) => {
      const response = await fetchWithAuth("/rates", {
        method: "PUT",
        body: JSON.stringify({
          group_id: variables.id,
          from: variables.from,
          to: variables.to,
          rate: variables.rate,
          source: variables.source,
        }),
      });
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groupRates(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.marketRates });
    },
    onError: (error) => {
      if (!isMissingEndpointError(error)) {
        logError(error instanceof Error ? error : new Error(String(error)), {
          context: "Save group exchange rate",
        });
      }
    },
  });

  const deleteGroupRate = useMutation({
    mutationFn: async (variables: { id: string; from: string; to: string }) => {
      await fetchWithAuth(
        `/rates?group_id=${encodeURIComponent(variables.id)}&from=${encodeURIComponent(variables.from)}&to=${encodeURIComponent(variables.to)}`,
        { method: "DELETE" }
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groupRates(variables.id) });
    },
    onError: (error) => {
      if (!isMissingEndpointError(error)) {
        logError(error instanceof Error ? error : new Error(String(error)), {
          context: "Clear group exchange rate",
        });
      }
    },
  });

  // Keep local prefs in sync with the shared group rate book so the Settlements
  // tab (which has no groupId) sees the same THB→INR override as the group page.
  useEffect(() => {
    if (!groupId || !groupRatesQuery.data) return;
    if (persistGroupRate.isPending || deleteGroupRate.isPending) return;
    const serverRates = overrideMapFromResponse(groupRatesQuery.data);
    void update((current) => {
      const existing = current.groups[groupId] || {
        enabled: groupFromServer?.unify_balances === true,
        settlementCurrency: (
          groupFromServer?.settlement_currency || current.preferredCurrency
        ).toUpperCase(),
        customRates: {},
      };
      if (sameRateMap(existing.customRates, serverRates)) return current;
      return {
        ...current,
        groups: {
          ...current.groups,
          [groupId]: { ...existing, customRates: serverRates },
        },
      };
    });
  }, [
    groupId,
    groupRatesQuery.data,
    persistGroupRate.isPending,
    deleteGroupRate.isPending,
    groupFromServer?.unify_balances,
    groupFromServer?.settlement_currency,
    update,
  ]);

  const setPreferredCurrency = useCallback(async (currency: string) => {
    const next = currency.toUpperCase();
    await update((current) => ({
      ...current,
      preferredCurrency: next,
    }));
    try {
      await persistPreferredCurrency.mutateAsync(next);
    } catch {
      // Local cache remains the source of truth until the API is available.
    }
  }, [persistPreferredCurrency, update]);

  const setGroupSettings = useCallback(async (
    id: string,
    patch: Partial<GroupCurrencySettings>
  ) => {
    const next = await update((current) => {
      const existing = current.groups[id] || {
        enabled: false,
        settlementCurrency: current.preferredCurrency,
        customRates: {},
      };
      return {
        ...current,
        groups: {
          ...current.groups,
          [id]: {
            ...existing,
            ...patch,
            settlementCurrency: (patch.settlementCurrency || existing.settlementCurrency).toUpperCase(),
            customRates: patch.customRates || existing.customRates,
          },
        },
      };
    });
    const saved = next.groups[id];
    try {
      await persistGroupSettings.mutateAsync({
        id,
        enabled: saved.enabled,
        settlementCurrency: saved.settlementCurrency,
      });
    } catch {
      // Keep the optimistic local setting for offline / pre-deploy APIs.
    }
  }, [persistGroupSettings, update]);

  const setGroupRate = useCallback(async (
    id: string,
    from: string,
    to: string,
    rate: number,
    source: Exclude<RateSource, "market"> = "group"
  ) => {
    await update((current) => {
      const existing = current.groups[id] || {
        enabled: true,
        settlementCurrency: current.preferredCurrency,
        customRates: {},
      };
      return {
        ...current,
        groups: {
          ...current.groups,
          [id]: {
            ...existing,
            customRates: {
              ...existing.customRates,
              [`${from.toUpperCase()}:${to.toUpperCase()}`]: rate,
            },
          },
        },
      };
    });
    try {
      await persistGroupRate.mutateAsync({ id, from, to, rate, source });
    } catch {
      // Sticky local pair until the shared rate book is reachable.
    }
  }, [persistGroupRate, update]);

  const clearGroupRate = useCallback(async (
    id: string,
    from: string,
    to: string
  ) => {
    await update((current) => {
      const existing = current.groups[id];
      if (!existing) return current;
      const nextRates = { ...existing.customRates };
      delete nextRates[`${from.toUpperCase()}:${to.toUpperCase()}`];
      delete nextRates[`${to.toUpperCase()}:${from.toUpperCase()}`];
      return {
        ...current,
        groups: {
          ...current.groups,
          [id]: { ...existing, customRates: nextRates },
        },
      };
    });
    try {
      await deleteGroupRate.mutateAsync({ id, from, to });
    } catch {
      // Local reset still applies for this device.
    }
  }, [deleteGroupRate, update]);

  const storedGroupSettings = groupId
    ? prefs.groups[groupId] || (
      groupFromServer
        ? groupSettingsFromGroup(groupFromServer, prefs.preferredCurrency)
        : null
    )
    : null;
  const useLocalRates = persistGroupRate.isPending
    || deleteGroupRate.isPending
    || !groupRatesQuery.data;
  const customRates = useMemo(
    () => useLocalRates
      ? storedGroupSettings?.customRates || {}
      : overrideMapFromResponse(groupRatesQuery.data),
    [useLocalRates, storedGroupSettings?.customRates, groupRatesQuery.data]
  );
  const groupSettings = storedGroupSettings
    ? { ...storedGroupSettings, customRates }
    : null;

  const marketBook = useMemo(
    () => rateBookFromResponse(
      groupRatesQuery.data
        ? { ...groupRatesQuery.data, overrides: [] }
        : marketRatesQuery.data
    ),
    [groupRatesQuery.data, marketRatesQuery.data]
  );
  const rateBook = useMemo(
    () => resolveRateBook(marketBook, customRates),
    [marketBook, customRates]
  );

  return {
    ready,
    prefs,
    preferredCurrency: prefs.preferredCurrency,
    groupSettings,
    rateBook,
    usingSharedRates: Boolean(marketBook),
    setPreferredCurrency,
    setGroupSettings,
    setGroupRate,
    clearGroupRate,
  };
}
