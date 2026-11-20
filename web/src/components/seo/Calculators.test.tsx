import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { platformDestinations } from "../../landingContent";
import { StoreBadges } from "../landing/StoreBadges";
import { pageByPath } from "../../seoPages";
import { calculatorRecordCta, Calculator, SettleUpResult, SplitBillResult } from "./Calculators";

const primaryDestination = platformDestinations.find((destination) => destination.platform === "android");

function expectCalculatorRecordCta(html: string, placement: string) {
  expect(html).toContain(calculatorRecordCta);
  expect(html).toContain(`data-placement="${placement}_android"`);
  expect(html).toContain(`data-placement="${placement}_ios"`);
  expect(html).toContain(`data-placement="${placement}_web"`);
  expect(html).toContain('data-platform="android"');
  expect(html).toContain('data-platform="ios"');
  expect(html).toContain('data-platform="web"');
  expect(html.match(/data-source="calculator"/g)).toHaveLength(3);
  expect(html).toContain("https://play.google.com/store/apps/details?id=com.vaibhavarora.sharemoney");
  expect(html).toContain("https://apps.apple.com/app/id6755923591");
  expect(html).toContain("https://sharedmoney.app/app");
  expect(html.toLowerCase()).not.toContain("splitwise");
}

describe("calculator result install CTA", () => {
  it("offers an in-calculator app CTA before a split-bill result", () => {
    if (!primaryDestination) throw new Error("missing android destination");
    const page = pageByPath.get("/tools/split-bill-calculator");
    if (!page) throw new Error("missing split-bill calculator page");
    const html = renderToStaticMarkup(
      <Calculator page={page} primaryDestination={primaryDestination} />,
    );

    expect(html).toContain("Calculate split");
    expect(html).not.toContain("Total bill");
    expectCalculatorRecordCta(html, "split_bill_form");
  });

  it("offers a shared-record CTA with source=calculator on a split-bill result", () => {
    if (!primaryDestination) throw new Error("missing android destination");
    const html = renderToStaticMarkup(
      <SplitBillResult
        primaryDestination={primaryDestination}
        result={{
          currency: "INR",
          subtotalMinor: 120000,
          feesMinor: 0,
          tipMinor: 0,
          totalMinor: 120000,
          shares: [
            { id: "a", name: "Alex", amountMinor: 60000 },
            { id: "b", name: "Blair", amountMinor: 60000 },
          ],
        }}
      />,
    );

    expect(html).toContain("Alex");
    expect(html).toContain("Blair");
    expect(html).not.toContain("Need to track more than one bill?");
    expect(html).not.toContain("Start a shared ledger in SharedMoney.");
    expectCalculatorRecordCta(html, "split_bill_result");
  });

  it("offers a shared-record CTA with source=calculator on a settle-up result", () => {
    if (!primaryDestination) throw new Error("missing android destination");
    const html = renderToStaticMarkup(
      <SettleUpResult
        primaryDestination={primaryDestination}
        result={{
          currency: "GBP",
          transfers: [{ from: "Blair", to: "Alex", amountMinor: 4200 }],
        }}
      />,
    );

    expect(html).toContain("Blair");
    expect(html).toContain("Alex");
    expect(html).toContain(
      "This is a clear, greedy repayment plan—not a claim that it uses the fewest possible payments.",
    );
    expectCalculatorRecordCta(html, "settle_up_result");
  });

  it("leaves source off store badges that are not the calculator result", () => {
    const html = renderToStaticMarkup(<StoreBadges placement="hero" />);
    expect(html).not.toContain("data-source");
  });
});
