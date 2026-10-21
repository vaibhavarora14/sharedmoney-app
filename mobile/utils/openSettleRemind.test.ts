import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  resolveSettleRemindChannel,
  settleRemindLabel,
} from "./settleRemindChannel.ts";

Deno.test("resolveSettleRemindChannel falls back to share without phone", async () => {
  const result = await resolveSettleRemindChannel(null, {
    platformOS: "ios",
    canOpenURL: async () => true,
  });
  assertEquals(result, { channel: "share", phoneDigits: null });
});

Deno.test("resolveSettleRemindChannel uses wa.me path on web when phone present", async () => {
  const result = await resolveSettleRemindChannel("+919876543210", {
    platformOS: "web",
    canOpenURL: async () => false,
  });
  assertEquals(result, {
    channel: "whatsapp",
    phoneDigits: "919876543210",
  });
});

Deno.test("resolveSettleRemindChannel uses share when WhatsApp not installed", async () => {
  const result = await resolveSettleRemindChannel("+919876543210", {
    platformOS: "ios",
    canOpenURL: async () => false,
  });
  assertEquals(result, {
    channel: "share",
    phoneDigits: "919876543210",
  });
});

Deno.test("resolveSettleRemindChannel uses whatsapp when canOpenURL is true", async () => {
  const result = await resolveSettleRemindChannel("+1 (415) 555-2671", {
    platformOS: "android",
    canOpenURL: async (url) => url === "whatsapp://send",
  });
  assertEquals(result, {
    channel: "whatsapp",
    phoneDigits: "14155552671",
  });
});

Deno.test("settleRemindLabel matches channel and first name", () => {
  assertEquals(settleRemindLabel("whatsapp"), "Remind on WhatsApp");
  assertEquals(settleRemindLabel("whatsapp", "Maya"), "Remind on WhatsApp");
  assertEquals(settleRemindLabel("share", "Maya Kapoor"), "Remind Maya");
  assertEquals(settleRemindLabel("share"), "Remind");
});
