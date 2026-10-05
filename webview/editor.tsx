import { ComponentChildren, render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BodyLine, bodyLines } from '../src/checklist';
import { ancestorTitles, parentMap } from '../src/hierarchy';
import { MessageKey, t } from '../src/i18n';
import type { ItemType, PlannerItem } from '../src/model';
import { PRIORITIES, PRIORITY_COLORS, Priority, priorityLabel } from '../src/priority';
import { parseRepeat, repeatLabel } from '../src/repeat';
import { Lang, PlannerSettings, resolveStatus } from '../src/settings';
import { allTags, parentCandidates } from '../src/table';
import { addHour, attachDatePicker, joinDateTime, parseTime, toEditorText } from './datepicker';
import { icon } from './icons';
import { closePopover, menuList, openPopover } from './menu';
import { tooltip } from './tooltip';
import { post } from './vscode';

/** Prefilled values for a new item (e.g. the clicked calendar day). */
export interface NewDefaults {
  type?: ItemType;
  status?: string;
  start?: string;
  end?: string;
}

type Target = { mode: 'edit'; key: string; seq: number } | { mode: 'new'; defaults: NewDefaults; seq: number };

interface Context {
  items: PlannerItem[];
  settings: PlannerSettings;
  lang: Lang;
}

// ---- module state (one dialog for the whole webview) ------------------------

let root: HTMLElement | undefined;
let ctx: Context | undefined;
let target: Target | undefined;
let seq = 0;
/** Bodies loaded for the edit dialog: undefined = loading, null = unreadable. */
const bodies = new Map<string, string | null>();
/** Key whose deletion was requested from the dialog; closes it once the item is gone. */
let deleting: string | undefined;

export function initEditor(el: HTMLElement): void {
  root = el;
}

export function updateEditorContext(items: PlannerItem[], settings: PlannerSettings, lang: Lang): void {
  ctx = { items, settings, lang };
  if (target?.mode === 'edit' && target.key === deleting && !items.some((i) => i.key === deleting)) {
    deleting = undefined;
    target = undefined;
  }
  draw();
}

export function editItem(key: string): void {
  tooltip().hide();
  closePopover();
  target = { mode: 'edit', key, seq: ++seq };
  bodies.delete(key);
  post({ type: 'loadBody', key });
  draw();
}

export function newItem(defaults: NewDefaults = {}): void {
  tooltip().hide();
  closePopover();
  target = { mode: 'new', defaults, seq: ++seq };
  draw();
}

/** Click on an item in a view: the dialog, or the file itself with Alt. */
export function openItem(key: string, e?: { altKey: boolean }): void {
  if (e?.altKey) {
    post({ type: 'open', key });
  } else {
    editItem(key);
  }
}

export function receiveBody(key: string, body: string | undefined): void {
  bodies.set(key, body ?? null);
  draw();
}

export function isEditorOpen(): boolean {
  return target !== undefined;
}

function close(): void {
  closePopover();
  target = undefined;
  draw();
}

function draw(): void {
  if (!root) {
    return;
  }
  render(
    target && ctx ? (
      <Dialog
        key={target.seq}
        target={target}
        {...ctx}
        body={target.mode === 'edit' ? bodies.get(target.key) : undefined}
      />
    ) : null,
    root,
  );
}

// ---- draft --------------------------------------------------------------------

const REPEAT_PRESETS = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly'];

interface Draft {
  title: string;
  type: ItemType;
  status: string;
  priority?: Priority;
  /** Date text (`YYYY/MM/DD`) and time (`HH:mm`, or `''` for none). */
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  /** Hides the times and saves dates only. */
  allDay: boolean;
  tags: string[];
  parent?: string;
  /** `''` = no repeat, a preset value, or `custom` (then `repeatText`). */
  repeatMode: string;
  repeatText: string;
}

/** `2026-10-05T10:00` → date text and time for the dialog fields. */
function splitDate(value: string | undefined) {
  const text = toEditorText(value);
  return { date: text.slice(0, 10), time: text.slice(11) };
}

function dateFields(start: string | undefined, end: string | undefined) {
  const s = splitDate(start);
  const e = splitDate(end);
  return { startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time, allDay: !s.time && !e.time };
}

function initialDraft(target: Target, item: PlannerItem | undefined, settings: PlannerSettings): Draft {
  if (target.mode === 'edit' && item) {
    const preset = item.repeat && REPEAT_PRESETS.includes(item.repeat) ? item.repeat : undefined;
    return {
      title: item.title,
      type: item.type,
      status: item.status,
      priority: item.priority,
      ...dateFields(item.start, item.end),
      tags: item.tags,
      parent: item.parent,
      repeatMode: preset ?? (item.repeat ? 'custom' : ''),
      repeatText: preset ? '' : (item.repeat ?? ''),
    };
  }
  const d = target.mode === 'new' ? target.defaults : {};
  return {
    title: '',
    type: d.type ?? 'task',
    status: d.status ?? settings.statuses[0]?.name ?? 'todo',
    ...dateFields(d.start, d.end),
    tags: [],
    repeatMode: '',
    repeatText: '',
  };
}

interface Problems {
  title?: MessageKey;
  start?: MessageKey;
  end?: MessageKey;
  repeat?: MessageKey;
}

function validate(draft: Draft): Problems {
  const p: Problems = {};
  if (!draft.title.trim()) {
    p.title = 'editor.titleRequired';
  }
  const start = joinDateTime(draft.startDate, draft.startTime, draft.allDay);
  const end = joinDateTime(draft.endDate, draft.endTime, draft.allDay);
  const badTime = (time: string) => !draft.allDay && parseTime(time) === undefined;
  if (start === undefined) {
    p.start = badTime(draft.startTime) ? 'editor.invalidTime' : 'editor.invalidDate';
  }
  if (end === undefined) {
    p.end = badTime(draft.endTime) ? 'editor.invalidTime' : 'editor.invalidDate';
  } else if (start && end && end.slice(0, 10) < start.slice(0, 10)) {
    p.end = 'editor.endBeforeStart';
  } else if (start && end && start.length > 10 && end.length > 10 && end < start) {
    p.end = 'editor.endBeforeStartTime';
  }
  if (draft.type === 'task' && draft.repeatMode === 'custom' && draft.repeatText.trim() && !parseRepeat(draft.repeatText)) {
    p.repeat = 'editor.repeat.invalid';
  }
  return p;
}

const hasDate = (text: string) => !!joinDateTime(text, '', true);

/**
 * With times shown, a date without a time gets a default: 09:00 for the start, and
 * for the end one hour after the start on the same day, else 18:00.
 */
function fillTimes(d: Draft): Draft {
  if (d.allDay) {
    return d;
  }
  const startTime = d.startTime || (hasDate(d.startDate) ? '09:00' : '');
  const sameDay = hasDate(d.startDate) && joinDateTime(d.startDate, '', true) === joinDateTime(d.endDate, '', true);
  const start = parseTime(startTime);
  const endTime = d.endTime || (hasDate(d.endDate) ? (sameDay && start ? addHour(start) : '18:00') : '');
  return { ...d, startTime, endTime };
}

function repeatValue(draft: Draft): string | undefined {
  if (draft.repeatMode === 'custom') {
    return draft.repeatText.trim() || undefined;
  }
  return draft.repeatMode || undefined;
}

// ---- dialog --------------------------------------------------------------------

interface DialogProps extends Context {
  target: Target;
  body: string | null | undefined;
}

function Dialog({ target, items, settings, lang, body }: DialogProps) {
  const tr = (key: MessageKey, ...args: (string | number)[]) => t(lang, key, ...args);
  const item = target.mode === 'edit' ? items.find((i) => i.key === target.key) : undefined;
  const initial = useMemo(() => initialDraft(target, item, settings), []);
  const [draft, setDraft] = useState(initial);
  const [checks, setChecks] = useState(new Map<number, boolean>());
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [tried, setTried] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setConfirmDiscard(false);
  };
  /** Date/all-day changes also fill empty times with defaults (see fillTimes). */
  const updateDates = (patch: Partial<Draft>) => {
    setDraft((d) => fillTimes({ ...d, ...patch }));
    setConfirmDiscard(false);
  };
  const problems = validate(draft);
  const valid = Object.keys(problems).length === 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || checks.size > 0;
  const missing = target.mode === 'edit' && !item;
  const isTask = draft.type === 'task';

  const save = () => {
    setTried(true);
    if (!valid || missing) {
      return;
    }
    post({
      type: 'saveItem',
      key: target.mode === 'edit' ? target.key : undefined,
      fields: {
        title: draft.title.trim(),
        type: draft.type,
        status: isTask ? draft.status : item?.status,
        priority: isTask ? draft.priority : item?.priority,
        start: joinDateTime(draft.startDate, draft.startTime, draft.allDay) || undefined,
        end: joinDateTime(draft.endDate, draft.endTime, draft.allDay) || undefined,
        tags: draft.tags,
        parent: draft.parent,
        repeat: isTask ? repeatValue(draft) : item?.repeat,
      },
      checks: [...checks].map(([line, checked]) => ({ line, checked })),
    });
    close();
  };
  const requestClose = () => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
    } else {
      close();
    }
  };

  // Latest handlers for the document-level key listener.
  const keys = useRef({ save, requestClose });
  keys.current = { save, requestClose };
  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        keys.current.requestClose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        keys.current.save();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const statusDef = resolveStatus(draft.status, settings.statuses);
  const parentItem = draft.parent ? items.find((i) => i.id === draft.parent) : undefined;
  const ancestors = item ? ancestorTitles(item, parentMap(items)) : [];
  const show = (key: keyof Problems) => problems[key] && (tried || key !== 'title') && tr(problems[key]!);

  const pickStatus = (anchor: HTMLElement) =>
    openPopover(anchor, (closeMenu) =>
      menuList(
        settings.statuses.map((s) => ({
          label: s.label ?? s.name,
          color: s.color,
          checked: statusDef.name === s.name,
          onSelect: () => update({ status: s.name }),
        })),
        closeMenu,
      ),
    );
  const pickParent = (anchor: HTMLElement) => {
    const candidates = item ? parentCandidates(item, items) : items.filter((i) => i.id).sort((a, b) => a.title.localeCompare(b.title));
    openPopover(anchor, (closeMenu) =>
      menuList(
        [
          { label: tr('table.noParent'), checked: !draft.parent, onSelect: () => update({ parent: undefined }) },
          ...candidates.map((c) => ({ label: c.title, checked: draft.parent === c.id, onSelect: () => update({ parent: c.id }) })),
        ],
        closeMenu,
      ),
    );
  };

  return (
    <div
      class="ed-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          requestClose();
        }
      }}
    >
      <div class="ed-dialog" role="dialog" aria-modal="true" aria-label={tr(target.mode === 'new' ? 'editor.new' : 'editor.edit')}>
        <header class="ed-head">
          <div class="ed-kicker">
            {target.mode === 'new' ? tr('editor.new') : ancestors.length ? [...ancestors].reverse().join(' › ') : tr('editor.edit')}
          </div>
          <button class="btn icon ghost" title={tr('editor.close')} aria-label={tr('editor.close')} onClick={requestClose}>
            <Icon name="x" />
          </button>
        </header>
        {missing && <div class="ed-banner">{tr('editor.missing')}</div>}

        <div class="ed-scroll">
          <input
            ref={titleRef}
            class={`ed-title${tried && problems.title ? ' invalid' : ''}`}
            placeholder={tr('editor.titlePlaceholder')}
            value={draft.title}
            onInput={(e) => update({ title: e.currentTarget.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.isComposing) {
                e.preventDefault();
                save();
              }
            }}
          />
          {show('title') && <div class="ed-error">{show('title')}</div>}

          <div class="ed-props">
            <Label icon="group" text={tr('editor.type')} />
            <div class="segmented compact">
              {(['task', 'event', 'holiday'] as ItemType[]).map((type) => (
                <button key={type} class={draft.type === type ? 'active' : ''} onClick={() => update({ type })}>
                  {tr(`msg.type.${type}` as MessageKey)}
                </button>
              ))}
            </div>

            {isTask && (
              <>
                <Label icon="kanban" text={tr('editor.status')} />
                <div>
                  <button class="ed-pick" onClick={(e) => pickStatus(e.currentTarget)}>
                    <span class="status-pill" style={{ '--c': statusDef.color }}>
                      <span class="dot" />
                      {statusDef.label ?? statusDef.name}
                    </span>
                    <Icon name="chevron-down" />
                  </button>
                </div>

                <Label icon="flag" text={tr('table.col.priority')} />
                <div class="ed-prio" role="radiogroup">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      role="radio"
                      aria-checked={draft.priority === p}
                      class={draft.priority === p ? 'active' : ''}
                      style={{ '--c': PRIORITY_COLORS[p] }}
                      title={priorityLabel(p, lang)}
                      onClick={() => update({ priority: p })}
                    >
                      <Icon name="flag" />
                      {priorityLabel(p, lang)}
                    </button>
                  ))}
                  <button
                    role="radio"
                    aria-checked={!draft.priority}
                    class={!draft.priority ? 'active' : ''}
                    onClick={() => update({ priority: undefined })}
                  >
                    {tr('priority.none')}
                  </button>
                </div>
              </>
            )}

            <Label icon="clock" text={tr('editor.allDay')} />
            <div>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={draft.allDay}
                  onChange={(e) => updateDates({ allDay: e.currentTarget.checked })}
                />
                <span class="switch-track" />
              </label>
            </div>

            <Label icon="calendar" text={tr('editor.start')} />
            <DateField
              value={draft.startDate}
              onChange={(startDate) => updateDates({ startDate })}
              error={show('start')}
              settings={settings}
              lang={lang}
              time={
                !draft.allDay && (
                  <TimeField
                    value={draft.startTime}
                    disabled={!hasDate(draft.startDate)}
                    label={tr('editor.startTime')}
                    onChange={(startTime) => update({ startTime })}
                  />
                )
              }
            />
            <Label icon="calendar" text={tr(isTask ? 'editor.due' : 'editor.end')} />
            <DateField
              value={draft.endDate}
              onChange={(endDate) => updateDates({ endDate })}
              error={show('end')}
              settings={settings}
              lang={lang}
              time={
                !draft.allDay && (
                  <TimeField
                    value={draft.endTime}
                    disabled={!hasDate(draft.endDate)}
                    label={tr(isTask ? 'editor.dueTime' : 'editor.endTime')}
                    onChange={(endTime) => update({ endTime })}
                  />
                )
              }
            />

            {isTask && (
              <>
                <Label icon="repeat" text={tr('tooltip.repeat')} />
                <div class="ed-repeat">
                  <select
                    class="ed-input"
                    value={draft.repeatMode}
                    onChange={(e) => update({ repeatMode: e.currentTarget.value })}
                  >
                    <option value="">{tr('editor.repeat.none')}</option>
                    {REPEAT_PRESETS.map((v) => (
                      <option key={v} value={v}>
                        {repeatLabel(parseRepeat(v)!, lang)}
                      </option>
                    ))}
                    <option value="custom">{tr('editor.repeat.custom')}</option>
                  </select>
                  {draft.repeatMode === 'custom' && (
                    <input
                      class={`ed-input${problems.repeat ? ' invalid' : ''}`}
                      placeholder={tr('editor.repeat.customPlaceholder')}
                      value={draft.repeatText}
                      onInput={(e) => update({ repeatText: e.currentTarget.value })}
                    />
                  )}
                  {draft.repeatMode === 'custom' && draft.repeatText.trim() && (
                    <span class={problems.repeat ? 'ed-error' : 'ed-note'}>
                      {problems.repeat ? tr(problems.repeat) : `→ ${repeatLabel(parseRepeat(draft.repeatText)!, lang)}`}
                    </span>
                  )}
                </div>
              </>
            )}

            <Label icon="filter" text={tr('editor.tags')} />
            <TagField tags={draft.tags} suggestions={allTags(items)} onChange={(tags) => update({ tags })} tr={tr} />

            <Label icon="gantt" text={tr('table.col.parent')} />
            <div>
              <button class="ed-pick" onClick={(e) => pickParent(e.currentTarget)}>
                <span class={parentItem || draft.parent ? '' : 'muted'}>
                  {parentItem?.title ?? draft.parent ?? tr('table.noParent')}
                </span>
                <Icon name="chevron-down" />
              </button>
            </div>
          </div>

          <section class="ed-body">
            <div class="ed-section-title">{tr('editor.body')}</div>
            {target.mode === 'new' ? (
              <p class="ed-note">{tr('editor.bodyTemplate')}</p>
            ) : (
              <Body
                body={body}
                checks={checks}
                tr={tr}
                onToggle={(line, checked, original) => {
                  setChecks((prev) => {
                    const next = new Map(prev);
                    if (checked === original) {
                      next.delete(line);
                    } else {
                      next.set(line, checked);
                    }
                    return next;
                  });
                  setConfirmDiscard(false);
                }}
              />
            )}
          </section>
        </div>

        <footer class="ed-foot">
          <div class="ed-foot-start">
            {target.mode === 'edit' && item && (
              <>
                <button
                  class="btn ghost"
                  title={item.path}
                  onClick={() => {
                    post({ type: 'open', key: item.key });
                    if (!dirty) {
                      close();
                    }
                  }}
                >
                  <Icon name="open" />
                  {tr('table.open')}
                </button>
                <button
                  class="btn ghost danger"
                  onClick={() => {
                    deleting = item.key;
                    post({ type: 'deleteItem', key: item.key });
                  }}
                >
                  {tr('editor.delete')}
                </button>
              </>
            )}
          </div>
          <div class="ed-foot-end">
            <span class={`ed-hint${confirmDiscard ? ' warn' : ''}`}>
              {confirmDiscard ? tr('editor.unsaved') : tr('editor.shortcut')}
            </span>
            <button class="btn" onClick={requestClose}>
              {tr('editor.cancel')}
            </button>
            <button class="btn primary" disabled={missing || (tried && !valid)} onClick={save}>
              {tr(target.mode === 'new' ? 'editor.create' : 'editor.save')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---- parts ---------------------------------------------------------------------

function Icon({ name }: { name: string }) {
  return <span class="ico" dangerouslySetInnerHTML={{ __html: icon(name) }} />;
}

function Label({ icon: name, text }: { icon: string; text: string }) {
  return (
    <div class="ed-label">
      <Icon name={name} />
      {text}
    </div>
  );
}

/** `YYYY/MM/DD[ HH:mm]` input with the calendar popup while focused. */
function DateField({
  value,
  onChange,
  error,
  settings,
  lang,
  time,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | false | undefined;
  settings: PlannerSettings;
  lang: Lang;
  /** Time input shown next to the date. */
  time?: ComponentChildren;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const closePicker = () => {
    cleanup.current?.();
    cleanup.current = undefined;
  };
  const openPicker = () => {
    if (!cleanup.current && ref.current) {
      cleanup.current = attachDatePicker(ref.current, settings, lang, () => {
        onChange(ref.current!.value);
        closePicker();
      });
    }
  };
  useEffect(() => closePicker, []);
  return (
    <div class="ed-date">
      <input
        ref={ref}
        class={`ed-input mono${error ? ' invalid' : ''}`}
        placeholder="YYYY/MM/DD"
        spellcheck={false}
        value={value}
        onInput={(e) => onChange(e.currentTarget.value)}
        onFocus={openPicker}
        onClick={openPicker}
        onBlur={closePicker}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && cleanup.current) {
            // Close just the picker, not the dialog.
            e.stopPropagation();
            closePicker();
          } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            closePicker();
          }
        }}
      />
      {time}
      {error && <span class="ed-error">{error}</span>}
    </div>
  );
}

/** Every half hour, offered as suggestions under the time inputs. */
const TIME_SUGGESTIONS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

/**
 * 24-hour `HH:mm` text input (a native time input would follow the OS locale and
 * may show AM/PM). Loose input like `930` is normalized when leaving the field.
 */
function TimeField({
  value,
  disabled,
  label,
  onChange,
}: {
  value: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <input
        class={`ed-input ed-time${parseTime(value) === undefined ? ' invalid' : ''}`}
        aria-label={label}
        placeholder="HH:mm"
        inputMode="numeric"
        spellcheck={false}
        list="ed-time-suggestions"
        value={value}
        disabled={disabled}
        onInput={(e) => onChange(e.currentTarget.value)}
        onBlur={(e) => {
          const time = parseTime(e.currentTarget.value);
          if (time !== undefined && time !== value) {
            onChange(time);
          }
        }}
      />
      <datalist id="ed-time-suggestions">
        {TIME_SUGGESTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </>
  );
}

function TagField({
  tags,
  suggestions,
  onChange,
  tr,
}: {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
  tr: (key: MessageKey, ...args: (string | number)[]) => string;
}) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const next = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !tags.includes(s));
    if (next.length) {
      onChange([...tags, ...new Set(next)]);
    }
    setText('');
  };
  return (
    <div class="ed-tags">
      {tags.map((tag) => (
        <span class="tag ed-tag" key={tag}>
          {tag}
          <button title={tr('editor.removeTag', tag)} onClick={() => onChange(tags.filter((t) => t !== tag))}>
            <Icon name="x" />
          </button>
        </span>
      ))}
      <input
        class="ed-tag-input"
        list="ed-tag-suggestions"
        placeholder={tr('editor.tagPlaceholder')}
        value={text}
        onInput={(e) => {
          const v = e.currentTarget.value;
          // Picking from the datalist or typing a comma commits the tag.
          if (v.endsWith(',') || suggestions.includes(v)) {
            add(v);
          } else {
            setText(v);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.isComposing) {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id="ed-tag-suggestions">
        {suggestions
          .filter((s) => !tags.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}

/** Read-only body with clickable task list checkboxes. */
function Body({
  body,
  checks,
  tr,
  onToggle,
}: {
  body: string | null | undefined;
  checks: Map<number, boolean>;
  tr: (key: MessageKey) => string;
  onToggle: (line: number, checked: boolean, original: boolean) => void;
}) {
  const lines = useMemo(() => (body ? bodyLines(body) : []), [body]);
  if (body === undefined) {
    return <p class="ed-note">{tr('editor.bodyLoading')}</p>;
  }
  if (!lines.length) {
    return <p class="ed-note">{tr('editor.bodyEmpty')}</p>;
  }
  const tasks = lines.filter((l): l is Extract<BodyLine, { kind: 'task' }> => l.kind === 'task');
  const done = tasks.filter((l) => checks.get(l.line) ?? l.checked).length;
  return (
    <div class="ed-md">
      {tasks.length > 0 && (
        <div class="ed-md-progress">
          <span class="mp-progress-bar">
            <span style={{ width: `${Math.round((done / tasks.length) * 100)}%` }} />
          </span>
          {done}/{tasks.length}
        </div>
      )}
      {lines.map((l) => {
        switch (l.kind) {
          case 'task': {
            const checked = checks.get(l.line) ?? l.checked;
            return (
              <label key={l.line} class={`ed-md-task${checked ? ' done' : ''}`} style={{ paddingLeft: `${l.depth * 18}px` }}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(l.line, !checked, l.checked)} />
                <span>{l.text}</span>
              </label>
            );
          }
          case 'heading':
            return (
              <div key={l.line} class={`ed-md-h ed-md-h${Math.min(l.level, 3)}`}>
                {l.text}
              </div>
            );
          case 'code':
            return (
              <pre key={l.line} class="ed-md-code">
                {l.text || ' '}
              </pre>
            );
          case 'blank':
            return <div key={l.line} class="ed-md-gap" />;
          case 'text':
            return (
              <div key={l.line} class="ed-md-text" style={{ paddingLeft: `${l.depth * 18}px` }}>
                {l.text}
              </div>
            );
        }
      })}
    </div>
  );
}
