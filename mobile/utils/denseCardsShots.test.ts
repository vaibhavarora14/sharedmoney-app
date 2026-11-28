import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readDenseCardsFrame } from "./denseCardsShots.ts";

Deno.test("dense-cards preview frames default to home", () => {
  assertEquals(readDenseCardsFrame(null), "home");
  assertEquals(readDenseCardsFrame("?preview=dense-cards"), "home");
  assertEquals(readDenseCardsFrame("?preview=dense-cards&frame=group"), "group");
  assertEquals(readDenseCardsFrame("?preview=dense-cards&frame=transactions&colorScheme=dark"), "transactions");
});
