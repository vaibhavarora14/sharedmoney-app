import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  isoWeekKey,
  isoWeeksInYear,
  isPeriodKey,
  nextPeriodKey,
  periodDueOn,
  periodDueOnForKey,
  periodKey,
  recurringProgress,
  resolveRecurringView,
} from './recurring-templates.ts';

const mon = new Date('2026-11-16T12:00:00.000Z'); // Monday
const wed = new Date('2026-11-18T12:00:00.000Z');
const nov5 = new Date('2026-11-05T12:00:00.000Z');
const nov15 = new Date('2026-11-15T12:00:00.000Z');
const jan31 = new Date('2026-01-31T12:00:00.000Z');

Deno.test('period keys use UTC weeks, months, and years', () => {
  assertEquals(isoWeekKey(mon), '2026-W47');
  assertEquals(periodKey('weekly', wed), '2026-W47');
  assertEquals(periodKey('monthly', nov15), '2026-11');
  assertEquals(periodKey('yearly', nov15), '2026');
});

Deno.test('periodDueOn keeps the anchor weekday, month day, or year day', () => {
  assertEquals(periodDueOn('weekly', '2026-11-18', mon).toISOString().slice(0, 10), '2026-11-18');
  assertEquals(periodDueOn('monthly', '2026-01-15', nov5).toISOString().slice(0, 10), '2026-11-15');
  assertEquals(periodDueOn('monthly', '2026-01-31', new Date('2026-02-10T00:00:00.000Z')).toISOString().slice(0, 10), '2026-02-28');
  assertEquals(periodDueOn('yearly', '2026-11-15', jan31).toISOString().slice(0, 10), '2026-11-15');
});

Deno.test('recurringProgress is due on or after the period date', () => {
  const base = { cadence: 'monthly' as const, anchorDate: '2026-11-15', templateStatus: 'active' as const };
  assertEquals(recurringProgress({ ...base, now: nov5 }), 'upcoming');
  assertEquals(recurringProgress({ ...base, now: nov15 }), 'due');
  assertEquals(recurringProgress({ ...base, now: nov15, cycleStatus: 'added' }), 'added');
  assertEquals(recurringProgress({ ...base, now: nov15, cycleStatus: 'skipped' }), 'skipped');
  assertEquals(recurringProgress({ ...base, templateStatus: 'paused', now: nov15 }), 'paused');
  assertEquals(recurringProgress({ ...base, anchorDate: '2026-12-01', now: nov15 }), 'upcoming');
});

Deno.test('late cycles stay due on the missed period until it is decided', () => {
  const view = resolveRecurringView({
    cadence: 'monthly',
    anchorDate: '2026-10-15',
    templateStatus: 'active',
    cycles: [],
    now: nov5,
  });
  assertEquals(view.current_status, 'due');
  assertEquals(view.current_period_key, '2026-10');
  assertEquals(view.due_on, '2026-10-15');

  const afterOctober = resolveRecurringView({
    cadence: 'monthly',
    anchorDate: '2026-10-15',
    templateStatus: 'active',
    cycles: [{ period_key: '2026-10', status: 'skipped' }],
    now: nov5,
  });
  assertEquals(afterOctober.current_status, 'upcoming');
  assertEquals(afterOctober.current_period_key, '2026-11');
  assertEquals(afterOctober.due_on, '2026-11-15');
});

Deno.test('period key helpers increment across year and week boundaries', () => {
  assertEquals(nextPeriodKey('monthly', '2026-12'), '2027-01');
  assertEquals(nextPeriodKey('yearly', '2026'), '2027');
  assertEquals(isoWeeksInYear(2026), 53);
  assertEquals(nextPeriodKey('weekly', '2026-W53'), '2027-W01');
  assertEquals(isPeriodKey('weekly', '2026-W53'), true);
  assertEquals(isPeriodKey('weekly', '2026-W54'), false);
  assertEquals(isPeriodKey('monthly', '2026-13'), false);
  assertEquals(periodDueOnForKey('weekly', '2026-11-18', '2026-W47').toISOString().slice(0, 10), '2026-11-18');
});
