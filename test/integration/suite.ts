import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
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
  const text = await read('planner/2026-10-06-review.md');
  assert.match(text, /^id: aaa111 # comment stays$/m);
  assert.match(text, /^start: 2026-10-13$/m);
  assert.match(text, /^end: 2026-10-15$/m);
  assert.match(text, /\n本文\n$/);
  await waitFor(() => store.get(review.key)?.start === '2026-10-13', 'watcher picks up write');
  console.log('ok: patch writes frontmatter and watcher reindexes');

  // Simulate the user duplicating the file.
  const copy = vscode.Uri.joinPath(root, 'planner/copy-of-review.md');
  await vscode.workspace.fs.copy(vscode.Uri.joinPath(root, 'planner/2026-10-06-review.md'), copy);
  await waitFor(() => store.duplicateIds().has('aaa111'), 'duplicate detected');
  console.log('ok: duplicate id detected');

  await vscode.commands.executeCommand('markPlanner.fixDuplicateIds');
  await waitFor(() => store.duplicateIds().size === 0, 'duplicates fixed');
  assert.equal(store.get(review.key)?.id, 'aaa111');
  assert.notEqual(store.get(copy.toString())?.id, 'aaa111');
  console.log('ok: duplicate id reassigned, original kept');

  await vscode.commands.executeCommand('markPlanner.openCalendar');
  console.log('ok: calendar panel opens');
}
