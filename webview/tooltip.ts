import { businessCalendar, countBusinessDays, remainingBusinessDays, remainingLabel } from '../src/businessDays';
import { formatDisplayDate } from '../src/dateFormat';
import { ancestorTitles, parentMap } from '../src/hierarchy';
import { MessageKey, t } from '../src/i18n';
import type { PlannerItem } from '../src/model';
import { PRIORITY_COLORS, priorityLabel } from '../src/priority';
import { parseRepeat, repeatLabel } from '../src/repeat';
import { Lang, PlannerSettings, resolveStatus } from '../src/settings';
import { formatDate } from './dates';
import { progressElement } from './progress';

/** Everything the tooltip needs besides the item itself. */
export interface TooltipContext {
  items: PlannerItem[];
  settings: PlannerSettings;
  lang: Lang;
}

export interface TooltipOptions {
  /** Span to show instead of the item's own dates (derived parent bars). */
  span?: { start: string; end: string; derived: boolean };
  /** How to open the file from this view. */
  hint: MessageKey;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  e.className = className;
  e.append(...children);
  return e;
}

/** Shared item card for calendar and Gantt tooltips. */
export function itemTooltip(item: PlannerItem, ctx: TooltipContext, options: TooltipOptions): HTMLElement {
  const { settings, lang } = ctx;
  const tr = (key: MessageKey, ...args: (string | number)[]) => t(lang, key, ...args);
  const status = resolveStatus(item.status, settings.statuses);
  const color =
    item.type === 'event' ? settings.eventColor : item.type === 'holiday' ? settings.vacationColor : status.color;

  const card = el('div', 'tt-card');
  card.style.setProperty('--c', color);

  const ancestors = ancestorTitles(item, parentMap(ctx.items));
  if (ancestors.length) {
    card.append(el('div', 'tt-crumbs', [...ancestors].reverse().join(' › ')));
  }
  card.append(el('div', 'tt-title', el('span', 'tt-dot'), item.title));

  const chips = el('div', 'tt-chips', el('span', 'tt-chip', tr(`msg.type.${item.type}` as MessageKey)));
  if (item.type === 'task') {
    const pill = el('span', 'tt-chip tt-status', el('span', 'tt-dot'), status.label ?? status.name);
    pill.style.setProperty('--c', status.color);
    chips.append(pill);
    if (item.priority) {
      const flag = el('span', 'tt-chip tt-status', el('span', 'tt-dot'), priorityLabel(item.priority, lang));
      flag.style.setProperty('--c', PRIORITY_COLORS[item.priority]);
      chips.append(flag);
    }
  }
  card.append(chips);

  const start = options.span?.start ?? item.start ?? item.end;
  const end = options.span?.end ?? item.end ?? start;
  if (start && end) {
    const date = (v: string) => formatDisplayDate(v, settings.dateFormat, lang);
    const cal = businessCalendar(ctx.items, settings);
    const rows = el('dl', 'tt-rows');
    const row = (label: string, value: Node | string) => rows.append(el('dt', '', label), el('dd', '', value));
    let range: string;
    if (start.slice(0, 10) !== end.slice(0, 10)) {
      range = `${date(start)} – ${date(end)}`;
    } else if (end.length > 10 && end !== start) {
      range = `${date(start)} – ${end.slice(11)}`; // same day, e.g. "10/7 (水) 10:00 – 11:00"
    } else {
      range = date(start);
    }
    row(tr('tooltip.dates'), range + (options.span?.derived ? ` ${tr('tooltip.derived')}` : ''));
    const workdays = countBusinessDays(start.slice(0, 10), end.slice(0, 10), cal);
    row(tr('tooltip.span'), workdays === 1 ? tr('tooltip.workdays1') : tr('tooltip.workdays', workdays));
    const remaining = remainingBusinessDays(item, formatDate(new Date()), cal, settings);
    if (remaining) {
      row(tr('table.col.remaining'), el('span', `remaining ${remaining.kind}`, remainingLabel(remaining, lang)));
    }
    card.append(rows);
  }
  const repeat = parseRepeat(item.repeat);
  if (repeat) {
    const rows = card.querySelector('.tt-rows') ?? card.appendChild(el('dl', 'tt-rows'));
    rows.append(el('dt', '', tr('tooltip.repeat')), el('dd', '', repeatLabel(repeat, lang)));
  }
  const progress = progressElement(item);
  if (progress) {
    const rows = card.querySelector('.tt-rows') ?? card.appendChild(el('dl', 'tt-rows'));
    rows.append(el('dt', '', tr('tooltip.checklist')), el('dd', '', progress));
  }

  if (item.tags.length) {
    card.append(el('div', 'tt-tags', ...item.tags.map((tag) => el('span', 'tt-tag', tag))));
  }
  card.append(el('div', 'tt-foot', el('span', 'tt-path', item.path), el('span', 'tt-hint', tr(options.hint))));
  return card;
}

/**
 * One floating tooltip for the whole webview: shown after a short hover delay
 * next to the hovered element, hidden on leave, scroll, drag or click.
 */
class Tooltip {
  private readonly el = document.body.appendChild(el('div', 'mp-tooltip'));
  private timer: ReturnType<typeof setTimeout> | undefined;
  private anchor: Element | undefined;

  constructor() {
    this.el.setAttribute('role', 'tooltip');
    document.addEventListener('scroll', () => this.hide(), true);
    document.addEventListener('pointerdown', () => this.hide(), true);
    window.addEventListener('blur', () => this.hide());
  }

  /** Shows `build()` near `anchor` after a delay (immediately if a tooltip is already open). */
  hoverStart(anchor: Element, build: () => HTMLElement, at?: { x: number; y: number }): void {
    if (this.anchor === anchor) {
      return;
    }
    clearTimeout(this.timer);
    this.anchor = anchor;
    const delay = this.el.classList.contains('visible') ? 0 : 350;
    this.timer = setTimeout(() => this.show(anchor, build(), at), delay);
  }

  hoverEnd(anchor: Element): void {
    if (this.anchor === anchor) {
      this.hide();
    }
  }

  hide(): void {
    clearTimeout(this.timer);
    this.anchor = undefined;
    this.el.classList.remove('visible');
  }

  private show(anchor: Element, content: HTMLElement, at?: { x: number; y: number }): void {
    if (!anchor.isConnected) {
      return;
    }
    this.el.replaceChildren(content);
    const rect = anchor.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = this.el;
    const margin = 8;
    // Prefer below the element, aligned to the pointer (wide bars) or its left edge.
    const x = Math.min(Math.max(margin, (at?.x ?? rect.left) - 12), window.innerWidth - w - margin);
    let y = rect.bottom + 6;
    if (y + h > window.innerHeight - margin) {
      y = Math.max(margin, rect.top - h - 6);
    }
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.classList.add('visible');
  }
}

let instance: Tooltip | undefined;
export const tooltip = () => (instance ??= new Tooltip());
