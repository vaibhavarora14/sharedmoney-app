/**
 * Layout constants for consistent styling across the app
 */

/**
 * Maximum width for web layout to ensure premium, centered experience
 * on larger screens while maintaining full-width on mobile devices
 */
export const WEB_MAX_WIDTH = 600;

/** Desktop-only notification panel; tablet and narrow web stay full-route. */
export const WEB_DESKTOP_BREAKPOINT = 1024;

/** Auth switches to its full-width, two-pane web layout at this width. */
export const WEB_AUTH_DESKTOP_BREAKPOINT = 960;

/** Shared screen / overlay motion — calm fade, no bounce (#320). */
export const SCREEN_TRANSITION_MS = 250;

/** Reserve the same trailing space before and after Home balances resolve. */
export const GROUP_BALANCE_SLOT_WIDTH = 120;

export const isDesktopWebViewport = (platform: string, width: number) =>
  platform === "web" && width >= WEB_DESKTOP_BREAKPOINT;

export const isAuthDesktopWebViewport = (platform: string, width: number) =>
  platform === "web" && width >= WEB_AUTH_DESKTOP_BREAKPOINT;
