import * as vscode from 'vscode';
import { applyChecks } from './checklist';
import { createFromFields, createQuickTask, deleteItem } from './commands';
import { getConfig, getLang, isSettingKey, settingsTarget, updateSetting } from './config';
import { t } from './i18n';
import { editorPatch, sanitizeFields } from './editor';
import { moveToPatch } from './model';
import { DEFAULT_SETTINGS } from './settings';
import { PlannerStore } from './store';
import { cellPatch } from './table';

export type PlannerView = 'calendar' | 'gantt' | 'table' | 'kanban' | 'list' | 'settings';

const TABLE_STATE_KEY = 'markPlanner.tableState';
const LIST_STATE_KEY = 'markPlanner.listState';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'open'; key: string }
  | { type: 'move'; key: string; start: string; end?: string }
  | { type: 'saveItem'; key?: string; fields: unknown; checks?: { line: number; checked: boolean }[] }
  | { type: 'loadBody'; key: string }
  | { type: 'deleteItem'; key: string }
  | { type: 'updateSetting'; key: string; value: unknown }
  | { type: 'patch'; key: string; field: string; value: unknown }
  | { type: 'createQuick'; title: string; parent?: string; status?: string; start?: string }
  | { type: 'saveTableState'; state: unknown }
  | { type: 'saveListState'; state: unknown };

export class PlannerPanel {
  private static current: PlannerPanel | undefined;

  static show(context: vscode.ExtensionContext, store: PlannerStore, view: PlannerView): void {
    if (PlannerPanel.current) {
      PlannerPanel.current.panel.reveal();
      PlannerPanel.current.setView(view);
      return;
    }
    PlannerPanel.current = new PlannerPanel(context, store, view);
  }

  /** Opens the panel (keeping its current view) with the new-item dialog. */
  static newItem(context: vscode.ExtensionContext, store: PlannerStore): void {
    const panel = PlannerPanel.current;
    if (panel) {
      panel.panel.reveal();
      panel.send({ type: 'newItem' });
      return;
    }
    PlannerPanel.current = new PlannerPanel(context, store, getConfig().tabOrder[0] ?? 'calendar');
    PlannerPanel.current.send({ type: 'newItem' });
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  /** Messages held until the webview reports `ready`. */
  private pending: unknown[] | undefined = [];

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: PlannerStore,
    private view: PlannerView,
  ) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('markPlanner', 'Mark Planner', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [media],
    });
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((m: WebviewMessage) => this.onMessage(m), null, this.disposables);
    store.onDidChange(() => this.postItems(), null, this.disposables);
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration('markPlanner')) {
          this.postConfig();
        }
      },
      null,
      this.disposables,
    );
  }

  private postConfig(): void {
    void this.panel.webview.postMessage({
      type: 'config',
      settings: getConfig(),
      defaults: DEFAULT_SETTINGS,
      lang: getLang(),
      target: settingsTarget(),
    });
  }

  private setView(view: PlannerView): void {
    this.view = view;
    void this.panel.webview.postMessage({ type: 'view', view });
  }

  private send(message: unknown): void {
    if (this.pending) {
      this.pending.push(message);
    } else {
      void this.panel.webview.postMessage(message);
    }
  }

  private postItems(): void {
    void this.panel.webview.postMessage({ type: 'items', items: this.store.getItems() });
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        void this.panel.webview.postMessage({
          type: 'tableState',
          state: this.context.workspaceState.get(TABLE_STATE_KEY),
        });
        void this.panel.webview.postMessage({
          type: 'listState',
          state: this.context.workspaceState.get(LIST_STATE_KEY),
        });
        this.postConfig();
        this.setView(this.view);
        this.postItems();
        this.pending?.forEach((m) => void this.panel.webview.postMessage(m));
        this.pending = undefined;
        break;
      case 'open':
        await vscode.window.showTextDocument(vscode.Uri.parse(message.key), { viewColumn: vscode.ViewColumn.Beside });
        break;
      case 'move': {
        const item = this.store.get(message.key);
        if (item) {
          const patch = moveToPatch(item, message.start, message.end, getConfig().properties);
          try {
            await this.store.patch(message.key, patch);
          } catch (e) {
            void vscode.window.showErrorMessage(t(getLang(), 'msg.writeFailed', String(e)));
            this.postItems();
          }
        }
        break;
      }
      case 'saveItem':
        await this.saveItem(message.key, message.fields, message.checks ?? []);
        break;
      case 'loadBody': {
        let body: string | undefined;
        try {
          body = await this.store.body(message.key);
        } catch {
          body = undefined;
        }
        void this.panel.webview.postMessage({ type: 'body', key: message.key, body });
        break;
      }
      case 'deleteItem':
        await deleteItem(this.store, message.key);
        break;
      case 'patch': {
        const patch = cellPatch(message.field, message.value, getConfig().properties);
        if (patch && this.store.get(message.key)) {
          try {
            await this.store.patch(message.key, patch);
          } catch (e) {
            void vscode.window.showErrorMessage(t(getLang(), 'msg.writeFailed', String(e)));
            this.postItems();
          }
        } else {
          // Invalid edit: re-send items so the cell shows the stored value again.
          this.postItems();
        }
        break;
      }
      case 'createQuick':
        await createQuickTask(this.store, message.title, message.parent, message.status, message.start);
        break;
      case 'saveTableState':
        await this.context.workspaceState.update(TABLE_STATE_KEY, message.state);
        break;
      case 'saveListState':
        await this.context.workspaceState.update(LIST_STATE_KEY, message.state);
        break;
      case 'updateSetting':
        // Only keys declared by this extension can be written from the webview.
        if (isSettingKey(message.key)) {
          try {
            await updateSetting(message.key, message.value);
          } catch (e) {
            void vscode.window.showErrorMessage(t(getLang(), 'msg.settingFailed', String(e)));
            this.postConfig();
          }
        }
        break;
    }
  }

  /** Creates (no key) or updates an item from the editor dialog. */
  private async saveItem(key: string | undefined, raw: unknown, checks: { line: number; checked: boolean }[]): Promise<void> {
    const lang = getLang();
    const fields = sanitizeFields(raw);
    if (!fields) {
      return;
    }
    try {
      if (!key) {
        await createFromFields(this.store, fields);
        return;
      }
      const item = this.store.get(key);
      if (!item) {
        void vscode.window.showErrorMessage(t(lang, 'editor.missing'));
        return;
      }
      const patch = editorPatch(item, fields, getConfig().properties);
      const valid = checks.filter((c) => Number.isInteger(c.line) && typeof c.checked === 'boolean');
      if (Object.keys(patch).length || valid.length) {
        await this.store.patch(key, patch, valid.length ? (body) => applyChecks(body, valid) : undefined);
      }
    } catch (e) {
      void vscode.window.showErrorMessage(t(lang, 'msg.writeFailed', String(e)));
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `<!DOCTYPE html>
<html lang="${getLang()}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('webview.css')}">
<title>Mark Planner</title>
</head>
<body>
<header class="appbar">
  <div class="appbar-group">
    <div class="brand"><span class="brand-mark"></span><span class="brand-name">Mark Planner</span></div>
    <div class="segmented" role="tablist">
      <button data-view="calendar" role="tab" data-i18n-title="tab.calendar"><span data-icon="calendar"></span><span data-i18n="tab.calendar"></span></button>
      <button data-view="gantt" role="tab" data-i18n-title="tab.gantt"><span data-icon="gantt"></span><span data-i18n="tab.gantt"></span></button>
      <button data-view="table" role="tab" data-i18n-title="tab.table"><span data-icon="table"></span><span data-i18n="tab.table"></span></button>
      <button data-view="kanban" role="tab" data-i18n-title="tab.kanban"><span data-icon="kanban"></span><span data-i18n="tab.kanban"></span></button>
      <button data-view="list" role="tab" data-i18n-title="tab.list"><span data-icon="list"></span><span data-i18n="tab.list"></span></button>
    </div>
  </div>
  <div class="appbar-group nav">
    <button class="btn" id="nav-today" data-i18n="nav.today"></button>
    <div class="btn-pair">
      <button class="btn icon" id="nav-prev" data-icon="chevron-left" data-i18n-title="nav.prev"></button>
      <button class="btn icon" id="nav-next" data-icon="chevron-right" data-i18n-title="nav.next"></button>
    </div>
    <h1 id="nav-title"></h1>
  </div>
  <div class="appbar-group end">
    <div class="segmented compact" id="range"></div>
    <button class="btn primary" id="new-item"><span data-icon="plus"></span><span data-i18n="button.new"></span></button>
    <button class="btn icon ghost" data-view="settings" data-icon="settings" data-i18n-title="tab.settings"></button>
  </div>
</header>
<main>
  <div id="calendar" class="view"></div>
  <div id="gantt" class="view"><div id="gantt-chart"></div><p id="gantt-empty" class="empty" data-i18n="gantt.empty"></p></div>
  <div id="table" class="view"></div>
  <div id="kanban" class="view"></div>
  <div id="list" class="view"></div>
  <div id="settings" class="view"></div>
</main>
<div id="dialog-root"></div>
<script nonce="${nonce}" src="${media('webview.js')}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    PlannerPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}
