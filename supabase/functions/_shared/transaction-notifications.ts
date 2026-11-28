import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { formatCurrency } from './currency.ts';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from './env.ts';
import { log } from './logger.ts';
import { transactionNotificationsEnabled } from './posthog-feature-flags.ts';
import {
  buildNotificationImpacts,
  type ExpenseSnapshot,
  type FinancialPosition,
  type NotificationAction,
} from './notification-impact.ts';

interface TransactionRow {
  id: number;
  group_id: string | null;
  description: string;
  type: 'expense' | 'income';
  amount: number | string;
  currency: string | null;
  paid_by_participant_id: string | null;
  transaction_splits?: Array<{
    participant_id: string | null;
    amount: number | string;
  }>;
  transaction_payers?: Array<{
    participant_id: string | null;
    amount: number | string;
  }>;
}

interface FanoutInput {
  actorUserId: string;
  action: NotificationAction;
  before: ExpenseSnapshot | null;
  after: ExpenseSnapshot | null;
  operationStartedAt: string;
}

function createAdminClient(): SupabaseClient | null {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    log.warn('Service role key is unavailable; notification fan-out skipped', 'transaction-notifications');
    return null;
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function loadExpenseSnapshot(
  supabase: SupabaseClient,
  transactionId: number,
): Promise<ExpenseSnapshot | null> {
  const { data: transaction, error } = await supabase
    .from('transactions')
    .select(`
      id,
      group_id,
      description,
      type,
      amount,
      currency,
      paid_by_participant_id,
      transaction_splits(participant_id, amount),
      transaction_payers(participant_id, amount)
    `)
    .eq('id', transactionId)
    .single();

  if (error || !transaction?.group_id) return null;

  const row = transaction as TransactionRow;
  const groupId = row.group_id;
  if (!groupId) return null;
  const participantIds = new Set<string>();
  if (row.paid_by_participant_id) participantIds.add(row.paid_by_participant_id);
  for (const split of row.transaction_splits ?? []) {
    if (split.participant_id) participantIds.add(split.participant_id);
  }
  for (const payer of row.transaction_payers ?? []) {
    if (payer.participant_id) participantIds.add(payer.participant_id);
  }

  const [{ data: group }, participantsResult] = await Promise.all([
    supabase.from('groups').select('name').eq('id', groupId).single(),
    participantIds.size > 0
      ? supabase
        .from('participants')
        .select('id, user_id')
        .in('id', [...participantIds])
      : Promise.resolve({ data: [], error: null }),
  ]);

  const userByParticipant = new Map<string, string | null>();
  for (const participant of participantsResult.data ?? []) {
    userByParticipant.set(participant.id, participant.user_id ?? null);
  }

  const sharesByParticipant = new Map<string, number>();
  for (const split of row.transaction_splits ?? []) {
    if (!split.participant_id) continue;
    sharesByParticipant.set(
      split.participant_id,
      (sharesByParticipant.get(split.participant_id) ?? 0) + Number(split.amount),
    );
  }

  const payers = (row.transaction_payers ?? [])
    .filter((payer): payer is { participant_id: string; amount: number | string } => !!payer.participant_id)
    .map((payer) => ({
      participantId: payer.participant_id,
      amount: Number(payer.amount),
    }))
    .filter((payer) => Number.isFinite(payer.amount));

  return {
    id: row.id,
    groupId,
    groupName: group?.name?.trim() || 'Group',
    description: row.description.trim(),
    type: row.type,
    amount: Number(row.amount),
    currency: row.currency || 'USD',
    payerParticipantId: payers[0]?.participantId ?? row.paid_by_participant_id,
    payers,
    participants: [...participantIds].map((participantId) => ({
      participantId,
      userId: userByParticipant.get(participantId) ?? null,
      share: sharesByParticipant.get(participantId) ?? 0,
    })),
  };
}

function shareFrom(position: FinancialPosition | null): number | null {
  return position ? position.netMinor / 100 : null;
}

function buildSignedMoneyChange(
  before: FinancialPosition | null,
  after: FinancialPosition | null,
): string {
  const beforeMinor = before?.netMinor ?? 0;
  const afterMinor = after?.netMinor ?? 0;
  const crossCurrency = before?.currency && after?.currency && before.currency !== after.currency;
  const currency = after?.currency ?? before?.currency ?? "USD";
  const amountMinor = crossCurrency ? afterMinor : afterMinor - beforeMinor;
  const formatted = formatCurrency(Math.abs(amountMinor) / 100, currency);

  if (amountMinor > 0) return `+${formatted}`;
  if (amountMinor < 0) return `−${formatted}`;
  return formatted;
}

function buildBody(
  action: NotificationAction,
  actorName: string,
  description: string,
  before: FinancialPosition | null,
  after: FinancialPosition | null,
): string {
  const verb = action === 'created' ? 'added' : action === 'updated' ? 'updated' : 'deleted';
  return `${actorName} ${verb} ${description} · ${buildSignedMoneyChange(before, after)}`;
}

function buildTitle(actorName: string, action: NotificationAction, description: string): string {
  const verb = action === 'created' ? 'added' : action === 'updated' ? 'updated' : 'deleted';
  return `${actorName} ${verb} ${description}`.slice(0, 240);
}

async function ensureHistorySource(
  admin: SupabaseClient,
  input: FanoutInput,
  canonical: ExpenseSnapshot,
): Promise<string> {
  let query = admin
    .from('transaction_history')
    .select('id, changed_at')
    .eq('activity_type', 'transaction')
    .eq('action', input.action)
    .eq('changed_by', input.actorUserId)
    .eq('group_id', canonical.groupId)
    .gte('changed_at', input.operationStartedAt)
    .order('changed_at', { ascending: false })
    .limit(1);

  query = input.action === 'deleted'
    ? query.contains('snapshot', { id: canonical.id })
    : query.eq('transaction_id', canonical.id);

  const { data: histories, error } = await query;
  if (!error && histories?.[0]?.id) return histories[0].id;

  // Split-only changes do not touch the transactions row, so the legacy audit
  // trigger cannot see them. Create one canonical activity/history source.
  const { data: history, error: insertError } = await admin
    .from('transaction_history')
    .insert({
      transaction_id: input.action === 'deleted' ? null : canonical.id,
      activity_type: 'transaction',
      group_id: canonical.groupId,
      action: input.action,
      changed_by: input.actorUserId,
      changes: {
        action: input.action,
        notification_financial_change: true,
        transaction_id: canonical.id,
      },
      snapshot: {
        id: canonical.id,
        group_id: canonical.groupId,
        description: canonical.description,
        type: canonical.type,
        amount: canonical.amount,
        currency: canonical.currency,
        paid_by_participant_id: canonical.payerParticipantId,
        payers: canonical.payers ?? [],
      },
    })
    .select('id')
    .single();

  if (insertError || !history) {
    throw new Error(`Unable to resolve notification history source: ${insertError?.message ?? error?.message ?? 'unknown error'}`);
  }
  return history.id;
}

export async function createTransactionNotifications(input: FanoutInput): Promise<number> {
  const canonical = input.after ?? input.before;
  if (!canonical?.groupId) return 0;

  const impacts = buildNotificationImpacts(input);
  if (impacts.length === 0) return 0;

  const admin = createAdminClient();
  if (!admin) return 0;

  const [historyId, actorProfileResult, blockedResult] = await Promise.all([
    ensureHistorySource(admin, input, canonical),
    admin.from('profiles').select('full_name, avatar_url').eq('id', input.actorUserId).maybeSingle(),
    admin
      .from('user_blocks')
      .select('blocker_id')
      .eq('blocked_user_id', input.actorUserId)
      .in('blocker_id', impacts.map((impact) => impact.userId)),
  ]);

  const actorName = actorProfileResult.data?.full_name?.trim() || 'Someone';
  if (blockedResult.error) {
    throw new Error(`Unable to apply notification block visibility: ${blockedResult.error.message}`);
  }
  const blockedRecipients = new Set(
    (blockedResult.data ?? []).map((row: { blocker_id: string }) => row.blocker_id),
  );
  const eventType = `transaction_${input.action}`;
  const visibleImpacts = impacts.filter((impact) => !blockedRecipients.has(impact.userId));
  const enabledRecipientIds = new Set(
    (await Promise.all(visibleImpacts.map(async (impact) => {
      const { data, error } = await admin.auth.admin.getUserById(impact.userId);
      if (error || !data.user) return null;
      return await transactionNotificationsEnabled(impact.userId, data.user.email)
        ? impact.userId
        : null;
    }))).filter((userId): userId is string => userId !== null),
  );

  const rows = visibleImpacts
    .filter((impact) => enabledRecipientIds.has(impact.userId))
    .map((impact) => {
      const beforeShare = shareFrom(impact.before);
      const afterShare = shareFrom(impact.after);
      return {
        recipient_user_id: impact.userId,
        actor_user_id: input.actorUserId,
        group_id: canonical.groupId,
        transaction_id: input.action === 'deleted' ? null : canonical.id,
        transaction_reference_id: canonical.id,
        source_history_id: historyId,
        event_type: eventType,
        title: buildTitle(actorName, input.action, canonical.description),
        body: buildBody(input.action, actorName, canonical.description, impact.before, impact.after),
        snapshot: {
          version: 1,
          action: input.action,
          actor: {
            id: input.actorUserId,
            name: actorName,
            avatar_url: actorProfileResult.data?.avatar_url ?? null,
          },
          group: { id: canonical.groupId, name: canonical.groupName },
          transaction: {
            id: canonical.id,
            description: canonical.description,
            type: canonical.type,
            amount: canonical.amount,
            currency: canonical.currency,
            deleted: input.action === 'deleted',
          },
          impact: {
            before: impact.before,
            after: impact.after,
            before_share: beforeShare,
            after_share: afterShare,
            share_delta: beforeShare === null || afterShare === null
              ? null
              : afterShare - beforeShare,
          },
        },
      };
    });

  if (rows.length === 0) return 0;
  const { error: insertError } = await admin
    .from('notifications')
    .upsert(rows, { onConflict: 'recipient_user_id,source_history_id', ignoreDuplicates: true });

  if (insertError) throw new Error(`Notification fan-out failed: ${insertError.message}`);
  return rows.length;
}

export async function safelyCreateTransactionNotifications(input: FanoutInput): Promise<void> {
  try {
    await createTransactionNotifications(input);
  } catch (error) {
    log.error('Notification fan-out failed after transaction mutation', 'transaction-notifications', {
      action: input.action,
      transactionId: input.after?.id ?? input.before?.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
