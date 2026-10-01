import * as vscode from 'vscode';
import { getConfig } from './config';
import { baseFileName, replaceIdPrefix, uniqueFileName } from './filename';
import { createFrontmatterFile } from './frontmatter';
import { generateId } from './id';
import { ItemType } from './model';
import { PlannerStore, writeFrontmatter } from './store';

const encoder = new TextEncoder();

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Prompts for title/type and creates `<folder>/<date>-<title>.md`. */
export async function createItem(store: PlannerStore, date?: string): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showErrorMessage('Mark Planner: フォルダを開いてから実行してください。');
    return;
  }

  const title = await vscode.window.showInputBox({ prompt: 'タイトル', placeHolder: '定例MTG' });
  if (!title?.trim()) {
    return;
  }
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'タスク', type: 'task' as ItemType },
      { label: '予定', type: 'event' as ItemType },
    ],
    { placeHolder: '種類' },
  );
  if (!picked) {
    return;
  }
  const start =
    date ??
    (await vscode.window.showInputBox({
      prompt: '開始日 (YYYY-MM-DD または YYYY-MM-DDTHH:mm)',
      value: today(),
      validateInput: (v) => (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v.trim()) ? undefined : '日付の形式が不正です'),
    }));
  if (!start) {
    return;
  }

  const { newItemFolder, properties: p } = getConfig();
  const folder = vscode.Uri.joinPath(root.uri, newItemFolder);
  await vscode.workspace.fs.createDirectory(folder);
  const id = generateId(store.takenIds());
  // The ID is unique, so the suffix is only a guard against hand-made files.
  const fileName = await uniqueFileName(baseFileName(id, title), (name) => exists(vscode.Uri.joinPath(folder, name)));
  const uri = vscode.Uri.joinPath(folder, fileName);

  const data: Record<string, unknown> = {
    [p.id]: id,
    [p.title]: title.trim(),
    [p.type]: picked.type,
  };
  if (picked.type === 'task') {
    data[p.status] = 'todo';
  }
  data[p.start] = start.trim();
  data[p.tags] = [];

  await vscode.workspace.fs.writeFile(uri, encoder.encode(createFrontmatterFile(data, '\n')));
  await vscode.window.showTextDocument(uri);
}

/** Keeps `<id>-<title>.md` file names in sync after an ID change. */
async function renameIdPrefix(uri: vscode.Uri, oldId: string, newId: string): Promise<void> {
  const name = uri.path.split('/').pop()!;
  const newName = replaceIdPrefix(name, oldId, newId);
  if (!newName) {
    return;
  }
  const target = vscode.Uri.joinPath(uri, '..', newName);
  if (await exists(target)) {
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(uri, target);
  await vscode.workspace.applyEdit(edit);
}

/**
 * Gives new IDs (and renamed `<id>-` file names) to all but one file of each
 * duplicate-ID group. The file that existed first keeps its ID; when that
 * cannot be told (both existed at startup), the user picks.
 */
export async function fixDuplicateIds(store: PlannerStore): Promise<void> {
  const duplicates = store.duplicateIds();
  if (duplicates.size === 0) {
    void vscode.window.showInformationMessage('Mark Planner: 重複しているIDはありません。');
    return;
  }
  const taken = store.takenIds();
  const { properties } = getConfig();
  let count = 0;
  for (const [id, items] of duplicates) {
    const sorted = [...items].sort((a, b) => store.creationOrder(a.key) - store.creationOrder(b.key));
    let keep = sorted[0];
    if (store.creationOrder(sorted[1].key) === store.creationOrder(keep.key)) {
      const picked = await vscode.window.showQuickPick(
        sorted.map((item) => ({ label: item.title, description: item.path, item })),
        { placeHolder: `ID「${id}」を維持するファイルを選んでください（他のファイルには新しいIDを振ります）` },
      );
      if (!picked) {
        continue;
      }
      keep = picked.item;
    }
    for (const item of sorted.filter((i) => i !== keep)) {
      const newId = generateId(taken);
      taken.add(newId);
      const uri = vscode.Uri.parse(item.key);
      await writeFrontmatter(uri, { [properties.id]: newId });
      await renameIdPrefix(uri, id, newId);
      count++;
    }
  }
  if (count > 0) {
    void vscode.window.showInformationMessage(`Mark Planner: ${count} 件のIDを振り直しました。`);
  }
}
