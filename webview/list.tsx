import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { deadlineOf } from '../src/businessDays';
import { formatDisplayDate } from '../src/dateFormat';
import { ancestorTitles, parentMap } from '../src/hierarchy';
import { MessageKey, t } from '../src/i18n';
import { buildList, ListSectionId, toggleStatus } from '../src/list';
import type { PlannerItem } from '../src/model';
import { Lang, PlannerSettings, resolveStatus } from '../src/settings';
import { addDays, formatDate } from './dates';
import { icon } from './icons';
import { itemTooltip, tooltip } from './tooltip';
import { post } from './vscode';

/** Persisted per workspace by the extension (see panel.ts). */
export interface ListState {
  showCompleted: boolean;
}

interface ListProps {
  items: PlannerItem[];
  settings: PlannerSettings;
  lang: Lang;
  state: ListState;
  onState: (state: ListState) => void;
}

/** How long a just-checked task stays (struck through) before leaving its section. */
const CHECK_LINGER_MS = 900;

/** Sections offering "Add task", and the start date given to new tasks there. */
const ADD_DATE: Partial<Record<ListSectionId, (today: string) => string | undefined>> = {
  today: (today) => today,
  tomorrow: (today) => addDays(today, 1),
  noDate: () => undefined,
};

function Icon({ name }: { name: string }) {
  return <span class="ico" dangerouslySetInnerHTML={{ __html: icon(name) }} />;
}

function TaskList({ items, settings, lang, state, onState }: ListProps) {
  const tr = (key: MessageKey, ...args: (string | number)[]) => t(lang, key, ...args);
  const today = formatDate(new Date());
  // Optimistic status changes until the write comes back as an items update.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [lingering, setLingering] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setPending((p) => {
      const next = { ...p };
      for (const item of items) {
        if (next[item.key] === item.status) {
          delete next[item.key];
        }
      }
      return Object.keys(next).length === Object.keys(p).length ? p : next;
    });
  }, [items]);

  const shown = useMemo(
    () => items.map((i) => (pending[i.key] ? { ...i, status: pending[i.key] } : i)),
    [items, pending],
  );
  const sections = useMemo(
    () =>
      buildList(shown, today, {
        statuses: settings.statuses,
        weekStart: settings.weekStart,
        showCompleted: state.showCompleted,
        keepOpen: lingering,
      }),
    [shown, today, settings, state.showCompleted, lingering],
  );
  const parents = useMemo(() => parentMap(shown), [shown]);
  const canComplete = settings.statuses.some((s) => s.done);

  const toggle = (item: PlannerItem, done: boolean) => {
    const status = toggleStatus(done, settings.statuses);
    if (!status) {
      return;
    }
    tooltip().hide();
    setPending((p) => ({ ...p, [item.key]: status }));
    post({ type: 'patch', key: item.key, field: 'status', value: status });
    clearTimeout(timers.current.get(item.key));
    if (done && !state.showCompleted) {
      setLingering((s) => new Set(s).add(item.key));
      timers.current.set(
        item.key,
        setTimeout(() => {
          setLingering((s) => {
            const next = new Set(s);
            next.delete(item.key);
            return next;
          });
        }, CHECK_LINGER_MS),
      );
    }
  };

  const visible = sections.filter((s) => s.items.length > 0 || s.id === 'today');
  const openCount = sections.filter((s) => s.id !== 'completed').reduce((n, s) => n + s.items.length, 0);

  return (
    <div class="tlist">
      <div class="tl-toolbar">
        <label class="switch">
          <input
            type="checkbox"
            checked={state.showCompleted}
            onChange={(e) => onState({ ...state, showCompleted: (e.currentTarget as HTMLInputElement).checked })}
          />
          <span class="switch-track" />
          {tr('list.showCompleted')}
        </label>
      </div>
      {visible.map((section) => (
        <section class={`tl-section tl-${section.id}`} key={section.id}>
          <header class="tl-head">
            <h2>{tr(`list.${section.id}` as MessageKey)}</h2>
            {section.id === 'today' && (
              <span class="tl-date">{formatDisplayDate(today, 'M月D日(ddd)', lang)}</span>
            )}
            <span class="tl-count">{section.items.length || ''}</span>
          </header>
          <ul class="tl-items">
            {section.items.map((item) => (
              <Row
                key={item.key}
                item={item}
                section={section.id}
                ancestors={ancestorTitles(item, parents)}
                {...{ settings, lang, items, today, canComplete }}
                onToggle={(done) => toggle(item, done)}
              />
            ))}
          </ul>
          {section.id === 'today' && openCount === 0 && <p class="tl-empty">{tr('list.allDone')}</p>}
          {ADD_DATE[section.id] && <AddTask tr={tr} start={ADD_DATE[section.id]!(today)} />}
        </section>
      ))}
      {!visible.some((s) => s.id === 'noDate') && (
        <section class="tl-section tl-noDate">
          <header class="tl-head">
            <h2>{tr('list.noDate')}</h2>
          </header>
          <AddTask tr={tr} start={undefined} />
        </section>
      )}
    </div>
  );
}

interface RowProps {
  item: PlannerItem;
  section: ListSectionId;
  ancestors: string[];
  settings: PlannerSettings;
  lang: Lang;
  items: PlannerItem[];
  today: string;
  canComplete: boolean;
  onToggle: (done: boolean) => void;
}

function Row({ item, section, ancestors, settings, lang, items, today, canComplete, onToggle }: RowProps) {
  const status = resolveStatus(item.status, settings.statuses);
  const done = status.done;
  return (
    <li
      class={`tl-row${done ? ' done' : ''}`}
      tabIndex={0}
      onClick={() => post({ type: 'open', key: item.key })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          post({ type: 'open', key: item.key });
        }
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as Element;
        tooltip().hoverStart(el, () => itemTooltip(item, { items, settings, lang }, { hint: 'tooltip.openClick' }), {
          x: e.clientX,
          y: e.clientY,
        });
      }}
      onMouseLeave={(e) => tooltip().hoverEnd(e.currentTarget as Element)}
    >
      <button
        class="tl-check"
        style={{ '--c': status.color }}
        disabled={!canComplete}
        aria-pressed={done}
        title={t(lang, done ? 'list.uncheck' : 'list.check')}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(!done);
        }}
      >
        <Icon name="check" />
      </button>
      <div class="tl-main">
        <div class="tl-title">{item.title}</div>
        {ancestors.length > 0 && <div class="tl-crumbs">{[...ancestors].reverse().join(' › ')}</div>}
      </div>
      <div class="tl-side">
        {item.tags.map((tag) => (
          <span class="tag" key={tag}>
            {tag}
          </span>
        ))}
        <DueChip item={item} section={section} settings={settings} lang={lang} today={today} />
      </div>
    </li>
  );
}

/** "Today" / "Tomorrow" / weekday this week / formatted date, colored by urgency. */
function DueChip({
  item,
  section,
  settings,
  lang,
  today,
}: {
  item: PlannerItem;
  section: ListSectionId;
  settings: PlannerSettings;
  lang: Lang;
  today: string;
}) {
  const deadline = deadlineOf(item);
  if (!deadline) {
    return null;
  }
  const raw = item.end ?? item.start!;
  const time = raw.length > 10 ? ` ${raw.slice(11, 16)}` : '';
  let label: string;
  if (deadline === today) {
    label = t(lang, 'list.today');
  } else if (deadline === addDays(today, 1)) {
    label = t(lang, 'list.tomorrow');
  } else if (section === 'thisWeek') {
    const [y, m, d] = deadline.split('-').map(Number);
    label = new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(new Date(y, m - 1, d));
  } else {
    label = formatDisplayDate(deadline, settings.dateFormat, lang);
  }
  const kind =
    deadline < today
      ? 'overdue'
      : deadline === today
        ? 'today'
        : deadline === addDays(today, 1)
          ? 'tomorrow'
          : section === 'thisWeek'
            ? 'week'
            : 'later';
  return (
    <span class={`due due-${kind}`}>
      <Icon name="calendar" />
      {label}
      {time}
    </span>
  );
}

function AddTask({ tr, start }: { tr: (key: MessageKey) => string; start: string | undefined }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button class="tl-add" onClick={() => setOpen(true)}>
        <span class="tl-add-plus">
          <Icon name="plus" />
        </span>
        {tr('list.add')}
      </button>
    );
  }
  return (
    <input
      class="tl-new"
      placeholder={tr('kanban.addPlaceholder')}
      ref={(el) => el?.focus()}
      onKeyDown={(e) => {
        const input = e.currentTarget as HTMLInputElement;
        if (e.key === 'Enter' && input.value.trim()) {
          post({ type: 'createQuick', title: input.value.trim(), ...(start ? { start } : {}) });
          input.value = '';
        } else if (e.key === 'Escape') {
          setOpen(false);
        }
      }}
      onBlur={() => setOpen(false)}
    />
  );
}

export class ListView {
  private state: ListState = { showCompleted: false };
  private last: Omit<ListProps, 'state' | 'onState'> | undefined;

  constructor(private readonly root: HTMLElement) {}

  setState(raw: unknown): void {
    const s = (raw ?? {}) as Partial<ListState>;
    this.state = { showCompleted: s.showCompleted === true };
    this.rerender();
  }

  update(items: PlannerItem[], settings: PlannerSettings, lang: Lang): void {
    this.last = { items, settings, lang };
    this.rerender();
  }

  private rerender(): void {
    if (!this.last) {
      return;
    }
    render(
      <TaskList
        {...this.last}
        state={this.state}
        onState={(state) => {
          this.state = state;
          post({ type: 'saveListState', state });
          this.rerender();
        }}
      />,
      this.root,
    );
  }
}
