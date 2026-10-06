import { normalizeDate } from '../src/model';
import { japaneseHoliday } from '../src/holidays';
import { t } from '../src/i18n';
import type { Lang, PlannerSettings } from '../src/settings';
import { formatDate } from './dates';
import { icon } from './icons';

/**
 * Text shown in the editor: `YYYY/MM/DD` or `YYYY/MM/DD HH:mm` (files keep
 * `YYYY-MM-DD`; parseEditorText accepts either separator).
 */
export const toEditorText = (value: string | undefined) =>
  (value ?? '').replace('T', ' ').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$1/$2/$3');

/**
 * Parses what the user typed. Accepts `-` or `/` separators and an optional
 * `HH:mm`. Returns `''` for "clear", the normalized value, or undefined if invalid.
 */
export function parseEditorText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(trimmed);
  if (!m) {
    return undefined;
  }
  const [, y, mo, d, hh, mm] = m;
  const pad = (s: string) => s.padStart(2, '0');
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  const check = new Date(Number(y), Number(mo) - 1, Number(d));
  if (check.getMonth() !== Number(mo) - 1 || check.getDate() !== Number(d)) {
    return undefined; // e.g. 2026-02-30
  }
  if (hh !== undefined && (Number(hh) > 23 || Number(mm) > 59)) {
    return undefined;
  }
  return normalizeDate(hh !== undefined ? `${date}T${pad(hh)}:${mm}` : date);
}

/**
 * Parses a typed 24-hour time: `9`, `930`, `9:30`, `21:05` (full-width digits too).
 * Returns `HH:mm`, `''` for empty, or undefined when invalid.
 */
export function parseTime(text: string): string | undefined {
  const ascii = text.trim().replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!ascii) {
    return '';
  }
  const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(ascii);
  if (!m || Number(m[1]) > 23 || Number(m[2] ?? 0) > 59) {
    return undefined;
  }
  return `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`;
}

/**
 * Joins the dialog's date text and time text into a frontmatter value: `''` when
 * there is no date, the date alone when `allDay` (or no time), and undefined when
 * the date or time is invalid.
 */
export function joinDateTime(dateText: string, timeText: string, allDay: boolean): string | undefined {
  const date = parseEditorText(dateText);
  if (date === undefined || date === '') {
    return date;
  }
  const day = date.slice(0, 10);
  if (allDay) {
    return day;
  }
  const time = parseTime(timeText);
  return time === undefined ? undefined : time ? `${day}T${time}` : day;
}

/** `HH:mm` one hour later, kept within the day. */
export function addHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Calendar popup under a `YYYY/MM/DD` text input. `anchor` (`YYYY-MM-DD`, e.g. the
 * start date when picking the end) is marked and shown first while the input is
 * empty; otherwise the popup opens on the input's month, or today's. Clicking a day writes it into
 * the input (keeping any time) and calls `onPick`. Focus stays in the input.
 */
export function attachDatePicker(
  input: HTMLInputElement,
  settings: PlannerSettings,
  lang: Lang,
  onPick: () => void,
  anchor?: string,
): () => void {
  const pop = document.createElement('div');
  pop.className = 'popover datepicker';
  // Keep focus (and thus the editor) in the input while using the picker.
  pop.addEventListener('pointerdown', (e) => e.preventDefault());

  const initial = parseEditorText(input.value) || anchor || formatDate(new Date());
  let month = new Date(Number(initial.slice(0, 4)), Number(initial.slice(5, 7)) - 1, 1);

  const pick = (date: string) => {
    const time = parseEditorText(input.value)?.slice(11);
    input.value = toEditorText(time ? `${date}T${time}` : date);
    onPick();
  };

  const render = () => {
    const selected = parseEditorText(input.value)?.slice(0, 10);
    const today = formatDate(new Date());
    const title = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' }).format(month);
    const head = document.createElement('div');
    head.className = 'dp-head';
    const nav = (name: string, delta: number) => {
      const b = document.createElement('button');
      b.className = 'btn icon ghost tiny';
      b.innerHTML = icon(name);
      b.addEventListener('click', () => {
        month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
        render();
      });
      return b;
    };
    const label = document.createElement('span');
    label.className = 'dp-title';
    label.textContent = title;
    head.append(label, nav('chevron-left', -1), nav('chevron-right', 1));

    const grid = document.createElement('div');
    grid.className = 'dp-grid';
    const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) => (settings.weekStart + i) % 7);
    for (const dow of weekdays) {
      const w = document.createElement('span');
      w.className = 'dp-dow';
      w.textContent = new Intl.DateTimeFormat(lang, { weekday: 'narrow' }).format(new Date(2026, 9, 4 + dow));
      const color = settings.weekendColors[String(dow)];
      if (color) {
        w.style.color = color;
      }
      grid.append(w);
    }
    const offset = (month.getDay() - settings.weekStart + 7) % 7;
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - offset);
    for (let i = 0; i < 42; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = formatDate(day);
      const b = document.createElement('button');
      b.className = 'dp-day';
      b.textContent = String(day.getDate());
      if (day.getMonth() !== month.getMonth()) {
        b.classList.add('other');
      }
      if (iso === today) {
        b.classList.add('today');
      }
      if (iso === anchor) {
        b.classList.add('anchor');
      }
      if (iso === selected) {
        b.classList.add('selected');
      }
      const holiday = settings.showHolidays ? japaneseHoliday(iso, lang) : undefined;
      const color = holiday ? settings.holidayColor : settings.weekendColors[String(day.getDay())];
      if (color && iso !== selected) {
        b.style.color = color;
      }
      if (holiday) {
        b.title = holiday;
      }
      b.addEventListener('click', () => pick(iso));
      grid.append(b);
    }

    const foot = document.createElement('div');
    foot.className = 'dp-foot';
    const action = (label: string, run: () => void) => {
      const b = document.createElement('button');
      b.className = 'btn ghost tiny-text';
      b.textContent = label;
      b.addEventListener('click', run);
      return b;
    };
    foot.append(
      action(t(lang, 'nav.today'), () => pick(today)),
      action(t(lang, 'datepicker.clear'), () => {
        input.value = '';
        onPick();
      }),
    );
    pop.replaceChildren(head, grid, foot);
  };

  render();
  const onInput = () => {
    const parsed = parseEditorText(input.value);
    if (parsed) {
      month = new Date(Number(parsed.slice(0, 4)), Number(parsed.slice(5, 7)) - 1, 1);
    }
    render();
  };
  input.addEventListener('input', onInput);
  document.body.append(pop);
  const rect = input.getBoundingClientRect();
  const below = rect.bottom + 4;
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${below + pop.offsetHeight > window.innerHeight - 8 ? Math.max(8, rect.top - pop.offsetHeight - 4) : below}px`;
  return () => {
    input.removeEventListener('input', onInput);
    pop.remove();
  };
}
