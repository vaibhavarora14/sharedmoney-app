import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", Deno.env.get("SUPABASE_ANON_KEY") || "test-anon-key");

const { loadRecurringTemplateViews } = await import("./recurring-template-api.ts");

Deno.test("loadRecurringTemplateViews fetches templates and cycles together", async () => {
  const started: string[] = [];
  const chain = (table: string, data: unknown) => {
    started.push(table);
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    const result = Promise.resolve({ data, error: null });
    builder.select = () => self();
    builder.eq = () => self();
    builder.order = () => self();
    builder.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => result.then(onFulfilled, onRejected);
    return builder;
  };

  const supabase = {
    from(table: string) {
      if (table === "recurring_templates") {
        return chain(table, [{
          id: "t1",
          group_id: "g1",
          title: "Rent",
          amount: 10,
          currency: "INR",
          cadence: "monthly",
          anchor_date: "2026-11-01",
          paid_by_participant_id: null,
          split_among_participant_ids: null,
          status: "active",
        }]);
      }
      if (table === "recurring_template_cycles") {
        return chain(table, []);
      }
      throw new Error(table);
    },
  };

  const views = await loadRecurringTemplateViews(supabase, "g1", new Date("2026-11-15T12:00:00.000Z"));
  assertEquals(views.length, 1);
  assertEquals(views[0].current_period_key, "2026-11");
  assertEquals(started.sort(), ["recurring_template_cycles", "recurring_templates"]);
});
