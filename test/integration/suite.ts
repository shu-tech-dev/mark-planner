import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { createQuickTask } from '../../src/commands';
import { getConfig, updateSetting } from '../../src/config';
import { cellPatch } from '../../src/table';
import type { PlannerStore } from '../../src/store';

async function waitFor(check: () => boolean, label: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout: ${label}`);
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'mark-planner')!;
  const { store } = (await ext.activate()) as { store: PlannerStore };
  const root = vscode.workspace.workspaceFolders![0].uri;
  const read = async (rel: string) =>
    new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, rel)));

  await waitFor(() => store.getItems().length === 1, 'index');
  assert.deepEqual(store.getItems().map((i) => i.title), ['設計レビュー']);
  console.log('ok: indexes dated files only');

  const review = store.getItems().find((i) => i.title === '設計レビュー')!;
  await store.patch(review.key, { start: '2026-10-13', end: '2026-10-15' });
  const text = await read('planner/aaa111-review.md');
  assert.match(text, /^id: aaa111 # comment stays$/m);
  assert.match(text, /^start: 2026-10-13$/m);
  assert.match(text, /^end: 2026-10-15$/m);
  assert.match(text, /\n本文\n$/);
  await waitFor(() => store.get(review.key)?.start === '2026-10-13', 'watcher picks up write');
  console.log('ok: patch writes frontmatter and watcher reindexes');

  // Simulate the user duplicating the file.
  const copy = vscode.Uri.joinPath(root, 'planner/aaa111-review copy.md');
  await vscode.workspace.fs.copy(vscode.Uri.joinPath(root, 'planner/aaa111-review.md'), copy);
  await waitFor(() => store.duplicateIds().has('aaa111'), 'duplicate detected');
  console.log('ok: duplicate id detected');

  await vscode.commands.executeCommand('markPlanner.fixDuplicateIds');
  await waitFor(
    // Both files must be indexed: the rename briefly shows only the original.
    () =>
      store.getItems().length === 2 &&
      store.duplicateIds().size === 0 &&
      store.getItems().every((i) => i.path.startsWith(`planner/${i.id}-`)),
    'duplicates fixed and renamed',
  );
  assert.equal(store.get(review.key)?.id, 'aaa111');
  const reassigned = store.getItems().find((i) => i.key !== review.key)!;
  assert.notEqual(reassigned.id, 'aaa111');
  assert.equal(reassigned.path, `planner/${reassigned.id}-review copy.md`);
  console.log('ok: copied file renamed to its new id prefix');
  console.log('ok: duplicate id reassigned, original kept');

  await vscode.commands.executeCommand('markPlanner.openCalendar');
  console.log('ok: calendar panel opens');

  // Settings are written to the workspace (.vscode/settings.json).
  const statuses = [
    { name: '未着手', color: '#123456', progress: 0, done: false },
    { name: '完了', color: '#654321', progress: 100, done: true },
  ];
  await updateSetting('statuses', statuses);
  await updateSetting('language', 'en');
  const settingsJson = JSON.parse(await read('.vscode/settings.json'));
  assert.deepEqual(settingsJson['markPlanner.statuses'], statuses);
  assert.equal(settingsJson['markPlanner.language'], 'en');
  assert.deepEqual(getConfig().statuses, statuses);
  console.log('ok: updateSetting writes workspace settings');

  await updateSetting('language', undefined);
  assert.equal(JSON.parse(await read('.vscode/settings.json'))['markPlanner.language'], undefined);
  assert.equal(getConfig().language, 'auto');
  console.log('ok: reset removes the workspace value');

  await vscode.workspace.getConfiguration('markPlanner').update('include', 'planner/**/*.md', vscode.ConfigurationTarget.Workspace);
  await waitFor(() => store.getItems().every((i) => i.path.startsWith('planner/')), 'reindex after include change');
  console.log('ok: store reloads after settings change');

  await vscode.commands.executeCommand('markPlanner.openSettings');
  console.log('ok: settings panel opens');

  // Table: quick-created undated task is indexed; cell edits write frontmatter.
  await createQuickTask(store, 'バックログ項目');
  await waitFor(() => store.getItems().some((i) => i.title === 'バックログ項目'), 'quick task indexed');
  const backlog = store.getItems().find((i) => i.title === 'バックログ項目')!;
  assert.equal(backlog.start, undefined);
  assert.equal(backlog.status, '未着手'); // first configured status (set above)
  assert.match(backlog.path, new RegExp(`^planner/${backlog.id}-バックログ項目\\.md$`));
  console.log('ok: quick-created undated task');

  await store.patch(backlog.key, cellPatch('tags', 'a, b', getConfig().properties)!);
  await store.patch(backlog.key, cellPatch('start', '2026-11-02', getConfig().properties)!);
  await waitFor(() => store.get(backlog.key)?.start === '2026-11-02', 'cell edits indexed');
  assert.deepEqual(store.get(backlog.key)?.tags, ['a', 'b']);
  console.log('ok: cell edits written to frontmatter');

  await vscode.commands.executeCommand('markPlanner.openTable');
  console.log('ok: table panel opens');

  // Kanban: a card added in a column gets that column's status.
  await createQuickTask(store, 'ボード項目', undefined, '完了');
  await waitFor(() => store.getItems().some((i) => i.title === 'ボード項目'), 'board card indexed');
  assert.equal(store.getItems().find((i) => i.title === 'ボード項目')?.status, '完了');
  await vscode.commands.executeCommand('markPlanner.openKanban');
  console.log('ok: kanban opens; column add sets status');

  // Relative exclude globs apply to watcher events too.
  await vscode.workspace.getConfiguration('markPlanner').update('exclude', 'planner/skip/**', vscode.ConfigurationTarget.Workspace);
  await waitFor(() => store.getItems().length > 0, 'reload after exclude change');
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, 'planner/skip/x.md'),
    new TextEncoder().encode('---\nid: skip01\ntitle: skipped\nstart: 2026-10-01\n---\n'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, 'planner/kept.md'),
    new TextEncoder().encode('---\nid: kept01\ntitle: kept\nstart: 2026-10-01\n---\n'),
  );
  await waitFor(() => store.getItems().some((i) => i.title === 'kept'), 'kept file indexed');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(store.getItems().some((i) => i.title === 'skipped'), false);
  console.log('ok: relative include/exclude globs apply to new files');
}
