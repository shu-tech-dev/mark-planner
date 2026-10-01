import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { getConfig, updateSetting } from '../../src/config';
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
    () => store.duplicateIds().size === 0 && store.getItems().every((i) => i.path.startsWith(`planner/${i.id}-`)),
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
}
