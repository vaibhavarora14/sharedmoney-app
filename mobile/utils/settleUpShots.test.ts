import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readSettleUpFrame } from "./settleUpShots.ts";

Deno.test("settle-up preview frames", () => {
  assertEquals(readSettleUpFrame("?preview=settle-up"), "plan");
  assertEquals(readSettleUpFrame("?preview=settle-up&frame=home"), "home");
  assertEquals(readSettleUpFrame("?preview=settle-up&frame=pay&colorScheme=dark"), "pay");
  assertEquals(readSettleUpFrame("?preview=settle-up&frame=after"), "after");
  assertEquals(readSettleUpFrame("?preview=settle-up&frame=transactions"), "transactions");
});
