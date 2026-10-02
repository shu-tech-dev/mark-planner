import Gantt from 'frappe-gantt';
import { itemProgress } from '../src/checklist';
import { buildTree, TreeRow } from '../src/hierarchy';
import { DayLabel, japaneseHolidaysBetween, vacationDays, weekendColor } from '../src/holidays';
import { t } from '../src/i18n';
import type { PlannerItem } from '../src/model';
import { GanttViewMode, Lang, PlannerSettings, resolveStatus } from '../src/settings';
import { translucent } from './colors';
import { addDays, formatDate, formatDateTime, isDateOnly } from './dates';
import { itemTooltip, tooltip } from './tooltip';
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

/** Soft bar with a solid progress fill and outline in the status color. */
function statusStyles(settings: PlannerSettings): string {
  const rule = (selector: string, color: string) =>
    `.gantt .bar-wrapper${selector} .bar { fill: ${color}; fill-opacity: 0.22; stroke: ${color}; stroke-opacity: 0.55; }
.gantt .bar-wrapper${selector} .bar-progress { fill: ${color}; fill-opacity: 0.6; }`;
  const rules = settings.statuses.map((s, i) => rule(`[class*="_s-${i}_"]`, s.color));
  rules.push(rule('[class*="_t-event_"]', settings.eventColor));
  return rules.join('\n');
}

type DayMatcher = DayLabel | ((d: Date) => boolean);

/**
 * frappe-gantt scrolls with `behavior: 'smooth'` whenever it renders, which made the
 * chart slide in from the left on first open. Run `fn` with scrolling forced instant.
 */
function withInstantScroll<T>(fn: () => T): T {
  const original = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
    const [first] = args;
    const next = typeof first === 'object' && first ? [{ ...(first as ScrollToOptions), behavior: 'instant' }] : args;
    return Reflect.apply(original, this, next);
  } as typeof original;
  try {
    return fn();
  } finally {
    Element.prototype.scrollTo = original;
  }
}

/**
 * frappe-gantt's `holidays` option maps a fill color to the days to shade:
 * `{date, name}` entries (name shown on hover) and/or a matcher function.
 */
function dayShading(items: PlannerItem[], rows: TreeRow[], settings: PlannerSettings, lang: Lang) {
  const holidays: Record<string, DayMatcher[]> = {};
  // Keys are colors; pad with spaces so equal colors don't overwrite each other.
  const add = (color: string, days: DayMatcher[]) => {
    let key = color;
    while (key in holidays) {
      key += ' ';
    }
    holidays[key] = days;
  };
  for (const [day, color] of Object.entries(settings.weekendColors)) {
    // A holiday on a weekend is shaded as a holiday only.
    add(translucent(color, '12'), [
      (d: Date) => d.getDay() === Number(day) && weekendColor(formatDate(d), d.getDay(), settings) !== undefined,
    ]);
  }
  if (settings.showHolidays && rows.length) {
    // The chart pads (and scrolls) beyond the tasks, so cover a generous range.
    const from = addDays(rows.reduce((m, r) => (r.start < m ? r.start : m), rows[0].start).slice(0, 10), -400);
    const to = addDays(rows.reduce((m, r) => (r.end > m ? r.end : m), rows[0].end).slice(0, 10), 400);
    add(translucent(settings.holidayColor, '17'), japaneseHolidaysBetween(from, to, lang));
  }
  const vacations = vacationDays(items);
  if (vacations.length) {
    add(translucent(settings.vacationColor, '17'), vacations);
  }
  return { holidays };
}

export class GanttView {
  private gantt: Gantt | undefined;
  private rows: TreeRow[] = [];
  private tasks: unknown[] = [];
  private applied = '';
  /** Current scale; follows the setting when it changes, otherwise the app bar. */
  private mode: GanttViewMode = 'Day';
  private appliedSettingMode: GanttViewMode | undefined;
  /** Read by the bar tooltip. */
  private context: { items: PlannerItem[]; settings: PlannerSettings; lang: Lang } | undefined;
  private readonly style = document.head.appendChild(document.createElement('style'));

  constructor(
    private readonly chart: HTMLElement,
    private readonly empty: HTMLElement,
  ) {
    // Hover tooltips on bars (shared with the calendar; frappe's popup is off).
    chart.addEventListener('mouseover', (e) => {
      const wrapper = (e.target as Element).closest('.bar-wrapper');
      const row = wrapper && this.rows[Number(wrapper.getAttribute('data-id')?.slice(1))];
      if (wrapper && row && this.context) {
        const ctx = this.context;
        tooltip().hoverStart(
          wrapper,
          () => itemTooltip(row.item, ctx, { hint: 'tooltip.openDblClick', span: row }),
          { x: e.clientX, y: e.clientY },
        );
      }
    });
    chart.addEventListener('mouseout', (e) => {
      const wrapper = (e.target as Element).closest('.bar-wrapper');
      if (wrapper && !wrapper.contains(e.relatedTarget as Node)) {
        tooltip().hoverEnd(wrapper);
      }
    });
  }

  update(items: PlannerItem[], settings: PlannerSettings, lang: Lang): void {
    this.style.textContent = statusStyles(settings);
    this.context = { items, settings, lang };
    // Vacations are shown as shaded days, not as bars.
    const tasks = items.filter((i) => i.type !== 'holiday');
    const visible = settings.hideDone
      ? tasks.filter((i) => !resolveStatus(i.status, settings.statuses).done)
      : tasks;
    const rows = buildTree(visible);
    const shading = dayShading(items, rows, settings, lang);
    this.rows = rows;
    const indexById = new Map(rows.flatMap((row, i) => (row.item.id ? [[row.item.id, i] as const] : [])));

    this.tasks = rows.map((row, i) => {
      const { item } = row;
      const status = resolveStatus(item.status, settings.statuses);
      return {
        id: `t${i}`,
        name: row.depth > 0 ? `${'　'.repeat(row.depth - 1)}└ ${item.title}` : item.title,
        start: toGanttDate(row.start),
        end: toGanttDate(row.end),
        progress: itemProgress(item, settings.statuses),
        dependencies: item.depends.flatMap((id) => (indexById.has(id) ? [`t${indexById.get(id)}`] : [])).join(','),
        custom_class: barClass(item.type, status.index, row.hasChildren, row.derived, status.done && item.type === 'task'),
      };
    });

    this.empty.hidden = this.tasks.length > 0;
    if (this.appliedSettingMode !== settings.ganttViewMode) {
      this.appliedSettingMode = settings.ganttViewMode;
      this.mode = settings.ganttViewMode;
    }
    // Language is a construction option, so rebuild when it changes.
    const applied = lang;
    if (this.tasks.length === 0 || applied !== this.applied) {
      this.chart.innerHTML = '';
      this.gantt = undefined;
      this.applied = applied;
    }
    if (this.tasks.length === 0) {
      return;
    }
    if (this.gantt) {
      // Shading and scale are read from options on every render.
      Object.assign(this.gantt.options, shading, { view_mode: this.mode });
      this.redraw();
      return;
    }
    this.gantt = withInstantScroll(() => new Gantt(this.chart, this.tasks, {
      ...shading,
      language: lang,
      view_mode: this.mode,
      // Scale and "today" are driven from the app bar.
      view_mode_select: false,
      today_button: false,
      readonly_progress: true,
      bar_height: 24,
      bar_corner_radius: 6,
      padding: 20,
      arrow_curve: 6,
      popup: false,
      on_double_click: (task: { id: string }) => {
        post({ type: 'open', key: this.rowOf(task).item.key });
      },
      on_date_change: (task: { id: string }, start: Date, end: Date) => {
        const row = this.rowOf(task);
        if (row.derived) {
          // The span comes from the children; snap the bar back.
          setTimeout(() => this.redraw());
          return;
        }
        const fmt = isDateOnly(row.start) ? formatDate : formatDateTime;
        this.queueMove(row.item.key, fmt(start), fmt(end));
      },
    }));
    this.stopBarAnimations();
  }

  /**
   * frappe-gantt reports a date change for every snap step while a bar is dragged;
   * keep only the latest per item and write once when the mouse is released.
   */
  private readonly pendingMoves = new Map<string, { start: string; end: string }>();

  private queueMove(key: string, start: string, end: string): void {
    if (this.pendingMoves.size === 0) {
      window.addEventListener('mouseup', () => setTimeout(() => this.flushMoves()), { once: true });
    }
    this.pendingMoves.set(key, { start, end });
  }

  private flushMoves(): void {
    for (const [key, { start, end }] of this.pendingMoves) {
      post({ type: 'move', key, start, end });
    }
    this.pendingMoves.clear();
  }

  /** Re-renders with new tasks, keeping the scroll position (refresh() jumps to today). */
  private redraw(): void {
    if (!this.gantt) {
      return;
    }
    const gantt = this.gantt;
    withInstantScroll(() => {
      gantt.setup_tasks(this.tasks);
      gantt.change_view_mode(undefined, true);
    });
    this.stopBarAnimations();
  }

  /** Bars grow from zero width via SVG <animate> on first render; show them as-is. */
  private stopBarAnimations(): void {
    this.chart.querySelectorAll('animate').forEach((a) => a.remove());
  }

  get viewMode(): GanttViewMode {
    return this.mode;
  }

  setViewMode(mode: GanttViewMode): void {
    this.mode = mode;
    withInstantScroll(() => this.gantt?.change_view_mode(mode));
    this.stopBarAnimations();
  }

  /** The "Today" button keeps frappe's smooth scroll. */
  today(): void {
    this.gantt?.scroll_current();
  }

  private rowOf(task: { id: string }): TreeRow {
    return this.rows[Number(task.id.slice(1))];
  }
}
