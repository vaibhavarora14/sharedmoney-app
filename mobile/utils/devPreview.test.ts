import { assertEquals } from "jsr:@std/assert@1";
import { resolveDevPreview } from "./devPreview.ts";

Deno.test("production (isDev=false) never resolves crash-first or other preview kinds", () => {
  const urls = [
    "exp://127.0.0.1:8082/--/?preview=crash-first",
    "sharedmoney://dev/crash-first",
    "https://sharedmoney.app/?preview=crash-first",
    "https://sharedmoney.app/join/abc?preview=crash-first",
    "exp://127.0.0.1:8082/--/?preview=crash-repeat",
    "exp://127.0.0.1:8082/--/?preview=crash",
    "https://sharedmoney.app/?preview=bill-dead",
    "sharedmoney://dev/bill-offline",
  ];
  for (const url of urls) {
    assertEquals(resolveDevPreview(url, false), null);
  }
});

Deno.test("dev resolves preview kinds from path and ?preview= query", () => {
  assertEquals(resolveDevPreview("exp://x/?preview=crash-first", true), "crash-first");
  assertEquals(resolveDevPreview("sharedmoney://dev/crash-repeat", true), "crash-repeat");
  assertEquals(resolveDevPreview("sharedmoney://dev/crash", true), "crash");
  assertEquals(resolveDevPreview("?preview=bill-dead", true), "bill-dead");
  assertEquals(resolveDevPreview("?preview=bill-offline", true), "bill-offline");
  assertEquals(resolveDevPreview("?preview=crash-copied", true), "crash-copied");
});

Deno.test("null/empty URLs stay null even in dev", () => {
  assertEquals(resolveDevPreview(null, true), null);
  assertEquals(resolveDevPreview("", true), null);
});
