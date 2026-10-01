import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveToPatch, normalizeDate, toPlannerItem } from '../src/model';
import { baseFileName, sanitizeTitle, uniqueFileName } from '../src/filename';
import { generateId } from '../src/id';

test('normalizeDate', () => {
  assert.equal(normalizeDate('2026-10-06'), '2026-10-06');
  assert.equal(normalizeDate('2026-10-06 10:30'), '2026-10-06T10:30');
  assert.equal(normalizeDate('2026-10-06T10:30:00'), '2026-10-06T10:30');
  assert.equal(normalizeDate('tomorrow'), undefined);
});

test('toPlannerItem requires a date and falls back to file name', () => {
  assert.equal(toPlannerItem({ title: 'x' }, 'k', 'a.md'), undefined);
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
  assert.equal(baseFileName('2026-10-06T10:00', '定例MTG'), '2026-10-06-定例MTG');
  const taken = new Set(['x.md', 'x-2.md']);
  assert.equal(await uniqueFileName('x', async (n) => taken.has(n)), 'x-3.md');
});

test('generateId avoids taken ids', () => {
  const id = generateId();
  assert.match(id, /^[0-9a-z]{6}$/);
  assert.notEqual(generateId(new Set([id])), id);
});
