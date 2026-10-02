import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessCalendar, remainingBusinessDays } from '../src/businessDays';
import { buildBoard } from '../src/kanban';
import type { PlannerItem } from '../src/model';
import { DEFAULT_SETTINGS } from '../src/settings';

function item(p: Partial<PlannerItem> & { title: string }): PlannerItem {
  return { key: p.title, type: 'task', status: 'todo', tags: [], depends: [], path: `${p.title}.md`, ...p };
}

const items = [
  item({ title: 'later', end: '2026-10-30' }),
  item({ title: 'undated', id: 'u' }),
  item({ title: 'overdue', end: '2026-10-01' }),
  item({ title: 'today', end: '2026-10-05' }),
  item({ title: 'unknown-status', status: 'blocked', end: '2026-10-09' }),
  item({ title: 'in-progress', status: 'doing', start: '2026-10-05', end: '2026-10-07' }),
  item({ title: 'finished', status: 'done', end: '2026-10-01' }),
  item({ title: 'meeting', type: 'event', start: '2026-10-05T10:00' }),
  item({ title: 'vacation', type: 'holiday', start: '2026-10-06' }),
];
const cal = businessCalendar(items, DEFAULT_SETTINGS);
const board = buildBoard(items, DEFAULT_SETTINGS.statuses, (i) =>
  remainingBusinessDays(i, '2026-10-05', cal, DEFAULT_SETTINGS),
);

test('one column per status, tasks only, unknown statuses in the first column', () => {
  assert.deepEqual(
    board.map((c) => [c.status.name, c.cards.map((i) => i.title)]),
    [
      ['todo', ['overdue', 'today', 'unknown-status', 'later', 'undated']],
      ['doing', ['in-progress']],
      ['done', ['finished']],
    ],
  );
});

test('custom statuses define the columns', () => {
  const statuses = [
    { name: 'backlog', color: '#888888', progress: 0, done: false },
    { name: 'todo', color: '#3794ff', progress: 0, done: false },
  ];
  const cols = buildBoard(items, statuses, () => undefined);
  assert.deepEqual(cols.map((c) => c.status.name), ['backlog', 'todo']);
  // 'doing'/'done'/'blocked' are unknown here → first column.
  assert.ok(cols[0].cards.some((i) => i.title === 'in-progress'));
  assert.deepEqual(cols[1].cards.map((i) => i.title), ['overdue', 'today', 'later', 'undated']);
});
