import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datesBetween, japaneseHoliday, japaneseHolidaysBetween, vacationDays } from '../src/holidays';
import { toPlannerItem } from '../src/model';
import { normalizeSettings } from '../src/settings';

test('japanese holidays', () => {
  assert.equal(japaneseHoliday('2026-11-03', 'ja'), '文化の日');
  assert.equal(japaneseHoliday('2026-11-03', 'en'), 'National Culture Day');
  assert.equal(japaneseHoliday('2026-11-04', 'ja'), undefined);
  assert.deepEqual(
    japaneseHolidaysBetween('2026-10-01', '2026-11-30', 'ja').map((h) => h.date),
    ['2026-10-12', '2026-11-03', '2026-11-23'],
  );
});

test('datesBetween is inclusive, ignores times and crosses months', () => {
  assert.deepEqual(datesBetween('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(datesBetween('2026-10-06T10:00', '2026-10-06T11:00'), ['2026-10-06']);
  assert.deepEqual(datesBetween('2026-10-06', '2026-10-05'), []);
});

test('vacationDays expands holiday items only', () => {
  const items = [
    toPlannerItem({ type: 'holiday', title: '夏休み', start: '2026-08-10', end: '2026-08-12' }, 'a', 'a.md')!,
    toPlannerItem({ type: 'holiday', title: '有給', end: '2026-08-20' }, 'b', 'b.md')!,
    toPlannerItem({ type: 'task', title: 'x', start: '2026-08-11' }, 'c', 'c.md')!,
  ];
  assert.deepEqual(vacationDays(items), [
    { date: '2026-08-10', name: '夏休み' },
    { date: '2026-08-11', name: '夏休み' },
    { date: '2026-08-12', name: '夏休み' },
    { date: '2026-08-20', name: '有給' },
  ]);
});

test('weekendDays are normalized', () => {
  assert.deepEqual(normalizeSettings({ weekendDays: [6, 0, 6, 7, 'x'] }).weekendDays, [0, 6]);
  assert.deepEqual(normalizeSettings({ weekendDays: [] }).weekendDays, []);
  assert.deepEqual(normalizeSettings({ weekendDays: 'sat' }).weekendDays, [0, 6]);
  assert.equal(normalizeSettings({ showHolidays: false }).showHolidays, false);
});
