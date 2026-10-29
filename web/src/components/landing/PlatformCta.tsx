import { Monitor } from "lucide-react";
import { trackCtaClick } from "../../analytics";
import type { PlatformDestination } from "../../landingContent";
import { StoreBadgeLink } from "./StoreBadges";

export function PlatformCta({
  destination,
  placement,
  appearance = "secondary",
  compactLabel,
  showStatus = false,
}: {
  destination: PlatformDestination;
  placement: string;
  appearance?: "primary" | "secondary" | "text" | "inverse";
  compactLabel?: string;
  showStatus?: boolean;
}) {
  if (destination.platform === "android" || destination.platform === "ios") {
    return <StoreBadgeLink destination={destination} placement={placement} />;
  }

  return (
    <a
      href={destination.href}
      target="_blank"
      rel="noopener noreferrer"
      className={`cta cta-${appearance}`}
      aria-label={destination.ariaLabel}
      onClick={() => trackCtaClick(destination, placement)}
    >
      <Monitor size={18} aria-hidden />
      <span className="cta-copy">
        <span className="cta-label">{compactLabel ?? destination.label}</span>
        {showStatus ? <span className="cta-status">{destination.status}</span> : null}
      </span>
    </a>
  );
}
