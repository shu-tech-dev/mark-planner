import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessCalendar, countBusinessDays, remainingBusinessDays, remainingLabel, remainingSortKey } from '../src/businessDays';
import { toPlannerItem } from '../src/model';
import { DEFAULT_SETTINGS } from '../src/settings';

const vacation = toPlannerItem({ type: 'holiday', title: '休暇', start: '2026-10-15', end: '2026-10-16' }, 'v', 'v.md')!;
const cal = businessCalendar([vacation], DEFAULT_SETTINGS);
const task = (data: Record<string, unknown>) => toPlannerItem({ type: 'task', title: 't', ...data }, 'k', 'k.md')!;
const remaining = (data: Record<string, unknown>, today = '2026-10-05') =>
  remainingBusinessDays(task(data), today, cal, DEFAULT_SETTINGS);

test('business days skip weekends, holidays and vacations', () => {
  // 2026-10-05 (Mon) .. 10-09 (Fri): 5 days
  assert.equal(countBusinessDays('2026-10-05', '2026-10-09', cal), 5);
  // + weekend 10-10/11, スポーツの日 10-12 (Mon)
  assert.equal(countBusinessDays('2026-10-05', '2026-10-13', cal), 6);
  // vacation 10-15/16
  assert.equal(countBusinessDays('2026-10-13', '2026-10-16', cal), 2);
  assert.equal(countBusinessDays('2026-10-09', '2026-10-05', cal), 0);
  const noHolidays = businessCalendar([], { ...DEFAULT_SETTINGS, showHolidays: false, weekendColors: { '0': '#ff0000' } });
  assert.equal(countBusinessDays('2026-10-10', '2026-10-12', noHolidays), 2); // Sat + Mon
});

test('remaining counts today and the deadline', () => {
  assert.deepEqual(remaining({ start: '2026-10-01', end: '2026-10-07' }), { kind: 'left', days: 3 }); // Mon-Wed
  assert.deepEqual(remaining({ start: '2026-10-05' }), { kind: 'today', days: 1 });
  assert.deepEqual(remaining({ end: '2026-10-11' }), { kind: 'left', days: 5 }); // deadline on Sunday
  assert.deepEqual(remaining({ end: '2026-10-07T18:00' }), { kind: 'left', days: 3 });
  // Overdue: deadline Fri 10-02, today Wed 10-07 → Mon, Tue, Wed
  assert.deepEqual(remaining({ end: '2026-10-02' }, '2026-10-07'), { kind: 'overdue', days: 3 });
  // Overdue on a weekend only: deadline Fri, today Sun → 0 business days late
  assert.deepEqual(remaining({ end: '2026-10-02' }, '2026-10-04'), { kind: 'overdue', days: 0 });
});

test('remaining is undefined for events, vacations, done and undated tasks', () => {
  assert.equal(remaining({ start: '2026-10-07', status: 'done' }), undefined);
  assert.equal(remaining({ id: 'undated' }), undefined);
  assert.equal(remainingBusinessDays(vacation, '2026-10-05', cal, DEFAULT_SETTINGS), undefined);
  assert.equal(
    remainingBusinessDays({ ...task({ start: '2026-10-07' }), type: 'event' }, '2026-10-05', cal, DEFAULT_SETTINGS),
    undefined,
  );
});

test('sort key orders overdue, today, then days left', () => {
  const keys = [
    { kind: 'left', days: 3 },
    { kind: 'overdue', days: 1 },
    { kind: 'today', days: 1 },
    { kind: 'overdue', days: 5 },
    { kind: 'left', days: 0 },
  ].map((r) => remainingSortKey(r as never)!);
  assert.deepEqual(
    keys.map((k, i) => [k, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i),
    [3, 1, 2, 4, 0],
  );
});

test('remainingLabel uses singular for one workday', () => {
  assert.equal(remainingLabel({ kind: 'left', days: 1 }, 'en'), '1 workday left');
  assert.equal(remainingLabel({ kind: 'left', days: 3 }, 'en'), '3 workdays left');
  assert.equal(remainingLabel({ kind: 'overdue', days: 1 }, 'en'), '1 workday overdue');
  assert.equal(remainingLabel({ kind: 'left', days: 1 }, 'ja'), '残り1営業日');
});
