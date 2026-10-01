import * as vscode from 'vscode';
import { createItem } from './commands';
import { getConfig } from './config';
import { moveToPatch } from './model';
import { PlannerStore } from './store';

export type PlannerView = 'calendar' | 'gantt';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'open'; key: string }
  | { type: 'move'; key: string; start: string; end?: string }
  | { type: 'create'; date: string };

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

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

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
  }

  private setView(view: PlannerView): void {
    this.view = view;
    void this.panel.webview.postMessage({ type: 'view', view });
  }

  private postItems(): void {
    void this.panel.webview.postMessage({ type: 'items', items: this.store.getItems() });
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.setView(this.view);
        this.postItems();
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
            void vscode.window.showErrorMessage(`Mark Planner: 書き込みに失敗しました: ${e}`);
            this.postItems();
          }
        }
        break;
      }
      case 'create':
        await createItem(this.store, message.date);
        break;
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('webview.css')}">
<title>Mark Planner</title>
</head>
<body>
<nav class="toolbar">
  <button data-view="calendar">カレンダー</button>
  <button data-view="gantt">ガント</button>
  <span class="spacer"></span>
  <button id="new-item">＋ 新規</button>
</nav>
<main>
  <div id="calendar" class="view"></div>
  <div id="gantt" class="view"><div id="gantt-chart"></div><p id="gantt-empty" class="empty">日付付きのタスクがありません</p></div>
</main>
<script nonce="${nonce}" src="${media('webview.js')}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    PlannerPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}
