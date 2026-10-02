import * as vscode from 'vscode';
import { businessCalendar, remainingBusinessDays, remainingLabel } from './businessDays';
import { getConfig, getLang } from './config';
import { ancestorTitles, parentMap } from './hierarchy';
import { MessageKey, t } from './i18n';
import { buildList, dueLabel, DueKind, ListSectionId, toggleStatus } from './list';
import type { PlannerItem } from './model';
import { PlannerStore } from './store';

type Node = { kind: 'section'; id: ListSectionId; items: PlannerItem[] } | { kind: 'task'; item: PlannerItem };

/** Sections opened by default; the rest start collapsed. */
const EXPANDED: ListSectionId[] = ['overdue', 'today', 'tomorrow'];

const DUE_COLOR: Partial<Record<DueKind, string>> = {
  overdue: 'charts.red',
  today: 'charts.green',
  tomorrow: 'charts.orange',
};

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Sidebar tree of open tasks grouped by deadline (same sections as the list view).
 * Refreshes on store changes and at midnight, and badges overdue + today counts.
 */
export class TaskTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private view: vscode.TreeView<Node> | undefined;
  private midnight: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: PlannerStore) {
    this.disposables.push(
      this.changeEmitter,
      store.onDidChange(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('markPlanner')) {
          this.refresh();
        }
      }),
    );
    this.scheduleMidnight();
  }

  attach(view: vscode.TreeView<Node>): void {
    this.view = view;
    this.updateBadge();
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
    this.updateBadge();
  }

  /** Visible sections: non-empty ones (completed tasks are left out). */
  sections(): Extract<Node, { kind: 'section' }>[] {
    const settings = getConfig();
    return buildList(this.store.getItems(), today(), {
      statuses: settings.statuses,
      weekStart: settings.weekStart,
      showCompleted: false,
    })
      .filter((s) => s.items.length > 0)
      .map((s) => ({ kind: 'section', id: s.id, items: s.items }));
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return this.sections();
    }
    return node.kind === 'section' ? node.items.map((item) => ({ kind: 'task', item })) : [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const lang = getLang();
    if (node.kind === 'section') {
      const item = new vscode.TreeItem(
        t(lang, `list.${node.id}` as MessageKey),
        EXPANDED.includes(node.id)
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.id = `section:${node.id}`;
      item.description = String(node.items.length);
      return item;
    }

    const settings = getConfig();
    const task = node.item;
    const now = today();
    const due = dueLabel(task, now, { weekStart: settings.weekStart, dateFormat: settings.dateFormat, lang });
    const items = this.store.getItems();
    const ancestors = ancestorTitles(task, parentMap(items));

    const item = new vscode.TreeItem(task.title, vscode.TreeItemCollapsibleState.None);
    item.id = `task:${task.key}`;
    item.description = [due?.text, ancestors[0]].filter(Boolean).join(' · ');
    item.iconPath = new vscode.ThemeIcon(
      'circle-large-outline',
      due && DUE_COLOR[due.kind] ? new vscode.ThemeColor(DUE_COLOR[due.kind]!) : undefined,
    );
    item.contextValue = 'markPlanner.task';
    item.command = { command: 'vscode.open', title: '', arguments: [vscode.Uri.parse(task.key)] };

    const remaining = remainingBusinessDays(task, now, businessCalendar(items, settings), settings);
    const tooltip = new vscode.MarkdownString();
    if (ancestors.length) {
      tooltip.appendText([...ancestors].reverse().join(' › ') + '\n\n');
    }
    tooltip.appendMarkdown(`**${task.title.replace(/[\\`*_[\]<>]/g, '\\$&')}**\n\n`);
    if (due) {
      tooltip.appendText(`${due.text}${remaining ? ` — ${remainingLabel(remaining, lang)}` : ''}\n\n`);
    }
    tooltip.appendText(task.path);
    item.tooltip = tooltip;
    return item;
  }

  /** Checks a task off from the tree (inline ✓ or context menu). */
  async complete(node: Node | undefined): Promise<void> {
    if (node?.kind !== 'task') {
      return;
    }
    const { statuses, properties } = getConfig();
    const status = toggleStatus(true, statuses);
    if (status) {
      await this.store.patch(node.item.key, { [properties.status]: status });
    }
  }

  dispose(): void {
    clearTimeout(this.midnight);
    this.disposables.forEach((d) => d.dispose());
  }

  private updateBadge(): void {
    if (!this.view) {
      return;
    }
    const urgent = this.sections()
      .filter((s) => s.id === 'overdue' || s.id === 'today')
      .reduce((n, s) => n + s.items.length, 0);
    this.view.badge = urgent ? { value: urgent, tooltip: t(getLang(), 'sidebar.badge', urgent) } : undefined;
  }

  /** "Today" moves at midnight even when no file changes. */
  private scheduleMidnight(): void {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    this.midnight = setTimeout(() => {
      this.refresh();
      this.scheduleMidnight();
    }, next.getTime() - now.getTime());
  }
}
