/** Minimal shape of the element we scroll to, so the helper is testable without a DOM. */
type ScrollTarget = Pick<Element, "scrollIntoView">;

type HashLookup = {
  getElementById(id: string): ScrollTarget | null;
};

/** Decode a location hash ("#faq") into an element id, or null when there is none. */
export function hashTargetId(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) {
    return null;
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Scroll to the element named by the location hash, if it exists.
 *
 * The marketing page renders client-side, so the browser's own fragment scroll
 * runs before targets like `#faq` exist. `scrollIntoView` with the default
 * `behavior: "auto"` follows the CSS `scroll-behavior` (smooth, or instant under
 * `prefers-reduced-motion`) and honours `scroll-padding-top` / `scroll-margin`.
 */
export function scrollToHashTarget(hash: string, lookup: HashLookup): boolean {
  const id = hashTargetId(hash);
  if (!id) {
    return false;
  }

  const target = lookup.getElementById(id);
  if (!target) {
    return false;
  }

  target.scrollIntoView({ block: "start" });
  return true;
}
