import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatDisplayDate } from '../src/dateFormat';
import { ancestorTitles, parentMap } from '../src/hierarchy';
import { MessageKey, t } from '../src/i18n';
import { buildList, dueLabel, ListSectionId, toggleStatus } from '../src/list';
import type { PlannerItem } from '../src/model';
import { PRIORITY_COLORS } from '../src/priority';
import { parseRepeat, repeatLabel } from '../src/repeat';
import { Lang, PlannerSettings, resolveStatus } from '../src/settings';
import { addDays, formatDate } from './dates';
import { icon } from './icons';
import { PriorityFlag, Progress } from './kanban';
import { editItem, openItem } from './editor';
import { itemTooltip, tooltip } from './tooltip';
import { post } from './vscode';

interface ListProps {
  items: PlannerItem[];
  settings: PlannerSettings;
  lang: Lang;
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

function TaskList({ items, settings, lang }: ListProps) {
  // Shared with the other views: the app bar's "Show completed" (the hideDone setting).
  const showCompleted = !settings.hideDone;
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
        showCompleted,
        keepOpen: lingering,
      }),
    [shown, today, settings, showCompleted, lingering],
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
    if (done && !showCompleted) {
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
      {visible.map((section) => (
        <section class={`tl-section tl-${section.id}`} key={section.id}>
          <header class="tl-head">
            <h2>{tr(`list.${section.id}` as MessageKey)}</h2>
            {section.id === 'today' && (
              <span class="tl-date">{formatDisplayDate(today, lang === 'ja' ? 'M月D日(ddd)' : 'ddd, MMM D', lang)}</span>
            )}
            <span class="tl-count">{section.items.length || ''}</span>
          </header>
          <ul class="tl-items">
            {section.items.map((item) => (
              <Row
                key={item.key}
                item={item}
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
  ancestors: string[];
  settings: PlannerSettings;
  lang: Lang;
  items: PlannerItem[];
  today: string;
  canComplete: boolean;
  onToggle: (done: boolean) => void;
}

function Row({ item, ancestors, settings, lang, items, today, canComplete, onToggle }: RowProps) {
  const status = resolveStatus(item.status, settings.statuses);
  const done = status.done;
  return (
    <li
      class={`tl-row${done ? ' done' : ''}`}
      tabIndex={0}
      onClick={(e) => openItem(item.key, e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          editItem(item.key);
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
        style={{ '--c': item.priority && !done ? PRIORITY_COLORS[item.priority] : status.color }}
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
        <Progress item={item} />
        {!done && <PriorityFlag item={item} lang={lang} />}
        {item.tags.map((tag) => (
          <span class="tag" key={tag}>
            {tag}
          </span>
        ))}
        <DueChip item={item} settings={settings} lang={lang} today={today} />
      </div>
    </li>
  );
}

/** Deadline chip colored by urgency (see dueLabel). */
function DueChip({ item, settings, lang, today }: { item: PlannerItem; settings: PlannerSettings; lang: Lang; today: string }) {
  const due = dueLabel(item, today, { weekStart: settings.weekStart, dateFormat: settings.dateFormat, lang });
  if (!due) {
    return null;
  }
  const repeat = parseRepeat(item.repeat);
  return (
    <span class={`due due-${due.kind}`}>
      <Icon name="calendar" />
      {due.text}
      {repeat && (
        <span class="due-repeat" title={`${t(lang, 'tooltip.repeat')}: ${repeatLabel(repeat, lang)}`}>
          <Icon name="repeat" />
        </span>
      )}
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
  constructor(private readonly root: HTMLElement) {}

  update(items: PlannerItem[], settings: PlannerSettings, lang: Lang): void {
    render(<TaskList items={items} settings={settings} lang={lang} />, this.root);
  }
}
