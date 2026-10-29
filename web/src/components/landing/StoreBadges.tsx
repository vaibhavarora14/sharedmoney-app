import { trackCtaClick } from "../../analytics";
import {
  platformDestinations,
  type Platform,
  type PlatformDestination,
} from "../../landingContent";

const androidDestination = platformDestinations.find(
  (destination) => destination.platform === "android",
)!;
const iosDestination = platformDestinations.find(
  (destination) => destination.platform === "ios",
)!;

const badgeAssets: Record<
  Exclude<Platform, "web">,
  { src: string; alt: string; width: number; height: number }
> = {
  android: {
    src: "/badges/google-play-badge.svg",
    alt: "Get it on Google Play",
    // Official English SVG viewBox 238.96 × 70.87
    width: 239,
    height: 71,
  },
  ios: {
    src: "/badges/app-store-badge.svg",
    alt: "Download on the App Store",
    // Official US/UK black SVG viewBox 119.66407 × 40
    width: 120,
    height: 40,
  },
};

export function StoreBadgeLink({
  destination,
  placement,
}: {
  destination: PlatformDestination;
  placement: string;
}) {
  if (destination.platform === "web") {
    return null;
  }

  const badge = badgeAssets[destination.platform];

  return (
    <a
      className={`store-badge store-badge-${destination.platform}`}
      href={destination.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackCtaClick(destination, placement)}
    >
      <img
        src={badge.src}
        alt={badge.alt}
        width={badge.width}
        height={badge.height}
        loading="lazy"
        decoding="async"
      />
    </a>
  );
}

/** Official Google Play + App Store badges. Optional preferPlatform puts that store first. */
export function StoreBadges({
  placement,
  preferPlatform,
}: {
  placement: string;
  preferPlatform?: Platform;
}) {
  const ordered =
    preferPlatform === "ios"
      ? [iosDestination, androidDestination]
      : [androidDestination, iosDestination];

  return (
    <div className="store-badges" aria-label="Download SharedMoney">
      {ordered.map((destination) => (
        <StoreBadgeLink
          key={destination.platform}
          destination={destination}
          placement={`${placement}_${destination.platform}`}
        />
      ))}
    </div>
  );
}
