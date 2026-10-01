import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ancestorTitles, buildTree, parentMap } from '../src/hierarchy';
import type { PlannerItem } from '../src/model';

function item(p: Partial<PlannerItem> & { title: string }): PlannerItem {
  return { key: p.title, type: 'task', status: 'todo', tags: [], depends: [], path: `${p.title}.md`, ...p };
}

const rowsOf = (items: PlannerItem[]) =>
  buildTree(items).map((r) => `${'  '.repeat(r.depth)}${r.item.title} ${r.start}..${r.end}${r.derived ? ' *' : ''}`);

test('children follow their parent, siblings sorted by start', () => {
  const items = [
    item({ title: 'B', id: 'b', parent: 'p', start: '2026-10-05' }),
    item({ title: 'other', start: '2026-10-02' }),
    item({ title: 'P', id: 'p', start: '2026-10-01', end: '2026-10-10' }),
    item({ title: 'A', id: 'a', parent: 'p', start: '2026-10-03', end: '2026-10-04' }),
    item({ title: 'A1', parent: 'a', start: '2026-10-03' }),
  ];
  assert.deepEqual(rowsOf(items), [
    'P 2026-10-01..2026-10-10',
    '  A 2026-10-03..2026-10-04',
    '    A1 2026-10-03..2026-10-03',
    '  B 2026-10-05..2026-10-05',
    'other 2026-10-02..2026-10-02',
  ]);
  assert.equal(buildTree(items)[0].hasChildren, true);
  assert.equal(buildTree(items)[2].hasChildren, false);
});

test('undated parent spans its children; undated leaves are dropped', () => {
  const items = [
    item({ title: 'epic', id: 'e' }),
    item({ title: 'x', parent: 'e', start: '2026-10-05', end: '2026-10-07' }),
    item({ title: 'y', parent: 'e', end: '2026-10-20' }),
    item({ title: 'empty', id: 'z' }),
  ];
  assert.deepEqual(rowsOf(items), [
    'epic 2026-10-05..2026-10-20 *',
    '  x 2026-10-05..2026-10-07',
    '  y 2026-10-20..2026-10-20',
  ]);
});

test('unknown parent and cycles do not hide items', () => {
  const items = [
    item({ title: 'orphan', parent: 'missing', start: '2026-10-01' }),
    item({ title: 'c1', id: 'c1', parent: 'c2', start: '2026-10-02' }),
    item({ title: 'c2', id: 'c2', parent: 'c1', start: '2026-10-03' }),
    item({ title: 'self', id: 's', parent: 's', start: '2026-10-04' }),
  ];
  const rows = rowsOf(items);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(0, 1), ['orphan 2026-10-01..2026-10-01']);
  assert.ok(rows.includes('self 2026-10-04..2026-10-04'));
});

test('undated cycle terminates', () => {
  const items = [item({ title: 'a', id: 'a', parent: 'b' }), item({ title: 'b', id: 'b', parent: 'a' })];
  assert.deepEqual(buildTree(items), []);
});

test('ancestorTitles', () => {
  const items = [
    item({ title: 'root', id: 'r' }),
    item({ title: 'mid', id: 'm', parent: 'r' }),
    item({ title: 'leaf', parent: 'm', start: '2026-10-01' }),
  ];
  assert.deepEqual(ancestorTitles(items[2], parentMap(items)), ['mid', 'root']);
});
