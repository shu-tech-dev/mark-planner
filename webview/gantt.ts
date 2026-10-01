import Gantt from 'frappe-gantt';
import { buildTree, TreeRow } from '../src/hierarchy';
import { t } from '../src/i18n';
import type { PlannerItem } from '../src/model';
import { Lang, PlannerSettings, resolveStatus } from '../src/settings';
import { formatDate, formatDateTime, isDateOnly } from './dates';
import { post } from './vscode';

const toGanttDate = (date: string) => date.replace('T', ' ');

/**
 * frappe-gantt accepts a single class token per bar, so the bar's traits are
 * packed into one token like `mp_t-task_s-2_p-1_d-0_x-1_` and matched with
 * `[class*="_s-2_"]` selectors.
 */
function barClass(type: string, statusIndex: number, parent: boolean, derived: boolean, done: boolean): string {
  return `mp_t-${type}_s-${statusIndex}_p-${+parent}_d-${+derived}_x-${+done}_`;
}

function statusStyles(settings: PlannerSettings): string {
  const rules = settings.statuses.map(
    (s, i) => `.gantt .bar-wrapper[class*="_s-${i}_"] .bar { fill: ${s.color}; }`,
  );
  rules.push(`.gantt .bar-wrapper[class*="_t-event_"] .bar { fill: ${settings.eventColor}; }`);
  return rules.join('\n');
}

export class GanttView {
  private gantt: Gantt | undefined;
  private rows: TreeRow[] = [];
  private tasks: unknown[] = [];
  private applied = '';
  private readonly style = document.head.appendChild(document.createElement('style'));

  constructor(
    private readonly chart: HTMLElement,
    private readonly empty: HTMLElement,
  ) {}

  update(items: PlannerItem[], settings: PlannerSettings, lang: Lang): void {
    this.style.textContent = statusStyles(settings);
    const visible = settings.hideDone
      ? items.filter((i) => !resolveStatus(i.status, settings.statuses).done)
      : items;
    const rows = buildTree(visible);
    this.rows = rows;
    const indexById = new Map(rows.flatMap((row, i) => (row.item.id ? [[row.item.id, i] as const] : [])));

    this.tasks = rows.map((row, i) => {
      const { item } = row;
      const status = resolveStatus(item.status, settings.statuses);
      return {
        id: `t${i}`,
        name: row.depth > 0 ? `${'　'.repeat(row.depth - 1)}└ ${item.title}` : item.title,
        description: row.derived ? `${item.path}${t(lang, 'gantt.derived')}` : item.path,
        start: toGanttDate(row.start),
        end: toGanttDate(row.end),
        progress: status.progress,
        dependencies: item.depends.flatMap((id) => (indexById.has(id) ? [`t${indexById.get(id)}`] : [])).join(','),
        custom_class: barClass(item.type, status.index, row.hasChildren, row.derived, status.done && item.type === 'task'),
      };
    });

    this.empty.hidden = this.tasks.length > 0;
    // Language and scale are construction options, so rebuild when they change.
    const applied = `${lang}|${settings.ganttViewMode}`;
    if (this.tasks.length === 0 || applied !== this.applied) {
      this.chart.innerHTML = '';
      this.gantt = undefined;
      this.applied = applied;
    }
    if (this.tasks.length === 0) {
      return;
    }
    if (this.gantt) {
      this.gantt.refresh(this.tasks);
      return;
    }
    this.gantt = new Gantt(this.chart, this.tasks, {
      language: lang,
      view_mode: settings.ganttViewMode,
      view_mode_select: true,
      readonly_progress: true,
      on_double_click: (task: { id: string }) => {
        post({ type: 'open', key: this.rowOf(task).item.key });
      },
      on_date_change: (task: { id: string }, start: Date, end: Date) => {
        const row = this.rowOf(task);
        if (row.derived) {
          // The span comes from the children; snap the bar back.
          setTimeout(() => this.gantt?.refresh(this.tasks));
          return;
        }
        const fmt = isDateOnly(row.start) ? formatDate : formatDateTime;
        post({ type: 'move', key: row.item.key, start: fmt(start), end: fmt(end) });
      },
    });
  }

  private rowOf(task: { id: string }): TreeRow {
    return this.rows[Number(task.id.slice(1))];
  }
}
