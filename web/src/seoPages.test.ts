import { describe, expect, it } from "vitest";
import { normalizeSeoPath, pageByPath, relatedPages, seoPages } from "./seoPages";

describe("SEO route content", () => {
  it("has the approved ten indexable routes", () => {
    expect(seoPages).toHaveLength(10);
    expect([...pageByPath.keys()]).toEqual([
      "/",
      "/split-bills",
      "/group-expense-tracker",
      "/trip-expense-splitter",
      "/roommate-expense-tracker",
      "/splitwise-alternative",
      "/in/splitwise-alternative",
      "/tools",
      "/tools/split-bill-calculator",
      "/tools/settle-up-calculator",
    ]);
  });

  it("keeps SharedMoney as the home H1 for Google OAuth brand verification", () => {
    expect(pageByPath.get("/")?.heading).toBe("SharedMoney");
  });

  it("adds the verified trust lead under roommate and Splitwise H1s", () => {
    const lead = "No daily limits on expenses, no ads, no bank link.";
    expect(pageByPath.get("/roommate-expense-tracker")?.lead).toBe(lead);
    expect(pageByPath.get("/splitwise-alternative")?.lead).toBe(lead);
    expect(pageByPath.get("/")?.lead).toBeUndefined();
  });

  it("keeps Splitwise proof cards free of bank-link duplication", () => {
    const proof = pageByPath.get("/splitwise-alternative")?.proof ?? [];
    expect(proof).toContainEqual({
      title: "Settle up your own way",
      body: "Settle outside the app with cash, UPI, or bank transfer, then record it in SharedMoney.",
    });
    expect(
      proof.some(
        (item) =>
          typeof item === "string" &&
          item.toLowerCase().includes("payment instruments"),
      ),
    ).toBe(false);
  });

  it("only resolves known paths and maintains related-page links", () => {
    const splitBills = pageByPath.get("/split-bills");

    expect(normalizeSeoPath("/tools/split-bill-calculator/")).toBe("/tools/split-bill-calculator");
    expect(normalizeSeoPath("/not-a-real-route")).toBeNull();
    expect(splitBills).toBeDefined();
    expect(relatedPages(splitBills!).map((page) => page.id)).toEqual([
      "split-bill-calculator",
      "group-expense-tracker",
      "roommate-expense-tracker",
    ]);
  });
});
