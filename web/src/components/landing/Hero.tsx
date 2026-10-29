import type { PlatformDestination } from "../../landingContent";
import type { SeoPage } from "../../seoPages";
import { PlatformCta } from "./PlatformCta";
import { HeroAppCard } from "./HeroAppCard";

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
      <div className="container hero-grid">
        <div className="hero-intro">
          <p className="kicker">{page.eyebrow}</p>
          <h1 className="hero-display">{page.heading}</h1>
          <p className="hero-lead">{page.body}</p>
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
        </div>
        <HeroAppCard />
      </div>
    </section>
  );
}
