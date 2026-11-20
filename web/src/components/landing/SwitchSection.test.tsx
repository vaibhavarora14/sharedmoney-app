import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SwitchSection, switchFromSplitwiseCtaHref } from "./SwitchSection";

describe("Switching from Splitwise landing section", () => {
  it("leads with no limits, no ads, and Splitwise import, and points to the in-app import", () => {
    const html = renderToStaticMarkup(<SwitchSection />);

    expect(html).toContain('id="switching-from-splitwise"');
    expect(html).toContain("Switching from Splitwise");
    expect(html).toContain("No daily limits. No ads. Bring your groups with you.");
    expect(html).toContain("Unlimited expenses");
    expect(html).toContain("No ads");
    expect(html).toContain("Import your groups");
    expect(html).toContain("Open the group menu and choose Import from Splitwise");
    expect(html).toContain(`href="${switchFromSplitwiseCtaHref.replaceAll("&", "&amp;")}"`);
    expect(html).toContain('href="/splitwise-alternative"');
    expect(html).toContain("UPI");
    expect(html.toLowerCase()).not.toContain("whatsapp");
  });
});
