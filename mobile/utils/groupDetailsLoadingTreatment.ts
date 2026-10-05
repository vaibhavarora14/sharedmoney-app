export interface GroupDetailsLoadingTreatmentInput {
  balancesLoading: boolean;
  balancesError: boolean;
  listDataLoading: boolean;
  listContentEmpty: boolean;
  listRefreshing: boolean;
  fetchingNextPage: boolean;
}

export interface GroupDetailsLoadingTreatment {
  showDashboardSkeleton: boolean;
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
  const showDashboardSkeleton = balancesLoading && !balancesError;
  const showListInitialLoader = listDataLoading && listContentEmpty;

  return {
    showDashboardSkeleton,
    showListInitialLoader,
    // Both ledger sources must finish before we can claim the list is empty (#371).
    showListEmptyState: !listDataLoading && listContentEmpty,
    showRefreshControlLoader: listRefreshing && !showListInitialLoader,
    showFooterLoader: fetchingNextPage && !showListInitialLoader,
  };
}
