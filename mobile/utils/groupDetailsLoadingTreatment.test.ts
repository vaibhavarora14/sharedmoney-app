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
    showRefreshControlLoader: true,
    showFooterLoader: true,
  });
});
