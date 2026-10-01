import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datesBetween, weekendColor, japaneseHoliday, japaneseHolidaysBetween, vacationDays } from '../src/holidays';
import { toPlannerItem } from '../src/model';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';

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

test('weekendColors are normalized', () => {
  assert.deepEqual(DEFAULT_SETTINGS.weekendColors, { '0': '#f14c4c', '6': '#3794ff' });
  assert.deepEqual(
    normalizeSettings({ weekendColors: { '6': '#0000ff', '0': '#ff0000', '7': '#000000', '3': 'blue' } }).weekendColors,
    { '0': '#ff0000', '6': '#0000ff' },
  );
  assert.deepEqual(normalizeSettings({ weekendColors: {} }).weekendColors, {});
  assert.deepEqual(normalizeSettings({ weekendColors: [0, 6] }).weekendColors, DEFAULT_SETTINGS.weekendColors);
  assert.equal(normalizeSettings({ showHolidays: false }).showHolidays, false);
});

test('weekendColor: holidays take precedence', () => {
  const s = DEFAULT_SETTINGS;
  assert.equal(weekendColor('2026-10-10', 6, s), '#3794ff'); // Saturday
  assert.equal(weekendColor('2026-10-11', 0, s), '#f14c4c'); // Sunday
  assert.equal(weekendColor('2026-10-13', 2, s), undefined); // Tuesday
  // 2028-04-29 (昭和の日) is a Saturday: holiday color only, unless holidays are hidden.
  assert.equal(weekendColor('2028-04-29', 6, s), undefined);
  assert.equal(weekendColor('2028-04-29', 6, { ...s, showHolidays: false }), '#3794ff');
});
