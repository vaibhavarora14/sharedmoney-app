import { buildParticipantCanonicalResolver } from '../_shared/participant-canonical.ts';
import { isValidUUID } from '../_shared/validation.ts';
import type {
  GroupLedgerSnapshot,
  LedgerParticipant,
  LedgerTransaction,
} from './load-group-ledger.ts';

export interface Balance {
  user_id: string;
  participant_id?: string;
  email?: string;
  full_name?: string | null;
  avatar_url?: string | null;
  amount: number;
  currency: string;
}

export interface GroupBalance {
  group_id: string;
  group_name: string;
  group_kind?: 'standard' | 'direct';
  balances: Balance[];
}

export interface HomeMembershipRow {
  group_id: string;
  status?: string | null;
  hidden_at?: string | null;
}

/**
 * Home totals include every membership row: active, left, and hidden.
 * viewerOverallBalances and Former-section badges sum these groups.
 */
export function membershipGroupIds(rows: HomeMembershipRow[]): string[] {
  return rows.map((row) => row.group_id);
}

function buildParticipantMaps(
  participants: LedgerParticipant[],
  userIdToEmail: Map<string, string>,
) {
  const canonicalParticipantId = buildParticipantCanonicalResolver(
    participants.map((p) => ({
      id: p.id,
      user_id: p.user_id,
      email: p.email,
      type: p.type || 'member',
    })),
    userIdToEmail,
  );

  const participantToUserMap = new Map<string, string>();
  const participantToEmailMap = new Map<string, string>();
  const participantToFullNameMap = new Map<string, string>();
  const participantToAvatarMap = new Map<string, string>();

  const rowsByCanonical = new Map<string, LedgerParticipant[]>();
  for (const p of participants) {
    const cid = canonicalParticipantId(p.id);
    if (!rowsByCanonical.has(cid)) rowsByCanonical.set(cid, []);
    rowsByCanonical.get(cid)!.push(p);
  }
  for (const [cid, rows] of rowsByCanonical) {
    const withUser = rows.find((r) => r.user_id);
    if (withUser?.user_id) participantToUserMap.set(cid, withUser.user_id);
    const emailSource =
      rows.find((r) => r.user_id && r.email) || rows.find((r) => r.email);
    if (emailSource?.email) participantToEmailMap.set(cid, emailSource.email);
    const nameSource =
      rows.find((r) => r.user_id && r.full_name) || rows.find((r) => r.full_name);
    if (nameSource?.full_name) {
      participantToFullNameMap.set(cid, nameSource.full_name);
    }
    const avatarSource =
      rows.find((r) => r.user_id && r.avatar_url) ||
      rows.find((r) => r.avatar_url);
    if (avatarSource?.avatar_url) {
      participantToAvatarMap.set(cid, avatarSource.avatar_url);
    }
  }

  return {
    canonicalParticipantId,
    participantToUserMap,
    participantToEmailMap,
    participantToFullNameMap,
    participantToAvatarMap,
  };
}

export function calculateGroupBalancesFromLedger(
  ledger: GroupLedgerSnapshot,
  userIdToEmail: Map<string, string>,
): Balance[] {
  const {
    canonicalParticipantId,
    participantToUserMap,
    participantToEmailMap,
    participantToFullNameMap,
    participantToAvatarMap,
  } = buildParticipantMaps(ledger.participants, userIdToEmail);

  const balanceMap = new Map<string, Map<string, number>>();

  const updateBalance = (key: string, currency: string, amount: number) => {
    if (!balanceMap.has(key)) {
      balanceMap.set(key, new Map());
    }
    const userBalances = balanceMap.get(key)!;
    const currentAmount = userBalances.get(currency) || 0;
    userBalances.set(currency, currentAmount + amount);
  };

  for (const tx of ledger.transactions) {
    const totalAmount = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount;
    const currency = tx.currency;

    if (isNaN(totalAmount)) continue;

    const paidByPid = tx.paid_by_participant_id;
    if (!paidByPid) continue;

    const paidByKey = canonicalParticipantId(paidByPid);

    if (tx.transaction_splits && Array.isArray(tx.transaction_splits)) {
      const splits = tx.transaction_splits
        .map((s) => {
          if (!s) return undefined;
          const amount = typeof s.amount === 'string' ? parseFloat(s.amount) : s.amount;
          if (!s.participant_id || isNaN(amount)) return undefined;

          return { pid: canonicalParticipantId(s.participant_id), amount };
        })
        .filter((s): s is { pid: string; amount: number } => !!s);

      if (splits.length === 0) continue;

      updateBalance(paidByKey, currency, totalAmount);

      for (const split of splits) {
        updateBalance(split.pid, currency, -split.amount);
      }
    }
  }

  for (const settlement of ledger.settlements) {
    const fromKey = settlement.from_participant_id
      ? canonicalParticipantId(settlement.from_participant_id)
      : null;
    const toKey = settlement.to_participant_id
      ? canonicalParticipantId(settlement.to_participant_id)
      : null;

    if (!fromKey || !toKey) continue;

    const settlementAmount = typeof settlement.amount === 'string'
      ? parseFloat(settlement.amount)
      : settlement.amount;
    const currency = settlement.currency;

    if (isNaN(settlementAmount) || settlementAmount <= 0) continue;

    updateBalance(fromKey, currency, settlementAmount);
    updateBalance(toKey, currency, -settlementAmount);
  }

  const balances: Balance[] = [];

  for (const [key, currencyMap] of balanceMap.entries()) {
    for (const [currency, amount] of currencyMap.entries()) {
      const roundedAmount = Math.round(amount * 100) / 100;
      if (Math.abs(roundedAmount) > 0.01) {
        const userId = participantToUserMap.get(key);
        const email = participantToEmailMap.get(key);
        const fullName = participantToFullNameMap.get(key);
        const avatarUrl = participantToAvatarMap.get(key);

        balances.push({
          user_id: userId || (isValidUUID(key) ? key : ''),
          participant_id: key,
          email: email,
          full_name: fullName || null,
          avatar_url: avatarUrl || null,
          amount: roundedAmount,
          currency: currency,
        });
      }
    }
  }

  return balances;
}

export function participantUserIdsFromLedgers(
  ledgers: Iterable<GroupLedgerSnapshot>,
): string[] {
  const ids = new Set<string>();
  for (const ledger of ledgers) {
    for (const participant of ledger.participants) {
      if (typeof participant.user_id === 'string' && participant.user_id.length > 0) {
        ids.add(participant.user_id);
      }
    }
  }
  return [...ids];
}

export function assembleHomeGroupBalances(input: {
  groupIds: string[];
  groups: Array<{ id: string; name?: string | null; kind?: string | null }>;
  ledgers: Map<string, GroupLedgerSnapshot>;
  userIdToEmail: Map<string, string>;
}): GroupBalance[] {
  const groupMap = new Map(input.groups.map((group) => [group.id, group]));
  return input.groupIds.map((groupId) => {
    const group = groupMap.get(groupId);
    const ledger = input.ledgers.get(groupId) ?? {
      transactions: [] as LedgerTransaction[],
      participants: [] as LedgerParticipant[],
      settlements: [],
    };
    return {
      group_id: groupId,
      group_name: group?.name || 'Unknown Group',
      group_kind: group?.kind === 'direct' ? 'direct' as const : 'standard' as const,
      balances: calculateGroupBalancesFromLedger(ledger, input.userIdToEmail),
    };
  });
}

export function applyEmailAndProfiles(
  balances: Balance[],
  emailMap: Map<string, string>,
  profileMap: Map<string, { full_name: string | null; avatar_url: string | null }>,
): void {
  for (const balance of balances) {
    const profile = balance.user_id ? profileMap.get(balance.user_id) : null;
    if (balance.user_id) {
      const authEmail = emailMap.get(balance.user_id);
      if (authEmail) balance.email = authEmail;
    }
    balance.full_name = profile?.full_name || balance.full_name || null;
    balance.avatar_url = profile?.avatar_url || balance.avatar_url || null;
  }
}
