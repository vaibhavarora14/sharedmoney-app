import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  askAddUpiIdHint,
  PAY_VIA_UPI_LABEL,
  RECORD_SETTLEMENT_LABEL,
  SETTLE_OUTSIDE_APP_HELP,
  UPI_ID_PROFILE_HELPER,
} from "./settleCopy.ts";

Deno.test("settle copy stays outside-app product truth", () => {
  assertEquals(
    SETTLE_OUTSIDE_APP_HELP,
    "When someone pays outside the app, log it here.",
  );
  assertEquals(RECORD_SETTLEMENT_LABEL, "Record settlement");
});

Deno.test("UPI settle copy has no beta and no em dashes", () => {
  assertEquals(PAY_VIA_UPI_LABEL, "Pay via UPI");
  assertEquals(
    UPI_ID_PROFILE_HELPER,
    "Group members can see this so they can pay you.",
  );
  assertEquals(askAddUpiIdHint("Maya"), "Ask Maya to add a UPI ID");
  for (const copy of [
    PAY_VIA_UPI_LABEL,
    UPI_ID_PROFILE_HELPER,
    askAddUpiIdHint("Maya"),
    SETTLE_OUTSIDE_APP_HELP,
  ]) {
    assertEquals(copy.toLowerCase().includes("beta"), false);
    assertEquals(copy.includes("—"), false);
    assertEquals(copy.includes("–"), false);
  }
});
