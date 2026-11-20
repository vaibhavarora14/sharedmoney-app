import { describe, expect, it } from "vitest";
import { pageByPath } from "./seoPages";
import { formatYouOweAmount, youOweHeadline, youOweRoute } from "./youOweApi";

const token = "a".repeat(64);

describe("youOweRoute", () => {
  it("returns undefined for other site routes", () => {
    expect(youOweRoute("/")).toBeUndefined();
    expect(youOweRoute(`/split/${token}`)).toBeUndefined();
    for (const path of pageByPath.keys()) expect(youOweRoute(path)).toBeUndefined();
  });

  it("parses a valid balance link and rejects a malformed one", () => {
    expect(youOweRoute(`/owe/${token}`)).toBe(token);
    expect(youOweRoute(`/owe/${token}/`)).toBe(token);
    expect(youOweRoute("/owe/not-a-token")).toBeNull();
    expect(youOweRoute("/owe")).toBeNull();
  });
});

describe("youOweHeadline", () => {
  it("formats even, single, and multi-currency amounts without names", () => {
    expect(youOweHeadline({ even: true, amounts: [], expires_at: "2026-11-28T00:00:00.000Z" })).toBe("You're even");
    expect(youOweHeadline({
      even: false,
      amounts: [{ currency: "USD", amount: 20.5, direction: "you_owe" }],
      expires_at: "2026-11-28T00:00:00.000Z",
    })).toBe("You owe USD 20.50");
    expect(formatYouOweAmount({ currency: "INR", amount: 500, direction: "owed" })).toBe("INR 500.00");
  });
});
