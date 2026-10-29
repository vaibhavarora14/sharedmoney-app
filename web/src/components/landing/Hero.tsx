import type { PlatformDestination } from "../../landingContent";
import type { SeoPage } from "../../seoPages";
import { PlatformCta } from "./PlatformCta";
import { HeroAppCard } from "./HeroAppCard";
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
  const webDestination = secondaryDestinations.find((destination) => destination.platform === "web");

  return (
    <section id="product" className="hero">
      <div className="container hero-grid">
        <div className="hero-intro">
          <p className="kicker">{page.eyebrow}</p>
          <h1 className="hero-display">{page.heading}</h1>
          <p className="hero-lead">{page.body}</p>
          <div className="hero-actions">
            <StoreBadges placement="hero" preferPlatform={primaryDestination.platform} />
            {webDestination ? (
              <PlatformCta
                destination={webDestination}
                placement="hero_secondary"
                appearance="text"
              />
            ) : null}
          </div>
        </div>
        <HeroAppCard />
      </div>
    </section>
  );
}
