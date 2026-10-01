export type ItemType = 'task' | 'event';

export interface PlannerItem {
  /** File URI string; stable key even when `id` is missing or duplicated. */
  key: string;
  id?: string;
  title: string;
  type: ItemType;
  status: string;
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. */
  start?: string;
  /** Inclusive end, same format as `start`. */
  end?: string;
  tags: string[];
  parent?: string;
  depends: string[];
  /** Workspace-relative path, for display. */
  path: string;
}

export interface PropertyMap {
  id: string;
  title: string;
  type: string;
  status: string;
  start: string;
  end: string;
  tags: string;
  parent: string;
  depends: string;
}

export const DEFAULT_PROPERTY_MAP: PropertyMap = {
  id: 'id',
  title: 'title',
  type: 'type',
  status: 'status',
  start: 'start',
  end: 'end',
  tags: 'tags',
  parent: 'parent',
  depends: 'depends',
};

const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?$/;

/** Normalizes a frontmatter date to `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. */
export function normalizeDate(value: unknown): string | undefined {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const m = DATE_RE.exec(value.trim());
  if (!m) {
    return undefined;
  }
  return m[2] ? `${m[1]}T${m[2]}` : m[1];
}

export function isDateOnly(date: string): boolean {
  return date.length === 10;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(asString).filter((v): v is string => v !== undefined);
  }
  const single = asString(value);
  return single ? [single] : [];
}

/**
 * Returns undefined unless the frontmatter has a usable date or an ID
 * (undated items with an ID can still act as parents).
 */
export function toPlannerItem(
  data: Record<string, unknown>,
  key: string,
  path: string,
  props: PropertyMap = DEFAULT_PROPERTY_MAP,
): PlannerItem | undefined {
  const start = normalizeDate(data[props.start]);
  const end = normalizeDate(data[props.end]);
  const id = asString(data[props.id]);
  if (!start && !end && !id) {
    return undefined;
  }
  const fileTitle = path.split('/').pop()!.replace(/\.md$/i, '');
  return {
    key,
    id,
    title: asString(data[props.title]) ?? fileTitle,
    type: asString(data[props.type]) === 'event' ? 'event' : 'task',
    status: asString(data[props.status]) ?? 'todo',
    start,
    end,
    tags: asStringList(data[props.tags]),
    parent: asString(data[props.parent]),
    depends: asStringList(data[props.depends]),
    path,
  };
}

/**
 * Decides which frontmatter keys to write when an item is moved/resized in the UI.
 * Keeps the item's shape: a start-only item stays start-only unless it gains a span,
 * and an end-only (deadline) item only updates its end.
 */
export function moveToPatch(
  item: Pick<PlannerItem, 'start' | 'end'>,
  newStart: string,
  newEnd: string | undefined,
  props: PropertyMap = DEFAULT_PROPERTY_MAP,
): Record<string, string | undefined> {
  if (!item.start) {
    return { [props.end]: newStart };
  }
  if (!item.end && (newEnd === undefined || newEnd === newStart)) {
    return { [props.start]: newStart };
  }
  return { [props.start]: newStart, [props.end]: newEnd ?? newStart };
}
