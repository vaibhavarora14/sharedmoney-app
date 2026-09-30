/**
 * SharedMoney Production PostHog project (`563625`) — product event names.
 *
 * Use these for activation / retention funnels. Do not confuse with SEO landing
 * events in `web/src/analytics.ts` (`seo page viewed`, etc.).
 *
 * Activation sequence (signed-in users only; distinct_id = Supabase auth user id):
 * 1. `auth_succeeded` — after `$identify` on a new auth identity
 * 2. `group_created` OR `group_joined` — creator vs invitee path
 * 3. `expense_created` — expense create (NOT `expense_added`)
 * 4. `settlement_recorded` — settlement create
 *
 * Do not invent `signup_completed`; auth_succeeded is the identity signal.
 *
 * `group_joined` props: `group_id`, `join_method` (`invite_link` | `email_invite`).
 * Fires on invite-link redeem status `joined`, and once for email invitations
 * accepted server-side at signup (client detects recently accepted rows).
 *
 * Invite growth loop (inviter side; never include raw invitee emails):
 * - `invite_link_created` — shareable link token minted
 * - `invite_link_shared` — system share sheet / clipboard copy of the link
 * - `member_invited` — email invite sent via participants invite API
 *
 * Supporting: `mobile_app_opened`, `mobile_screen_viewed`, `group_archived`,
 * `group_unarchived`, `group_hidden_from_lists`, `group_updated`,
 * `group_list_scroll` (sampled FlatList perf), `group_list_page_loaded`,
 * `group_details_ready` (open latency; props: group_id, duration_ms).
 */
export const ANALYTICS_EVENTS = {
  AUTH_SUCCEEDED: "auth_succeeded",
  GROUP_CREATED: "group_created",
  GROUP_JOINED: "group_joined",
  EXPENSE_CREATED: "expense_created",
  SETTLEMENT_RECORDED: "settlement_recorded",
  INVITE_LINK_CREATED: "invite_link_created",
  INVITE_LINK_SHARED: "invite_link_shared",
  MEMBER_INVITED: "member_invited",
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
  /** Group details critical path ready (details + balances/stats). */
  GROUP_DETAILS_READY: "group_details_ready",
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
