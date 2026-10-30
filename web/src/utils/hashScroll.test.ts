import { describe, expect, it, vi } from "vitest";
import { hashTargetId, scrollToHashTarget } from "./hashScroll";

describe("hashTargetId", () => {
  it("returns null for empty hashes", () => {
    expect(hashTargetId("")).toBeNull();
    expect(hashTargetId("#")).toBeNull();
  });

  it("strips the leading # and decodes", () => {
    expect(hashTargetId("#faq")).toBe("faq");
    expect(hashTargetId("#caf%C3%A9")).toBe("café");
  });

  it("keeps malformed encodings as-is", () => {
    expect(hashTargetId("#%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("scrollToHashTarget", () => {
  it("scrolls the matching element to the top using CSS scroll behavior", () => {
    const scrollIntoView = vi.fn();
    const getElementById = vi.fn(() => ({ scrollIntoView }));

    expect(scrollToHashTarget("#faq", { getElementById })).toBe(true);
    expect(getElementById).toHaveBeenCalledWith("faq");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("does nothing without a hash or a matching element", () => {
    const getElementById = vi.fn(() => null);

    expect(scrollToHashTarget("", { getElementById })).toBe(false);
    expect(getElementById).not.toHaveBeenCalled();
    expect(scrollToHashTarget("#missing", { getElementById })).toBe(false);
  });
});
