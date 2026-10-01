import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATUSES,
  normalizeSettings,
  normalizeStatuses,
  renderTemplate,
  resolveLanguage,
  resolveStatus,
  SETTING_KEYS,
} from '../src/settings';
import { messages, t } from '../src/i18n';

test('package.json declares every setting with the same default', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const declared = pkg.contributes.configuration.properties;
  assert.deepEqual(Object.keys(declared).sort(), SETTING_KEYS.map((k) => `markPlanner.${k}`).sort());
  for (const key of SETTING_KEYS) {
    // `properties` holds overrides only; the full map is applied in normalizeSettings.
    const expected = key === 'properties' ? {} : DEFAULT_SETTINGS[key];
    assert.deepEqual(declared[`markPlanner.${key}`].default, expected, key);
  }
});

test('normalizeSettings falls back to defaults for invalid values', () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  const s = normalizeSettings({
    include: '  ',
    exclude: '',
    properties: { end: 'due', start: '', bogus: 'x' },
    eventColor: 'purple',
    calendarView: 'year',
    weekStart: 9,
    hideDone: 'yes',
    'template.frontmatter': ['not', 'an', 'object'],
    language: 'fr',
  });
  assert.equal(s.include, '**/*.md');
  assert.equal(s.exclude, '');
  assert.equal(s.properties.end, 'due');
  assert.equal(s.properties.start, 'start');
  assert.equal('bogus' in s.properties, false);
  assert.equal(s.eventColor, DEFAULT_SETTINGS.eventColor);
  assert.equal(s.calendarView, 'month');
  assert.equal(s.weekStart, 0);
  assert.equal(s.hideDone, false);
  assert.deepEqual(s['template.frontmatter'], {});
  assert.equal(s.language, 'auto');
  assert.equal(normalizeSettings({ weekStart: 1 }).weekStart, 1);
  assert.equal(normalizeSettings({ maxEventsPerDay: 5 }).maxEventsPerDay, 5);
  assert.equal(normalizeSettings({ theme: 'dark' }).theme, 'dark');
  assert.equal(normalizeSettings({ theme: 'sepia' }).theme, 'auto');
  assert.equal(normalizeSettings({ maxEventsPerDay: -1 }).maxEventsPerDay, 0);
  assert.equal(normalizeSettings({ maxEventsPerDay: 2.5 }).maxEventsPerDay, 0);
});

test('normalizeStatuses drops bad rows and clamps values', () => {
  assert.deepEqual(
    normalizeStatuses([
      { name: ' 未着手 ', color: '#112233', progress: 150 },
      { name: '未着手', color: '#000000' },
      { name: '', color: '#000000' },
      { name: 'blocked', color: 'red', progress: 'x', done: 'true', label: ' 停止 ' },
    ]),
    [
      { name: '未着手', color: '#112233', progress: 100, done: false },
      { name: 'blocked', label: '停止', color: '#888888', progress: 0, done: false },
    ],
  );
  assert.equal(normalizeStatuses([]), DEFAULT_STATUSES);
  assert.equal(normalizeStatuses('nope'), DEFAULT_STATUSES);
});

test('resolveStatus treats unknown statuses as the first', () => {
  assert.deepEqual(resolveStatus('done', DEFAULT_STATUSES), { ...DEFAULT_STATUSES[2], index: 2 });
  assert.equal(resolveStatus('???', DEFAULT_STATUSES).index, 0);
});

test('renderTemplate', () => {
  assert.equal(renderTemplate('# {{title}}\n{{ date }} {{other}}', { title: 'A', date: '2026-10-06' }), '# A\n2026-10-06 {{other}}');
});

test('resolveLanguage', () => {
  assert.equal(resolveLanguage('auto', 'ja'), 'ja');
  assert.equal(resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(resolveLanguage('en', 'ja'), 'en');
});

test('i18n: both languages define the same keys and placeholders', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ja).sort());
  for (const key of Object.keys(messages.ja) as (keyof typeof messages.ja)[]) {
    const placeholders = (s: string) => (s.match(/\{\d+\}|\{\{\w+\}\}/g) ?? []).sort();
    assert.deepEqual(placeholders(messages.en[key]), placeholders(messages.ja[key]), key);
  }
  assert.equal(t('en', 'msg.reassigned', 3), 'Mark Planner: Reassigned 3 ID(s).');
});

test('package.nls files define the same keys', () => {
  const en = JSON.parse(readFileSync('package.nls.json', 'utf8'));
  const ja = JSON.parse(readFileSync('package.nls.ja.json', 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort());
});
