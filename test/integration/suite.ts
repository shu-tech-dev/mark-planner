import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { applyChecks } from '../../src/checklist';
import { createFromFields, createQuickTask } from '../../src/commands';
import { getConfig, updateSetting } from '../../src/config';
import { cellPatch } from '../../src/table';
import type { TaskTreeProvider } from '../../src/sidebar';
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
  const { store, sidebar } = (await ext.activate()) as { store: PlannerStore; sidebar: TaskTreeProvider };
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

  // Docs from other tools (id only, same id in two folders) are not planner items.
  for (const dir of ['docs', 'docs/other']) {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(root, `${dir}/intro.md`),
      new TextEncoder().encode('---\nid: intro\ntitle: Intro\n---\n'),
    );
  }
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(store.getItems().some((i) => i.id === 'intro'), false);
  console.log('ok: id-only docs are ignored');

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
  await store.patch(backlog.key, cellPatch('priority', 1, getConfig().properties)!);
  await waitFor(() => store.get(backlog.key)?.start === '2026-11-02' && store.get(backlog.key)?.priority === 1, 'cell edits indexed');
  assert.deepEqual(store.get(backlog.key)?.tags, ['a', 'b']);
  assert.match(await read(backlog.path), /^priority: 1$/m);
  console.log('ok: cell edits written to frontmatter');

  await vscode.commands.executeCommand('markPlanner.openTable');
  console.log('ok: table panel opens');

  // Kanban: a card added in a column gets that column's status.
  await createQuickTask(store, 'ボード項目', undefined, '完了');
  await waitFor(() => store.getItems().some((i) => i.title === 'ボード項目'), 'board card indexed');
  assert.equal(store.getItems().find((i) => i.title === 'ボード項目')?.status, '完了');
  await vscode.commands.executeCommand('markPlanner.openKanban');
  console.log('ok: kanban opens; column add sets status');

  // List: "Add task" in Today/Tomorrow creates a task due that day.
  await createQuickTask(store, '今日のタスク', undefined, undefined, '2026-10-14');
  await waitFor(() => store.getItems().some((i) => i.title === '今日のタスク'), 'dated quick task indexed');
  assert.equal(store.getItems().find((i) => i.title === '今日のタスク')?.start, '2026-10-14');
  await vscode.commands.executeCommand('markPlanner.openList');
  console.log('ok: list opens; add sets the due date');

  // Sidebar: a task due today shows under "today"; completing it removes it.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  await createQuickTask(store, 'サイドバー確認', undefined, undefined, todayIso);
  await waitFor(() => store.getItems().some((i) => i.title === 'サイドバー確認'), 'sidebar task indexed');
  const todaySection = sidebar.sections().find((s) => s.id === 'today');
  assert.ok(todaySection?.items.some((i) => i.title === 'サイドバー確認'));
  const node = sidebar.getChildren(todaySection).find((n) => n.kind === 'task' && n.item.title === 'サイドバー確認')!;
  const treeItem = sidebar.getTreeItem(node);
  assert.equal(treeItem.label, 'サイドバー確認');
  assert.equal(treeItem.contextValue, 'markPlanner.task');
  await vscode.commands.executeCommand('markPlanner.completeTask', node);
  await waitFor(() => store.getItems().find((i) => i.title === 'サイドバー確認')?.status === '完了', 'completed from sidebar');
  assert.equal(sidebar.sections().some((s) => s.items.some((i) => i.title === 'サイドバー確認')), false);
  await vscode.commands.executeCommand('workbench.view.extension.markPlanner');
  console.log('ok: sidebar lists today, completes and hides the task');

  // Checklist progress comes from the body and follows edits.
  const checkUri = vscode.Uri.joinPath(root, 'planner/check01-checks.md');
  const writeChecks = (body: string) =>
    vscode.workspace.fs.writeFile(checkUri, new TextEncoder().encode(`---\nid: check01\ntitle: checks\nstart: 2026-10-20\n---\n${body}`));
  await writeChecks('- [x] a\n- [ ] b\n    - [ ] c\n```\n- [x] code\n```\n');
  await waitFor(() => store.getItems().find((i) => i.title === 'checks')?.checklist?.total === 3, 'checklist indexed');
  assert.deepEqual(store.getItems().find((i) => i.title === 'checks')?.checklist, { done: 1, total: 3 });
  await writeChecks('- [x] a\n- [x] b\n    - [x] c\n');
  await waitFor(() => store.getItems().find((i) => i.title === 'checks')?.checklist?.done === 3, 'checklist updated');
  console.log('ok: checklist progress indexed and updated');

  // Editor dialog: checkbox toggles change only the body; creation writes every field.
  const checksItem = store.getItems().find((i) => i.title === 'checks')!;
  const before = await read('planner/check01-checks.md');
  await store.patch(checksItem.key, {}, (body) => applyChecks(body, [{ line: 1, checked: false }]));
  await waitFor(() => store.get(checksItem.key)?.checklist?.done === 2, 'body-only patch indexed');
  assert.equal(await read('planner/check01-checks.md'), before.replace('- [x] b', '- [ ] b'));
  await createFromFields(store, {
    title: 'ダイアログ作成',
    type: 'task',
    status: '完了',
    priority: 2,
    start: '2026-10-20',
    end: '2026-10-22T18:00',
    tags: ['x'],
    parent: 'check01',
    repeat: 'monthly',
  });
  await waitFor(() => store.getItems().some((i) => i.title === 'ダイアログ作成'), 'dialog item indexed');
  const created = store.getItems().find((i) => i.title === 'ダイアログ作成')!;
  assert.deepEqual(
    [created.status, created.priority, created.start, created.end, created.tags, created.parent, created.repeat],
    ['完了', 2, '2026-10-20', '2026-10-22T18:00', ['x'], 'check01', 'monthly'],
  );
  await vscode.commands.executeCommand('markPlanner.newItem');
  console.log('ok: editor dialog writes body checks and creates items');

  // Completing a repeating task creates the next one, which takes over `repeat`.
  const weeklyUri = vscode.Uri.joinPath(root, 'planner/week01-weekly.md');
  await vscode.workspace.fs.writeFile(
    weeklyUri,
    new TextEncoder().encode(
      `---\nid: week01\ntitle: weekly\nstatus: 未着手\nend: ${todayIso} # due\nrepeat: weekly\n---\n- [x] a\n- [ ] b\n`,
    ),
  );
  await waitFor(() => store.getItems().some((i) => i.id === 'week01'), 'repeating task indexed');
  const weekly = store.getItems().find((i) => i.id === 'week01')!;
  assert.equal(weekly.repeat, 'weekly');
  await store.patch(weekly.key, { status: '完了' });
  await waitFor(() => store.getItems().filter((i) => i.title === 'weekly').length === 2, 'next occurrence indexed');
  const next = store.getItems().find((i) => i.title === 'weekly' && i.id !== 'week01')!;
  const nextDue = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  assert.equal(next.end, `${nextDue.getFullYear()}-${pad(nextDue.getMonth() + 1)}-${pad(nextDue.getDate())}`);
  assert.equal(next.status, '未着手');
  assert.equal(next.repeat, 'weekly');
  assert.equal(next.path, `planner/${next.id}-weekly.md`);
  assert.deepEqual(next.checklist, { done: 0, total: 2 });
  assert.match(await read(next.path), /# due$/m);
  await waitFor(() => store.get(weekly.key)?.status === '完了', 'original completed');
  assert.equal(store.get(weekly.key)?.repeat, undefined);
  // Unchecking and checking again does not create another one.
  await store.patch(weekly.key, { status: '未着手' });
  await waitFor(() => store.get(weekly.key)?.status === '未着手', 'unchecked');
  await store.patch(weekly.key, { status: '完了' });
  await waitFor(() => store.get(weekly.key)?.status === '完了', 'checked again');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(store.getItems().filter((i) => i.title === 'weekly').length, 2);
  console.log('ok: completing a repeating task creates the next occurrence');

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
