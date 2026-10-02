import type { PlannerItem } from '../src/model';

/** `2/4` with a thin bar; complete when every box is checked. */
export function checklistInfo(item: PlannerItem): { text: string; percent: number; complete: boolean } | undefined {
  const c = item.checklist;
  if (!c) {
    return undefined;
  }
  return { text: `${c.done}/${c.total}`, percent: Math.round((c.done / c.total) * 100), complete: c.done === c.total };
}

export function progressElement(item: PlannerItem): HTMLElement | undefined {
  const info = checklistInfo(item);
  if (!info) {
    return undefined;
  }
  const wrap = document.createElement('span');
  wrap.className = `mp-progress${info.complete ? ' complete' : ''}`;
  wrap.title = `${info.percent}%`;
  const bar = document.createElement('span');
  bar.className = 'mp-progress-bar';
  const fill = document.createElement('span');
  fill.style.width = `${info.percent}%`;
  bar.append(fill);
  const text = document.createElement('span');
  text.className = 'mp-progress-text';
  text.textContent = info.text;
  wrap.append(bar, text);
  return wrap;
}
