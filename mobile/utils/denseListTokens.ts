/**
 * Dense list cards (#549): roomier rows, soft/elevated surfaces, no heavy dividers.
 */
export const DENSE_ROW_MIN_HEIGHT = 76;
export const DENSE_CARD_GAP = 12;
export const DENSE_CARD_RADIUS = 14;
export const DENSE_CARD_PADDING_H = 16;
export const DENSE_CARD_PADDING_V = 14;
export const DENSE_AVATAR_SIZE = 36;
export const DENSE_STACK_AVATAR_SIZE = 36;
export const DENSE_STACK_OVERLAP = 4;
export const DENSE_STACK_RING = 2;
export const DENSE_AVATAR_TITLE_GAP = 12;
export const DENSE_TITLE_SUBLINE_GAP = 4;
export const DENSE_TITLE_LINE_HEIGHT = 24;
export const DENSE_SUBLINE_LINE_HEIGHT = 20;
export const DENSE_SECTION_HEADER_PADDING_TOP = 24;
export const DENSE_SECTION_HEADER_PADDING_BOTTOM = 8;
export const DENSE_HOME_HEADER_LINE_GAP = 8;
export const DENSE_HOME_HEADER_BOTTOM = 20;
export const DENSE_STACK_MAX = 3;
/** Home and ledger stacks cap at 2 faces plus a count chip. */
export const DENSE_TX_STACK_MAX = 2;

/** Always reserve 2 faces + a count chip so every title starts at the same x. */
export function denseStackReservedWidth(
  size: number,
  maxVisible: number = DENSE_TX_STACK_MAX,
): number {
  const step = size - DENSE_STACK_OVERLAP;
  return size + maxVisible * step;
}

export const AVATAR_TONES = [
  "#DCE6FF",
  "#F8E2E8",
  "#DFF6EF",
  "#F3E8FF",
  "#FFF3D6",
] as const;

export const AVATAR_TONES_DARK = [
  "#3D4F73",
  "#6B4450",
  "#2F5A4C",
  "#564272",
  "#6B5A32",
] as const;

export const AVATAR_TONE_INK = "#17202A";
export const AVATAR_TONE_INK_DARK = "#F2F4F7";

export function avatarToneFill(dark: boolean, index: number): string {
  const tones = dark ? AVATAR_TONES_DARK : AVATAR_TONES;
  return tones[index] ?? tones[0];
}

export function avatarToneInk(dark: boolean): string {
  return dark ? AVATAR_TONE_INK_DARK : AVATAR_TONE_INK;
}

/** Two letters inside the rendered circle (pass the avatar's own size). */
export function avatarInitialsFontSize(size: number): number {
  return Math.max(9, Math.round(size * 0.3));
}

export function denseCardSurface(theme: {
  dark: boolean;
  colors: {
    surface: string;
    elevation?: { level2?: string };
  };
}): { backgroundColor: string; elevation: 0 | 2 } {
  if (theme.dark) {
    return {
      backgroundColor: theme.colors.elevation?.level2 ?? theme.colors.surface,
      elevation: 2,
    };
  }
  return { backgroundColor: theme.colors.surface, elevation: 0 };
}
