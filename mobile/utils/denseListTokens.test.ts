import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AVATAR_TONES,
  AVATAR_TONES_DARK,
  DENSE_AVATAR_SIZE,
  DENSE_STACK_MAX,
  DENSE_STACK_OVERLAP,
  DENSE_STACK_RING,
  DENSE_TX_STACK_MAX,
  avatarInitialsFontSize,
  avatarToneFill,
  avatarToneInk,
  denseStackReservedWidth,
} from "./denseListTokens.ts";

Deno.test("transaction stacks cap at two faces plus a count chip", () => {
  assertEquals(DENSE_TX_STACK_MAX, 2);
  assertEquals(DENSE_TX_STACK_MAX < DENSE_STACK_MAX, true);
  assertEquals(DENSE_STACK_OVERLAP <= 8, true);
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
