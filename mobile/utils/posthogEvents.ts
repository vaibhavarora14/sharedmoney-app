/**
 * SharedMoney Production PostHog project (`563625`) — product event names.
 *
 * Use these for activation / retention funnels. Do not confuse with SEO landing
 * events in `web/src/analytics.ts` (`seo page viewed`, etc.).
 *
 * Activation sequence (signed-in users only; distinct_id = Supabase auth user id):
 * 1. `auth_succeeded` — after `$identify` on a new auth identity
 * 2. `group_created` — creator path
 * 3. `group_joined` — invite / share-link join path (not silent)
 * 4. `expense_created` — expense create (NOT `expense_added`)
 * 5. `settlement_recorded` — settlement create
 *
 * Supporting: `mobile_app_opened`, `mobile_screen_viewed`, `group_archived`,
 * `group_unarchived`, `group_hidden_from_lists`, `group_updated`,
 * `group_list_scroll` (sampled FlatList perf), `group_list_page_loaded`.
 */
export const ANALYTICS_EVENTS = {
  AUTH_SUCCEEDED: "auth_succeeded",
  GROUP_CREATED: "group_created",
  GROUP_JOINED: "group_joined",
  EXPENSE_CREATED: "expense_created",
  SETTLEMENT_RECORDED: "settlement_recorded",
  MOBILE_APP_OPENED: "mobile_app_opened",
  MOBILE_SCREEN_VIEWED: "mobile_screen_viewed",
  GROUP_ARCHIVED: "group_archived",
  GROUP_UNARCHIVED: "group_unarchived",
  GROUP_HIDDEN_FROM_LISTS: "group_hidden_from_lists",
  GROUP_UPDATED: "group_updated",
  /** Sampled GroupDetails FlatList scroll perf (PII-safe counts only). */
  GROUP_LIST_SCROLL: "group_list_scroll",
  /** GroupDetails infinite-query page append timing. */
  GROUP_LIST_PAGE_LOADED: "group_list_page_loaded",
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
