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

const MARK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\](?=\s|$))/;

export type BodyLine =
  | { kind: 'task'; line: number; depth: number; checked: boolean; text: string }
  | { kind: 'heading'; line: number; level: number; text: string }
  | { kind: 'code'; line: number; text: string }
  | { kind: 'blank'; line: number }
  | { kind: 'text'; line: number; depth: number; text: string };

/**
 * Splits a body into display lines for the editor dialog. `line` is the index in
 * `body.split('\n')`, the same numbering applyChecks uses. Fences are left out.
 */
export function bodyLines(body: string): BodyLine[] {
  const out: BodyLine[] = [];
  let fence: string | undefined;
  body.split('\n').forEach((raw, line) => {
    const text = raw.replace(/\r$/, '');
    const f = FENCE_RE.exec(text);
    if (f) {
      if (!fence) {
        fence = f[1];
      } else if (f[1] === fence) {
        fence = undefined;
      }
      return;
    }
    if (fence) {
      out.push({ kind: 'code', line, text });
      return;
    }
    const indent = /^\s*/.exec(text)![0].replace(/\t/g, '    ').length;
    const depth = Math.floor(indent / 2);
    const task = MARK_RE.exec(text);
    if (task) {
      out.push({ kind: 'task', line, depth, checked: task[2] !== ' ', text: text.slice(task[0].length).trim() });
      return;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(text);
    if (heading) {
      out.push({ kind: 'heading', line, level: heading[1].length, text: heading[2] });
    } else if (!text.trim()) {
      out.push({ kind: 'blank', line });
    } else {
      out.push({ kind: 'text', line, depth, text: text.trim() });
    }
  });
  // Trim leading/trailing blank lines.
  while (out[0]?.kind === 'blank') {
    out.shift();
  }
  while (out.at(-1)?.kind === 'blank') {
    out.pop();
  }
  return out;
}

/**
 * Sets task list items' check marks by line index (see bodyLines). Lines that are
 * no longer task items (the file changed meanwhile) or sit in code blocks are skipped.
 */
export function applyChecks(body: string, checks: { line: number; checked: boolean }[]): string {
  const wanted = new Map(checks.map((c) => [c.line, c.checked]));
  let fence: string | undefined;
  return body
    .split('\n')
    .map((raw, line) => {
      const f = FENCE_RE.exec(raw);
      if (f) {
        if (!fence) {
          fence = f[1];
        } else if (f[1] === fence) {
          fence = undefined;
        }
        return raw;
      }
      const checked = wanted.get(line);
      if (fence || checked === undefined || !MARK_RE.test(raw)) {
        return raw;
      }
      return raw.replace(MARK_RE, (_, open: string, mark: string, close: string) =>
        open + (checked ? (mark === ' ' ? 'x' : mark) : ' ') + close,
      );
    })
    .join('\n');
}
