/** Dev-only shot names for the multi-payer preview. Not used in production. */

export type MultiPayerShot =
  | "add-single"
  | "add-amount"
  | "add-shares"
  | "list"
  | "detail"
  | "balances";

const SHOTS: readonly MultiPayerShot[] = [
  "add-single",
  "add-amount",
  "add-shares",
  "list",
  "detail",
  "balances",
];

function isShot(value: string): value is MultiPayerShot {
  return (SHOTS as readonly string[]).includes(value);
}

export function readMultiPayerShot(url: string | null | undefined): MultiPayerShot {
  if (!url) return "add-single";
  const match = /[?&#]shot=([a-z0-9-]+)/i.exec(url);
  const value = match?.[1]?.toLowerCase() ?? "";
  return isShot(value) ? value : "add-single";
}
