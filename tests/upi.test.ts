import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildUpiAppPayUri,
  buildUpiPayNote,
  buildUpiPayUri,
  canUseUpiDeepLink,
  formatDidYouPayQuestion,
  formatPayeeUpiLine,
  getOptionalUpiIdFormatError,
  isDesktopWebUpiSurface,
  needsUpiAppPicker,
  normalizeUpiId,
  UPI_APPS,
  UPI_ID_FORMAT_ERROR,
  UPI_ID_MAX_LENGTH,
  UPI_ID_PROFILE_HELPER,
  UPI_NOTE_MAX_LENGTH,
} from "../shared/upi.ts";

Deno.test("normalizeUpiId accepts common VPAs", () => {
  assertEquals(normalizeUpiId("Name@okhdfc"), "name@okhdfc");
  assertEquals(normalizeUpiId("  user.name-1@ybl  "), "user.name-1@ybl");
  assertEquals(normalizeUpiId("ab@paytm"), "ab@paytm");
});

Deno.test("normalizeUpiId rejects spaces, missing handle, and overlong values", () => {
  assertEquals(normalizeUpiId(""), null);
  assertEquals(normalizeUpiId("   "), null);
  assertEquals(normalizeUpiId(null), null);
  assertEquals(normalizeUpiId("name @okhdfc"), null);
  assertEquals(normalizeUpiId("nameokhdfc"), null);
  assertEquals(normalizeUpiId("@okhdfc"), null);
  assertEquals(normalizeUpiId("name@"), null);
  assertEquals(normalizeUpiId("a".repeat(UPI_ID_MAX_LENGTH) + "@ybl"), null);
  assertEquals(getOptionalUpiIdFormatError("bad vpa"), UPI_ID_FORMAT_ERROR);
  assertEquals(getOptionalUpiIdFormatError(""), null);
  assertEquals(getOptionalUpiIdFormatError("good@okhdfc"), null);
});

Deno.test("profile helper and format error avoid examples and em dashes", () => {
  assertEquals(UPI_ID_PROFILE_HELPER, "Group members can see this.");
  assertEquals(UPI_ID_FORMAT_ERROR, "Use name@handle.");
  assertEquals(UPI_ID_PROFILE_HELPER.includes("—"), false);
  assertEquals(UPI_ID_FORMAT_ERROR.toLowerCase().includes("beta"), false);
});

Deno.test("buildUpiPayNote uses middle dot and truncates near 50 chars", () => {
  assertEquals(buildUpiPayNote("Goa Trip"), "SharedMoney · Goa Trip");
  const long = "A".repeat(80);
  const note = buildUpiPayNote(long);
  assertEquals(note.startsWith("SharedMoney · "), true);
  assertEquals(note.length <= UPI_NOTE_MAX_LENGTH, true);
  assertEquals(note.includes("—"), false);
});

Deno.test("buildUpiPayUri encodes pa pn am cu tn with truncated note", () => {
  const uri = buildUpiPayUri({
    vpa: "Maya@okhdfc",
    payeeName: "Maya Kapoor",
    amount: 120.5,
    groupName: "Goa Trip",
  });
  assertEquals(
    uri,
    "upi://pay?pa=maya%40okhdfc&pn=Maya%20Kapoor&am=120.50&cu=INR&tn=SharedMoney%20%C2%B7%20Goa%20Trip",
  );
});

Deno.test("buildUpiPayUri formats whole amounts to 2dp and rejects bad input", () => {
  const uri = buildUpiPayUri({
    vpa: "a@ybl",
    payeeName: "A",
    amount: 10,
    groupName: "Home",
  });
  assertEquals(uri.includes("am=10.00"), true);
  assertThrows(() =>
    buildUpiPayUri({
      vpa: "not-a-vpa",
      payeeName: "A",
      amount: 10,
      groupName: "Home",
    })
  );
  assertThrows(() =>
    buildUpiPayUri({
      vpa: "a@ybl",
      payeeName: "A",
      amount: 0,
      groupName: "Home",
    })
  );
});

Deno.test("buildUpiAppPayUri uses per-app bases", () => {
  const gpay = UPI_APPS.find((app) => app.id === "gpay")!;
  const uri = buildUpiAppPayUri(gpay, {
    vpa: "a@ybl",
    payeeName: "A",
    amount: 1,
    groupName: "Home",
  });
  assertEquals(uri.startsWith("tez://upi/pay?"), true);
  assertEquals(uri.includes("pa=a%40ybl"), true);
});

Deno.test("platform helpers for deep link, desktop, and iOS picker", () => {
  assertEquals(canUseUpiDeepLink("ios"), true);
  assertEquals(canUseUpiDeepLink("android"), true);
  assertEquals(
    canUseUpiDeepLink(
      "web",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    ),
    true,
  );
  assertEquals(
    isDesktopWebUpiSurface(
      "web",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    ),
    true,
  );
  assertEquals(needsUpiAppPicker("ios"), true);
  assertEquals(needsUpiAppPicker("android"), false);
});

Deno.test("payee line and confirm copy", () => {
  assertEquals(
    formatPayeeUpiLine("Maya Kapoor", "maya@okhdfc"),
    "To Maya Kapoor · maya@okhdfc",
  );
  assertEquals(
    formatDidYouPayQuestion("Maya", "₹120"),
    "Did you pay Maya ₹120?",
  );
});
