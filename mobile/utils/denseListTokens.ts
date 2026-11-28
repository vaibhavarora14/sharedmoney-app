/**
 * Dense list cards (#549 slice a): compact rows, soft/elevated surfaces, no heavy dividers.
 */
export const DENSE_ROW_MIN_HEIGHT = 64;
export const DENSE_CARD_GAP = 8;
export const DENSE_CARD_RADIUS = 14;
export const DENSE_AVATAR_SIZE = 40;
export const DENSE_STACK_AVATAR_SIZE = 32;
export const DENSE_STACK_OVERLAP = 10;
export const DENSE_STACK_MAX = 3;

export const AVATAR_TONES = [
  "#DCE6FF",
  "#F8E2E8",
  "#DFF6EF",
  "#F3E8FF",
  "#FFF3D6",
] as const;

export const AVATAR_TONE_INK = "#17202A";

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
