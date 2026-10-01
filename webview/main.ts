import { Calendar, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import jaLocale from '@fullcalendar/core/locales/ja';
import Gantt from 'frappe-gantt';
import './style.css';
import type { PlannerItem } from '../src/model';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
let items: PlannerItem[] = [];
let view: 'calendar' | 'gantt' = 'calendar';

// ---- date helpers (local time, matching the strings in frontmatter) ----

const pad = (n: number) => String(n).padStart(2, '0');
const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const formatDateTime = (d: Date) => `${formatDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isDateOnly = (s: string) => s.length === 10;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return formatDate(new Date(y, m - 1, d + days));
}

function statusClass(item: PlannerItem): string[] {
  return [`type-${item.type}`, `status-${item.status.replace(/[^\w-]/g, '')}`];
}

// ---- calendar ----

function toCalendarEvent(item: PlannerItem): EventInput {
  const start = (item.start ?? item.end)!;
  const allDay = isDateOnly(start);
  const deadlineOnly = !item.start;
  let end: string | undefined;
  if (item.start && item.end) {
    // FullCalendar's all-day end is exclusive; ours is inclusive.
    end = allDay && isDateOnly(item.end) ? addDays(item.end, 1) : item.end;
  }
  return {
    id: item.key,
    title: deadlineOnly ? `⏰ ${item.title}` : item.title,
    start,
    end,
    allDay,
    durationEditable: !deadlineOnly,
    classNames: statusClass(item),
  };
}

function onCalendarChange(event: { id: string; start: Date | null; end: Date | null; allDay: boolean }) {
  if (!event.start) {
    return;
  }
  let start: string;
  let end: string | undefined;
  if (event.allDay) {
    start = formatDate(event.start);
    end = event.end ? addDays(formatDate(event.end), -1) : start;
  } else {
    start = formatDateTime(event.start);
    end = event.end ? formatDateTime(event.end) : undefined;
  }
  vscode.postMessage({ type: 'move', key: event.id, start, end });
}

const calendar = new Calendar(document.getElementById('calendar')!, {
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
  locale: jaLocale,
  initialView: 'dayGridMonth',
  headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
  height: '100%',
  editable: true,
  dayMaxEvents: true,
  eventClick: (info) => vscode.postMessage({ type: 'open', key: info.event.id }),
  eventDrop: (info) => onCalendarChange(info.event),
  eventResize: (info) => onCalendarChange(info.event),
  dateClick: (info) => vscode.postMessage({ type: 'create', date: info.allDay ? info.dateStr : formatDateTime(info.date) }),
});

function renderCalendar() {
  calendar.removeAllEvents();
  calendar.addEventSource(items.map(toCalendarEvent));
  calendar.updateSize();
}

// ---- gantt ----

let gantt: Gantt | undefined;
// frappe-gantt uses task ids in CSS selectors, so map items to safe ids.
let ganttKeys: string[] = [];

function toGanttDate(date: string): string {
  return date.replace('T', ' ');
}

function renderGantt() {
  const sorted = [...items].sort((a, b) => (a.start ?? a.end)!.localeCompare((b.start ?? b.end)!));
  ganttKeys = sorted.map((i) => i.key);
  const indexById = new Map(sorted.flatMap((item, i) => (item.id ? [[item.id, i] as const] : [])));

  const tasks = sorted.map((item, i) => {
    const start = (item.start ?? item.end)!;
    const end = item.end ?? start;
    return {
      id: `t${i}`,
      name: item.title,
      description: item.path,
      start: toGanttDate(start),
      end: toGanttDate(end < start ? start : end),
      progress: item.status === 'done' ? 100 : item.status === 'doing' ? 50 : 0,
      dependencies: item.depends.flatMap((id) => (indexById.has(id) ? [`t${indexById.get(id)}`] : [])).join(','),
      // frappe-gantt accepts a single class token only.
      custom_class: statusClass(item).join('--'),
    };
  });

  const container = document.getElementById('gantt-chart')!;
  document.getElementById('gantt-empty')!.hidden = tasks.length > 0;
  if (tasks.length === 0) {
    container.innerHTML = '';
    gantt = undefined;
    return;
  }
  if (gantt) {
    gantt.refresh(tasks);
    return;
  }
  gantt = new Gantt(container, tasks, {
    language: 'ja',
    view_mode: 'Day',
    view_mode_select: true,
    readonly_progress: true,
    on_double_click: (task: { id: string }) => {
      vscode.postMessage({ type: 'open', key: ganttKeys[Number(task.id.slice(1))] });
    },
    on_date_change: (task: { id: string }, start: Date, end: Date) => {
      const key = ganttKeys[Number(task.id.slice(1))];
      const item = items.find((i) => i.key === key);
      if (!item) {
        return;
      }
      const timed = !isDateOnly((item.start ?? item.end)!);
      const fmt = timed ? formatDateTime : formatDate;
      vscode.postMessage({ type: 'move', key, start: fmt(start), end: fmt(end) });
    },
  });
}

// ---- view switching & messaging ----

function render() {
  document.querySelectorAll<HTMLElement>('.view').forEach((el) => (el.hidden = el.id !== view));
  document
    .querySelectorAll<HTMLButtonElement>('[data-view]')
    .forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'calendar') {
    renderCalendar();
  } else {
    renderGantt();
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) =>
  button.addEventListener('click', () => {
    view = button.dataset.view as typeof view;
    render();
  }),
);
document.getElementById('new-item')!.addEventListener('click', () => {
  vscode.postMessage({ type: 'create', date: formatDate(new Date()) });
});

window.addEventListener('message', (e: MessageEvent) => {
  const message = e.data;
  if (message.type === 'items') {
    items = message.items;
  } else if (message.type === 'view') {
    view = message.view;
  }
  render();
});

calendar.render();
vscode.postMessage({ type: 'ready' });
