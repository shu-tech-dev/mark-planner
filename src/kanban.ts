import { remainingSortKey, type Remaining } from './businessDays';
import type { PlannerItem } from './model';
import { priorityRank } from './priority';
import { resolveStatus, type StatusDef } from './settings';

export interface KanbanColumn {
  status: StatusDef;
  cards: PlannerItem[];
}

/**
 * One column per configured status (in settings order), holding the tasks in that
 * status. Unknown statuses fall into the first column, like everywhere else.
 * Cards are ordered by deadline urgency (overdue → due today → fewest workdays
 * left), then by priority, then by start date, with undated tasks last.
 */
export function buildBoard(
  items: PlannerItem[],
  statuses: StatusDef[],
  remainingOf: (item: PlannerItem) => Remaining | undefined,
): KanbanColumn[] {
  const columns = statuses.map((status) => ({ status, cards: [] as PlannerItem[] }));
  for (const item of items) {
    if (item.type === 'task') {
      columns[resolveStatus(item.status, statuses).index].cards.push(item);
    }
  }
  const key = (i: PlannerItem) => remainingSortKey(remainingOf(i));
  const compare = (a: PlannerItem, b: PlannerItem) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) {
      return ka === undefined ? 1 : kb === undefined ? -1 : ka - kb;
    }
    const pa = priorityRank(a.priority);
    const pb = priorityRank(b.priority);
    if (pa !== pb) {
      return pa - pb;
    }
    const da = a.start ?? a.end;
    const db = b.start ?? b.end;
    if (da !== db) {
      return da === undefined ? 1 : db === undefined ? -1 : da.localeCompare(db);
    }
    return a.title.localeCompare(b.title);
  };
  for (const column of columns) {
    column.cards.sort(compare);
  }
  return columns;
}
