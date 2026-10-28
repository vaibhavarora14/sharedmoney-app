import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { detectInstalledUpiApps } from "./upiApps.ts";

Deno.test("detectInstalledUpiApps returns only schemes that can open", async () => {
  const apps = await detectInstalledUpiApps({
    canOpenURL: async (url) => url.startsWith("tez://") || url.startsWith("phonepe://"),
  });
  assertEquals(apps.map((app) => app.id), ["gpay", "phonepe"]);
});

Deno.test("detectInstalledUpiApps is empty when none install", async () => {
  const apps = await detectInstalledUpiApps({
    canOpenURL: async () => false,
  });
  assertEquals(apps.length, 0);
});
