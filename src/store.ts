import * as vscode from 'vscode';
import { getConfig, getLang } from './config';
import { countChecklist } from './checklist';
import { formatDisplayDate } from './dateFormat';
import { baseFileName, uniqueFileName } from './filename';
import { splitFrontmatter, updateFrontmatter } from './frontmatter';
import { t } from './i18n';
import { generateId } from './id';
import { PlannerItem, toPlannerItem } from './model';
import { nextOccurrence, parseRepeat, repeatLabel, uncheckChecklist } from './repeat';
import { resolveStatus } from './settings';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Indexes dated Markdown files in the workspace and keeps them in sync. */
export class PlannerStore implements vscode.Disposable {
  private readonly items = new Map<string, PlannerItem>();
  /** Order in which files appeared after the initial scan (0 = present at scan). */
  private readonly createdSeq = new Map<string, number>();
  private nextSeq = 1;
  private watchers: vscode.FileSystemWatcher[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private changeTimer: ReturnType<typeof setTimeout> | undefined;

  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.disposables.push(
      this.changeEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('markPlanner')) {
          void this.reload();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reload()),
    );
  }

  getItems(): PlannerItem[] {
    return [...this.items.values()];
  }

  get(key: string): PlannerItem | undefined {
    return this.items.get(key);
  }

  takenIds(): Set<string> {
    return new Set(this.getItems().flatMap((i) => (i.id ? [i.id] : [])));
  }

  /** IDs used by more than one file, mapped to those files. */
  duplicateIds(): Map<string, PlannerItem[]> {
    const byId = new Map<string, PlannerItem[]>();
    for (const item of this.items.values()) {
      if (item.id) {
        byId.set(item.id, [...(byId.get(item.id) ?? []), item]);
      }
    }
    return new Map([...byId].filter(([, list]) => list.length > 1));
  }

  /**
   * Higher means the file appeared later in this session (e.g. a copy).
   * Files that existed at the initial scan all return 0.
   */
  creationOrder(key: string): number {
    return this.createdSeq.get(key) ?? 0;
  }

  async reload(): Promise<void> {
    const { include, exclude } = getConfig();
    this.watchers.forEach((w) => w.dispose());
    // A plain string glob would be matched against absolute paths, so patterns like
    // `planner/**/*.md` need to be relative to each workspace folder (as findFiles does).
    this.watchers = (vscode.workspace.workspaceFolders ?? []).map((folder) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, include));
      watcher.onDidCreate((uri) => {
        this.createdSeq.set(uri.toString(), this.nextSeq++);
        void this.refreshFile(uri);
      });
      watcher.onDidChange((uri) => this.refreshFile(uri));
      watcher.onDidDelete((uri) => {
        this.createdSeq.delete(uri.toString());
        if (this.items.delete(uri.toString())) {
          this.fireChange();
        }
      });
      return watcher;
    });

    const uris = await vscode.workspace.findFiles(include, exclude);
    this.items.clear();
    this.createdSeq.clear();
    await Promise.all(uris.map((uri) => this.readFile(uri)));
    this.fireChange();
  }

  /**
   * Rewrites frontmatter keys of an indexed file; assigns an ID if it has none.
   * Completing a repeating task first creates its next occurrence, which takes
   * over the `repeat` key (so unchecking and re-checking does not repeat twice).
   */
  async patch(key: string, patch: Record<string, unknown>): Promise<void> {
    const item = this.items.get(key);
    const { properties, statuses } = getConfig();
    const uri = vscode.Uri.parse(key);
    const fullPatch = { ...patch };
    if (item && !item.id && !(properties.id in fullPatch)) {
      fullPatch[properties.id] = generateId(this.takenIds());
    }
    const newStatus = fullPatch[properties.status];
    if (
      item?.type === 'task' &&
      typeof newStatus === 'string' &&
      resolveStatus(newStatus, statuses).done &&
      !resolveStatus(item.status, statuses).done &&
      (await this.createNextOccurrence(uri, item))
    ) {
      fullPatch[properties.repeat] = undefined;
    }
    await writeFrontmatter(uri, fullPatch);
  }

  /**
   * Copies a repeating task to `<new id>-<title>.md` next to it, with the next
   * dates, the first status and its checklist unchecked. False when the task
   * does not repeat (or has no dates to move).
   */
  private async createNextOccurrence(uri: vscode.Uri, item: PlannerItem): Promise<boolean> {
    const rule = parseRepeat(item.repeat);
    const dates = rule && nextOccurrence(item, rule, today());
    if (!rule || !dates) {
      return false;
    }
    const { properties: p, statuses } = getConfig();
    const text = (await vscode.workspace.openTextDocument(uri)).getText();
    const { bodyStart } = splitFrontmatter(text);
    const id = generateId(this.takenIds());
    const newText = updateFrontmatter(text.slice(0, bodyStart) + uncheckChecklist(text.slice(bodyStart)), {
      [p.id]: id,
      [p.status]: statuses[0].name,
      ...(dates.start ? { [p.start]: dates.start } : {}),
      ...(dates.end ? { [p.end]: dates.end } : {}),
    });
    const folder = vscode.Uri.joinPath(uri, '..');
    const fileName = await uniqueFileName(baseFileName(id, item.title), (name) =>
      fileExists(vscode.Uri.joinPath(folder, name)),
    );
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, fileName), encoder.encode(newText));
    const lang = getLang();
    const date = formatDisplayDate((dates.start ?? dates.end)!, getConfig().dateFormat, lang);
    vscode.window.setStatusBarMessage(
      t(lang, 'msg.nextOccurrence', item.title, date, repeatLabel(rule, lang)),
      5000,
    );
    return true;
  }

  dispose(): void {
    this.watchers.forEach((w) => w.dispose());
    clearTimeout(this.changeTimer);
    this.disposables.forEach((d) => d.dispose());
  }

  private async refreshFile(uri: vscode.Uri): Promise<void> {
    if (isExcluded(uri, getConfig().exclude)) {
      return;
    }
    await this.readFile(uri);
    this.fireChange();
  }

  private async readFile(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    let text: string;
    try {
      text = decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      this.items.delete(key);
      return;
    }
    const { data, bodyStart } = splitFrontmatter(text);
    const item = data && toPlannerItem(data, key, vscode.workspace.asRelativePath(uri), getConfig().properties);
    if (item) {
      const checklist = countChecklist(text.slice(bodyStart));
      if (checklist) {
        item.checklist = checklist;
      }
      this.items.set(key, item);
    } else {
      this.items.delete(key);
    }
  }

  private fireChange(): void {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.changeEmitter.fire(), 100);
  }
}

/** Matches the exclude glob relative to the file's workspace folder, like findFiles. */
function isExcluded(uri: vscode.Uri, exclude: string): boolean {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!exclude || !folder) {
    return false;
  }
  return (
    vscode.languages.match({ pattern: new vscode.RelativePattern(folder, exclude) }, {
      uri,
      languageId: '',
    } as unknown as vscode.TextDocument) > 0
  );
}

export async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies a frontmatter patch through a WorkspaceEdit so that it works on open
 * (even unsaved) editors and can be undone, then saves the file.
 */
export async function writeFrontmatter(uri: vscode.Uri, patch: Record<string, unknown>): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const oldText = doc.getText();
  const newText = updateFrontmatter(oldText, patch);
  if (newText === oldText) {
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(oldText.length)), newText);
  if (await vscode.workspace.applyEdit(edit)) {
    await doc.save();
  }
}
