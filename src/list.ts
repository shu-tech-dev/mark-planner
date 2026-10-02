import { deadlineOf } from './businessDays';
import { formatDisplayDate } from './dateFormat';
import { t } from './i18n';
import type { PlannerItem } from './model';
import { resolveStatus, type Lang, type StatusDef } from './settings';

export const LIST_SECTIONS = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later', 'noDate', 'completed'] as const;
export type ListSectionId = (typeof LIST_SECTIONS)[number];

export interface ListSection {
  id: ListSectionId;
  items: PlannerItem[];
}

const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** Last day of the week containing `today` (`weekStart`: 0 = Sunday). */
export function endOfWeek(today: string, weekStart: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(today, (weekStart + 6 - dow + 7) % 7);
}

/** Status to write when a task is checked (first "done" status) or unchecked (first status). */
export function toggleStatus(done: boolean, statuses: StatusDef[]): string | undefined {
  return done ? statuses.find((s) => s.done)?.name : statuses[0]?.name;
}

/**
 * Todoist-like sections by deadline (end, or start for single-day tasks): overdue,
 * today, tomorrow, the rest of this week, later, and undated. Completed tasks are
 * left out unless `showCompleted`, then listed last (most recent deadline first).
 * `keepOpen` keys stay in their section even when done (just-checked animation).
 */
export function buildList(
  items: PlannerItem[],
  today: string,
  options: { statuses: StatusDef[]; weekStart: number; showCompleted: boolean; keepOpen?: Set<string> },
): ListSection[] {
  const tomorrow = addDays(today, 1);
  const weekEnd = endOfWeek(today, options.weekStart);
  const sections = new Map<ListSectionId, PlannerItem[]>(LIST_SECTIONS.map((id) => [id, []]));
  for (const item of items) {
    if (item.type !== 'task') {
      continue;
    }
    const done = resolveStatus(item.status, options.statuses).done;
    if (done && !options.keepOpen?.has(item.key)) {
      if (options.showCompleted) {
        sections.get('completed')!.push(item);
      }
      continue;
    }
    const deadline = deadlineOf(item);
    const id: ListSectionId = !deadline
      ? 'noDate'
      : deadline < today
        ? 'overdue'
        : deadline === today
          ? 'today'
          : deadline === tomorrow
            ? 'tomorrow'
            : deadline <= weekEnd
              ? 'thisWeek'
              : 'later';
    sections.get(id)!.push(item);
  }
  const byDeadline = (a: PlannerItem, b: PlannerItem) =>
    (deadlineOf(a) ?? '').localeCompare(deadlineOf(b) ?? '') ||
    (a.end ?? a.start ?? '').localeCompare(b.end ?? b.start ?? '') ||
    a.title.localeCompare(b.title);
  for (const [id, list] of sections) {
    list.sort(id === 'completed' ? (a, b) => byDeadline(b, a) : byDeadline);
  }
  return [...sections].map(([id, list]) => ({ id, items: list }));
}

export type DueKind = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later';

/**
 * How a deadline reads in lists: "Today" / "Tomorrow" / weekday within this week /
 * formatted date otherwise, plus ` HH:mm` for timed deadlines. Undefined if undated.
 */
export function dueLabel(
  item: PlannerItem,
  today: string,
  options: { weekStart: number; dateFormat: string; lang: Lang },
): { kind: DueKind; text: string } | undefined {
  const deadline = deadlineOf(item);
  if (!deadline) {
    return undefined;
  }
  const raw = (item.end ?? item.start)!;
  const time = raw.length > 10 ? ` ${raw.slice(11, 16)}` : '';
  const tomorrow = addDays(today, 1);
  const { lang } = options;
  if (deadline < today) {
    return { kind: 'overdue', text: formatDisplayDate(deadline, options.dateFormat, lang) + time };
  }
  if (deadline === today) {
    return { kind: 'today', text: t(lang, 'list.today') + time };
  }
  if (deadline === tomorrow) {
    return { kind: 'tomorrow', text: t(lang, 'list.tomorrow') + time };
  }
  if (deadline <= endOfWeek(today, options.weekStart)) {
    const [y, m, d] = deadline.split('-').map(Number);
    return { kind: 'week', text: new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(new Date(y, m - 1, d)) + time };
  }
  return { kind: 'later', text: formatDisplayDate(deadline, options.dateFormat, lang) + time };
}
