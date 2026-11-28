import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { homeSettleGroups } from "./homeSettleGroups.ts";

Deno.test("home settle lists each group with the viewer's plan line", () => {
  const rows = homeSettleGroups([
    {
      groupId: "g-goa",
      groupName: "Goa trip",
      balances: [
        { user_id: "u-you", participant_id: "p-you", full_name: "You", amount: 2250, currency: "INR" },
        { user_id: "u-asha", participant_id: "p-asha", full_name: "Asha Rao", amount: -2250, currency: "INR" },
        { user_id: "u-rohan", participant_id: "p-rohan", full_name: "Rohan Iyer", amount: 800, currency: "INR" },
        { user_id: "u-meera", participant_id: "p-meera", full_name: "Meera Shah", amount: -800, currency: "INR" },
      ],
    },
    {
      groupId: "g-flat",
      groupName: "Flat 4B",
      balances: [
        { user_id: "u-you", participant_id: "p-you", full_name: "You", amount: -640, currency: "INR" },
        { user_id: "u-asha", participant_id: "p-asha", full_name: "Asha Rao", amount: 640, currency: "INR" },
      ],
    },
    {
      groupId: "g-settled",
      groupName: "Book club",
      balances: [
        { user_id: "u-you", participant_id: "p-you", full_name: "You", amount: 0, currency: "INR" },
        { user_id: "u-meera", participant_id: "p-meera", full_name: "Meera Shah", amount: 0, currency: "INR" },
      ],
    },
  ], "u-you", "p-you");
  assertEquals(rows.map((row) => row.groupName), ["Goa trip", "Flat 4B"]);
  assertEquals(`${rows[0].payment.from.name}→${rows[0].payment.to.name}`, "Asha Rao→You");
  assertEquals(`${rows[1].payment.from.name}→${rows[1].payment.to.name}`, "You→Asha Rao");
});
