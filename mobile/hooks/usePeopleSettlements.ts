import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getDefaultCurrency } from "../utils/currency";
import { groupSettingsFromGroup, overrideMapFromResponse } from "../utils/rateBook";
import {
  clubPersonSettlements,
  groupContextsFromBalances,
  personSettlementHeadline,
  settlementSummary,
  type PersonSettlement,
  type PersonSettlementHeadline,
} from "../utils/peopleSettlements";
import { useBalances } from "./useBalances";
import { fetchRates, useCurrencyPreferences } from "./useCurrencyPreferences";
import { useGroups } from "./useGroups";
import { queryKeys } from "./queryKeys";

export type PersonSettlementView = PersonSettlement & {
  headline: PersonSettlementHeadline;
};

export type UsePeopleSettlementsOptions = {
  /**
   * When false, skip the heavy global /balances fetch (and rate fan-out).
   * Home defers this until after first paint; Settlements tab enables immediately.
   */
  enabled?: boolean;
};

export function usePeopleSettlements(options?: UsePeopleSettlementsOptions) {
  const { user } = useAuth();
  const enabled = options?.enabled !== false;
  const groupsQuery = useGroups();
  const balancesQuery = useBalances(undefined, { enabled });
  const currency = useCurrencyPreferences();

  const unifyGroupIds = useMemo(() => {
    if (!enabled) return [] as string[];
    const fallback = currency.preferredCurrency || getDefaultCurrency();
    const groupById = new Map(groupsQuery.data.map((group) => [group.id, group]));
    const ids: string[] = [];
    for (const groupBalance of balancesQuery.data.group_balances) {
      const stored = currency.prefs.groups[groupBalance.group_id];
      const group = groupById.get(groupBalance.group_id);
      const settings = stored || groupSettingsFromGroup(group, fallback);
      if (settings.enabled === true) ids.push(groupBalance.group_id);
    }
    return ids;
  }, [
    enabled,
    balancesQuery.data.group_balances,
    groupsQuery.data,
    currency.prefs.groups,
    currency.preferredCurrency,
  ]);

  const groupRateQueries = useQueries({
    queries: unifyGroupIds.map((groupId) => ({
      queryKey: queryKeys.groupRates(groupId),
      queryFn: () => fetchRates(groupId),
      enabled: !!user?.id && enabled,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const groupRatesFingerprint = groupRateQueries
    .map((query) => `${query.dataUpdatedAt}:${query.fetchStatus}:${query.status}`)
    .join("|");

  const groupCustomRates = useMemo(() => {
    const rates: Record<string, Record<string, number>> = {};
    unifyGroupIds.forEach((groupId, index) => {
      const response = groupRateQueries[index]?.data;
      if (response) {
        rates[groupId] = overrideMapFromResponse(response);
        return;
      }
      const local = currency.prefs.groups[groupId]?.customRates;
      if (local && Object.keys(local).length > 0) {
        rates[groupId] = local;
      }
    });
    return rates;
    // groupRateQueries is intentionally read via fingerprint; list identity changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifyGroupIds, groupRatesFingerprint, currency.prefs.groups]);

  const ratesPending = unifyGroupIds.some((groupId, index) => {
    const query = groupRateQueries[index];
    if (!query) return false;
    if (query.data) return false;
    if (currency.prefs.groups[groupId]?.customRates
      && Object.keys(currency.prefs.groups[groupId]!.customRates).length > 0) {
      return false;
    }
    return query.isLoading || query.isFetching;
  });

  const people = useMemo(() => {
    if (!enabled || !user?.id) return [] as PersonSettlementView[];
    const contexts = groupContextsFromBalances({
      groupBalances: balancesQuery.data.group_balances,
      groups: groupsQuery.data,
      prefsGroups: currency.prefs.groups,
      marketBook: currency.rateBook,
      preferredCurrency: currency.preferredCurrency,
      defaultCurrency: getDefaultCurrency(),
      groupCustomRates,
    });
    return clubPersonSettlements(contexts, user.id).map((person) => ({
      ...person,
      headline: personSettlementHeadline(
        person,
        currency.preferredCurrency,
        currency.rateBook
      ),
    }));
  }, [
    enabled,
    user?.id,
    balancesQuery.data.group_balances,
    groupsQuery.data,
    currency.prefs.groups,
    currency.rateBook,
    currency.preferredCurrency,
    groupCustomRates,
  ]);

  const summary = useMemo(() => settlementSummary(people), [people]);

  return {
    people,
    summary,
    preferredCurrency: currency.preferredCurrency,
    isLoading: (
      enabled &&
      ((groupsQuery.isLoading || balancesQuery.isLoading || ratesPending)
        && people.length === 0)
    ),
    isFetching: enabled && (groupsQuery.isFetching
      || balancesQuery.isFetching
      || groupRateQueries.some((query) => query.isFetching)),
    error: groupsQuery.error || balancesQuery.error,
    refetch: async () => {
      await Promise.all([
        groupsQuery.refetch(),
        balancesQuery.refetch(),
        ...groupRateQueries.map((query) => query.refetch()),
      ]);
    },
  };
}
