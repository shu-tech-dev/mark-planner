import * as vscode from 'vscode';
import { createItem, fixDuplicateIds } from './commands';
import { PlannerPanel } from './panel';
import { PlannerStore } from './store';

export function activate(context: vscode.ExtensionContext) {
  const store = new PlannerStore();
  context.subscriptions.push(
    store,
    vscode.commands.registerCommand('markPlanner.openCalendar', () => PlannerPanel.show(context, store, 'calendar')),
    vscode.commands.registerCommand('markPlanner.openGantt', () => PlannerPanel.show(context, store, 'gantt')),
    vscode.commands.registerCommand('markPlanner.newItem', () => createItem(store)),
    vscode.commands.registerCommand('markPlanner.fixDuplicateIds', () => fixDuplicateIds(store)),
  );

  let warned = new Set<string>();
  store.onDidChange(async () => {
    const ids = [...store.duplicateIds().keys()];
    const fresh = ids.filter((id) => !warned.has(id));
    warned = new Set(ids);
    if (fresh.length === 0) {
      return;
    }
    const action = await vscode.window.showWarningMessage(
      `Mark Planner: IDが重複しています (${fresh.join(', ')})。ファイルをコピーした場合などに起こります。`,
      'IDを振り直す',
    );
    if (action) {
      await fixDuplicateIds(store);
    }
  });

  void store.reload();
  // Exposed for integration tests.
  return { store };
}

export function deactivate() {}
