import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { businessCalendar, remainingBusinessDays, remainingLabel, type Remaining } from '../src/businessDays';
import { formatDisplayDate } from '../src/dateFormat';
import { ancestorTitles, parentMap } from '../src/hierarchy';
import { MessageKey, t } from '../src/i18n';
import { buildBoard } from '../src/kanban';
import type { PlannerItem } from '../src/model';
import { PRIORITY_COLORS, priorityLabel } from '../src/priority';
import { Lang, PlannerSettings, resolveStatus, StatusDef } from '../src/settings';
import { formatDate } from './dates';
import { icon } from './icons';
import { checklistInfo } from './progress';
import { itemTooltip, tooltip } from './tooltip';
import { post } from './vscode';

interface BoardProps {
  items: PlannerItem[];
  settings: PlannerSettings;
  lang: Lang;
}

const DRAG_TYPE = 'application/x-mark-planner-item';

function Icon({ name }: { name: string }) {
  return <span class="ico" dangerouslySetInnerHTML={{ __html: icon(name) }} />;
}

/** Kanban board: one column per status; dragging a card to a column rewrites its status. */
function Board({ items, settings, lang }: BoardProps) {
  const tr = (key: MessageKey, ...args: (string | number)[]) => t(lang, key, ...args);
  // Optimistic status changes until the file write comes back as an items update.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

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
  const { columns, remaining, parents } = useMemo(() => {
    const cal = businessCalendar(items, settings);
    const today = formatDate(new Date());
    const remaining = new Map(shown.map((i) => [i.key, remainingBusinessDays(i, today, cal, settings)] as const));
    return {
      columns: buildBoard(shown, settings.statuses, (i) => remaining.get(i.key)),
      remaining,
      parents: parentMap(shown),
    };
  }, [shown, settings]);

  const move = (key: string, status: string) => {
    const item = shown.find((i) => i.key === key);
    if (!item || resolveStatus(item.status, settings.statuses).name === status) {
      return;
    }
    setPending((p) => ({ ...p, [key]: status }));
    post({ type: 'patch', key, field: 'status', value: status });
  };

  return (
    <div class="kanban">
      {columns.map(({ status, cards }) => (
        <Column
          key={status.name}
          status={status}
          count={cards.length}
          over={over === status.name && dragKey !== null}
          onOver={() => setOver(status.name)}
          onLeave={() => setOver((o) => (o === status.name ? null : o))}
          onDrop={(key) => {
            setOver(null);
            setDragKey(null);
            move(key, status.name);
          }}
          tr={tr}
        >
          {cards.map((item) => (
            <Card
              key={item.key}
              item={item}
              remaining={remaining.get(item.key)}
              ancestors={ancestorTitles(item, parents)}
              settings={settings}
              items={items}
              lang={lang}
              dragging={dragKey === item.key}
              onDragStart={() => setDragKey(item.key)}
              onDragEnd={() => {
                setDragKey(null);
                setOver(null);
              }}
            />
          ))}
        </Column>
      ))}
    </div>
  );
}

interface ColumnProps {
  status: StatusDef;
  count: number;
  over: boolean;
  onOver: () => void;
  onLeave: () => void;
  onDrop: (key: string) => void;
  tr: (key: MessageKey) => string;
  children: preact.ComponentChildren;
}

function Column({ status, count, over, onOver, onLeave, onDrop, tr, children }: ColumnProps) {
  const [adding, setAdding] = useState(false);
  return (
    <section
      class={`kb-col${over ? ' over' : ''}`}
      style={{ '--c': status.color }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          onOver();
        }
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) {
          onLeave();
        }
      }}
      onDrop={(e) => {
        const key = e.dataTransfer?.getData(DRAG_TYPE);
        if (key) {
          e.preventDefault();
          onDrop(key);
        }
      }}
    >
      <header class="kb-head">
        <span class="kb-dot" />
        <span class="kb-name">{status.label ?? status.name}</span>
        <span class="kb-count">{count}</span>
      </header>
      <div class="kb-cards">
        {children}
        {count === 0 && !adding && <div class="kb-empty">{tr('kanban.empty')}</div>}
      </div>
      {adding ? (
        <input
          class="kb-new"
          placeholder={tr('kanban.addPlaceholder')}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => {
            const input = e.currentTarget as HTMLInputElement;
            if (e.key === 'Enter' && input.value.trim()) {
              post({ type: 'createQuick', title: input.value.trim(), status: status.name });
              input.value = '';
            } else if (e.key === 'Escape') {
              setAdding(false);
            }
          }}
          onBlur={() => setAdding(false)}
        />
      ) : (
        <button class="kb-add" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          {tr('kanban.add')}
        </button>
      )}
    </section>
  );
}

interface CardProps {
  item: PlannerItem;
  remaining: Remaining | undefined;
  ancestors: string[];
  settings: PlannerSettings;
  items: PlannerItem[];
  lang: Lang;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function Card({ item, remaining, ancestors, settings, items, lang, dragging, onDragStart, onDragEnd }: CardProps) {
  const done = resolveStatus(item.status, settings.statuses).done;
  const date = (v: string) => formatDisplayDate(v, settings.dateFormat, lang);
  const start = item.start ?? item.end;
  const end = item.end ?? item.start;
  const range = !start ? undefined : start.slice(0, 10) === end!.slice(0, 10) ? date(start) : `${date(start)} – ${date(end!)}`;
  return (
    <article
      class={`kb-card${dragging ? ' dragging' : ''}${done ? ' done' : ''}`}
      draggable
      tabIndex={0}
      onDragStart={(e) => {
        tooltip().hide();
        e.dataTransfer?.setData(DRAG_TYPE, item.key);
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
        }
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => post({ type: 'open', key: item.key })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
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
      {ancestors.length > 0 && <div class="kb-crumbs">{[...ancestors].reverse().join(' › ')}</div>}
      <div class="kb-title">{item.title}</div>
      <div class="kb-meta">
        <span class="kb-date">
          {range ?? t(lang, 'kanban.undated')}
          {!done && <PriorityFlag item={item} lang={lang} />}
        </span>
        {remaining && <span class={`remaining ${remaining.kind}`}>{remainingLabel(remaining, lang)}</span>}
      </div>
      <Progress item={item} />
      {item.tags.length > 0 && (
        <div class="kb-tags">
          {item.tags.map((tag) => (
            <span class="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

/** Checklist progress (`2/4` + bar), shared with the list view. */
export function Progress({ item }: { item: PlannerItem }) {
  const info = checklistInfo(item);
  if (!info) {
    return null;
  }
  return (
    <span class={`mp-progress${info.complete ? ' complete' : ''}`} title={`${info.percent}%`}>
      <span class="mp-progress-bar">
        <span style={{ width: `${info.percent}%` }} />
      </span>
      <span class="mp-progress-text">{info.text}</span>
    </span>
  );
}

/** `P1` flag in the priority's color, shared with the list view. */
export function PriorityFlag({ item, lang }: { item: PlannerItem; lang: Lang }) {
  if (!item.priority) {
    return null;
  }
  return (
    <span class="priority-flag" style={{ '--c': PRIORITY_COLORS[item.priority] }} title={priorityLabel(item.priority, lang)}>
      <Icon name="flag" />P{item.priority}
    </span>
  );
}

export class KanbanView {
  constructor(private readonly root: HTMLElement) {}

  update(items: PlannerItem[], settings: PlannerSettings, lang: Lang): void {
    render(<Board items={items} settings={settings} lang={lang} />, this.root);
  }
}
