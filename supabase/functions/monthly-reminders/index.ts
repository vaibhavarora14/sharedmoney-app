import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/env.ts';
import { loadLastSeenByUserId } from '../_shared/last-seen-app.ts';
import { fetchUserEmails } from '../_shared/user-email.ts';
import { log } from '../_shared/logger.ts';
import {
  aggregateMonthlyReminderEmails,
  buildGroupSettlementEdges,
  buildMemberOwedTotals,
  getDeliveryReservationMode,
  getPreviousMonthPeriodKey,
  type ReminderEmail,
  type ReminderLastSeenApp,
  type ReminderGroup,
  type ReminderParticipant,
  type ReminderSettlement,
  type ReminderTransaction,
} from '../_shared/monthly-reminders.ts';
import {
  composeBalanceNudgePush,
  deliveryKey,
  isCadenceDue,
  selectBalanceNudgeCandidates,
  utcDayKey,
  userGroupKey,
  type BalanceNudgeCadence,
} from '../_shared/balance-nudges.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';

interface ReminderRunRow {
  id: string;
}

interface DeliveryRow {
  id: string;
  user_id: string;
  status: string;
}

interface SendResult {
  id?: string;
  error?: unknown;
}

interface ReminderSummaryRecipient {
  user_id: string;
  to: string;
  action_count: number;
  status: 'dry_run' | 'sent' | 'failed' | 'skipped_duplicate';
  error?: string;
}

type SupabaseClient = any;

const PAGE_SIZE = 1000;
const RESEND_EMAIL_URL = 'https://api.resend.com/emails';

function getOptionalSecret(key: string): string | null {
  const value = Deno.env.get(key)?.trim();
  return value ? value : null;
}

function requireSecret(key: string): string {
  const value = getOptionalSecret(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getRequestSecret(req: Request): string | null {
  const directSecret = req.headers.get('x-reminder-cron-secret')?.trim();
  if (directSecret) return directSecret;

  const authorization = req.headers.get('authorization') || req.headers.get('Authorization');
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() || null;
}

function assertCronSecret(req: Request) {
  const expectedSecret = requireSecret('REMINDER_CRON_SECRET');
  const actualSecret = getRequestSecret(req);
  if (!actualSecret || actualSecret !== expectedSecret) {
    throw new Error('Unauthorized: invalid reminder cron secret');
  }
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  if (typeof error === 'string') return error.slice(0, 500);
  try {
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return String(error).slice(0, 500);
  }
}

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function createRun(supabase: SupabaseClient, periodKey: string): Promise<string> {
  const { data, error } = await supabase
    .from('monthly_reminder_runs')
    .insert({ period_key: periodKey, status: 'running' })
    .select('id')
    .single();

  if (error) throw error;
  return (data as ReminderRunRow).id;
}

async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  status: 'completed' | 'failed',
  stats: Record<string, unknown>,
) {
  const { error } = await supabase
    .from('monthly_reminder_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      stats,
    })
    .eq('id', runId);

  if (error) {
    log.error('Failed to update monthly reminder run', 'monthly-reminders', {
      runId,
      error: sanitizeError(error),
    });
  }
}

async function fetchReminderInputs(supabase: SupabaseClient) {
  const [groups, participants, transactions, settlements] = await Promise.all([
    fetchAllRows<ReminderGroup>((from, to) =>
      supabase
        .from('groups')
        .select('id, name')
        .order('created_at', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<ReminderParticipant>((from, to) =>
      supabase
        .from('participants')
        .select('id, group_id, user_id, email, full_name, type')
        .range(from, to)
    ),
    fetchAllRows<ReminderTransaction>((from, to) =>
      supabase
        .from('transactions')
        .select(`
          id,
          group_id,
          amount,
          currency,
          paid_by_participant_id,
          transaction_splits (
            participant_id,
            amount
          )
        `)
        .eq('type', 'expense')
        .not('group_id', 'is', null)
        .range(from, to)
    ),
    fetchAllRows<ReminderSettlement>((from, to) =>
      supabase
        .from('settlements')
        .select('id, group_id, from_participant_id, to_participant_id, amount, currency')
        .not('group_id', 'is', null)
        .range(from, to)
    ),
  ]);

  const userIds = Array.from(
    new Set(
      participants
        .map((participant) => participant.user_id)
        .filter((userId): userId is string => !!userId),
    ),
  );
  const userIdToEmail = await fetchUserEmails(userIds, '', null);

  return { groups, participants, transactions, settlements, userIdToEmail };
}

function buildReminderEmails(
  periodKey: string,
  appUrl: string,
  logoUrl: string | null,
  inputs: Awaited<ReturnType<typeof fetchReminderInputs>>,
  lastSeenByUserId?: ReadonlyMap<string, ReminderLastSeenApp | null>,
): ReminderEmail[] {
  const participantsByGroup = new Map<string, ReminderParticipant[]>();
  const transactionsByGroup = new Map<string, ReminderTransaction[]>();
  const settlementsByGroup = new Map<string, ReminderSettlement[]>();

  for (const participant of inputs.participants) {
    if (!participantsByGroup.has(participant.group_id)) {
      participantsByGroup.set(participant.group_id, []);
    }
    participantsByGroup.get(participant.group_id)!.push(participant);
  }

  for (const transaction of inputs.transactions) {
    if (!transactionsByGroup.has(transaction.group_id)) {
      transactionsByGroup.set(transaction.group_id, []);
    }
    transactionsByGroup.get(transaction.group_id)!.push(transaction);
  }

  for (const settlement of inputs.settlements) {
    if (!settlementsByGroup.has(settlement.group_id)) {
      settlementsByGroup.set(settlement.group_id, []);
    }
    settlementsByGroup.get(settlement.group_id)!.push(settlement);
  }

  const edges = inputs.groups.flatMap((group) =>
    buildGroupSettlementEdges({
      group,
      participants: participantsByGroup.get(group.id) || [],
      transactions: transactionsByGroup.get(group.id) || [],
      settlements: settlementsByGroup.get(group.id) || [],
      userIdToEmail: inputs.userIdToEmail,
    })
  );

  return aggregateMonthlyReminderEmails({
    periodKey,
    appUrl,
    logoUrl,
    edges,
    lastSeenByUserId,
  });
}

async function loadExistingDeliveries(
  supabase: SupabaseClient,
  periodKey: string,
): Promise<Map<string, DeliveryRow>> {
  const rows = await fetchAllRows<DeliveryRow>((from, to) =>
    supabase
      .from('monthly_reminder_deliveries')
      .select('id, user_id, status')
      .eq('period_key', periodKey)
      .range(from, to)
  );

  return new Map(rows.map((row) => [row.user_id, row]));
}

async function reserveDelivery(
  supabase: SupabaseClient,
  runId: string,
  periodKey: string,
  email: ReminderEmail,
  existing: DeliveryRow | undefined,
): Promise<{ id: string; skipped: boolean }> {
  const deliveryPayload = {
    run_id: runId,
    period_key: periodKey,
    user_id: email.user_id,
    email: email.to,
    status: 'pending',
    action_count: email.actions.length,
    payload: { actions: email.actions },
    error_message: null,
    resend_message_id: null,
    sent_at: null,
  };

  const reservationMode = getDeliveryReservationMode(existing);
  if (reservationMode === 'skip_duplicate' && existing) {
    return { id: existing.id, skipped: true };
  }

  if (reservationMode === 'retry_failed' && existing) {
    const { data, error } = await supabase
      .from('monthly_reminder_deliveries')
      .update(deliveryPayload)
      .eq('id', existing.id)
      .select('id')
      .single();

    if (error) throw error;
    return { id: (data as { id: string }).id, skipped: false };
  }

  const { data, error } = await supabase
    .from('monthly_reminder_deliveries')
    .insert(deliveryPayload)
    .select('id')
    .single();

  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
    return { id: '', skipped: true };
  }
  if (error) throw error;
  return { id: (data as { id: string }).id, skipped: false };
}

export interface EmailProvider {
  send(email: ReminderEmail, fromEmail: string): Promise<string | null>;
}

export class ResendEmailProvider implements EmailProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(email: ReminderEmail, fromEmail: string): Promise<string | null> {
    const response = await fetch(RESEND_EMAIL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });

    const responseText = await response.text();
    let data: SendResult | null = null;
    if (responseText) {
      try {
        data = JSON.parse(responseText) as SendResult;
      } catch {
        data = { error: responseText };
      }
    }

    if (!response.ok) {
      throw new Error(`Resend returned ${response.status}: ${sanitizeError(data?.error || responseText)}`);
    }

    return data?.id || null;
  }
}

export class LocalEmailProvider implements EmailProvider {
  async send(email: ReminderEmail, fromEmail: string): Promise<string | null> {
    log('info', `[LocalEmailProvider] Sent reminder to ${email.to} from ${fromEmail}: ${email.subject}`);
    try {
      await fetch('http://127.0.0.1:54324/api/v1/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromEmail,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
        signal: AbortSignal.timeout(500),
      });
    } catch {
      // Inbucket server optional in local testing
    }
    return `local-msg-${Date.now()}`;
  }
}

export function getEmailProvider(): EmailProvider {
  const providerType = Deno.env.get('EMAIL_PROVIDER')?.toLowerCase();
  const resendApiKey = getOptionalSecret('RESEND_API_KEY');

  if (providerType === 'resend' || (resendApiKey && providerType !== 'local' && providerType !== 'console')) {
    if (!resendApiKey) {
      throw new Error('Missing required environment variable: RESEND_API_KEY');
    }
    return new ResendEmailProvider(resendApiKey);
  }
  return new LocalEmailProvider();
}

async function sendReminderEmail(
  email: ReminderEmail,
  fromEmail: string,
  provider: EmailProvider = getEmailProvider(),
): Promise<string | null> {
  return provider.send(email, fromEmail);
}

async function markDeliverySent(
  supabase: SupabaseClient,
  deliveryId: string,
  resendMessageId: string | null,
) {
  const { error } = await supabase
    .from('monthly_reminder_deliveries')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      resend_message_id: resendMessageId,
      error_message: null,
    })
    .eq('id', deliveryId);

  if (error) throw error;
}

async function markDeliveryFailed(
  supabase: SupabaseClient,
  deliveryId: string,
  errorMessage: string,
) {
  const { error } = await supabase
    .from('monthly_reminder_deliveries')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', deliveryId);

  if (error) throw error;
}


interface BalanceNudgePrefsRow {
  user_id: string;
  push_enabled: boolean | null;
  permission_status: string | null;
}

interface BalanceNudgeTokenRow {
  user_id: string;
  expo_push_token: string;
}

function nextUtcDayStart(dayKey: string): Date {
  const start = new Date(`${dayKey}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  return start;
}

async function runBalanceNudges(
  supabase: SupabaseClient,
  options: { dryRun: boolean; now: Date },
) {
  const dayKey = utcDayKey(options.now);
  const dayStart = new Date(`${dayKey}T00:00:00.000Z`);
  const dayEnd = nextUtcDayStart(dayKey);

  const cadenceRows = await fetchAllRows<{ id: string; balance_nudge_cadence: string }>((from, to) =>
    supabase
      .from('groups')
      .select('id, balance_nudge_cadence')
      .in('balance_nudge_cadence', ['weekly', 'monthly'])
      .range(from, to)
  );

  const dueGroups = cadenceRows.filter((group) =>
    isCadenceDue((group.balance_nudge_cadence as BalanceNudgeCadence) ?? 'off', options.now),
  );
  if (dueGroups.length === 0) {
    return {
      job: 'balance_nudges',
      day_key: dayKey,
      dry_run: options.dryRun,
      due_groups: 0,
      candidates: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const dueIds = new Set(dueGroups.map((group) => group.id));
  const groupCadenceById = new Map(
    dueGroups.map((group) => [group.id, group.balance_nudge_cadence as BalanceNudgeCadence]),
  );

  const inputs = await fetchReminderInputs(supabase);
  const participantsByGroup = new Map<string, ReminderParticipant[]>();
  const transactionsByGroup = new Map<string, ReminderTransaction[]>();
  const settlementsByGroup = new Map<string, ReminderSettlement[]>();

  for (const participant of inputs.participants) {
    if (!dueIds.has(participant.group_id)) continue;
    if (!participantsByGroup.has(participant.group_id)) {
      participantsByGroup.set(participant.group_id, []);
    }
    participantsByGroup.get(participant.group_id)!.push(participant);
  }
  for (const transaction of inputs.transactions) {
    if (!dueIds.has(transaction.group_id)) continue;
    if (!transactionsByGroup.has(transaction.group_id)) {
      transactionsByGroup.set(transaction.group_id, []);
    }
    transactionsByGroup.get(transaction.group_id)!.push(transaction);
  }
  for (const settlement of inputs.settlements) {
    if (!dueIds.has(settlement.group_id)) continue;
    if (!settlementsByGroup.has(settlement.group_id)) {
      settlementsByGroup.set(settlement.group_id, []);
    }
    settlementsByGroup.get(settlement.group_id)!.push(settlement);
  }

  const owedTotals = inputs.groups
    .filter((group) => dueIds.has(group.id))
    .flatMap((group) =>
      buildMemberOwedTotals({
        group,
        participants: participantsByGroup.get(group.id) || [],
        transactions: transactionsByGroup.get(group.id) || [],
        settlements: settlementsByGroup.get(group.id) || [],
        userIdToEmail: inputs.userIdToEmail,
      }),
    );

  const muteRows = await fetchAllRows<{ user_id: string; group_id: string }>((from, to) =>
    supabase
      .from('group_balance_nudge_mutes')
      .select('user_id, group_id')
      .in('group_id', [...dueIds])
      .range(from, to)
  );
  const emailRows = await fetchAllRows<{ user_id: string; sent_at: string | null; status: string }>((from, to) =>
    supabase
      .from('monthly_reminder_deliveries')
      .select('user_id, sent_at, status')
      .eq('status', 'sent')
      .gte('sent_at', dayStart.toISOString())
      .lt('sent_at', dayEnd.toISOString())
      .range(from, to)
  );
  const deliveryRows = await fetchAllRows<{
    user_id: string;
    group_id: string;
    currency: string;
    status: string;
  }>((from, to) =>
    supabase
      .from('balance_nudge_deliveries')
      .select('user_id, group_id, currency, status')
      .eq('channel', 'push')
      .eq('day_key', dayKey)
      .in('status', ['sent', 'skipped'])
      .range(from, to)
  );

  const candidates = selectBalanceNudgeCandidates({
    owedTotals,
    groupCadenceById,
    mutedUserGroupKeys: new Set(muteRows.map((row) => userGroupKey(row.user_id, row.group_id))),
    emailedUserIds: new Set(emailRows.map((row) => row.user_id)),
    alreadyDeliveredKeys: new Set(
      deliveryRows.map((row) => deliveryKey(row.user_id, row.group_id, row.currency)),
    ),
    now: options.now,
  });

  if (options.dryRun) {
    return {
      job: 'balance_nudges',
      day_key: dayKey,
      dry_run: true,
      due_groups: dueIds.size,
      candidates: candidates.length,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const userIds = [...new Set(candidates.map((candidate) => candidate.userId))];
  const prefs = userIds.length
    ? await fetchAllRows<BalanceNudgePrefsRow>((from, to) =>
      supabase
        .from('notification_preferences')
        .select('user_id, push_enabled, permission_status')
        .in('user_id', userIds)
        .range(from, to)
    )
    : [];
  const tokens = userIds.length
    ? await fetchAllRows<BalanceNudgeTokenRow>((from, to) =>
      supabase
        .from('push_tokens')
        .select('user_id, expo_push_token')
        .in('user_id', userIds)
        .range(from, to)
    )
    : [];

  const prefByUser = new Map(prefs.map((row) => [row.user_id, row]));
  const tokensByUser = new Map<string, string[]>();
  for (const row of tokens) {
    if (!row.expo_push_token) continue;
    const list = tokensByUser.get(row.user_id) || [];
    list.push(row.expo_push_token);
    tokensByUser.set(row.user_id, list);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const push = composeBalanceNudgePush(candidate);
    const preference = prefByUser.get(candidate.userId);
    const userTokens = tokensByUser.get(candidate.userId) || [];
    const canPush = preference?.push_enabled === true
      && preference.permission_status === 'granted'
      && userTokens.length > 0;

    let status: 'sent' | 'skipped' | 'failed' = 'skipped';
    if (!canPush) {
      status = 'skipped';
      skipped += 1;
    } else {
      const ok = await sendBalanceNudgePush(userTokens, push);
      status = ok ? 'sent' : 'failed';
      if (ok) sent += 1;
      else failed += 1;
    }

    const { error } = await supabase.from('balance_nudge_deliveries').upsert({
      user_id: candidate.userId,
      group_id: candidate.groupId,
      currency: candidate.currency,
      channel: 'push',
      day_key: dayKey,
      status,
    }, { onConflict: 'user_id,group_id,currency,channel,day_key' });
    if (error) {
      log.error('Failed to record balance nudge delivery', 'monthly-reminders', {
        userId: candidate.userId,
        groupId: candidate.groupId,
        error: sanitizeError(error),
      });
    }
  }

  return {
    job: 'balance_nudges',
    day_key: dayKey,
    dry_run: false,
    due_groups: dueIds.size,
    candidates: candidates.length,
    sent,
    skipped,
    failed,
  };
}

async function sendBalanceNudgePush(
  tokens: string[],
  push: { title: string; body: string; data: Record<string, string | number> },
): Promise<boolean> {
  const provider = Deno.env.get('PUSH_PROVIDER')?.toLowerCase();
  if (provider === 'console' || provider === 'local') {
    log.info('Console balance nudge push', 'monthly-reminders', {
      tokens: tokens.length,
      title: push.title,
      body: push.body,
    });
    return true;
  }

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };
    const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(tokens.map((to) => ({
        to,
        title: push.title,
        body: push.body,
        sound: 'default',
        data: push.data,
      }))),
    });
    if (!response.ok) {
      const text = await response.text();
      log.error('Expo balance nudge push failed', 'monthly-reminders', {
        status: response.status,
        error: text.slice(0, 500),
      });
      return false;
    }
    return true;
  } catch (error) {
    log.error('Expo balance nudge push threw', 'monthly-reminders', {
      error: sanitizeError(error),
    });
    return false;
  }
}

// POST body { job: 'balance_nudges' } sends #417 per-group balance nudge
// pushes (default cadence off). The existing monthly email path is unchanged
// when job is omitted. WhatsApp is out of scope.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return createEmptyResponse(200, req);
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  }

  let runId: string | null = null;
  let supabase: SupabaseClient | null = null;

  try {
    assertCronSecret(req);

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
    }

    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dry_run') === 'true';
    let requestedJob = url.searchParams.get('job') === 'balance_nudges' ? 'balance_nudges' : 'monthly_emails';
    let scheduledAt = new Date();
    if (req.method === 'POST') {
      const raw = await req.text();
      if (raw.trim()) {
        let body: { job?: string; scheduled_at?: string };
        try {
          body = JSON.parse(raw) as { job?: string; scheduled_at?: string };
        } catch {
          return createErrorResponse(400, 'Invalid JSON body', 'VALIDATION_ERROR', undefined, req);
        }
        if (body.job === 'balance_nudges') requestedJob = 'balance_nudges';
        if (typeof body.scheduled_at === 'string' && !Number.isNaN(Date.parse(body.scheduled_at))) {
          scheduledAt = new Date(body.scheduled_at);
        }
      }
    }

    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    if (requestedJob === 'balance_nudges') {
      const result = await runBalanceNudges(supabase, { dryRun, now: scheduledAt });
      return createSuccessResponse(result, 200, 0, req);
    }

    const periodKey = getPreviousMonthPeriodKey();
    const appUrl = requireSecret('APP_URL');
    const logoUrl = getOptionalSecret('REMINDER_LOGO_URL');

    const emailProvider = getEmailProvider();
    const fromEmail = getOptionalSecret('REMINDER_FROM_EMAIL') || 'SharedMoney <reminders@sharedmoney.app>';

    if (!dryRun && emailProvider instanceof ResendEmailProvider) {
      requireSecret('RESEND_API_KEY');
      requireSecret('REMINDER_FROM_EMAIL');
    }

    const inputs = await fetchReminderInputs(supabase);
    const lastSeenByUserId = await loadLastSeenByUserId(
      supabase,
      inputs.participants.flatMap((participant) => participant.user_id ? [participant.user_id] : []),
    );
    const emails = buildReminderEmails(periodKey, appUrl, logoUrl, inputs, lastSeenByUserId);

    if (dryRun) {
      return createSuccessResponse({
        period_key: periodKey,
        dry_run: true,
        recipient_count: emails.length,
        recipients: emails.map((email) => ({
          user_id: email.user_id,
          to: email.to,
          action_count: email.actions.length,
          actions: email.actions,
        })),
      }, 200, 0, req);
    }

    runId = await createRun(supabase, periodKey);
    const existingDeliveries = await loadExistingDeliveries(supabase, periodKey);
    const recipients: ReminderSummaryRecipient[] = [];
    let sentCount = 0;
    let failedCount = 0;
    let skippedDuplicateCount = 0;

    for (const email of emails) {
      let deliveryId: string | null = null;
      try {
        const reservation = await reserveDelivery(
          supabase,
          runId,
          periodKey,
          email,
          existingDeliveries.get(email.user_id),
        );

        if (reservation.skipped) {
          skippedDuplicateCount += 1;
          recipients.push({
            user_id: email.user_id,
            to: email.to,
            action_count: email.actions.length,
            status: 'skipped_duplicate',
          });
          continue;
        }

        deliveryId = reservation.id;
        const resendMessageId = await sendReminderEmail(email, fromEmail, emailProvider);
        try {
          await markDeliverySent(supabase, deliveryId, resendMessageId);
        } catch (markSentError) {
          log.error('Reminder email sent but delivery row could not be marked sent', 'monthly-reminders', {
            deliveryId,
            userId: email.user_id,
            error: sanitizeError(markSentError),
          });
        }
        sentCount += 1;
        recipients.push({
          user_id: email.user_id,
          to: email.to,
          action_count: email.actions.length,
          status: 'sent',
        });
      } catch (error) {
        failedCount += 1;
        const errorMessage = sanitizeError(error);
        const existingDelivery = existingDeliveries.get(email.user_id);
        const failedDeliveryId = deliveryId || existingDelivery?.id;
        if (failedDeliveryId) {
          try {
            await markDeliveryFailed(supabase, failedDeliveryId, errorMessage);
          } catch (markFailedError) {
            log.error('Reminder delivery row could not be marked failed', 'monthly-reminders', {
              deliveryId: failedDeliveryId,
              userId: email.user_id,
              error: sanitizeError(markFailedError),
            });
          }
        }
        recipients.push({
          user_id: email.user_id,
          to: email.to,
          action_count: email.actions.length,
          status: 'failed',
          error: errorMessage,
        });
        log.error('Failed to send monthly reminder email', 'monthly-reminders', {
          userId: email.user_id,
          error: errorMessage,
        });
      }
    }

    const stats = {
      period_key: periodKey,
      dry_run: false,
      recipient_count: emails.length,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_duplicate_count: skippedDuplicateCount,
    };

    await finishRun(supabase, runId, 'completed', stats);

    return createSuccessResponse({
      ...stats,
      recipients,
    }, 200, 0, req);
  } catch (error: unknown) {
    if (runId && supabase) {
      await finishRun(supabase, runId, 'failed', { error: sanitizeError(error) });
    }
    return handleError(error, 'monthly-reminders handler', req);
  }
});
