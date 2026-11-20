export const YOU_OWE_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const YOU_OWE_HIT_LIMIT = 60;
export const YOU_OWE_HIT_WINDOW_MS = 60 * 60 * 1000;

export type PublicYouOweDirection = 'you_owe' | 'owed';

export type PublicYouOweLine = {
  currency: string;
  amount: number;
  direction: PublicYouOweDirection;
};

export type PublicYouOweView = {
  even: boolean;
  amounts: PublicYouOweLine[];
  expires_at: string;
};

export type BalanceLike = {
  participant_id?: string;
  amount: number;
  currency: string;
  user_id?: string;
  email?: string;
  full_name?: string | null;
  avatar_url?: string | null;
};

export function balancesPublicAction(pathname: string): 'you-owe' | 'share-links' | null {
  const parts = pathname.split('/').filter(Boolean);
  const idx = parts.lastIndexOf('balances');
  const rest = idx >= 0 ? parts.slice(idx + 1) : parts;
  if (rest[0] === 'you-owe') return 'you-owe';
  if (rest[0] === 'share-links') return 'share-links';
  return null;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function toPublicYouOweView(
  balances: BalanceLike[],
  viewerParticipantIds: string[],
  expiresAt: string,
): PublicYouOweView {
  const viewers = new Set(viewerParticipantIds.filter(Boolean));
  const amounts: PublicYouOweLine[] = [];
  for (const row of balances) {
    if (!row.participant_id || !viewers.has(row.participant_id)) continue;
    const rounded = Math.round(Number(row.amount) * 100) / 100;
    if (!Number.isFinite(rounded) || Math.abs(rounded) <= 0.01) continue;
    amounts.push({
      currency: row.currency,
      amount: Math.abs(rounded),
      direction: rounded < 0 ? 'you_owe' : 'owed',
    });
  }
  amounts.sort((a, b) => a.currency.localeCompare(b.currency));
  return { even: amounts.length === 0, amounts, expires_at: expiresAt };
}

export function hasPublicYouOwePii(view: PublicYouOweView): boolean {
  const encoded = JSON.stringify(view);
  return /email|full_name|avatar|user_id|participant|group|phone|@/.test(encoded);
}
