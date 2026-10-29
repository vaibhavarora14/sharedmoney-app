import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  COPIED_UPI_LABEL,
  COPY_UPI_ID_LABEL,
  NOT_YET_LABEL,
  PAY_VIA_UPI_LABEL,
  RECORD_SETTLEMENT_LABEL,
  SETTLE_OUTSIDE_APP_HELP,
  UPI_ID_COPIED_LABEL,
  UPI_ID_PROFILE_HELPER,
  YES_RECORD_IT_LABEL,
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
  assertEquals(UPI_ID_PROFILE_HELPER, "Group members can see this.");
  assertEquals(YES_RECORD_IT_LABEL, "Yes, record it");
  assertEquals(NOT_YET_LABEL, "Not yet");
  assertEquals(COPY_UPI_ID_LABEL, "Copy UPI ID");
  assertEquals(COPIED_UPI_LABEL, "✓ Copied");
  assertEquals(UPI_ID_COPIED_LABEL, "✓ UPI ID copied");
  for (const copy of [
    PAY_VIA_UPI_LABEL,
    UPI_ID_PROFILE_HELPER,
    YES_RECORD_IT_LABEL,
    NOT_YET_LABEL,
    SETTLE_OUTSIDE_APP_HELP,
    COPY_UPI_ID_LABEL,
    COPIED_UPI_LABEL,
    UPI_ID_COPIED_LABEL,
  ]) {
    assertEquals(copy.toLowerCase().includes("beta"), false);
    assertEquals(copy.includes("—"), false);
    assertEquals(copy.includes("–"), false);
  }
});
