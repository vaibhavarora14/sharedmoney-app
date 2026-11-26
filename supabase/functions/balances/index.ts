import { verifyAuth } from '../_shared/auth.ts';
import { buildParticipantCanonicalResolver } from '../_shared/participant-canonical.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { log } from '../_shared/logger.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { fetchUserEmails } from '../_shared/user-email.ts';
import { fetchUserProfiles } from '../_shared/user-profiles.ts';
import { isValidUUID } from '../_shared/validation.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/env.ts';
import {
  applyEmailAndProfiles,
  assembleHomeGroupBalances,
  calculateGroupBalancesFromLedger,
  participantUserIdsFromLedgers,
  visibleHomeGroupIds,
  type Balance,
  type GroupBalance,
  type HomeMembershipRow,
} from './calculate-group-balances.ts';
import {
  loadGroupLedger,
  loadGroupLedgers,
  type GroupLedgerSnapshot,
  type LedgerParticipant,
  type LedgerTransaction,
} from './load-group-ledger.ts';
import {
  YOU_OWE_HIT_LIMIT,
  YOU_OWE_HIT_WINDOW_MS,
  YOU_OWE_TOKEN_PATTERN,
  balancesPublicAction,
  sha256Hex,
  toPublicYouOweView,
} from './public-you-owe.ts';

interface BalancesResponse {
  group_balances: GroupBalance[];
  overall_balances: Balance[];
  group_stats?: GroupStatsResponse;
}

interface Group {
  id: string;
  name: string;
  kind?: string | null;
}

interface TransactionSplit {
  participant_id?: string | null;
  user_id?: string | null;
  email?: string | null;
  amount: number | string;
}

interface TransactionWithSplits {
  id: number;
  amount: number | string;
  description?: string;
  date?: string;
  type?: string;
  paid_by: string | null;
  paid_by_participant_id?: string | null;
  currency: string;
  split_among?: string[] | null;
  transaction_splits?: TransactionSplit[];
}

interface StatsMemberBreakdownEntry {
  participant_id: string;
  user_id?: string;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  share_totals: Record<string, number>;
  paid_totals: Record<string, number>;
  net_balances: Record<string, number>;
}

interface StatsMyTransactionEntry {
  transaction: TransactionWithSplits;
  share_amount: number | null;
  is_payer: boolean;
  net_receivable: number | null;
}

interface StatsSettlementEdge {
  from_participant_id?: string;
  from_user_id?: string;
  from_full_name?: string | null;
  from_email?: string | null;
  from_avatar_url?: string | null;
  to_participant_id?: string;
  to_user_id?: string;
  to_full_name?: string | null;
  to_email?: string | null;
  to_avatar_url?: string | null;
  amount: number;
  currency: string;
}

interface GroupStatsResponse {
  member_breakdown: StatsMemberBreakdownEntry[];
  my_transactions: StatsMyTransactionEntry[];
  totals: {
    my_share: Record<string, number>;
    group_total: Record<string, number>;
    i_owe: Record<string, number>;
    im_owed: Record<string, number>;
  };
  settlement_plan: StatsSettlementEdge[];
}

/**
 * Balances Edge Function
 *
 * Calculates and returns balances between users in groups:
 * - GET /balances?group_id=xxx - Get balances (optionally filtered by group)
 *
 * Returns both per-group balances and overall balances across all groups.
 *
 * @route /functions/v1/balances
 * @requires Authentication
 */

async function calculateGroupBalances(
  supabase: any,
  groupId: string,
  currentUserId: string,
  currentUserEmail: string | null,
  options?: { includeStatsFields?: boolean; ledger?: GroupLedgerSnapshot }
): Promise<{ balances: Balance[]; ledger: GroupLedgerSnapshot }> {
  const ledger = options?.ledger ?? await loadGroupLedger(supabase, groupId, {
    includeStatsFields: options?.includeStatsFields,
  });

  const participantUserIds: string[] = Array.from(
    new Set(
      ledger.participants
        .map((p) => p.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );
  const userIdToEmail = await fetchUserEmails(
    participantUserIds,
    currentUserId,
    currentUserEmail
  );

  return {
    balances: calculateGroupBalancesFromLedger(ledger, userIdToEmail),
    ledger,
  };
}

function addCurrencyAmount(
  target: Record<string, number>,
  currency: string,
  amount: number
) {
  if (!Number.isFinite(amount)) return;
  target[currency] = Math.round(((target[currency] || 0) + amount) * 100) / 100;
}

function toStatsTransaction(tx: LedgerTransaction): TransactionWithSplits {
  return {
    id: tx.id,
    amount: tx.amount,
    description: tx.description,
    date: tx.date,
    type: tx.type,
    paid_by: null,
    paid_by_participant_id: tx.paid_by_participant_id,
    currency: tx.currency,
    transaction_splits: tx.transaction_splits,
  };
}

function calculateGroupStatsFromLedger(
  ledger: GroupLedgerSnapshot,
  currentUserId: string,
  balances: Balance[]
): GroupStatsResponse {
  const participantMap = new Map<string, LedgerParticipant>();
  for (const p of ledger.participants) {
    participantMap.set(p.id, p);
  }

  const currentParticipantId = ledger.participants.find(
    (p) => p.user_id === currentUserId
  )?.id;

  const memberBreakdownMap = new Map<string, StatsMemberBreakdownEntry>();
  const groupTotal: Record<string, number> = {};
  const myShareTotals: Record<string, number> = {};
  const myTransactions: StatsMyTransactionEntry[] = [];

  const ensureMember = (participantId: string): StatsMemberBreakdownEntry => {
    const existing = memberBreakdownMap.get(participantId);
    if (existing) return existing;

    const participant = participantMap.get(participantId);
    const created: StatsMemberBreakdownEntry = {
      participant_id: participantId,
      user_id: participant?.user_id || undefined,
      email: participant?.email || null,
      full_name: participant?.full_name || null,
      avatar_url: participant?.avatar_url || null,
      share_totals: {},
      paid_totals: {},
      net_balances: {},
    };
    memberBreakdownMap.set(participantId, created);
    return created;
  };

  for (const rawTx of ledger.transactions) {
    const tx = toStatsTransaction(rawTx);
    const amount = typeof tx.amount === 'string' ? Number.parseFloat(tx.amount) : tx.amount;
    const currency = tx.currency || 'USD';
    if (!Number.isFinite(amount)) continue;

    addCurrencyAmount(groupTotal, currency, amount);

    if (tx.paid_by_participant_id) {
      const payerEntry = ensureMember(tx.paid_by_participant_id);
      addCurrencyAmount(payerEntry.paid_totals, currency, amount);
    }

    const splits = (tx.transaction_splits || [])
      .map((split) => ({
        participant_id: split.participant_id || null,
        amount: typeof split.amount === 'string'
          ? Number.parseFloat(split.amount)
          : split.amount,
      }))
      .filter((split) => split.participant_id && Number.isFinite(split.amount)) as Array<{ participant_id: string; amount: number }>;

    for (const split of splits) {
      const splitEntry = ensureMember(split.participant_id);
      addCurrencyAmount(splitEntry.share_totals, currency, split.amount);
    }

    const mySplitAmount = currentParticipantId
      ? (splits.find((split) => split.participant_id === currentParticipantId)?.amount ?? null)
      : null;
    const isPayer = !!(currentParticipantId && tx.paid_by_participant_id === currentParticipantId);
    const involved = isPayer || mySplitAmount !== null;

    if (involved) {
      if (mySplitAmount !== null) {
        addCurrencyAmount(myShareTotals, currency, mySplitAmount);
      }
      myTransactions.push({
        transaction: tx,
        share_amount: mySplitAmount,
        is_payer: isPayer,
        net_receivable: isPayer ? Math.round((amount - (mySplitAmount || 0)) * 100) / 100 : null,
      });
    }
  }

  for (const balance of balances) {
    if (!balance.participant_id) continue;
    const entry = ensureMember(balance.participant_id);
    addCurrencyAmount(entry.net_balances, balance.currency, balance.amount);
  }

  const iOwe: Record<string, number> = {};
  const imOwed: Record<string, number> = {};
  const myBalances = balances.filter((balance) => (
    (currentParticipantId && balance.participant_id === currentParticipantId)
    || balance.user_id === currentUserId
  ));
  for (const balance of myBalances) {
    if (balance.amount < 0) {
      addCurrencyAmount(iOwe, balance.currency, Math.abs(balance.amount));
    } else if (balance.amount > 0) {
      addCurrencyAmount(imOwed, balance.currency, balance.amount);
    }
  }

  const settlementPlan: StatsSettlementEdge[] = [];
  const balancesByCurrency = new Map<string, Balance[]>();
  for (const balance of balances) {
    if (!balancesByCurrency.has(balance.currency)) {
      balancesByCurrency.set(balance.currency, []);
    }
    balancesByCurrency.get(balance.currency)!.push(balance);
  }

  for (const [currency, currencyBalances] of balancesByCurrency) {
    const debtors = currencyBalances
      .filter((balance) => balance.amount < -0.01)
      .map((balance) => ({ ...balance, amount: Math.abs(balance.amount) }))
      .sort((a, b) => b.amount - a.amount);
    const creditors = currencyBalances
      .filter((balance) => balance.amount > 0.01)
      .map((balance) => ({ ...balance }))
      .sort((a, b) => b.amount - a.amount);

    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const debtor = debtors[debtorIndex];
      const creditor = creditors[creditorIndex];
      const amount = Math.min(debtor.amount, creditor.amount);

      settlementPlan.push({
        from_participant_id: debtor.participant_id,
        from_user_id: debtor.user_id,
        from_full_name: debtor.full_name || null,
        from_email: debtor.email || null,
        from_avatar_url: debtor.avatar_url || null,
        to_participant_id: creditor.participant_id,
        to_user_id: creditor.user_id,
        to_full_name: creditor.full_name || null,
        to_email: creditor.email || null,
        to_avatar_url: creditor.avatar_url || null,
        amount: Math.round(amount * 100) / 100,
        currency,
      });

      debtor.amount = Math.round((debtor.amount - amount) * 100) / 100;
      creditor.amount = Math.round((creditor.amount - amount) * 100) / 100;
      if (debtor.amount <= 0.01) debtorIndex += 1;
      if (creditor.amount <= 0.01) creditorIndex += 1;
    }
  }

  return {
    member_breakdown: Array.from(memberBreakdownMap.values()),
    my_transactions: myTransactions,
    totals: {
      my_share: myShareTotals,
      group_total: groupTotal,
      i_owe: iOwe,
      im_owed: imOwed,
    },
    settlement_plan: settlementPlan,
  };
}

function serviceRoleClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Service role is not configured');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function servePublicYouOwe(req: Request): Promise<Response> {
  const unavailable = () => createSuccessResponse(null, 200, 0, req);
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!YOU_OWE_TOKEN_PATTERN.test(token)) return unavailable();

  try {
    const supabase = serviceRoleClient();
    const { data: flag } = await supabase
      .from('app_feature_flags')
      .select('enabled')
      .eq('key', 'public_you_owe')
      .maybeSingle();
    if (!flag?.enabled) return unavailable();

    const tokenHash = await sha256Hex(token);
    const { data: link } = await supabase
      .from('balance_share_links')
      .select('group_id, viewer_participant_id, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (!link || link.revoked_at || new Date(link.expires_at).getTime() <= Date.now()) {
      return unavailable();
    }

    await supabase.from('balance_share_link_hits').insert({ token_hash: tokenHash });
    const windowStart = new Date(Date.now() - YOU_OWE_HIT_WINDOW_MS).toISOString();
    const { count } = await supabase
      .from('balance_share_link_hits')
      .select('*', { count: 'exact', head: true })
      .eq('token_hash', tokenHash)
      .gte('hit_at', windowStart);
    if ((count || 0) > YOU_OWE_HIT_LIMIT) return unavailable();

    const { balances, ledger } = await calculateGroupBalances(
      supabase,
      link.group_id,
      '',
      null,
    );
    const canonicalParticipantId = buildParticipantCanonicalResolver(
      ledger.participants.map((person) => ({
        id: person.id,
        user_id: person.user_id,
        email: person.email,
        type: person.type || 'member',
      })),
      new Map(),
    );
    const viewerCanonical = canonicalParticipantId(link.viewer_participant_id);
    const viewerIds = Array.from(new Set([
      link.viewer_participant_id,
      viewerCanonical,
      ...ledger.participants
        .filter((person) => canonicalParticipantId(person.id) === viewerCanonical)
        .map((person) => person.id),
    ]));
    return createSuccessResponse(
      toPublicYouOweView(balances, viewerIds, link.expires_at),
      200,
      0,
      req,
    );
  } catch (error) {
    log.error('Public you-owe lookup failed', 'balances', {
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailable();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return createEmptyResponse(200, req);
  }

  const publicAction = balancesPublicAction(new URL(req.url).pathname);
  if (publicAction === 'you-owe') {
    if (req.method !== 'GET') {
      return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
    }
    return await servePublicYouOwe(req);
  }

  try {
    let authResult;
    try {
      authResult = await verifyAuth(req);
    } catch (authError) {
      return handleError(authError, 'authentication', req);
    }

    const { user, supabase } = authResult;
    const currentUserId = user.id;
    const currentUserEmail = user.email;

    const url = new URL(req.url);
    const groupId = url.searchParams.get('group_id');
    const includeStats = url.searchParams.get('include_stats') === 'true';

    if (groupId && !isValidUUID(groupId)) {
      return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
    }

    if (includeStats && !groupId) {
      return createErrorResponse(400, 'group_id is required when include_stats=true', 'VALIDATION_ERROR', undefined, req);
    }

    // Single-group path (group details critical path): membership + group row in
    // parallel, then one parallel ledger load reused for balances and stats.
    if (groupId) {
      const [membershipResult, groupResult] = await Promise.all([
        supabase
          .from('group_members')
          .select('group_id')
          .eq('group_id', groupId)
          .eq('user_id', currentUserId)
          .maybeSingle(),
        supabase
          .from('groups')
          .select('id, name, kind')
          .eq('id', groupId)
          .maybeSingle(),
      ]);

      if (!membershipResult.data) {
        return createSuccessResponse({
          group_balances: [],
          overall_balances: [],
        }, 200, 0, req);
      }

      const groupName = groupResult.data?.name || 'Unknown Group';

      let balances: Balance[] = [];
      let ledger: GroupLedgerSnapshot | null = null;
      try {
        const result = await calculateGroupBalances(
          supabase,
          groupId,
          currentUserId,
          currentUserEmail ?? null,
          { includeStatsFields: includeStats }
        );
        balances = result.balances;
        ledger = result.ledger;
      } catch (error) {
        log.error('Error calculating group balances', 'balances', {
          groupId,
          error: error instanceof Error ? error.message : String(error),
        });
        balances = [];
      }

      const groupBalances: GroupBalance[] = [{
        group_id: groupId,
        group_name: groupName,
        group_kind: groupResult.data?.kind === 'direct' ? 'direct' : 'standard',
        balances,
      }];

      const overallBalanceMap = new Map<string, number>();
      for (const balance of balances) {
        if (balance.user_id !== currentUserId) continue;
        const current = overallBalanceMap.get(balance.currency) || 0;
        overallBalanceMap.set(balance.currency, current + balance.amount);
      }
      const overallBalances: Balance[] = [];
      for (const [currency, amount] of overallBalanceMap.entries()) {
        const roundedAmount = Math.round(amount * 100) / 100;
        if (Math.abs(roundedAmount) > 0.01) {
          overallBalances.push({
            user_id: currentUserId,
            amount: roundedAmount,
            currency,
          });
        }
      }

      const allUserIds = new Set<string>();
      for (const b of balances) {
        if (b.user_id) allUserIds.add(b.user_id);
      }
      for (const b of overallBalances) {
        allUserIds.add(b.user_id);
      }

      if (allUserIds.size > 0) {
        // Emails were already loaded inside calculateGroupBalances. A second
        // auth-admin lookup here doubled latency on every group-details open.
        const profileMap = await fetchUserProfiles(supabase, Array.from(allUserIds));
        applyEmailAndProfiles(balances, new Map(), profileMap);
        applyEmailAndProfiles(overallBalances, new Map(), profileMap);
      }

      const response: BalancesResponse = {
        group_balances: groupBalances,
        overall_balances: overallBalances,
      };

      if (includeStats && ledger) {
        response.group_stats = calculateGroupStatsFromLedger(
          ledger,
          currentUserId,
          balances
        );
      }

      return createSuccessResponse(response, 200, 0, req);
    }

    const { data: memberships, error: membershipError } = await supabase
      .from('group_members')
      .select('group_id, status, hidden_at')
      .eq('user_id', currentUserId);
    if (membershipError) {
      return handleError(membershipError, 'fetching group memberships', req);
    }

    const targetGroupIds = visibleHomeGroupIds((memberships || []) as HomeMembershipRow[]);

    if (targetGroupIds.length === 0) {
      return createSuccessResponse({
        group_balances: [],
        overall_balances: [],
      }, 200, 0, req);
    }

    const [groupsResult, ledgers] = await Promise.all([
      supabase
        .from('groups')
        .select('id, name, kind')
        .in('id', targetGroupIds),
      loadGroupLedgers(supabase, targetGroupIds),
    ]);
    if (groupsResult.error) {
      return handleError(groupsResult.error, 'fetching groups for balances', req);
    }

    const participantUserIds = participantUserIdsFromLedgers(ledgers.values());
    const lookupIds = participantUserIds.includes(currentUserId)
      ? participantUserIds
      : [...participantUserIds, currentUserId];
    const [emailMap, profileMap] = await Promise.all([
      fetchUserEmails(lookupIds, currentUserId, currentUserEmail ?? null),
      fetchUserProfiles(supabase, lookupIds),
    ]);

    const groupBalances = assembleHomeGroupBalances({
      groupIds: targetGroupIds,
      groups: (groupsResult.data || []) as Group[],
      ledgers,
      userIdToEmail: emailMap,
    });

    const overallBalanceMap = new Map<string, Map<string, number>>();

    for (const groupBalance of groupBalances) {
      applyEmailAndProfiles(groupBalance.balances, emailMap, profileMap);
      for (const balance of groupBalance.balances) {
        if (!overallBalanceMap.has(balance.user_id)) {
          overallBalanceMap.set(balance.user_id, new Map());
        }
        const userBalances = overallBalanceMap.get(balance.user_id)!;
        const current = userBalances.get(balance.currency) || 0;
        userBalances.set(balance.currency, current + balance.amount);
      }
    }

    const overallBalances: Balance[] = [];
    for (const [userId, currencyMap] of overallBalanceMap.entries()) {
      if (userId !== currentUserId) continue;

      for (const [currency, amount] of currencyMap.entries()) {
        const roundedAmount = Math.round(amount * 100) / 100;
        if (Math.abs(roundedAmount) > 0.01) {
          overallBalances.push({
            user_id: userId,
            amount: roundedAmount,
            currency: currency
          });
        }
      }
    }
    applyEmailAndProfiles(overallBalances, emailMap, profileMap);

    const response: BalancesResponse = {
      group_balances: groupBalances,
      overall_balances: overallBalances,
    };

    return createSuccessResponse(response, 200, 0, req);
  } catch (error: unknown) {
    return handleError(error, 'balances handler', req);
  }
});
