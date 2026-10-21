import { assertEquals } from "jsr:@std/assert@1";
import {
  getCrashCountForTests,
  recordCrash,
  resetCrashSessionForTests,
} from "./crashSession.ts";

Deno.test("first crash has no support reference ID", () => {
  resetCrashSessionForTests();
  const first = recordCrash(() => "SM-AAAA-AA");
  assertEquals(first.crashNumber, 1);
  assertEquals(first.supportReferenceId, null);
  assertEquals(first.showSupportReference, false);
  assertEquals(getCrashCountForTests(), 1);
});

Deno.test("second and later crashes mint a support reference ID", () => {
  resetCrashSessionForTests();
  recordCrash(() => "SM-AAAA-AA");
  const second = recordCrash(() => "SM-7K3Q-92");
  assertEquals(second.crashNumber, 2);
  assertEquals(second.supportReferenceId, "SM-7K3Q-92");
  assertEquals(second.showSupportReference, true);

  const third = recordCrash(() => "SM-BBBB-BB");
  assertEquals(third.crashNumber, 3);
  assertEquals(third.supportReferenceId, "SM-BBBB-BB");
  assertEquals(third.showSupportReference, true);
});

Deno.test("resetCrashSessionForTests clears the in-session counter", () => {
  resetCrashSessionForTests();
  recordCrash(() => "SM-AAAA-AA");
  recordCrash(() => "SM-BBBB-BB");
  resetCrashSessionForTests();
  assertEquals(getCrashCountForTests(), 0);
  const again = recordCrash(() => "SM-CCCC-CC");
  assertEquals(again.crashNumber, 1);
  assertEquals(again.showSupportReference, false);
});
