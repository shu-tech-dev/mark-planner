import { ItemType, normalizeDate, PlannerItem, PropertyMap } from './model';
import { parsePriority, Priority } from './priority';
import { parseRepeat } from './repeat';
import type { StatusDef } from './settings';

/** What the editor dialog sends on save. Empty optional fields mean "unset". */
export interface EditorFields {
  title: string;
  type: ItemType;
  status?: string;
  priority?: Priority;
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. */
  start?: string;
  end?: string;
  tags: string[];
  parent?: string;
  repeat?: string;
}

const TYPES: ItemType[] = ['task', 'event', 'holiday'];

/**
 * Validates fields from the webview. Returns undefined when the title is empty or
 * a value is malformed (the dialog checks the same things before sending).
 */
export function sanitizeFields(raw: unknown): EditorFields | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const f = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const title = str(f.title);
  const type = TYPES.find((t) => t === f.type);
  if (!title || !type) {
    return undefined;
  }
  const date = (v: unknown): string | undefined | null => {
    if (v === undefined || v === null || v === '') {
      return undefined;
    }
    return normalizeDate(v) ?? null;
  };
  const start = date(f.start);
  const end = date(f.end);
  const priority = f.priority === undefined || f.priority === null || f.priority === '' ? undefined : parsePriority(f.priority);
  const repeat = str(f.repeat);
  if (
    start === null ||
    end === null ||
    (start && end && end.slice(0, 10) < start.slice(0, 10)) ||
    (f.priority !== undefined && f.priority !== null && f.priority !== '' && !priority) ||
    (repeat && !parseRepeat(repeat))
  ) {
    return undefined;
  }
  const tags = Array.isArray(f.tags) ? [...new Set(f.tags.map(str).filter((t): t is string => !!t))] : [];
  return { title, type, status: str(f.status), priority, start, end, tags, parent: str(f.parent), repeat };
}

/**
 * Frontmatter patch for the fields that differ from `item` (unchanged keys are not
 * touched, so their original spelling stays). `undefined` values delete keys.
 */
export function editorPatch(item: PlannerItem, fields: EditorFields, props: PropertyMap): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const set = (key: keyof PropertyMap, before: unknown, after: unknown) => {
    if (before !== after) {
      patch[props[key]] = after;
    }
  };
  set('title', item.title, fields.title);
  set('type', item.type, fields.type);
  if (fields.status !== undefined) {
    set('status', item.status, fields.status);
  }
  set('priority', item.priority, fields.priority);
  set('start', item.start, fields.start);
  set('end', item.end, fields.end);
  if (item.tags.join('\n') !== fields.tags.join('\n')) {
    patch[props.tags] = fields.tags;
  }
  set('parent', item.parent, fields.parent);
  set('repeat', item.repeat, fields.repeat);
  return patch;
}

/** Frontmatter of a new file, in a fixed key order; `template` adds keys or replaces tags. */
export function newItemData(
  id: string,
  fields: EditorFields,
  props: PropertyMap,
  statuses: StatusDef[],
  template: Record<string, unknown> = {},
): Record<string, unknown> {
  const isTask = fields.type === 'task';
  const status = statuses.some((s) => s.name === fields.status) ? fields.status : statuses[0].name;
  const data: Record<string, unknown> = {
    [props.id]: id,
    [props.title]: fields.title,
    [props.type]: fields.type,
    ...(isTask ? { [props.status]: status } : {}),
    ...(isTask && fields.priority ? { [props.priority]: fields.priority } : {}),
    ...(fields.start ? { [props.start]: fields.start } : {}),
    ...(fields.end ? { [props.end]: fields.end } : {}),
    [props.tags]: fields.tags,
    ...(fields.parent ? { [props.parent]: fields.parent } : {}),
    ...(isTask && fields.repeat ? { [props.repeat]: fields.repeat } : {}),
  };
  for (const [key, value] of Object.entries(template)) {
    if (!(key in data) || (key === props.tags && fields.tags.length === 0)) {
      data[key] = value;
    }
  }
  return data;
}
