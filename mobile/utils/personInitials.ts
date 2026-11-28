/**
 * Initials for dense-list avatars. Shared by people, groups, and ledger rows.
 */
export function personInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (trimmed.includes(" ")) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
  }
  const displayName = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
  if (displayName.length >= 2) {
    return displayName.substring(0, 2).toUpperCase();
  }
  return displayName.length > 0
    ? (displayName[0] + displayName[0]).toUpperCase()
    : "?";
}

const AVATAR_TONE_COUNT = 5;

export function avatarToneIndex(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash + key.charCodeAt(i) * 17) % AVATAR_TONE_COUNT;
  }
  return hash;
}
