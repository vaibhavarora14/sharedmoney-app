import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  askAddUpiIdHint,
  buildUpiPayUri,
  canUseUpiDeepLink,
  getOptionalUpiIdFormatError,
  normalizeUpiId,
  UPI_ID_FORMAT_ERROR,
  UPI_ID_MAX_LENGTH,
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

Deno.test("buildUpiPayUri encodes pa pn am cu tn", () => {
  const uri = buildUpiPayUri({
    vpa: "Maya@okhdfc",
    payeeName: "Maya Kapoor",
    amount: 120.5,
    groupName: "Goa Trip",
  });
  assertEquals(
    uri,
    "upi://pay?pa=maya%40okhdfc&pn=Maya%20Kapoor&am=120.50&cu=INR&tn=SharedMoney%3A%20Goa%20Trip",
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

Deno.test("canUseUpiDeepLink is native or mobile web only", () => {
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
    canUseUpiDeepLink(
      "web",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    ),
    false,
  );
});

Deno.test("askAddUpiIdHint uses first name", () => {
  assertEquals(askAddUpiIdHint("Maya"), "Ask Maya to add a UPI ID");
  assertEquals(askAddUpiIdHint(""), "Ask them to add a UPI ID");
});
