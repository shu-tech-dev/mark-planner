import type { PlannerItem } from './model';
import { resolveStatus, type StatusDef } from './settings';

export interface Checklist {
  done: number;
  total: number;
}

const TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\](?=\s|$)/;
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Counts Markdown task list items (`- [ ]` / `- [x]`, also `*`, `+`, `1.`), nested
 * ones included (like GitHub), skipping fenced code blocks. Undefined when none.
 */
export function countChecklist(body: string): Checklist | undefined {
  let done = 0;
  let total = 0;
  let fence: string | undefined;
  for (const line of body.split(/\r?\n/)) {
    const f = FENCE_RE.exec(line);
    if (f) {
      if (!fence) {
        fence = f[1];
      } else if (f[1] === fence) {
        fence = undefined;
      }
      continue;
    }
    if (fence) {
      continue;
    }
    const m = TASK_RE.exec(line);
    if (m) {
      total++;
      if (m[1] !== ' ') {
        done++;
      }
    }
  }
  return total ? { done, total } : undefined;
}

/**
 * Progress in percent: 100 for completed statuses, else the checklist ratio when the
 * body has one, else the status's configured progress.
 */
export function itemProgress(item: PlannerItem, statuses: StatusDef[]): number {
  const status = resolveStatus(item.status, statuses);
  if (status.done) {
    return 100;
  }
  if (item.checklist) {
    return Math.round((item.checklist.done / item.checklist.total) * 100);
  }
  return status.progress;
}
