import { buildParticipantCanonicalResolver } from './participant-canonical.ts';
import { VERSION_CONFIG } from './version-config.ts';

export const MIN_ACTIONABLE_BALANCE = 0.01;

export interface ReminderGroup {
  id: string;
  name: string;
}

export interface ReminderParticipant {
  id: string;
  group_id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  type: string;
}

export interface ReminderTransactionSplit {
  participant_id: string | null;
  amount: number | string | null;
}

export interface ReminderTransaction {
  id: number;
  group_id: string;
  amount: number | string | null;
  currency: string | null;
  paid_by_participant_id: string | null;
  transaction_splits?: ReminderTransactionSplit[] | null;
}

export interface ReminderSettlement {
  id: string;
  group_id: string;
  from_participant_id: string | null;
  to_participant_id: string | null;
  amount: number | string | null;
  currency: string | null;
}

export interface SettlementReminderEdge {
  group_id: string;
  group_name: string;
  from_participant_id: string;
  from_user_id: string;
  from_email: string;
  from_name: string;
  to_participant_id: string;
  to_user_id: string;
  to_email: string;
  to_name: string;
  amount: number;
  currency: string;
}

export interface ReminderAction {
  direction: 'owe' | 'owed';
  group_id: string;
  group_name: string;
  counterparty_name: string;
  counterparty_email: string;
  amount: number;
  currency: string;
}

export interface ReminderEmail {
  user_id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  actions: ReminderAction[];
}

export type DeliveryReservationMode = 'create' | 'retry_failed' | 'skip_duplicate';

export function getDeliveryReservationMode(
  existingDelivery?: { status: string | null } | null,
): DeliveryReservationMode {
  if (!existingDelivery) return 'create';
  return existingDelivery.status === 'failed' ? 'retry_failed' : 'skip_duplicate';
}

interface BuildGroupSettlementEdgesInput {
  group: ReminderGroup;
  participants: ReminderParticipant[];
  userIdToEmail: Map<string, string>;
  transactions: ReminderTransaction[];
  settlements: ReminderSettlement[];
}

export type ReminderAppPlatform = 'ios' | 'android';

/** Last-seen native app for one reminder recipient. Missing version omits the nudge. */
export interface ReminderLastSeenApp {
  appVersion: string | null;
  platform?: ReminderAppPlatform | null;
}

interface AggregateReminderEmailsInput {
  periodKey: string;
  appUrl: string;
  logoUrl?: string | null;
  edges: SettlementReminderEdge[];
  /**
   * Only users present in this map with a parseable version below
   * UPDATE_NUDGE_TARGET_VERSION get the store line. Omit the map, or omit a
   * user, when last-seen version is unknown.
   */
  lastSeenByUserId?: ReadonlyMap<string, ReminderLastSeenApp | null>;
}

/** 2.46.0 store build: quicker expense adding (faster group open, expense flow stays up). */
export const UPDATE_NUDGE_TARGET_VERSION = '2.46.0';
export const UPDATE_NUDGE_SENTENCE = 'Update SharedMoney to get quicker expense adding';
export const UPDATE_NUDGE_UTM_CAMPAIGN = 'update_nudge';

const SEMVER = /^\d+\.\d+\.\d+$/;

function compareSemver(a: string, b: string): number {
  const partsA = a.split('.').map((part) => Number.parseInt(part, 10));
  const partsB = b.split('.').map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizePlatform(
  platform: ReminderAppPlatform | null | undefined,
): ReminderAppPlatform | null {
  switch (platform) {
    case 'ios':
    case 'android':
      return platform;
    case null:
    case undefined:
      return null;
    default: {
      const unexpected: never = platform;
      return unexpected;
    }
  }
}

function withUpdateNudgeCampaign(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('utm_campaign', UPDATE_NUDGE_UTM_CAMPAIGN);
  return parsed.toString();
}

interface UpdateNudgeLink {
  label: string;
  url: string;
}

function nudgeStoreLinks(platform: ReminderAppPlatform | null): UpdateNudgeLink[] {
  const play: UpdateNudgeLink = {
    label: 'Google Play',
    url: withUpdateNudgeCampaign(VERSION_CONFIG.STORE_URL_ANDROID),
  };
  const appStore: UpdateNudgeLink = {
    label: 'App Store',
    url: withUpdateNudgeCampaign(VERSION_CONFIG.STORE_URL_IOS),
  };
  switch (platform) {
    case 'android':
      return [play];
    case 'ios':
      return [appStore];
    case null:
      return [play, appStore];
    default: {
      const unexpected: never = platform;
      return unexpected;
    }
  }
}

/**
 * One-line store nudge for recipients still below 2.46.0.
 * Returns null when version is missing, unparseable, or already at/above 2.46.0.
 */
export function buildUpdateNudge(
  lastSeen: ReminderLastSeenApp | null | undefined,
): { html: string; text: string } | null {
  const version = lastSeen?.appVersion?.trim() ?? '';
  if (!SEMVER.test(version)) return null;
  if (compareSemver(version, UPDATE_NUDGE_TARGET_VERSION) >= 0) return null;

  const links = nudgeStoreLinks(normalizePlatform(lastSeen?.platform));
  const text = `${UPDATE_NUDGE_SENTENCE}. ${links.map((link) => `${link.label}: ${link.url}`).join(' ')}`;
  const htmlLinks = links
    .map((link) =>
      `<a href="${escapeHtml(link.url)}" style="color:#0f766e;font-weight:700;text-decoration:none;">${escapeHtml(link.label)}</a>`
    )
    .join(' · ');
  const html =
    `<p style="font-size:13px;color:#526762;margin:12px 0 0;">${escapeHtml(UPDATE_NUDGE_SENTENCE)}. ${htmlLinks}</p>`;
  return { html, text };
}

interface ActiveRecipient {
  participant_id: string;
  user_id: string;
  email: string;
  name: string;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function isActionableAmount(value: number): boolean {
  return Math.abs(roundMoney(value)) > MIN_ACTIONABLE_BALANCE;
}

function normalizedEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function displayName(participant: ReminderParticipant, email: string): string {
  const name = participant.full_name?.trim();
  if (name) return name;
  return email;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const LEGACY_EXPO_APP_HOST = 'share-money.expo.app';

function baseUrl(value: string): string {
  if (value.includes(LEGACY_EXPO_APP_HOST)) {
    throw new Error(
      'APP_URL must use https://sharedmoney.app/app, not the legacy Expo redirect host',
    );
  }

  try {
    new URL(value);
  } catch {
    // Preserve the prior behavior for non-URL values passed by local/dev callers.
  }

  return value.replace(/\/$/, '');
}

function defaultLogoUrl(appUrl: string): string {
  try {
    return `${new URL(appUrl).origin}/icon.png`;
  } catch {
    return `${baseUrl(appUrl)}/icon.png`;
  }
}

export function formatReminderMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

export function getPreviousMonthPeriodKey(now = new Date()): string {
  const year = now.getUTCFullYear();
  const previousMonthIndex = now.getUTCMonth() - 1;
  const previousMonth = new Date(Date.UTC(year, previousMonthIndex, 1));
  const periodYear = previousMonth.getUTCFullYear();
  const periodMonth = String(previousMonth.getUTCMonth() + 1).padStart(2, '0');
  return `${periodYear}-${periodMonth}`;
}

export function getPeriodLabel(periodKey: string): string {
  const [yearText, monthText] = periodKey.split('-');
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return periodKey;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function addBalance(
  balances: Map<string, Map<string, number>>,
  participantId: string,
  currency: string,
  amount: number,
) {
  if (!balances.has(participantId)) {
    balances.set(participantId, new Map());
  }

  const currencyBalances = balances.get(participantId)!;
  currencyBalances.set(currency, roundMoney((currencyBalances.get(currency) || 0) + amount));
}

function activeRecipientMap(
  participants: ReminderParticipant[],
  userIdToEmail: Map<string, string>,
  canonicalParticipantId: (participantId: string) => string,
): Map<string, ActiveRecipient> {
  const recipients = new Map<string, ActiveRecipient>();

  for (const participant of participants) {
    const canonicalId = canonicalParticipantId(participant.id);
    if (canonicalId !== participant.id || participant.type !== 'member' || !participant.user_id) {
      continue;
    }

    const email = normalizedEmail(participant.email) ||
      normalizedEmail(userIdToEmail.get(participant.user_id));
    if (!email) continue;

    recipients.set(participant.id, {
      participant_id: participant.id,
      user_id: participant.user_id,
      email,
      name: displayName(participant, email),
    });
  }

  return recipients;
}

export interface MemberOwedTotal {
  group_id: string;
  group_name: string;
  user_id: string;
  amount: number;
  currency: string;
}

function resolveGroupBalances(input: BuildGroupSettlementEdgesInput): {
  canonicalParticipantId: (participantId: string) => string;
  recipients: Map<string, ActiveRecipient>;
  balances: Map<string, Map<string, number>>;
} {
  const canonicalParticipantId = buildParticipantCanonicalResolver(
    input.participants.map((participant) => ({
      id: participant.id,
      user_id: participant.user_id,
      email: participant.email,
      type: participant.type,
    })),
    input.userIdToEmail,
  );
  const recipients = activeRecipientMap(
    input.participants,
    input.userIdToEmail,
    canonicalParticipantId,
  );
  const balances = new Map<string, Map<string, number>>();

  for (const transaction of input.transactions) {
    if (transaction.group_id !== input.group.id) continue;

    const amount = toNumber(transaction.amount);
    const payerId = transaction.paid_by_participant_id
      ? canonicalParticipantId(transaction.paid_by_participant_id)
      : null;
    const currency = transaction.currency || 'USD';
    if (!payerId || amount === null) continue;

    const splits = (transaction.transaction_splits || [])
      .map((split) => ({
        participant_id: split.participant_id ? canonicalParticipantId(split.participant_id) : null,
        amount: toNumber(split.amount),
      }))
      .filter((split): split is { participant_id: string; amount: number } =>
        !!split.participant_id && split.amount !== null
      );

    if (splits.length === 0) continue;

    addBalance(balances, payerId, currency, amount);
    for (const split of splits) {
      addBalance(balances, split.participant_id, currency, -split.amount);
    }
  }

  for (const settlement of input.settlements) {
    if (settlement.group_id !== input.group.id) continue;

    const amount = toNumber(settlement.amount);
    const fromId = settlement.from_participant_id
      ? canonicalParticipantId(settlement.from_participant_id)
      : null;
    const toId = settlement.to_participant_id
      ? canonicalParticipantId(settlement.to_participant_id)
      : null;
    const currency = settlement.currency || 'USD';
    if (!fromId || !toId || amount === null || amount <= 0) continue;

    addBalance(balances, fromId, currency, amount);
    addBalance(balances, toId, currency, -amount);
  }

  return { canonicalParticipantId, recipients, balances };
}

export function buildGroupSettlementEdges(
  input: BuildGroupSettlementEdgesInput,
): SettlementReminderEdge[] {
  const { recipients, balances } = resolveGroupBalances(input);
  const balancesByCurrency = new Map<string, Array<{ participant_id: string; amount: number }>>();
  for (const [participantId, currencyBalances] of balances.entries()) {
    for (const [currency, amount] of currencyBalances.entries()) {
      if (!isActionableAmount(amount)) continue;
      if (!balancesByCurrency.has(currency)) {
        balancesByCurrency.set(currency, []);
      }
      balancesByCurrency.get(currency)!.push({ participant_id: participantId, amount: roundMoney(amount) });
    }
  }

  const edges: SettlementReminderEdge[] = [];
  for (const currency of balancesByCurrency.keys()) {
    const currencyBalances = balancesByCurrency.get(currency)!;
    const debtors = currencyBalances
      .filter((balance) => balance.amount < -MIN_ACTIONABLE_BALANCE)
      .map((balance) => ({ ...balance, amount: Math.abs(balance.amount) }))
      .sort((a, b) => b.amount - a.amount || a.participant_id.localeCompare(b.participant_id));
    const creditors = currencyBalances
      .filter((balance) => balance.amount > MIN_ACTIONABLE_BALANCE)
      .map((balance) => ({ ...balance }))
      .sort((a, b) => b.amount - a.amount || a.participant_id.localeCompare(b.participant_id));

    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const debtor = debtors[debtorIndex];
      const creditor = creditors[creditorIndex];
      const amount = roundMoney(Math.min(debtor.amount, creditor.amount));
      const from = recipients.get(debtor.participant_id);
      const to = recipients.get(creditor.participant_id);

      if (from && to && amount > MIN_ACTIONABLE_BALANCE) {
        edges.push({
          group_id: input.group.id,
          group_name: input.group.name,
          from_participant_id: from.participant_id,
          from_user_id: from.user_id,
          from_email: from.email,
          from_name: from.name,
          to_participant_id: to.participant_id,
          to_user_id: to.user_id,
          to_email: to.email,
          to_name: to.name,
          amount,
          currency,
        });
      }

      debtor.amount = roundMoney(debtor.amount - amount);
      creditor.amount = roundMoney(creditor.amount - amount);
      if (debtor.amount <= MIN_ACTIONABLE_BALANCE) debtorIndex += 1;
      if (creditor.amount <= MIN_ACTIONABLE_BALANCE) creditorIndex += 1;
    }
  }

  return edges;
}

export function buildMemberOwedTotals(
  input: BuildGroupSettlementEdgesInput,
): MemberOwedTotal[] {
  const { canonicalParticipantId, balances } = resolveGroupBalances(input);
  const totals: MemberOwedTotal[] = [];

  for (const participant of input.participants) {
    if (participant.type !== 'member' || !participant.user_id) continue;
    const canonicalId = canonicalParticipantId(participant.id);
    if (canonicalId !== participant.id) continue;
    const currencyBalances = balances.get(canonicalId);
    if (!currencyBalances) continue;
    for (const [currency, amount] of currencyBalances.entries()) {
      if (amount >= -MIN_ACTIONABLE_BALANCE) continue;
      totals.push({
        group_id: input.group.id,
        group_name: input.group.name,
        user_id: participant.user_id,
        amount: Math.abs(roundMoney(amount)),
        currency,
      });
    }
  }

  return totals;
}

function addAction(
  emails: Map<string, ReminderEmail>,
  userId: string,
  to: string,
  periodKey: string,
  appUrl: string,
  logoUrl: string,
  action: ReminderAction,
  lastSeenByUserId?: ReadonlyMap<string, ReminderLastSeenApp | null>,
) {
  if (!emails.has(userId)) {
    const periodLabel = getPeriodLabel(periodKey);
    emails.set(userId, {
      user_id: userId,
      to,
      subject: `SharedMoney pending balances for ${periodLabel}`,
      html: '',
      text: '',
      actions: [],
    });
  }

  emails.get(userId)!.actions.push(action);
  const updateNudge = buildUpdateNudge(lastSeenByUserId?.get(userId) ?? null);
  renderReminderEmail(emails.get(userId)!, periodKey, appUrl, logoUrl, updateNudge);
}

function renderReminderEmail(
  email: ReminderEmail,
  periodKey: string,
  appUrl: string,
  logoUrl: string,
  updateNudge: { html: string; text: string } | null,
) {
  const periodLabel = getPeriodLabel(periodKey);
  const rows = email.actions.map((action) => {
    const amount = formatReminderMoney(action.amount, action.currency);
    const sentence = action.direction === 'owe'
      ? `You owe ${amount} to ${action.counterparty_name} in ${action.group_name}`
      : `You are owed ${amount} by ${action.counterparty_name} in ${action.group_name}`;
    const groupUrl = `${baseUrl(appUrl)}/groups/${encodeURIComponent(action.group_id)}`;
    const badge = action.direction === 'owe' ? 'To send' : 'To collect';
    return `
      <tr>
        <td style="padding:16px;border-bottom:1px solid #dbe7e3;">
          <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#0f766e;margin-bottom:4px;">${escapeHtml(badge)}</div>
          <div style="font-size:15px;color:#10201d;">${escapeHtml(sentence)}</div>
        </td>
        <td style="padding:16px;border-bottom:1px solid #dbe7e3;text-align:right;white-space:nowrap;">
          <a href="${escapeHtml(groupUrl)}" style="color:#0f766e;font-weight:700;text-decoration:none;">Open group</a>
        </td>
      </tr>`;
  }).join('');

  const textLines = email.actions.map((action) => {
    const amount = formatReminderMoney(action.amount, action.currency);
    return action.direction === 'owe'
      ? `You owe ${amount} to ${action.counterparty_name} in ${action.group_name}`
      : `You are owed ${amount} by ${action.counterparty_name} in ${action.group_name}`;
  });

  email.html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4fbf9;font-family:Arial,sans-serif;color:#10201d;line-height:1.5;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      A tiny money nudge from SharedMoney: your unsettled group balances are ready.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4fbf9;padding:24px 12px;">
      <tbody>
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #dbe7e3;border-radius:16px;overflow:hidden;">
              <tbody>
                <tr>
                  <td style="padding:24px 24px 8px;">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tbody>
                        <tr>
                          <td style="padding-right:12px;">
                            <img src="${escapeHtml(logoUrl)}" width="48" height="48" alt="SharedMoney" style="display:block;border-radius:12px;">
                          </td>
                          <td>
                            <div style="font-size:18px;font-weight:800;color:#10201d;">SharedMoney</div>
                            <div style="font-size:13px;color:#526762;">Monthly balance check-in</div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 24px 18px;">
                    <h1 style="font-size:24px;line-height:1.25;margin:0 0 10px;color:#10201d;">Time for a quick balance tidy-up</h1>
                    <p style="font-size:15px;margin:0;color:#526762;">New month, clean slate energy. Here are the balances still waiting in your groups for ${escapeHtml(periodLabel)}.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 24px 8px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dbe7e3;border-radius:12px;overflow:hidden;">
                      <tbody>${rows}</tbody>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 24px 24px;">
                    <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#14b8a6;color:#ffffff;font-weight:800;text-decoration:none;padding:12px 18px;border-radius:10px;">Open SharedMoney</a>
                    <p style="font-size:13px;color:#526762;margin:16px 0 0;">A little settle-up now keeps future you from doing awkward math later.</p>
                    ${updateNudge?.html ?? ''}
                  </td>
                </tr>
              </tbody>
            </table>
            <p style="max-width:680px;font-size:12px;color:#6b7d78;margin:12px auto 0;">You are receiving this because you have unsettled balances in a SharedMoney group.</p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;
  email.text = [
    `SharedMoney pending balances for ${periodLabel}`,
    '',
    'A tiny money nudge from SharedMoney.',
    'New month, clean slate energy. Here are the balances still waiting in your groups:',
    '',
    ...textLines,
    '',
    `Open SharedMoney: ${appUrl}`,
    '',
    'A little settle-up now keeps future you from doing awkward math later.',
    ...(updateNudge ? ['', updateNudge.text] : []),
  ].join('\n');
}

export function aggregateMonthlyReminderEmails(
  input: AggregateReminderEmailsInput,
): ReminderEmail[] {
  const emails = new Map<string, ReminderEmail>();
  const logoUrl = input.logoUrl?.trim() || defaultLogoUrl(input.appUrl);

  for (const edge of input.edges) {
    addAction(
      emails,
      edge.from_user_id,
      edge.from_email,
      input.periodKey,
      input.appUrl,
      logoUrl,
      {
        direction: 'owe',
        group_id: edge.group_id,
        group_name: edge.group_name,
        counterparty_name: edge.to_name,
        counterparty_email: edge.to_email,
        amount: edge.amount,
        currency: edge.currency,
      },
      input.lastSeenByUserId,
    );
    addAction(
      emails,
      edge.to_user_id,
      edge.to_email,
      input.periodKey,
      input.appUrl,
      logoUrl,
      {
        direction: 'owed',
        group_id: edge.group_id,
        group_name: edge.group_name,
        counterparty_name: edge.from_name,
        counterparty_email: edge.from_email,
        amount: edge.amount,
        currency: edge.currency,
      },
      input.lastSeenByUserId,
    );
  }

  return Array.from(emails.values()).sort((a, b) => a.user_id.localeCompare(b.user_id));
}
