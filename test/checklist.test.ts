import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countChecklist, itemProgress } from '../src/checklist';
import type { PlannerItem } from '../src/model';
import { DEFAULT_STATUSES } from '../src/settings';

test('counts task list items, nested included (like GitHub)', () => {
  const body = [
    '- [x] API設計',
    '- [ ] 画面',
    '    - [x] 一覧画面',
    '    - [ ] 詳細画面',
    '- [ ] テスト',
  ].join('\n');
  assert.deepEqual(countChecklist(body), { done: 2, total: 5 });
});

test('list markers, uppercase X and CRLF', () => {
  assert.deepEqual(countChecklist('* [X] a\r\n+ [ ] b\r\n1. [x] c\r\n2) [ ] d\r\n'), { done: 2, total: 4 });
});

test('ignores code fences, plain lists, links and malformed boxes', () => {
  const body = [
    '```md',
    '- [x] in code',
    '```',
    '~~~',
    '- [ ] also code ```',
    '~~~',
    '- plain item',
    '- [link](https://example.com)',
    '-[x] no space',
    '- [x]no space after',
    '- [] empty',
    'text - [x] not at line start',
    '- [ ] real',
  ].join('\n');
  assert.deepEqual(countChecklist(body), { done: 0, total: 1 });
  assert.equal(countChecklist('no tasks here'), undefined);
});

test('itemProgress: done status → 100, else checklist, else status progress', () => {
  const base: PlannerItem = { key: 'k', title: 't', type: 'task', status: 'doing', tags: [], depends: [], path: 'k.md' };
  assert.equal(itemProgress(base, DEFAULT_STATUSES), 50);
  assert.equal(itemProgress({ ...base, checklist: { done: 1, total: 3 } }, DEFAULT_STATUSES), 33);
  assert.equal(itemProgress({ ...base, status: 'todo', checklist: { done: 4, total: 4 } }, DEFAULT_STATUSES), 100);
  assert.equal(itemProgress({ ...base, status: 'done', checklist: { done: 0, total: 4 } }, DEFAULT_STATUSES), 100);
});
