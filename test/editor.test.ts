import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChecks, bodyLines } from '../src/checklist';
import { editorPatch, newItemData, sanitizeFields } from '../src/editor';
import { DEFAULT_PROPERTY_MAP, type PlannerItem } from '../src/model';
import { DEFAULT_STATUSES } from '../src/settings';

const item: PlannerItem = {
  key: 'k',
  id: 'abc123',
  title: '週次報告',
  type: 'task',
  status: 'todo',
  priority: 2,
  end: '2026-10-09',
  tags: ['報告'],
  depends: [],
  repeat: '毎週',
  path: 'planner/abc123-週次報告.md',
};

test('sanitizeFields validates what the dialog sends', () => {
  assert.deepEqual(sanitizeFields({ title: ' a ', type: 'task', tags: ['x', ' x', ''], start: '2026-10-05T09:00' }), {
    title: 'a',
    type: 'task',
    status: undefined,
    priority: undefined,
    start: '2026-10-05T09:00',
    end: undefined,
    tags: ['x'],
    parent: undefined,
    repeat: undefined,
  });
  assert.equal(sanitizeFields({ title: ' ', type: 'task' }), undefined);
  assert.equal(sanitizeFields({ title: 'a', type: 'note' }), undefined);
  assert.equal(sanitizeFields({ title: 'a', type: 'task', start: '10/5' }), undefined);
  assert.equal(sanitizeFields({ title: 'a', type: 'task', start: '2026-10-06', end: '2026-10-05' }), undefined);
  assert.equal(sanitizeFields({ title: 'a', type: 'task', priority: 5 }), undefined);
  assert.equal(sanitizeFields({ title: 'a', type: 'task', repeat: 'sometimes' }), undefined);
  assert.equal(sanitizeFields(null), undefined);
});

test('editorPatch writes only what changed, deleting cleared keys', () => {
  const same = { title: '週次報告', type: 'task' as const, status: 'todo', priority: 2 as const, end: '2026-10-09', tags: ['報告'], repeat: '毎週' };
  assert.deepEqual(editorPatch(item, same, DEFAULT_PROPERTY_MAP), {});
  const props = { ...DEFAULT_PROPERTY_MAP, end: 'due' };
  assert.deepEqual(
    editorPatch(item, { ...same, priority: undefined, start: '2026-10-05', end: '2026-10-10', tags: [], repeat: undefined }, props),
    { priority: undefined, start: '2026-10-05', due: '2026-10-10', tags: [], repeat: undefined },
  );
});

test('newItemData orders keys and skips task-only fields for events', () => {
  const fields = { title: 'MTG', type: 'event' as const, status: 'doing', priority: 1 as const, start: '2026-10-05T10:00', tags: [], repeat: 'weekly' };
  assert.deepEqual(Object.keys(newItemData('id1', fields, DEFAULT_PROPERTY_MAP, DEFAULT_STATUSES)), ['id', 'title', 'type', 'start', 'tags']);
  const task = newItemData('id2', { ...fields, type: 'task', status: 'nope' }, DEFAULT_PROPERTY_MAP, DEFAULT_STATUSES, {
    tags: ['inbox'],
    project: 'x',
  });
  assert.deepEqual(task, {
    id: 'id2',
    title: 'MTG',
    type: 'task',
    status: 'todo', // unknown status → first one
    priority: 1,
    start: '2026-10-05T10:00',
    tags: ['inbox'], // template tags apply when none were given
    repeat: 'weekly',
    project: 'x',
  });
});

const body = ['', '# 手順', '- [x] 集計', '  - [ ] 確認', 'メモ', '```', '- [ ] code', '```', '1. [ ] 送信', ''].join('\n');

test('bodyLines numbers lines like applyChecks and skips fences', () => {
  assert.deepEqual(bodyLines(body), [
    { kind: 'heading', line: 1, level: 1, text: '手順' },
    { kind: 'task', line: 2, depth: 0, checked: true, text: '集計' },
    { kind: 'task', line: 3, depth: 1, checked: false, text: '確認' },
    { kind: 'text', line: 4, depth: 0, text: 'メモ' },
    { kind: 'code', line: 6, text: '- [ ] code' },
    { kind: 'task', line: 8, depth: 0, checked: false, text: '送信' },
  ]);
});

test('applyChecks toggles by line, ignoring lines that are no longer tasks', () => {
  const out = applyChecks(body, [
    { line: 2, checked: false },
    { line: 3, checked: true },
    { line: 4, checked: true }, // plain text
    { line: 6, checked: true }, // inside a code block
    { line: 8, checked: true },
  ]);
  assert.equal(out, ['', '# 手順', '- [ ] 集計', '  - [x] 確認', 'メモ', '```', '- [ ] code', '```', '1. [x] 送信', ''].join('\n'));
  // Keeps CRLF and an existing uppercase mark.
  assert.equal(applyChecks('- [X] a\r\n- [ ] b\r\n', [{ line: 0, checked: true }, { line: 1, checked: true }]), '- [X] a\r\n- [x] b\r\n');
});
