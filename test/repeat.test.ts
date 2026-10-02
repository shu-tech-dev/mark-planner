import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlannerItem } from '../src/model';
import { nextOccurrence, parseRepeat, repeatLabel, uncheckChecklist } from '../src/repeat';

test('parses English, Japanese and "every N" forms', () => {
  assert.deepEqual(parseRepeat('weekly'), { unit: 'week', every: 1 });
  assert.deepEqual(parseRepeat(' Daily '), { unit: 'day', every: 1 });
  assert.deepEqual(parseRepeat('biweekly'), { unit: 'week', every: 2 });
  assert.deepEqual(parseRepeat('every 3 months'), { unit: 'month', every: 3 });
  assert.deepEqual(parseRepeat('every year'), { unit: 'year', every: 1 });
  assert.deepEqual(parseRepeat('weekdays'), { unit: 'weekday', every: 1 });
  assert.deepEqual(parseRepeat('毎月'), { unit: 'month', every: 1 });
  assert.deepEqual(parseRepeat('隔週'), { unit: 'week', every: 2 });
  assert.deepEqual(parseRepeat('3日ごと'), { unit: 'day', every: 3 });
  assert.deepEqual(parseRepeat('2ヶ月ごと'), { unit: 'month', every: 2 });
  assert.equal(parseRepeat('sometimes'), undefined);
  assert.equal(parseRepeat('every 0 days'), undefined);
  assert.equal(parseRepeat(undefined), undefined);
});

test('labels', () => {
  assert.equal(repeatLabel({ unit: 'week', every: 1 }, 'ja'), '毎週');
  assert.equal(repeatLabel({ unit: 'month', every: 2 }, 'ja'), '2か月ごと');
  assert.equal(repeatLabel({ unit: 'weekday', every: 1 }, 'ja'), '平日');
  assert.equal(repeatLabel({ unit: 'week', every: 1 }, 'en'), 'Weekly');
  assert.equal(repeatLabel({ unit: 'day', every: 3 }, 'en'), 'Every 3 days');
});

test('moves start and end together, keeping the span and time of day', () => {
  const weekly = parseRepeat('weekly')!;
  assert.deepEqual(nextOccurrence({ start: '2026-10-05', end: '2026-10-07' }, weekly, '2026-10-05'), {
    start: '2026-10-12',
    end: '2026-10-14',
  });
  assert.deepEqual(nextOccurrence({ start: '2026-10-05T10:00', end: '2026-10-05T11:00' }, weekly, '2026-10-01'), {
    start: '2026-10-12T10:00',
    end: '2026-10-12T11:00',
  });
  // Deadline-only and start-only tasks keep their shape.
  assert.deepEqual(nextOccurrence({ end: '2026-10-05' }, weekly, '2026-10-05'), { end: '2026-10-12' });
  assert.deepEqual(nextOccurrence({ start: '2026-10-05' }, weekly, '2026-10-05'), { start: '2026-10-12' });
  assert.equal(nextOccurrence({}, weekly, '2026-10-05'), undefined);
});

test('skips past occurrences when completed late', () => {
  const weekly = parseRepeat('weekly')!;
  // Due 9/7, done on 10/2: next is the first one not overdue.
  assert.deepEqual(nextOccurrence({ end: '2026-09-07' }, weekly, '2026-10-02'), { end: '2026-10-05' });
  // A span counts as current while its deadline is today or later.
  assert.deepEqual(nextOccurrence({ start: '2026-09-21', end: '2026-09-25' }, weekly, '2026-10-02'), {
    start: '2026-09-28',
    end: '2026-10-02',
  });
});

test('months clamp to the last day; weekdays skip weekends', () => {
  assert.deepEqual(nextOccurrence({ end: '2026-01-31' }, parseRepeat('monthly')!, '2026-01-01'), { end: '2026-02-28' });
  assert.deepEqual(nextOccurrence({ end: '2028-02-29' }, parseRepeat('yearly')!, '2028-01-01'), { end: '2029-02-28' });
  // Fri 10/2 → Mon 10/5
  assert.deepEqual(nextOccurrence({ end: '2026-10-02' }, parseRepeat('weekdays')!, '2026-10-02'), { end: '2026-10-05' });
});

test('unchecks the checklist outside code blocks', () => {
  const body = ['- [x] a', '  * [X] b', '1. [ ] c', '```', '- [x] code', '```', 'text [x]'].join('\n');
  assert.equal(uncheckChecklist(body), ['- [ ] a', '  * [ ] b', '1. [ ] c', '```', '- [x] code', '```', 'text [x]'].join('\n'));
});

test('reads the repeat key (and its mapped name)', () => {
  assert.equal(toPlannerItem({ end: '2026-10-05', repeat: 'weekly' }, 'k', 'a.md')?.repeat, 'weekly');
  assert.equal(toPlannerItem({ end: '2026-10-05' }, 'k', 'a.md')?.repeat, undefined);
  const props = { id: 'id', title: 'title', type: 'type', status: 'status', start: 'start', end: 'end', tags: 'tags', parent: 'parent', depends: 'depends', repeat: 'every' };
  assert.equal(toPlannerItem({ end: '2026-10-05', every: '毎週' }, 'k', 'a.md', props)?.repeat, '毎週');
});
