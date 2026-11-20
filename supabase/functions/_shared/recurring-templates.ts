export const RECURRING_CADENCES = ['weekly', 'monthly', 'yearly'] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];
export const RECURRING_TEMPLATE_STATUSES = ['active', 'paused'] as const;
export type RecurringTemplateStatus = (typeof RECURRING_TEMPLATE_STATUSES)[number];
export const RECURRING_CYCLE_STATUSES = ['added', 'skipped'] as const;
export type RecurringCycleStatus = (typeof RECURRING_CYCLE_STATUSES)[number];
export const RECURRING_PRESETS = ['Rent', 'Utilities', 'Internet'] as const;

export function isRecurringCadence(value: unknown): value is RecurringCadence {
  return value === 'weekly' || value === 'monthly' || value === 'yearly';
}

export function isRecurringTemplateStatus(value: unknown): value is RecurringTemplateStatus {
  return value === 'active' || value === 'paused';
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay)));
}

function utcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isoWeekKey(now: Date): string {
  const date = utcDay(now);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function isoWeeksInYear(year: number): number {
  return isoWeekKey(new Date(Date.UTC(year, 11, 28))).endsWith('-W53') ? 53 : 52;
}

export function periodKey(cadence: RecurringCadence, now: Date): string {
  if (cadence === 'weekly') return isoWeekKey(now);
  if (cadence === 'monthly') {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return String(now.getUTCFullYear());
}

export function isPeriodKey(cadence: RecurringCadence, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (cadence === 'weekly') {
    if (!/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const week = Number(value.slice(6));
    return week >= 1 && week <= isoWeeksInYear(year);
  }
  if (cadence === 'monthly') return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  return /^\d{4}$/.test(value);
}

export function nextPeriodKey(cadence: RecurringCadence, key: string): string {
  if (cadence === 'weekly') {
    const year = Number(key.slice(0, 4));
    const week = Number(key.slice(6));
    if (week >= isoWeeksInYear(year)) return `${year + 1}-W01`;
    return `${year}-W${String(week + 1).padStart(2, '0')}`;
  }
  if (cadence === 'monthly') {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5));
    if (month === 12) return `${year + 1}-01`;
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }
  return String(Number(key) + 1);
}

function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (week - 1) * 7);
  return monday;
}

export function periodDueOnForKey(
  cadence: RecurringCadence,
  anchorIsoDate: string,
  key: string,
): Date {
  const [, monthText, dayText] = anchorIsoDate.split('-');
  const anchorMonth = Number(monthText);
  const anchorDay = Number(dayText);
  const anchor = new Date(`${anchorIsoDate}T00:00:00.000Z`);

  if (cadence === 'weekly') {
    const year = Number(key.slice(0, 4));
    const week = Number(key.slice(6));
    const due = isoWeekMonday(year, week);
    const anchorWeekday = anchor.getUTCDay() || 7;
    due.setUTCDate(due.getUTCDate() + (anchorWeekday - 1));
    return due;
  }
  if (cadence === 'monthly') {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5));
    return utcDate(year, month - 1, anchorDay);
  }
  return utcDate(Number(key), anchorMonth - 1, anchorDay);
}

export function periodDueOn(cadence: RecurringCadence, anchorIsoDate: string, now: Date): Date {
  return periodDueOnForKey(cadence, anchorIsoDate, periodKey(cadence, now));
}

export type RecurringProgressStatus = 'paused' | 'upcoming' | 'due' | 'added' | 'skipped';

export type RecurringCycleLookup = {
  period_key: string;
  status: RecurringCycleStatus;
  transaction_id?: number | null;
};

export type RecurringViewState = {
  current_period_key: string;
  current_status: RecurringProgressStatus;
  due_on: string;
  current_transaction_id: number | null;
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveRecurringView(input: {
  cadence: RecurringCadence;
  anchorDate: string;
  templateStatus: RecurringTemplateStatus;
  cycles?: RecurringCycleLookup[] | null;
  now: Date;
}): RecurringViewState {
  const currentKey = periodKey(input.cadence, input.now);
  const dueOn = (key: string) => periodDueOnForKey(input.cadence, input.anchorDate, key);
  const today = utcDay(input.now);
  const anchor = new Date(`${input.anchorDate}T00:00:00.000Z`);

  if (input.templateStatus === 'paused') {
    return {
      current_period_key: currentKey,
      current_status: 'paused',
      due_on: isoDay(dueOn(currentKey)),
      current_transaction_id: null,
    };
  }

  const cycles = new Map(
    (input.cycles || []).map((cycle) => [cycle.period_key, cycle]),
  );
  const startKey = periodKey(input.cadence, anchor);

  if (startKey > currentKey) {
    return {
      current_period_key: startKey,
      current_status: 'upcoming',
      due_on: isoDay(dueOn(startKey)),
      current_transaction_id: null,
    };
  }

  let key = startKey;
  while (key <= currentKey) {
    const cycle = cycles.get(key);
    if (!cycle) {
      const periodDue = dueOn(key);
      const status: RecurringProgressStatus = today >= periodDue && today >= anchor ? 'due' : 'upcoming';
      return {
        current_period_key: key,
        current_status: status,
        due_on: isoDay(periodDue),
        current_transaction_id: null,
      };
    }
    key = nextPeriodKey(input.cadence, key);
  }

  const currentCycle = cycles.get(currentKey);
  return {
    current_period_key: currentKey,
    current_status: currentCycle?.status ?? 'upcoming',
    due_on: isoDay(dueOn(currentKey)),
    current_transaction_id: currentCycle?.transaction_id ?? null,
  };
}

export function recurringProgress(input: {
  cadence: RecurringCadence;
  anchorDate: string;
  templateStatus: RecurringTemplateStatus;
  cycleStatus?: RecurringCycleStatus | null;
  now: Date;
}): RecurringProgressStatus {
  const cycles = input.cycleStatus
    ? [{ period_key: periodKey(input.cadence, input.now), status: input.cycleStatus }]
    : [];
  return resolveRecurringView({
    cadence: input.cadence,
    anchorDate: input.anchorDate,
    templateStatus: input.templateStatus,
    cycles,
    now: input.now,
  }).current_status;
}
