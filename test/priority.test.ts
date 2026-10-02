import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard } from '../src/kanban';
import { buildList } from '../src/list';
import { DEFAULT_PROPERTY_MAP, toPlannerItem, type PlannerItem } from '../src/model';
import { parsePriority, priorityLabel } from '../src/priority';
import { DEFAULT_SETTINGS, DEFAULT_STATUSES } from '../src/settings';
import { buildTable, cellPatch, DEFAULT_QUERY } from '../src/table';

function item(p: Partial<PlannerItem> & { title: string }): PlannerItem {
  return { key: p.title, type: 'task', status: 'todo', tags: [], depends: [], path: `${p.title}.md`, ...p };
}

test('parses numbers, p1–p3 and words', () => {
  assert.equal(parsePriority(1), 1);
  assert.equal(parsePriority('P2'), 2);
  assert.equal(parsePriority(' low '), 3);
  assert.equal(parsePriority('高'), 1);
  assert.equal(parsePriority(4), undefined);
  assert.equal(parsePriority('urgent'), undefined);
  assert.equal(parsePriority(undefined), undefined);
  assert.equal(priorityLabel(1, 'ja'), 'P1 高');
  assert.equal(priorityLabel(3, 'en'), 'P3 Low');
});

test('reads the priority key (and its mapped name)', () => {
  assert.equal(toPlannerItem({ end: '2026-10-05', priority: 'high' }, 'k', 'a.md')?.priority, 1);
  assert.equal(toPlannerItem({ end: '2026-10-05', priority: 9 }, 'k', 'a.md')?.priority, undefined);
  const props = { ...DEFAULT_PROPERTY_MAP, priority: 'prio' };
  assert.equal(toPlannerItem({ end: '2026-10-05', prio: 2 }, 'k', 'a.md', props)?.priority, 2);
});

const items = [
  item({ title: 'none', end: '2026-10-14' }),
  item({ title: 'low', end: '2026-10-14', priority: 3 }),
  item({ title: 'high-timed', end: '2026-10-14T17:00', priority: 1 }),
  item({ title: 'high-tomorrow', end: '2026-10-15', priority: 1 }),
  item({ title: 'medium', end: '2026-10-14', priority: 2 }),
];

test('list: same deadline day sorts high priority first, time ignored', () => {
  const sections = buildList(items, '2026-10-14', { statuses: DEFAULT_STATUSES, weekStart: 0, showCompleted: false });
  assert.deepEqual(
    sections.find((s) => s.id === 'today')!.items.map((i) => i.title),
    ['high-timed', 'medium', 'low', 'none'],
  );
});

test('kanban: priority breaks ties in urgency', () => {
  const board = buildBoard(items, DEFAULT_SETTINGS.statuses, (i) =>
    i.end!.startsWith('2026-10-14') ? { kind: 'today', days: 0 } : { kind: 'left', days: 2 },
  );
  assert.deepEqual(board[0].cards.map((i) => i.title), ['high-timed', 'medium', 'low', 'none', 'high-tomorrow']);
});

test('table: priority column sorts high first, unset last in both directions', () => {
  const titles = (dir: 'asc' | 'desc') =>
    buildTable(items, { ...DEFAULT_QUERY, sort: { column: 'priority', dir } }, DEFAULT_STATUSES)[0].rows.map(
      (r) => r.item.title,
    );
  assert.deepEqual(titles('asc'), ['high-timed', 'high-tomorrow', 'medium', 'low', 'none']);
  assert.deepEqual(titles('desc'), ['low', 'medium', 'high-timed', 'high-tomorrow', 'none']);
});

test('table: priority cell edits', () => {
  const props = { ...DEFAULT_PROPERTY_MAP, priority: 'prio' };
  assert.deepEqual(cellPatch('priority', 2, props), { prio: 2 });
  assert.deepEqual(cellPatch('priority', 'p1', props), { prio: 1 });
  assert.deepEqual(cellPatch('priority', '', props), { prio: undefined });
  assert.equal(cellPatch('priority', 7, props), undefined);
});
