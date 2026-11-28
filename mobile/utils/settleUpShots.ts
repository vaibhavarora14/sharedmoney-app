export type SettleUpFrame = "plan" | "home" | "pay" | "after" | "transactions";

export function readSettleUpFrame(href: string | null | undefined): SettleUpFrame {
  const match = /[?&#]frame=(plan|home|pay|after|transactions)/i.exec(href || "");
  const value = match?.[1]?.toLowerCase();
  if (
    value === "plan"
    || value === "home"
    || value === "pay"
    || value === "after"
    || value === "transactions"
  ) {
    return value;
  }
  return "plan";
}
