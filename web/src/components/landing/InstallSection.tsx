import type { PlatformDestination } from "../../landingContent";
import { BrandMark } from "./BrandMark";
import { PlatformCta } from "./PlatformCta";
import { StoreBadges } from "./StoreBadges";

export function InstallSection({
  primaryDestination,
  secondaryDestinations,
}: {
  primaryDestination: PlatformDestination;
  secondaryDestinations: PlatformDestination[];
}) {
  const webDestination = secondaryDestinations.find((destination) => destination.platform === "web");

  return (
    <section id="download" className="install-section">
      <div className="container install-shell">
        <div className="install-copy">
          <BrandMark variant="inverse" />
          <div>
            <p className="kicker kicker-inverse">Free to use</p>
            <h2>Start the group. Keep the money part simple.</h2>
            <p>
              Use SharedMoney on the web, or install from Google Play and the App Store.
            </p>
          </div>
        </div>
        <div className="install-actions">
          <StoreBadges placement="download" preferPlatform={primaryDestination.platform} />
          {webDestination ? (
            <div className="install-secondary-actions">
              <PlatformCta
                destination={webDestination}
                placement="download_secondary"
                appearance="text"
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
