import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AVATAR_TONES,
  AVATAR_TONES_DARK,
  DENSE_AVATAR_SIZE,
  DENSE_AVATAR_TITLE_GAP,
  DENSE_CARD_GAP,
  DENSE_CARD_PADDING_H,
  DENSE_CARD_PADDING_V,
  DENSE_HOME_HEADER_BOTTOM,
  DENSE_HOME_HEADER_LINE_GAP,
  DENSE_ROW_MIN_HEIGHT,
  DENSE_SECTION_HEADER_PADDING_BOTTOM,
  DENSE_SECTION_HEADER_PADDING_TOP,
  DENSE_STACK_AVATAR_SIZE,
  DENSE_STACK_MAX,
  DENSE_STACK_OVERLAP,
  DENSE_STACK_RING,
  DENSE_TITLE_SUBLINE_GAP,
  DENSE_TX_STACK_MAX,
  avatarInitialsFontSize,
  avatarToneFill,
  avatarToneInk,
  denseStackReservedWidth,
} from "./denseListTokens.ts";

Deno.test("dense cards use roomier row, gap, and avatar tokens", () => {
  assertEquals(DENSE_ROW_MIN_HEIGHT, 76);
  assertEquals(DENSE_CARD_GAP, 12);
  assertEquals(DENSE_CARD_PADDING_H, 16);
  assertEquals(DENSE_CARD_PADDING_V, 14);
  assertEquals(DENSE_AVATAR_SIZE, 36);
  assertEquals(DENSE_STACK_AVATAR_SIZE, 36);
  assertEquals(DENSE_STACK_OVERLAP, 4);
  assertEquals(DENSE_AVATAR_TITLE_GAP, 12);
  assertEquals(DENSE_TITLE_SUBLINE_GAP, 4);
  assertEquals(DENSE_SECTION_HEADER_PADDING_TOP, 24);
  assertEquals(DENSE_SECTION_HEADER_PADDING_BOTTOM, 8);
  assertEquals(DENSE_HOME_HEADER_LINE_GAP, 8);
  assertEquals(DENSE_HOME_HEADER_BOTTOM, 20);
});

Deno.test("transaction stacks cap at two faces plus a count chip", () => {
  assertEquals(DENSE_TX_STACK_MAX, 2);
  assertEquals(DENSE_TX_STACK_MAX < DENSE_STACK_MAX, true);
  assertEquals(DENSE_STACK_OVERLAP < 8, true);
  assertEquals(DENSE_STACK_RING, 2);
  const reserved = denseStackReservedWidth(DENSE_AVATAR_SIZE);
  const step = DENSE_AVATAR_SIZE - DENSE_STACK_OVERLAP;
  assertEquals(reserved, DENSE_AVATAR_SIZE + DENSE_TX_STACK_MAX * step);
});

Deno.test("dark avatars keep a per-person tint, not one shared blue", () => {
  assertEquals(AVATAR_TONES_DARK.length, AVATAR_TONES.length);
  assertEquals(new Set(AVATAR_TONES_DARK).size, AVATAR_TONES_DARK.length);
  assertEquals(avatarToneFill(false, 0), AVATAR_TONES[0]);
  assertEquals(avatarToneFill(true, 0), AVATAR_TONES_DARK[0]);
  assertEquals(avatarToneFill(true, 0) === avatarToneFill(true, 1), false);
  assertEquals(avatarToneInk(true) === avatarToneInk(false), false);
});

Deno.test("initials font shrinks with the inner circle", () => {
  assertEquals(avatarInitialsFontSize(32) <= 10, true);
  assertEquals(avatarInitialsFontSize(40) >= avatarInitialsFontSize(32), true);
});
