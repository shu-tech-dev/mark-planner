import { MessageKey, t } from '../src/i18n';
import { DEFAULT_PROPERTY_MAP, PropertyMap } from '../src/model';
import { Lang, PlannerSettings, SettingKey, StatusDef } from '../src/settings';
import { post } from './vscode';

type Attrs = Record<string, string | number | boolean | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) {
      continue;
    }
    if (name in el && typeof value !== 'string') {
      (el as unknown as Record<string, unknown>)[name] = value;
    } else {
      el.setAttribute(name, String(value));
    }
  }
  el.append(...children);
  return el;
}

const save = (key: SettingKey, value: unknown) => post({ type: 'updateSetting', key, value });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A control bound to one setting; `fill` updates it unless the user is editing it. */
interface Binding {
  key: SettingKey;
  fill(settings: PlannerSettings): void;
}

export class SettingsView {
  private lang: Lang | undefined;
  private bindings: Binding[] = [];
  private resetButtons = new Map<SettingKey, HTMLButtonElement>();
  private targetNote!: HTMLElement;

  constructor(private readonly root: HTMLElement) {}

  update(settings: PlannerSettings, defaults: PlannerSettings, lang: Lang, target: 'workspace' | 'user'): void {
    if (lang !== this.lang) {
      this.lang = lang;
      this.build(defaults);
    }
    this.targetNote.textContent = t(lang, target === 'workspace' ? 'settings.savedTo.workspace' : 'settings.savedTo.user');
    for (const binding of this.bindings) {
      binding.fill(settings);
    }
    for (const [key, button] of this.resetButtons) {
      button.disabled = same(settings[key], defaults[key]);
    }
  }

  private tr(key: MessageKey): string {
    return t(this.lang!, key);
  }

  private build(defaults: PlannerSettings): void {
    this.bindings = [];
    this.resetButtons.clear();
    this.targetNote = h('p', { class: 'note' });
    this.root.replaceChildren(
      h(
        'div',
        { class: 'settings' },
        this.targetNote,
        this.section(
          'settings.section.files',
          this.textField('include', 'settings.include', defaults),
          this.textField('exclude', 'settings.exclude', defaults, { allowEmpty: true }),
        ),
        this.section(
          'settings.section.newItem',
          this.textField('newItemFolder', 'settings.newItemFolder', defaults),
          this.textareaField('template.body', 'settings.template.body'),
          this.jsonField('template.frontmatter', 'settings.template.frontmatter'),
        ),
        this.section('settings.section.properties', h('p', { class: 'help' }, this.tr('settings.properties.help')), this.propertiesField()),
        this.section(
          'settings.section.statuses',
          h('p', { class: 'help' }, this.tr('settings.statuses.help')),
          this.statusesField(),
          this.colorField('eventColor', 'settings.eventColor'),
        ),
        this.section(
          'settings.section.display',
          this.selectField('theme', 'settings.theme', [
            ['auto', this.tr('settings.theme.auto')],
            ['light', this.tr('settings.theme.light')],
            ['dark', this.tr('settings.theme.dark')],
          ]),
          this.selectField('calendarView', 'settings.calendarView', [
            ['month', this.tr('settings.calendarView.month')],
            ['week', this.tr('settings.calendarView.week')],
            ['day', this.tr('settings.calendarView.day')],
          ]),
          this.selectField(
            'weekStart',
            'settings.weekStart',
            [0, 1, 2, 3, 4, 5, 6].map((d) => [d, this.tr(`weekday.${d}` as MessageKey)]),
          ),
          this.selectField('ganttViewMode', 'settings.ganttViewMode', [
            ['Day', this.tr('settings.ganttViewMode.Day')],
            ['Week', this.tr('settings.ganttViewMode.Week')],
            ['Month', this.tr('settings.ganttViewMode.Month')],
          ]),
          this.checkboxField('hideDone', 'settings.hideDone'),
          this.numberField('maxEventsPerDay', 'settings.maxEventsPerDay', 0, 99),
        ),
        this.section(
          'settings.section.holidays',
          h('p', { class: 'help' }, this.tr('settings.holidays.help')),
          this.weekendColorsField('weekendColors', 'settings.weekendColors', defaults),
          this.checkboxField('showHolidays', 'settings.showHolidays'),
          this.colorField('holidayColor', 'settings.holidayColor'),
          this.colorField('vacationColor', 'settings.vacationColor'),
        ),
        this.section(
          'settings.section.language',
          this.selectField('language', 'settings.language', [
            ['auto', this.tr('settings.language.auto')],
            ['ja', this.tr('settings.language.ja')],
            ['en', this.tr('settings.language.en')],
          ]),
        ),
      ),
    );
  }

  // ---- layout helpers ----

  private section(title: MessageKey, ...content: Node[]): HTMLElement {
    return h('section', {}, h('h2', {}, this.tr(title)), ...content);
  }

  /** `label: null` lets the control span the label column (for table-like controls). */
  private row(key: SettingKey, label: MessageKey | null, control: HTMLElement, error?: HTMLElement): HTMLElement {
    const reset = h('button', { class: 'reset', title: this.tr('settings.reset'), 'aria-label': this.tr('settings.reset') }, '↺');
    reset.addEventListener('click', () => save(key, undefined));
    this.resetButtons.set(key, reset);
    const id = `setting-${key}`;
    control.id = id;
    const body = h('div', { class: label ? 'control' : 'control wide' }, control, ...(error ? [error] : []));
    return h('div', { class: 'row' }, ...(label ? [h('label', { for: id }, this.tr(label))] : []), body, reset);
  }

  private bind(key: SettingKey, el: HTMLElement, fill: (settings: PlannerSettings) => void): void {
    this.bindings.push({
      key,
      fill: (settings) => {
        if (!el.contains(document.activeElement)) {
          fill(settings);
        }
      },
    });
  }

  // ---- field types ----

  private textField(key: SettingKey, label: MessageKey, defaults: PlannerSettings, opts: { allowEmpty?: boolean } = {}) {
    const input = h('input', { type: 'text', placeholder: String(defaults[key]), spellcheck: false });
    input.addEventListener('change', () => {
      const value = input.value.trim();
      save(key, value || opts.allowEmpty ? value : undefined);
    });
    this.bind(key, input, (s) => (input.value = String(s[key])));
    return this.row(key, label, input);
  }

  private textareaField(key: SettingKey, label: MessageKey) {
    const textarea = h('textarea', { rows: 4, spellcheck: false });
    textarea.addEventListener('change', () => save(key, textarea.value || undefined));
    this.bind(key, textarea, (s) => (textarea.value = String(s[key])));
    return this.row(key, label, textarea);
  }

  private jsonField(key: SettingKey, label: MessageKey) {
    const textarea = h('textarea', { rows: 3, spellcheck: false, class: 'mono' });
    const error = h('p', { class: 'error', hidden: true }, this.tr('settings.invalidJson'));
    textarea.addEventListener('change', () => {
      const text = textarea.value.trim();
      if (!text) {
        error.hidden = true;
        save(key, undefined);
        return;
      }
      try {
        const value = JSON.parse(text);
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error('not an object');
        }
        error.hidden = true;
        save(key, value);
      } catch {
        error.hidden = false;
      }
    });
    this.bind(key, textarea, (s) => {
      const value = s[key] as Record<string, unknown>;
      textarea.value = Object.keys(value).length ? JSON.stringify(value, null, 2) : '';
      error.hidden = true;
    });
    return this.row(key, label, textarea, error);
  }

  private colorField(key: SettingKey, label: MessageKey) {
    const input = h('input', { type: 'color' });
    input.addEventListener('change', () => save(key, input.value));
    this.bind(key, input, (s) => (input.value = String(s[key])));
    return this.row(key, label, input);
  }

  private selectField(key: SettingKey, label: MessageKey, options: [string | number, string][]) {
    const select = h('select', {}, ...options.map(([value, text]) => h('option', { value: String(value) }, text)));
    select.addEventListener('change', () => {
      const option = options.find(([value]) => String(value) === select.value)!;
      save(key, option[0]);
    });
    this.bind(key, select, (s) => (select.value = String(s[key])));
    return this.row(key, label, select);
  }

  private numberField(key: SettingKey, label: MessageKey, min: number, max: number) {
    const input = h('input', { type: 'number', min, max, step: 1, class: 'narrow' });
    input.addEventListener('change', () => {
      const value = Math.round(Number(input.value));
      save(key, Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined);
    });
    this.bind(key, input, (s) => (input.value = String(s[key])));
    return this.row(key, label, input);
  }

  private checkboxField(key: SettingKey, label: MessageKey) {
    const input = h('input', { type: 'checkbox' });
    input.addEventListener('change', () => save(key, input.checked));
    this.bind(key, input, (s) => (input.checked = s[key] === true));
    return this.row(key, label, input);
  }

  /**
   * One "day off" checkbox and color per weekday, starting from the configured
   * first day of the week. Unchecked days keep their last color for re-enabling.
   */
  private weekendColorsField(key: SettingKey, label: MessageKey, defaults: PlannerSettings) {
    const days = [0, 1, 2, 3, 4, 5, 6];
    const colors = new Map(days.map((d) => [d, defaults.weekendColors[String(d)] ?? '#888888']));
    const boxes = new Map<number, HTMLInputElement>();
    const pickers = new Map<number, HTMLInputElement>();
    const group = h('div', { class: 'weekdays', role: 'group' });

    const commit = () =>
      save(
        key,
        Object.fromEntries(days.filter((d) => boxes.get(d)!.checked).map((d) => [String(d), pickers.get(d)!.value])),
      );
    for (const d of days) {
      const box = h('input', { type: 'checkbox', 'aria-label': this.tr(`weekday.${d}` as MessageKey) });
      const picker = h('input', { type: 'color', value: colors.get(d) });
      box.addEventListener('change', () => {
        picker.disabled = !box.checked;
        commit();
      });
      picker.addEventListener('change', () => {
        colors.set(d, picker.value);
        commit();
      });
      boxes.set(d, box);
      pickers.set(d, picker);
    }
    const layout = (first: number) =>
      group.replaceChildren(
        ...days
          .map((i) => (first + i) % 7)
          .map((d) => h('label', {}, boxes.get(d)!, this.tr(`weekday.${d}` as MessageKey), pickers.get(d)!)),
      );
    layout(0);
    this.bind(key, group, (s) => {
      layout(s.weekStart);
      const current = s[key] as Record<string, string>;
      for (const d of days) {
        const color = current[String(d)];
        if (color) {
          colors.set(d, color);
        }
        boxes.get(d)!.checked = !!color;
        pickers.get(d)!.value = colors.get(d)!;
        pickers.get(d)!.disabled = !color;
      }
    });
    return this.row(key, label, group);
  }

  /** One input per frontmatter key; only non-default names are stored. */
  private propertiesField() {
    const keys = Object.keys(DEFAULT_PROPERTY_MAP) as (keyof PropertyMap)[];
    const inputs = new Map<keyof PropertyMap, HTMLInputElement>();
    const grid = h('div', { class: 'properties' });
    for (const prop of keys) {
      const input = h('input', { type: 'text', placeholder: DEFAULT_PROPERTY_MAP[prop], spellcheck: false });
      input.addEventListener('change', () => {
        const overrides: Partial<PropertyMap> = {};
        for (const [p, el] of inputs) {
          const value = el.value.trim();
          if (value && value !== DEFAULT_PROPERTY_MAP[p]) {
            overrides[p] = value;
          }
        }
        save('properties', Object.keys(overrides).length ? overrides : undefined);
      });
      inputs.set(prop, input);
      grid.append(h('label', {}, h('code', {}, prop), ' →'), input);
    }
    this.bind('properties', grid, (s) => {
      for (const [prop, input] of inputs) {
        input.value = s.properties[prop] === DEFAULT_PROPERTY_MAP[prop] ? '' : s.properties[prop];
      }
    });
    return this.row('properties', null, grid);
  }

  private statusesField() {
    const body = h('tbody');
    const error = h('p', { class: 'error', hidden: true }, this.tr('settings.status.invalid'));
    let rendered: StatusDef[] = [];

    const collect = (): StatusDef[] =>
      [...body.rows].map((tr) => {
        const get = (name: string) => tr.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
        const label = get('label').value.trim();
        return {
          name: get('name').value.trim(),
          ...(label ? { label } : {}),
          color: get('color').value,
          progress: Math.min(100, Math.max(0, Math.round(Number(get('progress').value) || 0))),
          done: get('done').checked,
        };
      });

    const commit = (statuses: StatusDef[]) => {
      const names = statuses.map((s) => s.name);
      if (names.some((n) => !n) || new Set(names).size !== names.length) {
        error.hidden = false;
        return;
      }
      error.hidden = true;
      rendered = statuses;
      save('statuses', statuses);
    };

    const render = (statuses: StatusDef[]) => {
      rendered = statuses;
      body.replaceChildren(
        ...statuses.map((s, i) => {
          const button = (text: string, label: MessageKey, disabled: boolean, onClick: () => void) => {
            const b = h('button', { class: 'icon', title: this.tr(label), 'aria-label': this.tr(label), disabled }, text);
            b.addEventListener('click', onClick);
            return b;
          };
          const move = (to: number) => () => {
            const next = [...collect()];
            [next[i], next[to]] = [next[to], next[i]];
            render(next);
            commit(next);
          };
          return h(
            'tr',
            {},
            h('td', {}, h('input', { type: 'text', name: 'name', value: s.name, spellcheck: false })),
            h('td', {}, h('input', { type: 'text', name: 'label', value: s.label ?? '' })),
            h('td', {}, h('input', { type: 'color', name: 'color', value: s.color })),
            h('td', {}, h('input', { type: 'number', name: 'progress', min: 0, max: 100, step: 10, value: s.progress })),
            h('td', { class: 'center' }, h('input', { type: 'checkbox', name: 'done', checked: s.done })),
            h(
              'td',
              { class: 'actions' },
              button('↑', 'settings.status.up', i === 0, move(i - 1)),
              button('↓', 'settings.status.down', i === statuses.length - 1, move(i + 1)),
              button('✕', 'settings.status.remove', statuses.length === 1, () => {
                const next = collect().filter((_, j) => j !== i);
                render(next);
                commit(next);
              }),
            ),
          );
        }),
      );
    };

    body.addEventListener('change', () => commit(collect()));
    const add = h('button', { class: 'secondary' }, this.tr('settings.status.add'));
    add.addEventListener('click', () => {
      const current = collect();
      let n = current.length + 1;
      while (current.some((s) => s.name === `status${n}`)) {
        n++;
      }
      const next = [...current, { name: `status${n}`, color: '#888888', progress: 0, done: false }];
      render(next);
      commit(next);
    });

    const table = h(
      'table',
      { class: 'statuses' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...(['settings.status.name', 'settings.status.label', 'settings.status.color', 'settings.status.progress', 'settings.status.done'] as const).map(
            (k) => h('th', {}, this.tr(k)),
          ),
          h('th'),
        ),
      ),
      body,
    );
    const wrapper = h('div', {}, table, error, add);
    this.bind('statuses', wrapper, (s) => {
      if (!same(s.statuses, rendered)) {
        error.hidden = true;
        render(s.statuses);
      }
    });
    return this.row('statuses', null, wrapper);
  }
}
