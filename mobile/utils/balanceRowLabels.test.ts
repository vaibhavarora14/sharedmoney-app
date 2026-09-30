import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  balanceAmountColor,
  balancePolarityLabel,
  GROUP_LIST_EVEN_LABEL,
  shouldHideBalanceChrome,
} from "./balanceRowLabels.ts";

Deno.test("balance polarity labels for person rows", () => {
  assertEquals(balancePolarityLabel(12), "owed");
  assertEquals(balancePolarityLabel(-8), "you owe");
  assertEquals(balancePolarityLabel(0), "settled");
});

Deno.test("hide balance chrome for solo or all-zero", () => {
  assertEquals(shouldHideBalanceChrome([{ amount: 10 }], 1), true);
  assertEquals(shouldHideBalanceChrome([{ amount: 0 }, { amount: 0 }], 3), true);
  assertEquals(shouldHideBalanceChrome([{ amount: 5 }, { amount: -2 }], 3), false);
});

Deno.test("group list zero-balance label avoids Settled", () => {
  assertEquals(GROUP_LIST_EVEN_LABEL, "Even");
  assertEquals(/settled/i.test(GROUP_LIST_EVEN_LABEL), false);
});

Deno.test("balance amount colors prefer quieter on*Container tokens", () => {
  const colors = {
    onTertiaryContainer: "#075E51",
    onSecondaryContainer: "#842A43",
    secondary: "#C95872",
    onSurfaceVariant: "#5B6776",
  };
  assertEquals(balanceAmountColor(12, colors), "#075E51");
  assertEquals(balanceAmountColor(-8, colors), "#842A43");
  assertEquals(balanceAmountColor(-8, colors, { dark: true }), "#C95872");
  assertEquals(balanceAmountColor(0, colors), "#5B6776");
});

// The no-settle-actions product lock is exercised at the component boundary in
// mobile/components/Balances.test.cjs, with settlement callbacks supplied.
