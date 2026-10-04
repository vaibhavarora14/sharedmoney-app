export interface GroupDetailsLoadingTreatmentInput {
  balancesLoading: boolean;
  balancesError: boolean;
  listDataLoading: boolean;
  listContentEmpty: boolean;
  listRefreshing: boolean;
  fetchingNextPage: boolean;
}

export interface GroupDetailsLoadingTreatment {
  showBalancesUpdatingBanner: boolean;
  showListInitialLoader: boolean;
  showListEmptyState: boolean;
  showRefreshControlLoader: boolean;
  showFooterLoader: boolean;
}

export function resolveGroupDetailsLoadingTreatment({
  balancesLoading,
  balancesError,
  listDataLoading,
  listContentEmpty,
  listRefreshing,
  fetchingNextPage,
}: GroupDetailsLoadingTreatmentInput): GroupDetailsLoadingTreatment {
  const showBalancesUpdatingBanner = balancesLoading && !balancesError;
  const showListInitialLoader =
    !showBalancesUpdatingBanner && listDataLoading && listContentEmpty;

  return {
    showBalancesUpdatingBanner,
    showListInitialLoader,
    // Suppressing a duplicate spinner does not mean the list has finished loading.
    showListEmptyState: !listDataLoading && listContentEmpty,
    showRefreshControlLoader: listRefreshing && !showBalancesUpdatingBanner,
    showFooterLoader: fetchingNextPage && !showBalancesUpdatingBanner,
  };
}
