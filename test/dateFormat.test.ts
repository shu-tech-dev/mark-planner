import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATE_FORMAT_PRESETS, formatDisplayDate } from '../src/dateFormat';
import { normalizeSettings } from '../src/settings';

const today = new Date(2026, 9, 1);
const f = (value: string, format: string, lang: 'ja' | 'en' = 'ja') => formatDisplayDate(value, format, lang, today);

test('auto omits the current year', () => {
  assert.equal(f('2026-10-05', 'auto'), '10/5 (月)');
  assert.equal(f('2027-01-04', 'auto'), '2027/1/4 (月)');
  assert.equal(f('2026-10-05', 'auto', 'en'), '10/5 (Mon)');
});

test('tokens, literals and time', () => {
  assert.equal(f('2026-10-05', 'YYYY/MM/DD'), '2026/10/05');
  assert.equal(f('2026-10-05', 'YYYY年M月D日(ddd)'), '2026年10月5日(月)');
  assert.equal(f('2026-10-05', 'MMM D, YYYY', 'en'), 'Oct 5, 2026');
  assert.equal(f('2026-10-05', 'dddd, MMMM D', 'en'), 'Monday, October 5');
  assert.equal(f('2026-10-05', 'YY.MM.DD'), '26.10.05');
  assert.equal(f('2026-10-05', '[Day] D [of] M'), 'Day 5 of 10');
  assert.equal(f('2026-10-05T09:30', 'YYYY-MM-DD'), '2026-10-05 09:30');
});

test('presets all render', () => {
  for (const preset of DATE_FORMAT_PRESETS) {
    assert.ok(f('2026-10-05', preset).length > 0, preset);
  }
});

test('dateFormat setting is normalized', () => {
  assert.equal(normalizeSettings({}).dateFormat, 'auto');
  assert.equal(normalizeSettings({ dateFormat: '  YYYY/MM/DD ' }).dateFormat, 'YYYY/MM/DD');
  assert.equal(normalizeSettings({ dateFormat: '' }).dateFormat, 'auto');
  assert.equal(normalizeSettings({ dateFormat: 'x'.repeat(100) }).dateFormat, 'auto');
});
