import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { resolveGroupDetailsLoadingTreatment } from "./groupDetailsLoadingTreatment.ts";

Deno.test("group details loading treatment keeps balances banner as the only loader", () => {
  const treatment = resolveGroupDetailsLoadingTreatment({
    balancesLoading: true,
    balancesError: false,
    listDataLoading: true,
    listContentEmpty: true,
    listRefreshing: true,
    fetchingNextPage: true,
  });

  assertEquals(treatment, {
    showBalancesUpdatingBanner: true,
    showListInitialLoader: false,
    showListEmptyState: false,
    showRefreshControlLoader: false,
    showFooterLoader: false,
  });
});

Deno.test("group details loading treatment falls back to the list shell when balances are settled", () => {
  const treatment = resolveGroupDetailsLoadingTreatment({
    balancesLoading: false,
    balancesError: false,
    listDataLoading: true,
    listContentEmpty: true,
    listRefreshing: false,
    fetchingNextPage: false,
  });

  assertEquals(treatment, {
    showBalancesUpdatingBanner: false,
    showListInitialLoader: true,
    showListEmptyState: false,
    showRefreshControlLoader: false,
    showFooterLoader: false,
  });
});

Deno.test("group details loading treatment allows list refresh and pagination without balance loading", () => {
  const treatment = resolveGroupDetailsLoadingTreatment({
    balancesLoading: false,
    balancesError: false,
    listDataLoading: false,
    listContentEmpty: false,
    listRefreshing: true,
    fetchingNextPage: true,
  });

  assertEquals(treatment, {
    showBalancesUpdatingBanner: false,
    showListInitialLoader: false,
    showListEmptyState: false,
    showRefreshControlLoader: true,
    showFooterLoader: true,
  });
});

Deno.test("group details suppresses empty copy until both ledger sources finish", () => {
  for (const [txLoading, settlementsLoading] of [[true, true], [true, false], [false, true]]) {
    for (const balancesLoading of [true, false]) {
      const treatment = resolveGroupDetailsLoadingTreatment({
        balancesLoading,
        balancesError: false,
        listDataLoading: txLoading || settlementsLoading,
        listContentEmpty: true,
        listRefreshing: false,
        fetchingNextPage: false,
      });

      assertEquals(treatment.showListEmptyState, false);
      assertEquals(treatment.showBalancesUpdatingBanner, balancesLoading);
      assertEquals(treatment.showListInitialLoader, !balancesLoading);
    }
  }
});

Deno.test("group details keeps loaded rows visible while other requests finish", () => {
  for (const listDataLoading of [true, false]) {
    for (const balancesLoading of [true, false]) {
      const treatment = resolveGroupDetailsLoadingTreatment({
        balancesLoading,
        balancesError: false,
        listDataLoading,
        listContentEmpty: false,
        listRefreshing: false,
        fetchingNextPage: false,
      });

      assertEquals(treatment.showListEmptyState, false);
      assertEquals(treatment.showListInitialLoader, false);
    }
  }
});

Deno.test("group details allows genuine empty and filtered-empty copy after list data loads", () => {
  const treatment = resolveGroupDetailsLoadingTreatment({
    balancesLoading: false,
    balancesError: false,
    listDataLoading: false,
    listContentEmpty: true,
    listRefreshing: false,
    fetchingNextPage: false,
  });

  assertEquals(treatment.showListEmptyState, true);
  assertEquals(treatment.showListInitialLoader, false);
});

Deno.test("group details shows the list loader instead of empty copy when balances fail", () => {
  const treatment = resolveGroupDetailsLoadingTreatment({
    balancesLoading: true,
    balancesError: true,
    listDataLoading: true,
    listContentEmpty: true,
    listRefreshing: false,
    fetchingNextPage: false,
  });

  assertEquals(treatment.showBalancesUpdatingBanner, false);
  assertEquals(treatment.showListInitialLoader, true);
  assertEquals(treatment.showListEmptyState, false);
});
