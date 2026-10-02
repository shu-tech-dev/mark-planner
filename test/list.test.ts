import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildList, endOfWeek, toggleStatus } from '../src/list';
import type { PlannerItem } from '../src/model';
import { DEFAULT_SETTINGS, DEFAULT_STATUSES } from '../src/settings';

function item(p: Partial<PlannerItem> & { title: string }): PlannerItem {
  return { key: p.title, type: 'task', status: 'todo', tags: [], depends: [], path: `${p.title}.md`, ...p };
}

// Wednesday 2026-10-14; week starts Sunday → week ends Saturday 10-17.
const today = '2026-10-14';
const items = [
  item({ title: 'old', end: '2026-10-07' }),
  item({ title: 'older', start: '2026-10-01', end: '2026-10-02' }),
  item({ title: 'now', start: '2026-10-14' }),
  item({ title: 'now-timed', end: '2026-10-14T17:00' }),
  item({ title: 'tmr', end: '2026-10-15' }),
  item({ title: 'sat', end: '2026-10-17' }),
  item({ title: 'next-mon', end: '2026-10-19' }),
  item({ title: 'backlog', id: 'b' }),
  item({ title: 'finished', status: 'done', end: '2026-10-13' }),
  item({ title: 'finished-earlier', status: 'done', end: '2026-10-01' }),
  item({ title: 'meeting', type: 'event', start: '2026-10-14T10:00' }),
];
const view = (showCompleted: boolean, keepOpen?: Set<string>, weekStart = 0) =>
  Object.fromEntries(
    buildList(items, today, { statuses: DEFAULT_STATUSES, weekStart, showCompleted, keepOpen }).map((s) => [
      s.id,
      s.items.map((i) => i.title),
    ]),
  );

test('sections by deadline; events excluded; completed hidden', () => {
  assert.deepEqual(view(false), {
    overdue: ['older', 'old'],
    today: ['now', 'now-timed'],
    tomorrow: ['tmr'],
    thisWeek: ['sat'],
    later: ['next-mon'],
    noDate: ['backlog'],
    completed: [],
  });
});

test('completed shown last, most recent first; just-checked stays in place', () => {
  assert.deepEqual(view(true).completed, ['finished', 'finished-earlier']);
  const keep = view(false, new Set(['finished']));
  assert.deepEqual(keep.overdue, ['older', 'old', 'finished']);
});

test('week end follows the week start setting', () => {
  assert.equal(endOfWeek(today, 0), '2026-10-17'); // Sun-start → Sat
  assert.equal(endOfWeek(today, 1), '2026-10-18'); // Mon-start → Sun
  assert.equal(endOfWeek('2026-10-18', 1), '2026-10-18'); // Sunday is the last day
  assert.equal(endOfWeek('2026-10-19', 1), '2026-10-25');
  // Mon-start: Sunday 10-18 is still this week.
  const items2 = [item({ title: 'sun', end: '2026-10-18' })];
  const mon = buildList(items2, today, { statuses: DEFAULT_STATUSES, weekStart: 1, showCompleted: false });
  assert.deepEqual(mon.find((s) => s.id === 'thisWeek')!.items.map((i) => i.title), ['sun']);
});

test('toggleStatus uses the first done status and the first status', () => {
  assert.equal(toggleStatus(true, DEFAULT_STATUSES), 'done');
  assert.equal(toggleStatus(false, DEFAULT_STATUSES), 'todo');
  assert.equal(toggleStatus(true, DEFAULT_SETTINGS.statuses.filter((s) => !s.done)), undefined);
});
