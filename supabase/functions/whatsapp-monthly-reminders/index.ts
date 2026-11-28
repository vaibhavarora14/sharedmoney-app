/**
 * Monthly WhatsApp balance reminders (#419).
 *
 * Called by pg_cron on the 1st of each month (10:00 IST) with
 * x-reminder-cron-secret. One template message per opted-in user with a +91
 * number who has pending balances, for the previous IST month.
 *
 * Gates (all must pass for a live send):
 *   - ENABLE_WHATSAPP_MONTHLY_REMINDERS=true (default off: returns skipped)
 *   - user opted in (whatsapp_reminder_prefs.opt_in)
 *   - shared WhatsApp budget: reserve_whatsapp_reminder_send keeps
 *     WHATSAPP_REMINDER_RESERVE_INR free for OTP sign-in; loop stops when hit.
 * ?dry_run=true computes recipients and estimated cost without sending.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/env.ts';
import { fetchUserEmails } from '../_shared/user-email.ts';
import { log } from '../_shared/logger.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import {
  aggregateMonthlyReminderEmails,
  buildGroupSettlementEdges,
  type ReminderGroup,
  type ReminderParticipant,
  type ReminderSettlement,
  type ReminderTransaction,
} from '../_shared/monthly-reminders.ts';
import {
  isDefiniteWhatsAppMetaRejection,
  requireSecret,
  sendWhatsAppMessage,
} from '../_shared/whatsapp.ts';
import {
  buildMonthlyReminderPayload,
  classifyReminderReserveError,
  firstNameForReminder,
  getPreviousIstMonthPeriodKey,
  isWhatsAppRemindersEnabled,
  maskPhone,
  normalizeIndianWhatsAppNumber,
  resolveWhatsAppReminderConfig,
  summarizeReminderActions,
} from '../_shared/whatsapp-reminders.ts';

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
const PAGE_SIZE = 1000;

function assertCronSecret(req: Request) {
  const expected = requireSecret('REMINDER_CRON_SECRET');
  const direct = req.headers.get('x-reminder-cron-secret')?.trim();
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const actual = direct || bearer;
  if (!actual || actual !== expected) {
    throw new Error('Unauthorized: invalid reminder cron secret');
  }
}

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

interface Candidate {
  user_id: string;
  phone: string;
  name: string;
  owe: string;
  owed: string;
}

async function buildCandidates(supabase: SupabaseClient, periodKey: string): Promise<Candidate[]> {
  const prefs = await fetchAllRows<{ user_id: string }>((from, to) =>
    supabase.from('whatsapp_reminder_prefs').select('user_id').eq('opt_in', true).range(from, to)
  );
  if (prefs.length === 0) return [];
  const optedIn = new Set(prefs.map((p) => p.user_id));

  const profiles = await fetchAllRows<{ id: string; phone: string | null; full_name: string | null }>(
    (from, to) =>
      supabase.from('profiles').select('id, phone, full_name').in('id', [...optedIn]).range(from, to),
  );
  const phoneByUser = new Map<string, { phone: string; name: string }>();
  for (const p of profiles) {
    const phone = normalizeIndianWhatsAppNumber(p.phone);
    if (phone) phoneByUser.set(p.id, { phone, name: firstNameForReminder(p.full_name) });
  }
  if (phoneByUser.size === 0) return [];

  const [groups, participants, transactions, settlements] = await Promise.all([
    fetchAllRows<ReminderGroup>((f, t) => supabase.from('groups').select('id, name').order('created_at').range(f, t)),
    fetchAllRows<ReminderParticipant>((f, t) =>
      supabase.from('participants').select('id, group_id, user_id, email, full_name, type').range(f, t)
    ),
    fetchAllRows<ReminderTransaction>((f, t) =>
      supabase
        .from('transactions')
        .select('id, group_id, amount, currency, paid_by_participant_id, transaction_splits ( participant_id, amount ), transaction_payers ( participant_id, amount )')
        .eq('type', 'expense')
        .not('group_id', 'is', null)
        .range(f, t)
    ),
    fetchAllRows<ReminderSettlement>((f, t) =>
      supabase
        .from('settlements')
        .select('id, group_id, from_participant_id, to_participant_id, amount, currency')
        .not('group_id', 'is', null)
        .range(f, t)
    ),
  ]);

  const userIds = [...new Set(participants.map((p) => p.user_id).filter((id): id is string => !!id))];
  const userIdToEmail = await fetchUserEmails(userIds, '', null);
  // Edge builder keys recipients by email; give phone-only users a stable key.
  for (const id of phoneByUser.keys()) {
    if (!userIdToEmail.has(id)) userIdToEmail.set(id, `${id}@wa.invalid`);
  }

  const byGroup = <T extends { group_id: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      if (!map.has(row.group_id)) map.set(row.group_id, []);
      map.get(row.group_id)!.push(row);
    }
    return map;
  };
  const pByG = byGroup(participants);
  const tByG = byGroup(transactions);
  const sByG = byGroup(settlements);

  const edges = groups.flatMap((group) =>
    buildGroupSettlementEdges({
      group,
      participants: pByG.get(group.id) || [],
      transactions: tByG.get(group.id) || [],
      settlements: sByG.get(group.id) || [],
      userIdToEmail,
    })
  );
  const perUser = aggregateMonthlyReminderEmails({ periodKey, appUrl: 'https://sharedmoney.app/app', logoUrl: null, edges });

  const candidates: Candidate[] = [];
  for (const entry of perUser) {
    const contact = phoneByUser.get(entry.user_id);
    if (!contact || entry.actions.length === 0) continue;
    const summary = summarizeReminderActions(entry.actions);
    candidates.push({ user_id: entry.user_id, phone: contact.phone, name: contact.name, ...summary });
  }
  return candidates;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return createEmptyResponse(200, req);
  if (req.method !== 'POST' && req.method !== 'GET') {
    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  }

  try {
    assertCronSecret(req);
    const dryRun = new URL(req.url).searchParams.get('dry_run') === 'true';
    const enabled = isWhatsAppRemindersEnabled();
    if (!dryRun && !enabled) {
      return createSuccessResponse({ skipped: true, reason: 'feature_disabled' }, 200, 0, req);
    }

    const config = resolveWhatsAppReminderConfig();
    if (!config) {
      log.error('WhatsApp reminder config invalid; refusing', 'whatsapp-monthly-reminders');
      return createErrorResponse(503, 'Reminder budget config invalid', 'CONFIG_INVALID', undefined, req);
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const periodKey = getPreviousIstMonthPeriodKey();
    const candidates = await buildCandidates(supabase, periodKey);

    if (dryRun) {
      return createSuccessResponse({
        dry_run: true,
        enabled,
        period_key: periodKey,
        recipient_count: candidates.length,
        est_cost_inr: Math.round(candidates.length * config.costInr * 100) / 100,
        recipients: candidates.map((c) => ({ user_id: c.user_id, to: maskPhone(c.phone), owe: c.owe, owed: c.owed })),
      }, 200, 0, req);
    }

    const token = requireSecret('WHATSAPP_TOKEN');
    const phoneNumberId = requireSecret('WHATSAPP_PHONE_NUMBER_ID');
    const stats = { sent: 0, failed: 0, duplicate: 0, stopped_for_budget: false, candidates: candidates.length };

    for (const c of candidates) {
      const { data: reservationId, error: reserveError } = await supabase.rpc('reserve_whatsapp_reminder_send', {
        p_user_id: c.user_id,
        p_phone_e164: c.phone,
        p_period_key: periodKey,
        p_est_cost_inr: config.costInr,
        p_budget_inr: config.monthlyBudgetInr,
        p_reserve_inr: config.reserveInr,
      });
      if (reserveError) {
        const outcome = classifyReminderReserveError(String(reserveError.message || reserveError));
        if (outcome === 'duplicate') {
          stats.duplicate += 1;
          continue;
        }
        // Budget reserve or unknown DB error: stop the batch (fail closed).
        stats.stopped_for_budget = outcome === 'budget_reserve';
        log.info('Stopping WhatsApp reminder batch', 'whatsapp-monthly-reminders', { outcome, periodKey });
        break;
      }

      try {
        const result = await sendWhatsAppMessage({
          token,
          phoneNumberId,
          payload: buildMonthlyReminderPayload({
            to: c.phone,
            name: c.name,
            periodKey,
            summary: { owe: c.owe, owed: c.owed },
            config,
          }),
        });
        await supabase.from('whatsapp_otp_sends')
          .update({ status: 'accepted', meta_message_id: result.messageId })
          .eq('id', reservationId);
        stats.sent += 1;
      } catch (error) {
        stats.failed += 1;
        if (isDefiniteWhatsAppMetaRejection(error)) {
          await supabase.from('whatsapp_otp_sends').update({ status: 'failed' }).eq('id', reservationId);
        }
        log.error('WhatsApp reminder send failed', 'whatsapp-monthly-reminders', {
          to: maskPhone(c.phone),
          error: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
        });
      }
    }

    log.info('WhatsApp reminder batch done', 'whatsapp-monthly-reminders', { periodKey, ...stats });
    return createSuccessResponse({ period_key: periodKey, ...stats }, 200, 0, req);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unauthorized')) {
      return createErrorResponse(401, 'Unauthorized', 'UNAUTHORIZED', undefined, req);
    }
    return handleError(error, 'whatsapp monthly reminders', req);
  }
});
