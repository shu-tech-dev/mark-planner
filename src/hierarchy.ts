import type { PlannerItem } from './model';

export interface TreeRow {
  item: PlannerItem;
  depth: number;
  start: string;
  end: string;
  /** Span computed from children because the item has no dates of its own. */
  derived: boolean;
  hasChildren: boolean;
}

/** Resolves `parent` references; unknown IDs, self-references and duplicate IDs are ignored. */
export function parentMap(items: PlannerItem[]): Map<PlannerItem, PlannerItem> {
  const byId = new Map<string, PlannerItem>();
  for (const item of items) {
    if (item.id && !byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  const parents = new Map<PlannerItem, PlannerItem>();
  for (const item of items) {
    const parent = item.parent ? byId.get(item.parent) : undefined;
    if (parent && parent !== item) {
      parents.set(item, parent);
    }
  }
  return parents;
}

/** Titles of the ancestors, nearest first. Stops on cycles. */
export function ancestorTitles(item: PlannerItem, parents: Map<PlannerItem, PlannerItem>): string[] {
  const titles: string[] = [];
  const seen = new Set([item]);
  for (let p = parents.get(item); p && !seen.has(p); p = parents.get(p)) {
    seen.add(p);
    titles.push(p.title);
  }
  return titles;
}

/**
 * Orders items depth-first (parents before their children, siblings by start date)
 * and drops items that have neither dates nor dated descendants.
 */
export function buildTree(items: PlannerItem[]): TreeRow[] {
  const parents = parentMap(items);
  const children = new Map<PlannerItem, PlannerItem[]>();
  for (const [child, parent] of parents) {
    children.set(parent, [...(children.get(parent) ?? []), child]);
  }

  type Span = { start: string; end: string; derived: boolean } | null;
  const spans = new Map<PlannerItem, Span>();
  const span = (item: PlannerItem, visiting: Set<PlannerItem>): Span => {
    if (spans.has(item)) {
      return spans.get(item)!;
    }
    let result: Span = null;
    const own = item.start ?? item.end;
    if (own) {
      const end = item.end ?? own;
      result = { start: own, end: end < own ? own : end, derived: false };
    } else if (!visiting.has(item)) {
      visiting.add(item);
      for (const child of children.get(item) ?? []) {
        const s = span(child, visiting);
        if (s) {
          result = result
            ? { start: min(result.start, s.start), end: max(result.end, s.end), derived: true }
            : { start: s.start, end: s.end, derived: true };
        }
      }
      visiting.delete(item);
    }
    spans.set(item, result);
    return result;
  };

  const bySpan = (a: PlannerItem, b: PlannerItem) => {
    const sa = span(a, new Set())!;
    const sb = span(b, new Set())!;
    return sa.start.localeCompare(sb.start) || sa.end.localeCompare(sb.end) || a.title.localeCompare(b.title);
  };

  const rows: TreeRow[] = [];
  const visited = new Set<PlannerItem>();
  const visit = (item: PlannerItem, depth: number) => {
    if (visited.has(item)) {
      return;
    }
    visited.add(item);
    const s = span(item, new Set());
    if (!s) {
      return;
    }
    const kids = (children.get(item) ?? []).filter((c) => span(c, new Set())).sort(bySpan);
    rows.push({ item, depth, ...s, hasChildren: kids.length > 0 });
    kids.forEach((kid) => visit(kid, depth + 1));
  };

  const dated = items.filter((i) => span(i, new Set()));
  dated.filter((i) => !parents.has(i)).sort(bySpan).forEach((i) => visit(i, 0));
  // Items caught in a parent cycle have no root; show them at the top level.
  dated.filter((i) => !visited.has(i)).sort(bySpan).forEach((i) => visit(i, 0));
  return rows;
}

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);
