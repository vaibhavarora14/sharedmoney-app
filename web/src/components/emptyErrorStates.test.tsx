import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillLinkUnavailable } from "./BillLinkUnavailable";
import { askForNewLinkLabel } from "./billLinkCopy";
import { ErrorBoundary } from "./ErrorBoundary";
import { NotFoundPage } from "./seo/SeoPageContent";

describe("404 page", () => {
  it("explains the missing page and links home and to the web app", () => {
    const html = renderToStaticMarkup(<NotFoundPage />);
    expect(html).toContain("We can’t find that page");
    expect(html).toContain("Your groups and balances aren’t affected.");
    expect(html).toMatch(/href="\/"[^>]*>Go to SharedMoney home</);
    expect(html).toMatch(/href="\/app"[^>]*>Open web app</);
  });
});

describe("dead bill link", () => {
  it("explains the likely cause and offers next steps", () => {
    const html = renderToStaticMarkup(<BillLinkUnavailable />);
    expect(html).toContain("This bill link isn’t working");
    expect(html).toContain("expired or been deleted by the person who shared it");
    expect(html).toContain("nothing has been paid");
    expect(html).toContain(">Ask for a new link<");
    expect(html).toMatch(/href="\/tools\/split-bill-calculator"[^>]*>Split your own bill</);
    expect(html).toMatch(/href="\/"[^>]*>Go to SharedMoney</);
    expect(html).toMatch(/href="\/app"[^>]*>Create a free account</);
    expect(html).not.toContain("invalid");
  });

  it("names the friend only when known", () => {
    expect(askForNewLinkLabel("Priya")).toBe("Ask Priya for a new link");
    expect(askForNewLinkLabel("  ")).toBe("Ask for a new link");
    expect(askForNewLinkLabel(undefined)).toBe("Ask for a new link");
    expect(renderToStaticMarkup(<BillLinkUnavailable friendName="Priya" />)).toContain(">Ask Priya for a new link<");
  });
});

describe("crash screen", () => {
  it("says what is safe and offers a reload", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error("boom"));
    const html = renderToStaticMarkup(<>{boundary.render()}</>);
    expect(html).toContain("This page stopped working");
    expect(html).toContain("Expenses you already saved are safe.");
    expect(html).toContain(">Reload page<");
    expect(html).not.toContain("boom");
  });
});
