/**
 * Labels for balance person rows — informational only (no settle CTA).
 * Positive = they owe you; negative = you owe them.
 */
export function balancePolarityLabel(amount: number): "owed" | "you owe" | "settled" {
  if (amount > 0) return "owed";
  if (amount < 0) return "you owe";
  return "settled";
}

/**
 * Zero-balance copy for group *list* surfaces (#277).
 * Avoids "Settled" while still communicating an even state.
 */
export const GROUP_LIST_EVEN_LABEL = "Even";

/** True when balance rows should hide owe/settled chrome (solo / zero net). */
export function shouldHideBalanceChrome(
  balances: Array<{ amount: number }>,
  activeMemberCount: number,
): boolean {
  if (activeMemberCount <= 1) return true;
  return balances.every((b) => Math.abs(b.amount) < 0.005);
}

type BalancePalette = {
  onTertiaryContainer: string;
  onSecondaryContainer: string;
  secondary: string;
  onSurfaceVariant: string;
};

/**
 * Quieter owe / owed ink for stats and list amounts (#278).
 * Prefers on*Container tokens over saturated brand fills for readable contrast.
 */
export function balanceAmountColor(
  amount: number,
  colors: BalancePalette,
  options?: { dark?: boolean },
): string {
  if (Math.abs(amount) < 0.005) return colors.onSurfaceVariant;
  if (amount > 0) return colors.onTertiaryContainer;
  return options?.dark ? colors.secondary : colors.onSecondaryContainer;
}
