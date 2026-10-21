import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  formatSupportReferenceId,
  generateSupportReferenceId,
  isValidSupportReferenceId,
  SUPPORT_REFERENCE_ALPHABET,
} from "./supportReferenceId.ts";

Deno.test("formatSupportReferenceId groups six chars as SM-XXXX-XX", () => {
  assertEquals(formatSupportReferenceId("7K3Q92"), "SM-7K3Q-92");
});

Deno.test("formatSupportReferenceId rejects wrong length or ambiguous glyphs", () => {
  assertThrows(() => formatSupportReferenceId("7K3Q9"));
  assertThrows(() => formatSupportReferenceId("7K3Q920"));
  assertThrows(() => formatSupportReferenceId("0ABCDE")); // 0 excluded
  assertThrows(() => formatSupportReferenceId("OABCDE")); // O excluded
  assertThrows(() => formatSupportReferenceId("1ABCDE")); // 1 excluded
  assertThrows(() => formatSupportReferenceId("IABCDE")); // I excluded
  assertThrows(() => formatSupportReferenceId("LABCDE")); // L excluded
});

Deno.test("generateSupportReferenceId uses Crockford alphabet without 0/O/1/I/L", () => {
  // Indices: 0→2, 1→3, 29→Z, 9→B, 8→A, 7→9 → SM-23ZB-A9
  const bytes = Uint8Array.from([0, 1, 29, 9, 8, 7]);
  const id = generateSupportReferenceId(bytes);
  assertEquals(id, "SM-23ZB-A9");
  assertEquals(isValidSupportReferenceId(id), true);
  for (const char of id.replace("SM-", "").replace("-", "")) {
    assertEquals(SUPPORT_REFERENCE_ALPHABET.includes(char), true);
  }
  assertEquals(SUPPORT_REFERENCE_ALPHABET.includes("0"), false);
  assertEquals(SUPPORT_REFERENCE_ALPHABET.includes("O"), false);
  assertEquals(SUPPORT_REFERENCE_ALPHABET.includes("1"), false);
  assertEquals(SUPPORT_REFERENCE_ALPHABET.includes("I"), false);
  assertEquals(SUPPORT_REFERENCE_ALPHABET.includes("L"), false);
});

Deno.test("isValidSupportReferenceId accepts examples and rejects junk", () => {
  assertEquals(isValidSupportReferenceId("SM-7K3Q-92"), true);
  assertEquals(isValidSupportReferenceId("sm-7k3q-92"), true);
  assertEquals(isValidSupportReferenceId("SM-7K3Q92"), false);
  assertEquals(isValidSupportReferenceId("SM-0K3Q-92"), false);
  assertEquals(isValidSupportReferenceId("XX-7K3Q-92"), false);
});
