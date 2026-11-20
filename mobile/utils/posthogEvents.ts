/**
 * SharedMoney Production PostHog project (`563625`) — product event names.
 *
 * Use these for activation / retention funnels. Do not confuse with SEO landing
 * events in `web/src/analytics.ts` (`seo page viewed`, etc.).
 *
 * Activation sequence (signed-in users only; distinct_id = Supabase auth user id):
 * 1. `auth_succeeded` — after `$identify` on a new auth identity
 * 2. `group_created` OR `group_joined` — creator vs invitee path
 * 3. `expense_created` — expense create (NOT `expense_added`).
 *    A quick-settle debt is an expense, so it fires this event with
 *    `group_kind=direct` and `source=quick_settle`. A quick-settle payment does not.
 * 4. `settlement_recorded` — settlement create
 *
 * Do not invent `signup_completed`; auth_succeeded is the identity signal.
 * `auth_succeeded` props: `auth_provider`, `platform`, `is_new_user` (true when
 * Supabase `created_at` is within 10 minutes of `last_sign_in_at`, else now).
 *
 * Pre-auth sign-in funnel (anonymous until auth_succeeded; enums and booleans
 * only — never email, phone, name, token, or raw error text):
 * - `auth_screen_viewed` — once per AuthScreen mount, and again when `step` or
 *   sign-in/sign-up mode changes. Re-renders with the same step and mode do
 *   not refire. On iOS the first event waits until Apple availability is
 *   known. Props: `step` (`methods` | `email` | `phone` | `otp`), `mode`
 *   (`sign_in` | `sign_up`), `platform`, `whatsapp_enabled`, `apple_available`.
 * - `auth_method_selected` — tap Apple, Google, "Continue with email", or
 *   WhatsApp "Send code" (after the phone number validates). Props: `method`
 *   (`apple` | `google` | `email` | `whatsapp`), `mode`, `platform`.
 * - `auth_failed` — a provider or API failure already shown on AuthScreen
 *   (Google, Apple, email sign-in/sign-up, WhatsApp send/verify), and the
 *   non-cancel social failure path in AuthContext. Props: `method`,
 *   `reason_code`, `platform`. User cancels are classified as `cancelled` and
 *   are not captured. Apple profile-name update failures are not captured
 *   either, because sign-in still succeeds.
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
 * Logged-out web invite landing (`/app/join/:token` shell). Never include the
 * token, group name, member names, balances, emails, or phone numbers:
 * - `invite_landing_viewed` — props: `source=invite_join`
 * - `invite_landing_cta_clicked` — props: `source=invite_join`,
 *   `cta` (`play` | `app_store` | `open_app` | `web_app`)
 *
 * Supporting: `mobile_app_opened`, `mobile_screen_viewed`, `group_archived`,
 * `group_unarchived`, `group_hidden_from_lists`, `group_updated`,
 * `group_list_scroll` (sampled FlatList perf), `group_list_page_loaded`,
 * `group_details_ready` (open latency; props: group_id, duration_ms,
 *   from_cache, cache_status hit|miss|partial),
 * `groups_home_loaded` (home list rendered; props: duration_ms, group_count,
 *   from_cache; duration_ms is visit start → list commit),
 * `upi_pay_tapped` (settle Pay via UPI; never include VPA),
 * `upi_id_saved` (profile UPI ID saved; never include VPA),
 * `review_prompt_requested` (native in-app review API invoked),
 * `app_update_prompt_shown` (in-app update prompt displayed),
 * `app_update_started` (user chose Update and the store URL opened).
 */
export const ANALYTICS_EVENTS = {
  AUTH_SUCCEEDED: "auth_succeeded",
  /** Auth screen mount, and again when step or sign-in/sign-up mode changes. */
  AUTH_SCREEN_VIEWED: "auth_screen_viewed",
  /** Apple, Google, Continue with email, or WhatsApp send code. */
  AUTH_METHOD_SELECTED: "auth_method_selected",
  /** Provider/API auth failure. No PII. User cancels are not captured. */
  AUTH_FAILED: "auth_failed",
  GROUP_CREATED: "group_created",
  GROUP_JOINED: "group_joined",
  EXPENSE_CREATED: "expense_created",
  SETTLEMENT_RECORDED: "settlement_recorded",
  INVITE_LINK_CREATED: "invite_link_created",
  INVITE_LINK_SHARED: "invite_link_shared",
  MEMBER_INVITED: "member_invited",
  INVITE_LANDING_VIEWED: "invite_landing_viewed",
  INVITE_LANDING_CTA_CLICKED: "invite_landing_cta_clicked",
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
  /** Groups home list ready (after cold/warm paint). */
  GROUPS_HOME_LOADED: "groups_home_loaded",
  /** Settle modal Pay via UPI tapped (deep link or desktop copy). No VPA. */
  UPI_PAY_TAPPED: "upi_pay_tapped",
  /** Profile UPI ID saved successfully. No VPA in properties. */
  UPI_ID_SAVED: "upi_id_saved",
  /** Native StoreReview.requestReview invoked (OS may still throttle UI). */
  REVIEW_PROMPT_REQUESTED: "review_prompt_requested",
  /** Update prompt shown after a store lookup found a newer listing. */
  APP_UPDATE_PROMPT_SHOWN: "app_update_prompt_shown",
  /** User accepted the update prompt and the store URL was opened. */
  APP_UPDATE_STARTED: "app_update_started",
  /** Home settle sheet opened. source: home_header | home_empty */
  QUICK_SETTLE_OPENED: "quick_settle_opened",
  /** A direct payment or debt was saved. Amounts are never included. */
  QUICK_SETTLE_RECORDED: "quick_settle_recorded",
  /** Existing group balances were offered before a direct record. */
  QUICK_SETTLE_GROUP_DEBTS_OFFERED: "quick_settle_group_debts_offered",
  QUICK_SETTLE_UNDONE: "quick_settle_undone",
  /** Plain-text share in v1. kind becomes link when #325 ships. */
  QUICK_SETTLE_LINK_SHARED: "quick_settle_link_shared",
  /** Anonymous session created. Props: platform. */
  GUEST_STARTED: "guest_started",
  /** Sign-in sheet opened. Props: trigger, action. No names. */
  GUEST_SIGNIN_PROMPT_SHOWN: "guest_signin_prompt_shown",
  /** Guest chose a sign-in method. Props: method. */
  GUEST_SIGNIN_STARTED: "guest_signin_started",
  /** Guest became a permanent account. Props: method, path (link | merge). */
  GUEST_CONVERTED: "guest_converted",
  /** Conflict merge failed. Props: reason_code. No messages or ids. */
  GUEST_MERGE_FAILED: "guest_merge_failed",
  /** Server purge deleted an inactive guest. Not emitted while cleanup is off. */
  GUEST_EXPIRED: "guest_expired",
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
