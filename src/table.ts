import { itemProgress } from './checklist';
import { parentMap } from './hierarchy';
import { ItemType, normalizeDate, PlannerItem, PropertyMap } from './model';
import { parsePriority } from './priority';
import { resolveStatus, StatusDef } from './settings';

export const COLUMN_IDS = ['title', 'type', 'status', 'priority', 'start', 'end', 'remaining', 'progress', 'tags', 'parent', 'depends', 'path'] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];
export type SortDir = 'asc' | 'desc';
export type GroupBy = 'none' | 'status' | 'type';

export interface TableQuery {
  search: string;
  /** Empty = no filter. */
  types: ItemType[];
  statuses: string[];
  tags: string[];
  sort?: { column: ColumnId; dir: SortDir };
  group: GroupBy;
  /** Keys of collapsed parents (tree mode). */
  collapsed: string[];
}

export interface TableRow {
  item: PlannerItem;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export interface TableGroup {
  /** `''` for the single group when not grouping. */
  key: string;
  rows: TableRow[];
}

export const DEFAULT_QUERY: TableQuery = { search: '', types: [], statuses: [], tags: [], group: 'none', collapsed: [] };

const TYPE_ORDER: ItemType[] = ['task', 'event', 'holiday'];

export function matches(item: PlannerItem, query: TableQuery): boolean {
  const search = query.search.trim().toLowerCase();
  if (search && !item.title.toLowerCase().includes(search)) {
    return false;
  }
  if (query.types.length && !query.types.includes(item.type)) {
    return false;
  }
  // Status only applies to tasks.
  if (query.statuses.length && (item.type !== 'task' || !query.statuses.includes(item.status))) {
    return false;
  }
  if (query.tags.length && !item.tags.some((t) => query.tags.includes(t))) {
    return false;
  }
  return true;
}

type SortKey = string | number | undefined;

/** Empty values (`undefined` or `''`) sort last in both directions. */
function compareKeys(a: SortKey, b: SortKey, dir: SortDir): number {
  const emptyA = a === undefined || a === '';
  const emptyB = b === undefined || b === '';
  if (emptyA || emptyB) {
    return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  }
  const sign = dir === 'asc' ? 1 : -1;
  return typeof a === 'number' && typeof b === 'number'
    ? sign * (a - b)
    : sign * String(a).localeCompare(String(b));
}

export function comparator(
  query: TableQuery,
  statuses: StatusDef[],
  titleOf: (id: string | undefined) => string,
  remainingOf: (item: PlannerItem) => number | undefined = () => undefined,
): (a: PlannerItem, b: PlannerItem) => number {
  const byDefault = (a: PlannerItem, b: PlannerItem) =>
    compareKeys(a.start ?? a.end, b.start ?? b.end, 'asc') || a.title.localeCompare(b.title);
  const sort = query.sort;
  if (!sort) {
    return byDefault;
  }
  const key = (i: PlannerItem): SortKey => {
    switch (sort.column) {
      case 'title':
        return i.title;
      case 'type':
        return TYPE_ORDER.indexOf(i.type);
      case 'status':
        return i.type === 'task' ? resolveStatus(i.status, statuses).index : undefined;
      case 'priority':
        return i.priority;
      case 'start':
        return i.start;
      case 'end':
        return i.end;
      case 'remaining':
        return remainingOf(i);
      case 'progress':
        return i.type === 'task' ? itemProgress(i, statuses) : undefined;
      case 'tags':
        return i.tags.join(', ');
      case 'parent':
        return titleOf(i.parent);
      case 'depends':
        return i.depends.map(titleOf).join(', ');
      case 'path':
        return i.path;
    }
  };
  return (a, b) => compareKeys(key(a), key(b), sort.dir) || byDefault(a, b);
}

/**
 * Tree mode (group "none"): parents first, children indented under them, siblings
 * sorted. Ancestors of matching items stay visible so the hierarchy reads correctly.
 * Grouped modes: flat rows per status/type group.
 */
export function buildTable(
  items: PlannerItem[],
  query: TableQuery,
  statuses: StatusDef[],
  /** Sort key for the "remaining" column (see remainingSortKey). */
  remainingOf?: (item: PlannerItem) => number | undefined,
): TableGroup[] {
  const byId = new Map(items.flatMap((i) => (i.id ? [[i.id, i] as const] : [])));
  const titleOf = (id: string | undefined) => (id ? (byId.get(id)?.title ?? id) : '');
  const compare = comparator(query, statuses, titleOf, remainingOf);

  if (query.group !== 'none') {
    const groups = new Map<string, PlannerItem[]>();
    const order =
      query.group === 'status' ? [...statuses.map((s) => s.name), ''] : (TYPE_ORDER as string[]);
    for (const key of order) {
      groups.set(key, []);
    }
    for (const item of items.filter((i) => matches(i, query))) {
      const key =
        query.group === 'type' ? item.type : item.type === 'task' ? resolveStatus(item.status, statuses).name : '';
      groups.get(key)?.push(item);
    }
    return [...groups]
      .filter(([, list]) => list.length)
      .map(([key, list]) => ({
        key,
        rows: list.sort(compare).map((item) => ({ item, depth: 0, hasChildren: false, collapsed: false })),
      }));
  }

  const parents = parentMap(items);
  const children = new Map<PlannerItem, PlannerItem[]>();
  for (const [child, parent] of parents) {
    children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  // Visible = matches, or has a visible descendant.
  const visible = new Set<PlannerItem>();
  for (const item of items) {
    if (matches(item, query)) {
      const seen = new Set<PlannerItem>();
      for (let i: PlannerItem | undefined = item; i && !seen.has(i); i = parents.get(i)) {
        seen.add(i);
        visible.add(i);
      }
    }
  }
  const collapsed = new Set(query.collapsed);
  const rows: TableRow[] = [];
  const placed = new Set<PlannerItem>();
  const visit = (item: PlannerItem, depth: number) => {
    if (placed.has(item)) {
      return;
    }
    placed.add(item);
    const kids = (children.get(item) ?? []).filter((c) => visible.has(c)).sort(compare);
    const isCollapsed = kids.length > 0 && collapsed.has(item.key);
    rows.push({ item, depth, hasChildren: kids.length > 0, collapsed: isCollapsed });
    if (!isCollapsed) {
      kids.forEach((kid) => visit(kid, depth + 1));
    }
  };
  const roots = items.filter((i) => visible.has(i) && !parents.has(i)).sort(compare);
  roots.forEach((i) => visit(i, 0));
  // Items caught in a parent cycle have no root; list them at the top level.
  items
    .filter((i) => visible.has(i) && !placed.has(i) && !hiddenByCollapse(i, parents, collapsed))
    .sort(compare)
    .forEach((i) => visit(i, 0));
  return [{ key: '', rows }];
}

function hiddenByCollapse(
  item: PlannerItem,
  parents: Map<PlannerItem, PlannerItem>,
  collapsed: Set<string>,
): boolean {
  const seen = new Set([item]);
  for (let p = parents.get(item); p && !seen.has(p); p = parents.get(p)) {
    if (collapsed.has(p.key)) {
      return true;
    }
    seen.add(p);
  }
  return false;
}

/** All tags in use, sorted. */
export function allTags(items: PlannerItem[]): string[] {
  return [...new Set(items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b));
}

/** IDs a given item may take as parent: any other item with an ID that is not its descendant. */
export function parentCandidates(item: PlannerItem, items: PlannerItem[]): PlannerItem[] {
  const parents = parentMap(items);
  const isDescendant = (candidate: PlannerItem) => {
    const seen = new Set<PlannerItem>();
    for (let p: PlannerItem | undefined = candidate; p && !seen.has(p); p = parents.get(p)) {
      if (p === item) {
        return true;
      }
      seen.add(p);
    }
    return false;
  };
  return items.filter((c) => c.id && c !== item && !isDescendant(c)).sort((a, b) => a.title.localeCompare(b.title));
}

/** Columns editable from the table, and how each value is written to frontmatter. */
export const EDITABLE_FIELDS = ['title', 'type', 'status', 'priority', 'start', 'end', 'tags', 'parent'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * Validates a cell edit and turns it into a frontmatter patch (keys mapped through
 * `props`; `undefined` deletes the key). Returns undefined for invalid input.
 */
export function cellPatch(
  field: string,
  value: unknown,
  props: PropertyMap,
): Record<string, unknown> | undefined {
  if (!(EDITABLE_FIELDS as readonly string[]).includes(field)) {
    return undefined;
  }
  const key = props[field as EditableField];
  switch (field as EditableField) {
    case 'title':
      return typeof value === 'string' && value.trim() ? { [key]: value.trim() } : undefined;
    case 'type':
      return value === 'task' || value === 'event' || value === 'holiday' ? { [key]: value } : undefined;
    case 'status':
      return typeof value === 'string' && value.trim() ? { [key]: value.trim() } : undefined;
    case 'priority': {
      if (value === '' || value === null || value === undefined) {
        return { [key]: undefined };
      }
      const priority = parsePriority(value);
      return priority ? { [key]: priority } : undefined;
    }
    case 'start':
    case 'end': {
      if (value === '' || value === null || value === undefined) {
        return { [key]: undefined };
      }
      const date = normalizeDate(value);
      return date ? { [key]: date } : undefined;
    }
    case 'tags': {
      const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : undefined;
      if (!list) {
        return undefined;
      }
      return { [key]: [...new Set(list.map((t) => String(t).trim()).filter(Boolean))] };
    }
    case 'parent':
      if (value === '' || value === null || value === undefined) {
        return { [key]: undefined };
      }
      return typeof value === 'string' ? { [key]: value } : undefined;
  }
}
