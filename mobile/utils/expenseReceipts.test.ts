import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canAddReceipts,
  isAllowedReceiptMime,
  MAX_EXPENSE_RECEIPTS,
  normalizeTransactionReceipts,
  receiptFileExtension,
  receiptObjectPath,
  resizeForReceipt,
} from "./expenseReceipts.ts";

const groupId = "12345678-1234-4123-8123-123456789abc";
const receiptId = "abcdef12-3456-7890-abcd-ef1234567890";

Deno.test("receiptObjectPath is group/transaction/receipt.ext and rejects junk", () => {
  assertEquals(
    receiptObjectPath(groupId, 42, receiptId, "image/jpeg"),
    `${groupId}/42/${receiptId}.jpg`,
  );
  assertEquals(receiptFileExtension("image/png"), "png");
  assertThrows(() => receiptObjectPath("not-a-uuid", 42, receiptId));
  assertThrows(() => receiptObjectPath(groupId, 0, receiptId));
});

Deno.test("mime allowlist and add cap", () => {
  assertEquals(isAllowedReceiptMime("image/jpeg"), true);
  assertEquals(isAllowedReceiptMime("application/pdf"), false);
  assertEquals(canAddReceipts(MAX_EXPENSE_RECEIPTS - 1, 1), true);
  assertEquals(canAddReceipts(MAX_EXPENSE_RECEIPTS, 1), false);
  assertEquals(canAddReceipts(6, 3), false);
});

Deno.test("resizeForReceipt only shrinks the long edge above 1600", () => {
  assertEquals(resizeForReceipt(800, 600), null);
  assertEquals(resizeForReceipt(3200, 1600), { width: 1600 });
  assertEquals(resizeForReceipt(1200, 2400), { width: 800 });
});

Deno.test("normalizeTransactionReceipts drops invalid rows and sorts", () => {
  const receipts = normalizeTransactionReceipts([
    { id: "b", transaction_id: 1, group_id: groupId, storage_path: "x", sort_order: 2 },
    { id: "a", transaction_id: 1, group_id: groupId, storage_path: "y", sort_order: 1 },
    { id: 3 },
  ]);
  assertEquals(receipts.map((item) => item.id), ["a", "b"]);
});
