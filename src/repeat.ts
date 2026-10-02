import type { Lang } from './settings';

export type RepeatUnit = 'day' | 'week' | 'month' | 'year' | 'weekday';

export interface RepeatRule {
  unit: RepeatUnit;
  /** Interval; always 1 for `weekday`. */
  every: number;
}

const WORDS: Record<string, RepeatRule> = {
  daily: { unit: 'day', every: 1 },
  weekly: { unit: 'week', every: 1 },
  biweekly: { unit: 'week', every: 2 },
  monthly: { unit: 'month', every: 1 },
  yearly: { unit: 'year', every: 1 },
  annually: { unit: 'year', every: 1 },
  weekdays: { unit: 'weekday', every: 1 },
  毎日: { unit: 'day', every: 1 },
  毎週: { unit: 'week', every: 1 },
  隔週: { unit: 'week', every: 2 },
  毎月: { unit: 'month', every: 1 },
  毎年: { unit: 'year', every: 1 },
  平日: { unit: 'weekday', every: 1 },
};

const EN_UNITS: Record<string, RepeatUnit> = { day: 'day', week: 'week', month: 'month', year: 'year', weekday: 'weekday' };
const JA_UNITS: Record<string, RepeatUnit> = { 日: 'day', 週: 'week', 週間: 'week', か月: 'month', ヶ月: 'month', カ月: 'month', ヵ月: 'month', 年: 'year' };

const EN_RE = /^every\s+(?:(\d+)\s+)?(day|week|month|year|weekday)s?$/;
const JA_RE = /^(\d+)\s*(日|週間|週|か月|ヶ月|カ月|ヵ月|年)ごと$/;

/**
 * Parses a `repeat` value: `daily` / `weekly` / `biweekly` / `monthly` / `yearly` /
 * `weekdays`, `every 2 weeks`, `毎日` / `毎週` / `隔週` / `毎月` / `毎年` / `平日`, `3日ごと`.
 */
export function parseRepeat(value: string | undefined): RepeatRule | undefined {
  const v = value?.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!v) {
    return undefined;
  }
  if (WORDS[v]) {
    return WORDS[v];
  }
  const en = EN_RE.exec(v);
  if (en) {
    const unit = EN_UNITS[en[2]];
    const every = unit === 'weekday' ? 1 : Number(en[1] ?? 1);
    return every > 0 ? { unit, every } : undefined;
  }
  const ja = JA_RE.exec(v);
  if (ja && Number(ja[1]) > 0) {
    return { unit: JA_UNITS[ja[2]], every: Number(ja[1]) };
  }
  return undefined;
}

/** Short label for UI, e.g. "毎週" / "2週ごと" / "Every 2 weeks". */
export function repeatLabel(rule: RepeatRule, lang: Lang): string {
  if (lang === 'ja') {
    if (rule.unit === 'weekday') {
      return '平日';
    }
    const ja = { day: '日', week: '週', month: '月', year: '年' }[rule.unit];
    return rule.every === 1 ? `毎${ja}` : `${rule.every}${rule.unit === 'month' ? 'か月' : ja}ごと`;
  }
  if (rule.unit === 'weekday') {
    return 'Weekdays';
  }
  if (rule.every === 1) {
    return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[rule.unit];
  }
  return `Every ${rule.every} ${rule.unit}s`;
}

const toUtc = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Adds months, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return fromUtc(target.getTime());
}

/** One step of the rule from `date` (`YYYY-MM-DD`). */
function step(date: string, rule: RepeatRule): string {
  switch (rule.unit) {
    case 'day':
      return addDays(date, rule.every);
    case 'week':
      return addDays(date, 7 * rule.every);
    case 'month':
      return addMonths(date, rule.every);
    case 'year':
      return addMonths(date, 12 * rule.every);
    case 'weekday': {
      let next = addDays(date, 1);
      while ([0, 6].includes(new Date(toUtc(next)).getUTCDay())) {
        next = addDays(next, 1);
      }
      return next;
    }
  }
}

/** Moves the date part of `YYYY-MM-DD[THH:mm]` by whole days, keeping the time. */
function shift(value: string, days: number): string {
  return addDays(value, days) + value.slice(10);
}

/**
 * Dates of the next occurrence: the anchor (start, or end for deadline-only tasks)
 * advances by the rule at least once and until the deadline is not in the past,
 * so a late completion does not leave a trail of overdue copies. The other date
 * moves by the same number of days, keeping the span and any time of day.
 */
export function nextOccurrence(
  dates: { start?: string; end?: string },
  rule: RepeatRule,
  today: string,
): { start?: string; end?: string } | undefined {
  const anchor = dates.start ?? dates.end;
  if (!anchor) {
    return undefined;
  }
  const deadlineOffset = dates.end ? (toUtc(dates.end) - toUtc(anchor)) / DAY_MS : 0;
  const todayMs = toUtc(today);
  let next = anchor.slice(0, 10);
  do {
    next = step(next, rule);
  } while (toUtc(next) + deadlineOffset * DAY_MS < todayMs);
  const days = (toUtc(next) - toUtc(anchor)) / DAY_MS;
  return {
    ...(dates.start ? { start: shift(dates.start, days) } : {}),
    ...(dates.end ? { end: shift(dates.end, days) } : {}),
  };
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)[xX](\](?:\s|$))/;
const FENCE_RE = /^\s*(```|~~~)/;

/** Unchecks every Markdown task list item outside fenced code blocks. */
export function uncheckChecklist(body: string): string {
  let fence: string | undefined;
  return body
    .split('\n')
    .map((line) => {
      const f = FENCE_RE.exec(line);
      if (f) {
        if (!fence) {
          fence = f[1];
        } else if (f[1] === fence) {
          fence = undefined;
        }
        return line;
      }
      return fence ? line : line.replace(TASK_RE, '$1 $2');
    })
    .join('\n');
}
