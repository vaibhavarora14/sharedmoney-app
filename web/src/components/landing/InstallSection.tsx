import type { PlatformDestination } from "../../landingContent";
import { BrandMark } from "./BrandMark";
import { PlatformCta } from "./PlatformCta";

export function InstallSection({
  primaryDestination,
  secondaryDestinations,
}: {
  primaryDestination: PlatformDestination;
  secondaryDestinations: PlatformDestination[];
}) {
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
          <PlatformCta
            destination={primaryDestination}
            placement="download_primary"
            appearance="inverse"
          />
          <div className="install-secondary-actions">
            {secondaryDestinations.map((destination) => (
              <PlatformCta
                key={destination.platform}
                destination={destination}
                placement="download_secondary"
                appearance="text"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
