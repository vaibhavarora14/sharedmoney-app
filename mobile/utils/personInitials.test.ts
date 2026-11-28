import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { avatarToneIndex, personInitials } from "./personInitials.ts";

Deno.test("person initials use first and last name letters", () => {
  assertEquals(personInitials("Asha Rao"), "AR");
  assertEquals(personInitials("Rohan"), "RO");
  assertEquals(personInitials("maya@example.com"), "MA");
  assertEquals(personInitials("  "), "?");
});

Deno.test("avatar tone index is stable for a key", () => {
  assertEquals(avatarToneIndex("p-asha"), avatarToneIndex("p-asha"));
  assertEquals(avatarToneIndex("p-asha") >= 0, true);
  assertEquals(avatarToneIndex("p-asha") < 5, true);
});
