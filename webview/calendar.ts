import { Calendar, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import jaLocale from '@fullcalendar/core/locales/ja';
import { japaneseHoliday, japaneseHolidaysBetween, vacationDays, weekendColor } from '../src/holidays';
import type { PlannerItem } from '../src/model';
import { CalendarView as CalendarViewSetting, Lang, PlannerSettings, resolveStatus } from '../src/settings';
import { soft, translucent } from './colors';
import { newItem, openItem } from './editor';
import { addDays, formatDate, formatDateTime, isDateOnly } from './dates';
import { itemTooltip, tooltip, TooltipContext } from './tooltip';
import { post } from './vscode';

const VIEW_NAMES: Record<CalendarViewSetting, string> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
};
const RANGE_OF: Record<string, CalendarViewSetting> = {
  dayGridMonth: 'month',
  timeGridWeek: 'week',
  timeGridDay: 'day',
};

/** Navigation state reported to the app bar. */
export interface CalendarNav {
  title: string;
  range: CalendarViewSetting;
}

export class CalendarView {
  private readonly calendar: Calendar;
  private appliedView: CalendarViewSetting | undefined;
  private readonly weekendStyle = document.head.appendChild(document.createElement('style'));
  private lang: Lang = 'ja';
  private context: TooltipContext | undefined;
  private byKey = new Map<string, PlannerItem>();
  private showHolidays = true;

  constructor(
    private readonly el: HTMLElement,
    private readonly onNav: (nav: CalendarNav) => void,
  ) {
    this.calendar = new Calendar(el, {
      plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
      initialView: VIEW_NAMES.month,
      // Navigation lives in the app bar (see main.ts).
      headerToolbar: false,
      height: '100%',
      views: {
        dayGridMonth: {
          // Plain day numbers ("12", not "12日"); the month title carries the context.
          dayCellContent: (arg) => String(arg.date.getDate()),
          dayHeaderFormat: { weekday: 'short' },
        },
        timeGrid: {
          // "月 12" with the date as a pill (accent on today) and the holiday name.
          dayHeaderContent: (arg) => {
            const holiday = this.showHolidays ? japaneseHoliday(formatDate(arg.date), this.lang) : undefined;
            const weekday = new Intl.DateTimeFormat(this.lang, { weekday: 'short' }).format(arg.date);
            return {
              html:
                `<span class="mp-dow">${weekday}</span><span class="mp-dnum">${arg.date.getDate()}</span>` +
                (holiday ? `<span class="mp-hname">${escapeHtml(holiday)}</span>` : ''),
            };
          },
        },
      },
      slotLabelFormat: { hour: 'numeric', minute: '2-digit', hour12: false },
      eventTimeFormat: { hour: 'numeric', minute: '2-digit', hour12: false },
      editable: true,
      // Show timed events as colored bars in month view too, so colors are visible.
      eventDisplay: 'block',
      eventClick: (info) => {
        if (info.event.display !== 'background') {
          openItem(info.event.id, info.jsEvent);
        }
      },
      eventDrop: (info) => onChange(info.event),
      eventResize: (info) => onChange(info.event),
      eventMouseEnter: (info) => {
        const item = this.byKey.get(info.event.id);
        if (item && this.context) {
          const ctx = this.context;
          tooltip().hoverStart(info.el, () => itemTooltip(item, ctx, { hint: 'tooltip.openClick' }), {
            x: info.jsEvent.clientX,
            y: info.jsEvent.clientY,
          });
        }
      },
      eventMouseLeave: (info) => tooltip().hoverEnd(info.el),
      eventDragStart: () => tooltip().hide(),
      eventResizeStart: () => tooltip().hide(),
      dateClick: (info) => newItem({ start: info.allDay ? info.dateStr : formatDateTime(info.date) }),
      datesSet: (arg) => {
        this.onNav({ title: arg.view.title, range: RANGE_OF[arg.view.type] });
        // Re-measure after view/month changes (row count, header).
        requestAnimationFrame(() => this.fitRows());
      },
    });
    this.calendar.render();
    new ResizeObserver(() => this.fitRows()).observe(el);
  }

  prev(): void {
    this.calendar.prev();
  }

  next(): void {
    this.calendar.next();
  }

  today(): void {
    this.calendar.today();
  }

  setRange(range: CalendarViewSetting): void {
    this.calendar.changeView(VIEW_NAMES[range]);
  }

  /**
   * Month view: a week row may grow to fit its events, but never shrinks below
   * its share of the panel height (the overflow scrolls instead).
   */
  private fitRows(): void {
    const harness = this.el.querySelector<HTMLElement>('.fc-view-harness');
    const header = this.el.querySelector<HTMLElement>('.fc-dayGridMonth-view .fc-scrollgrid-section-header');
    const rows = this.el.querySelectorAll('.fc-dayGridMonth-view .fc-daygrid-body tbody tr').length;
    if (!harness || !header || !rows) {
      return;
    }
    // Leave room for the grid borders so a calm month doesn't show a scrollbar.
    const share = Math.floor((harness.clientHeight - header.offsetHeight - 1) / rows);
    this.el.style.setProperty('--mp-week-row-min', `${Math.max(share, 0)}px`);
  }

  update(items: PlannerItem[], settings: PlannerSettings, lang: Lang): void {
    this.lang = lang;
    this.showHolidays = settings.showHolidays;
    this.context = { items, settings, lang };
    this.byKey = new Map(items.map((i) => [i.key, i]));
    this.calendar.setOption('locale', lang === 'ja' ? jaLocale : 'en');
    this.calendar.setOption('firstDay', settings.weekStart);
    // 0: day cells grow to fit every event; n: show n, then "+N more".
    this.calendar.setOption('dayMaxEvents', settings.maxEventsPerDay || false);
    document.documentElement.style.setProperty('--mp-holiday-color', settings.holidayColor);
    this.weekendStyle.textContent = weekendStyles(settings);

    // Day cells: weekend colors, holiday/vacation day numbers. A holiday wins over
    // its weekday color (its own background comes from the holiday event).
    const vacations = new Set(vacationDays(items).map((d) => d.date));
    const dayClasses = ({ date }: { date: Date }, withHolidays = true) => {
      const iso = formatDate(date);
      const classes: string[] = [];
      if (!withHolidays) {
        // Weekday header: color by day of week only.
        if (settings.weekendColors[String(date.getDay())]) {
          classes.push(`mp-wd-${date.getDay()}`);
        }
      } else if (settings.showHolidays && japaneseHoliday(iso, lang)) {
        classes.push('mp-holiday');
      } else if (weekendColor(iso, date.getDay(), settings)) {
        classes.push(`mp-wd-${date.getDay()}`);
      }
      if (withHolidays && vacations.has(iso)) {
        classes.push('mp-vacation');
      }
      return classes;
    };
    this.calendar.setOption('dayCellClassNames', (arg) => dayClasses(arg));
    // The month view header stands for a weekday, not a date.
    this.calendar.setOption('dayHeaderClassNames', (arg) => dayClasses(arg, arg.view.type !== 'dayGridMonth'));
    // Only follow the setting when it changes, so the user's own view switches stick.
    if (this.appliedView !== settings.calendarView) {
      this.appliedView = settings.calendarView;
      this.calendar.changeView(VIEW_NAMES[settings.calendarView]);
    }

    const dated = items
      .filter((i) => i.start ?? i.end)
      .filter((i) => i.type === 'holiday' || !(settings.hideDone && resolveStatus(i.status, settings.statuses).done));
    const events = dated.map((i) => toEvent(i, settings));
    // Shade the days of each vacation, in addition to its draggable bar.
    const vacationShades = dated
      .filter((i) => i.type === 'holiday')
      .map(
        (i): EventInput => ({
          ...toEvent(i, settings),
          id: `bg:${i.key}`,
          display: 'background',
          title: '',
          backgroundColor: translucent(settings.vacationColor, '17'),
          // Plain day shading; the striped look is for the bar only.
          classNames: ['mp-vacation-bg'],
        }),
      );

    this.calendar.removeAllEventSources();
    this.calendar.addEventSource([...events, ...vacationShades]);
    if (settings.showHolidays) {
      this.calendar.addEventSource({
        events: (range, success) =>
          success(
            japaneseHolidaysBetween(formatDate(range.start), formatDate(range.end), lang).map((h) => ({
              id: `jp:${h.date}`,
              title: h.name,
              start: h.date,
              allDay: true,
              display: 'background',
              backgroundColor: translucent(settings.holidayColor, '17'),
              classNames: ['mp-holiday-bg'],
            })),
          ),
      });
    }
    this.calendar.updateSize();
    this.fitRows();
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function weekendStyles(settings: PlannerSettings): string {
  return Object.entries(settings.weekendColors)
    .map(
      ([day, color]) => `
.fc .mp-wd-${day} { background: ${translucent(color, '12')}; }
.fc .mp-wd-${day} .fc-daygrid-day-number,
.fc .fc-col-header-cell.mp-wd-${day} .fc-col-header-cell-cushion { color: ${color}; }`,
    )
    .join('\n');
}

function toEvent(item: PlannerItem, settings: PlannerSettings): EventInput {
  const start = (item.start ?? item.end)!;
  const allDay = isDateOnly(start);
  const deadlineOnly = !item.start;
  let end: string | undefined;
  if (item.start && item.end) {
    // FullCalendar's all-day end is exclusive; ours is inclusive.
    end = allDay && isDateOnly(item.end) ? addDays(item.end, 1) : item.end;
  }
  const status = resolveStatus(item.status, settings.statuses);
  const color =
    item.type === 'event' ? settings.eventColor : item.type === 'holiday' ? settings.vacationColor : status.color;
  // The shape tells the type apart (see .mp-ev in style.css): tasks are a soft chip
  // with a left accent line, events a filled pill, vacations a striped bar.
  const title = item.type === 'task' && deadlineOnly ? `⏰ ${item.title}` : item.title;
  const classNames = ['mp-ev', `mp-ev-${item.type}`];
  if (status.done && item.type === 'task') {
    classNames.push('is-done');
  }
  return {
    id: item.key,
    title,
    start,
    end,
    allDay,
    durationEditable: !deadlineOnly,
    backgroundColor: item.type === 'event' ? translucent(color, '66') : soft(color),
    borderColor: color,
    classNames,
  };
}

function onChange(event: { id: string; start: Date | null; end: Date | null; allDay: boolean }) {
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
  post({ type: 'move', key: event.id, start, end });
}
