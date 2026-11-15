/**
 * Unique people directory for "add from existing list".
 *
 * Only people the current user has already shared a group with — not a
 * system-wide directory, and not filtered by who added them. A person can
 * appear in several groups as different participant rows; collapse those
 * to one name+email entry using user_id, then email, then name when no
 * other identifier exists.
 */

export const REUSABLE_PARTICIPANT_TYPES = ["member", "former"] as const;

export function isReusableParticipantType(
  type: string | null | undefined,
): boolean {
  return type === "member" || type === "former";
}

export interface ReusablePersonInput {
  id: string;
  user_id?: string | null;
  email?: string | null;
  full_name: string;
}

export interface ReusablePerson {
  id: string;
  full_name: string;
  email: string | null;
}

export function normalizeReusableEmail(
  email?: string | null,
): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeReusableName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Linked accounts often have a blank cached name. Fall back to the email local part. */
export function reusableDisplayName(person: ReusablePersonInput): string {
  const name = person.full_name.trim();
  if (name) return name;
  const email = normalizeReusableEmail(person.email);
  if (!email) return "";
  return email.split("@")[0] || email;
}

/**
 * Name to give a person reused from the directory. Must accept everyone the
 * directory lists, so it shares the directory's email fallback.
 */
export function resolveReuseSourceName(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  return reusableDisplayName({ id: "", full_name: name ?? "", email });
}

function identityKeys(person: ReusablePersonInput): string[] {
  const keys: string[] = [];
  if (person.user_id) keys.push(`user:${person.user_id}`);
  const email = normalizeReusableEmail(person.email);
  if (email) keys.push(`email:${email}`);
  if (keys.length === 0) {
    keys.push(`name:${normalizeReusableName(person.full_name)}`);
  }
  return keys;
}

function richness(person: ReusablePersonInput): number {
  return (person.user_id ? 2 : 0) +
    (normalizeReusableEmail(person.email) ? 1 : 0);
}

export function buildReusablePeopleDirectory(
  people: ReusablePersonInput[],
  options: {
    excludeUserId?: string | null;
    excludePeople?: ReusablePersonInput[];
  } = {},
): ReusablePerson[] {
  const excludedKeys = new Set<string>();
  if (options.excludeUserId) {
    excludedKeys.add(`user:${options.excludeUserId}`);
  }
  for (const person of options.excludePeople ?? []) {
    for (const key of identityKeys(person)) {
      excludedKeys.add(key);
    }
  }

  const chosenByKey = new Map<string, ReusablePersonInput>();

  const forget = (person: ReusablePersonInput) => {
    for (const [key, value] of chosenByKey) {
      if (value === person) chosenByKey.delete(key);
    }
  };

  for (const person of people) {
    const displayName = reusableDisplayName(person);
    if (!displayName) continue;
    if (options.excludeUserId && person.user_id === options.excludeUserId) {
      continue;
    }

    const keys = identityKeys(person);
    if (keys.some((key) => excludedKeys.has(key))) continue;

    const existing = keys
      .map((key) => chosenByKey.get(key))
      .find((value): value is ReusablePersonInput => Boolean(value));
    const winner = !existing || richness(person) > richness(existing)
      ? person
      : existing;

    if (existing && winner !== existing) {
      forget(existing);
    }
    for (const key of identityKeys(winner)) {
      chosenByKey.set(key, winner);
    }
  }

  return Array.from(new Set(chosenByKey.values()))
    .map((person) => ({
      id: person.id,
      full_name: reusableDisplayName(person),
      email: normalizeReusableEmail(person.email),
    }))
    .sort((left, right) => {
      const nameOrder = left.full_name.localeCompare(right.full_name);
      return nameOrder !== 0
        ? nameOrder
        : (left.email ?? "").localeCompare(right.email ?? "");
    });
}
