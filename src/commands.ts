import * as vscode from 'vscode';
import { getConfig, getLang } from './config';
import { baseFileName, replaceIdPrefix, uniqueFileName } from './filename';
import { createFrontmatterFile } from './frontmatter';
import { generateId } from './id';
import { t } from './i18n';
import { ItemType, normalizeDate } from './model';
import { renderTemplate } from './settings';
import { fileExists as exists, PlannerStore, writeFrontmatter } from './store';

const encoder = new TextEncoder();

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Prompts for title/type and creates `<folder>/<date>-<title>.md`. */
export async function createItem(store: PlannerStore, date?: string): Promise<void> {
  const lang = getLang();
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showErrorMessage(t(lang, 'msg.noFolder'));
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: t(lang, 'msg.titlePrompt'),
    placeHolder: t(lang, 'msg.titlePlaceholder'),
  });
  if (!title?.trim()) {
    return;
  }
  const picked = await vscode.window.showQuickPick(
    [
      { label: t(lang, 'msg.type.task'), type: 'task' as ItemType },
      { label: t(lang, 'msg.type.event'), type: 'event' as ItemType },
      { label: t(lang, 'msg.type.holiday'), type: 'holiday' as ItemType },
    ],
    { placeHolder: t(lang, 'msg.typePlaceholder') },
  );
  if (!picked) {
    return;
  }
  const start =
    date ??
    (await vscode.window.showInputBox({
      prompt: t(lang, 'msg.startPrompt'),
      value: today(),
      validateInput: (v) => (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v.trim()) ? undefined : t(lang, 'msg.invalidDate')),
    }));
  if (!start) {
    return;
  }

  const config = getConfig();
  const { newItemFolder, properties: p } = config;
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
    data[p.status] = config.statuses[0].name;
  }
  data[p.start] = start.trim();
  data[p.tags] = [];
  // Template keys may add fields or replace tags, but not the core fields above.
  for (const [key, value] of Object.entries(config['template.frontmatter'])) {
    if (!(key in data) || key === p.tags) {
      data[key] = value;
    }
  }

  const body = renderTemplate(config['template.body'], { title: title.trim(), date: start.trim() });
  const text = createFrontmatterFile(data, body ? `\n${body}${body.endsWith('\n') ? '' : '\n'}` : '\n');
  await vscode.workspace.fs.writeFile(uri, encoder.encode(text));
  await vscode.window.showTextDocument(uri);
}

/**
 * Creates an undated task straight from the table (no prompts): it shows up in
 * the table and can be given dates or a parent there.
 */
export async function createQuickTask(
  store: PlannerStore,
  title: string,
  parentId?: string,
  status?: string,
  /** `YYYY-MM-DD`; makes it a single-day task due that day. */
  start?: string,
): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root || !title.trim()) {
    return;
  }
  const config = getConfig();
  const { newItemFolder, properties: p } = config;
  const folder = vscode.Uri.joinPath(root.uri, newItemFolder);
  await vscode.workspace.fs.createDirectory(folder);
  const id = generateId(store.takenIds());
  const fileName = await uniqueFileName(baseFileName(id, title), (name) => exists(vscode.Uri.joinPath(folder, name)));
  const data: Record<string, unknown> = {
    [p.id]: id,
    [p.title]: title.trim(),
    [p.type]: 'task',
    [p.status]: status && config.statuses.some((s) => s.name === status) ? status : config.statuses[0].name,
    ...(parentId ? { [p.parent]: parentId } : {}),
    ...(start && normalizeDate(start) ? { [p.start]: normalizeDate(start) } : {}),
    [p.tags]: [],
  };
  for (const [key, value] of Object.entries(config['template.frontmatter'])) {
    if (!(key in data) || key === p.tags) {
      data[key] = value;
    }
  }
  const body = renderTemplate(config['template.body'], { title: title.trim(), date: '' });
  const text = createFrontmatterFile(data, body ? `\n${body}${body.endsWith('\n') ? '' : '\n'}` : '\n');
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, fileName), encoder.encode(text));
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
