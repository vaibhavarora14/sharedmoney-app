import { assertEquals } from "jsr:@std/assert@1";
import { ANALYTICS_EVENTS } from "./posthogEvents.ts";

Deno.test("pre-auth sign-in funnel event names stay stable", () => {
  assertEquals(ANALYTICS_EVENTS.AUTH_SCREEN_VIEWED, "auth_screen_viewed");
  assertEquals(ANALYTICS_EVENTS.AUTH_METHOD_SELECTED, "auth_method_selected");
  assertEquals(ANALYTICS_EVENTS.AUTH_FAILED, "auth_failed");
});

Deno.test("activation funnel event names stay stable for project 563625", () => {
  assertEquals(ANALYTICS_EVENTS.AUTH_SUCCEEDED, "auth_succeeded");
  assertEquals(ANALYTICS_EVENTS.GROUP_CREATED, "group_created");
  assertEquals(ANALYTICS_EVENTS.GROUP_JOINED, "group_joined");
  assertEquals(ANALYTICS_EVENTS.EXPENSE_CREATED, "expense_created");
  assertEquals(ANALYTICS_EVENTS.SETTLEMENT_RECORDED, "settlement_recorded");
});

Deno.test("invite growth loop event names stay stable", () => {
  assertEquals(ANALYTICS_EVENTS.INVITE_LINK_CREATED, "invite_link_created");
  assertEquals(ANALYTICS_EVENTS.INVITE_LINK_SHARED, "invite_link_shared");
  assertEquals(ANALYTICS_EVENTS.MEMBER_INVITED, "member_invited");
  assertEquals(ANALYTICS_EVENTS.INVITE_LANDING_VIEWED, "invite_landing_viewed");
  assertEquals(
    ANALYTICS_EVENTS.INVITE_LANDING_CTA_CLICKED,
    "invite_landing_cta_clicked",
  );
  assertEquals(ANALYTICS_EVENTS.INVITE_PROMPT_SHOWN, "invite_prompt_shown");
  assertEquals(ANALYTICS_EVENTS.INVITE_PROMPT_SHARED, "invite_prompt_shared");
  assertEquals(
    ANALYTICS_EVENTS.INVITE_PROMPT_DISMISSED,
    "invite_prompt_dismissed",
  );
});

Deno.test("expense event is expense_created, not expense_added", () => {
  assertEquals(ANALYTICS_EVENTS.EXPENSE_CREATED.includes("added"), false);
  assertEquals(ANALYTICS_EVENTS.EXPENSE_CREATED, "expense_created");
});

Deno.test("group list perf event names are stable and PII-safe keys", () => {
  assertEquals(ANALYTICS_EVENTS.GROUP_LIST_SCROLL, "group_list_scroll");
  assertEquals(ANALYTICS_EVENTS.GROUP_LIST_PAGE_LOADED, "group_list_page_loaded");
});

Deno.test("group details ready latency event name is stable", () => {
  assertEquals(ANALYTICS_EVENTS.GROUP_DETAILS_READY, "group_details_ready");
});

Deno.test("group ledger ready latency event name is stable", () => {
  assertEquals(ANALYTICS_EVENTS.GROUP_LEDGER_READY, "group_ledger_ready");
});

Deno.test("groups home loaded latency event name is stable", () => {
  assertEquals(ANALYTICS_EVENTS.GROUPS_HOME_LOADED, "groups_home_loaded");
});

Deno.test("review prompt requested event name is stable", () => {
  assertEquals(ANALYTICS_EVENTS.REVIEW_PROMPT_REQUESTED, "review_prompt_requested");
});

Deno.test("balance breakdown opened event name is stable", () => {
  assertEquals(ANALYTICS_EVENTS.BALANCE_BREAKDOWN_OPENED, "balance_breakdown_opened");
});

Deno.test("quick settle events stay free of amounts and names", () => {
  assertEquals(ANALYTICS_EVENTS.QUICK_SETTLE_OPENED, "quick_settle_opened");
  assertEquals(ANALYTICS_EVENTS.QUICK_SETTLE_RECORDED, "quick_settle_recorded");
  assertEquals(ANALYTICS_EVENTS.QUICK_SETTLE_GROUP_DEBTS_OFFERED, "quick_settle_group_debts_offered");
  assertEquals(ANALYTICS_EVENTS.QUICK_SETTLE_UNDONE, "quick_settle_undone");
  assertEquals(ANALYTICS_EVENTS.QUICK_SETTLE_LINK_SHARED, "quick_settle_link_shared");
});
