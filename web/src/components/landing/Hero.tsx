import type { PlatformDestination } from "../../landingContent";
import type { SeoPage } from "../../seoPages";
import { PlatformCta } from "./PlatformCta";
import { StoreBadges } from "./StoreBadges";

export function Hero({
  primaryDestination,
  secondaryDestinations,
  page,
}: {
  primaryDestination: PlatformDestination;
  secondaryDestinations: PlatformDestination[];
  page: SeoPage;
}) {
  return (
    <section id="product" className="hero">
      <div className="container hero-shell">
        <div className="hero-intro">
          <div className="hero-title-block">
            <p className="kicker">{page.eyebrow}</p>
            <h1>{page.heading}</h1>
            <p className="hero-lead">
              {page.body}
            </p>
            <div className="hero-actions">
              <PlatformCta
                destination={primaryDestination}
                placement="hero_primary"
                appearance="primary"
              />
              <div className="hero-secondary-actions">
                {secondaryDestinations.map((destination) => (
                  <PlatformCta
                    key={destination.platform}
                    destination={destination}
                    placement="hero_secondary"
                    appearance="text"
                  />
                ))}
              </div>
            </div>
            <StoreBadges placement="hero_store" />
            <div className="hero-trust-row" aria-label="SharedMoney highlights">
              {page.proof.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
        </div>

        <figure className="hero-product-shot">
          <img
            src="/app-group-current.png"
            alt="SharedMoney group screen showing balances, summary cards, and transactions"
            width="1080"
            height="2400"
            loading="eager"
            fetchPriority="high"
          />
        </figure>

        <div className="hero-proof-strip" aria-label="How SharedMoney works">
          <div><strong>Add</strong><span>Expense</span></div>
          <div><strong>See</strong><span>Balance</span></div>
          <div><strong>Settle</strong><span>Clearly</span></div>
        </div>
      </div>
    </section>
  );
}
