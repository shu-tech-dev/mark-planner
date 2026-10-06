import { MessageKey, t } from '../src/i18n';
import type { ItemType, PlannerItem } from '../src/model';
import { Priority, PRIORITIES, PRIORITY_COLORS, priorityLabel } from '../src/priority';
import { Lang, PlannerSettings, resolveStatus } from '../src/settings';
import {
  allTags,
  buildTable,
  ColumnId,
  DEFAULT_QUERY,
  GroupBy,
  parentCandidates,
  TableQuery,
  TableRow,
} from '../src/table';
import { businessCalendar, remainingBusinessDays, remainingLabel, remainingSortKey, type Remaining } from '../src/businessDays';
import { formatDisplayDate } from '../src/dateFormat';
import { formatDate as isoDate } from './dates';
import { attachDatePicker, parseEditorText, toEditorText } from './datepicker';
import { icon } from './icons';
import { progressElement } from './progress';
import { closePopover, menuList, openPopover } from './menu';
import { post } from './vscode';

interface ColumnState {
  id: ColumnId;
  visible: boolean;
  width: number;
}

/** Persisted per workspace by the extension (see panel.ts). */
export interface TableState {
  query: TableQuery;
  columns: ColumnState[];
}

const DEFAULT_COLUMNS: ColumnState[] = [
  { id: 'title', visible: true, width: 320 },
  { id: 'type', visible: true, width: 96 },
  { id: 'status', visible: true, width: 128 },
  { id: 'priority', visible: true, width: 96 },
  { id: 'start', visible: true, width: 150 },
  { id: 'end', visible: true, width: 150 },
  { id: 'remaining', visible: true, width: 140 },
  { id: 'progress', visible: true, width: 130 },
  { id: 'tags', visible: true, width: 170 },
  { id: 'parent', visible: false, width: 170 },
  { id: 'depends', visible: false, width: 170 },
  { id: 'path', visible: false, width: 240 },
];
const TYPES: ItemType[] = ['task', 'event', 'holiday'];
const READ_ONLY: ColumnId[] = ['remaining', 'progress', 'depends', 'path'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  if (className) {
    e.className = className;
  }
  e.append(...children);
  return e;
}

function iconEl(name: string, className = 'ico'): HTMLElement {
  const span = el('span', className);
  span.innerHTML = icon(name);
  return span;
}

/** Restores saved state, tolerating older or hand-broken data. */
function sanitizeState(raw: unknown): TableState {
  const state = (raw ?? {}) as Partial<TableState>;
  const saved = Array.isArray(state.columns) ? state.columns : [];
  const columns: ColumnState[] = [];
  for (const c of saved) {
    const def = DEFAULT_COLUMNS.find((d) => d.id === c?.id);
    if (def && !columns.some((x) => x.id === def.id)) {
      columns.push({ id: def.id, visible: c.visible !== false, width: Number(c.width) || def.width });
    }
  }
  // Columns added in later versions go next to their default neighbor.
  DEFAULT_COLUMNS.forEach((def, i) => {
    if (!columns.some((c) => c.id === def.id)) {
      const after = columns.findIndex((c) => c.id === DEFAULT_COLUMNS[i - 1]?.id);
      columns.splice(after + 1, 0, { ...def });
    }
  });
  // The title column always stays visible.
  columns.find((c) => c.id === 'title')!.visible = true;
  return { query: { ...DEFAULT_QUERY, ...(state.query ?? {}) }, columns };
}

export class TableView {
  private state: TableState = sanitizeState(undefined);
  private items: PlannerItem[] = [];
  private settings!: PlannerSettings;
  private lang: Lang = 'ja';
  /** Re-render requested while a cell editor was open. */
  private deferred = false;
  private editing = false;

  private readonly toolbar = el('div', 'tbl-toolbar');
  private readonly wrap = el('div', 'tbl-wrap');

  constructor(private readonly root: HTMLElement) {
    root.append(this.toolbar, this.wrap);
  }

  setState(raw: unknown): void {
    this.state = sanitizeState(raw);
    this.render();
  }

  update(items: PlannerItem[], settings: PlannerSettings, lang: Lang): void {
    this.items = items;
    this.settings = settings;
    this.lang = lang;
    this.render();
  }

  private tr(key: MessageKey, ...args: (string | number)[]): string {
    return t(this.lang, key, ...args);
  }

  private save(): void {
    post({ type: 'saveTableState', state: this.state });
  }

  private setQuery(patch: Partial<TableQuery>): void {
    this.state.query = { ...this.state.query, ...patch };
    this.save();
    this.render();
  }

  private render(): void {
    if (!this.settings) {
      return;
    }
    if (this.editing) {
      this.deferred = true;
      return;
    }
    this.renderToolbar();
    this.renderTable();
  }

  // ---- toolbar ---------------------------------------------------------

  private renderToolbar(): void {
    const q = this.state.query;
    const search = el('label', 'tbl-search', iconEl('search'));
    const input = el('input');
    input.type = 'search';
    input.placeholder = this.tr('table.search');
    input.value = q.search;
    input.addEventListener('input', () => {
      this.state.query.search = input.value;
      this.save();
      this.renderTable();
    });
    search.append(input);

    const filterCount = q.types.length + q.statuses.length + q.tags.length;
    const filterBtn = this.toolButton('filter', this.tr('table.filter'), filterCount);
    filterBtn.addEventListener('click', () => openPopover(filterBtn, (close) => this.filterMenu(close)));

    const groupLabel = this.tr(`table.group.${q.group}` as MessageKey);
    const groupBtn = this.toolButton('group', groupLabel, 0, q.group !== 'none');
    groupBtn.addEventListener('click', () =>
      openPopover(groupBtn, (close) =>
        menuList(
          (['none', 'status', 'type'] as GroupBy[]).map((g) => ({
            label: this.tr(`table.group.${g}` as MessageKey),
            checked: q.group === g,
            onSelect: () => this.setQuery({ group: g }),
          })),
          close,
          this.tr('table.group'),
        ),
      ),
    );

    const colBtn = this.toolButton('columns', this.tr('table.columns'));
    colBtn.addEventListener('click', () => openPopover(colBtn, () => this.columnsMenu()));

    const count = el('span', 'tbl-count');
    count.id = 'tbl-count';
    this.toolbar.replaceChildren(search, filterBtn, groupBtn, colBtn, el('span', 'spacer'), count);
  }

  private toolButton(iconName: string, label: string, badge = 0, active = false): HTMLButtonElement {
    const b = el('button', `btn ghost tbl-tool${badge || active ? ' active' : ''}`, iconEl(iconName), label);
    if (badge) {
      b.append(el('span', 'badge', String(badge)));
    }
    return b;
  }

  private filterMenu(close: () => void): HTMLElement {
    const q = this.state.query;
    const toggle = (list: string[], value: string) =>
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    const box = el('div', 'menu-stack');
    box.append(
      menuList(
        TYPES.map((type) => ({
          label: this.tr(`msg.type.${type}` as MessageKey),
          checked: q.types.includes(type),
          keepOpen: true,
          onSelect: () => this.setQuery({ types: toggle(this.state.query.types, type) as ItemType[] }),
        })),
        close,
        this.tr('table.col.type'),
      ),
      menuList(
        this.settings.statuses.map((s) => ({
          label: s.label ?? s.name,
          color: s.color,
          checked: q.statuses.includes(s.name),
          keepOpen: true,
          onSelect: () => this.setQuery({ statuses: toggle(this.state.query.statuses, s.name) }),
        })),
        close,
        this.tr('table.col.status'),
      ),
    );
    const tags = allTags(this.items);
    if (tags.length) {
      box.append(
        menuList(
          tags.map((tag) => ({
            label: tag,
            checked: q.tags.includes(tag),
            keepOpen: true,
            onSelect: () => this.setQuery({ tags: toggle(this.state.query.tags, tag) }),
          })),
          close,
          this.tr('table.col.tags'),
        ),
      );
    }
    const clear = el('button', 'menu-item menu-clear', this.tr('table.filter.clear'));
    clear.addEventListener('click', () => {
      this.setQuery({ types: [], statuses: [], tags: [] });
      close();
    });
    box.append(clear);
    return box;
  }

  private columnsMenu(): HTMLElement {
    const list = el('div', 'menu');
    list.append(el('div', 'menu-title', this.tr('table.columns')));
    const cols = this.state.columns;
    const rebuild = () => list.replaceWith(this.columnsMenu());
    cols.forEach((col, i) => {
      const row = el('div', 'menu-item col-item');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = col.visible;
      box.disabled = col.id === 'title';
      box.addEventListener('change', () => {
        col.visible = box.checked;
        this.save();
        this.renderTable();
      });
      const label = el('label', 'col-label', box, this.tr(`table.col.${col.id}` as MessageKey));
      const move = (to: number, name: string, title: MessageKey) => {
        const b = el('button', 'btn icon ghost tiny', iconEl(name));
        b.title = this.tr(title);
        b.disabled = to < 0 || to >= cols.length;
        b.addEventListener('click', () => {
          [cols[i], cols[to]] = [cols[to], cols[i]];
          this.save();
          this.renderTable();
          rebuild();
        });
        return b;
      };
      row.append(label, move(i - 1, 'arrow-up', 'table.columns.left'), move(i + 1, 'arrow-down', 'table.columns.right'));
      list.append(row);
    });
    return list;
  }

  // ---- table -----------------------------------------------------------

  /** Remaining business days per item, recomputed on each render (today may change). */
  private remaining = new Map<PlannerItem, Remaining | undefined>();

  private renderTable(): void {
    const columns = this.state.columns.filter((c) => c.visible);
    const cal = businessCalendar(this.items, this.settings);
    const today = isoDate(new Date());
    this.remaining = new Map(
      this.items.map((i) => [i, remainingBusinessDays(i, today, cal, this.settings)] as const),
    );
    const groups = buildTable(
      this.items,
      this.state.query,
      this.settings.statuses,
      (i) => remainingSortKey(this.remaining.get(i)),
      this.settings.hideDone,
    );
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    const count = document.getElementById('tbl-count');
    if (count) {
      count.textContent = this.tr('table.count', total);
    }

    const table = el('table', 'tbl');
    const colgroup = el('colgroup');
    for (const c of columns) {
      const col = el('col');
      col.style.width = `${c.width}px`;
      colgroup.append(col);
    }
    table.style.width = `${columns.reduce((w, c) => w + c.width, 0)}px`;

    const headRow = el('tr');
    for (const c of columns) {
      headRow.append(this.headerCell(c, table, colgroup));
    }
    const tbody = el('tbody');
    for (const group of groups) {
      if (this.state.query.group !== 'none') {
        tbody.append(this.groupRow(group.key, group.rows.length, columns.length));
      }
      for (const row of group.rows) {
        tbody.append(this.bodyRow(row, columns));
      }
    }
    if (total === 0) {
      const tr = el('tr', 'tbl-empty');
      const td = el('td', undefined, this.tr('table.empty'));
      td.colSpan = columns.length;
      tr.append(td);
      tbody.append(tr);
    }
    tbody.append(this.newRow(columns.length));
    table.append(colgroup, el('thead', undefined, headRow), tbody);
    this.wrap.replaceChildren(table);
  }

  private headerCell(col: ColumnState, table: HTMLTableElement, colgroup: HTMLElement): HTMLElement {
    const sort = this.state.query.sort;
    const th = el('th');
    const button = el('button', 'th-btn', this.tr(`table.col.${col.id}` as MessageKey));
    if (sort?.column === col.id) {
      button.append(iconEl(sort.dir === 'asc' ? 'arrow-up' : 'arrow-down', 'ico sort'));
      th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
    }
    // Cycle: ascending → descending → unsorted.
    button.addEventListener('click', () => {
      const next =
        sort?.column !== col.id
          ? { column: col.id, dir: 'asc' as const }
          : sort.dir === 'asc'
            ? { column: col.id, dir: 'desc' as const }
            : undefined;
      this.setQuery({ sort: next });
    });
    const handle = el('span', 'resize');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = col.width;
      const index = this.state.columns.filter((c) => c.visible).indexOf(col);
      const colEl = colgroup.children[index] as HTMLElement;
      const move = (ev: PointerEvent) => {
        col.width = Math.max(60, Math.round(startWidth + ev.clientX - startX));
        colEl.style.width = `${col.width}px`;
        table.style.width = `${this.state.columns.filter((c) => c.visible).reduce((w, c) => w + c.width, 0)}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        this.save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    th.append(button, handle);
    return th;
  }

  private groupRow(key: string, count: number, span: number): HTMLElement {
    const td = el('td');
    td.colSpan = span;
    const label = el('span', 'group-label');
    if (this.state.query.group === 'status') {
      const status = this.settings.statuses.find((s) => s.name === key);
      if (status) {
        label.append(this.statusPill(status.name));
      } else {
        label.append(this.tr('table.noStatus'));
      }
    } else {
      label.append(this.tr(`msg.type.${key}` as MessageKey));
    }
    td.append(label, el('span', 'group-count', String(count)));
    return el('tr', 'group-row', td);
  }

  private bodyRow(row: TableRow, columns: ColumnState[]): HTMLElement {
    const tr = el('tr', 'tbl-row');
    for (const c of columns) {
      const td = el('td', `cell cell-${c.id}`);
      if (!READ_ONLY.includes(c.id)) {
        td.classList.add('editable');
      }
      this.fillCell(td, c.id, row);
      tr.append(td);
    }
    return tr;
  }

  private newRow(span: number): HTMLElement {
    const td = el('td');
    td.colSpan = span;
    const input = el('input', 'new-input');
    input.placeholder = this.tr('table.newRow');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        post({ type: 'createQuick', title: input.value.trim() });
        input.value = '';
      }
    });
    td.append(el('label', 'new-row', iconEl('plus'), input));
    return el('tr', 'tbl-new', td);
  }

  // ---- cells -----------------------------------------------------------

  private patch(item: PlannerItem, field: string, value: unknown): void {
    post({ type: 'patch', key: item.key, field, value });
  }

  private fillCell(td: HTMLElement, column: ColumnId, row: TableRow): void {
    const { item } = row;
    switch (column) {
      case 'title': {
        const inner = el('div', 'title-cell');
        inner.style.paddingLeft = `${row.depth * 20}px`;
        if (row.hasChildren) {
          const toggle = el('button', `toggle${row.collapsed ? ' collapsed' : ''}`, iconEl('chevron-down'));
          toggle.title = this.tr('table.toggle');
          toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const collapsed = new Set(this.state.query.collapsed);
            if (collapsed.has(item.key)) {
              collapsed.delete(item.key);
            } else {
              collapsed.add(item.key);
            }
            this.setQuery({ collapsed: [...collapsed] });
          });
          inner.append(toggle);
        } else {
          inner.append(el('span', 'toggle-space'));
        }
        const text = el('span', `title-text${row.hasChildren ? ' parent' : ''}`, item.title);
        const open = el('button', 'open-btn', iconEl('open'), this.tr('table.open'));
        open.addEventListener('click', (e) => {
          e.stopPropagation();
          post({ type: 'open', key: item.key });
        });
        inner.append(text, open);
        td.append(inner);
        td.addEventListener('click', () => this.textEditor(td, item.title, (v) => this.patch(item, 'title', v)));
        break;
      }
      case 'type':
        td.append(el('span', `type-chip type-${item.type}`, this.tr(`msg.type.${item.type}` as MessageKey)));
        td.addEventListener('click', () =>
          openPopover(td, (close) =>
            menuList(
              TYPES.map((type) => ({
                label: this.tr(`msg.type.${type}` as MessageKey),
                checked: item.type === type,
                onSelect: () => this.patch(item, 'type', type),
              })),
              close,
            ),
          ),
        );
        break;
      case 'status':
        if (item.type !== 'task') {
          td.classList.remove('editable');
          td.append(el('span', 'muted', '—'));
          break;
        }
        td.append(this.statusPill(item.status));
        td.addEventListener('click', () =>
          openPopover(td, (close) =>
            menuList(
              this.settings.statuses.map((s) => ({
                label: s.label ?? s.name,
                color: s.color,
                checked: resolveStatus(item.status, this.settings.statuses).name === s.name,
                onSelect: () => this.patch(item, 'status', s.name),
              })),
              close,
            ),
          ),
        );
        break;
      case 'priority':
        if (item.type !== 'task') {
          td.classList.remove('editable');
          td.append(el('span', 'muted', '—'));
          break;
        }
        td.append(item.priority ? this.priorityFlag(item.priority) : el('span', 'muted', '—'));
        td.addEventListener('click', () =>
          openPopover(td, (close) =>
            menuList(
              [
                ...PRIORITIES.map((p) => ({
                  label: priorityLabel(p, this.lang),
                  color: PRIORITY_COLORS[p],
                  checked: item.priority === p,
                  onSelect: () => this.patch(item, 'priority', p),
                })),
                { label: this.tr('priority.none'), checked: !item.priority, onSelect: () => this.patch(item, 'priority', '') },
              ],
              close,
            ),
          ),
        );
        break;
      case 'start':
      case 'end': {
        const value = item[column];
        td.append(value ? el('span', 'date', this.formatDate(value)) : el('span', 'muted', '—'));
        td.addEventListener('click', () => this.dateEditor(td, item, column));
        break;
      }
      case 'tags':
        td.append(el('span', 'tags', ...item.tags.map((tag) => el('span', 'tag', tag))));
        td.addEventListener('click', () =>
          this.textEditor(td, item.tags.join(', '), (v) => this.patch(item, 'tags', v), true),
        );
        break;
      case 'parent': {
        const parent = item.parent ? this.items.find((i) => i.id === item.parent) : undefined;
        td.append(parent ? el('span', 'ref', parent.title) : el('span', 'muted', item.parent ?? '—'));
        td.addEventListener('click', () =>
          openPopover(td, (close) =>
            menuList(
              [
                { label: this.tr('table.noParent'), checked: !item.parent, onSelect: () => this.patch(item, 'parent', '') },
                ...parentCandidates(item, this.items).map((p) => ({
                  label: p.title,
                  checked: item.parent === p.id,
                  onSelect: () => this.patch(item, 'parent', p.id),
                })),
              ],
              close,
            ),
          ),
        );
        break;
      }
      case 'remaining': {
        const r = this.remaining.get(item);
        td.append(r ? el('span', `remaining ${r.kind}`, remainingLabel(r, this.lang)) : el('span', 'muted', '—'));
        break;
      }
      case 'progress': {
        const progress = progressElement(item);
        td.append(progress ?? el('span', 'muted', '—'));
        break;
      }
      case 'depends': {
        const names = item.depends.map((id) => this.items.find((i) => i.id === id)?.title ?? id);
        td.append(names.length ? el('span', 'ref', names.join(', ')) : el('span', 'muted', '—'));
        break;
      }
      case 'path':
        td.append(el('span', 'muted path', item.path));
        td.addEventListener('click', () => post({ type: 'open', key: item.key }));
        break;
    }
  }

  private statusPill(name: string): HTMLElement {
    const status = resolveStatus(name, this.settings.statuses);
    const pill = el('span', 'status-pill', el('span', 'dot'), status.label ?? status.name);
    pill.style.setProperty('--c', status.color);
    return pill;
  }

  private priorityFlag(priority: Priority): HTMLElement {
    const flag = el('span', 'priority-flag', iconEl('flag'), `P${priority}`);
    flag.style.setProperty('--c', PRIORITY_COLORS[priority]);
    flag.title = priorityLabel(priority, this.lang);
    return flag;
  }

  private formatDate(value: string): string {
    return formatDisplayDate(value, this.settings.dateFormat, this.lang);
  }

  // ---- editors ---------------------------------------------------------

  /**
   * Replaces the cell content with an input; commits on Enter/blur, cancels on Escape.
   * With `validate`, Enter on an invalid value keeps the editor open (marked invalid)
   * and blur discards it. `setup` may attach extras and returns their cleanup.
   */
  private openEditor(
    td: HTMLElement,
    input: HTMLInputElement,
    commit: (value: string) => void,
    options: { validate?: (value: string) => boolean; setup?: (finish: () => void) => () => void } = {},
  ): void {
    if (this.editing) {
      return;
    }
    closePopover();
    this.editing = true;
    const original = input.value;
    let done = false;
    let cleanup = () => {};
    const valid = () => !options.validate || options.validate(input.value);
    const finish = (save: boolean) => {
      if (done) {
        return;
      }
      done = true;
      this.editing = false;
      cleanup();
      if (save && valid() && input.value !== original) {
        commit(input.value);
      }
      // Re-render from the latest items (the write comes back as an items update).
      this.deferred = false;
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (valid()) {
          finish(true);
        } else {
          td.classList.add('invalid');
        }
      } else if (e.key === 'Escape') {
        finish(false);
      }
    });
    input.addEventListener('input', () => td.classList.remove('invalid'));
    input.addEventListener('blur', () => finish(true));
    td.classList.add('editing');
    td.replaceChildren(input);
    input.focus();
    input.select?.();
    if (options.setup) {
      cleanup = options.setup(() => finish(true));
    }
  }

  private textEditor(td: HTMLElement, value: string, commit: (value: string) => void, isList = false): void {
    const input = el('input', 'cell-input');
    input.value = value;
    if (isList) {
      input.placeholder = 'a, b, c';
    }
    this.openEditor(td, input, commit);
  }

  /** `YYYY/MM/DD` (or `YYYY/MM/DD HH:mm`) text input with a calendar popup. */
  private dateEditor(td: HTMLElement, item: PlannerItem, field: 'start' | 'end'): void {
    const value = item[field];
    const other = item[field === 'start' ? 'end' : 'start'];
    // Timed when this value (or, if empty, the other date) has a time.
    const timed = (value ?? other ?? '').length > 10;
    const input = el('input', 'cell-input mono');
    input.value = toEditorText(value);
    input.placeholder = timed ? 'YYYY/MM/DD HH:mm' : 'YYYY/MM/DD';
    input.spellcheck = false;
    this.openEditor(td, input, (v) => this.patch(item, field, parseEditorText(v)), {
      validate: (v) => parseEditorText(v) !== undefined,
      setup: (finish) => attachDatePicker(input, this.settings, this.lang, finish),
    });
  }
}
