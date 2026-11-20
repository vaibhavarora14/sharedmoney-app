import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Footer } from "./Footer";

describe("site footer", () => {
  it("links FAQ to the stable /faq path", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toMatch(/<a href="\/faq">FAQ<\/a>/);
  });

  it("links the flatmate landing page", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toMatch(/<a href="\/flatmate-expense-tracker">Flatmate expenses<\/a>/);
  });

  it("links the Splitwise-alternative pages so Google can discover them", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toMatch(/<a href="\/splitwise-alternative">Splitwise alternative<\/a>/);
    expect(html).toMatch(/<a href="\/in\/splitwise-alternative">Splitwise alternative in India<\/a>/);
  });
});
