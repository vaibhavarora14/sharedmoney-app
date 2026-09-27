import { assertEquals } from "jsr:@std/assert@1";
import { ANALYTICS_EVENTS } from "./posthogEvents.ts";

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
});

Deno.test("expense event is expense_created, not expense_added", () => {
  assertEquals(ANALYTICS_EVENTS.EXPENSE_CREATED.includes("added"), false);
  assertEquals(ANALYTICS_EVENTS.EXPENSE_CREATED, "expense_created");
});

Deno.test("group list perf event names are stable and PII-safe keys", () => {
  assertEquals(ANALYTICS_EVENTS.GROUP_LIST_SCROLL, "group_list_scroll");
  assertEquals(ANALYTICS_EVENTS.GROUP_LIST_PAGE_LOADED, "group_list_page_loaded");
});
