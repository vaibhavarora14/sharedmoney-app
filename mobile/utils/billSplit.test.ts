import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { allocateBillSplit, billAmountMinor, billSplitUrl, extractBillSplitToken, MAX_BILL_MINOR } from "./billSplit.ts";
import { calculateEqualSplits, calculateShareSplits } from "./splits.ts";

Deno.test("bill equal: earliest participants receive remainder cents", () => {
  assertEquals(allocateBillSplit(1000, 3, "equal"), [334, 333, 333]);
  assertEquals(allocateBillSplit(1001, 3, "equal"), [334, 334, 333]);
  assertEquals(allocateBillSplit(2, 2, "equal"), [1, 1]);
});

Deno.test("bill shares: weighted largest remainder, stable ties", () => {
  assertEquals(allocateBillSplit(1000, 3, "shares", [1, 2, 3]), [167, 333, 500]);
  assertEquals(allocateBillSplit(1001, 3, "shares", [1, 1, 1]), [334, 334, 333]);
  assertEquals(allocateBillSplit(101, 2, "shares", [1, 3]), [25, 76]);
});

Deno.test("bill exact: preserve amounts and reject even a one-cent mismatch", () => {
  assertEquals(allocateBillSplit(1000, 3, "unequal", [201, 300, 499]), [201, 300, 499]);
  for (const values of [[200, 300, 499], [200, 300, 501], [0, 500, 500], [1.5, 998.5]]) {
    assertThrows(() => allocateBillSplit(1000, values.length, "unequal", values));
  }
});

Deno.test("bill allocation matches expense editor and conserves integer cents", () => {
  const ids = ["a", "b", "c"];
  for (const total of [1001, 10000, 999999, MAX_BILL_MINOR]) {
    for (const mode of ["equal", "shares"] as const) {
      const actual = allocateBillSplit(total, 3, mode, [1, 2, 3]);
      const existing = mode === "equal" ? calculateEqualSplits(total / 100, ids)
        : calculateShareSplits(total / 100, ids, { a: 1, b: 2, c: 3 });
      assertEquals(actual, existing.map((s) => Math.round(s.amount * 100)));
      assertEquals(actual.reduce((sum, n) => sum + n, 0), total);
      assertEquals(actual.every(Number.isSafeInteger), true);
    }
  }
});

Deno.test("bill validation rejects unsafe totals, people counts, and shares", () => {
  for (const total of [0, -1, NaN, Infinity, 1.5, MAX_BILL_MINOR + 1]) assertThrows(() => allocateBillSplit(total, 2, "equal"));
  for (const count of [0, 1, 51, 2.5]) assertThrows(() => allocateBillSplit(100, count, "equal"));
  for (const values of [[0, 1], [1.5, 2], [100, 1], [1], [NaN, 1]]) assertThrows(() => allocateBillSplit(100, 2, "shares", values));
  assertThrows(() => allocateBillSplit(1, 2, "equal"));
});

Deno.test("bill amount parser keeps decimal cents exact", () => {
  assertEquals(billAmountMinor("10.01"), 1001);
  assertEquals(billAmountMinor("1.1"), 110);
  assertEquals(billAmountMinor("1."), 100);
  for (const text of ["", "-1", "1.001", "1e2", "10000001", "NaN"]) assertEquals(billAmountMinor(text), null);
});

Deno.test("bill links use the guest site and recognize native and app paths", () => {
  const token = "ab".repeat(32);
  assertEquals(billSplitUrl(token), `https://sharedmoney.app/split/${token}`);
  for (const prefix of ["https://sharedmoney.app/", "https://sharedmoney.app/app/", "sharedmoney://"]) {
    assertEquals(extractBillSplitToken(`${prefix}split/${token}`), token);
  }
  for (const path of ["/split", `/join/${token}`, `/split/${token}a`, `/split/${token.toUpperCase()}`, "/split/nope"]) assertEquals(extractBillSplitToken(path), null);
  assertThrows(() => billSplitUrl("bad"));
});
