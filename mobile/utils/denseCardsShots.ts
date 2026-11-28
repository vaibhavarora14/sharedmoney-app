export type DenseCardsFrame = "home" | "group" | "transactions";

export function readDenseCardsFrame(href: string | null | undefined): DenseCardsFrame {
  const match = /[?&#]frame=(home|group|transactions)/i.exec(href || "");
  const value = match?.[1]?.toLowerCase();
  if (value === "group" || value === "transactions" || value === "home") {
    return value;
  }
  return "home";
}
