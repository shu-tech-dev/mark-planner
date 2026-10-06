import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerItem } from '../src/model';
import { DEFAULT_STATUSES } from '../src/settings';
import { DEFAULT_PROPERTY_MAP } from '../src/model';
import { allTags, buildTable, cellPatch, DEFAULT_QUERY, parentCandidates, TableQuery } from '../src/table';

function item(p: Partial<PlannerItem> & { title: string }): PlannerItem {
  return { key: p.title, type: 'task', status: 'todo', tags: [], depends: [], path: `${p.title}.md`, ...p };
}

const items = [
  item({ title: 'epic', id: 'e' }),
  item({ title: 'b-child', id: 'b', parent: 'e', start: '2026-10-05', status: 'doing', tags: ['api'] }),
  item({ title: 'a-child', id: 'a', parent: 'e', start: '2026-10-03', status: 'done' }),
  item({ title: 'grandchild', parent: 'a', start: '2026-10-04', tags: ['ui'] }),
  item({ title: 'meeting', type: 'event', start: '2026-10-01T10:00' }),
  item({ title: 'backlog', id: 'x' }),
];
const q = (over: Partial<TableQuery>): TableQuery => ({ ...DEFAULT_QUERY, ...over });
const view = (query: TableQuery) =>
  buildTable(items, query, DEFAULT_STATUSES).map((g) => ({
    key: g.key,
    rows: g.rows.map((r) => `${'  '.repeat(r.depth)}${r.item.title}${r.collapsed ? ' +' : ''}`),
  }));

test('tree: parents first, siblings by start date, undated last (by title)', () => {
  assert.deepEqual(view(DEFAULT_QUERY), [
    { key: '', rows: ['meeting', 'backlog', 'epic', '  a-child', '    grandchild', '  b-child'] },
  ]);
});

test('sort applies within siblings; empty values last in both directions', () => {
  assert.deepEqual(view(q({ sort: { column: 'title', dir: 'desc' } }))[0].rows, [
    'meeting', 'epic', '  b-child', '  a-child', '    grandchild', 'backlog',
  ]);
  assert.deepEqual(view(q({ sort: { column: 'status', dir: 'desc' } }))[0].rows.slice(0, 3), ['backlog', 'epic', '  a-child']);
  // meeting (event, no status) sorts last in both directions.
  assert.equal(view(q({ sort: { column: 'status', dir: 'asc' } }))[0].rows.at(-1), 'meeting');
  assert.equal(view(q({ sort: { column: 'status', dir: 'desc' } }))[0].rows.at(-1), 'meeting');
});

test('filters keep ancestors of matches for context', () => {
  assert.deepEqual(view(q({ search: 'GRAND' }))[0].rows, ['epic', '  a-child', '    grandchild']);
  assert.deepEqual(view(q({ tags: ['api'] }))[0].rows, ['epic', '  b-child']);
  assert.deepEqual(view(q({ types: ['event'] }))[0].rows, ['meeting']);
  assert.deepEqual(view(q({ statuses: ['done'] }))[0].rows, ['epic', '  a-child']);
});

test('collapsed parents hide their subtree', () => {
  assert.deepEqual(view(q({ collapsed: ['a-child'] }))[0].rows, ['meeting', 'backlog', 'epic', '  a-child +', '  b-child']);
  assert.deepEqual(view(q({ collapsed: ['epic'] }))[0].rows, ['meeting', 'backlog', 'epic +']);
});

test('grouping by status and type is flat and ordered', () => {
  assert.deepEqual(view(q({ group: 'status' })), [
    { key: 'todo', rows: ['grandchild', 'backlog', 'epic'] },
    { key: 'doing', rows: ['b-child'] },
    { key: 'done', rows: ['a-child'] },
    { key: '', rows: ['meeting'] },
  ]);
  assert.deepEqual(view(q({ group: 'type' })).map((g) => g.key), ['task', 'event']);
});

test('parentCandidates excludes self and descendants', () => {
  const epic = items[0];
  assert.deepEqual(parentCandidates(epic, items).map((i) => i.title), ['backlog']);
  const a = items[2];
  assert.deepEqual(parentCandidates(a, items).map((i) => i.title), ['b-child', 'backlog', 'epic']);
});

test('allTags', () => {
  assert.deepEqual(allTags(items), ['api', 'ui']);
});

test('cellPatch validates edits and maps keys', () => {
  const props = { ...DEFAULT_PROPERTY_MAP, end: 'due' };
  assert.deepEqual(cellPatch('title', '  新 ', props), { title: '新' });
  assert.equal(cellPatch('title', '  ', props), undefined);
  assert.deepEqual(cellPatch('end', '2026-10-06T09:30', props), { due: '2026-10-06T09:30' });
  assert.deepEqual(cellPatch('end', '', props), { due: undefined });
  assert.equal(cellPatch('start', 'tomorrow', props), undefined);
  assert.deepEqual(cellPatch('tags', 'a, b,,a ', props), { tags: ['a', 'b'] });
  assert.deepEqual(cellPatch('type', 'holiday', props), { type: 'holiday' });
  assert.equal(cellPatch('type', 'meeting', props), undefined);
  assert.deepEqual(cellPatch('parent', '', props), { parent: undefined });
  assert.equal(cellPatch('id', 'x', props), undefined);
  assert.equal(cellPatch('path', 'x', props), undefined);
});

test('remaining column sorts by the provided key, empties last', () => {
  const keys = new Map([['b-child', 3], ['a-child', -2], ['grandchild', 0]]);
  const rows = buildTable(items, q({ sort: { column: 'remaining', dir: 'asc' } }), DEFAULT_STATUSES, (i) => keys.get(i.title))[0].rows;
  const children = rows.filter((r) => r.depth === 1).map((r) => r.item.title);
  assert.deepEqual(children, ['a-child', 'b-child']);
});

test('hideDone leaves out completed tasks but keeps a done parent of open work', () => {
  const rows = (hideDone: boolean) =>
    buildTable(
      [
        item({ title: 'epic', id: 'e', status: 'done' }),
        item({ title: 'open-child', parent: 'e' }),
        item({ title: 'done-child', parent: 'e', status: 'done' }),
        item({ title: 'done-alone', status: 'done' }),
        item({ title: 'meeting', type: 'event', status: 'done' }),
      ],
      DEFAULT_QUERY,
      DEFAULT_STATUSES,
      undefined,
      hideDone,
    )[0].rows.map((r) => `${'  '.repeat(r.depth)}${r.item.title}`);
  assert.deepEqual(rows(true), ['epic', '  open-child', 'meeting']);
  assert.equal(rows(false).length, 5);
});
