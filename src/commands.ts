import * as vscode from 'vscode';
import { getConfig, getLang } from './config';
import { baseFileName, replaceIdPrefix, uniqueFileName } from './filename';
import { createFrontmatterFile } from './frontmatter';
import { generateId } from './id';
import { t } from './i18n';
import { EditorFields, newItemData } from './editor';
import { normalizeDate } from './model';
import { renderTemplate } from './settings';
import { fileExists as exists, PlannerStore, writeFrontmatter } from './store';

const encoder = new TextEncoder();

/**
 * Creates `<folder>/<id>-<title>.md` from the editor dialog's fields (or a quick
 * add). The body comes from the `template.body` setting. Returns the new file.
 */
export async function createFromFields(store: PlannerStore, fields: EditorFields): Promise<vscode.Uri | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showErrorMessage(t(getLang(), 'msg.noFolder'));
    return undefined;
  }
  const config = getConfig();
  const folder = vscode.Uri.joinPath(root.uri, config.newItemFolder);
  await vscode.workspace.fs.createDirectory(folder);
  const id = generateId(store.takenIds());
  // The ID is unique, so the suffix is only a guard against hand-made files.
  const fileName = await uniqueFileName(baseFileName(id, fields.title), (name) => exists(vscode.Uri.joinPath(folder, name)));
  const uri = vscode.Uri.joinPath(folder, fileName);
  const data = newItemData(id, fields, config.properties, config.statuses, config['template.frontmatter']);
  const body = renderTemplate(config['template.body'], { title: fields.title, date: fields.start ?? fields.end ?? '' });
  const text = createFrontmatterFile(data, body ? `\n${body}${body.endsWith('\n') ? '' : '\n'}` : '\n');
  await vscode.workspace.fs.writeFile(uri, encoder.encode(text));
  return uri;
}

/**
 * Creates a task straight from the table, kanban or list (no dialog); it can be
 * given dates or a parent there.
 */
export async function createQuickTask(
  store: PlannerStore,
  title: string,
  parentId?: string,
  status?: string,
  /** `YYYY-MM-DD`; makes it a single-day task due that day. */
  start?: string,
): Promise<void> {
  if (!title.trim()) {
    return;
  }
  await createFromFields(store, {
    title: title.trim(),
    type: 'task',
    status,
    start: start ? normalizeDate(start) : undefined,
    tags: [],
    parent: parentId,
  });
}

/** Moves the file to the trash after a modal confirmation. */
export async function deleteItem(store: PlannerStore, key: string): Promise<void> {
  const item = store.get(key);
  if (!item) {
    return;
  }
  const lang = getLang();
  const action = t(lang, 'msg.deleteAction');
  const picked = await vscode.window.showWarningMessage(t(lang, 'msg.confirmDelete', item.title), { modal: true }, action);
  if (picked === action) {
    await vscode.workspace.fs.delete(vscode.Uri.parse(key), { useTrash: true });
  }
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
  const lang = getLang();
  const duplicates = store.duplicateIds();
  if (duplicates.size === 0) {
    void vscode.window.showInformationMessage(t(lang, 'msg.noDuplicates'));
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
        { placeHolder: t(lang, 'msg.pickKeep', id) },
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
    void vscode.window.showInformationMessage(t(lang, 'msg.reassigned', count));
  }
}
