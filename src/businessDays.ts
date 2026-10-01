import { datesBetween, japaneseHoliday, vacationDays } from './holidays';
import { t } from './i18n';
import type { PlannerItem } from './model';
import { resolveStatus, type Lang, type PlannerSettings } from './settings';

/** Working-day rules: weekend days, Japanese holidays (when shown) and the user's vacations. */
export interface BusinessCalendar {
  isBusinessDay(date: string): boolean;
}

export function businessCalendar(
  items: PlannerItem[],
  settings: Pick<PlannerSettings, 'weekendColors' | 'showHolidays'>,
): BusinessCalendar {
  const vacations = new Set(vacationDays(items).map((d) => d.date));
  return {
    isBusinessDay(date: string) {
      const [y, m, d] = date.split('-').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      return (
        !settings.weekendColors[String(dow)] &&
        !(settings.showHolidays && japaneseHoliday(date, 'ja')) &&
        !vacations.has(date)
      );
    },
  };
}

/** Business days from `from` to `to`, both inclusive (`YYYY-MM-DD`); 0 when from > to. */
export function countBusinessDays(from: string, to: string, cal: BusinessCalendar): number {
  return datesBetween(from, to).filter((d) => cal.isBusinessDay(d)).length;
}

export type Remaining =
  /** `days` business days left, counting today and the deadline. */
  | { kind: 'left'; days: number }
  /** The deadline is today. */
  | { kind: 'today'; days: number }
  /** `days` business days past the deadline (up to and including today). */
  | { kind: 'overdue'; days: number };

/** Deadline of a task: its end, or its start for single-day tasks. */
export function deadlineOf(item: PlannerItem): string | undefined {
  return (item.end ?? item.start)?.slice(0, 10);
}

/** Undefined for events, vacations, completed tasks and undated tasks. */
export function remainingBusinessDays(
  item: PlannerItem,
  today: string,
  cal: BusinessCalendar,
  settings: Pick<PlannerSettings, 'statuses'>,
): Remaining | undefined {
  const deadline = deadlineOf(item);
  if (item.type !== 'task' || !deadline || resolveStatus(item.status, settings.statuses).done) {
    return undefined;
  }
  if (deadline === today) {
    return { kind: 'today', days: countBusinessDays(today, today, cal) };
  }
  if (deadline > today) {
    return { kind: 'left', days: countBusinessDays(today, deadline, cal) };
  }
  const [y, m, d] = deadline.split('-').map(Number);
  const dayAfter = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { kind: 'overdue', days: countBusinessDays(dayAfter, today, cal) };
}

/** Sort key: overdue first (most overdue first), then fewest days left. */
export function remainingSortKey(r: Remaining | undefined): number | undefined {
  if (!r) {
    return undefined;
  }
  return r.kind === 'overdue' ? -r.days - 1 : r.kind === 'today' ? -0.5 : r.days;
}

export function remainingLabel(r: Remaining, lang: Lang): string {
  switch (r.kind) {
    case 'left':
      return t(lang, 'remaining.left', r.days);
    case 'today':
      return t(lang, 'remaining.today');
    case 'overdue':
      // Past the deadline only by days off (e.g. due Friday, today Sunday).
      return r.days === 0 ? t(lang, 'remaining.overdueSoft') : t(lang, 'remaining.overdue', r.days);
  }
}
