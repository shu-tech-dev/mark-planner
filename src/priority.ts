import type { Lang } from './settings';

/** 1 = high, 2 = medium, 3 = low (like Todoist's P1–P3); no priority when unset. */
export type Priority = 1 | 2 | 3;

export const PRIORITIES: Priority[] = [1, 2, 3];

export const PRIORITY_COLORS: Record<Priority, string> = { 1: '#f14c4c', 2: '#e8912d', 3: '#3794ff' };

const ALIASES: Record<string, Priority> = {
  '1': 1,
  p1: 1,
  high: 1,
  高: 1,
  '2': 2,
  p2: 2,
  medium: 2,
  中: 2,
  '3': 3,
  p3: 3,
  low: 3,
  低: 3,
};

/** Reads `1`–`3`, `p1`–`p3`, `high` / `medium` / `low` or `高` / `中` / `低`. */
export function parsePriority(value: unknown): Priority | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  return ALIASES[String(value).trim().toLowerCase()];
}

/** "P1 高" / "P1 High". */
export function priorityLabel(priority: Priority, lang: Lang): string {
  const names = lang === 'ja' ? ['高', '中', '低'] : ['High', 'Medium', 'Low'];
  return `P${priority} ${names[priority - 1]}`;
}

/** Sort key: high first, unset last (4). */
export function priorityRank(priority: Priority | undefined): number {
  return priority ?? 4;
}
