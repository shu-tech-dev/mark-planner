import holidayData from '@holiday-jp/holiday_jp/lib/holidays';
import type { PlannerItem } from './model';
import type { Lang } from './settings';

export interface DayLabel {
  /** `YYYY-MM-DD` */
  date: string;
  name: string;
}

const japanese = holidayData as unknown as Record<string, { name: string; name_en: string }>;

/** Japanese public holiday on `date` (`YYYY-MM-DD`), if any. Data covers 1970–2050. */
export function japaneseHoliday(date: string, lang: Lang): string | undefined {
  const h = japanese[date];
  return h && (lang === 'ja' ? h.name : h.name_en);
}

/** Japanese public holidays in `[from, to]` (inclusive, `YYYY-MM-DD`). */
export function japaneseHolidaysBetween(from: string, to: string, lang: Lang): DayLabel[] {
  return Object.keys(japanese)
    .filter((date) => date >= from && date <= to)
    .map((date) => ({ date, name: japaneseHoliday(date, lang)! }));
}

/** Every date from `start` to `end` inclusive (`YYYY-MM-DD`; times are ignored). */
export function datesBetween(start: string, end: string): string[] {
  const [y, m, d] = start.slice(0, 10).split('-').map(Number);
  const last = end.slice(0, 10);
  const dates: string[] = [];
  for (let day = new Date(Date.UTC(y, m - 1, d)); ; day.setUTCDate(day.getUTCDate() + 1)) {
    const iso = day.toISOString().slice(0, 10);
    if (iso > last || dates.length > 366 * 5) {
      break;
    }
    dates.push(iso);
  }
  return dates;
}

/** Days covered by the user's vacation items (`type: holiday`). */
export function vacationDays(items: PlannerItem[]): DayLabel[] {
  return items
    .filter((i) => i.type === 'holiday' && (i.start ?? i.end))
    .flatMap((i) => {
      const start = (i.start ?? i.end)!;
      return datesBetween(start, i.end ?? start).map((date) => ({ date, name: i.title }));
    });
}
