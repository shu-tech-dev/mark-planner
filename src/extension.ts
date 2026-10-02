import * as vscode from 'vscode';
import { createItem, fixDuplicateIds } from './commands';
import { getLang } from './config';
import { t } from './i18n';
import { PlannerPanel } from './panel';
import { TaskTreeProvider } from './sidebar';
import { PlannerStore } from './store';

export function activate(context: vscode.ExtensionContext) {
  const store = new PlannerStore();
  context.subscriptions.push(
    store,
    vscode.commands.registerCommand('markPlanner.openCalendar', () => PlannerPanel.show(context, store, 'calendar')),
    vscode.commands.registerCommand('markPlanner.openGantt', () => PlannerPanel.show(context, store, 'gantt')),
    vscode.commands.registerCommand('markPlanner.openTable', () => PlannerPanel.show(context, store, 'table')),
    vscode.commands.registerCommand('markPlanner.openKanban', () => PlannerPanel.show(context, store, 'kanban')),
    vscode.commands.registerCommand('markPlanner.openList', () => PlannerPanel.show(context, store, 'list')),
    vscode.commands.registerCommand('markPlanner.openSettings', () => PlannerPanel.show(context, store, 'settings')),
    vscode.commands.registerCommand('markPlanner.newItem', () => createItem(store)),
    vscode.commands.registerCommand('markPlanner.fixDuplicateIds', () => fixDuplicateIds(store)),
  );

  const sidebar = new TaskTreeProvider(store);
  const treeView = vscode.window.createTreeView('markPlanner.tasks', { treeDataProvider: sidebar });
  sidebar.attach(treeView);
  context.subscriptions.push(
    sidebar,
    treeView,
    vscode.commands.registerCommand('markPlanner.completeTask', (node) => sidebar.complete(node)),
  );

  let warned = new Set<string>();
  store.onDidChange(async () => {
    const ids = [...store.duplicateIds().keys()];
    const fresh = ids.filter((id) => !warned.has(id));
    warned = new Set(ids);
    if (fresh.length === 0) {
      return;
    }
    const lang = getLang();
    const action = await vscode.window.showWarningMessage(
      t(lang, 'msg.duplicateWarning', fresh.join(', ')),
      t(lang, 'msg.reassignAction'),
    );
    if (action) {
      await fixDuplicateIds(store);
    }
  });

  void store.reload();
  // Exposed for integration tests.
  return { store, sidebar };
}

export function deactivate() {}
