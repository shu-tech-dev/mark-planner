import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveToPatch, normalizeDate, toPlannerItem } from '../src/model';
import { baseFileName, replaceIdPrefix, sanitizeTitle, uniqueFileName } from '../src/filename';
import { generateId } from '../src/id';

test('normalizeDate', () => {
  assert.equal(normalizeDate('2026-10-06'), '2026-10-06');
  assert.equal(normalizeDate('2026-10-06 10:30'), '2026-10-06T10:30');
  assert.equal(normalizeDate('2026-10-06T10:30:00'), '2026-10-06T10:30');
  assert.equal(normalizeDate('tomorrow'), undefined);
});

test('toPlannerItem requires a date or an id and falls back to file name', () => {
  assert.equal(toPlannerItem({ title: 'x' }, 'k', 'a.md'), undefined);
  assert.equal(toPlannerItem({ id: 'p1', title: 'epic' }, 'k', 'a.md')?.start, undefined);
  const item = toPlannerItem({ end: '2026-10-06', depends: 'abc' }, 'k', 'dir/2026-10-06-foo.md');
  assert.equal(item?.title, '2026-10-06-foo');
  assert.equal(item?.type, 'task');
  assert.equal(item?.status, 'todo');
  assert.deepEqual(item?.depends, ['abc']);
});

test('moveToPatch keeps item shape', () => {
  assert.deepEqual(moveToPatch({ start: '2026-10-01' }, '2026-10-03', '2026-10-03'), { start: '2026-10-03' });
  assert.deepEqual(moveToPatch({ start: '2026-10-01' }, '2026-10-03', '2026-10-05'), {
    start: '2026-10-03',
    end: '2026-10-05',
  });
  assert.deepEqual(moveToPatch({ end: '2026-10-01' }, '2026-10-03', '2026-10-03'), { end: '2026-10-03' });
  assert.deepEqual(moveToPatch({ start: '2026-10-01', end: '2026-10-02' }, '2026-10-03', '2026-10-04'), {
    start: '2026-10-03',
    end: '2026-10-04',
  });
});

test('file names', async () => {
  assert.equal(sanitizeTitle('a/b: c?'), 'a-b- c-');
  assert.equal(sanitizeTitle('  ...  '), 'untitled');
  assert.equal(baseFileName('tk2m9a', '定例MTG'), 'tk2m9a-定例MTG');
  assert.equal(replaceIdPrefix('aaa111-review copy.md', 'aaa111', 'bbb222'), 'bbb222-review copy.md');
  assert.equal(replaceIdPrefix('aaa111.md', 'aaa111', 'bbb222'), 'bbb222.md');
  assert.equal(replaceIdPrefix('aaa1111-x.md', 'aaa111', 'bbb222'), undefined);
  assert.equal(replaceIdPrefix('2026-10-06-x.md', 'aaa111', 'bbb222'), undefined);
  const taken = new Set(['x.md', 'x-2.md']);
  assert.equal(await uniqueFileName('x', async (n) => taken.has(n)), 'x-3.md');
});

test('generateId is short, time-sortable and unique', () => {
  const t = Date.UTC(2026, 9, 1);
  const a = generateId(new Set(), t);
  assert.match(a, /^[0-9a-z]{6}$/);
  // Same second again: bumped instead of repeated.
  const b = generateId(new Set(), t);
  assert.ok(b > a);
  // Skips ids already used by files.
  const later = Date.UTC(2026, 9, 2);
  const c = generateId(new Set([generateIdAt(later)]), later);
  assert.ok(c > generateIdAt(later));
  // Lexical order follows time, also across the 2020 epoch decades.
  assert.ok(generateId(new Set(), Date.UTC(2040, 0, 1)) > c);
});

/** Expected encoding for a time, independent of generateId's internal state. */
function generateIdAt(ms: number): string {
  return Math.floor((ms - Date.UTC(2020, 0, 1)) / 1000).toString(36).padStart(6, '0');
}
