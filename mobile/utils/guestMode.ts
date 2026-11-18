/**
 * Guest-mode rules shared by the app and Deno tests.
 * Enums and counts only. No names, emails, or tokens belong in analytics.
 */

export const GUEST_GROUP_LIMIT = 5;
export const GUEST_EXPENSE_LIMIT = 200;

/**
 * PostHog project 563625. The existing "unique real expense creators" insight
 * counts people who created an expense. Guests must not land in that number.
 *
 * Filter the insight with:
 *   event = expense_created
 *   AND properties.is_guest != true
 *   AND distinct_id is not an internal/seed account
 *
 * Break down by `properties.is_guest` when the weekly review wants guests
 * reported separately. Use the event property, not the person property:
 * after linking, the person `is_guest` flag becomes false, but expenses
 * created while anonymous keep `is_guest = true`.
 *
 * Quick-settle debts (#525) are expense creation for this metric when they
 * emit `expense_created`. This guest work does not emit that event itself.
 */
export const REAL_EXPENSE_CREATORS_FILTER =
  "expense_created where properties.is_guest != true, internal account excluded; break down by properties.is_guest to report guests separately";

export interface GuestUser {
  is_anonymous?: boolean;
}

export function isGuestUser(user: GuestUser | null | undefined): boolean {
  return user?.is_anonymous === true;
}

export function guestEventProps(
  user: GuestUser | null | undefined,
): { is_guest: true } | Record<string, never> {
  return isGuestUser(user) ? { is_guest: true } : {};
}

export type GuestUpgradePath = "link" | "merge" | "failed";

const IDENTITY_CONFLICT_CODES = new Set([
  "identity_already_exists",
  "email_exists",
  "user_already_exists",
  "phone_exists",
]);

export function guestUpgradePath(input: {
  errorCode?: string | null;
  errorMessage?: string | null;
  sameUserId: boolean;
  stillAnonymous: boolean;
}): GuestUpgradePath {
  const code = (input.errorCode ?? "").toLowerCase();
  const message = (input.errorMessage ?? "").toLowerCase();
  const conflict = IDENTITY_CONFLICT_CODES.has(code)
    || message.includes("identity_already_exists")
    || message.includes("already registered")
    || message.includes("email_exists")
    || message.includes("already been registered");
  if (conflict) return "merge";
  if (!input.stillAnonymous && input.sameUserId) return "link";
  if (input.errorCode || input.errorMessage) return "failed";
  return "link";
}

export function guestCollisionName(name: string, taken: readonly string[]): string {
  const norm = (value: string) => value.trim().toLowerCase();
  const used = new Set(taken.map(norm));
  if (!used.has(norm(name))) return name;
  let candidate = `${name} (guest)`;
  let n = 2;
  while (used.has(norm(candidate))) {
    candidate = `${name} (guest ${n})`;
    n += 1;
    if (n > 50) return candidate;
  }
  return candidate;
}

export interface GuestGroupPreview {
  name: string;
  renamed: boolean;
  note: string | null;
}

export function planGuestGroups(
  guestNames: readonly string[],
  existingNames: readonly string[],
): GuestGroupPreview[] {
  const taken = [...existingNames];
  return guestNames.map((name) => {
    const label = guestCollisionName(name, taken);
    taken.push(label);
    const renamed = label !== name;
    return {
      name: label,
      renamed,
      note: renamed ? "Same name, kept separate" : null,
    };
  });
}

export function stripShareLinks(message: string): string {
  const kept = message
    .split("\n")
    .filter((line) => !/https?:\/\//i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return kept;
}

export type GuestSignInAction =
  | "invite"
  | "export"
  | "remind"
  | "share_link"
  | "join"
  | "chip"
  | "cap_groups"
  | "cap_expenses"
  | "profile"
  | "cleanup_banner"
  | "device_warning";

export function guestSignInCopy(action: GuestSignInAction, subject?: string): {
  title: string;
  body: string;
  action: GuestSignInAction;
} {
  const name = subject?.trim() || "them";
  switch (action) {
    case "invite":
      return {
        title: `Sign in to invite ${name}`,
        body: "Invites need an account. Everything you added stays.",
        action,
      };
    case "export":
      return {
        title: `Sign in to export ${name}`,
        body: "Exports need an account. Everything you added stays.",
        action,
      };
    case "remind":
      return {
        title: `Sign in to remind ${name}`,
        body: "Reminders need an account. Everything you added stays.",
        action,
      };
    case "share_link":
      return {
        title: "Sign in to send a link",
        body: "Links need an account. You can still share the balance as text.",
        action,
      };
    case "join":
      return {
        title: "Sign in to join this group",
        body: "Joining a group needs an account. Everything you added stays.",
        action,
      };
    case "chip":
    case "profile":
    case "device_warning":
      return {
        title: "Keep your data",
        body: keepDataBody(subject),
        action,
      };
    case "cap_groups":
      return {
        title: "Sign in to add more",
        body: `A guest can have up to ${GUEST_GROUP_LIMIT} groups.`,
        action,
      };
    case "cap_expenses":
      return {
        title: "Sign in to add more",
        body: `A guest can have up to ${GUEST_EXPENSE_LIMIT} expenses.`,
        action,
      };
    case "cleanup_banner":
      return {
        title: "Keep your data",
        body: "Sign in to keep your groups and expenses.",
        action,
      };
    default: {
      const neverAction: never = action;
      return neverAction;
    }
  }
}

function keepDataBody(counts: string | undefined): string {
  if (!counts || !counts.trim()) {
    return "Sign in to keep your groups and expenses and use them on any device.";
  }
  return `Sign in to keep ${counts.trim()} and use them on any device.`;
}

export function keepDataCounts(groups: number, expenses: number): string {
  const groupLabel = groups === 1 ? "1 group" : `${groups} groups`;
  const expenseLabel = expenses === 1 ? "1 expense" : `${expenses} expenses`;
  return `${groupLabel} and ${expenseLabel}`;
}

/** Day-45 banner. The cleanup flag must be on before this is shown. */
export function guestCleanupBanner(lastActivityAt: Date, now: Date): {
  show: boolean;
  title: string;
  body: string;
} | null {
  const elapsedMs = now.getTime() - lastActivityAt.getTime();
  const elapsedDays = Math.floor(elapsedMs / 86_400_000);
  if (elapsedDays < 45 || elapsedDays >= 60) return null;
  const deletion = new Date(lastActivityAt.getTime() + 60 * 86_400_000);
  const title = `Sign in by ${formatGuestDate(deletion)} to keep your data`;
  return {
    show: true,
    title,
    body: "Unused guest data is deleted after 60 days.",
  };
}

function formatGuestDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Entry flag. An explicit env value wins. With no env value the remote
 * PostHog flag `guest_mode` is required, and a missing flag stays hidden.
 */
export function guestEntryVisible(input: {
  envOverride: boolean | null;
  remoteEnabled: boolean;
}): boolean {
  if (input.envOverride === true) return true;
  if (input.envOverride === false) return false;
  return input.remoteEnabled === true;
}

/** Web anonymous sign-in sends a Turnstile token only when a site key is configured. */
export function shouldRequestGuestCaptcha(siteKey: string | undefined, platform: string): boolean {
  return platform === "web" && Boolean(siteKey?.trim());
}

export function readFlagOverride(
  raw: string | undefined,
): boolean | null {
  const value = raw?.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

/** Cleanup banner and purge both default off. */
export function guestCleanupVisible(input: {
  envOverride: boolean | null;
  remoteEnabled: boolean;
}): boolean {
  return guestEntryVisible(input);
}
